/**
 * Unit tests for Stripe webhook handler utilities
 * Covers formatPlanName and resolvePlanTier helpers
 */

'use strict';

// Silence postmark warning during tests
const originalPostmarkApiKey = process.env.POSTMARK_API_KEY;
beforeAll(() => {
  process.env.POSTMARK_API_KEY = 'test';
});
afterAll(() => {
  if (originalPostmarkApiKey !== undefined) {
    process.env.POSTMARK_API_KEY = originalPostmarkApiKey;
  } else {
    delete process.env.POSTMARK_API_KEY;
  }
});

const { formatPlanName, resolvePlanTier } = require('../../webhooks/stripeWebhookHandler');

describe('Stripe Webhook Handler — formatPlanName', () => {
  it('formats free tier', () => {
    expect(formatPlanName('free')).toBe('Free');
  });

  it('formats pro tier', () => {
    expect(formatPlanName('pro')).toBe('Pro');
  });

  it('formats pro_plus tier', () => {
    expect(formatPlanName('pro_plus')).toBe('Pro Plus');
  });

  it('falls back to the raw tier string for unknown values', () => {
    expect(formatPlanName('custom_tier')).toBe('custom_tier');
  });

  it('returns Unknown for null/undefined', () => {
    expect(formatPlanName(null)).toBe('Unknown');
    expect(formatPlanName(undefined)).toBe('Unknown');
    expect(formatPlanName('')).toBe('Unknown');
  });
});

describe('Stripe Webhook Handler — resolvePlanTier', () => {
  // Exact canonical planId values (set by checkout session metadata)
  it('resolves exact "pro" to pro', () => {
    expect(resolvePlanTier('pro')).toBe('pro');
  });

  it('resolves exact "pro_monthly" to pro', () => {
    expect(resolvePlanTier('pro_monthly')).toBe('pro');
  });

  it('resolves exact "pro_yearly" to pro', () => {
    expect(resolvePlanTier('pro_yearly')).toBe('pro');
  });

  it('resolves exact "pro_plus" to pro_plus', () => {
    expect(resolvePlanTier('pro_plus')).toBe('pro_plus');
  });

  it('resolves exact "pro_plus_monthly" to pro_plus', () => {
    expect(resolvePlanTier('pro_plus_monthly')).toBe('pro_plus');
  });

  it('resolves exact "pro_plus_yearly" to pro_plus', () => {
    expect(resolvePlanTier('pro_plus_yearly')).toBe('pro_plus');
  });

  // Substring heuristic fallback — "Pro+ Monthly" style Stripe nicknames
  it('resolves "Pro+ Monthly" nickname to pro_plus (not pro)', () => {
    expect(resolvePlanTier('Pro+ Monthly')).toBe('pro_plus');
  });

  it('resolves "Pro Plus Monthly" (no underscore/proplus/pro+) to pro via substring fallback', () => {
    expect(resolvePlanTier('Pro Plus Monthly')).toBe('pro');
    // Note: "Pro Plus Monthly" does NOT contain "pro_plus", "proplus", or "pro+" so falls
    // through to the "pro" substring match — this is an acceptable known limitation;
    // callers should use metadata.planId for deterministic mapping.
  });

  it('resolves "ProPlus" substring to pro_plus', () => {
    expect(resolvePlanTier('ProPlus Annual')).toBe('pro_plus');
  });

  it('resolves plain "Pro Monthly" nickname to pro', () => {
    expect(resolvePlanTier('Pro Monthly')).toBe('pro');
  });

  it('resolves unknown names to free', () => {
    expect(resolvePlanTier('basic')).toBe('free');
    expect(resolvePlanTier('enterprise')).toBe('free');
    expect(resolvePlanTier('unknown_plan')).toBe('free');
    expect(resolvePlanTier('')).toBe('free');
    expect(resolvePlanTier(null)).toBe('free');
  });

  it('is case-insensitive', () => {
    expect(resolvePlanTier('PRO')).toBe('pro');
    expect(resolvePlanTier('PRO_PLUS')).toBe('pro_plus');
    expect(resolvePlanTier('PRO+')).toBe('pro_plus');
  });
});

