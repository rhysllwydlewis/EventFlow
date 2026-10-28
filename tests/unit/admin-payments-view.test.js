'use strict';

const fs = require('fs');
const path = require('path');
const {
  GROUPS,
  buildPaymentsView,
  paymentAmount,
  planKey,
  refundedPounds,
  statusGroup,
} = require('../../services/adminPaymentsView');

const ROOT = path.join(__dirname, '../..');
const source = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const NOW = new Date('2026-10-28T10:00:00Z');

describe('statusGroup', () => {
  it.each([
    ['succeeded', GROUPS.PAID],
    ['success', GROUPS.PAID],
    ['completed', GROUPS.PAID],
    ['pending', GROUPS.PENDING],
    ['failed', GROUPS.FAILED],
    ['canceled', GROUPS.FAILED],
    ['refunded', GROUPS.REFUNDED],
    ['disputed', GROUPS.DISPUTED],
    ['chargeback', GROUPS.DISPUTED],
  ])('%s is %s', (status, group) => {
    expect(statusGroup(status)).toBe(group);
  });

  it('treats anything unrecognised, or missing, as pending (not money yet)', () => {
    expect(statusGroup('requires_action')).toBe(GROUPS.PENDING);
    expect(statusGroup(undefined)).toBe(GROUPS.PENDING);
  });
});

describe('planKey', () => {
  it.each([
    ['pro', 'month', 'pro_monthly'],
    ['pro', 'year', 'pro_yearly'],
    ['pro_plus', 'month', 'pro_plus_monthly'],
    ['pro_plus', 'year', 'pro_plus_yearly'],
    ['pro_yearly', undefined, 'pro_yearly'],
    ['pro_plus_monthly', undefined, 'pro_plus_monthly'],
    ['Professional Plus', 'yearly', 'pro_plus_yearly'],
  ])('%s / %s is %s', (plan, interval, expected) => {
    expect(planKey(plan, interval)).toBe(expected);
  });

  it('is null for free, empty or unknown plans', () => {
    expect(planKey('free', 'month')).toBeNull();
    expect(planKey('', 'month')).toBeNull();
    expect(planKey('gold', 'month')).toBeNull();
  });
});

describe('amounts', () => {
  it('uses the payment own amount, then the paid invoice it settled, else null', () => {
    const invoices = new Map([['pi_1', 129]]);
    expect(paymentAmount({ amount: 20, stripePaymentId: 'pi_1' }, invoices)).toBe(20);
    expect(paymentAmount({ amount: 0, stripePaymentId: 'pi_1' }, invoices)).toBe(129);
    expect(paymentAmount({ amount: 0, stripePaymentId: 'cs_x' }, invoices)).toBeNull();
  });

  it('a refund with no recorded amount is the whole payment; a bigger one is capped', () => {
    expect(refundedPounds({ metadata: {} }, 20)).toBe(20);
    expect(refundedPounds({ metadata: { refundAmount: 5 } }, 20)).toBe(5);
    expect(refundedPounds({ metadata: { refundAmount: 50 } }, 20)).toBe(20);
    expect(refundedPounds({ metadata: {} }, null)).toBe(0);
  });
});

