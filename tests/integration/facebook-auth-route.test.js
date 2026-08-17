'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

function encodeState(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildAuthApp({
  facebookProfile,
  facebookError,
  users = [],
  features,
  insertOneResult,
  supplierInsertFails = false,
} = {}) {
  jest.resetModules();
  process.env.JWT_SECRET = 'test-secret-key-for-facebook-route-tests-minimum-32';
  process.env.NODE_ENV = 'test';

  const inserted = [];
  const insertedSuppliers = [];
  const updates = [];
  const deleted = [];
  let uidCounter = 0;

  jest.doMock('../../db-unified', () => ({
    uid: jest.fn(prefix => `${prefix}-test-${++uidCounter}`),
    read: jest.fn(async collection => (collection === 'users' ? users : [])),
    insertOne: jest.fn(async (collection, doc) => {
      if (collection === 'suppliers') {
        if (supplierInsertFails) {
          return null;
        }
        insertedSuppliers.push(doc);
        return true;
      }
      if (insertOneResult === false) {
        return null;
      }
      inserted.push(doc);
      return true;
    }),
    updateOne: jest.fn(async (_collection, filter, update) => {
      updates.push({ filter, update });
      return true;
    }),
    deleteOne: jest.fn(async (_collection, filter) => {
      deleted.push(filter);
      return true;
    }),
    findOne: jest.fn(async (collection, query) => {
      if (collection === 'suppliers') {
        return null;
      }
      if (typeof query === 'function') {
        return users.find(query) || null;
      }
      if (query && query.id) {
        return users.find(u => u.id === query.id) || null;
      }
      if (query && query.email) {
        return users.find(u => u.email === query.email) || null;
      }
      return null;
    }),
  }));

  jest.doMock('../../services/facebookAuth.service', () => ({
    isFacebookConfigured: jest.fn(() => true),
    getFacebookAppId: jest.fn(() => 'test-facebook-app-id'),
    verifyFacebookAuthorizationCode: jest.fn(async () => {
      if (facebookError) {
        throw facebookError;
      }
      return (
        facebookProfile || {
          sub: 'fb-sub-123',
          email: 'new-user@example.com',
          name: 'New Facebook User',
          given_name: 'New',
          family_name: 'User',
          emailAuthoritative: true,
        }
      );
    }),
  }));

  jest.doMock('../../middleware/features', () => ({
    featureRequired: () => (_req, _res, next) => next(),
    getFeatureFlags: jest.fn(async () => ({
      registration: true,
      supplierApplications: true,
      ...features,
    })),
  }));

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/auth', require('../../routes/facebook-redirect-auth'));
  app.use('/api/auth', require('../../routes/facebook-redirect-auth'));
  return { app, inserted, insertedSuppliers, updates, deleted };
}

describe('Facebook auth route', () => {
  afterEach(() => {
    jest.dontMock('../../db-unified');
    jest.dontMock('../../services/facebookAuth.service');
    jest.dontMock('../../middleware/features');
    jest.restoreAllMocks();
    delete process.env.BASE_URL;
  });

  it('issues a CSRF token and sets a short-lived httpOnly cookie', async () => {
    const { app } = buildAuthApp();

    const response = await request(app).get('/api/auth/facebook/csrf').expect(200);

    expect(response.body.ok).toBe(true);
    expect(typeof response.body.csrf).toBe('string');
    expect(response.body.csrf.length).toBeGreaterThan(10);
    const cookies = response.headers['set-cookie']?.join(';') || '';
    expect(cookies).toContain('facebook_auth_csrf=');
    expect(cookies).toContain('HttpOnly');
  });

  it('exposes diagnostics for verifying the Facebook App ID and redirect URI configuration', async () => {
    const { app } = buildAuthApp();

    const response = await request(app).get('/api/auth/facebook/diagnostics').expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      facebookConfigured: true,
      facebookAppId: 'test-facebook-app-id',
      facebookLoginUri: 'https://event-flow.co.uk/api/auth/callback/facebook',
      expectedRedirectUri: 'https://event-flow.co.uk/api/auth/callback/facebook',
    });
  });

  it('redirects to auth with the reported reason when Facebook denies the request', async () => {
    const { app } = buildAuthApp();

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .query({ error: 'access_denied', error_reason: 'user_denied' })
      .expect(303);

    expect(response.headers.location).toBe('/auth?facebook=error&reason=user_denied');
  });

  it('rejects a callback when the CSRF cookie is missing', async () => {
    const { app, inserted } = buildAuthApp();
    const state = encodeState({ csrf: 'csrf-abc' });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?facebook=error&reason=facebook_csrf');
    expect(inserted).toHaveLength(0);
  });

  it('rejects a callback when the state csrf does not match the cookie', async () => {
    const { app, inserted } = buildAuthApp();
    const state = encodeState({ csrf: 'csrf-abc' });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=different-value'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?facebook=error&reason=facebook_csrf');
    expect(inserted).toHaveLength(0);
  });

  it('rejects a callback with no authorization code after a valid CSRF check', async () => {
    const { app } = buildAuthApp();
    const state = encodeState({ csrf: 'csrf-abc' });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?facebook=error&reason=missing_code');
  });

  it('creates a user, sets the app auth cookie, and redirects for a valid callback', async () => {
    const { app, inserted } = buildAuthApp();
    const state = encodeState({
      csrf: 'csrf-abc',
      returnTo: '/dashboard/customer?from=test',
      plan: 'starter',
    });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/customer?from=test&plan=starter');
    expect(response.headers['set-cookie']?.join(';')).toContain('token=');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      email: 'new-user@example.com',
      facebookSub: 'fb-sub-123',
      verified: true,
      authProvider: 'facebook',
      signupMethod: 'facebook',
      verificationMethod: 'facebook_verified_email',
      verifiedBy: { type: 'facebook' },
      emailDeliveryStatus: 'not_required',
      role: 'customer',
    });
  });

  it('creates supplier accounts from Facebook redirect signup state', async () => {
    const { app, inserted, insertedSuppliers } = buildAuthApp();
    const state = encodeState({
      csrf: 'csrf-abc',
      context: 'signup',
      role: 'supplier',
      returnTo: '/dashboard/supplier',
      location: 'Wales',
      company: 'EventFlow Test Events',
    });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/supplier');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      email: 'new-user@example.com',
      role: 'supplier',
      location: 'Wales',
      company: 'EventFlow Test Events',
    });
    expect(insertedSuppliers).toHaveLength(1);
    expect(insertedSuppliers[0]).toMatchObject({
      ownerUserId: inserted[0].id,
      email: 'new-user@example.com',
      name: 'EventFlow Test Events',
      location: 'Wales',
    });
  });

  it('rolls back the new user when supplier profile provisioning fails', async () => {
    const { app, inserted, insertedSuppliers, deleted } = buildAuthApp({
      supplierInsertFails: true,
    });
    const state = encodeState({
      csrf: 'csrf-abc',
      context: 'signup',
      role: 'supplier',
      location: 'Wales',
      company: 'EventFlow Test Events',
    });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?facebook=error&reason=facebook_500');
    expect(insertedSuppliers).toHaveLength(0);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toEqual({ id: inserted[0].id });
  });

  it('rejects supplier Facebook redirect signup state without supplier essentials', async () => {
    const { app, inserted } = buildAuthApp();
    const state = encodeState({ csrf: 'csrf-abc', context: 'signup', role: 'supplier' });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?facebook=error&reason=facebook_400');
    expect(inserted).toHaveLength(0);
  });

  it('links an existing authoritative-email account instead of creating a duplicate', async () => {
    const existingCustomer = {
      id: 'usr_existing',
      email: 'new-user@example.com',
      role: 'customer',
      verified: true,
      authProviderIds: {},
    };
    const { app, inserted, updates } = buildAuthApp({ users: [existingCustomer] });
    const state = encodeState({ csrf: 'csrf-abc' });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/customer');
    expect(inserted).toHaveLength(0);
    expect(updates.some(entry => entry.update?.$set?.facebookSub === 'fb-sub-123')).toBe(true);
  });

  it('rejects a different Facebook account already linked to another EventFlow user', async () => {
    const linkedToSomeoneElse = {
      id: 'usr_other',
      email: 'someone-else@example.com',
      role: 'customer',
      verified: true,
      facebookSub: 'fb-sub-123',
      authProviderIds: { facebook: 'fb-sub-123' },
    };
    const { app, inserted } = buildAuthApp({ users: [linkedToSomeoneElse] });
    const state = encodeState({ csrf: 'csrf-abc' });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?facebook=error&reason=facebook_409');
    expect(inserted).toHaveLength(0);
  });

  it('sends admins to /admin when the redirect state requests it', async () => {
    const existingAdmin = {
      id: 'usr_admin',
      email: 'new-user@example.com',
      role: 'admin',
      verified: true,
      facebookSub: 'fb-sub-123',
      authProviderIds: { facebook: 'fb-sub-123' },
    };
    const { app } = buildAuthApp({ users: [existingAdmin] });
    const state = encodeState({ csrf: 'csrf-abc', returnTo: '/admin' });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/admin');
  });

  it('redirects to auth for 2FA-enabled accounts instead of completing login', async () => {
    const existingUser = {
      id: 'usr_2fa',
      email: 'new-user@example.com',
      role: 'customer',
      verified: true,
      twoFactorEnabled: true,
      facebookSub: 'fb-sub-123',
      authProviderIds: { facebook: 'fb-sub-123' },
    };
    const { app } = buildAuthApp({ users: [existingUser] });
    const state = encodeState({ csrf: 'csrf-abc' });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?facebook=2fa_required');
  });

  it('surfaces a failed account save instead of silently losing the new user', async () => {
    const { app } = buildAuthApp({ insertOneResult: false });
    const state = encodeState({ csrf: 'csrf-abc' });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?facebook=error&reason=facebook_500');
  });

  it('blocks new Facebook signups while registration is disabled', async () => {
    const { app, inserted } = buildAuthApp({ features: { registration: false } });
    const state = encodeState({ csrf: 'csrf-abc' });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?facebook=error&reason=facebook_503');
    expect(inserted).toHaveLength(0);
  });

  it('blocks new supplier Facebook signups while supplier applications are disabled', async () => {
    const { app, inserted } = buildAuthApp({ features: { supplierApplications: false } });
    const state = encodeState({
      csrf: 'csrf-abc',
      context: 'signup',
      role: 'supplier',
      location: 'Wales',
      company: 'EventFlow Test Events',
    });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?facebook=error&reason=facebook_503');
    expect(inserted).toHaveLength(0);
  });

  it('ignores unsafe redirect state and falls back to the role dashboard', async () => {
    const { app } = buildAuthApp();
    const state = encodeState({
      csrf: 'csrf-abc',
      returnTo: 'https://evil.example/path',
      plan: 'pro',
    });

    const response = await request(app)
      .get('/api/v1/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/customer?plan=pro');
  });

  it('reports Facebook verification failures with a mapped error redirect, including a missing email', async () => {
    const err = new Error(
      'Facebook did not share an email address for this account. Please allow email access or use another sign-in method.'
    );
    err.statusCode = 403;
    const { app } = buildAuthApp({ facebookError: err });
    const state = encodeState({ csrf: 'csrf-abc' });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?facebook=error&reason=facebook_403');
  });

  it('records signup attribution and referral fields for a new supplier signup', async () => {
    const { app, inserted } = buildAuthApp();
    const state = encodeState({
      csrf: 'csrf-abc',
      context: 'signup',
      role: 'supplier',
      location: 'Wales',
      company: 'EventFlow Test Events',
      website: 'https://example.com',
      ref: 'partner-code-123',
      analyticsSessionId: 'session-abc-123',
      attribution: {
        attribution_available: true,
        first_channel: 'organic',
      },
    });

    const response = await request(app)
      .get('/api/auth/callback/facebook')
      .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
      .query({ code: 'auth-code', state })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/supplier');
    const userRecord = inserted.find(doc => doc.email === 'new-user@example.com');
    expect(userRecord).toMatchObject({ website: 'https://example.com', role: 'supplier' });
    const analyticsEvent = inserted.find(doc => doc.event === 'registration_completed');
    expect(analyticsEvent).toMatchObject({
      properties: { signup_method: 'facebook', first_channel: 'organic' },
    });
  });

  it('awards the founder badge to a new Facebook signup within the launch window', async () => {
    process.env.FOUNDER_LAUNCH_TS = new Date().toISOString();
    try {
      const { app, inserted } = buildAuthApp();
      const state = encodeState({ csrf: 'csrf-abc', context: 'signin' });

      await request(app)
        .get('/api/auth/callback/facebook')
        .set('Cookie', ['facebook_auth_csrf=csrf-abc'])
        .query({ code: 'auth-code', state })
        .expect(303);

      const userRecord = inserted.find(doc => doc.email === 'new-user@example.com');
      expect(userRecord.badges).toEqual(['founder']);
    } finally {
      delete process.env.FOUNDER_LAUNCH_TS;
    }
  });
});
