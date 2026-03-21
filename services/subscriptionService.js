/**
 * Subscription Service
 * Handles subscription lifecycle, upgrades, downgrades, cancellations, and feature gating
 */

'use strict';

const dbUnified = require('../db-unified');
const store = require('../store');
const {
  getPlanFeatures,
  hasFeature,
  getAllPlans,
  PLAN_FEATURES,
} = require('../models/Subscription');
const logger = require('../utils/logger');

async function persistUserSubscriptionState(userId, updates) {
  const nowIso = new Date().toISOString();
  const normalizedUpdates = {
    ...updates,
    updatedAt: nowIso,
  };

  await dbUnified.updateOne('users', { id: userId }, { $set: normalizedUpdates });
}

/**
 * Create a new subscription
 * @param {Object} params - Subscription parameters
 * @param {string} params.userId - User ID
 * @param {string} params.plan - Plan tier (free, pro, pro_plus, enterprise)
 * @param {string} params.stripeSubscriptionId - Stripe subscription ID
 * @param {string} params.stripeCustomerId - Stripe customer ID
 * @param {Date} params.trialEnd - Trial end date (optional)
 * @returns {Promise<Object>} Created subscription
 */
async function createSubscription({
  userId,
  plan,
  stripeSubscriptionId,
  stripeCustomerId,
  trialEnd = null,
}) {
  const now = new Date().toISOString();
  const subscription = {
    id: store.uid('sub'),
    userId,
    plan,
    status: trialEnd ? 'trialing' : 'active',
    stripeSubscriptionId: stripeSubscriptionId || null,
    stripeCustomerId: stripeCustomerId || null,
    trialStart: trialEnd ? now : null,
    trialEnd: trialEnd ? trialEnd.toISOString() : null,
    currentPeriodStart: now,
    currentPeriodEnd: null,
    nextBillingDate: trialEnd ? trialEnd.toISOString() : null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    cancelReason: null,
    billingHistory: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };

  await dbUnified.insertOne('subscriptions', subscription);

  // Update user record with subscription reference and tier.
  await persistUserSubscriptionState(userId, {
    subscriptionId: subscription.id,
    subscriptionTier: plan,
    isPro: plan !== 'free',
  });

  return subscription;
}

/**
 * Get subscription by ID
 * @param {string} subscriptionId - Subscription ID
 * @returns {Promise<Object|null>} Subscription object or null
 */
async function getSubscription(subscriptionId) {
  const subscriptions = await dbUnified.read('subscriptions');
  return subscriptions.find(s => s.id === subscriptionId) || null;
}

/**
 * Get subscription by user ID
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Subscription object or null
 */
async function getSubscriptionByUserId(userId) {
  const subscriptions = await dbUnified.read('subscriptions');
  return subscriptions.find(s => s.userId === userId && s.status !== 'canceled') || null;
}

/**
 * Get subscription by Stripe subscription ID
 * @param {string} stripeSubscriptionId - Stripe subscription ID
 * @returns {Promise<Object|null>} Subscription object or null
 */
async function getSubscriptionByStripeId(stripeSubscriptionId) {
  const subscriptions = await dbUnified.read('subscriptions');
  return subscriptions.find(s => s.stripeSubscriptionId === stripeSubscriptionId) || null;
}

/**
 * Update subscription
 * @param {string} subscriptionId - Subscription ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated subscription
 */
async function updateSubscription(subscriptionId, updates) {
  const subscriptions = await dbUnified.read('subscriptions');
  const subscription = subscriptions.find(s => s.id === subscriptionId);

  if (!subscription) {
    throw new Error('Subscription not found');
  }

  Object.assign(subscription, updates, {
    updatedAt: new Date().toISOString(),
  });

  await dbUnified.updateOne(
    'subscriptions',
    { id: subscriptionId },
    {
      $set: { ...updates, updatedAt: new Date().toISOString() },
    }
  );

  // Update user isPro status and subscriptionTier if plan changed
  if (updates.plan) {
    await persistUserSubscriptionState(subscription.userId, {
      subscriptionTier: updates.plan,
      isPro: updates.plan !== 'free',
    });
  }

  return subscription;
}

/**
 * Process pro-rated payment difference when changing subscription plan.
 * Uses Stripe's proration API when a Stripe subscription ID is present.
 * Gracefully skips payment processing when Stripe is not configured.
 *
 * @param {Object} subscription - Current subscription object
 * @param {string} newPlan - New plan tier
 * @returns {Promise<void>}
 */
