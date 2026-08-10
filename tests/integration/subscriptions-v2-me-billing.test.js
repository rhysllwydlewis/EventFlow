/**
 * Route-level tests for GET /:me (payment method summary) and
 * GET /upcoming-invoice — both added to back fields the dashboard
 * Subscription card already reads (paymentMethodBrand/paymentMethodLast4,
 * upcomingInvoice) but that the server never actually populated. The
 * dashboard's "Payment method" row silently never rendered and
 * /upcoming-invoice 404'd on every load before this.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

const mockStripe = {
  subscriptions: { retrieve: jest.fn() },
  customers: { retrieve: jest.fn() },
  paymentMethods: { retrieve: jest.fn() },
  invoices: { createPreview: jest.fn() },
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
  getSubscriptionByUserId: jest.fn(),
  getSubscription: jest.fn(),
  updateSubscription: jest.fn(async () => ({})),
  isLiveEntitlement: jest.fn(sub => Boolean(sub)),
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

describe('GET /me — payment method summary', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
  });

  test('includes paymentMethodBrand/Last4 from the subscription default payment method', async () => {
    mockSubscriptionService.getSubscriptionByUserId.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      plan: 'pro',
      status: 'active',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_stripe_1',
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      default_payment_method: 'pm_card_1',
    });
    mockStripe.paymentMethods.retrieve.mockResolvedValue({
      type: 'card',
      card: { brand: 'visa', last4: '4242' },
    });

    const app = buildApp({ id: 'user_1' });
    const res = await request(app).get('/api/v2/subscriptions/me').expect(200);

    expect(res.body.paymentMethodBrand).toBe('visa');
    expect(res.body.paymentMethodLast4).toBe('4242');
    expect(mockStripe.customers.retrieve).not.toHaveBeenCalled();
  });

  test('falls back to the customer default payment method when the subscription has none', async () => {
    mockSubscriptionService.getSubscriptionByUserId.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      plan: 'pro',
      status: 'active',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_stripe_1',
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({ default_payment_method: null });
    mockStripe.customers.retrieve.mockResolvedValue({
      invoice_settings: { default_payment_method: 'pm_card_2' },
    });
    mockStripe.paymentMethods.retrieve.mockResolvedValue({
      type: 'card',
      card: { brand: 'mastercard', last4: '1234' },
    });

    const app = buildApp({ id: 'user_1' });
    const res = await request(app).get('/api/v2/subscriptions/me').expect(200);

    expect(res.body.paymentMethodBrand).toBe('mastercard');
    expect(res.body.paymentMethodLast4).toBe('1234');
  });

  test('returns null payment method fields (not an error) when there is no subscription', async () => {
    mockSubscriptionService.getSubscriptionByUserId.mockResolvedValue(null);

    const app = buildApp({ id: 'user_1' });
    const res = await request(app).get('/api/v2/subscriptions/me').expect(200);

    expect(res.body.paymentMethodBrand).toBeNull();
    expect(res.body.paymentMethodLast4).toBeNull();
    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  test('returns null payment method fields when Stripe lookups fail, without failing the request', async () => {
    mockSubscriptionService.getSubscriptionByUserId.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      plan: 'pro',
      status: 'active',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_stripe_1',
    });
    mockStripe.subscriptions.retrieve.mockRejectedValue(new Error('Stripe is down'));

    const app = buildApp({ id: 'user_1' });
    const res = await request(app).get('/api/v2/subscriptions/me').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.paymentMethodBrand).toBeNull();
  });
});

describe('GET /upcoming-invoice', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
  });

  test('returns the previewed amount and currency for a live subscription', async () => {
    mockSubscriptionService.getSubscriptionByUserId.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      stripeSubscriptionId: 'sub_stripe_1',
    });
    mockStripe.invoices.createPreview.mockResolvedValue({ amount_due: 1900, currency: 'gbp' });

    const app = buildApp({ id: 'user_1' });
    const res = await request(app).get('/api/v2/subscriptions/upcoming-invoice').expect(200);

    expect(mockStripe.invoices.createPreview).toHaveBeenCalledWith({
      subscription: 'sub_stripe_1',
    });
    expect(res.body.upcomingInvoice).toEqual({ amount: 1900, currency: 'gbp' });
  });

  test('returns null when there is no Stripe-backed subscription', async () => {
    mockSubscriptionService.getSubscriptionByUserId.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      stripeSubscriptionId: null,
    });

    const app = buildApp({ id: 'user_1' });
    const res = await request(app).get('/api/v2/subscriptions/upcoming-invoice').expect(200);

    expect(res.body.upcomingInvoice).toBeNull();
    expect(mockStripe.invoices.createPreview).not.toHaveBeenCalled();
  });

  test('returns null rather than an error response when Stripe fails', async () => {
    mockSubscriptionService.getSubscriptionByUserId.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      stripeSubscriptionId: 'sub_stripe_1',
    });
    mockStripe.invoices.createPreview.mockRejectedValue(new Error('Stripe is down'));

    const app = buildApp({ id: 'user_1' });
    const res = await request(app).get('/api/v2/subscriptions/upcoming-invoice').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.upcomingInvoice).toBeNull();
  });
});
