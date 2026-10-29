/**
 * The other ways in: Google / Facebook / Apple redirect sign-in, the one-tap Google sign-in, the
 * 2FA step and the "who am I" endpoint all refuse a suspended or banned account, the same as a
 * password sign-in does.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

function noOp(_req, _res, next) {
  next();
}

const encodeState = state => Buffer.from(JSON.stringify(state)).toString('base64url');

function profileFor(prefix) {
  return { sub: `${prefix}-sub`, email: `${prefix}@example.test`, emailAuthoritative: true };
}

function mountRouter(routerPath, users, services = {}) {
  jest.resetModules();
  jest.doMock('../../middleware/rateLimits', () => ({
    authLimiter: noOp,
    strictAuthLimiter: noOp,
    resendEmailLimiter: noOp,
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
  jest.doMock('../../utils/postmark', () => ({}));
  const db = {
    read: jest.fn(async collection => (collection === 'users' ? users : [])),
    updateOne: jest.fn(async (_collection, query, update) => {
      const user = users.find(item => item.id === query.id);
      if (user) {
        Object.assign(user, update.$set || {});
      }
      return true;
    }),
    findOne: jest.fn(async (_collection, query) => {
      if (query && query.$or) {
        return (
          users.find(user => query.$or.some(clause => clause.googleSub === user.googleSub)) || null
        );
      }
      if (query && query.id) {
        return users.find(user => user.id === query.id) || null;
      }
      if (query && query.email) {
        return users.find(user => user.email === query.email) || null;
      }
      return null;
    }),
    insertOne: jest.fn(async (_collection, doc) => doc),
  };
  jest.doMock('../../db-unified', () => db);
  Object.entries(services).forEach(([name, factory]) => jest.doMock(name, factory));

  const router = require(routerPath);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', router);
  return app;
}

const baseUser = { role: 'customer', verified: true };

describe('redirect sign-in refuses restricted accounts', () => {
  afterEach(() => {
    jest.dontMock('../../services/googleAuth.service');
    jest.dontMock('../../services/facebookAuth.service');
    jest.dontMock('../../services/appleAuth.service');
    jest.dontMock('../../db-unified');
  });

  const cases = [
    {
      name: 'Google',
      routerPath: '../../routes/google-redirect-auth',
      subField: 'googleSub',
      service: '../../services/googleAuth.service',
      serviceFn: 'verifyGoogleCredential',
      prefix: 'g',
      send: app =>
        request(app)
          .post('/api/auth/callback/google')
          .set('Cookie', 'g_csrf_token=abc')
          .type('form')
          .send({ g_csrf_token: 'abc', credential: 'cred', state: encodeState({}) })
          .redirects(0),
    },
    {
      name: 'Facebook',
      routerPath: '../../routes/facebook-redirect-auth',
      subField: 'facebookSub',
      service: '../../services/facebookAuth.service',
      serviceFn: 'verifyFacebookAuthorizationCode',
      prefix: 'f',
      send: app =>
        request(app)
          .get('/api/auth/callback/facebook')
          .set('Cookie', 'facebook_auth_csrf=tok')
          .query({ code: 'code', state: encodeState({ csrf: 'tok' }) })
          .redirects(0),
    },
    {
      name: 'Apple',
      routerPath: '../../routes/apple-redirect-auth',
      subField: 'appleSub',
      service: '../../services/appleAuth.service',
      serviceFn: 'verifyAppleCredential',
      prefix: 'a',
      send: app =>
        request(app)
          .post('/api/auth/callback/apple')
          .set('Cookie', 'apple_auth_nonce=tok')
          .type('form')
          .send({ id_token: 'cred', state: encodeState({ csrf: 'tok' }) })
          .redirects(0),
    },
  ];

  describe.each(cases)('$name', ({ routerPath, subField, service, serviceFn, prefix, send }) => {
    const build = userFields => {
      const profile = profileFor(prefix);
      const users = [
        { ...baseUser, id: 'u1', email: profile.email, [subField]: profile.sub, ...userFields },
      ];
      const app = mountRouter(routerPath, users, {
        [service]: () => ({
          ...jest.requireActual(service),
          [serviceFn]: jest.fn(async () => profile),
        }),
      });
      return { app, users };
    };

    it('sends a suspended account back to sign-in with the reason, and sets no session', async () => {
      const { app } = build({ suspended: true });
      const response = await send(app);
      expect(response.status).toBe(303);
      expect(response.headers.location).toBe('/auth?reason=suspended');
      expect(JSON.stringify(response.headers['set-cookie'] || [])).not.toMatch(/token=/);
    });

    it('does the same for a banned account', async () => {
      const { app } = build({ banned: true });
      const response = await send(app);
      expect(response.headers.location).toBe('/auth?reason=banned');
    });

    it('still signs an ordinary account in', async () => {
      const { app } = build({});
      const response = await send(app);
      expect(response.status).toBe(303);
      expect(response.headers.location).not.toMatch(/reason=/);
      expect(JSON.stringify(response.headers['set-cookie'] || [])).toMatch(/token=/);
    });
  });
});

describe('one-tap Google sign-in and the 2FA step refuse restricted accounts', () => {
  const profile = profileFor('one');

  const build = userFields => {
    const users = [
      { ...baseUser, id: 'u1', email: profile.email, googleSub: profile.sub, ...userFields },
    ];
    const app = mountRouter('../../routes/auth', users, {
      '../../services/googleAuth.service': () => ({
        ...jest.requireActual('../../services/googleAuth.service'),
        verifyGoogleCredential: jest.fn(async () => profile),
      }),
      '../../utils/encryption': () => ({
        ...jest.requireActual('../../utils/encryption'),
        decrypt: jest.fn(() => 'SECRET'),
        verifyHash: jest.fn(() => false),
      }),
      speakeasy: () => ({ totp: { verify: jest.fn(() => true) } }),
    });
    return { app, users };
  };

  afterEach(() => {
    jest.dontMock('../../services/googleAuth.service');
    jest.dontMock('../../utils/encryption');
    jest.dontMock('speakeasy');
    jest.dontMock('../../db-unified');
  });

  const google = app => request(app).post('/api/auth/google').send({ credential: 'cred' });

  it('refuses a suspended account on Google sign-in', async () => {
    const response = await google(build({ suspended: true }).app);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refuses a banned account on Google sign-in', async () => {
    const response = await google(build({ banned: true }).app);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ACCOUNT_BANNED');
  });

  it('still signs an ordinary account in with Google', async () => {
    const response = await google(build({}).app);
    expect(response.status).toBe(200);
  });

  describe('2FA step', () => {
    const twoFactor = { twoFactorEnabled: true, twoFactorSecret: 'enc' };
    const complete = app => {
      const { JWT_SECRET } = require('../../middleware/auth');
      const tempToken = jwt.sign({ id: 'u1', requires2FA: true }, JWT_SECRET, { expiresIn: '5m' });
      return request(app).post('/api/auth/login-2fa').send({ tempToken, token: '123456' });
    };

    it('refuses a suspended account even with a correct code, and sets no cookie', async () => {
      const response = await complete(build({ ...twoFactor, suspended: true }).app);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('completes the sign-in for an ordinary account', async () => {
      const response = await complete(build(twoFactor).app);
      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    });
  });
});

describe('GET /api/v1/auth/me on the real app', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reports nobody signed in for a suspended account, and the account for an ordinary one', async () => {
    jest.resetModules();
    ['rateLimits', 'features', 'csrf'].forEach(name => jest.dontMock(`../../middleware/${name}`));
    jest.dontMock('../../utils/postmark');
    jest.dontMock('../../db-unified');
    const dbUnified = require('../../db-unified');
    const app = require('../../server');
    const { JWT_SECRET } = require('../../middleware/auth');
    const cookie = `token=${jwt.sign({ id: 'u1', email: 'm@example.test', role: 'customer' }, JWT_SECRET, { expiresIn: '1h' })}`;

    const stored = {
      id: 'u1',
      email: 'm@example.test',
      name: 'M',
      role: 'customer',
      verified: true,
    };
    const find = jest.spyOn(dbUnified, 'findOne');

    find.mockResolvedValue({ ...stored, suspended: true });
    const suspended = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(suspended.body).toEqual({ user: null, restricted: 'suspended' });

    find.mockResolvedValue({ ...stored, banned: true });
    const banned = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(banned.body).toEqual({ user: null, restricted: 'banned' });

    find.mockResolvedValue(stored);
    const ordinary = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(ordinary.body.user.id).toBe('u1');
  }, 60000);
});