async function processSubscriptionPlanChange(subscription, newPlan) {
  const oldPrice = PLAN_FEATURES[subscription.plan]?.price || 0;
  const newPrice = PLAN_FEATURES[newPlan]?.price || 0;
  const priceDifference = newPrice - oldPrice;

  // If there's no Stripe subscription ID, skip Stripe payment processing
  if (!subscription.stripeSubscriptionId) {
    if (priceDifference !== 0) {
      logger.info(
        `Plan change from ${subscription.plan} to ${newPlan}: ` +
          `price difference £${priceDifference.toFixed(2)}/mo — no Stripe subscription linked, skipping payment processing`
      );
    }
    return;
  }

  // Lazy-load paymentService to avoid circular dependency
  const paymentService = require('./paymentService');

  if (!paymentService.STRIPE_ENABLED) {
    logger.warn(
      `Plan change from ${subscription.plan} to ${newPlan}: ` +
        `Stripe is not configured — skipping prorated payment processing`
    );
    return;
  }

  try {
    // Retrieve current Stripe subscription to get the current price item
    const stripeConfig = require('../config/stripe');
    const stripe = stripeConfig.getStripeClient();

    if (!stripe) {
      logger.warn('Stripe client unavailable — skipping prorated payment processing');
      return;
    }

    const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const currentItem = stripeSub.items.data[0];

    if (!currentItem) {
      logger.warn(
        `No items found on Stripe subscription ${subscription.stripeSubscriptionId} — skipping proration`
      );
      return;
    }

    // Look up the Stripe price ID for the new plan using the same env var convention
    // as the rest of the codebase (see routes/subscriptions-v2.js and routes/payments.js).
    //   STRIPE_PRO_PRICE_ID       → pro plan monthly price ID
    //   STRIPE_PRO_PLUS_PRICE_ID  → pro_plus plan monthly price ID
    //   STRIPE_BASIC_PRICE_ID     → basic plan monthly price ID  (if using basic tier)
    //   STRIPE_ENTERPRISE_PRICE_ID → enterprise plan monthly price ID
    // Set these in your .env file (see .env.example for details).
    const PLAN_PRICE_ENV_MAP = {
      free: null, // Free plan — no Stripe price needed; cancellation is handled separately
      pro: process.env.STRIPE_PRO_PRICE_ID || null,
      pro_plus: process.env.STRIPE_PRO_PLUS_PRICE_ID || null,
    };

    // Changing to the free plan requires subscription cancellation, not a price change.
    // Callers should use cancelSubscription() instead.
    if (newPlan === 'free') {
      logger.info(
        `Plan change to "free" — subscription cancellation should be handled via cancelSubscription(). Skipping Stripe price update.`
      );
      return;
    }

    const newPriceId = PLAN_PRICE_ENV_MAP[newPlan];

    if (!newPriceId) {
      // Map plan name to the conventional env var name used across the codebase
      const PLAN_ENV_VAR_NAMES = {
        pro: 'STRIPE_PRO_PRICE_ID',
        pro_plus: 'STRIPE_PRO_PLUS_PRICE_ID',
      };
      const envVarHint = PLAN_ENV_VAR_NAMES[newPlan] || `STRIPE_${newPlan.toUpperCase()}_PRICE_ID`;
      logger.warn(
        `No Stripe price ID configured for plan "${newPlan}" (set ${envVarHint} in .env). ` +
          `Skipping Stripe proration — update the subscription plan in the Stripe dashboard manually.`
      );
      return;
    }

    // Apply proration immediately for upgrades (create_prorations charges the customer for the
    // remainder of the current billing period at the new higher price).
    // For downgrades, use 'none' and set cancel_at_period_end on the subscription item so the
    // customer keeps access until the end of the paid period and is billed at the lower rate
    // on the next renewal date.
    const isUpgrade = priceDifference > 0;
    const updateParams = {
      items: [{ id: currentItem.id, price: newPriceId }],
      proration_behavior: isUpgrade ? 'create_prorations' : 'none',
    };

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, updateParams);

    logger.info(
      `Stripe subscription ${subscription.stripeSubscriptionId} updated: ` +
        `${subscription.plan} → ${newPlan}, proration_behavior=${isUpgrade ? 'create_prorations' : 'none'}`
    );
  } catch (err) {
    // Payment failure should not block the local subscription record update;
    // log the error so ops can investigate and retry manually.
    logger.error(
      `Failed to process Stripe proration for subscription ${subscription.stripeSubscriptionId}: ${err.message}`
    );
    throw err;
  }
}

