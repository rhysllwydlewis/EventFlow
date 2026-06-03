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

function buildAuthApp({ googleProfile, googleError, users = [], includeGlobalCors = false } = {}) {
  jest.resetModules();
  process.env.JWT_SECRET = 'test-secret-key-for-google-route-tests-minimum-32';
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
      // Handle all query shapes used by the Google auth route
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
          users.find(u =>
            query.$or.some(cond =>
              Object.keys(cond).every(k => {
                // Handle dotted keys like 'authProviderIds.google'
                const val = k.includes('.') ? k.split('.').reduce((o, s) => o?.[s], u) : u[k];
                return val === cond[k];
              })
            )
          ) || null
        );
      }
      return null;
    }),
  }));

  jest.doMock('../../services/googleAuth.service', () => ({
    getGoogleClientIds: jest.fn(() => ['test-client-id.apps.googleusercontent.com']),
    getGoogleClientId: jest.fn(() => 'test-client-id.apps.googleusercontent.com'),
    verifyGoogleCredential: jest.fn(async () => {
      if (googleError) {
        throw googleError;
      }
      return (
        googleProfile || {
          sub: 'google-sub-123',
          email: 'new-user@gmail.com',
          email_verified: true,
          emailAuthoritative: true,
          name: 'New Google User',
          given_name: 'New',
          family_name: 'User',
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
  if (includeGlobalCors) {
    const { configureCORSMiddleware } = require('../../middleware/security');
    app.use(configureCORSMiddleware(true));
  }
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/auth', require('../../routes/auth'));
  app.use('/api/auth', require('../../routes/auth'));
  app.use('/api/v1/auth', require('../../routes/google-redirect-auth'));
  app.use('/api/auth', require('../../routes/google-redirect-auth'));
  return { app, inserted, updates };
}

describe('Google auth route', () => {
  afterEach(() => {
    jest.dontMock('../../db-unified');
    jest.dontMock('../../services/googleAuth.service');
    jest.dontMock('../../middleware/features');
    jest.restoreAllMocks();
    delete process.env.BASE_URL;
  });

  it('redirects manual GETs on the SIWG callback back to the auth page', async () => {
    const { app } = buildAuthApp();

    const response = await request(app).get('/api/auth/callback/google').expect(303);

    expect(response.headers.location).toBe('/auth?google=callback_requires_post');
  });

  it('rejects form-posted SIWG callbacks when the Google CSRF token is missing', async () => {
    const { app, inserted } = buildAuthApp();

    const response = await request(app)
      .post('/api/auth/callback/google')
      .type('form')
      .send({ credential: 'valid-google-id-token' })
      .expect(303);

    expect(response.headers.location).toBe('/auth?google=error&reason=google_csrf');
    expect(inserted).toHaveLength(0);
  });

  it('creates a user, sets the app auth cookie, and redirects for a valid SIWG callback', async () => {
    const { app, inserted } = buildAuthApp();
    const state = encodeState({ returnTo: '/dashboard/customer?from=test', plan: 'starter' });

    const response = await request(app)
      .post('/api/auth/callback/google')
      .set('Cookie', ['g_csrf_token=csrf-token-123'])
      .type('form')
      .send({
        credential: 'valid-google-id-token',
        g_csrf_token: 'csrf-token-123',
        state,
      })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/customer?from=test&plan=starter');
    expect(response.headers['set-cookie']?.join(';')).toContain('token=');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      email: 'new-user@gmail.com',
      googleSub: 'google-sub-123',
      verified: true,
      authProvider: 'google',
      role: 'customer',
    });
  });

  it('creates supplier accounts from Google redirect signup state', async () => {
    const { app, inserted } = buildAuthApp();
    const state = encodeState({
      context: 'signup',
      role: 'supplier',
      returnTo: '/dashboard/supplier',
      location: 'Wales',
      postcode: 'CF39 8AA',
      company: 'EventFlow Test Events',
      jobTitle: 'Owner',
      website: 'example.com',
      socials: {
        instagram: 'instagram.com/eventflowtest',
        facebook: 'facebook.com/eventflowtest',
      },
    });

    const response = await request(app)
      .post('/api/auth/callback/google')
      .set('Cookie', ['g_csrf_token=csrf-token-123'])
      .type('form')
      .send({
        credential: 'valid-google-id-token',
        g_csrf_token: 'csrf-token-123',
        state,
      })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/supplier');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      email: 'new-user@gmail.com',
      role: 'supplier',
      location: 'Wales',
      postcode: 'CF39 8AA',
      company: 'EventFlow Test Events',
      jobTitle: 'Owner',
      website: 'example.com',
      socials: {
        instagram: 'instagram.com/eventflowtest',
        facebook: 'facebook.com/eventflowtest',
      },
    });
  });

  it('rejects supplier Google redirect signup state without supplier essentials', async () => {
    const { app, inserted } = buildAuthApp();
    const state = encodeState({ context: 'signup', role: 'supplier', location: 'Wales' });

    const response = await request(app)
      .post('/api/auth/callback/google')
      .set('Cookie', ['g_csrf_token=csrf-token-123'])
      .type('form')
      .send({
        credential: 'valid-google-id-token',
        g_csrf_token: 'csrf-token-123',
        state,
      })
      .expect(303);

    expect(response.headers.location).toBe('/auth?google=error&reason=google_400');
    expect(inserted).toHaveLength(0);
  });

  it('does not promote existing customer accounts using supplier Google state', async () => {
    const existingCustomer = {
      id: 'usr_existing',
      email: 'new-user@gmail.com',
      role: 'customer',
      verified: true,
      authProviderIds: {},
    };
    const { app, inserted, updates } = buildAuthApp({ users: [existingCustomer] });
    const state = encodeState({
      context: 'signup',
      role: 'supplier',
      location: 'Wales',
      company: 'Should Not Promote Ltd',
    });

    const response = await request(app)
      .post('/api/auth/callback/google')
      .set('Cookie', ['g_csrf_token=csrf-token-123'])
      .type('form')
      .send({
        credential: 'valid-google-id-token',
        g_csrf_token: 'csrf-token-123',
        state,
      })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/customer');
    expect(inserted).toHaveLength(0);
    expect(updates.some(entry => entry.update?.$set?.role === 'supplier')).toBe(false);
  });

  it('allows the SIWG callback through production global CORS when BASE_URL is internal', async () => {
    process.env.BASE_URL = 'https://eventflow-production.up.railway.app';
    const { app, inserted } = buildAuthApp({ includeGlobalCors: true });

    const response = await request(app)
      .post('/api/auth/callback/google')
      .set('Origin', 'https://event-flow.co.uk')
      .set('Cookie', ['g_csrf_token=csrf-token-123'])
      .type('form')
      .send({
        credential: 'valid-google-id-token',
        g_csrf_token: 'csrf-token-123',
      })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/customer');
    expect(response.headers['access-control-allow-origin']).toBe('https://event-flow.co.uk');
    expect(response.headers['set-cookie']?.join(';')).toContain('token=');
    expect(inserted).toHaveLength(1);
  });

  it('allows opaque browser origins on the SIWG form-post callback', async () => {
    process.env.BASE_URL = 'https://eventflow-production.up.railway.app';
    const { app, inserted } = buildAuthApp({ includeGlobalCors: true });

    const response = await request(app)
      .post('/api/auth/callback/google')
      .set('Origin', 'null')
      .set('Cookie', ['g_csrf_token=csrf-token-123'])
      .type('form')
      .send({
        credential: 'valid-google-id-token',
        g_csrf_token: 'csrf-token-123',
      })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/customer');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['set-cookie']?.join(';')).toContain('token=');
    expect(inserted).toHaveLength(1);
  });

  it('ignores unsafe redirect state and falls back to the role dashboard', async () => {
    const { app } = buildAuthApp();
    const state = encodeState({ returnTo: 'https://evil.example/path', plan: 'pro' });

    const response = await request(app)
      .post('/api/v1/auth/callback/google')
      .set('Cookie', ['g_csrf_token=csrf-token-123'])
      .type('form')
      .send({
        credential: 'valid-google-id-token',
        g_csrf_token: 'csrf-token-123',
        state,
      })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard/customer?plan=pro');
  });

  it('creates a user and sets the app auth cookie for a valid GIS JSON credential', async () => {
    const { app, inserted } = buildAuthApp();

    const response = await request(app)
      .post('/api/v1/auth/google')
      .send({ credential: 'valid-google-id-token', remember: true })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      user: { email: 'new-user@gmail.com', role: 'customer' },
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      email: 'new-user@gmail.com',
      googleSub: 'google-sub-123',
      verified: true,
      authProvider: 'google',
    });
    expect(response.headers['set-cookie']?.join(';')).toContain('token=');
  });

  it('rejects invalid GIS credentials clearly', async () => {
    const err = new Error('Invalid Google credential');
    err.statusCode = 401;
    err.expose = true;
    const { app } = buildAuthApp({ googleError: err });

    const response = await request(app)
      .post('/api/v1/auth/google')
      .send({ credential: 'bad-token' })
      .expect(401);

    expect(response.body).toEqual({ error: 'Invalid Google credential' });
  });

  it('reports missing Google configuration from the verifier without creating a session', async () => {
    const err = new Error('Google sign-in is not configured');
    err.statusCode = 503;
    err.expose = true;
    const { app, inserted } = buildAuthApp({ googleError: err });

    const response = await request(app)
      .post('/api/v1/auth/google')
      .send({ credential: 'valid-looking-token' })
      .expect(503);

    expect(response.body).toEqual({ error: 'Google sign-in is not configured' });
    expect(inserted).toHaveLength(0);
  });
});