describe('buildPaymentsView with the records Stripe checkout really creates', () => {
  const users = [{ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.test' }];
  const payments = [
    // subscription checkout: amount 0 on the payment, keyed by the session id
    {
      id: 'pay_1',
      userId: 'u1',
      stripePaymentId: 'cs_1',
      amount: 0,
      currency: 'gbp',
      status: 'succeeded',
      type: 'subscription',
      metadata: { planId: 'pro_plus', billingInterval: 'year', sessionId: 'cs_1' },
      createdAt: '2026-10-20T00:00:00Z',
    },
    {
      id: 'pay_2',
      userId: 'u1',
      stripePaymentId: 'cs_2',
      amount: 0,
      status: 'pending',
      metadata: { planId: 'pro', billingInterval: 'month' },
      createdAt: '2026-10-21T00:00:00Z',
    },
    {
      id: 'pay_3',
      userId: 'u1',
      stripePaymentId: 'pi_3',
      amount: 20,
      status: 'refunded',
      metadata: { planId: 'pro', refundAmount: 5, refundedAt: '2026-10-25T00:00:00Z' },
      createdAt: '2026-09-02T00:00:00Z',
    },
    {
      id: 'pay_4',
      userId: 'gone',
      status: 'failed',
      metadata: {},
      createdAt: '2026-10-22T00:00:00Z',
    },
  ];
  const invoices = [
    { status: 'paid', amount: 129, stripePaymentIntentId: 'cs_1', paidAt: '2026-10-20T00:00:00Z' },
    { status: 'open', amount: 50, stripePaymentIntentId: 'cs_2' },
  ];
  const subscriptions = [
    { status: 'active', plan: 'pro_plus', billingInterval: 'year' },
    { status: 'canceled', plan: 'pro' },
    { status: 'trialing', plan: 'pro', billingInterval: 'month' },
    { status: 'past_due', plan: 'pro' },
  ];
  const view = buildPaymentsView({ payments, users, invoices, subscriptions, now: NOW });
  const byId = Object.fromEntries(view.items.map(item => [item.id, item]));

  it('shows the customer, plan, amount and status group of a real payment', () => {
    expect(byId.pay_1).toMatchObject({
      customerName: 'Ada Lovelace',
      customerEmail: 'ada@example.test',
      planId: 'pro_plus_yearly',
      planName: 'Pro+ Yearly',
      amount: 129,
      statusGroup: 'paid',
    });
  });

  it('shows an unknown customer as nobody rather than breaking, and a missing plan as null', () => {
    expect(byId.pay_4).toMatchObject({ customerName: null, planId: null, statusGroup: 'failed' });
  });

  it('leaves the amount unknown (null) when only an unmatched invoice holds it', () => {
    expect(byId.pay_2.amount).toBeNull();
  });

  it('sorts newest first', () => {
    expect(view.items.map(item => item.id)).toEqual(['pay_4', 'pay_2', 'pay_1', 'pay_3']);
  });

  it('counts revenue from paid invoices and own amounts, less refunds; pending and open count for nothing', () => {
    // 129 (paid invoice) + 20 (payment with its own amount) - 5 (refund)
    expect(view.summary.totalRevenue).toBe(144);
    expect(view.summary.refundedTotal).toBe(5);
    expect(view.summary.monthRevenue).toBe(124);
    expect(view.summary.revenueByMonth).toEqual({ '2026-10': 124, '2026-09': 20 });
  });

  it('counts active subscriptions from subscriptions, not payments', () => {
    expect(view.summary.activeSubscriptions).toBe(2);
    expect(view.summary.totalTransactions).toBe(4);
    expect(view.summary.paidCount).toBe(1);
    expect(view.summary.pendingCount).toBe(1);
    expect(view.summary.planDistribution).toEqual({ pro_plus_yearly: 1, pro_monthly: 1 });
  });

  it('copes with nothing at all', () => {
    const empty = buildPaymentsView({ payments: [], users: [], invoices: [], subscriptions: [] });
    expect(empty.items).toEqual([]);
    expect(empty.summary).toMatchObject({ totalRevenue: 0, activeSubscriptions: 0 });
  });

  it('does not let float addition leave stray pence', () => {
    const result = buildPaymentsView({
      payments: [],
      users: [],
      subscriptions: [],
      invoices: [
        { status: 'paid', amount: 0.1, paidAt: '2026-10-01T00:00:00Z' },
        { status: 'paid', amount: 0.2, paidAt: '2026-10-02T00:00:00Z' },
      ],
      now: NOW,
    });
    expect(result.summary.totalRevenue).toBe(0.3);
  });
});

describe('the Payments page', () => {
  const page = source('public/assets/js/pages/admin-payments-init.js');
  const html = source('public/admin-payments.html');

  it('reads the fields real records have, not supplierId / planId / total / "success"', () => {
    expect(page).not.toMatch(/payment\.supplierId|payment\.total|=== 'success'|=== 'completed'/);
    expect(page).toMatch(/payment\.statusGroup === currentFilters\.status/);
    expect(page).toMatch(/payment\.customerName/);
  });

  it('no longer fetches every supplier just to look names up', () => {
    expect(page).not.toMatch(/api\/admin\/suppliers/);
  });

  it('takes the headline numbers from the server and does not count pending payments as revenue', () => {
    expect(page).toMatch(/summary\.activeSubscriptions|stats\.activeSubscriptions/);
    expect(page).not.toMatch(/status === 'pending'\s*\)\s*\{\s*stats\.totalRevenue/);
  });

  it('the filter options match the status groups, and the table says Customer', () => {
    for (const group of ['paid', 'pending', 'failed', 'refunded', 'disputed']) {
      expect(html).toContain(`<option value="${group}">`);
    }
    expect(html).toContain('<th>Customer</th>');
    expect(html).not.toContain('<th>Supplier</th>');
    expect(html).toContain('payment-status--refunded');
    expect(html).toContain('admin-payments-init.js?v=18.5.11');
  });
});
