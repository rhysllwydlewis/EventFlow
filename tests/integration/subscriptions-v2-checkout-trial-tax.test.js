/**
 * Route-level tests for the trial and automatic-tax plumbing on
 * POST /create-checkout-session (routes/subscriptions-v2.js).
 *
 * Both STRIPE_SUBSCRIPTION_TRIAL_DAYS and STRIPE_AUTOMATIC_TAX_ENABLED
 * default to off — these tests confirm the off state changes nothing, and
 * that the on state does what it's supposed to (trial for first-time
 * subscribers only; automatic_tax passed straight through to Stripe).
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

const mockStripe = {
  checkout: { sessions: { create: jest.fn() } },
  customers: { create: jest.fn(), retrieve: jest.fn() },
};

jest.mock('stripe', () => jest.fn(() => mockStripe));
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

const mockPaymentService = {
  getOrCreateStripeCustomer: jest.fn(async () => ({ id: 'cus_1' })),
};
jest.mock('../../services/paymentService', () => mockPaymentService);

const mockSubscriptionService = {
  getSubscriptionByUserId: jest.fn(async () => null),
  isLiveEntitlement: jest.fn(() => false),
  listSubscriptions: jest.fn(async () => []),
  getUserFeatures: jest.fn(async () => ({ features: {} })),
  getAllPlans: jest.fn(() => []),
};
jest.mock('../../services/subscriptionService', () => mockSubscriptionService);

function buildApp(user) {
  const router = require('../../routes/subscriptions-v2');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/v2/subscriptions', router);
  return app;
}

const ORIGINAL_ENV = { ...process.env };

describe('POST /create-checkout-session — trial and automatic tax', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro_month';
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_1',
      url: 'https://checkout.stripe.com/cs_1',
    });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('passes no trial_period_days and no automatic_tax when both are off (default)', async () => {
    const app = buildApp({ id: 'user_1' });
    await request(app)
      .post('/api/v2/subscriptions/create-checkout-session')
      .send({ planId: 'pro' })
      .expect(200);

    const sessionArg = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(sessionArg.subscription_data.trial_period_days).toBeUndefined();
    expect(sessionArg.automatic_tax).toBeUndefined();
  });

  it('applies the trial for a first-time subscriber when STRIPE_SUBSCRIPTION_TRIAL_DAYS is set', async () => {
    process.env.STRIPE_SUBSCRIPTION_TRIAL_DAYS = '14';
    mockSubscriptionService.listSubscriptions.mockResolvedValue([]);

    const app = buildApp({ id: 'user_1' });
    await request(app)
      .post('/api/v2/subscriptions/create-checkout-session')
      .send({ planId: 'pro' })
      .expect(200);

    const sessionArg = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(sessionArg.subscription_data.trial_period_days).toBe(14);
  });

  it('does not grant a trial to a user who has had a subscription before, even a canceled one', async () => {
    process.env.STRIPE_SUBSCRIPTION_TRIAL_DAYS = '14';
    mockSubscriptionService.listSubscriptions.mockResolvedValue([
      { id: 'sub_old', userId: 'user_1', status: 'canceled' },
    ]);

    const app = buildApp({ id: 'user_1' });
    await request(app)
      .post('/api/v2/subscriptions/create-checkout-session')
      .send({ planId: 'pro' })
      .expect(200);

    const sessionArg = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(sessionArg.subscription_data.trial_period_days).toBeUndefined();
    expect(mockSubscriptionService.listSubscriptions).toHaveBeenCalledWith({ userId: 'user_1' });
  });

  it('passes automatic_tax through to Stripe when STRIPE_AUTOMATIC_TAX_ENABLED is true', async () => {
    process.env.STRIPE_AUTOMATIC_TAX_ENABLED = 'true';

    const app = buildApp({ id: 'user_1' });
    await request(app)
      .post('/api/v2/subscriptions/create-checkout-session')
      .send({ planId: 'pro' })
      .expect(200);

    const sessionArg = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(sessionArg.automatic_tax).toEqual({ enabled: true });
  });
});
