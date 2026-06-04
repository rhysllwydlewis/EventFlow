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

function isFuture(value) {
  if (!value) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed > new Date();
}

function isLiveEntitlement(subscription) {
  if (!subscription) {
    return false;
  }
  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    return false;
  }
  if (subscription.plan === 'free') {
    return true;
  }
  if (isFuture(subscription.currentPeriodEnd) || isFuture(subscription.trialEnd)) {
    return true;
  }
  return (
    !subscription.stripeSubscriptionId &&
    !subscription.currentPeriodEnd &&
    subscription.status === 'active'
  );
}

function addBillingPeriod(startIso, billingInterval = 'month') {
  const start = startIso ? new Date(startIso) : new Date();
  if (!Number.isFinite(start.getTime())) {
    return null;
  }
  const end = new Date(start);
  if (billingInterval === 'year') {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end.toISOString();
}

function resolveSubscriptionStatus({ status, trialEnd }) {
  if (status) {
    return status;
  }
  if (trialEnd) {
    return 'trialing';
  }
  return 'active';
}

async function persistUserSubscriptionState(userId, updates) {
  const nowIso = new Date().toISOString();
  const state = { ...updates, updatedAt: nowIso };
  await dbUnified.updateOne('users', { id: userId }, { $set: state });

  const supplierState = {};
  if (Object.prototype.hasOwnProperty.call(updates, 'subscriptionTier')) {
    supplierState.subscriptionTier = updates.subscriptionTier;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'isPro')) {
    supplierState.isPro = updates.isPro;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'proExpiresAt')) {
    supplierState.proExpiresAt = updates.proExpiresAt;
  }

  if (Object.keys(supplierState).length > 0) {
    try {
      const suppliers = await dbUnified.read('suppliers');
      const ownedSuppliers = suppliers.filter(s => s.ownerUserId === userId);
      await Promise.all(
        ownedSuppliers.map(supplier =>
          dbUnified.updateOne(
            'suppliers',
            { id: supplier.id },
            { $set: { ...supplierState, updatedAt: nowIso } }
          )
        )
      );
    } catch (err) {
      logger.warn('Unable to sync supplier subscription badges:', err.message);
    }
  }
}

async function createSubscription({
  userId,
  plan,
  stripeSubscriptionId,
  stripeCustomerId,
  trialEnd = null,
  billingInterval = null,
  currentPeriodStart = null,
  currentPeriodEnd = null,
  discountName = null,
  discountPercent = null,
  status = null,
}) {
  const now = new Date().toISOString();
  const trialEndIso = trialEnd ? trialEnd.toISOString() : null;
  const resolvedStatus = resolveSubscriptionStatus({ status, trialEnd, plan });
  const resolvedCurrentPeriodEnd =
    currentPeriodEnd ||
    (resolvedStatus === 'active' && plan !== 'free'
      ? addBillingPeriod(currentPeriodStart || now, billingInterval || 'month')
      : null);
  const subscription = {
    id: store.uid('sub'),
    userId,
    plan,
    status: resolvedStatus,
    stripeSubscriptionId: stripeSubscriptionId || null,
    stripeCustomerId: stripeCustomerId || null,
    trialStart: trialEnd ? now : null,
    trialEnd: trialEndIso,
    currentPeriodStart: currentPeriodStart || now,
    currentPeriodEnd: resolvedCurrentPeriodEnd,
    nextBillingDate: resolvedCurrentPeriodEnd || trialEndIso,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    cancelReason: null,
    billingInterval: billingInterval || null,
    discountName: discountName || null,
    discountPercent: discountPercent || null,
    billingHistory: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };

  await dbUnified.insertOne('subscriptions', subscription);
  await persistUserSubscriptionState(userId, {
    subscriptionId: subscription.id,
    subscriptionTier: isLiveEntitlement(subscription) ? plan : 'free',
    isPro: isLiveEntitlement(subscription) && plan !== 'free',
    proExpiresAt: isLiveEntitlement(subscription)
      ? subscription.currentPeriodEnd || subscription.trialEnd || null
      : null,
  });
  return subscription;
}

async function getSubscription(subscriptionId) {
  return dbUnified.findOne('subscriptions', { id: subscriptionId });
}