/**
 * Upgrade subscription to a higher tier.
 * The upgrade applies immediately and clears any pending downgrade.
 *
 * @param {string} subscriptionId - Subscription ID
 * @param {string} newPlan - New plan tier (must be higher than current)
 * @returns {Promise<Object>} Updated subscription
 */
async function upgradeSubscription(subscriptionId, newPlan) {
  const subscription = await getSubscription(subscriptionId);

  if (!subscription) {
    throw new Error('Subscription not found');
  }

  const planHierarchy = ['free', 'pro', 'pro_plus'];
  const currentIndex = planHierarchy.indexOf(subscription.plan);
  const newIndex = planHierarchy.indexOf(newPlan);

  if (newIndex === -1) {
    throw new Error(`Unknown plan: ${newPlan}`);
  }

  if (newIndex <= currentIndex) {
    throw new Error('New plan must be higher tier than current plan');
  }

  // Process prorated payment difference via Stripe
  await processSubscriptionPlanChange(subscription, newPlan);

  // Upgrades apply immediately — clear any pending downgrade
  return updateSubscription(subscriptionId, {
    plan: newPlan,
    status: 'active',
    pendingPlan: null,
  });
}

/**
 * Schedule a downgrade to a lower tier at the end of the current billing period.
 * The current plan (and its access rights) are preserved until `applyPendingPlan`
 * is called when Stripe signals the period has ended.
 *
 * @param {string} subscriptionId - Subscription ID
 * @param {string} newPlan - New (lower) plan tier
 * @returns {Promise<Object>} Updated subscription
 */
async function downgradeSubscription(subscriptionId, newPlan) {
  const subscription = await getSubscription(subscriptionId);

  if (!subscription) {
    throw new Error('Subscription not found');
  }

  const planHierarchy = ['free', 'pro', 'pro_plus'];
  const currentIndex = planHierarchy.indexOf(subscription.plan);
  const newIndex = planHierarchy.indexOf(newPlan);

  if (newIndex === -1) {
    throw new Error(`Unknown plan: ${newPlan}`);
  }

  if (newIndex >= currentIndex) {
    throw new Error('New plan must be lower tier than current plan');
  }

  // Inform Stripe of the upcoming price change without immediate proration
  await processSubscriptionPlanChange(subscription, newPlan);

  // Store the desired next plan but keep `plan` unchanged so the user retains
  // their current access rights until the billing period ends.
  return updateSubscription(subscriptionId, {
    pendingPlan: newPlan,
    cancelAtPeriodEnd: true,
  });
}

/**
 * Apply a pending plan change when the current billing period ends.
 * Called by the Stripe webhook when a renewal/deletion event confirms the
 * period has ended and the scheduled downgrade should take effect.
 *
 * @param {string} subscriptionId - Subscription ID
 * @returns {Promise<Object|null>} Updated subscription, or null if nothing to apply
 */
async function applyPendingPlan(subscriptionId) {
  const subscription = await getSubscription(subscriptionId);

  if (!subscription || !subscription.pendingPlan) {
    return null;
  }

  return updateSubscription(subscriptionId, {
    plan: subscription.pendingPlan,
    pendingPlan: null,
    cancelAtPeriodEnd: false,
  });
}

/**
 * Cancel subscription
 * @param {string} subscriptionId - Subscription ID
 * @param {string} reason - Cancellation reason (optional)
 * @param {boolean} immediately - Cancel immediately vs at period end
 * @returns {Promise<Object>} Updated subscription
 */
async function cancelSubscription(subscriptionId, reason = null, immediately = false) {
  const subscription = await getSubscription(subscriptionId);

  if (!subscription) {
    throw new Error('Subscription not found');
  }

  const updates = {
    canceledAt: new Date().toISOString(),
    cancelReason: reason,
  };

  if (immediately) {
    updates.status = 'canceled';
    updates.plan = 'free';
  } else {
    updates.cancelAtPeriodEnd = true;
  }

  return updateSubscription(subscriptionId, updates);
}

/**
 * Check if user has access to a feature
 * @param {string} userId - User ID
 * @param {string} feature - Feature name
 * @returns {Promise<boolean>} Whether user has feature access
 */
