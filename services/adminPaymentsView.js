/**
 * The admin Payments page's view of payment records.
 *
 * The records Stripe checkout and its webhooks create look like this: a payment has `userId`,
 * `stripePaymentId`, a status of pending / succeeded / failed / refunded, `metadata.planId`
 * ("pro" or "pro_plus", with `metadata.billingInterval`) and usually an `amount` of 0, because
 * the money is recorded on the paid *invoice*. The page used to read `supplierId`, `planId`,
 * `total` and a status of "success", none of which exist, so real payments showed as Unknown,
 * N/A and £0.00, pending payments counted as revenue, refunds were never taken off, and "active
 * subscriptions" counted payments.
 *
 * Revenue here is what the paid invoices brought in, less what was refunded. This is the one
 * place that turns real records into what the page shows, so it can be tested.
 */

'use strict';

const GROUPS = Object.freeze({
  PAID: 'paid',
  PENDING: 'pending',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  DISPUTED: 'disputed',
});

const PAID_STATUSES = new Set(['succeeded', 'success', 'completed', 'paid']);
const FAILED_STATUSES = new Set(['failed', 'canceled', 'cancelled', 'expired']);
const REFUNDED_STATUSES = new Set(['refunded', 'partially_refunded']);
const DISPUTED_STATUSES = new Set(['disputed', 'chargeback']);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

const PLAN_NAMES = Object.freeze({
  pro_monthly: 'Pro Monthly',
  pro_yearly: 'Pro Yearly',
  pro_plus_monthly: 'Pro+ Monthly',
  pro_plus_yearly: 'Pro+ Yearly',
});

/**
 * Which of the page's groups a payment status belongs to.
 * @param {string} status - Stored status
 * @returns {string} One of GROUPS (an unrecognised status counts as pending: not money yet)
 */
function statusGroup(status) {
  const normalised = String(status || '').toLowerCase();
  if (PAID_STATUSES.has(normalised)) {
    return GROUPS.PAID;
  }
  if (REFUNDED_STATUSES.has(normalised)) {
    return GROUPS.REFUNDED;
  }
  if (DISPUTED_STATUSES.has(normalised)) {
    return GROUPS.DISPUTED;
  }
  if (FAILED_STATUSES.has(normalised)) {
    return GROUPS.FAILED;
  }
  return GROUPS.PENDING;
}

/**
 * The plan a record is for, as one of the page's plan keys (pro_monthly, pro_plus_yearly, ...).
 * @param {string} [plan] - "pro", "pro_plus", or an older combined id such as "pro_yearly"
 * @param {string} [interval] - "month" / "year" (or monthly / yearly)
 * @returns {string|null} Plan key, or null when there is no plan
 */
function planKey(plan, interval) {
  const raw = String(plan || '').toLowerCase();
  if (!raw || raw === 'free') {
    return null;
  }
  let tier = null;
  if (raw.includes('plus')) {
    tier = 'pro_plus';
  } else if (raw.startsWith('pro')) {
    tier = 'pro';
  }
  if (!tier) {
    return null;
  }
  const yearly = /year/.test(String(interval || '')) || /year/.test(raw);
  return `${tier}_${yearly ? 'yearly' : 'monthly'}`;
}

function toPounds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Paid invoice totals by the payment intent they settled.
 * @param {Array<Object>} invoices - Invoice records
 * @returns {Map<string, number>} Pounds paid per payment-intent id
 */
function paidInvoiceTotals(invoices) {
  const totals = new Map();
  for (const invoice of invoices) {
    if (invoice && invoice.status === 'paid' && invoice.stripePaymentIntentId) {
      totals.set(
        invoice.stripePaymentIntentId,
        (totals.get(invoice.stripePaymentIntentId) || 0) + toPounds(invoice.amount)
      );
    }
  }
  return totals;
}

/**
 * What a payment is worth in pounds: its own amount, or the paid invoice it settled. Null when
 * neither is known (a subscription payment whose money is only on an invoice we cannot match),
 * so the page can say "see invoice" instead of a misleading £0.00.
 * @param {Object} payment - Payment record
 * @param {Map<string, number>} invoiceTotals - From paidInvoiceTotals()
 * @returns {number|null} Pounds, or null when unknown
 */
function paymentAmount(payment, invoiceTotals) {
  return toPounds(payment.amount) || invoiceTotals.get(payment.stripePaymentId) || null;
}

/**
 * Pounds given back on a refunded payment. A refund with no recorded amount is the whole
 * payment; when even that is unknown it cannot be counted.
 * @param {Object} payment - Payment record
 * @param {number|null} amount - From paymentAmount()
 * @returns {number} Pounds refunded
 */
function refundedPounds(payment, amount) {
  const recorded = toPounds(payment.metadata && payment.metadata.refundAmount);
  if (recorded) {
    return amount ? Math.min(recorded, amount) : recorded;
  }
  return amount || 0;
}