async function getSubscriptionByUserId(userId) {
  const subscriptions = await dbUnified.read('subscriptions');
  return (
    subscriptions
      .filter(s => s.userId === userId && s.status !== 'canceled')
      .sort((a, b) => {
        const aLive = isLiveEntitlement(a) ? 1 : 0;
        const bLive = isLiveEntitlement(b) ? 1 : 0;
        if (aLive !== bLive) {
          return bLive - aLive;
        }
        return (
          new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
        );
      })[0] || null
  );
}

async function getSubscriptionByStripeId(stripeSubscriptionId) {
  return dbUnified.findOne('subscriptions', { stripeSubscriptionId });
}

async function updateSubscription(subscriptionId, updates) {
  const subscription = await getSubscription(subscriptionId);
  if (!subscription) {
    throw new Error('Subscription not found');
  }

  const updatePayload = { ...updates, updatedAt: new Date().toISOString() };
  await dbUnified.updateOne('subscriptions', { id: subscriptionId }, { $set: updatePayload });
  const updated = { ...subscription, ...updatePayload };

  const entitlementFieldsChanged = ['plan', 'status', 'currentPeriodEnd', 'trialEnd'].some(key =>
    Object.prototype.hasOwnProperty.call(updates, key)
  );
  if (entitlementFieldsChanged) {
    const hasLiveEntitlement = isLiveEntitlement(updated);
    await persistUserSubscriptionState(updated.userId, {
      subscriptionTier: hasLiveEntitlement ? updated.plan : 'free',
      isPro: hasLiveEntitlement && updated.plan !== 'free',
      proExpiresAt: hasLiveEntitlement
        ? updated.currentPeriodEnd || updated.trialEnd || null
        : null,
    });
  }

  return updated;
}

async function processSubscriptionPlanChange(subscription, newPlan) {
  const oldPrice = PLAN_FEATURES[subscription.plan]?.price || 0;
  const newPrice = PLAN_FEATURES[newPlan]?.price || 0;
  const priceDifference = newPrice - oldPrice;

  if (!subscription.stripeSubscriptionId) {
    if (priceDifference !== 0) {
      logger.info(
        `Plan change from ${subscription.plan} to ${newPlan}: no Stripe subscription linked`
      );
    }
    return;
  }

  const paymentService = require('./paymentService');
  if (!paymentService.STRIPE_ENABLED) {
    logger.warn('Stripe is not configured — skipping prorated payment processing');
    return;
  }

  const stripeConfig = require('../config/stripe');
  const stripe = stripeConfig.getStripeClient();
  if (!stripe) {
    logger.warn('Stripe client unavailable — skipping prorated payment processing');
    return;
  }

  const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
  const currentItem = stripeSub.items?.data?.[0];
  if (!currentItem) {
    logger.warn('Stripe subscription has no items; skipping plan change');
    return;
  }

  if (newPlan === 'free') {
    return;
  }

  const { resolvePriceId } = require('../config/billingPlans');
  const interval =
    currentItem.price?.recurring?.interval || subscription.billingInterval || 'month';
  const envPriceIds = {
    pro: { month: process.env.STRIPE_PRO_PRICE_ID, year: process.env.STRIPE_PRO_YEARLY_PRICE_ID },
    pro_plus: {
      month: process.env.STRIPE_PRO_PLUS_PRICE_ID,
      year: process.env.STRIPE_PRO_PLUS_YEARLY_PRICE_ID,
    },
  };
  const newPriceId = resolvePriceId(newPlan, interval) || envPriceIds[newPlan]?.[interval] || null;
  if (!newPriceId) {
    logger.warn(
      `No Stripe price ID configured for plan ${newPlan} (${interval}); skipping plan change`
    );
    return;
  }

  const isUpgrade = priceDifference > 0;
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    items: [{ id: currentItem.id, price: newPriceId }],
    proration_behavior: isUpgrade ? 'create_prorations' : 'none',
    metadata: { planId: newPlan, billingInterval: interval },
  });
}

async function upgradeSubscription(subscriptionId, newPlan, { skipStripe = false } = {}) {
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

  if (!skipStripe) {
    await processSubscriptionPlanChange(subscription, newPlan);
  }

  return updateSubscription(subscriptionId, {
    plan: newPlan,
    status: 'active',
    pendingPlan: null,
    cancelAtPeriodEnd: false,
  });
}