async function checkFeatureAccess(userId, feature) {
  const subscription = await getSubscriptionByUserId(userId);

  if (subscription) {
    const { plan, status, currentPeriodEnd } = subscription;
    const periodValid = !currentPeriodEnd || new Date(currentPeriodEnd) > new Date();
    if ((status === 'active' || status === 'trialing') && periodValid) {
      return hasFeature(plan, feature);
    }
  }

  // Fallback: check subscriptionTier on user record (set by Stripe webhook)
  const users = await dbUnified.read('users');
  const user = users.find(u => u.id === userId);
  if (user?.subscriptionTier && user.subscriptionTier !== 'free') {
    if (!user.proExpiresAt || new Date(user.proExpiresAt) > new Date()) {
      return hasFeature(user.subscriptionTier, feature);
    }
  }

  // No subscription, check free plan
  return hasFeature('free', feature);
}

/**
 * Get features for user's subscription
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Feature configuration
 */
async function getUserFeatures(userId) {
  const subscription = await getSubscriptionByUserId(userId);

  if (!subscription) {
    return getPlanFeatures('free');
  }

  return getPlanFeatures(subscription.plan);
}

/**
 * Add billing record to subscription
 * @param {string} subscriptionId - Subscription ID
 * @param {Object} billingRecord - Billing record details
 * @returns {Promise<Object>} Updated subscription
 */
async function addBillingRecord(subscriptionId, billingRecord) {
  const subscription = await getSubscription(subscriptionId);

  if (!subscription) {
    throw new Error('Subscription not found');
  }

  const billingHistory = subscription.billingHistory || [];
  billingHistory.push({
    invoiceId: billingRecord.invoiceId,
    amount: billingRecord.amount,
    currency: billingRecord.currency,
    paid: billingRecord.paid,
    date: billingRecord.date || new Date().toISOString(),
  });

  return updateSubscription(subscriptionId, {
    billingHistory,
  });
}

/**
 * Update subscription billing dates
 * @param {string} subscriptionId - Subscription ID
 * @param {Date} periodStart - Period start date
 * @param {Date} periodEnd - Period end date
 * @returns {Promise<Object>} Updated subscription
 */
async function updateBillingDates(subscriptionId, periodStart, periodEnd) {
  return updateSubscription(subscriptionId, {
    currentPeriodStart: periodStart.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    nextBillingDate: periodEnd.toISOString(),
  });
}

/**
 * Check if subscription is in trial period
 * @param {Object} subscription - Subscription object
 * @returns {boolean} Whether subscription is in trial
 */
function isInTrial(subscription) {
  if (!subscription.trialEnd) {
    return false;
  }

  const now = new Date();
  const trialEnd = new Date(subscription.trialEnd);
  return now < trialEnd && subscription.status === 'trialing';
}

/**
 * Get all subscriptions with filters
 * @param {Object} filters - Query filters
 * @returns {Promise<Array>} Array of subscriptions
 */
async function listSubscriptions(filters = {}) {
  const subscriptions = await dbUnified.read('subscriptions');
  let result = subscriptions;

  if (filters.status) {
    result = result.filter(s => s.status === filters.status);
  }

  if (filters.plan) {
    result = result.filter(s => s.plan === filters.plan);
  }

  if (filters.userId) {
    result = result.filter(s => s.userId === filters.userId);
  }

  return result;
}

/**
 * Get subscription statistics
 * @returns {Promise<Object>} Subscription statistics
 */
async function getSubscriptionStats() {
  const subscriptions = await dbUnified.read('subscriptions');

  const stats = {
    total: subscriptions.length,
    active: subscriptions.filter(s => s.status === 'active').length,
    trialing: subscriptions.filter(s => s.status === 'trialing').length,
    canceled: subscriptions.filter(s => s.status === 'canceled').length,
    pastDue: subscriptions.filter(s => s.status === 'past_due').length,
    byPlan: {
      free: subscriptions.filter(s => s.plan === 'free').length,
      pro: subscriptions.filter(s => s.plan === 'pro').length,
      pro_plus: subscriptions.filter(s => s.plan === 'pro_plus').length,
    },
  };

  return stats;
}

module.exports = {
  createSubscription,
  getSubscription,
  getSubscriptionByUserId,
  getSubscriptionByStripeId,
  updateSubscription,
  upgradeSubscription,
  downgradeSubscription,
  applyPendingPlan,
  cancelSubscription,
  checkFeatureAccess,
  getUserFeatures,
  addBillingRecord,
  updateBillingDates,
  isInTrial,
  listSubscriptions,
  getSubscriptionStats,
  getAllPlans,
  processSubscriptionPlanChange,
};
