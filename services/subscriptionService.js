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
  if (!value) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed > new Date();
}

function isLiveEntitlement(subscription) {
  if (!subscription) return false;
  if (subscription.status !== 'active' && subscription.status !== 'trialing') return false;
  if (subscription.plan === 'free') return true;
  return isFuture(subscription.currentPeriodEnd) || isFuture(subscription.trialEnd);
}

async function persistUserSubscriptionState(userId, updates) {
  const nowIso = new Date().toISOString();
  await dbUnified.updateOne('users', { id: userId }, { $set: { ...updates, updatedAt: nowIso } });
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
}) {
  const now = new Date().toISOString();
  const trialEndIso = trialEnd ? trialEnd.toISOString() : null;
  const subscription = {
    id: store.uid('sub'),
    userId,
    plan,
    status: trialEnd ? 'trialing' : 'active',
    stripeSubscriptionId: stripeSubscriptionId || null,
    stripeCustomerId: stripeCustomerId || null,
    trialStart: trialEnd ? now : null,
    trialEnd: trialEndIso,
    currentPeriodStart: currentPeriodStart || now,
    currentPeriodEnd: currentPeriodEnd || null,
    nextBillingDate: currentPeriodEnd || trialEndIso,
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
    proExpiresAt: subscription.currentPeriodEnd || subscription.trialEnd || null,
  });
  return subscription;
}

async function getSubscription(subscriptionId) {
  const subscriptions = await dbUnified.read('subscriptions');
  return subscriptions.find(s => s.id === subscriptionId) || null;
}

async function getSubscriptionByUserId(userId) {
  const subscriptions = await dbUnified.read('subscriptions');
  return subscriptions.find(s => s.userId === userId && s.status !== 'canceled') || null;
}

async function getSubscriptionByStripeId(stripeSubscriptionId) {
  const subscriptions = await dbUnified.read('subscriptions');
  return subscriptions.find(s => s.stripeSubscriptionId === stripeSubscriptionId) || null;
}

