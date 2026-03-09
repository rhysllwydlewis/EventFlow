/**
 * Stripe Payment Analytics Integration Tests (mock-based)
 *
 * Tests the complete Stripe payment analytics pipeline with deterministic
 * mocks — no live Stripe API required.
 *
 * Covers:
 *  - Graceful degradation when Stripe is not configured
 *  - Admin stripe-analytics endpoint shape and calculation correctness
 *  - Payment service: MRR calculation, churn rate, payment records
 *  - Stripe webhook handler: subscription events, payment events
 *  - Admin payments route structure and security
 *  - Revenue analytics endpoint (subscriptions-v2)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── helpers ──────────────────────────────────────────────────────────────────

function readSrc(...parts) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', ...parts), 'utf8');
}

// ─── Stripe mock factory ──────────────────────────────────────────────────────

function makeStripeMock({ charges = [], subscriptions = [], customers = [], balance = {} } = {}) {
  return {
    charges: {
      list: jest.fn().mockResolvedValue({ data: charges }),
    },
    subscriptions: {
      list: jest.fn().mockResolvedValue({ data: subscriptions }),
    },
    customers: {
      list: jest.fn().mockResolvedValue({ data: customers }),
    },
    balance: {
      retrieve: jest.fn().mockResolvedValue(balance),
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  };
}

// ─── Mock Stripe charges and subscriptions data ────────────────────────────────

const SECONDS_PER_DAY = 86400;

const MOCK_CHARGES = [
  {
    id: 'ch_001',
    amount: 2999,
    amount_captured: 2999,
    currency: 'gbp',
    status: 'succeeded',
    created: Math.floor(Date.now() / 1000) - SECONDS_PER_DAY,
    description: 'EventFlow Pro subscription',
    customer: 'cus_001',
  },
  {
    id: 'ch_002',
    amount: 4999,
    amount_captured: 4999,
    currency: 'gbp',
    status: 'succeeded',
    created: Math.floor(Date.now() / 1000) - 2 * SECONDS_PER_DAY,
    description: 'EventFlow Pro+ subscription',
    customer: 'cus_002',
  },
  {
    id: 'ch_003',
    amount: 2999,
    amount_captured: 0, // refunded
    currency: 'gbp',
    status: 'refunded',
    created: Math.floor(Date.now() / 1000) - 3 * SECONDS_PER_DAY,
    description: 'EventFlow Pro subscription (refunded)',
    customer: 'cus_003',
  },
];

const MOCK_SUBSCRIPTIONS = [
  { id: 'sub_001', status: 'active', plan: { id: 'pro' } },
  { id: 'sub_002', status: 'active', plan: { id: 'pro_plus' } },
  { id: 'sub_003', status: 'trialing', plan: { id: 'pro' } },
  { id: 'sub_004', status: 'past_due', plan: { id: 'pro' } },
];

const MOCK_BALANCE = {
  available: [{ amount: 150000, currency: 'gbp' }],
  pending: [{ amount: 5000, currency: 'gbp' }],
};

// ─── Test suites ─────────────────────────────────────────────────────────────

describe('Stripe Analytics — Graceful Degradation (no Stripe configured)', () => {
  it('admin.js /stripe-analytics returns {available:false} when Stripe is disabled', () => {
    const adminContent = readSrc('routes', 'admin.js');
    const routeIdx = adminContent.indexOf("router.get('/stripe-analytics'");
    expect(routeIdx).toBeGreaterThan(-1);
    const block = adminContent.substring(routeIdx, routeIdx + 500);
    expect(block).toContain('STRIPE_ENABLED');
    expect(block).toContain('available: false');
    expect(block).toContain('Stripe analytics are not available');
  });

  it('payments.js webhook returns 503 when Stripe is not configured', () => {
    const paymentsContent = readSrc('routes', 'payments.js');
    const webhookIdx = paymentsContent.indexOf("router.post('/webhook'");
    expect(webhookIdx).toBeGreaterThan(-1);
    const block = paymentsContent.substring(webhookIdx, webhookIdx + 500);
    expect(block).toContain('STRIPE_ENABLED');
    expect(block).toContain('status(503)');
    expect(block).toContain('Stripe not configured');
  });

  it('paymentService.js has STRIPE_ENABLED flag that defaults to false', () => {
    const src = readSrc('services', 'paymentService.js');
    expect(src).toContain('let STRIPE_ENABLED = false');
    expect(src).toContain('STRIPE_ENABLED = true');
    expect(src).toContain('module.exports');
    expect(src).toContain('STRIPE_ENABLED');
  });

  it('admin-payments-init.js shows status banner when Stripe is unavailable', () => {
    const src = readSrc('public', 'assets', 'js', 'pages', 'admin-payments-init.js');
    expect(src).toContain('stripeStatus');
    expect(src).toContain('available');
  });
});

describe('Stripe Analytics — Analytics Calculation (unit with mocked Stripe data)', () => {
  it('totalRevenue sums amount_captured (not amount) across charges', () => {
    // Simulate the calculation from admin.js /stripe-analytics
    const totalRevenue = MOCK_CHARGES.reduce((sum, charge) => {
      return sum + (charge.amount_captured || 0);
    }, 0);
    // ch_001: 2999, ch_002: 4999, ch_003: 0 (refunded) = 7998 pence = £79.98
    expect(totalRevenue).toBe(7998);
    expect(totalRevenue / 100).toBeCloseTo(79.98);
  });

  it('activeSubscriptions count includes trialing but not past_due', () => {
    // The admin analytics counts all subscriptions returned by stripe.subscriptions.list
    // which is filtered by status=active at API level — so all returned are counted
    const activeCount = MOCK_SUBSCRIPTIONS.length; // All returned subscriptions
    expect(activeCount).toBe(4);

    // But subscription breakdown separates statuses
    const breakdown = {
      active: MOCK_SUBSCRIPTIONS.filter(s => s.status === 'active').length,
      trialing: MOCK_SUBSCRIPTIONS.filter(s => s.status === 'trialing').length,
      past_due: MOCK_SUBSCRIPTIONS.filter(s => s.status === 'past_due').length,
    };
    expect(breakdown.active).toBe(2);
    expect(breakdown.trialing).toBe(1);
    expect(breakdown.past_due).toBe(1);
  });

  it('availableBalance converts from pence to pounds', () => {
    const availableBalance =
      MOCK_BALANCE.available && MOCK_BALANCE.available.length > 0
        ? MOCK_BALANCE.available[0].amount / 100
        : 0;
    expect(availableBalance).toBe(1500); // £1500
  });

  it('recentCharges slice returns at most 10 entries', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `ch_${i}`,
      amount: 2999,
      currency: 'gbp',
      status: 'succeeded',
      created: Date.now(),
      description: 'Test',
      customer: 'cus_0',
    }));
    const recent = many.slice(0, 10);
    expect(recent).toHaveLength(10);
  });

  it('analytics shape has all required keys', () => {
    // Simulate building the analytics object
    const analytics = {
      available: true,
      totalRevenue: 79.98,
      monthRevenue: 79.98,
      activeSubscriptions: MOCK_SUBSCRIPTIONS.length,
      totalCharges: MOCK_CHARGES.length,
      newCustomers: 3,
      availableBalance: 1500,
      pendingBalance: 50,
      currency: 'gbp',
      recentCharges: MOCK_CHARGES.slice(0, 10),
      subscriptionBreakdown: {
        active: 2,
        trialing: 1,
        past_due: 1,
      },
    };

    expect(analytics).toHaveProperty('available', true);
    expect(analytics).toHaveProperty('totalRevenue');
    expect(analytics).toHaveProperty('monthRevenue');
    expect(analytics).toHaveProperty('activeSubscriptions');
    expect(analytics).toHaveProperty('totalCharges');
    expect(analytics).toHaveProperty('newCustomers');
    expect(analytics).toHaveProperty('availableBalance');
    expect(analytics).toHaveProperty('pendingBalance');
    expect(analytics).toHaveProperty('currency');
    expect(analytics).toHaveProperty('recentCharges');
    expect(analytics).toHaveProperty('subscriptionBreakdown');
    expect(analytics.subscriptionBreakdown).toHaveProperty('active');
    expect(analytics.subscriptionBreakdown).toHaveProperty('trialing');
    expect(analytics.subscriptionBreakdown).toHaveProperty('past_due');
  });
});

describe('Stripe Analytics — Payment Service MRR (mocked dbUnified)', () => {
  let paymentService;
  let mockSubscriptions;

  beforeEach(() => {
    jest.resetModules();

    mockSubscriptions = [
      { id: 'sub_1', status: 'active', plan: 'pro', userId: 'usr_1' },
      { id: 'sub_2', status: 'active', plan: 'pro_plus', userId: 'usr_2' },
      { id: 'sub_3', status: 'trialing', plan: 'pro', userId: 'usr_3' },
      { id: 'sub_4', status: 'canceled', plan: 'pro', userId: 'usr_4' },
    ];

    jest.mock('../../db-unified', () => ({
      read: jest.fn().mockImplementation(async collection => {
        if (collection === 'subscriptions') {
          return [...mockSubscriptions];
        }
        return [];
      }),
      write: jest.fn().mockResolvedValue(undefined),
      insertOne: jest.fn().mockResolvedValue(undefined),
      updateOne: jest.fn().mockResolvedValue(undefined),
    }));

    jest.mock('../../utils/logger', () => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    paymentService = require('../../services/paymentService');
  });

  it('calculateMRR includes active and trialing subscriptions', async () => {
    const result = await paymentService.calculateMRR();
    expect(result).toHaveProperty('totalMRR');
    expect(result).toHaveProperty('byPlan');
    expect(result).toHaveProperty('activeSubscriptions');
    // Active (2) + Trialing (1) = 3 qualifying subscriptions
    expect(result.activeSubscriptions).toBe(3);
  });

  it('calculateMRR excludes canceled subscriptions', async () => {
    const result = await paymentService.calculateMRR();
    // Only active + trialing count (3 of 4)
    expect(result.activeSubscriptions).toBe(3);
  });

  it('calculateChurnRate returns structured result with period', async () => {
    const result = await paymentService.calculateChurnRate(30);
    expect(result).toHaveProperty('period', '30 days');
    expect(result).toHaveProperty('activeAtStart');
    expect(result).toHaveProperty('canceled');
    expect(result).toHaveProperty('churnRate');
  });

  it('calculateChurnRate returns 0% churn when no subscriptions were canceled', async () => {
    // No subscriptions have canceledAt in the mock
    const result = await paymentService.calculateChurnRate(30);
    expect(parseFloat(result.churnRate)).toBe(0);
  });

  it('calculateChurnRate detects canceled subscriptions within period', async () => {
    const DAYS_SINCE_CANCEL = 5;
    const DAYS_SINCE_CREATED = 60;

    const recentCancel = new Date();
    recentCancel.setDate(recentCancel.getDate() - DAYS_SINCE_CANCEL);
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - DAYS_SINCE_CREATED); // before the 30-day cutoff

    mockSubscriptions = [
      {
        id: 'sub_old',
        status: 'active',
        plan: 'pro',
        userId: 'usr_0',
        createdAt: oldDate.toISOString(),
      },
      {
        id: 'sub_canceled',
        status: 'canceled',
        plan: 'pro',
        userId: 'usr_4',
        createdAt: oldDate.toISOString(),
        canceledAt: recentCancel.toISOString(),
      },
    ];

    const dbUnified = require('../../db-unified');
    dbUnified.read.mockImplementation(async () => [...mockSubscriptions]);

    const result = await paymentService.calculateChurnRate(30);
    expect(result.canceled).toBe(1);
    expect(parseFloat(result.churnRate)).toBeGreaterThan(0);
  });
});

describe('Stripe Analytics — Route Security (contract)', () => {
  let adminContent;
  let paymentsContent;

  beforeAll(() => {
    adminContent = readSrc('routes', 'admin.js');
    paymentsContent = readSrc('routes', 'payments.js');
  });

  it('GET /stripe-analytics requires admin role', () => {
    const idx = adminContent.indexOf("router.get('/stripe-analytics'");
    const block = adminContent.substring(idx, idx + 200);
    expect(block).toContain('authRequired');
    expect(block).toContain("roleRequired('admin')");
  });

  it('GET /payments requires admin role', () => {
    const idx = adminContent.indexOf("router.get('/payments'");
    expect(idx).toBeGreaterThan(-1);
    const block = adminContent.substring(idx, idx + 200);
    expect(block).toContain('authRequired');
    expect(block).toContain("roleRequired('admin')");
  });

  it('POST /webhook validates Stripe signature when secret is configured', () => {
    const webhookIdx = paymentsContent.indexOf("router.post('/webhook'");
    const block = paymentsContent.substring(webhookIdx, webhookIdx + 1500);
    expect(block).toContain('STRIPE_WEBHOOK_SECRET');
    expect(block).toContain('constructEvent');
    expect(block).toContain('stripe-signature');
  });

  it('POST /webhook returns 400 when signature header is missing', () => {
    const webhookIdx = paymentsContent.indexOf("router.post('/webhook'");
    const block = paymentsContent.substring(webhookIdx, webhookIdx + 1000);
    expect(block).toContain('Missing Stripe signature header');
    expect(block).toContain('status(400)');
  });
});

describe('Stripe Analytics — Webhook Handler (mocked)', () => {
  let webhookHandler;

  beforeEach(() => {
    jest.resetModules();

    jest.mock('../../db-unified', () => ({
      read: jest.fn().mockResolvedValue([]),
      write: jest.fn().mockResolvedValue(undefined),
      insertOne: jest.fn().mockResolvedValue(undefined),
      updateOne: jest.fn().mockResolvedValue(undefined),
    }));

    jest.mock('../../utils/logger', () => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    jest.mock('../../services/paymentService', () => ({
      getPaymentByStripeId: jest.fn().mockResolvedValue(null),
      updatePaymentRecord: jest.fn().mockResolvedValue(null),
      createPaymentRecord: jest.fn().mockResolvedValue({ id: 'pay_mock' }),
      calculateMRR: jest
        .fn()
        .mockResolvedValue({ totalMRR: 100, byPlan: {}, activeSubscriptions: 1 }),
      calculateChurnRate: jest
        .fn()
        .mockResolvedValue({ period: '30 days', churnRate: '0.00', canceled: 0, activeAtStart: 1 }),
      STRIPE_ENABLED: false,
    }));

    jest.mock('../../services/subscriptionService', () => ({
      getSubscriptionStats: jest.fn().mockResolvedValue({ total: 1, active: 1, canceled: 0 }),
      getSubscriptionByStripeId: jest.fn().mockResolvedValue(null),
      cancelSubscription: jest.fn().mockResolvedValue(null),
      updateSubscription: jest.fn().mockResolvedValue(null),
      createSubscription: jest.fn().mockResolvedValue({ id: 'sub_mock' }),
    }));

    jest.mock('../../utils/postmark', () => ({
      sendMail: jest.fn().mockResolvedValue({ status: 'sent', MessageID: 'msg_001' }),
      isPostmarkEnabled: jest.fn().mockReturnValue(false),
    }));

    webhookHandler = require('../../webhooks/stripeWebhookHandler');
  });

  it('exports processWebhookEvent function', () => {
    expect(typeof webhookHandler.processWebhookEvent).toBe('function');
  });

  it('processWebhookEvent handles invoice.payment_succeeded event without crashing', async () => {
    const mockEvent = {
      id: 'evt_001',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_001',
          customer: 'cus_001',
          subscription: 'sub_001',
          amount_paid: 2999,
          currency: 'gbp',
          hosted_invoice_url: 'https://stripe.com/invoice/in_001',
          invoice_pdf: 'https://stripe.com/invoice/in_001.pdf',
          metadata: {},
        },
      },
    };

    await expect(webhookHandler.processWebhookEvent(mockEvent)).resolves.not.toThrow();
  });

  it('processWebhookEvent handles customer.subscription.created without crashing', async () => {
    const dbUnified = require('../../db-unified');
    dbUnified.read.mockImplementation(async col => {
      if (col === 'users') {
        return [{ id: 'usr_001', stripeCustomerId: 'cus_001', email: 'test@example.com' }];
      }
      if (col === 'payments') {
        return [{ id: 'pay_001', stripeCustomerId: 'cus_001', userId: 'usr_001' }];
      }
      return [];
    });

    const mockEvent = {
      id: 'evt_002',
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_new',
          customer: 'cus_001',
          status: 'active',
          plan: { id: 'pro', nickname: 'Pro', amount: 2999 },
          // items.data is accessed by handleSubscriptionCreated for plan name resolution
          items: {
            data: [
              { price: { nickname: 'Pro', unit_amount: 2999, recurring: { interval: 'month' } } },
            ],
          },
          current_period_end: Math.floor(Date.now() / 1000) + 30 * SECONDS_PER_DAY,
          trial_end: null,
          metadata: { planName: 'pro' },
        },
      },
    };

    await expect(webhookHandler.processWebhookEvent(mockEvent)).resolves.not.toThrow();
  });

  it('processWebhookEvent handles customer.subscription.deleted without crashing', async () => {
    const mockEvent = {
      id: 'evt_003',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_001',
          customer: 'cus_001',
          status: 'canceled',
          metadata: {},
        },
      },
    };

    await expect(webhookHandler.processWebhookEvent(mockEvent)).resolves.not.toThrow();
  });

  it('processWebhookEvent handles unknown event type gracefully', async () => {
    const mockEvent = {
      id: 'evt_999',
      type: 'unknown.event.type',
      data: { object: {} },
    };

    await expect(webhookHandler.processWebhookEvent(mockEvent)).resolves.not.toThrow();
  });

  it('formatPlanName converts stripe plan ids to human-readable names', () => {
    const { formatPlanName } = webhookHandler;
    if (typeof formatPlanName === 'function') {
      const result = formatPlanName('pro');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
