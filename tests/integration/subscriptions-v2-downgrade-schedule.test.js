/**
 * Route-level tests for POST /api/v2/subscriptions/:id/downgrade and
 * /:id/upgrade, covering the Subscription Schedule fix for paid-to-paid
 * downgrades.
 *
 * Before this fix, downgrading between two paid plans set
 * cancel_at_period_end on the Stripe subscription. Stripe fully cancels a
 * subscription flagged that way at renewal (rather than swapping its price),
 * so the webhook handler ended up granting the lower tier indefinitely with
 * no further Stripe billing — and once stripeSubscriptionId was cleared, a
 * later re-upgrade skipped Stripe entirely too, making the whole cycle free.
 * These tests assert the subscription is never cancelled for a paid-to-paid
 * downgrade, and that billing continues via a Subscription Schedule instead.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

const mockStripe = {
  subscriptions: {
    retrieve: jest.fn(),
    update: jest.fn(),
  },
  subscriptionSchedules: {
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn(),
    release: jest.fn(),
  },
};

jest.mock('stripe', () => jest.fn(() => mockStripe));

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => next(),
  roleRequired: () => (_req, _res, next) => next(),
}));
jest.mock('../../middleware/rateLimits', () => ({ writeLimiter: (_req, _res, next) => next() }));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
jest.mock('../../services/paymentService', () => ({}));
jest.mock('../../utils/auditTrail', () => ({ createAuditLog: jest.fn(async () => {}) }));
jest.mock('../../db-unified', () => ({
  read: jest.fn(async () => []),
  find: jest.fn(async () => []),
  findOne: jest.fn(async () => null),
  insertOne: jest.fn(async () => ({})),
  updateOne: jest.fn(async () => ({})),
}));

const mockSubscriptionService = {
  getSubscription: jest.fn(),
  getSubscriptionByUserId: jest.fn(async () => null),
  updateSubscription: jest.fn(async () => ({})),
  downgradeSubscription: jest.fn(async (id, plan) => ({ id, plan })),
  upgradeSubscription: jest.fn(async (id, plan) => ({ id, plan })),
  isLiveEntitlement: jest.fn(() => true),
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

describe('POST /:id/downgrade — paid-to-paid uses a Subscription Schedule, not cancellation', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro_monthly';
  });

  test('schedules the lower price at renewal without cancelling the subscription', async () => {
    mockSubscriptionService.getSubscription.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      plan: 'pro_plus',
      stripeSubscriptionId: 'sub_stripe_1',
      billingInterval: 'month',
      metadata: {},
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_stripe_1',
      items: { data: [{ price: { id: 'price_pro_plus' }, quantity: 1 }] },
    });
    mockStripe.subscriptionSchedules.create.mockResolvedValue({
      id: 'sched_1',
      phases: [{ start_date: 1000, end_date: 2000 }],
    });
    mockStripe.subscriptionSchedules.update.mockResolvedValue({ id: 'sched_1' });

    const app = buildApp({ id: 'user_1', email: 'a@b.com' });
    await request(app)
      .post('/api/v2/subscriptions/sub_1/downgrade')
      .send({ planId: 'pro' })
      .expect(200);

    // The subscription itself must never be cancelled for a paid-to-paid downgrade.
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();

    expect(mockStripe.subscriptionSchedules.create).toHaveBeenCalledWith({
      from_subscription: 'sub_stripe_1',
    });
    expect(mockStripe.subscriptionSchedules.update).toHaveBeenCalledWith(
      'sched_1',
      expect.objectContaining({
        end_behavior: 'release',
        phases: [
          expect.objectContaining({
            items: [{ price: 'price_pro_plus', quantity: 1 }],
            start_date: 1000,
            end_date: 2000,
          }),
          expect.objectContaining({
            items: [{ price: 'price_pro_monthly', quantity: 1 }],
          }),
        ],
      }),
      expect.anything()
    );

    // The schedule ID must be persisted so a later upgrade can release it.
    expect(mockSubscriptionService.updateSubscription).toHaveBeenCalledWith(
      'sub_1',
      expect.objectContaining({
        metadata: expect.objectContaining({ stripeScheduleId: 'sched_1' }),
      })
    );
    expect(mockSubscriptionService.downgradeSubscription).toHaveBeenCalledWith('sub_1', 'pro', {
      skipStripe: true,
    });
  });

  test('reuses an existing schedule instead of creating a duplicate on a second downgrade call', async () => {
    mockSubscriptionService.getSubscription.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      plan: 'pro_plus',
      stripeSubscriptionId: 'sub_stripe_1',
      billingInterval: 'month',
      metadata: { stripeScheduleId: 'sched_existing' },
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_stripe_1',
      items: { data: [{ price: { id: 'price_pro_plus' }, quantity: 1 }] },
    });
    mockStripe.subscriptionSchedules.retrieve.mockResolvedValue({
      id: 'sched_existing',
      phases: [{ start_date: 1000, end_date: 2000 }],
    });
    mockStripe.subscriptionSchedules.update.mockResolvedValue({ id: 'sched_existing' });

    const app = buildApp({ id: 'user_1', email: 'a@b.com' });
    await request(app)
      .post('/api/v2/subscriptions/sub_1/downgrade')
      .send({ planId: 'pro' })
      .expect(200);

    expect(mockStripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mockStripe.subscriptionSchedules.retrieve).toHaveBeenCalledWith('sched_existing');
  });

  test('downgrade to free still cancels the Stripe subscription at period end', async () => {
    mockSubscriptionService.getSubscription.mockResolvedValue({
      id: 'sub_2',
      userId: 'user_1',
      plan: 'pro',
      stripeSubscriptionId: 'sub_stripe_2',
      billingInterval: 'month',
      metadata: {},
    });

    const app = buildApp({ id: 'user_1', email: 'a@b.com' });
    await request(app)
      .post('/api/v2/subscriptions/sub_2/downgrade')
      .send({ planId: 'free' })
      .expect(200);

    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_stripe_2',
      expect.objectContaining({ cancel_at_period_end: true }),
      expect.anything()
    );
    expect(mockStripe.subscriptionSchedules.create).not.toHaveBeenCalled();
  });

  test('releases an existing downgrade schedule before switching the target to free', async () => {
    // e.g. the customer scheduled pro_plus -> pro, then changed their mind
    // and downgraded to free instead, while the pro schedule was still
    // pending. The subscription is still schedule-managed at that point, so
    // cancel_at_period_end must not be set directly without releasing it
    // first.
    mockSubscriptionService.getSubscription.mockResolvedValue({
      id: 'sub_3',
      userId: 'user_1',
      plan: 'pro_plus',
      stripeSubscriptionId: 'sub_stripe_3',
      billingInterval: 'month',
      metadata: { stripeScheduleId: 'sched_pending' },
    });

    const app = buildApp({ id: 'user_1', email: 'a@b.com' });
    await request(app)
      .post('/api/v2/subscriptions/sub_3/downgrade')
      .send({ planId: 'free' })
      .expect(200);

    expect(mockStripe.subscriptionSchedules.release).toHaveBeenCalledWith('sched_pending');
    expect(mockSubscriptionService.updateSubscription).toHaveBeenCalledWith(
      'sub_3',
      expect.objectContaining({ metadata: expect.objectContaining({ stripeScheduleId: null }) })
    );
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_stripe_3',
      expect.objectContaining({ cancel_at_period_end: true }),
      expect.anything()
    );
  });

  test('returns 503 rather than scheduling with a missing Stripe price', async () => {
    delete process.env.STRIPE_PRO_PRICE_ID;
    mockSubscriptionService.getSubscription.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      plan: 'pro_plus',
      stripeSubscriptionId: 'sub_stripe_1',
      billingInterval: 'month',
      metadata: {},
    });

    const app = buildApp({ id: 'user_1', email: 'a@b.com' });
    await request(app)
      .post('/api/v2/subscriptions/sub_1/downgrade')
      .send({ planId: 'pro' })
      .expect(503);

    expect(mockStripe.subscriptionSchedules.create).not.toHaveBeenCalled();
  });
});

describe('POST /:id/upgrade — releases a pending downgrade schedule first', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    process.env.STRIPE_PRO_PLUS_PRICE_ID = 'price_pro_plus_monthly';
  });

  test('releases the schedule and clears stripeScheduleId before swapping price', async () => {
    mockSubscriptionService.getSubscription.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      plan: 'pro',
      stripeSubscriptionId: 'sub_stripe_1',
      billingInterval: 'month',
      metadata: { stripeScheduleId: 'sched_pending' },
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_stripe_1',
      items: { data: [{ id: 'si_1', price: { id: 'price_pro' } }] },
    });

    const app = buildApp({ id: 'user_1', email: 'a@b.com' });
    await request(app)
      .post('/api/v2/subscriptions/sub_1/upgrade')
      .send({ planId: 'pro_plus' })
      .expect(200);

    expect(mockStripe.subscriptionSchedules.release).toHaveBeenCalledWith('sched_pending');
    expect(mockSubscriptionService.updateSubscription).toHaveBeenCalledWith(
      'sub_1',
      expect.objectContaining({ metadata: expect.objectContaining({ stripeScheduleId: null }) })
    );
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_stripe_1',
      expect.objectContaining({ items: [{ id: 'si_1', price: 'price_pro_plus_monthly' }] }),
      expect.anything()
    );
  });

  test('does nothing schedule-related when there is no pending downgrade', async () => {
    mockSubscriptionService.getSubscription.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      plan: 'pro',
      stripeSubscriptionId: 'sub_stripe_1',
      billingInterval: 'month',
      metadata: {},
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_stripe_1',
      items: { data: [{ id: 'si_1', price: { id: 'price_pro' } }] },
    });

    const app = buildApp({ id: 'user_1', email: 'a@b.com' });
    await request(app)
      .post('/api/v2/subscriptions/sub_1/upgrade')
      .send({ planId: 'pro_plus' })
      .expect(200);

    expect(mockStripe.subscriptionSchedules.release).not.toHaveBeenCalled();
  });
});