// ── handleInvoicePaymentSucceeded — partner bonus gating ──────────────────────
// These tests use module-level mocks to verify the trial/£0 invoice guard added
// to webhooks/stripeWebhookHandler.js.  The partnerService is required inline
// inside handleInvoicePaymentSucceeded(), so we mock it at module level.

// winston is not installed in the test runner; mock logger so the webhook
// handler module loads successfully.
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../services/partnerService', () => ({
  awardSubscriptionBonus: jest.fn().mockResolvedValue({ id: 'ptx_1', amount: 100 }),
}));

jest.mock('../../services/subscriptionService', () => ({
  getSubscriptionByStripeId: jest.fn().mockResolvedValue({
    id: 'sub_int_001',
    userId: 'usr_supplier_001',
    status: 'active',
  }),
  updateSubscription: jest.fn().mockResolvedValue({}),
  addBillingRecord: jest.fn().mockResolvedValue({}),
  updateBillingDates: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../db-unified', () => ({
  read: jest.fn().mockResolvedValue([]),
  insertOne: jest.fn().mockResolvedValue({}),
  updateOne: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../utils/postmark', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));

describe('Stripe Webhook Handler — partner bonus gating on invoice.payment_succeeded', () => {
  // Import after mocks are registered
  // eslint-disable-next-line global-require
  const { handleInvoicePaymentSucceeded } = require('../../webhooks/stripeWebhookHandler');
  // eslint-disable-next-line global-require
  const partnerServiceMock = require('../../services/partnerService');
  // eslint-disable-next-line global-require
  const subscriptionServiceMock = require('../../services/subscriptionService');

  const makeInvoice = (overrides = {}) => ({
    id: 'in_test001',
    subscription: 'sub_test001',
    total: 2000,
    amount_paid: 2000,
    currency: 'gbp',
    status: 'paid',
    lines: { data: [] },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to default resolved value after clearAllMocks
    subscriptionServiceMock.getSubscriptionByStripeId.mockResolvedValue({
      id: 'sub_int_001',
      userId: 'usr_supplier_001',
      status: 'active',
    });
    subscriptionServiceMock.updateSubscription.mockResolvedValue({});
    subscriptionServiceMock.addBillingRecord.mockResolvedValue({});
    subscriptionServiceMock.updateBillingDates.mockResolvedValue({});
    partnerServiceMock.awardSubscriptionBonus.mockResolvedValue({ id: 'ptx_1', amount: 100 });
  });

  it('awards subscription bonus for a paid invoice (amount_paid > 0)', async () => {
    await handleInvoicePaymentSucceeded(makeInvoice({ amount_paid: 2000, total: 2000 }));
    expect(partnerServiceMock.awardSubscriptionBonus).toHaveBeenCalledWith('usr_supplier_001');
  });

  it('does NOT award subscription bonus for a zero-amount invoice (trial activation)', async () => {
    await handleInvoicePaymentSucceeded(makeInvoice({ amount_paid: 0, total: 0 }));
    expect(partnerServiceMock.awardSubscriptionBonus).not.toHaveBeenCalled();
  });

  it('does NOT award subscription bonus when amount_paid is absent but total is 0', async () => {
    const invoice = makeInvoice({ total: 0 });
    delete invoice.amount_paid;
    await handleInvoicePaymentSucceeded(invoice);
    expect(partnerServiceMock.awardSubscriptionBonus).not.toHaveBeenCalled();
  });

  it('skips bonus award gracefully when subscription is not found', async () => {
    subscriptionServiceMock.getSubscriptionByStripeId.mockResolvedValue(null);
    await handleInvoicePaymentSucceeded(makeInvoice());
    expect(partnerServiceMock.awardSubscriptionBonus).not.toHaveBeenCalled();
  });
});
