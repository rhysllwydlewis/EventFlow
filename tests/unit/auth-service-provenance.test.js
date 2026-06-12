'use strict';

const bcrypt = require('bcryptjs');

function loadAuthService({ users = [], sendVerificationResult, sendResetResult } = {}) {
  jest.resetModules();
  const inserted = [];
  const updates = [];
  jest.doMock('../../db-unified', () => ({
    findOne: jest.fn(async (_collection, query) => {
      if (query.email) {
        return users.find(user => user.email === query.email) || null;
      }
      if (query.id) {
        return users.find(user => user.id === query.id) || null;
      }
      return null;
    }),
    insertOne: jest.fn(async (_collection, doc) => {
      inserted.push(doc);
      users.push(doc);
      return doc;
    }),
    updateOne: jest.fn(async (_collection, filter, update) => {
      updates.push({ filter, update });
      const user = users.find(item => item.id === filter.id || item.email === filter.email);
      if (user && update.$set) {
        Object.assign(user, update.$set);
      }
      return true;
    }),
  }));
  jest.doMock('../../utils/postmark', () => ({
    sendVerificationEmail: jest.fn(
      async () =>
        sendVerificationResult || {
          emailLogId: 'email_log_verify',
          MessageID: 'postmark_verify',
          provider: 'postmark',
          emailLogStatus: 'sent',
          sentAt: '2026-06-07T00:00:00.000Z',
        }
    ),
    sendPasswordResetEmail: jest.fn(
      async () =>
        sendResetResult || {
          emailLogId: 'email_log_reset',
          MessageID: 'postmark_reset',
          provider: 'postmark',
          emailLogStatus: 'sent',
          sentAt: '2026-06-07T00:00:00.000Z',
        }
    ),
  }));
  return { authService: require('../../services/auth.service'), inserted, updates, users };
}

describe('auth service provenance', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-key-for-auth-service-provenance-32';
  });

  afterEach(() => {
    jest.dontMock('../../db-unified');
    jest.dontMock('../../utils/postmark');
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  test('register stores pending email/password provenance and verification email metadata', async () => {
    const { authService, inserted } = loadAuthService();

    await authService.register({
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      password: 'Password123!',
      location: 'Cardiff',
      role: 'customer',
    });

    expect(inserted[0]).toMatchObject({
      signupMethod: 'email_password',
      authProvider: 'local',
      verificationMethod: 'pending',
      verified: false,
      lastVerificationEmailLogId: 'email_log_verify',
      lastVerificationEmailPostmarkMessageId: 'postmark_verify',
      emailDeliveryStatus: 'sent',
    });
  });

  test('requestPasswordReset stores a JWT reset token that resetPassword can consume by email', async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const users = [{ id: 'usr_1', email: 'reset@example.com', passwordHash, role: 'customer' }];
    const { authService } = loadAuthService({ users });

    await authService.requestPasswordReset('reset@example.com');
    const resetToken = users[0].resetToken;
    const tokenUtils = require('../../utils/token');
    expect(tokenUtils.validatePasswordResetToken(resetToken).valid).toBe(true);

    await authService.resetPassword(resetToken, 'NewPassword123!');
    expect(users[0].resetToken).toBeNull();
    await expect(bcrypt.compare('NewPassword123!', users[0].passwordHash)).resolves.toBe(true);
  });

  test('verifyEmail stores EventFlow email verification provenance', async () => {
    const tokenUtils = require('../../utils/token');
    const user = { id: 'usr_2', email: 'verify@example.com', role: 'customer', verified: false };
    const verificationToken = tokenUtils.generateVerificationToken(user, { expiresInHours: 24 });
    user.verificationToken = verificationToken;
    user.verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { authService, users } = loadAuthService({ users: [user] });

    await authService.verifyEmail(verificationToken);

    expect(users[0]).toMatchObject({
      verified: true,
      verificationMethod: 'eventflow_email',
      verifiedBy: { type: 'user' },
    });
    expect(users[0].verifiedAt).toBeTruthy();
  });
});
