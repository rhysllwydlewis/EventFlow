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

function buildAuthApp({ appleProfile, appleError, users = [] } = {}) {
  jest.resetModules();
  process.env.JWT_SECRET = 'test-secret-key-for-apple-route-tests-minimum-32';
  process.env.NODE_ENV = 'test';

  const inserted = [];
  const updates = [];

  jest.doMock('../../db-unified', () => ({
    read: jest.fn(async collection => (collection === 'users' ? users : [])),
    insertOne: jest.fn(async (_collection, doc) => {
      inserted.push(doc);
      return true;
    }),
    updateOne: jest.fn(async (_collection, filter, update) => {
      updates.push({ filter, update });
      return true;
    }),
    findOne: jest.fn(async (_collection, query) => {
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

  jest.doMock('../../services/appleAuth.service', () => ({
    getAppleClientIds: jest.fn(() => ['uk.co.event-flow.web']),
    getAppleClientId: jest.fn(() => 'uk.co.event-flow.web'),
    verifyAppleCredential: jest.fn(async () => {
      if (appleError) {
        throw appleError;
      }
      return (
        appleProfile || {
          sub: 'apple-sub-123',
          email: 'new-user@privaterelay.appleid.com',
          emailVerified: true,
          isPrivateEmail: true,
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
    })),
  }));

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/auth', require('../../routes/apple-redirect-auth'));
  app.use('/api/auth', require('../../routes/apple-redirect-auth'));
  return { app, inserted, updates };
}

describe('Apple auth route', () => {
  afterEach(() => {
    jest.dontMock('../../db-unified');
    jest.dontMock('../../services/appleAuth.service');
    jest.dontMock('../../middleware/features');
    jest.restoreAllMocks();
    delete process.env.BASE_URL;
  });

  it('redirects manual GETs on the SIWA callback back to the auth page', async () => {
    const { app } = buildAuthApp();

    const response = await request(app).get('/api/auth/callback/apple').expect(303);

    expect(response.headers.location).toBe('/auth?apple=callback_requires_post');
  });

  it('issues a nonce and sets a short-lived httpOnly cookie', async () => {
    const { app } = buildAuthApp();

    const response = await request(app).get('/api/auth/apple/nonce').expect(200);

    expect(response.body.ok).toBe(true);
    expect(typeof response.body.nonce).toBe('string');
    expect(response.body.nonce.length).toBeGreaterThan(10);
    const cookies = response.headers['set-cookie']?.join(';') || '';
    expect(cookies).toContain('apple_auth_nonce=');
    expect(cookies).toContain('HttpOnly');
  });

  it('rejects form-posted SIWA callbacks when the Apple nonce cookie is missing', async () => {
    const { app, inserted } = buildAuthApp();
    const state = encodeState({ csrf: 'nonce-abc' });

    const response = await request(app)
      .post('/api/auth/callback/apple')
      .type('form')
      .send({ id_token: 'valid-apple-id-token', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?apple=error&reason=apple_csrf');
    expect(inserted).toHaveLength(0);
  });

  it('rejects form-posted SIWA callbacks when the state csrf does not match the cookie', async () => {
    const { app, inserted } = buildAuthApp();
    const state = encodeState({ csrf: 'nonce-abc' });

    const response = await request(app)
      .post('/api/auth/callback/apple')
      .set('Cookie', ['apple_auth_nonce=different-nonce'])
      .type('form')
      .send({ id_token: 'valid-apple-id-token', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?apple=error&reason=apple_csrf');
    expect(inserted).toHaveLength(0);
  });

  it('redirects to auth with the Apple-reported error when Apple denies the request', async () => {
    const { app } = buildAuthApp();

    const response = await request(app)
      .post('/api/auth/callback/apple')
      .type('form')
      .send({ error: 'user_cancelled_authorize' })
      .expect(303);

    expect(response.headers.location).toBe('/auth?apple=error&reason=user_cancelled_authorize');
  });

  it('creates a user, sets the app auth cookie, and redirects for a valid SIWA callback', async () => {
    const { app, inserted } = buildAuthApp();
    const state = encodeState({
      csrf: 'nonce-abc',
      returnTo: '/dashboard/customer?from=test',
      plan: 'starter',
    });

    const response = await request(app)
      .post('/api/auth/callback/apple')
      .set('Cookie', ['apple_auth_nonce=nonce-abc'])
      .type('form')
      .send({
        id_token: 'valid-apple-id-token',
        state,
        user: JSON.stringify({ name: { firstName: 'New', lastName: 'User' } }),
      })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/customer?from=test&plan=starter');
    expect(response.headers['set-cookie']?.join(';')).toContain('token=');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      email: 'new-user@privaterelay.appleid.com',
      appleSub: 'apple-sub-123',
      firstName: 'New',
      lastName: 'User',
      verified: true,
      authProvider: 'apple',
      signupMethod: 'apple',
      verificationMethod: 'apple_verified_email',
      verifiedBy: { type: 'apple' },
      emailDeliveryStatus: 'not_required',
      role: 'customer',
    });
  });

  it('creates supplier accounts from Apple redirect signup state', async () => {
    const { app, inserted } = buildAuthApp();
    const state = encodeState({
      csrf: 'nonce-abc',
      context: 'signup',
      role: 'supplier',
      returnTo: '/dashboard/supplier',
      location: 'Wales',
      company: 'EventFlow Test Events',
    });

    const response = await request(app)
      .post('/api/auth/callback/apple')
      .set('Cookie', ['apple_auth_nonce=nonce-abc'])
      .type('form')
      .send({ id_token: 'valid-apple-id-token', state })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/supplier');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      email: 'new-user@privaterelay.appleid.com',
      role: 'supplier',
      location: 'Wales',
      company: 'EventFlow Test Events',
    });
  });

  it('rejects supplier Apple redirect signup state without supplier essentials', async () => {
    const { app, inserted } = buildAuthApp();
    const state = encodeState({ csrf: 'nonce-abc', context: 'signup', role: 'supplier' });

    const response = await request(app)
      .post('/api/auth/callback/apple')
      .set('Cookie', ['apple_auth_nonce=nonce-abc'])
      .type('form')
      .send({ id_token: 'valid-apple-id-token', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?apple=error&reason=apple_400');
    expect(inserted).toHaveLength(0);
  });

  it('links an existing authoritative-email account instead of creating a duplicate', async () => {
    const existingCustomer = {
      id: 'usr_existing',
      email: 'new-user@privaterelay.appleid.com',
      role: 'customer',
      verified: true,
      authProviderIds: {},
    };
    const { app, inserted, updates } = buildAuthApp({ users: [existingCustomer] });
    const state = encodeState({ csrf: 'nonce-abc' });

    const response = await request(app)
      .post('/api/auth/callback/apple')
      .set('Cookie', ['apple_auth_nonce=nonce-abc'])
      .type('form')
      .send({ id_token: 'valid-apple-id-token', state })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/customer');
    expect(inserted).toHaveLength(0);
    expect(updates.some(entry => entry.update?.$set?.appleSub === 'apple-sub-123')).toBe(true);
  });

  it('ignores unsafe redirect state and falls back to the role dashboard', async () => {
    const { app } = buildAuthApp();
    const state = encodeState({
      csrf: 'nonce-abc',
      returnTo: 'https://evil.example/path',
      plan: 'pro',
    });

    const response = await request(app)
      .post('/api/v1/auth/callback/apple')
      .set('Cookie', ['apple_auth_nonce=nonce-abc'])
      .type('form')
      .send({ id_token: 'valid-apple-id-token', state })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/customer?plan=pro');
  });

  it('reports Apple verification failures with a mapped error redirect', async () => {
    const err = new Error('Invalid Apple credential');
    err.statusCode = 401;
    const { app } = buildAuthApp({ appleError: err });
    const state = encodeState({ csrf: 'nonce-abc' });

    const response = await request(app)
      .post('/api/auth/callback/apple')
      .set('Cookie', ['apple_auth_nonce=nonce-abc'])
      .type('form')
      .send({ id_token: 'bad-token', state })
      .expect(303);

    expect(response.headers.location).toBe('/auth?apple=error&reason=apple_401');
  });
});
