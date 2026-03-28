/**
 * Payment Service
 * Handles Stripe payment processing, refunds, and dunning management
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { uid } = require('../store');

// Initialize Stripe only if configured
let stripe = null;
let STRIPE_ENABLED = false;

try {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (stripeSecretKey) {
    // eslint-disable-next-line global-require
    const stripeLib = require('stripe');
    stripe = stripeLib(stripeSecretKey, {
      apiVersion: '2025-12-15',
    });
    STRIPE_ENABLED = true;
  }
} catch (err) {
  logger.error('Failed to initialize Stripe in payment service:', err.message);
}

/**
 * Retry a Stripe API call with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @returns {Promise<any>} Result of the function
 */
async function retryStripeCall(fn, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on user errors (invalid card, etc.)
      if (
        error.type === 'card_error' ||
        error.type === 'invalid_request_error' ||
        error.statusCode === 400 ||
        error.statusCode === 401 ||
        error.statusCode === 403 ||
        error.statusCode === 404
      ) {
        throw error;
      }

      // Don't retry on the last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = 2 ** (attempt - 1) * 1000;
      logger.warn(
        `Stripe API call failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${delay}ms...`
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Create or retrieve Stripe customer
 * @param {Object} user - User object
 * @returns {Promise<Object>} Stripe customer object
 */
async function getOrCreateStripeCustomer(user) {
  if (!STRIPE_ENABLED || !stripe) {
    throw new Error('Stripe is not configured');
  }

  // Check if user already has a customer ID
  const payments = await dbUnified.read('payments');
  const existingCustomerId = payments.find(
    p => p.userId === user.id && p.stripeCustomerId
  )?.stripeCustomerId;

  if (existingCustomerId) {
    try {
      return await stripe.customers.retrieve(existingCustomerId);
    } catch (err) {
      logger.warn('Failed to retrieve existing customer:', err.message);
    }
  }

  // Create new customer
  return await stripe.customers.create({
    email: user.email,
    name: user.name || '',
    metadata: {
      userId: user.id,
    },
  });
}

/**
 * Create Stripe subscription
 * @param {Object} params - Subscription parameters
 * @param {string} params.customerId - Stripe customer ID
 * @param {string} params.priceId - Stripe price ID
 * @param {Object} params.metadata - Additional metadata
 * @param {string} params.couponId - Coupon/discount ID (optional)
 * @param {number} params.trialPeriodDays - Trial period in days (optional)
 * @returns {Promise<Object>} Stripe subscription object
 */
async function createStripeSubscription({
  customerId,
  priceId,
  metadata = {},
  couponId = null,
  trialPeriodDays = null,
}) {
  if (!STRIPE_ENABLED || !stripe) {
    throw new Error('Stripe is not configured');
  }

  const subscriptionParams = {
    customer: customerId,
    items: [{ price: priceId }],
    metadata,
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent'],
  };

  if (couponId) {
    subscriptionParams.coupon = couponId;
  }

  if (trialPeriodDays) {
    subscriptionParams.trial_period_days = trialPeriodDays;
  }

  return await retryStripeCall(() => stripe.subscriptions.create(subscriptionParams));
}

/**
 * Update Stripe subscription
 * @param {string} subscriptionId - Stripe subscription ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated Stripe subscription
 */
async function updateStripeSubscription(subscriptionId, updates) {
  if (!STRIPE_ENABLED || !stripe) {
    throw new Error('Stripe is not configured');
  }

  return await stripe.subscriptions.update(subscriptionId, updates);
}

/**
 * Cancel Stripe subscription
 * @param {string} subscriptionId - Stripe subscription ID
 * @param {boolean} immediately - Cancel immediately vs at period end
 * @returns {Promise<Object>} Canceled subscription
 */
async function cancelStripeSubscription(subscriptionId, immediately = false) {
  if (!STRIPE_ENABLED || !stripe) {
    throw new Error('Stripe is not configured');
  }

  if (immediately) {
    return await stripe.subscriptions.cancel(subscriptionId);
  } else {
    return await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  }
}

/**
 * Process refund for a payment
 * @param {string} paymentIntentId - Stripe payment intent ID
 * @param {number} amount - Amount to refund (optional, full refund if not specified)
 * @param {string} reason - Refund reason
 * @returns {Promise<Object>} Refund object
 */
async function processRefund(paymentIntentId, amount = null, reason = 'requested_by_customer') {
  if (!STRIPE_ENABLED || !stripe) {
    throw new Error('Stripe is not configured');
  }

  const refundParams = {
    payment_intent: paymentIntentId,
    reason,
  };

  if (amount) {
    refundParams.amount = Math.round(amount * 100); // Convert to cents
  }

  return await stripe.refunds.create(refundParams);
}

/**
 * Retrieve payment intent
 * @param {string} paymentIntentId - Payment intent ID
 * @returns {Promise<Object>} Payment intent object
 */
async function getPaymentIntent(paymentIntentId) {
  if (!STRIPE_ENABLED || !stripe) {
    throw new Error('Stripe is not configured');
  }

  return await stripe.paymentIntents.retrieve(paymentIntentId);
}

/**
 * Retry failed invoice payment
 * @param {string} invoiceId - Stripe invoice ID
 * @returns {Promise<Object>} Invoice object
 */
async function retryInvoicePayment(invoiceId) {
  if (!STRIPE_ENABLED || !stripe) {
    throw new Error('Stripe is not configured');
  }

  const invoice = await stripe.invoices.retrieve(invoiceId);

  if (invoice.status === 'paid') {
    return invoice;
  }

  // Attempt to pay the invoice
  return await stripe.invoices.pay(invoiceId);
}

/**
 * Create payment record in database
 * @param {Object} params - Payment parameters
 * @returns {Promise<Object>} Created payment record
 */
async function createPaymentRecord(params) {
  const payment = {
    id: uid('pay'),
    stripePaymentId: params.stripePaymentId || null,
    stripeCustomerId: params.stripeCustomerId || null,
    stripeSubscriptionId: params.stripeSubscriptionId || null,
    userId: params.userId,
    amount: params.amount,
    currency: params.currency || 'usd',
    status: params.status || 'pending',
    type: params.type || 'one_time',
    subscriptionDetails: params.subscriptionDetails || null,
    metadata: params.metadata || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await dbUnified.insertOne('payments', payment);
  return payment;
}

/**
 * Update payment record
 * @param {string} paymentId - Payment ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated payment record
 */
async function updatePaymentRecord(paymentId, updates) {
  const payments = await dbUnified.read('payments');
  const payment = payments.find(p => p.id === paymentId);

  if (!payment) {
    throw new Error('Payment not found');
  }

  const paymentUpdates = { ...updates, updatedAt: new Date().toISOString() };
  await dbUnified.updateOne('payments', { id: paymentId }, { $set: paymentUpdates });
  return { ...payment, ...paymentUpdates };
}

/**
 * Get payment by Stripe payment intent ID
 * @param {string} stripePaymentId - Stripe payment intent ID
 * @returns {Promise<Object|null>} Payment record or null
 */
async function getPaymentByStripeId(stripePaymentId) {
  const payments = await dbUnified.read('payments');
  return payments.find(p => p.stripePaymentId === stripePaymentId) || null;
}

/**
 * Handle dunning management for failed payments
 * @param {string} subscriptionId - Subscription ID
 * @param {Object} invoice - Failed invoice object
 * @returns {Promise<void>}
 */
async function handleFailedPayment(subscriptionId, invoice) {
  // Avoid circular dependency by lazy loading
  const subscriptionService = require('./subscriptionService');

  // Update subscription status to past_due
  await subscriptionService.updateSubscription(subscriptionId, {
    status: 'past_due',
  });

  // Log the failed payment attempt
  logger.info(`Payment failed for subscription ${subscriptionId}, invoice ${invoice.id}`);

  // In a production system, you would:
  // 1. Send notification to user about failed payment
  // 2. Schedule retry attempts (Stripe handles this automatically)
  // 3. Update billing history
  // 4. Potentially downgrade or suspend service after multiple failures
}

/**
 * Calculate Monthly Recurring Revenue (MRR)
 * @returns {Promise<Object>} MRR statistics
 */
async function calculateMRR() {
  const subscriptions = await dbUnified.read('subscriptions');
  const { PLAN_FEATURES } = require('../models/Subscription');

  let totalMRR = 0;
  const mrrByPlan = {};

  subscriptions.forEach(sub => {
    if (sub.status === 'active' || sub.status === 'trialing') {
      const planPrice = PLAN_FEATURES[sub.plan]?.price || 0;
      totalMRR += planPrice;
      mrrByPlan[sub.plan] = (mrrByPlan[sub.plan] || 0) + planPrice;
    }
  });

  return {
    totalMRR,
    byPlan: mrrByPlan,
    activeSubscriptions: subscriptions.filter(s => s.status === 'active' || s.status === 'trialing')
      .length,
  };
}

/**
 * Calculate churn rate
 * @param {number} days - Period in days to calculate churn (default 30)
 * @returns {Promise<Object>} Churn statistics
 */
async function calculateChurnRate(days = 30) {
  const subscriptions = await dbUnified.read('subscriptions');
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const activeAtStart = subscriptions.filter(sub => {
    const createdDate = new Date(sub.createdAt);
    return createdDate < cutoffDate && (sub.status === 'active' || sub.status === 'trialing');
  });

  const canceled = subscriptions.filter(sub => {
    if (!sub.canceledAt) {
      return false;
    }
    const canceledDate = new Date(sub.canceledAt);
    return canceledDate >= cutoffDate;
  });

  const churnRate = activeAtStart.length > 0 ? (canceled.length / activeAtStart.length) * 100 : 0;

  return {
    period: `${days} days`,
    activeAtStart: activeAtStart.length,
    canceled: canceled.length,
    churnRate: churnRate.toFixed(2),
  };
}

module.exports = {
  getOrCreateStripeCustomer,
  createStripeSubscription,
  updateStripeSubscription,
  cancelStripeSubscription,
  processRefund,
  getPaymentIntent,
  retryInvoicePayment,
  createPaymentRecord,
  updatePaymentRecord,
  getPaymentByStripeId,
  handleFailedPayment,
  calculateMRR,
  calculateChurnRate,
  STRIPE_ENABLED,
};
