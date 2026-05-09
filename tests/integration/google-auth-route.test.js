'use strict';

const express = require('express');
const request = require('supertest');

function buildAuthApp({ googleProfile, googleError, users = [] } = {}) {
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
  }));

  jest.doMock('../../services/googleAuth.service', () => ({
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

  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', require('../../routes/auth'));
  app.use('/api/auth', require('../../routes/auth'));
  return { app, inserted, updates };
}

describe('Google auth route', () => {
  afterEach(() => {
    jest.dontMock('../../db-unified');
    jest.dontMock('../../services/googleAuth.service');
    jest.restoreAllMocks();
  });

  it('returns a clear explanatory response for the unused GIS redirect callback', async () => {
    const { app } = buildAuthApp();

    const response = await request(app).get('/api/auth/callback/google').expect(400);

    expect(response.body).toMatchObject({
      error: 'Google OAuth redirect callback is not used by this app',
      flow: 'google_identity_services',
      loginUrl: '/auth',
    });
  });

  it('returns denied consent details on the compatibility callback route', async () => {
    const { app } = buildAuthApp();

    const response = await request(app)
      .get('/api/v1/auth/callback/google?error=access_denied')
      .expect(400);

    expect(response.body).toMatchObject({
      error: 'Google sign-in was not completed',
      message: 'access_denied',
      flow: 'google_identity_services',
    });
  });

  it('creates a user and sets the app auth cookie for a valid GIS credential', async () => {
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
