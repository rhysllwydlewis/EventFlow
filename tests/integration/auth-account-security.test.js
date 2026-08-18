/**
 * Account creation and login-adjacent security regressions.
 */

'use strict';

const express = require('express');
const request = require('supertest');

function noOp(_req, _res, next) {
  next();
}

function buildApp({ users, updates }) {
  jest.resetModules();

  jest.doMock('../../middleware/rateLimits', () => ({
    authLimiter: noOp,
    resendEmailLimiter: noOp,
    strictAuthLimiter: noOp,
    passwordResetLimiter: noOp,
    registrationLimiter: noOp,
    tokenLinkLimiter: noOp,
  }));

  jest.doMock('../../middleware/features', () => ({
    featureRequired: () => noOp,
    getFeatureFlags: jest.fn(async () => ({
      registration: true,
      supplierApplications: true,
    })),
  }));

  jest.doMock('../../middleware/csrf', () => ({ csrfProtection: noOp }));
  jest.doMock('../../utils/postmark', () => ({
    sendVerificationEmail: jest.fn(async () => true),
    sendWelcomeEmail: jest.fn(async () => true),
    sendPasswordResetEmail: jest.fn(async () => true),
    sendPasswordResetConfirmation: jest.fn(async () => true),
  }));

  jest.doMock('../../db-unified', () => ({
    read: jest.fn(async collection => {
      if (collection === 'users') {
        return users;
      }
      return [];
    }),
    insertOne: jest.fn(async (_collection, doc) => {
      users.push(doc);
      return doc;
    }),
    updateOne: jest.fn(async (_collection, query, update) => {
      updates.push({ query, update });
      const user = users.find(u => u.id === query.id);
      if (user) {
        Object.assign(user, update.$set || {});
        if (update.$unset) {
          Object.keys(update.$unset).forEach(key => delete user[key]);
        }
      }
      return true;
    }),
    findOne: jest.fn(async (_collection, query) => {
      // Handle function filters (legacy token lookups), {id}, {email}, and {$or}
      if (typeof query === 'function') {
        return users.find(query) || null;
      }
      if (query && query.id) {
        return users.find(u => u.id === query.id) || null;
      }
      if (query && query.email) {
        return users.find(u => u.email === query.email) || null;
      }
      if (query && query.$or) {
        return (
          users.find(u => query.$or.some(cond => Object.keys(cond).every(k => u[k] === cond[k]))) ||
          null
        );
      }
      return null;
    }),
  }));

  const authRoutes = require('../../routes/auth');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

describe('auth account lifecycle security regressions', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, NODE_ENV: 'test' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.dontMock('../../middleware/rateLimits');
    jest.dontMock('../../middleware/features');
    jest.dontMock('../../middleware/csrf');
    jest.dontMock('../../utils/postmark');
    jest.dontMock('../../db-unified');
  });

  it('rejects password reset JWTs that are not the active stored reset token', async () => {
    const tokenUtils = require('../../utils/token');
    const resetToken = tokenUtils.generatePasswordResetToken('user@example.com');
    const users = [
      {
        id: 'usr_1',
        email: 'user@example.com',
        resetToken: 'newer-token',
        resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    ];
    const updates = [];
    const app = buildApp({ users, updates });

    await request(app)
      .post('/api/auth/validate-reset-token')
      .send({ token: resetToken })
      .expect(400)
      .expect(res => {
        expect(res.body.error).toBe('Invalid or expired password reset link');
      });

    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, password: 'Newpass123' })
      .expect(400)
      .expect(res => {
        expect(res.body.error).toBe('Invalid or expired password reset link');
      });

    expect(updates).toHaveLength(0);
  });

  it('applies admin-domain promotion through POST email verification', async () => {
    process.env.ADMIN_DOMAINS = 'eventflow.test';
    const tokenUtils = require('../../utils/token');
    const user = {
      id: 'usr_admin_domain',
      email: 'person@eventflow.test',
      name: 'Admin Person',
      role: 'customer',
      verified: false,
    };
    const verificationToken = tokenUtils.generateVerificationToken(user, { expiresInHours: 1 });
    user.verificationToken = verificationToken;
    user.verificationTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const updates = [];
    const app = buildApp({ users: [user], updates });

    await request(app)
      .post('/api/auth/verify-email')
      .send({ token: verificationToken })
      .expect(200)
      .expect(res => {
        expect(res.body.user.role).toBe('admin');
      });

    expect(updates[0].update.$set).toMatchObject({ verified: true, role: 'admin' });
    expect(updates[0].update.$unset).toHaveProperty('verificationToken');
  });

  it('rejects legacy verification tokens that have no active expiry record', async () => {
    const updates = [];
    const app = buildApp({
      users: [
        {
          id: 'usr_missing_expiry',
          email: 'missing-expiry@example.com',
          name: 'Missing Expiry',
          role: 'customer',
          verified: false,
          verificationToken: 'legacy-token-without-expiry',
        },
      ],
      updates,
    });

    await request(app)
      .get('/api/auth/verify')
      .query({ token: 'legacy-token-without-expiry' })
      .expect(400)
      .expect(res => {
        expect(res.body.code).toBe('INVALID_TOKEN');
      });

    expect(updates).toHaveLength(0);
  });

  it('rejects legacy POST verification tokens with malformed expiry records', async () => {
    const updates = [];
    const app = buildApp({
      users: [
        {
          id: 'usr_bad_expiry',
          email: 'bad-expiry@example.com',
          name: 'Bad Expiry',
          role: 'customer',
          verified: false,
          emailVerificationToken: 'legacy-token-bad-expiry',
          emailVerificationExpires: 'not-a-date',
        },
      ],
      updates,
    });

    await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'legacy-token-bad-expiry' })
      .expect(400)
      .expect(res => {
        expect(res.body.code).toBe('TOKEN_EXPIRED');
      });

    expect(updates).toHaveLength(0);
  });

  it('supports emailVerificationToken legacy verification through the POST endpoint', async () => {
    const updates = [];
    const app = buildApp({
      users: [
        {
          id: 'usr_legacy',
          email: 'legacy@example.com',
          name: 'Legacy User',
          role: 'customer',
          verified: false,
          emailVerificationToken: 'legacy-token',
          emailVerificationExpires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      ],
      updates,
    });

    await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'legacy-token' })
      .expect(200)
      .expect(res => {
        expect(res.body.user.email).toBe('legacy@example.com');
      });

    expect(updates[0].update.$set).toMatchObject({ verified: true });
    expect(updates[0].update.$unset).toHaveProperty('emailVerificationToken');
    expect(updates[0].update.$unset).toHaveProperty('emailVerificationExpires');
  });
});
