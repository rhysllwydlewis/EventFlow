/**
 * Integration tests for subscription entitlement handling.
 *
 * Covers every lifecycle transition and verifies that:
 *   - The correct plan / tier is stored in the subscriptions collection
 *   - Feature access (checkFeatureAccess / resolveEffectiveTier) reflects the change
 *   - User record isPro / subscriptionTier stays in sync
 *   - Webhook idempotency rejects duplicate events
 *
 * Scenarios:
 *   1. New purchase → entitlements active
 *   2. Upgrade       → entitlements updated immediately
 *   3. Downgrade     → entitlements preserved until period end, then lowered
 *   4. Cancel at period end → access until currentPeriodEnd, then free
 *   5. Cancel immediately  → access removed immediately
 *   6. Payment failed / past_due → entitlements removed
 *   7. Webhook idempotency → duplicate events ignored
 *   8. Pending downgrade applied via handleSubscriptionDeleted
 */

'use strict';

jest.mock('../../db-unified');
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../utils/postmark', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('../../services/partnerService', () => ({
  awardSubscriptionBonus: jest.fn().mockResolvedValue({}),
}));

const dbUnified = require('../../db-unified');
const subscriptionService = require('../../services/subscriptionService');
const { resolveEffectiveTier, requireSubscription } = require('../../middleware/subscriptionGate');
const {
  handleSubscriptionDeleted,
  handleSubscriptionUpdated,
  handleInvoicePaymentFailed,
  processWebhookEvent,
  isEventAlreadyProcessed,
} = require('../../webhooks/stripeWebhookHandler');

// ── Shared mock state ─────────────────────────────────────────────────────────

let mockSubscriptions = [];
let mockUsers = [];
let mockWebhookEvents = [];

