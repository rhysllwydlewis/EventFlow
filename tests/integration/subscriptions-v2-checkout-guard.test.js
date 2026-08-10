/**
 * Route-level tests for the double-checkout guard on
 * POST /create-checkout-session — Stripe Checkout has no knowledge of an
 * existing subscription, so without a server-side check an already-paying
 * subscriber could create a second, independently-billed Stripe
 * subscription (e.g. via a stale /pricing tab or a direct API call).
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
  getSubscriptionByUserId: jest.fn(),
  getSubscription: jest.fn(),
  updateSubscription: jest.fn(async () => ({})),
  isLiveEntitlement: jest.fn(sub => {
    if (!sub) {
      return false;
    }
    if (sub.status !== 'active' && sub.status !== 'trialing') {
      return false;
    }
    if (sub.plan === 'free') {
      return true;
    }
    return !sub.currentPeriodEnd || new Date(sub.currentPeriodEnd) > new Date();
  }),
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

describe('POST /create-checkout-session — existing-subscriber guard', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro_month';
    process.env.STRIPE_PRO_PLUS_PRICE_ID = 'price_pro_plus_month';
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_1',
      url: 'https://checkout.stripe.com/cs_1',
    });
  });

  test('rejects checkout for a user with a live paid subscription', async () => {
    mockSubscriptionService.getSubscriptionByUserId.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
    });

    const app = buildApp({ id: 'user_1' });
    const res = await request(app)
      .post('/api/v2/subscriptions/create-checkout-session')
      .send({ planId: 'pro_plus' })
      .expect(400);

    expect(res.body.code).toBe('SUBSCRIPTION_ALREADY_EXISTS');
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test('allows checkout for a user with no subscription record', async () => {
    mockSubscriptionService.getSubscriptionByUserId.mockResolvedValue(null);

    const app = buildApp({ id: 'user_1' });
    const res = await request(app)
      .post('/api/v2/subscriptions/create-checkout-session')
      .send({ planId: 'pro' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  test('allows checkout for a user whose subscription downgraded to free', async () => {
    // handleSubscriptionDeleted applies a pending downgrade-to-free as
    // status: 'active', plan: 'free' — not status: 'canceled'. That user has
    // no live paid subscription and must be able to check out again.
    mockSubscriptionService.getSubscriptionByUserId.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      plan: 'free',
      status: 'active',
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
    });

    const app = buildApp({ id: 'user_1' });
    const res = await request(app)
      .post('/api/v2/subscriptions/create-checkout-session')
      .send({ planId: 'pro' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  test('allows checkout for a user whose prior subscription is fully canceled', async () => {
    mockSubscriptionService.getSubscriptionByUserId.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      plan: 'pro',
      status: 'canceled',
    });

    const app = buildApp({ id: 'user_1' });
    const res = await request(app)
      .post('/api/v2/subscriptions/create-checkout-session')
      .send({ planId: 'pro' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
});