function roundPounds(value) {
  return Math.round(value * 100) / 100;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/**
 * Money that came in (positive) or went back out (negative), with the date it happened.
 * Paid invoices are the money in. Payments with an amount of their own that no invoice covers
 * count too, and every refund is money out.
 * @param {Array<Object>} payments - Payment records
 * @param {Array<Object>} invoices - Invoice records
 * @param {Map<string, number>} invoiceTotals - From paidInvoiceTotals()
 * @returns {Array<{pounds: number, date: Date|null}>} Money movements
 */
function moneyMovements(payments, invoices, invoiceTotals) {
  const movements = [];
  for (const invoice of invoices) {
    if (invoice && invoice.status === 'paid' && toPounds(invoice.amount)) {
      movements.push({
        pounds: toPounds(invoice.amount),
        date: validDate(invoice.paidAt || invoice.createdAt),
      });
    }
  }
  for (const payment of payments) {
    const group = statusGroup(payment.status);
    const own = toPounds(payment.amount);
    const covered = invoiceTotals.has(payment.stripePaymentId);
    if (own && !covered && (group === GROUPS.PAID || group === GROUPS.REFUNDED)) {
      movements.push({ pounds: own, date: validDate(payment.createdAt) });
    }
    if (group === GROUPS.REFUNDED) {
      const refunded = refundedPounds(payment, paymentAmount(payment, invoiceTotals));
      if (refunded) {
        const metadata = payment.metadata || {};
        movements.push({
          pounds: -refunded,
          date: validDate(metadata.refundedAt || payment.updatedAt || payment.createdAt),
        });
      }
    }
  }
  return movements;
}

/**
 * Turns payment, user, invoice and subscription records into what the Payments page shows.
 * @param {Object} records
 * @param {Array<Object>} records.payments - payments collection
 * @param {Array<Object>} records.users - users collection
 * @param {Array<Object>} records.invoices - invoices collection
 * @param {Array<Object>} records.subscriptions - subscriptions collection
 * @param {Date} [records.now] - Current time
 * @returns {{items: Object[], summary: Object}} Rows (newest first) and headline numbers
 */
function buildPaymentsView({ payments, users, invoices, subscriptions, now = new Date() }) {
  const usersById = new Map(users.map(user => [user.id, user]));
  const invoiceTotals = paidInvoiceTotals(invoices);

  const items = payments.map(payment => {
    const user = usersById.get(payment.userId) || null;
    const metadata = payment.metadata || {};
    const group = statusGroup(payment.status);
    const amount = paymentAmount(payment, invoiceTotals);
    const key = planKey(payment.planId || metadata.planId, metadata.billingInterval);
    return {
      id: payment.id,
      stripePaymentId: payment.stripePaymentId || null,
      userId: payment.userId || null,
      customerName: (user && (user.name || user.displayName)) || null,
      customerEmail: (user && user.email) || null,
      planId: key,
      planName: key ? PLAN_NAMES[key] : metadata.planName || null,
      amount,
      refundedAmount: group === GROUPS.REFUNDED ? refundedPounds(payment, amount) : 0,
      currency: payment.currency || 'gbp',
      status: payment.status || 'unknown',
      statusGroup: group,
      createdAt: payment.createdAt || null,
    };
  });

  items.sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0));

  const thisMonth = monthKey(now);
  const summary = {
    totalRevenue: 0,
    monthRevenue: 0,
    refundedTotal: 0,
    totalTransactions: items.length,
    paidCount: items.filter(item => item.statusGroup === GROUPS.PAID).length,
    pendingCount: items.filter(item => item.statusGroup === GROUPS.PENDING).length,
    revenueByMonth: {},
    activeSubscriptions: 0,
    planDistribution: {},
  };

  for (const { pounds, date } of moneyMovements(payments, invoices, invoiceTotals)) {
    summary.totalRevenue += pounds;
    if (pounds < 0) {
      summary.refundedTotal -= pounds;
    }
    if (date) {
      const key = monthKey(date);
      summary.revenueByMonth[key] = (summary.revenueByMonth[key] || 0) + pounds;
      if (key === thisMonth) {
        summary.monthRevenue += pounds;
      }
    }
  }

  // Active subscriptions come from the subscriptions themselves (the same definition the
  // Analytics page uses), not from counting payments.
  for (const subscription of subscriptions) {
    if (ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
      summary.activeSubscriptions += 1;
      const key = planKey(subscription.plan, subscription.billingInterval) || 'other';
      summary.planDistribution[key] = (summary.planDistribution[key] || 0) + 1;
    }
  }

  // Money is shown to the penny; this keeps float addition from leaving 0.30000000000000004
  summary.totalRevenue = roundPounds(summary.totalRevenue);
  summary.monthRevenue = roundPounds(summary.monthRevenue);
  summary.refundedTotal = roundPounds(summary.refundedTotal);
  for (const key of Object.keys(summary.revenueByMonth)) {
    summary.revenueByMonth[key] = roundPounds(summary.revenueByMonth[key]);
  }

  return { items, summary };
}

module.exports = {
  GROUPS,
  PLAN_NAMES,
  buildPaymentsView,
  paymentAmount,
  refundedPounds,
  planKey,
  statusGroup,
};