function setupMocks() {
  dbUnified.read.mockImplementation(async collection => {
    if (collection === 'subscriptions') {
      return [...mockSubscriptions];
    }
    if (collection === 'users') {
      return [...mockUsers];
    }
    if (collection === 'webhook_events') {
      return [...mockWebhookEvents];
    }
    return [];
  });
  dbUnified.insertOne.mockImplementation(async (collection, data) => {
    if (collection === 'subscriptions') {
      mockSubscriptions.push(data);
    }
    if (collection === 'webhook_events') {
      mockWebhookEvents.push(data);
    }
  });
  dbUnified.updateOne.mockImplementation(async (collection, filter, update) => {
    const applySet = (arr, key) => {
      const idx = arr.findIndex(item => Object.keys(filter).every(k => item[k] === filter[k]));
      if (idx >= 0) {
        arr[idx] = { ...arr[idx], ...update.$set };
      }
    };
    if (update.$set) {
      if (collection === 'subscriptions') {
        applySet(mockSubscriptions, 'subscriptions');
      }
      if (collection === 'users') {
        applySet(mockUsers, 'users');
      }
    }
  });
  dbUnified.write.mockImplementation(async () => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function futureDate(daysAhead = 30) {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString();
}

function pastDate(daysAgo = 5) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

function makeUser(id = 'usr-1') {
  return { id, name: 'Test User', email: `${id}@example.com`, isPro: false };
}

function makeStripeSubscription(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: 'sub_stripe_1',
    customer: 'cus_1',
    status: 'active',
    current_period_start: now,
    current_period_end: now + 30 * 86_400,
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    items: { data: [{ price: { nickname: 'pro', unit_amount: 2999 } }] },
    metadata: { planId: 'pro' },
    ...overrides,
  };
}

function makeReq(userId = 'usr-1') {
  return { user: { id: userId } };
}
function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = code => {
    res._status = code;
    return res;
  };
  res.json = body => {
    res._body = body;
    return res;
  };
  return res;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  mockSubscriptions = [];
  mockUsers = [makeUser('usr-1')];
  mockWebhookEvents = [];
  jest.clearAllMocks();
  setupMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. New purchase → entitlements active
// ─────────────────────────────────────────────────────────────────────────────

describe('1. New purchase — entitlements become active', () => {
  it('user has no premium features before purchasing', async () => {
    const access = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
    expect(access).toBe(false);
  });

  it('creates subscription and immediately grants pro features', async () => {
    await subscriptionService.createSubscription({
      userId: 'usr-1',
      plan: 'pro',
      stripeSubscriptionId: 'sub_stripe_new',
      stripeCustomerId: 'cus_1',
    });

    const access = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
    expect(access).toBe(true);

    const { tier } = await resolveEffectiveTier('usr-1');
    expect(tier).toBe('pro');
  });

  it('syncs isPro and subscriptionTier on the user record', async () => {
    await subscriptionService.createSubscription({
      userId: 'usr-1',
      plan: 'pro',
      stripeSubscriptionId: 'sub_s1',
      stripeCustomerId: 'cus_1',
    });

    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'usr-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ isPro: true, subscriptionTier: 'pro' }),
      })
    );
  });

  it('dashboard GET /me returns correct plan and no pendingPlan', async () => {
    const sub = await subscriptionService.createSubscription({
      userId: 'usr-1',
      plan: 'pro',
      stripeSubscriptionId: 'sub_s1',
      stripeCustomerId: 'cus_1',
    });
    // Simulate /me endpoint response shape (see routes/subscriptions-v2.js GET /me)
    const found = await subscriptionService.getSubscriptionByUserId('usr-1');
    expect(found.plan).toBe('pro');
    expect(found.pendingPlan).toBeFalsy();
    expect(found.cancelAtPeriodEnd).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Upgrade → entitlements updated immediately
// ─────────────────────────────────────────────────────────────────────────────

describe('2. Upgrade — entitlements updated immediately', () => {
  let subId;

  beforeEach(async () => {
    const sub = await subscriptionService.createSubscription({
      userId: 'usr-1',
      plan: 'pro',
      stripeSubscriptionId: 'sub_u',
      stripeCustomerId: 'cus_1',
    });
    subId = sub.id;
  });

  it('user does not have customBranding on pro', async () => {
    const access = await subscriptionService.checkFeatureAccess('usr-1', 'customBranding');
    expect(access).toBe(false);
  });

  it('gains pro_plus features immediately after upgrade', async () => {
    await subscriptionService.upgradeSubscription(subId, 'pro_plus');
    const access = await subscriptionService.checkFeatureAccess('usr-1', 'customBranding');
    expect(access).toBe(true);
  });

  it('upgrade clears any pending downgrade', async () => {
    // First schedule a downgrade
    await subscriptionService.downgradeSubscription(subId, 'free');
    const afterDowngrade = mockSubscriptions.find(s => s.id === subId);
    expect(afterDowngrade.pendingPlan).toBe('free');

    // Now upgrade — pending plan must be cleared
    await subscriptionService.upgradeSubscription(subId, 'pro_plus');
    const afterUpgrade = mockSubscriptions.find(s => s.id === subId);
    expect(afterUpgrade.plan).toBe('pro_plus');
    expect(afterUpgrade.pendingPlan).toBeNull();
    expect(afterUpgrade.cancelAtPeriodEnd).toBe(false);
  });

  it('requireSubscription middleware grants access to pro_plus route after upgrade', async () => {
    await subscriptionService.upgradeSubscription(subId, 'pro_plus');
    // Add period end so resolveEffectiveTier sees it as valid
    const idx = mockSubscriptions.findIndex(s => s.id === subId);
    mockSubscriptions[idx].currentPeriodEnd = futureDate(30);

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('pro_plus')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.subscriptionTier).toBe('pro_plus');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Downgrade — entitlements preserved at current tier until period end
// ─────────────────────────────────────────────────────────────────────────────

describe('3. Downgrade — current entitlements preserved until period end', () => {
  let subId;

  beforeEach(async () => {
    const sub = await subscriptionService.createSubscription({
      userId: 'usr-1',
      plan: 'pro_plus',
      stripeSubscriptionId: 'sub_d',
      stripeCustomerId: 'cus_1',
    });
    subId = sub.id;
  });

  it('sets pendingPlan and cancelAtPeriodEnd=true but does NOT lower plan immediately', async () => {
    await subscriptionService.downgradeSubscription(subId, 'pro');
    const sub = mockSubscriptions.find(s => s.id === subId);
    expect(sub.plan).toBe('pro_plus'); // unchanged
    expect(sub.pendingPlan).toBe('pro');
    expect(sub.cancelAtPeriodEnd).toBe(true);
  });

  it('user retains pro_plus features during the downgrade pending window', async () => {
    await subscriptionService.downgradeSubscription(subId, 'pro');
    // Add valid period end so the subscription counts as active
    mockSubscriptions.find(s => s.id === subId).currentPeriodEnd = futureDate(15);
    const access = await subscriptionService.checkFeatureAccess('usr-1', 'customBranding');
    expect(access).toBe(true);
  });

  it('pending plan is applied when applyPendingPlan is called (period end simulation)', async () => {
    await subscriptionService.downgradeSubscription(subId, 'pro');
    const applied = await subscriptionService.applyPendingPlan(subId);
    expect(applied.plan).toBe('pro');
    expect(applied.pendingPlan).toBeNull();
    expect(applied.cancelAtPeriodEnd).toBe(false);
  });

  it('user loses pro_plus-only features after pending plan is applied', async () => {
    await subscriptionService.downgradeSubscription(subId, 'pro');
    await subscriptionService.applyPendingPlan(subId);
    // Make sure subscription is still treated as active
    mockSubscriptions.find(s => s.id === subId).currentPeriodEnd = futureDate(30);
    const brandingAccess = await subscriptionService.checkFeatureAccess('usr-1', 'customBranding');
    expect(brandingAccess).toBe(false);
    // But pro features remain
    const analyticsAccess = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
    expect(analyticsAccess).toBe(true);
  });

  it('handleSubscriptionUpdated applies pending plan when Stripe period renews', async () => {
    // Schedule a downgrade
    await subscriptionService.downgradeSubscription(subId, 'pro');

    // Simulate Stripe firing customer.subscription.updated with cancel_at_period_end=false
    // (period renewed) and a new current period
    const now = Math.floor(Date.now() / 1000);
    const stripeEvent = makeStripeSubscription({
      id: 'sub_d',
      status: 'active',
      cancel_at_period_end: false, // Stripe cleared the flag (renewed)
      current_period_start: now,
      current_period_end: now + 30 * 86_400,
      metadata: {},
    });
    await handleSubscriptionUpdated(stripeEvent);

    const sub = mockSubscriptions.find(s => s.id === subId);
    expect(sub.plan).toBe('pro');
    expect(sub.pendingPlan).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Cancel at period end — access until currentPeriodEnd, then free
// ─────────────────────────────────────────────────────────────────────────────

describe('4. Cancel at period end', () => {
  let subId;

  beforeEach(async () => {
    const sub = await subscriptionService.createSubscription({
      userId: 'usr-1',
      plan: 'pro',
      stripeSubscriptionId: 'sub_c',
      stripeCustomerId: 'cus_1',
    });
    subId = sub.id;
    // Set a future period end
    mockSubscriptions.find(s => s.id === subId).currentPeriodEnd = futureDate(15);
  });

  it('cancelAtPeriodEnd is set, plan unchanged, user retains features', async () => {
    await subscriptionService.cancelSubscription(subId, 'too expensive', false);
    const sub = mockSubscriptions.find(s => s.id === subId);
    expect(sub.cancelAtPeriodEnd).toBe(true);
    expect(sub.plan).toBe('pro');
    expect(sub.status).not.toBe('canceled');

    // Features still active while in the paid period
    const access = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
    expect(access).toBe(true);
  });

  it('entitlements removed after period ends (past currentPeriodEnd)', async () => {
    await subscriptionService.cancelSubscription(subId, 'too expensive', false);
    // Simulate period expiry
    mockSubscriptions.find(s => s.id === subId).currentPeriodEnd = pastDate(1);

    const access = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
    expect(access).toBe(false);

    const { tier } = await resolveEffectiveTier('usr-1');
    expect(tier).toBe('free');
  });

  it('requireSubscription blocks access after period expires', async () => {
    await subscriptionService.cancelSubscription(subId, null, false);
    mockSubscriptions.find(s => s.id === subId).currentPeriodEnd = pastDate(1);

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('pro')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.currentTier).toBe('free');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Cancel immediately → entitlements removed immediately
// ─────────────────────────────────────────────────────────────────────────────

describe('5. Cancel immediately', () => {
  let subId;

  beforeEach(async () => {
    const sub = await subscriptionService.createSubscription({
      userId: 'usr-1',
      plan: 'pro',
      stripeSubscriptionId: 'sub_imm',
      stripeCustomerId: 'cus_1',
    });
    subId = sub.id;
    mockSubscriptions.find(s => s.id === subId).currentPeriodEnd = futureDate(10);
  });

  it('status becomes canceled and plan drops to free', async () => {
    await subscriptionService.cancelSubscription(subId, 'changed mind', true);
    const sub = mockSubscriptions.find(s => s.id === subId);
    expect(sub.status).toBe('canceled');
    expect(sub.plan).toBe('free');
  });

  it('feature access removed immediately even though currentPeriodEnd is in the future', async () => {
    await subscriptionService.cancelSubscription(subId, null, true);
    // getSubscriptionByUserId excludes 'canceled' status — user falls back to free
    const access = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
    expect(access).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Expired / past_due / payment_failed → entitlements removed
// ─────────────────────────────────────────────────────────────────────────────

describe('6. Expired / past_due / payment_failed — entitlements removed', () => {
  let subId;

  beforeEach(async () => {
    const sub = await subscriptionService.createSubscription({
      userId: 'usr-1',
      plan: 'pro',
      stripeSubscriptionId: 'sub_e',
      stripeCustomerId: 'cus_1',
    });
    subId = sub.id;
    mockSubscriptions.find(s => s.id === subId).currentPeriodEnd = pastDate(2);
  });

  it('expired active subscription (past currentPeriodEnd) treated as free', async () => {
    const { tier } = await resolveEffectiveTier('usr-1');
    expect(tier).toBe('free');
    const access = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
    expect(access).toBe(false);
  });

  it('past_due subscription treated as free', async () => {
    mockSubscriptions.find(s => s.id === subId).status = 'past_due';
    const { tier } = await resolveEffectiveTier('usr-1');
    expect(tier).toBe('free');
  });

  it('handleInvoicePaymentFailed sets subscription to past_due', async () => {
    // Make period end in the future (subscription was active; payment just failed)
    mockSubscriptions.find(s => s.id === subId).currentPeriodEnd = futureDate(10);
    mockSubscriptions.find(s => s.id === subId).status = 'active';

    // Mock invoices collection
    dbUnified.read.mockImplementation(async collection => {
      if (collection === 'subscriptions') {
        return [...mockSubscriptions];
      }
      if (collection === 'users') {
        return [...mockUsers];
      }
      if (collection === 'webhook_events') {
        return [...mockWebhookEvents];
      }
      if (collection === 'invoices') {
        return [];
      }
      return [];
    });

    const invoice = {
      id: 'in_fail1',
      subscription: 'sub_e',
      amount_due: 2999,
      currency: 'gbp',
      next_payment_attempt: Math.floor(Date.now() / 1000) + 3 * 86_400,
      lines: { data: [] },
    };

    await handleInvoicePaymentFailed(invoice);

    const sub = mockSubscriptions.find(s => s.id === subId);
    expect(sub.status).toBe('past_due');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Webhook idempotency — duplicate events are ignored
// ─────────────────────────────────────────────────────────────────────────────

describe('7. Webhook idempotency', () => {
  it('isEventAlreadyProcessed returns false for a new event ID and records it', async () => {
    const result = await isEventAlreadyProcessed('evt_new_001');
    expect(result).toBe(false);
    expect(mockWebhookEvents.some(e => e.eventId === 'evt_new_001')).toBe(true);
  });

  it('isEventAlreadyProcessed returns true for an already-recorded event ID', async () => {
    mockWebhookEvents.push({ eventId: 'evt_dup_001', processedAt: new Date().toISOString() });
    const result = await isEventAlreadyProcessed('evt_dup_001');
    expect(result).toBe(true);
  });

  it('isEventAlreadyProcessed returns false when event.id is absent (allows dev payloads)', async () => {
    const result = await isEventAlreadyProcessed(undefined);
    expect(result).toBe(false);
  });

  it('processWebhookEvent skips already-processed event', async () => {
    // Pre-record the event ID
    mockWebhookEvents.push({ eventId: 'evt_skip_1', processedAt: new Date().toISOString() });

    const logger = require('../../utils/logger');
    const event = { id: 'evt_skip_1', type: 'customer.subscription.updated', data: { object: {} } };
    await processWebhookEvent(event);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('evt_skip_1'));
    // No subscription updates should have been called
    const updates = dbUnified.updateOne.mock.calls.filter(c => c[0] === 'subscriptions');
    expect(updates).toHaveLength(0);
  });

  it('processWebhookEvent processes the same logical event only once on retry', async () => {
    const sub = await subscriptionService.createSubscription({
      userId: 'usr-1',
      plan: 'pro',
      stripeSubscriptionId: 'sub_idem',
      stripeCustomerId: 'cus_1',
    });
    mockSubscriptions.find(s => s.id === sub.id).currentPeriodEnd = futureDate(30);

    const now = Math.floor(Date.now() / 1000);
    const event = {
      id: 'evt_retry_1',
      type: 'customer.subscription.updated',
      data: {
        object: makeStripeSubscription({
          id: 'sub_idem',
          status: 'active',
          cancel_at_period_end: false,
          current_period_start: now,
          current_period_end: now + 30 * 86_400,
          metadata: { planId: 'pro' },
        }),
      },
    };

    await processWebhookEvent(event);
    const callsAfterFirst = dbUnified.updateOne.mock.calls.length;

    // Retry the exact same event
    await processWebhookEvent(event);
    const callsAfterRetry = dbUnified.updateOne.mock.calls.length;

    expect(callsAfterRetry).toBe(callsAfterFirst); // no extra DB calls
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. handleSubscriptionDeleted — pending downgrade applied correctly
// ─────────────────────────────────────────────────────────────────────────────

describe('8. handleSubscriptionDeleted — pending downgrade applied', () => {
  let subId;

  beforeEach(async () => {
    mockUsers = [makeUser('usr-1')];
    const sub = await subscriptionService.createSubscription({
      userId: 'usr-1',
      plan: 'pro_plus',
      stripeSubscriptionId: 'sub_del',
      stripeCustomerId: 'cus_1',
    });
    subId = sub.id;
    mockSubscriptions.find(s => s.id === subId).currentPeriodEnd = futureDate(30);
    // Schedule a downgrade
    await subscriptionService.downgradeSubscription(subId, 'pro');
  });

  it('applies the pending plan (pro) when subscription is deleted — NOT free', async () => {
    const stripeEvent = makeStripeSubscription({
      id: 'sub_del',
      status: 'canceled',
      cancel_at_period_end: true,
    });
    await handleSubscriptionDeleted(stripeEvent);

    const sub = mockSubscriptions.find(s => s.id === subId);
    expect(sub.plan).toBe('pro');
    expect(sub.status).toBe('active');
    expect(sub.pendingPlan).toBeNull();
    expect(sub.cancelAtPeriodEnd).toBe(false);
  });

  it('user retains pro (not free) entitlements after deletion with pending downgrade', async () => {
    const stripeEvent = makeStripeSubscription({ id: 'sub_del' });
    await handleSubscriptionDeleted(stripeEvent);

    // currentPeriodEnd is cleared — null means indefinite access on lower tier
    const access = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
    expect(access).toBe(true);

    const brandingAccess = await subscriptionService.checkFeatureAccess('usr-1', 'customBranding');
    expect(brandingAccess).toBe(false); // pro_plus-only feature
  });

  it('syncs user record to the lower tier', async () => {
    const stripeEvent = makeStripeSubscription({ id: 'sub_del' });
    await handleSubscriptionDeleted(stripeEvent);

    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'usr-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ subscriptionTier: 'pro', isPro: true }),
      })
    );
  });

  it('true cancellation (no pendingPlan) still results in free tier', async () => {
    // Clear the pending plan to simulate a true cancellation
    const idx = mockSubscriptions.findIndex(s => s.id === subId);
    mockSubscriptions[idx].pendingPlan = null;
    mockSubscriptions[idx].cancelAtPeriodEnd = false;

    const stripeEvent = makeStripeSubscription({ id: 'sub_del' });
    await handleSubscriptionDeleted(stripeEvent);

    const sub = mockSubscriptions.find(s => s.id === subId);
    expect(sub.plan).toBe('free');
    expect(sub.status).toBe('canceled');
  });
});
