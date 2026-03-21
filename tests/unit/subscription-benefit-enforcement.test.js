/**
 * Integration tests for subscription benefit enforcement
 * Covers: tier hierarchy, benefit activation, expiry, webhook handlers
 */

'use strict';

// ── module under test ────────────────────────────────────────────────────────
// We test the pure logic where possible; mocks replace external I/O.

jest.mock('../../db-unified');
const dbUnified = require('../../db-unified');

const subscriptionService = require('../../services/subscriptionService');
const { getAllPlans, getPlanFeatures, hasFeature } = require('../../models/Subscription');
const {
  requireSubscription,
  checkFeatureLimit,
  resolveEffectiveTier,
  TIER_LEVELS,
} = require('../../middleware/subscriptionGate');

// ── helpers ──────────────────────────────────────────────────────────────────

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

function futureDate(daysAhead = 30) {
  return new Date(Date.now() + daysAhead * 86400 * 1000).toISOString();
}

function pastDate(daysAgo = 5) {
  return new Date(Date.now() - daysAgo * 86400 * 1000).toISOString();
}

// ── shared mock state ────────────────────────────────────────────────────────

let mockSubscriptions = [];
let mockUsers = [{ id: 'usr-1', isPro: false }];

function setupMocks() {
  dbUnified.read.mockImplementation(async collection => {
    if (collection === 'subscriptions') {
      return [...mockSubscriptions];
    }
    if (collection === 'users') {
      return [...mockUsers];
    }
    return [];
  });
  dbUnified.write.mockImplementation(async (collection, data) => {
    if (collection === 'subscriptions') {
      mockSubscriptions = [...data];
    }
    if (collection === 'users') {
      mockUsers = [...data];
    }
  });
  dbUnified.insertOne.mockImplementation(async (collection, data) => {
    if (collection === 'subscriptions') {
      mockSubscriptions.push(data);
    }
  });
  dbUnified.updateOne.mockImplementation(async () => {});
}

beforeEach(() => {
  mockSubscriptions = [];
  mockUsers = [{ id: 'usr-1', isPro: false }];
  jest.clearAllMocks();
  setupMocks();
});

// ── 1. Subscription model ────────────────────────────────────────────────────

describe('Subscription model', () => {
  it('getAllPlans returns only the 3 supported plans (free, pro, pro_plus)', () => {
    const plans = getAllPlans();
    const ids = plans.map(p => p.id);
    expect(ids).toContain('free');
    expect(ids).toContain('pro');
    expect(ids).toContain('pro_plus');
    expect(ids).not.toContain('basic');
    expect(ids).not.toContain('enterprise');
    expect(plans).toHaveLength(3);
  });

  it('plans are returned in ascending tier order', () => {
    const plans = getAllPlans();
    const ids = plans.map(p => p.id);
    expect(ids.indexOf('free')).toBeLessThan(ids.indexOf('pro'));
    expect(ids.indexOf('pro')).toBeLessThan(ids.indexOf('pro_plus'));
  });

  it('pro_plus features include customBranding and homepageCarousel', () => {
    const f = getPlanFeatures('pro_plus').features;
    expect(f.customBranding).toBe(true);
    expect(f.homepageCarousel).toBe(true);
    expect(f.maxSuppliers).toBe(-1);
  });

  it('free plan cannot access analytics', () => {
    expect(hasFeature('free', 'analytics')).toBe(false);
  });

  it('pro plan can access analytics and priorityListing', () => {
    expect(hasFeature('pro', 'analytics')).toBe(true);
    expect(hasFeature('pro', 'priorityListing')).toBe(true);
  });
});

// ── 2. TIER_LEVELS hierarchy ─────────────────────────────────────────────────

describe('TIER_LEVELS hierarchy', () => {
  it('includes exactly the 3 supported tiers', () => {
    expect(TIER_LEVELS).toMatchObject({
      free: expect.any(Number),
      pro: expect.any(Number),
      pro_plus: expect.any(Number),
    });
    expect(TIER_LEVELS).not.toHaveProperty('basic');
    expect(TIER_LEVELS).not.toHaveProperty('enterprise');
  });

  it('free < pro < pro_plus', () => {
    expect(TIER_LEVELS.free).toBeLessThan(TIER_LEVELS.pro);
    expect(TIER_LEVELS.pro).toBeLessThan(TIER_LEVELS.pro_plus);
  });
});

