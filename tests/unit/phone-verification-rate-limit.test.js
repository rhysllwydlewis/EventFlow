/**
 * POST /api/me/phone/verify-code accepts a 6-digit code (1,000,000 possible
 * values) valid for 10 minutes. Unlike /send-code, /login-2fa, and every other
 * short-code verification endpoint in this codebase, it previously carried no
 * rate limiter at all, so an authenticated attacker could script unlimited
 * guesses against it within the code's validity window. This locks it to its
 * own dedicated phoneVerifyLimiter (deliberately not the shared
 * strictAuthLimiter, which also guards /login, /google and /login-2fa — reusing
 * that singleton would let phone-code attempts and login attempts drain the
 * same bucket).
 */
'use strict';

const express = require('express');
const request = require('supertest');

function buildApp({ user }) {
  jest.resetModules();

  jest.doMock('../../middleware/auth', () => ({
    authRequired: (req, _res, next) => {
      req.user = { id: user.id };
      next();
    },
  }));
  jest.doMock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
  jest.doMock('../../db-unified', () => ({
    findOne: jest.fn(async () => user),
    updateOne: jest.fn(async () => true),
  }));

  const phoneVerificationRoutes = require('../../routes/phoneVerification');
  const app = express();
  app.use(express.json());
  app.use('/api/me/phone', phoneVerificationRoutes);
  return app;
}

describe('POST /api/me/phone/verify-code — brute-force protection', () => {
  test('is rate limited after repeated incorrect guesses', async () => {
    const user = {
      id: 'user_1',
      phoneVerificationCode: '123456',
      phoneNumberToVerify: '+447123456789',
      phoneVerificationExpires: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    const app = buildApp({ user });

    const attempts = [];
    for (let i = 0; i < 6; i += 1) {
      attempts.push(await request(app).post('/api/me/phone/verify-code').send({ code: '000000' }));
    }

    const statuses = attempts.map(res => res.status);
    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses[5]).toBe(429);
  });

  test('still verifies a correct code when under the limit', async () => {
    const user = {
      id: 'user_1',
      phoneVerificationCode: '654321',
      phoneNumberToVerify: '+447987654321',
      phoneVerificationExpires: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    const app = buildApp({ user });

    const res = await request(app).post('/api/me/phone/verify-code').send({ code: '654321' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('does not share its bucket with the login rate limiter', async () => {
    jest.resetModules();
    const { strictAuthLimiter, phoneVerifyLimiter } = require('../../middleware/rateLimits');

    const app = express();
    app.post('/login', strictAuthLimiter, (_req, res) => res.status(401).json({ ok: false }));
    app.post('/verify-code', phoneVerifyLimiter, (_req, res) =>
      res.status(400).json({ ok: false })
    );

    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/login');
    }
    expect((await request(app).post('/login')).status).toBe(429);

    // Exhausting the login limiter must not touch the phone-verification bucket.
    expect((await request(app).post('/verify-code')).status).toBe(400);
  });
});
