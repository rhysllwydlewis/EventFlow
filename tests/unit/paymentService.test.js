/**
 * Unit tests for payment service
 */

'use strict';

const paymentService = require('../../services/paymentService');
const dbUnified = require('../../db-unified');

// Mock database
jest.mock('../../db-unified');

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn(() => ({
    customers: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
    subscriptions: {
      create: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
    },
    paymentIntents: {
      retrieve: jest.fn(),
    },
    refunds: {
      create: jest.fn(),
    },
    invoices: {
      retrieve: jest.fn(),
      pay: jest.fn(),
    },
  }));
});

describe('Payment Service Unit Tests', () => {
  let mockPayments;
  let mockSubscriptions;

  beforeEach(() => {
    mockPayments = [];
    mockSubscriptions = [];

    dbUnified.read.mockImplementation(async collection => {
      switch (collection) {
        case 'payments':
          return [...mockPayments];
        case 'subscriptions':
          return [...mockSubscriptions];
        default:
          return [];
      }
    });

    dbUnified.write.mockImplementation(async (collection, data) => {
      switch (collection) {
        case 'payments':
          mockPayments = [...data];
          break;
        case 'subscriptions':
          mockSubscriptions = [...data];
          break;
      }
    });

    dbUnified.insertOne.mockImplementation(async (collection, data) => {
      switch (collection) {
        case 'payments':
          mockPayments.push(data);
          break;
      }
    });

    jest.spyOn(require('../../store'), 'uid').mockReturnValue('pay-test-123');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createPaymentRecord', () => {
    it('should create a payment record', async () => {
      const payment = await paymentService.createPaymentRecord({
        stripePaymentId: 'pi_123',
        stripeCustomerId: 'cus_123',
        userId: 'usr-1',
        amount: 29.99,
        currency: 'usd',
        status: 'pending',
        type: 'subscription',
      });

      expect(payment.id).toBeTruthy();
      expect(payment.id).toMatch(/^pay_/);
      expect(payment.amount).toBe(29.99);
      expect(payment.status).toBe('pending');
      expect(mockPayments).toHaveLength(1);
    });

    it('should set default values', async () => {
      const payment = await paymentService.createPaymentRecord({
        userId: 'usr-1',
        amount: 10.0,
      });

      expect(payment.currency).toBe('usd');
      expect(payment.status).toBe('pending');
      expect(payment.type).toBe('one_time');
    });
  });

  describe('updatePaymentRecord', () => {
    let paymentId;

    beforeEach(async () => {
      const payment = await paymentService.createPaymentRecord({
        stripePaymentId: 'pi_123',
        userId: 'usr-1',
        amount: 29.99,
        status: 'pending',
      });
      paymentId = payment.id;
    });

    it('should update payment record', async () => {
      const updated = await paymentService.updatePaymentRecord(paymentId, {
        status: 'succeeded',
      });

      expect(updated.status).toBe('succeeded');
      expect(updated.updatedAt).toBeTruthy();
    });

    it('should throw error for non-existent payment', async () => {
      await expect(
        paymentService.updatePaymentRecord('pay-nonexistent', { status: 'failed' })
      ).rejects.toThrow('Payment not found');
    });
  });

  describe('getPaymentByStripeId', () => {
    beforeEach(async () => {
      await paymentService.createPaymentRecord({
        stripePaymentId: 'pi_123',
        userId: 'usr-1',
        amount: 29.99,
        status: 'pending',
      });
    });

    it('should find payment by Stripe ID', async () => {
      const payment = await paymentService.getPaymentByStripeId('pi_123');

      expect(payment).toBeTruthy();
      expect(payment.stripePaymentId).toBe('pi_123');
    });

    it('should return null for non-existent Stripe ID', async () => {
      const payment = await paymentService.getPaymentByStripeId('pi_nonexistent');

      expect(payment).toBeNull();
    });
  });

  describe('calculateMRR', () => {
    beforeEach(() => {
      mockSubscriptions = [
        { status: 'active', plan: 'pro' },
        { status: 'active', plan: 'pro_plus' },
        { status: 'trialing', plan: 'pro' },
        { status: 'canceled', plan: 'pro_plus' },
        { status: 'active', plan: 'free' },
      ];
    });

    it('should calculate monthly recurring revenue', async () => {
      const mrr = await paymentService.calculateMRR();

      // pro: 29.99 * 2 = 59.98, pro_plus: 59.00, free: 0
      expect(mrr.totalMRR).toBeCloseTo(118.98, 2);
      expect(mrr.activeSubscriptions).toBe(4); // active + trialing
      expect(mrr.byPlan.pro).toBeCloseTo(59.98, 2);
      expect(mrr.byPlan.pro_plus).toBeCloseTo(59.0, 2);
    });

    it('should exclude canceled subscriptions from MRR', async () => {
      const mrr = await paymentService.calculateMRR();

      // canceled pro_plus subscription should not be in active MRR total
      // byPlan for pro_plus counts only the active/trialing ones
      expect(mrr.byPlan.pro_plus).toBeCloseTo(59.0, 2); // only 1 active pro_plus
    });

    it('should use correct price for pro_plus (not pro price)', async () => {
      mockSubscriptions = [
        { status: 'active', plan: 'pro_plus' },
        { status: 'active', plan: 'pro' },
      ];
      const mrr = await paymentService.calculateMRR();

      // pro_plus: 59.00, pro: 29.99 — total 88.99
      expect(mrr.totalMRR).toBeCloseTo(88.99, 2);
      expect(mrr.byPlan.pro_plus).toBeCloseTo(59.0, 2);
      expect(mrr.byPlan.pro).toBeCloseTo(29.99, 2);
      // pro_plus should NOT be merged into pro bucket
      expect(mrr.byPlan.pro).not.toBeCloseTo(88.99, 2);
    });
  });

  describe('calculateChurnRate', () => {
    it('should calculate churn rate for period', async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
      const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

      mockSubscriptions = [
        // Active subscriptions created before cutoff
        { status: 'active', plan: 'pro', createdAt: thirtyDaysAgo.toISOString() },
        { status: 'active', plan: 'pro_plus', createdAt: thirtyDaysAgo.toISOString() },
        { status: 'trialing', plan: 'pro', createdAt: thirtyDaysAgo.toISOString() },
        // Canceled within period
        {
          status: 'canceled',
          plan: 'pro',
          createdAt: thirtyDaysAgo.toISOString(),
          canceledAt: twentyDaysAgo.toISOString(),
        },
        // New subscription (not counted in churn)
        { status: 'active', plan: 'pro_plus', createdAt: new Date().toISOString() },
      ];

      const churn = await paymentService.calculateChurnRate(30);

      expect(churn.activeAtStart).toBe(3);
      expect(churn.canceled).toBe(1);
      expect(parseFloat(churn.churnRate)).toBeCloseTo(33.33, 1);
    });

    it('should return 0 churn rate when no subscriptions', async () => {
      mockSubscriptions = [];

      const churn = await paymentService.calculateChurnRate(30);

      expect(parseFloat(churn.churnRate)).toBe(0);
    });
  });

  describe('handleFailedPayment', () => {
    beforeEach(() => {
      mockSubscriptions = [
        {
          id: 'sub-1',
          userId: 'usr-1',
          status: 'active',
          plan: 'pro',
        },
      ];
    });

    it('should update subscription status to past_due', async () => {
      const invoice = { id: 'inv_123', status: 'open' };

      await paymentService.handleFailedPayment('sub-1', invoice);

      expect(mockSubscriptions[0].status).toBe('past_due');
    });
  });

  describe('STRIPE_ENABLED', () => {
    it('should export STRIPE_ENABLED flag', () => {
      expect(typeof paymentService.STRIPE_ENABLED).toBe('boolean');
    });
  });
});