// ── 3. requireSubscription middleware ────────────────────────────────────────

describe('requireSubscription middleware', () => {
  it('allows free user to access free-tier route', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('free')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res._status).toBe(200);
  });

  it('blocks free user from pro-tier route', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('pro')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/Subscription upgrade required/i);
    expect(res._body.currentTier).toBe('free');
  });

  it('allows pro user to access pro-tier route', async () => {
    mockSubscriptions.push({
      id: 'sub-1',
      userId: 'usr-1',
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: futureDate(30),
    });
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('pro')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.subscriptionTier).toBe('pro');
  });

  it('allows pro user to access free-tier route (higher tier satisfies lower requirement)', async () => {
    mockSubscriptions.push({
      id: 'sub-1',
      userId: 'usr-1',
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: futureDate(30),
    });
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('free')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks free user from pro-tier route', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('pro')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  it('treats expired subscription (past currentPeriodEnd) as free tier', async () => {
    mockSubscriptions.push({
      id: 'sub-1',
      userId: 'usr-1',
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: pastDate(5),
    });
    // No proExpiresAt on user
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('pro')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.currentTier).toBe('free');
  });

  it('treats past_due subscription (no future period) as free tier', async () => {
    mockSubscriptions.push({
      id: 'sub-1',
      userId: 'usr-1',
      plan: 'pro',
      status: 'past_due',
      currentPeriodEnd: pastDate(2),
    });
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('pro')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  it('falls back to user.subscriptionTier when no subscription table record', async () => {
    mockUsers = [
      {
        id: 'usr-1',
        subscriptionTier: 'pro',
        proExpiresAt: futureDate(15),
      },
    ];
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('pro')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.subscriptionTier).toBe('pro');
  });

  it('user.subscriptionTier fallback respects proExpiresAt when expired', async () => {
    mockUsers = [
      {
        id: 'usr-1',
        subscriptionTier: 'pro',
        proExpiresAt: pastDate(3),
      },
    ];
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('pro')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.currentTier).toBe('free');
  });

  it('returns 401 when user is not authenticated', async () => {
    const req = {};
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('pro')(req, res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches subscription object to req when access is granted', async () => {
    mockSubscriptions.push({
      id: 'sub-1',
      userId: 'usr-1',
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: futureDate(30),
    });
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('pro')(req, res, next);
    expect(req.subscription).toBeDefined();
    expect(req.subscription.id).toBe('sub-1');
  });

  it('includes upgradeUrl in 403 response', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requireSubscription('pro')(req, res, next);
    expect(res._body.upgradeUrl).toBe('/supplier/subscription.html');
  });
});

// ── 4. subscriptionService - createSubscription sets subscriptionTier ────────

describe('subscriptionService.createSubscription', () => {
  it('sets subscriptionTier on user record when creating pro subscription', async () => {
    await subscriptionService.createSubscription({
      userId: 'usr-1',
      plan: 'pro',
      stripeSubscriptionId: 'sub_stripe_1',
      stripeCustomerId: 'cus_1',
    });

    // persistUserSubscriptionState calls updateOne with $set wrapper
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'usr-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ subscriptionTier: 'pro', isPro: true }),
      })
    );
  });

  it('sets isPro=true for pro plan', async () => {
    await subscriptionService.createSubscription({
      userId: 'usr-1',
      plan: 'pro',
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
    });
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'usr-1' },
      expect.objectContaining({ $set: expect.objectContaining({ isPro: true }) })
    );
  });

  it('sets isPro=false for free plan', async () => {
    await subscriptionService.createSubscription({
      userId: 'usr-1',
      plan: 'free',
      stripeSubscriptionId: null,
      stripeCustomerId: null,
    });
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'usr-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ isPro: false, subscriptionTier: 'free' }),
      })
    );
  });
});

// ── 5. subscriptionService.updateSubscription syncs subscriptionTier ─────────

