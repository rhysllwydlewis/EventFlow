/**
 * Suspended and banned accounts are actually locked out: they cannot sign in, and a session they
 * already hold stops working on its next request. Until now both were only labels.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function noOp(_req, _res, next) {
  next();
}

// Made up fresh for each run, so no credential-looking literal is stored in the repo
const PASSWORD = `${crypto.randomBytes(9).toString('hex')}aA1!`;
const HOUR = 60 * 60 * 1000;

function buildApp(users) {
  jest.resetModules();

  jest.doMock('../../middleware/rateLimits', () => ({
    authLimiter: noOp,
    resendEmailLimiter: noOp,
    strictAuthLimiter: noOp,
    passwordResetLimiter: noOp,
    registrationLimiter: noOp,
    tokenLinkLimiter: noOp,
    writeLimiter: noOp,
  }));
  jest.doMock('../../middleware/features', () => ({
    featureRequired: () => noOp,
    getFeatureFlags: jest.fn(async () => ({ registration: true, supplierApplications: true })),
  }));
  jest.doMock('../../middleware/csrf', () => ({ csrfProtection: noOp }));
  jest.doMock('../../utils/postmark', () => ({
    sendVerificationEmail: jest.fn(async () => true),
    sendWelcomeEmail: jest.fn(async () => true),
    sendPasswordResetEmail: jest.fn(async () => true),
    sendPasswordResetConfirmation: jest.fn(async () => true),
  }));
  jest.doMock('../../db-unified', () => ({
    read: jest.fn(async collection => (collection === 'users' ? users : [])),
    updateOne: jest.fn(async (_collection, query, update) => {
      if (users.failWrites) {
        throw new Error('write failed');
      }
      const user = users.find(item => item.id === query.id);
      if (user) {
        Object.assign(user, update.$set || {});
      }
      return true;
    }),
    findOne: jest.fn(async (_collection, query) => {
      if (query && query.id) {
        return users.find(user => user.id === query.id) || null;
      }
      if (query && query.email) {
        return users.find(user => user.email === query.email) || null;
      }
      return null;
    }),
  }));

  const { authRequired } = require('../../middleware/auth');
  const cookieParser = require('cookie-parser');
  const authRoutes = require('../../routes/auth');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.get('/api/private', authRequired, (req, res) => res.json({ ok: true, id: req.user.id }));
  app.get('/private-page', authRequired, (req, res) => res.send('page'));
  return app;
}

function sessionCookie(user) {
  const { JWT_SECRET } = require('../../middleware/auth');
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: '1h',
  });
  return `token=${token}`;
}

describe('suspended and banned accounts', () => {
  const OLD_ENV = process.env;
  let passwordHash;
  let users;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(PASSWORD, 4);
  });

  beforeEach(() => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test' };
    const base = { role: 'customer', verified: true, passwordHash };
    users = [
      { ...base, id: 'ok', email: 'ok@example.test' },
      { ...base, id: 'sus', email: 'sus@example.test', suspended: true, suspensionReason: 'spam' },
      { ...base, id: 'ban', email: 'ban@example.test', banned: true, banReason: 'abuse' },
      {
        ...base,
        id: 'timed',
        email: 'timed@example.test',
        suspended: true,
        suspensionExpiresAt: new Date(Date.now() + HOUR).toISOString(),
      },
      {
        ...base,
        id: 'over',
        email: 'over@example.test',
        suspended: true,
        suspensionExpiresAt: new Date(Date.now() - HOUR).toISOString(),
      },
    ];
  });

  afterEach(() => {
    process.env = OLD_ENV;
    ['rateLimits', 'features', 'csrf'].forEach(name => jest.dontMock(`../../middleware/${name}`));
    jest.dontMock('../../utils/postmark');
    jest.dontMock('../../db-unified');
  });

  describe('signing in', () => {
    const login = (app, email, password = PASSWORD) =>
      request(app).post('/api/auth/login').send({ email, password });

    it('refuses a suspended account with the right password, and sets no cookie', async () => {
      const response = await login(buildApp(users), 'sus@example.test');
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
      expect(response.body.error).toMatch(/suspended/i);
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('refuses a banned account', async () => {
      const response = await login(buildApp(users), 'ban@example.test');
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ACCOUNT_BANNED');
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('does not tell someone without the password that the account is suspended', async () => {
      const response = await login(buildApp(users), 'sus@example.test', 'wrong-password-1');
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid email or password');
    });

    it('does not send back the reason an admin typed', async () => {
      const response = await login(buildApp(users), 'sus@example.test');
      expect(JSON.stringify(response.body)).not.toMatch(/spam/);
    });

    it('still lets an ordinary account, and one whose timed suspension has ended, in', async () => {
      const app = buildApp(users);
      expect((await login(app, 'ok@example.test')).status).toBe(200);
      expect((await login(app, 'over@example.test')).status).toBe(200);
    });

    it('refuses an account whose timed suspension is still running', async () => {
      const response = await login(buildApp(users), 'timed@example.test');
      expect(response.status).toBe(403);
    });
  });

  describe('a session that already exists', () => {
    it('is refused on the next API request with a 403 and the reason code', async () => {
      const app = buildApp(users);
      const suspended = await request(app)
        .get('/api/private')
        .set('Cookie', sessionCookie(users[1]));
      expect(suspended.status).toBe(403);
      expect(suspended.body.code).toBe('ACCOUNT_SUSPENDED');

      const banned = await request(app).get('/api/private').set('Cookie', sessionCookie(users[2]));
      expect(banned.status).toBe(403);
      expect(banned.body.code).toBe('ACCOUNT_BANNED');
    });

    it('sends a browser to the sign-in page with the reason', async () => {
      const response = await request(buildApp(users))
        .get('/private-page')
        .set('Cookie', sessionCookie(users[1]))
        .set('Accept', 'text/html')
        .set('Sec-Fetch-Mode', 'navigate');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/auth?reason=suspended');
    });

    it('lets an ordinary account through', async () => {
      const response = await request(buildApp(users))
        .get('/api/private')
        .set('Cookie', sessionCookie(users[0]));
      expect(response.status).toBe(200);
    });

    it('lets an account through once a timed suspension has ended, and clears the record', async () => {
      const app = buildApp(users);
      const response = await request(app)
        .get('/api/private')
        .set('Cookie', sessionCookie(users[4]));
      expect(response.status).toBe(200);
      await new Promise(resolve => setImmediate(resolve));
      expect(users[4]).toMatchObject({
        suspended: false,
        suspensionExpiresAt: null,
        suspensionReason: null,
      });
    });

    it('still lets the account through if tidying the expired suspension fails', async () => {
      users.failWrites = true;
      const response = await request(buildApp(users))
        .get('/api/private')
        .set('Cookie', sessionCookie(users[4]));
      expect(response.status).toBe(200);
      await new Promise(resolve => setImmediate(resolve));
      expect(users[4].suspended).toBe(true);
    });

    it('is signed out as far as GET /me is concerned', async () => {
      const app = buildApp(users);
      const suspended = await request(app)
        .get('/api/auth/me')
        .set('Cookie', sessionCookie(users[1]));
      expect(suspended.body).toEqual({ user: null, restricted: 'suspended' });
      const ordinary = await request(app)
        .get('/api/auth/me')
        .set('Cookie', sessionCookie(users[0]));
      expect(ordinary.body.user.id).toBe('ok');
    });
  });
});
