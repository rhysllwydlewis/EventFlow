/**
 * Integration tests for subscription service
 */

'use strict';

const subscriptionService = require('../../services/subscriptionService');
const dbUnified = require('../../db-unified');

// Mock database
jest.mock('../../db-unified');

describe('Subscription Service Integration Tests', () => {
  let mockSubscriptions;
  let mockUsers;

  beforeEach(() => {
    mockSubscriptions = [];
    mockUsers = [
      {
        id: 'usr-1',
        name: 'John Doe',
        email: 'john@example.com',
        role: 'customer',
        isPro: false,
      },
    ];

    dbUnified.read.mockImplementation(async collection => {
      switch (collection) {
        case 'subscriptions':
          return [...mockSubscriptions];
        case 'users':
          return [...mockUsers];
        default:
          return [];
      }
    });

    dbUnified.write.mockImplementation(async (collection, data) => {
      switch (collection) {
        case 'subscriptions':
          mockSubscriptions = [...data];
          break;
        case 'users':
          mockUsers = [...data];
          break;
      }
    });

    dbUnified.insertOne.mockImplementation(async (collection, data) => {
      switch (collection) {
        case 'subscriptions':
          mockSubscriptions.push(data);
          break;
      }
    });

    // findOne needed since getSubscription/getSubscriptionByUserId/getFallbackUserTier
    // now use findOne instead of read()
    dbUnified.findOne.mockImplementation(async (collection, filter) => {
      if (collection === 'subscriptions') {
        if (typeof filter === 'function') {
          return mockSubscriptions.find(filter) || null;
        }
        return (
          mockSubscriptions.find(s => Object.keys(filter).every(k => s[k] === filter[k])) || null
        );
      }
      if (collection === 'users') {
        if (typeof filter === 'function') {
          return mockUsers.find(filter) || null;
        }
        return mockUsers.find(u => Object.keys(filter).every(k => u[k] === filter[k])) || null;
      }
      return null;
    });

    dbUnified.updateOne.mockImplementation(async (collection, filter, update) => {
      if (collection === 'users' && update.$set) {
        const idx = mockUsers.findIndex(u => u.id === filter.id);
        if (idx >= 0) {
          mockUsers[idx] = { ...mockUsers[idx], ...update.$set };
        }
      }
      if (collection === 'subscriptions' && update.$set) {
        const idx = mockSubscriptions.findIndex(s =>
          Object.keys(filter).every(k => s[k] === filter[k])
        );
        if (idx >= 0) {
          mockSubscriptions[idx] = { ...mockSubscriptions[idx], ...update.$set };
        }
      }
    });

    // Clear any existing mocks

    // find() is used by getSubscriptionByUserId — supports $ne/$in operators
    dbUnified.find.mockImplementation(async (collection, filter) => {
      const arr =
        collection === 'subscriptions'
          ? mockSubscriptions
          : collection === 'users'
            ? mockUsers
            : [];
      if (typeof filter === 'function') {
        return arr.filter(filter);
      }
      return arr.filter(item =>
        Object.keys(filter).every(k => {
          const val = filter[k];
          if (val && typeof val === 'object' && val.$ne !== undefined) {
            return item[k] !== val.$ne;
          }
          if (val && typeof val === 'object' && val.$in !== undefined) {
            return Array.isArray(val.$in) && val.$in.includes(item[k]);
          }
          return item[k] === val;
        })
      );
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createSubscription', () => {
    it('should create a new subscription', async () => {
      const subscription = await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro',
        stripeSubscriptionId: 'sub_stripe_123',
        stripeCustomerId: 'cus_stripe_123',
      });

      expect(subscription.id).toBeTruthy();
      expect(subscription.id).toMatch(/^sub_/);
      expect(subscription.userId).toBe('usr-1');
      expect(subscription.plan).toBe('pro');
      expect(subscription.status).toBe('active');
      expect(mockSubscriptions).toHaveLength(1);
    });

    it('should create subscription with trial period', async () => {
      const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      const subscription = await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro',
        stripeSubscriptionId: 'sub_stripe_123',
        stripeCustomerId: 'cus_stripe_123',
        trialEnd,
      });

      expect(subscription.status).toBe('trialing');
      expect(subscription.trialEnd).toBeTruthy();
    });

    it('should update user isPro status', async () => {
      const subscription = await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro',
        stripeSubscriptionId: 'sub_stripe_123',
        stripeCustomerId: 'cus_stripe_123',
      });

      expect(mockUsers[0].isPro).toBe(true);
      expect(mockUsers[0].subscriptionId).toBe(subscription.id);
    });
  });

  describe('upgradeSubscription', () => {
    let subscriptionId;

    beforeEach(async () => {
      const sub = await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro',
        stripeSubscriptionId: 'sub_stripe_123',
        stripeCustomerId: 'cus_stripe_123',
      });
      subscriptionId = sub.id;
    });

    it('should upgrade subscription to higher tier', async () => {
      const updated = await subscriptionService.upgradeSubscription(subscriptionId, 'pro_plus');

      expect(updated.plan).toBe('pro_plus');
      expect(updated.status).toBe('active');
    });

    it('should reject downgrade attempt', async () => {
      await expect(subscriptionService.upgradeSubscription(subscriptionId, 'free')).rejects.toThrow(
        'must be higher tier'
      );
    });

    it('should reject same tier upgrade', async () => {
      await expect(subscriptionService.upgradeSubscription(subscriptionId, 'pro')).rejects.toThrow(
        'must be higher tier'
      );
    });
  });

  describe('downgradeSubscription', () => {
    let subscriptionId;

    beforeEach(async () => {
      const sub = await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro',
        stripeSubscriptionId: 'sub_stripe_123',
        stripeCustomerId: 'cus_stripe_123',
      });
      subscriptionId = sub.id;
    });

    it('should schedule downgrade to lower tier (keeps current plan, sets pendingPlan)', async () => {
      const updated = await subscriptionService.downgradeSubscription(subscriptionId, 'free');

      // plan must NOT change immediately — access is preserved until period end
      expect(updated.plan).toBe('pro');
      expect(updated.pendingPlan).toBe('free');
      expect(updated.cancelAtPeriodEnd).toBe(true);
    });

    it('should reject upgrade attempt', async () => {
      await expect(
        subscriptionService.downgradeSubscription(subscriptionId, 'pro_plus')
      ).rejects.toThrow('must be lower tier');
    });

    it('should reject unknown/unsupported plan (e.g. basic, enterprise)', async () => {
      await expect(
        subscriptionService.downgradeSubscription(subscriptionId, 'basic')
      ).rejects.toThrow('Unknown plan: basic');
      await expect(
        subscriptionService.downgradeSubscription(subscriptionId, 'enterprise')
      ).rejects.toThrow('Unknown plan: enterprise');
    });
  });

  describe('applyPendingPlan', () => {
    it('applies a pending downgrade and restores cancelAtPeriodEnd to false', async () => {
      // Start at pro_plus
      const sub = await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro_plus',
        stripeSubscriptionId: 'sub_pp_test',
        stripeCustomerId: 'cus_pp_test',
      });

      // Schedule a downgrade to pro
      const afterDowngrade = await subscriptionService.downgradeSubscription(sub.id, 'pro');
      expect(afterDowngrade.plan).toBe('pro_plus'); // access unchanged
      expect(afterDowngrade.pendingPlan).toBe('pro');
      expect(afterDowngrade.cancelAtPeriodEnd).toBe(true);

      // Simulate period end — apply the pending plan
      const afterApply = await subscriptionService.applyPendingPlan(sub.id);
      expect(afterApply.plan).toBe('pro');
      expect(afterApply.pendingPlan).toBeNull();
      expect(afterApply.cancelAtPeriodEnd).toBe(false);
    });

    it('returns null when no pending plan is set', async () => {
      const sub = await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro',
        stripeSubscriptionId: null,
        stripeCustomerId: null,
      });
      const result = await subscriptionService.applyPendingPlan(sub.id);
      expect(result).toBeNull();
    });

    it('upgrade clears a pending downgrade immediately', async () => {
      const sub = await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro',
        stripeSubscriptionId: null,
        stripeCustomerId: null,
      });

      // Schedule downgrade to free
      await subscriptionService.downgradeSubscription(sub.id, 'free');

      // Upgrade back to pro_plus — should clear pendingPlan
      const afterUpgrade = await subscriptionService.upgradeSubscription(sub.id, 'pro_plus');
      expect(afterUpgrade.plan).toBe('pro_plus');
      expect(afterUpgrade.pendingPlan).toBeNull();
      expect(afterUpgrade.cancelAtPeriodEnd).toBe(false);
    });
  });

  describe('cancelSubscription', () => {
    let subscriptionId;

    beforeEach(async () => {
      const sub = await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro',
        stripeSubscriptionId: 'sub_stripe_123',
        stripeCustomerId: 'cus_stripe_123',
      });
      subscriptionId = sub.id;
    });

    it('should cancel subscription at period end', async () => {
      const updated = await subscriptionService.cancelSubscription(
        subscriptionId,
        'Too expensive',
        false
      );

      expect(updated.cancelAtPeriodEnd).toBe(true);
      expect(updated.cancelReason).toBe('Too expensive');
      expect(updated.status).not.toBe('canceled');
    });

    it('should cancel subscription immediately', async () => {
      const updated = await subscriptionService.cancelSubscription(
        subscriptionId,
        'Not using service',
        true
      );

      expect(updated.status).toBe('canceled');
      expect(updated.plan).toBe('free');
    });
  });

  describe('checkFeatureAccess', () => {
    it('should grant free plan features by default', async () => {
      const hasAnalytics = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
      const hasMessaging = await subscriptionService.checkFeatureAccess('usr-1', 'messaging');

      expect(hasAnalytics).toBe(false);
      expect(hasMessaging).toBe(true);
    });

    it('should grant pro plan features', async () => {
      await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro',
        stripeSubscriptionId: 'sub_stripe_123',
        stripeCustomerId: 'cus_stripe_123',
      });

      const hasAnalytics = await subscriptionService.checkFeatureAccess('usr-1', 'analytics');
      const hasPrioritySupport = await subscriptionService.checkFeatureAccess(
        'usr-1',
        'prioritySupport'
      );

      expect(hasAnalytics).toBe(true);
      expect(hasPrioritySupport).toBe(true);
    });
  });

  describe('getUserFeatures', () => {
    it('should return free plan features by default', async () => {
      const features = await subscriptionService.getUserFeatures('usr-1');

      expect(features.name).toBe('Free');
      expect(features.price).toBe(0);
      expect(features.features.maxSuppliers).toBe(1);
    });

    it('should return pro plan features', async () => {
      await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro',
        stripeSubscriptionId: 'sub_stripe_123',
        stripeCustomerId: 'cus_stripe_123',
      });

      const features = await subscriptionService.getUserFeatures('usr-1');

      expect(features.name).toBe('Professional');
      expect(features.price).toBe(29.99);
      expect(features.features.maxSuppliers).toBe(10);
      expect(features.features.apiAccess).toBe(true);
    });
  });

  describe('getSubscriptionStats', () => {
    beforeEach(async () => {
      // Create multiple subscriptions
      await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro',
        stripeSubscriptionId: 'sub_1',
        stripeCustomerId: 'cus_1',
      });

      await subscriptionService.createSubscription({
        userId: 'usr-2',
        plan: 'pro',
        stripeSubscriptionId: 'sub_2',
        stripeCustomerId: 'cus_2',
      });

      await subscriptionService.createSubscription({
        userId: 'usr-3',
        plan: 'pro',
        stripeSubscriptionId: 'sub_3',
        stripeCustomerId: 'cus_3',
        trialEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      });
    });

    it('should calculate subscription statistics', async () => {
      const stats = await subscriptionService.getSubscriptionStats();

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(2);
      expect(stats.trialing).toBe(1);
      // All 3 subscriptions are on the 'pro' plan (one is trialing)
      expect(stats.byPlan.pro).toBe(3);
      expect(stats.byPlan.free).toBe(0);
    });
  });

  describe('getSubscriptionStats (pro_plus coverage)', () => {
    it('should count pro_plus subscriptions correctly in byPlan', async () => {
      mockSubscriptions = [
        { id: 's1', userId: 'u1', plan: 'pro_plus', status: 'active' },
        { id: 's2', userId: 'u2', plan: 'pro', status: 'active' },
        { id: 's3', userId: 'u3', plan: 'pro_plus', status: 'trialing' },
        { id: 's4', userId: 'u4', plan: 'free', status: 'canceled' },
      ];
      const stats = await subscriptionService.getSubscriptionStats();
      expect(stats.byPlan.pro_plus).toBe(2);
      expect(stats.byPlan.pro).toBe(1);
      expect(stats.byPlan.free).toBe(1);
    });
  });

  describe('getSubscriptionByUserId', () => {
    it('should return null when user has no active subscription', async () => {
      const sub = await subscriptionService.getSubscriptionByUserId('usr-none');
      expect(sub).toBeNull();
    });

    it('should return subscription for user with active subscription', async () => {
      await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro',
        stripeSubscriptionId: 'sub_me_test',
        stripeCustomerId: 'cus_me_test',
      });
      const sub = await subscriptionService.getSubscriptionByUserId('usr-1');
      expect(sub).not.toBeNull();
      expect(sub.plan).toBe('pro');
    });
  });

  describe('isInTrial', () => {
    it('should return true for subscription in trial period', () => {
      const subscription = {
        status: 'trialing',
        trialEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      };

      expect(subscriptionService.isInTrial(subscription)).toBe(true);
    });

    it('should return false for expired trial', () => {
      const subscription = {
        status: 'trialing',
        trialEnd: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      };

      expect(subscriptionService.isInTrial(subscription)).toBe(false);
    });

    it('should return false for active subscription without trial', () => {
      const subscription = {
        status: 'active',
        trialEnd: null,
      };

      expect(subscriptionService.isInTrial(subscription)).toBe(false);
    });
  });

  describe('getAllPlans', () => {
    it('should return only the 3 supported plans', () => {
      const plans = subscriptionService.getAllPlans();

      expect(plans).toHaveLength(3);
      expect(plans.map(p => p.id)).toEqual(['free', 'pro', 'pro_plus']);
      expect(plans[0].price).toBe(0);
      expect(plans[1].features.apiAccess).toBe(true);
    });
  });

  describe('upcoming-invoice route dependencies', () => {
    it('should return null for user with no subscription (getSubscriptionByUserId)', async () => {
      // The /upcoming-invoice endpoint returns upcomingInvoice:null when
      // getSubscriptionByUserId returns null — verify that code path here.
      const sub = await subscriptionService.getSubscriptionByUserId('usr-no-sub');
      expect(sub).toBeNull();
    });

    it('should return subscription with stripeCustomerId when present', async () => {
      // The /upcoming-invoice endpoint uses stripeCustomerId to call Stripe.
      await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'pro',
        stripeSubscriptionId: 'sub_upcoming_test',
        stripeCustomerId: 'cus_upcoming_test',
      });
      const sub = await subscriptionService.getSubscriptionByUserId('usr-1');
      expect(sub).not.toBeNull();
      expect(sub.stripeCustomerId).toBe('cus_upcoming_test');
    });
  });

  describe('getUserFeatures — effective tier resolution', () => {
    it('should return free plan features when subscription is expired', async () => {
      mockSubscriptions = [
        {
          id: 'sub-exp',
          userId: 'usr-1',
          plan: 'pro',
          status: 'active',
          currentPeriodEnd: new Date(Date.now() - 1000).toISOString(), // expired
        },
      ];

      const features = await subscriptionService.getUserFeatures('usr-1');
      expect(features.name).toBe('Free');
      expect(features.features.maxPackages).toBe(3);
    });

    it('should return free plan features when subscription is past_due', async () => {
      mockSubscriptions = [
        {
          id: 'sub-pd',
          userId: 'usr-1',
          plan: 'pro',
          status: 'past_due',
          currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
        },
      ];

      const features = await subscriptionService.getUserFeatures('usr-1');
      expect(features.name).toBe('Free');
      expect(features.features.maxPackages).toBe(3);
    });

    it('should return pro features when subscription is active and within period', async () => {
      mockSubscriptions = [
        {
          id: 'sub-active',
          userId: 'usr-1',
          plan: 'pro',
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
        },
      ];

      const features = await subscriptionService.getUserFeatures('usr-1');
      expect(features.name).toBe('Professional');
      expect(features.features.maxPackages).toBe(50);
    });

    it('should fall back to user.subscriptionTier when no subscription record exists', async () => {
      mockUsers = [
        {
          id: 'usr-1',
          subscriptionTier: 'pro',
          proExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ];

      const features = await subscriptionService.getUserFeatures('usr-1');
      expect(features.name).toBe('Professional');
    });

    it('should return free features when user fallback tier has expired proExpiresAt', async () => {
      mockUsers = [
        {
          id: 'usr-1',
          subscriptionTier: 'pro',
          proExpiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      ];

      const features = await subscriptionService.getUserFeatures('usr-1');
      expect(features.name).toBe('Free');
    });
  });

  describe('enforceActivePackageLimit', () => {
    let mockPackages;
    let mockSuppliers;

    beforeEach(() => {
      mockPackages = [];
      mockSuppliers = [{ id: 'sup-1', ownerUserId: 'usr-1' }];

      dbUnified.read.mockImplementation(async collection => {
        switch (collection) {
          case 'subscriptions':
            return [...mockSubscriptions];
          case 'users':
            return [...mockUsers];
          case 'packages':
            return [...mockPackages];
          case 'suppliers':
            return [...mockSuppliers];
          default:
            return [];
        }
      });

      // enforceActivePackageLimit now uses find() for suppliers and packages
      dbUnified.find.mockImplementation(async (collection, filter) => {
        const applyFilter = arr => {
          if (typeof filter === 'function') {
            return arr.filter(filter);
          }
          return arr.filter(item =>
            Object.keys(filter).every(k => {
              const val = filter[k];
              if (val && typeof val === 'object' && val.$in !== undefined) {
                return Array.isArray(val.$in) && val.$in.includes(item[k]);
              }
              if (val && typeof val === 'object' && val.$ne !== undefined) {
                return item[k] !== val.$ne;
              }
              return item[k] === val;
            })
          );
        };
        if (collection === 'suppliers') {
          return applyFilter([...mockSuppliers]);
        }
        if (collection === 'packages') {
          return applyFilter([...mockPackages]);
        }
        if (collection === 'subscriptions') {
          return applyFilter([...mockSubscriptions]);
        }
        if (collection === 'users') {
          return applyFilter([...mockUsers]);
        }
        return [];
      });

      dbUnified.updateOne.mockImplementation(async (collection, filter, update) => {
        if (collection === 'packages' && update.$set) {
          const idx = mockPackages.findIndex(p =>
            Object.keys(filter).every(k => p[k] === filter[k])
          );
          if (idx >= 0) {
            mockPackages[idx] = { ...mockPackages[idx], ...update.$set };
          }
        }
        if (collection === 'users' && update.$set) {
          const idx = mockUsers.findIndex(u => u.id === filter.id);
          if (idx >= 0) {
            mockUsers[idx] = { ...mockUsers[idx], ...update.$set };
          }
        }
        if (collection === 'subscriptions' && update.$set) {
          const idx = mockSubscriptions.findIndex(s =>
            Object.keys(filter).every(k => s[k] === filter[k])
          );
          if (idx >= 0) {
            mockSubscriptions[idx] = { ...mockSubscriptions[idx], ...update.$set };
          }
        }
      });
    });

    it('should not pause any packages when user is within limit', async () => {
      // Free plan: limit 3; user has 2 active packages
      mockPackages = [
        { id: 'pkg-1', supplierId: 'sup-1', paused: false, createdAt: '2024-01-01T00:00:00Z' },
        { id: 'pkg-2', supplierId: 'sup-1', paused: false, createdAt: '2024-01-02T00:00:00Z' },
      ];

      const paused = await subscriptionService.enforceActivePackageLimit('usr-1');
      expect(paused).toHaveLength(0);
      expect(mockPackages.every(p => p.paused === false)).toBe(true);
    });

    it('should pause oldest packages when over the active limit on downgrade', async () => {
      // Free plan limit is 3; user has 5 active packages
      mockPackages = [
        { id: 'pkg-1', supplierId: 'sup-1', paused: false, createdAt: '2024-01-01T00:00:00Z' },
        { id: 'pkg-2', supplierId: 'sup-1', paused: false, createdAt: '2024-01-02T00:00:00Z' },
        { id: 'pkg-3', supplierId: 'sup-1', paused: false, createdAt: '2024-01-03T00:00:00Z' },
        { id: 'pkg-4', supplierId: 'sup-1', paused: false, createdAt: '2024-01-04T00:00:00Z' },
        { id: 'pkg-5', supplierId: 'sup-1', paused: false, createdAt: '2024-01-05T00:00:00Z' },
      ];

      const paused = await subscriptionService.enforceActivePackageLimit('usr-1');

      // Should have paused 2 (oldest: pkg-1, pkg-2)
      expect(paused).toHaveLength(2);
      expect(paused).toContain('pkg-1');
      expect(paused).toContain('pkg-2');

      // pkg-3, pkg-4, pkg-5 should remain active
      const updatedPkgs = mockPackages;
      expect(updatedPkgs.find(p => p.id === 'pkg-3').paused).not.toBe(true);
      expect(updatedPkgs.find(p => p.id === 'pkg-4').paused).not.toBe(true);
      expect(updatedPkgs.find(p => p.id === 'pkg-5').paused).not.toBe(true);
    });

    it('should not pause already-paused packages', async () => {
      // Free plan limit is 3; 3 active + 2 already paused = should not touch paused ones
      mockPackages = [
        { id: 'pkg-1', supplierId: 'sup-1', paused: true, createdAt: '2024-01-01T00:00:00Z' },
        { id: 'pkg-2', supplierId: 'sup-1', paused: true, createdAt: '2024-01-02T00:00:00Z' },
        { id: 'pkg-3', supplierId: 'sup-1', paused: false, createdAt: '2024-01-03T00:00:00Z' },
        { id: 'pkg-4', supplierId: 'sup-1', paused: false, createdAt: '2024-01-04T00:00:00Z' },
        { id: 'pkg-5', supplierId: 'sup-1', paused: false, createdAt: '2024-01-05T00:00:00Z' },
      ];

      const paused = await subscriptionService.enforceActivePackageLimit('usr-1');
      expect(paused).toHaveLength(0);
    });

    it('should return empty array for unlimited plan (pro_plus)', async () => {
      mockSubscriptions = [
        {
          id: 'sub-pp',
          userId: 'usr-1',
          plan: 'pro_plus',
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
        },
      ];
      mockPackages = Array.from({ length: 10 }, (_, i) => ({
        id: `pkg-${i}`,
        supplierId: 'sup-1',
        paused: false,
        createdAt: `2024-01-0${i + 1}T00:00:00Z`,
      }));

      const paused = await subscriptionService.enforceActivePackageLimit('usr-1');
      expect(paused).toHaveLength(0);
    });

    it('applyPendingPlan should auto-pause overflow packages', async () => {
      // Setup: user has pro subscription with pending downgrade to free
      mockSubscriptions = [
        {
          id: 'sub-pending',
          userId: 'usr-1',
          plan: 'pro',
          status: 'active',
          pendingPlan: 'free',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
        },
      ];
      // 5 active packages
      mockPackages = [
        { id: 'pkg-1', supplierId: 'sup-1', paused: false, createdAt: '2024-01-01T00:00:00Z' },
        { id: 'pkg-2', supplierId: 'sup-1', paused: false, createdAt: '2024-01-02T00:00:00Z' },
        { id: 'pkg-3', supplierId: 'sup-1', paused: false, createdAt: '2024-01-03T00:00:00Z' },
        { id: 'pkg-4', supplierId: 'sup-1', paused: false, createdAt: '2024-01-04T00:00:00Z' },
        { id: 'pkg-5', supplierId: 'sup-1', paused: false, createdAt: '2024-01-05T00:00:00Z' },
      ];

      await subscriptionService.applyPendingPlan('sub-pending');

      // After applying, subscription plan should be 'free'
      const sub = mockSubscriptions.find(s => s.id === 'sub-pending');
      expect(sub.plan).toBe('free');

      // After applying, only 3 active packages remain (pkg-3, pkg-4, pkg-5)
      const active = mockPackages.filter(p => p.paused !== true);
      expect(active).toHaveLength(3);
      expect(active.map(p => p.id).sort()).toEqual(['pkg-3', 'pkg-4', 'pkg-5']);
    });

    it('cancelSubscription immediately should auto-pause overflow packages', async () => {
      mockSubscriptions = [
        {
          id: 'sub-cancel',
          userId: 'usr-1',
          plan: 'pro',
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
        },
      ];
      mockPackages = [
        { id: 'pkg-1', supplierId: 'sup-1', paused: false, createdAt: '2024-01-01T00:00:00Z' },
        { id: 'pkg-2', supplierId: 'sup-1', paused: false, createdAt: '2024-01-02T00:00:00Z' },
        { id: 'pkg-3', supplierId: 'sup-1', paused: false, createdAt: '2024-01-03T00:00:00Z' },
        { id: 'pkg-4', supplierId: 'sup-1', paused: false, createdAt: '2024-01-04T00:00:00Z' },
      ];

      await subscriptionService.cancelSubscription('sub-cancel', 'test', true);

      // After immediate cancellation, only 3 active packages remain
      const active = mockPackages.filter(p => p.paused !== true);
      expect(active).toHaveLength(3);
    });
  });
});