async function downgradeSubscription(subscriptionId, newPlan, { skipStripe = false } = {}) {
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

  if (!skipStripe) {
    await processSubscriptionPlanChange(subscription, newPlan);
  }

  return updateSubscription(subscriptionId, { pendingPlan: newPlan, cancelAtPeriodEnd: true });
}

async function applyPendingPlan(subscriptionId) {
  const subscription = await getSubscription(subscriptionId);
  if (!subscription || !subscription.pendingPlan) {
    return null;
  }
  const updated = await updateSubscription(subscriptionId, {
    plan: subscription.pendingPlan,
    pendingPlan: null,
    cancelAtPeriodEnd: false,
  });
  try {
    await enforceActivePackageLimit(subscription.userId);
  } catch (err) {
    logger.error('applyPendingPlan: enforceActivePackageLimit failed:', err);
  }
  return updated;
}

async function cancelSubscription(subscriptionId, reason = null, immediately = false) {
  const subscription = await getSubscription(subscriptionId);
  if (!subscription) {
    throw new Error('Subscription not found');
  }

  const updates = { canceledAt: new Date().toISOString(), cancelReason: reason };
  if (immediately) {
    updates.status = 'canceled';
    updates.plan = 'free';
    updates.currentPeriodEnd = new Date().toISOString();
  } else {
    updates.cancelAtPeriodEnd = true;
  }
  const updated = await updateSubscription(subscriptionId, updates);

  if (immediately) {
    try {
      await enforceActivePackageLimit(subscription.userId);
    } catch (err) {
      logger.error('cancelSubscription: enforceActivePackageLimit failed:', err);
    }
  }
  return updated;
}

async function getFallbackUserTier(userId) {
  const user = await dbUnified.findOne('users', { id: userId });
  if (user?.subscriptionTier && user.subscriptionTier !== 'free' && isFuture(user.proExpiresAt)) {
    return user.subscriptionTier;
  }
  return 'free';
}

async function checkFeatureAccess(userId, feature) {
  const subscription = await getSubscriptionByUserId(userId);
  if (subscription) {
    return hasFeature(isLiveEntitlement(subscription) ? subscription.plan : 'free', feature);
  }
  return hasFeature(await getFallbackUserTier(userId), feature);
}

async function getUserFeatures(userId) {
  const subscription = await getSubscriptionByUserId(userId);
  if (subscription) {
    return getPlanFeatures(isLiveEntitlement(subscription) ? subscription.plan : 'free');
  }
  return getPlanFeatures(await getFallbackUserTier(userId));
}

async function enforceActivePackageLimit(userId) {
  const features = await getUserFeatures(userId);
  const maxPackages = features.features.maxPackages;
  if (maxPackages === -1) {
    return [];
  }

  const allSuppliers = await dbUnified.read('suppliers');
  const supplierIds = allSuppliers.filter(s => s.ownerUserId === userId).map(s => s.id);
  if (supplierIds.length === 0) {
    return [];
  }

  const allPkgs = await dbUnified.read('packages');
  const activePkgs = allPkgs.filter(p => supplierIds.includes(p.supplierId) && p.paused !== true);
  if (activePkgs.length <= maxPackages) {
    return [];
  }

  const sorted = [...activePkgs].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return aTime - bTime;
  });
  const toPause = sorted.slice(0, sorted.length - maxPackages);
  const pausedIds = [];
  for (const pkg of toPause) {
    await dbUnified.updateOne(
      'packages',
      { id: pkg.id },
      { $set: { paused: true, updatedAt: Date.now() } }
    );
    pausedIds.push(pkg.id);
  }
  return pausedIds;
}

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
  return updateSubscription(subscriptionId, { billingHistory });
}

async function updateBillingDates(subscriptionId, periodStart, periodEnd) {
  return updateSubscription(subscriptionId, {
    currentPeriodStart: periodStart.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    nextBillingDate: periodEnd.toISOString(),
  });
}

function isInTrial(subscription) {
  return (
    !!subscription?.trialEnd &&
    isFuture(subscription.trialEnd) &&
    subscription.status === 'trialing'
  );
}

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

async function getSubscriptionStats() {
  const subscriptions = await dbUnified.read('subscriptions');
  return {
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
  enforceActivePackageLimit,
  addBillingRecord,
  updateBillingDates,
  isInTrial,
  isLiveEntitlement,
  listSubscriptions,
  getSubscriptionStats,
  getAllPlans,
  processSubscriptionPlanChange,
};
