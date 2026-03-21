/**
 * Integration test for complete subscription flow
 * Tests the entire user journey from subscription purchase to feature access
 */

'use strict';

const subscriptionService = require('../../services/subscriptionService');
const paymentService = require('../../services/paymentService');
const dbUnified = require('../../db-unified');

// Mock database
jest.mock('../../db-unified');

describe('Complete Subscription Flow Integration', () => {
  let mockSubscriptions;
  let mockUsers;
  let mockPayments;
  let mockInvoices;

  beforeEach(() => {
    mockSubscriptions = [];
    mockUsers = [
      {
        id: 'usr-test-001',
        name: 'Test User',
        email: 'test@example.com',
        role: 'customer',
        isPro: false,
        subscriptionId: null,
      },
    ];
    mockPayments = [];
    mockInvoices = [];

    dbUnified.read.mockImplementation(async collection => {
      switch (collection) {
        case 'subscriptions':
          return [...mockSubscriptions];
        case 'users':
          return [...mockUsers];
        case 'payments':
          return [...mockPayments];
        case 'invoices':
          return [...mockInvoices];
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
        case 'payments':
          mockPayments = [...data];
          break;
        case 'invoices':
          mockInvoices = [...data];
          break;
      }
    });

    dbUnified.insertOne.mockImplementation(async (collection, data) => {
      switch (collection) {
        case 'subscriptions':
          mockSubscriptions.push(data);
          break;
        case 'payments':
          mockPayments.push(data);
          break;
        case 'invoices':
          mockInvoices.push(data);
          break;
      }
    });

    dbUnified.updateOne.mockImplementation(async (collection, filter, update) => {
      if (update.$set) {
        const mockMap = {
          users: mockUsers,
          subscriptions: mockSubscriptions,
          payments: mockPayments,
          invoices: mockInvoices,
        };
        const arr = mockMap[collection];
        if (arr) {
          const idx = arr.findIndex(item => Object.keys(filter).every(k => item[k] === filter[k]));
          if (idx >= 0) {
            arr[idx] = { ...arr[idx], ...update.$set };
          }
        }
      }
    });

    jest.clearAllMocks();
  });

  describe('User Journey: Free to Pro Subscription', () => {
    it('should complete full subscription flow with feature unlocking', async () => {
      const userId = 'usr-test-001';

      // Step 1: User starts with free account - no premium features
      let hasApiAccess = await subscriptionService.checkFeatureAccess(userId, 'apiAccess');
      expect(hasApiAccess).toBe(false);

      let features = await subscriptionService.getUserFeatures(userId);
      expect(features.name).toBe('Free');
      expect(features.features.maxSuppliers).toBe(1);

      // Step 2: User subscribes to Pro plan
      const subscription = await subscriptionService.createSubscription({
        userId,
        plan: 'pro',
        stripeSubscriptionId: 'sub_test_pro_123',
        stripeCustomerId: 'cus_test_123',
      });

      expect(subscription.plan).toBe('pro');
      expect(subscription.status).toBe('active');
      expect(subscription.userId).toBe(userId);

      // Step 3: Verify user record updated with subscription
      const user = mockUsers.find(u => u.id === userId);
      expect(user.subscriptionId).toBe(subscription.id);
      expect(user.isPro).toBe(true);

      // Step 4: Verify premium features are now unlocked
      hasApiAccess = await subscriptionService.checkFeatureAccess(userId, 'apiAccess');
      expect(hasApiAccess).toBe(true);

      features = await subscriptionService.getUserFeatures(userId);
      expect(features.name).toBe('Professional');
      expect(features.features.maxSuppliers).toBe(10);
      expect(features.features.apiAccess).toBe(true);
      expect(features.features.prioritySupport).toBe(true);

      // Step 5: Create payment record
      const payment = await paymentService.createPaymentRecord({
        stripePaymentId: 'pi_test_123',
        stripeCustomerId: 'cus_test_123',
        stripeSubscriptionId: 'sub_test_pro_123',
        userId,
        amount: 29.99,
        currency: 'usd',
        status: 'succeeded',
        type: 'subscription',
      });

      expect(payment.status).toBe('succeeded');
      expect(payment.amount).toBe(29.99);

      // Step 6: Verify subscription is retrievable
      const retrievedSub = await subscriptionService.getSubscriptionByUserId(userId);
      expect(retrievedSub).toBeTruthy();
      expect(retrievedSub.plan).toBe('pro');
    });

    it('should handle trial period correctly', async () => {
      const userId = 'usr-test-001';
      const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      // Create subscription with trial
      const subscription = await subscriptionService.createSubscription({
        userId,
        plan: 'pro',
        stripeSubscriptionId: 'sub_trial_123',
        stripeCustomerId: 'cus_trial_123',
        trialEnd,
      });

      expect(subscription.status).toBe('trialing');
      expect(subscription.trialEnd).toBeTruthy();

      // User should have pro features during trial
      const hasApiAccess = await subscriptionService.checkFeatureAccess(userId, 'apiAccess');
      expect(hasApiAccess).toBe(true);

      // Verify trial status
      const inTrial = subscriptionService.isInTrial(subscription);
      expect(inTrial).toBe(true);
    });

    it('should handle upgrade from Pro to Pro Plus', async () => {
      const userId = 'usr-test-001';

      // Start with Pro plan
      const proSub = await subscriptionService.createSubscription({
        userId,
        plan: 'pro',
        stripeSubscriptionId: 'sub_pro_123',
        stripeCustomerId: 'cus_123',
      });

      // Verify pro features
      let features = await subscriptionService.getUserFeatures(userId);
      expect(features.name).toBe('Professional');
      expect(features.features.maxSuppliers).toBe(10);
      expect(features.features.apiAccess).toBe(true);

      // Upgrade to Pro Plus
      const upgradedSub = await subscriptionService.upgradeSubscription(proSub.id, 'pro_plus');

      expect(upgradedSub.plan).toBe('pro_plus');

      // Verify pro_plus features unlocked
      features = await subscriptionService.getUserFeatures(userId);
      expect(features.name).toBe('Professional Plus');
      expect(features.features.customBranding).toBe(true);
    });

    it('should handle subscription cancellation and feature removal', async () => {
      const userId = 'usr-test-001';

      // Create Pro subscription
      const subscription = await subscriptionService.createSubscription({
        userId,
        plan: 'pro',
        stripeSubscriptionId: 'sub_cancel_123',
        stripeCustomerId: 'cus_cancel_123',
      });

      // Verify pro features
      let hasApiAccess = await subscriptionService.checkFeatureAccess(userId, 'apiAccess');
      expect(hasApiAccess).toBe(true);

      // Cancel immediately
      const canceledSub = await subscriptionService.cancelSubscription(
        subscription.id,
        'Testing cancellation',
        true
      );

      expect(canceledSub.status).toBe('canceled');
      expect(canceledSub.plan).toBe('free');

      // Verify features revoked
      hasApiAccess = await subscriptionService.checkFeatureAccess(userId, 'apiAccess');
      expect(hasApiAccess).toBe(false);

      const features = await subscriptionService.getUserFeatures(userId);
      expect(features.name).toBe('Free');
    });
  });

  describe('Admin Dashboard Integration', () => {
    beforeEach(async () => {
      // Create multiple subscriptions for testing (only supported tiers)
      await subscriptionService.createSubscription({
        userId: 'usr-1',
        plan: 'free',
        stripeSubscriptionId: null,
        stripeCustomerId: null,
      });

      await subscriptionService.createSubscription({
        userId: 'usr-2',
        plan: 'pro',
        stripeSubscriptionId: 'sub_2',
        stripeCustomerId: 'cus_2',
      });

      await subscriptionService.createSubscription({
        userId: 'usr-3',
        plan: 'pro_plus',
        stripeSubscriptionId: 'sub_3',
        stripeCustomerId: 'cus_3',
      });
    });

    it('should calculate accurate subscription statistics', async () => {
      const stats = await subscriptionService.getSubscriptionStats();

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(3);
      expect(stats.byPlan.free).toBe(1);
      expect(stats.byPlan.pro).toBe(1);
      expect(stats.byPlan.pro_plus).toBe(1);
    });

    it('should calculate MRR correctly', async () => {
      const mrr = await paymentService.calculateMRR();

      // Free: 0, Pro: 29.99, Pro Plus: 59.00 = 88.99
      expect(mrr.totalMRR).toBeCloseTo(88.99, 2);
      expect(mrr.activeSubscriptions).toBe(3);
      expect(mrr.byPlan.pro).toBe(29.99);
      expect(mrr.byPlan.pro_plus).toBe(59.0);
    });

    it('should list subscriptions with filters', async () => {
      const proSubs = await subscriptionService.listSubscriptions({ plan: 'pro' });
      expect(proSubs).toHaveLength(1);
      expect(proSubs[0].plan).toBe('pro');

      const activeSubs = await subscriptionService.listSubscriptions({ status: 'active' });
      expect(activeSubs).toHaveLength(3);
    });
  });

  describe('Security and Authorization', () => {
    it('should prevent unauthorized subscription access', async () => {
      const userId = 'usr-test-001';
      const otherUserId = 'usr-other';

      await subscriptionService.createSubscription({
        userId,
        plan: 'pro',
        stripeSubscriptionId: 'sub_security_123',
        stripeCustomerId: 'cus_security_123',
      });

      // User should only access their own subscription
      const ownSub = await subscriptionService.getSubscriptionByUserId(userId);
      expect(ownSub).toBeTruthy();
      expect(ownSub.userId).toBe(userId);

      // Other user should not get this subscription
      const otherSub = await subscriptionService.getSubscriptionByUserId(otherUserId);
      expect(otherSub).toBeNull();
    });

    it('should enforce plan hierarchy on upgrades', async () => {
      const userId = 'usr-test-001';

      const subscription = await subscriptionService.createSubscription({
        userId,
        plan: 'pro',
        stripeSubscriptionId: 'sub_hierarchy_123',
        stripeCustomerId: 'cus_hierarchy_123',
      });

      // Cannot "upgrade" to a lower tier
      await expect(
        subscriptionService.upgradeSubscription(subscription.id, 'free')
      ).rejects.toThrow('higher tier');
    });
  });

  describe('Feature Gating', () => {
    it('should correctly gate features by plan', async () => {
      const testCases = [
        { plan: 'free', feature: 'messaging', expected: true },
        { plan: 'free', feature: 'analytics', expected: false },
        { plan: 'free', feature: 'apiAccess', expected: false },
        { plan: 'pro', feature: 'analytics', expected: true },
        { plan: 'pro', feature: 'apiAccess', expected: true },
        { plan: 'pro', feature: 'prioritySupport', expected: true },
        { plan: 'pro_plus', feature: 'customBranding', expected: true },
        { plan: 'pro_plus', feature: 'apiAccess', expected: true },
      ];

      for (const testCase of testCases) {
        const { hasFeature } = require('../../models/Subscription');
        const result = hasFeature(testCase.plan, testCase.feature);
        expect(result).toBe(testCase.expected);
      }
    });
  });
});
