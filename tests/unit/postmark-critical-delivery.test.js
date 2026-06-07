'use strict';

describe('postmark critical delivery', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  test('production critical verification email fails when Postmark is unavailable', async () => {
    jest.resetModules();
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    delete process.env.POSTMARK_API_KEY;

    const updates = [];
    jest.doMock('../../services/emailLog.service', () => ({
      createAttempt: jest.fn(async () => ({ id: 'log_critical' })),
      updateStatus: jest.fn(async (id, update) => updates.push({ id, update })),
    }));

    const postmark = require('../../utils/postmark');
    await expect(
      postmark.sendVerificationEmail({ email: 'user@example.com', name: 'User' }, 'token')
    ).rejects.toThrow('Critical email delivery failed');
    expect(updates.some(entry => entry.update.status === 'failed')).toBe(true);
  });

  test('production critical password reset email fails when Postmark is unavailable', async () => {
    jest.resetModules();
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    delete process.env.POSTMARK_API_KEY;

    jest.doMock('../../services/emailLog.service', () => ({
      createAttempt: jest.fn(async () => ({ id: 'log_reset' })),
      updateStatus: jest.fn(async () => true),
    }));

    const postmark = require('../../utils/postmark');
    await expect(
      postmark.sendPasswordResetEmail({ email: 'user@example.com', name: 'User' }, 'token')
    ).rejects.toThrow('Critical email delivery failed');
  });
});
