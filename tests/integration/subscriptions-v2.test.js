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
});