describe('subscriptionService.updateSubscription', () => {
  beforeEach(() => {
    mockSubscriptions.push({
      id: 'sub-1',
      userId: 'usr-1',
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: futureDate(),
      billingHistory: [],
      metadata: {},
    });
  });

  it('syncs subscriptionTier on user when plan changes to pro_plus', async () => {
    await subscriptionService.updateSubscription('sub-1', { plan: 'pro_plus' });
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'usr-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ subscriptionTier: 'pro_plus', isPro: true }),
      })
    );
  });

  it('syncs subscriptionTier to free and clears isPro when downgraded to free', async () => {
    await subscriptionService.updateSubscription('sub-1', { plan: 'free' });
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'usr-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ subscriptionTier: 'free', isPro: false }),
      })
    );
  });
});

// ── 6. checkFeatureAccess ────────────────────────────────────────────────────

describe('subscriptionService.checkFeatureAccess', () => {
  it('returns false for analytics on free user with no subscription', async () => {
    const hasAccess = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
    expect(hasAccess).toBe(false);
  });

  it('returns true for analytics on active pro subscription', async () => {
    mockSubscriptions.push({
      id: 'sub-1',
      userId: 'usr-1',
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: futureDate(),
    });
    const hasAccess = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
    expect(hasAccess).toBe(true);
  });

  it('returns false when subscription period is expired', async () => {
    mockSubscriptions.push({
      id: 'sub-1',
      userId: 'usr-1',
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: pastDate(),
    });
    const hasAccess = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
    expect(hasAccess).toBe(false);
  });

  it('returns true via user.subscriptionTier fallback when no subscription table record', async () => {
    mockUsers = [
      {
        id: 'usr-1',
        subscriptionTier: 'pro',
        proExpiresAt: futureDate(10),
      },
    ];
    const hasAccess = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
    expect(hasAccess).toBe(true);
  });

  it('returns false via user.subscriptionTier fallback when proExpiresAt is past', async () => {
    mockUsers = [
      {
        id: 'usr-1',
        subscriptionTier: 'pro',
        proExpiresAt: pastDate(2),
      },
    ];
    const hasAccess = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
    expect(hasAccess).toBe(false);
  });
});

// ── 7. checkFeatureLimit middleware ──────────────────────────────────────────

describe('checkFeatureLimit middleware', () => {
  it('allows access when user has the feature', async () => {
    mockSubscriptions.push({
      id: 'sub-1',
      userId: 'usr-1',
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: futureDate(),
    });
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await checkFeatureLimit('analytics')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('denies access with 403 when user lacks the feature', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await checkFeatureLimit('analytics')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/analytics/i);
  });
});

// ── 8. resolveEffectiveTier ──────────────────────────────────────────────────

describe('resolveEffectiveTier', () => {
  it('returns free for user with no subscription and no user.subscriptionTier', async () => {
    const { tier } = await resolveEffectiveTier('usr-1');
    expect(tier).toBe('free');
  });

  it('returns active subscription plan', async () => {
    mockSubscriptions.push({
      id: 'sub-1',
      userId: 'usr-1',
      plan: 'pro_plus',
      status: 'active',
      currentPeriodEnd: futureDate(),
    });
    const { tier } = await resolveEffectiveTier('usr-1');
    expect(tier).toBe('pro_plus');
  });

  it('falls back to user.subscriptionTier when subscription table has no active record', async () => {
    mockUsers = [{ id: 'usr-1', subscriptionTier: 'pro', proExpiresAt: futureDate(20) }];
    const { tier } = await resolveEffectiveTier('usr-1');
    expect(tier).toBe('pro');
  });

  it('returns free when user.subscriptionTier is set but proExpiresAt has passed', async () => {
    mockUsers = [{ id: 'usr-1', subscriptionTier: 'pro', proExpiresAt: pastDate(1) }];
    const { tier } = await resolveEffectiveTier('usr-1');
    expect(tier).toBe('free');
  });

  it('returns trialing plan as active', async () => {
    mockSubscriptions.push({
      id: 'sub-1',
      userId: 'usr-1',
      plan: 'pro',
      status: 'trialing',
      currentPeriodEnd: futureDate(14),
    });
    const { tier } = await resolveEffectiveTier('usr-1');
    expect(tier).toBe('pro');
  });
});
