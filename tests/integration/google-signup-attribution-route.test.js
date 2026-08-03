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

function buildApp() {
  jest.resetModules();
  process.env.JWT_SECRET = 'test-secret-key-for-google-attribution-minimum-32';
  process.env.ANALYTICS_HASH_SALT = 'test-analytics-hash-salt';
  process.env.NODE_ENV = 'test';

  const inserted = [];
  const updates = [];

  jest.doMock('../../db-unified', () => ({
    read: jest.fn(async collection => (collection === 'users' ? [] : [])),
    insertOne: jest.fn(async (collection, document) => {
      inserted.push({ collection, document });
      return true;
    }),
    updateOne: jest.fn(async (collection, filter, update) => {
      updates.push({ collection, filter, update });
      return true;
    }),
    findOne: jest.fn(async () => null),
  }));

  jest.doMock('../../services/googleAuth.service', () => ({
    getGoogleClientIds: jest.fn(() => ['test-client-id.apps.googleusercontent.com']),
    getGoogleClientId: jest.fn(() => 'test-client-id.apps.googleusercontent.com'),
    verifyGoogleCredential: jest.fn(async () => ({
      sub: 'google-attribution-subject',
      email: 'attributed-user@gmail.com',
      email_verified: true,
      emailAuthoritative: true,
      name: 'Attributed User',
      given_name: 'Attributed',
      family_name: 'User',
    })),
  }));

  jest.doMock('../../middleware/features', () => ({
    featureRequired: () => (_req, _res, next) => next(),
    getFeatureFlags: jest.fn(async () => ({
      registration: true,
      supplierApplications: true,
    })),
  }));

  const app = express();
  app.use(cookieParser());
  app.use('/api/auth', require('../../routes/google-redirect-auth'));
  return { app, inserted, updates };
}

describe('Google signup attribution persistence', () => {
  afterEach(() => {
    jest.dontMock('../../db-unified');
    jest.dontMock('../../services/googleAuth.service');
    jest.dontMock('../../middleware/features');
    jest.restoreAllMocks();
    delete process.env.ANALYTICS_HASH_SALT;
  });

  it('stores one privacy-safe first-party conversion after creating a consented Google signup', async () => {
    const { app, inserted, updates } = buildApp();
    const state = encodeState({
      context: 'signup',
      role: 'customer',
      returnTo: '/dashboard/customer',
      analyticsSessionId: 'analytics-session-google-signup',
      attribution: {
        attribution_available: true,
        first_channel: 'organic_search',
        first_referrer_domain: 'google.com',
        first_landing_path: '/pricing',
        first_utm_source: 'google',
        first_utm_medium: 'organic',
        first_utm_campaign: 'summer-launch',
        last_channel: 'direct',
        last_referrer_domain: 'direct',
        ignored_private_value: 'must-not-be-stored',
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

    expect(response.headers.location).toBe('/dashboard/customer');
    expect(inserted).toHaveLength(2);

    const userInsert = inserted.find(entry => entry.collection === 'users');
    expect(userInsert.document).toMatchObject({
      email: 'attributed-user@gmail.com',
      signupMethod: 'google',
      role: 'customer',
    });

    const analyticsInsert = inserted.find(entry => entry.collection === 'behaviour_analytics_events');
    expect(analyticsInsert.document).toMatchObject({
      event: 'registration_completed',
      pagePath: '/pricing',
      referrerDomain: 'google.com',
      userRole: 'customer',
      properties: {
        attribution_available: true,
        conversionType: 'registration',
        signup_method: 'google',
        first_channel: 'organic_search',
        first_referrer_domain: 'google.com',
        first_landing_path: '/pricing',
        first_utm_source: 'google',
        first_utm_medium: 'organic',
        first_utm_campaign: 'summer-launch',
        last_channel: 'direct',
        last_referrer_domain: 'direct',
      },
    });
    expect(analyticsInsert.document.properties.ignored_private_value).toBeUndefined();
    expect(analyticsInsert.document.sessionIdHash).toBeTruthy();
    expect(analyticsInsert.document).not.toHaveProperty('sessionId');
    expect(updates.some(entry => entry.collection === 'users')).toBe(true);
  });
});