async function updateSubscription(subscriptionId, updates) {
  const subscription = await getSubscription(subscriptionId);
  if (!subscription) throw new Error('Subscription not found');

  const updatePayload = { ...updates, updatedAt: new Date().toISOString() };
  await dbUnified.updateOne('subscriptions', { id: subscriptionId }, { $set: updatePayload });
  const updated = { ...subscription, ...updatePayload };

  const entitlementFieldsChanged = ['plan', 'status', 'currentPeriodEnd', 'trialEnd'].some(key =>
    Object.prototype.hasOwnProperty.call(updates, key)
  );
  if (entitlementFieldsChanged) {
    await persistUserSubscriptionState(updated.userId, {
      subscriptionTier: isLiveEntitlement(updated) ? updated.plan : 'free',
      isPro: isLiveEntitlement(updated) && updated.plan !== 'free',
      proExpiresAt: updated.currentPeriodEnd || updated.trialEnd || null,
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
      logger.info(`Plan change from ${subscription.plan} to ${newPlan}: no Stripe subscription linked`);
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
  const currentItem = stripeSub.items.data[0];
  if (!currentItem) throw new Error('No items found on Stripe subscription');

  if (newPlan === 'free') return;

  const { resolvePriceId } = require('../config/billingPlans');
  const interval = currentItem.price?.recurring?.interval || subscription.billingInterval || 'month';
  const newPriceId = resolvePriceId(newPlan, interval);
  if (!newPriceId) throw new Error(`No Stripe price ID configured for plan ${newPlan} (${interval})`);

  const isUpgrade = priceDifference > 0;
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    items: [{ id: currentItem.id, price: newPriceId }],
    proration_behavior: isUpgrade ? 'create_prorations' : 'none',
    metadata: { planId: newPlan, billingInterval: interval },
  });
}

async function upgradeSubscription(subscriptionId, newPlan, { skipStripe = false } = {}) {
  const subscription = await getSubscription(subscriptionId);
  if (!subscription) throw new Error('Subscription not found');

  const planHierarchy = ['free', 'pro', 'pro_plus'];
  const currentIndex = planHierarchy.indexOf(subscription.plan);
  const newIndex = planHierarchy.indexOf(newPlan);
  if (newIndex === -1) throw new Error(`Unknown plan: ${newPlan}`);
  if (newIndex <= currentIndex) throw new Error('New plan must be higher tier than current plan');

  if (!skipStripe) await processSubscriptionPlanChange(subscription, newPlan);

  return updateSubscription(subscriptionId, {
    plan: newPlan,
    status: 'active',
    pendingPlan: null,
    cancelAtPeriodEnd: false,
  });
}

async function downgradeSubscription(subscriptionId, newPlan, { skipStripe = false } = {}) {
  const subscription = await getSubscription(subscriptionId);
  if (!subscription) throw new Error('Subscription not found');

  const planHierarchy = ['free', 'pro', 'pro_plus'];
  const currentIndex = planHierarchy.indexOf(subscription.plan);
  const newIndex = planHierarchy.indexOf(newPlan);
  if (newIndex === -1) throw new Error(`Unknown plan: ${newPlan}`);
  if (newIndex >= currentIndex) throw new Error('New plan must be lower tier than current plan');

  if (!skipStripe) await processSubscriptionPlanChange(subscription, newPlan);

  return updateSubscription(subscriptionId, { pendingPlan: newPlan, cancelAtPeriodEnd: true });
}

async function applyPendingPlan(subscriptionId) {
  const subscription = await getSubscription(subscriptionId);
  if (!subscription || !subscription.pendingPlan) return null;
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
  if (!subscription) throw new Error('Subscription not found');

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
  const users = await dbUnified.read('users');
  const user = users.find(u => u.id === userId);
  if (user?.subscriptionTier && user.subscriptionTier !== 'free' && isFuture(user.proExpiresAt)) {
    return user.subscriptionTier;
  }
  return 'free';
}

async function checkFeatureAccess(userId, feature) {
  const subscription = await getSubscriptionByUserId(userId);
  if (subscription) return hasFeature(isLiveEntitlement(subscription) ? subscription.plan : 'free', feature);
  return hasFeature(await getFallbackUserTier(userId), feature);
}

async function getUserFeatures(userId) {
  const subscription = await getSubscriptionByUserId(userId);
  if (subscription) return getPlanFeatures(isLiveEntitlement(subscription) ? subscription.plan : 'free');
  return getPlanFeatures(await getFallbackUserTier(userId));
}

async function enforceActivePackageLimit(userId) {
  const features = await getUserFeatures(userId);
  const maxPackages = features.features.maxPackages;
  if (maxPackages === -1) return [];

  const allSuppliers = await dbUnified.read('suppliers');
  const supplierIds = allSuppliers.filter(s => s.ownerUserId === userId).map(s => s.id);
  if (supplierIds.length === 0) return [];

  const allPkgs = await dbUnified.read('packages');
  const activePkgs = allPkgs.filter(p => supplierIds.includes(p.supplierId) && p.paused !== true);
  if (activePkgs.length <= maxPackages) return [];

  const sorted = [...activePkgs].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return aTime - bTime;
  });
  const toPause = sorted.slice(0, sorted.length - maxPackages);
  const pausedIds = [];
  for (const pkg of toPause) {
    await dbUnified.updateOne('packages', { id: pkg.id }, { $set: { paused: true, updatedAt: Date.now() } });
    pausedIds.push(pkg.id);
  }
  return pausedIds;
}

async function addBillingRecord(subscriptionId, billingRecord) {
  const subscription = await getSubscription(subscriptionId);
  if (!subscription) throw new Error('Subscription not found');
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
  return !!subscription?.trialEnd && isFuture(subscription.trialEnd) && subscription.status === 'trialing';
}

async function listSubscriptions(filters = {}) {
  const subscriptions = await dbUnified.read('subscriptions');
  let result = subscriptions;
  if (filters.status) result = result.filter(s => s.status === filters.status);
  if (filters.plan) result = result.filter(s => s.plan === filters.plan);
  if (filters.userId) result = result.filter(s => s.userId === filters.userId);
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
