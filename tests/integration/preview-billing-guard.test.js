/**
 * A Railway PR preview must never talk to live Stripe. These tests load the real Stripe wiring
 * (config/stripe.js and the subscriptions-v2 router) with a live key and a preview environment name
 * and check Stripe is never constructed and billing answers with a clear message; and that the same
 * key is still used in production and for odd environment names.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

const mockStripeFactory = jest.fn(() => ({
  checkout: { sessions: { create: jest.fn() } },
  customers: { create: jest.fn(), retrieve: jest.fn() },
}));

jest.mock('stripe', () => mockStripeFactory);
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => next(),
  roleRequired: () => (_req, _res, next) => next(),
}));
jest.mock('../../middleware/rateLimits', () => ({ writeLimiter: (_req, _res, next) => next() }));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
jest.mock('../../utils/auditTrail', () => ({ createAuditLog: jest.fn(async () => {}) }));
jest.mock('../../db-unified', () => ({
  read: jest.fn(async () => []),
  find: jest.fn(async () => []),
  findOne: jest.fn(async () => null),
  insertOne: jest.fn(async () => ({})),
  updateOne: jest.fn(async () => ({})),
}));
jest.mock('../../services/paymentService', () => ({
  getOrCreateStripeCustomer: jest.fn(async () => ({ id: 'cus_1' })),
}));
jest.mock('../../services/subscriptionService', () => ({
  getSubscriptionByUserId: jest.fn(async () => null),
  getSubscription: jest.fn(async () => null),
  updateSubscription: jest.fn(async () => ({})),
  isLiveEntitlement: jest.fn(() => false),
  getUserFeatures: jest.fn(async () => ({ features: {} })),
  getAllPlans: jest.fn(() => []),
}));

const ENV_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_PRO_PRICE_ID',
  'STRIPE_PRO_PLUS_PRICE_ID',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_ENVIRONMENT',
];
let savedEnv;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  savedEnv = {};
  ENV_KEYS.forEach(key => {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  });
});

afterEach(() => {
  ENV_KEYS.forEach(key => {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  });
});

function appWithSubscriptions() {
  const router = require('../../routes/subscriptions-v2');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user_1' };
    next();
  });
  app.use('/api/v2/subscriptions', router);
  return app;
}

describe('config/stripe.js', () => {
  test('a live key in a PR preview leaves Stripe disabled', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'EventFlow-pr-1839';
    const stripeConfig = require('../../config/stripe');
    expect(stripeConfig.initializeStripe()).toBe(false);
    expect(stripeConfig.isStripeEnabled()).toBe(false);
    expect(stripeConfig.getStripeClient()).toBeNull();
    expect(mockStripeFactory).not.toHaveBeenCalled();
  });

  test('a test key in a PR preview is used', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'EventFlow-pr-1839';
    const stripeConfig = require('../../config/stripe');
    expect(stripeConfig.initializeStripe()).toBe(true);
    expect(mockStripeFactory).toHaveBeenCalledWith('sk_test_abc', expect.any(Object));
  });

  test.each([['production'], ['EventFlow-pr-12x'], ['eventflow-staging'], [undefined]])(
    'a live key is still used when the environment is %s',
    name => {
      process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
      if (name !== undefined) {
        process.env.RAILWAY_ENVIRONMENT_NAME = name;
      }
      const stripeConfig = require('../../config/stripe');
      expect(stripeConfig.initializeStripe()).toBe(true);
      expect(mockStripeFactory).toHaveBeenCalledWith('sk_live_abc', expect.any(Object));
    }
  );
});

describe('subscriptions-v2 checkout', () => {
  beforeEach(() => {
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro_month';
  });

  test('answers 503 "billing is disabled in preview environments" and never builds Stripe', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'EventFlow-pr-1839';
    const res = await request(appWithSubscriptions())
      .post('/api/v2/subscriptions/create-checkout-session')
      .send({ planId: 'pro' })
      .expect(503);
    expect(res.body.error).toBe('Billing is disabled in preview environments');
    expect(res.body.message).toMatch(/sk_test_/);
    expect(mockStripeFactory).not.toHaveBeenCalled();
  });

  test('a preview with a test key gets past the billing guard', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'EventFlow-pr-1839';
    const res = await request(appWithSubscriptions())
      .post('/api/v2/subscriptions/create-checkout-session')
      .send({ planId: 'pro' });
    expect(res.status).not.toBe(503);
    expect(mockStripeFactory).toHaveBeenCalledWith('sk_test_abc', expect.any(Object));
  });

  test('production with a live key builds Stripe exactly as before', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    const res = await request(appWithSubscriptions())
      .post('/api/v2/subscriptions/create-checkout-session')
      .send({ planId: 'pro' });
    expect(res.body.error).not.toBe('Billing is disabled in preview environments');
    expect(mockStripeFactory).toHaveBeenCalledWith('sk_live_abc', expect.any(Object));
  });

  test('without any key the usual "not available" answer is unchanged', async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = 'EventFlow-pr-1839';
    const res = await request(appWithSubscriptions())
      .post('/api/v2/subscriptions/create-checkout-session')
      .send({ planId: 'pro' })
      .expect(503);
    expect(res.body).toEqual({ error: 'Payment processing is not available' });
  });
});
