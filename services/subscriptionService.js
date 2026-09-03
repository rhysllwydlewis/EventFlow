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
  getAllPlans: getAllPlansRaw,
  PLAN_FEATURES,
} = require('../models/Subscription');
const { PLAN_PRESENTATION } = require('../config/billingPlans');
const logger = require('../utils/logger');
const postmark = require('../utils/postmark');

/**
 * Price actually charged for a plan, sourced from config/billingPlans.js —
 * the single canonical, customer-facing source of pricing (it also drives
 * /pricing and checkout). Used anywhere a real amount is shown to the
 * customer (confirmation emails, the plans API) so that figure can never
 * drift from what Stripe actually bills.
 * @param {string} plan - 'free' | 'pro' | 'pro_plus'
 * @param {string} [billingInterval] - 'month' | 'year'
 * @returns {number} Price in pounds
 */
function getCanonicalPlanPrice(plan, billingInterval = 'month') {
  const presentation = PLAN_PRESENTATION[plan];
  const interval = billingInterval === 'year' ? 'year' : 'month';
  const canonical = presentation?.pricing?.[interval]?.total;
  return Number.isFinite(canonical) ? canonical : getPlanFeatures(plan).price;
}

/**
 * getAllPlans, with price/interval corrected to the canonical values from
 * config/billingPlans.js rather than the hand-synced figures in
 * models/Subscription.js PLAN_FEATURES.
 * @returns {Array} Plan configurations
 */
function getAllPlans() {
  return getAllPlansRaw().map(plan => ({
    ...plan,
    price: getCanonicalPlanPrice(plan.id, 'month'),
  }));
}

// Human-readable feature bullets per plan, for the upgrade/downgrade
// confirmation emails. Kept local (rather than importing from
// webhooks/stripeWebhookHandler.js) to avoid a circular require — that file
// already requires this service.
const PLAN_EMAIL_FEATURES = {
  free: '<li>Basic messaging</li><li>Standard listing</li>',
  pro: '<li>Unlimited messaging</li><li>Advanced analytics</li><li>Priority listing</li><li>Priority support</li>',
  pro_plus:
    '<li>Unlimited messaging</li><li>Advanced analytics</li><li>Priority listing</li>' +
    '<li>Priority support</li><li>Custom branding</li><li>Homepage carousel</li>',
};

/**
 * Best-effort plan-change confirmation email. Never throws — a failure here
 * must not roll back or block the plan change itself.
 * @param {string} userId
 * @param {'upgraded'|'downgrade-scheduled'} kind
 * @param {Object} templateData
 */
async function sendPlanChangeEmail(userId, kind, templateData) {
  try {
    const users = await dbUnified.read('users');
    const user = users.find(u => u.id === userId);
    if (!user?.email) {
      return;
    }
    const template =
      kind === 'upgraded' ? 'subscription-upgraded' : 'subscription-downgrade-scheduled';
    const subject =
      kind === 'upgraded'
        ? 'Your EventFlow plan has been upgraded'
        : 'Your EventFlow plan change has been scheduled';
    await postmark.sendMail({
      to: user.email,
      subject,
      template,
      templateData: { name: user.name || 'there', ...templateData },
      from: postmark.FROM_BILLING,
      tags: [template, 'transactional'],
      messageStream: 'outbound',
    });
    logger.info(`Subscription ${kind} email sent to ${user.email}`);
  } catch (err) {
    logger.error(`Failed to send subscription ${kind} email:`, err.message);
  }
}

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
      const ownedSuppliers = await dbUnified.find('suppliers', { ownerUserId: userId }); // indexed
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

  const subInserted = await dbUnified.insertOne('subscriptions', subscription);
  if (!subInserted) {
    logger.error('[SUB-SVC] insertOne failed', { subscriptionId: subscription.id });
    throw new Error('Failed to save subscription record');
  }
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

function getSubscription(subscriptionId) {
  return dbUnified.findOne('subscriptions', { id: subscriptionId });
}

async function getSubscriptionByUserId(userId) {
  // Fetch only non-canceled subscriptions for this user — avoids full collection scan.
  // The $ne operator is supported by matchesFilter on the local store.
  const candidates = await dbUnified.find('subscriptions', {
    userId,
    status: { $ne: 'canceled' },
  });
  if (!candidates || candidates.length === 0) {
    return null;
  }
  // Sort to prefer live entitlements, then most recently updated
  return (
    candidates.sort((a, b) => {
      const aLive = isLiveEntitlement(a) ? 1 : 0;
      const bLive = isLiveEntitlement(b) ? 1 : 0;
      if (aLive !== bLive) {
        return bLive - aLive;
      }
      return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    })[0] || null
  );
}

function getSubscriptionByStripeId(stripeSubscriptionId) {
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

  const updated = await updateSubscription(subscriptionId, {
    plan: newPlan,
    status: 'active',
    pendingPlan: null,
    cancelAtPeriodEnd: false,
  });

  const newPlanFeatures = getPlanFeatures(newPlan);
  await sendPlanChangeEmail(subscription.userId, 'upgraded', {
    previousPlan: getPlanFeatures(subscription.plan).name,
    newPlan: newPlanFeatures.name,
    effectiveDate: new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    amount: getCanonicalPlanPrice(newPlan, subscription.billingInterval).toFixed(2),
    billingCycle: subscription.billingInterval === 'year' ? 'yearly' : 'monthly',
    features: PLAN_EMAIL_FEATURES[newPlan] || PLAN_EMAIL_FEATURES.free,
  });

  return updated;
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

  const updated = await updateSubscription(subscriptionId, {
    pendingPlan: newPlan,
    cancelAtPeriodEnd: true,
  });

  const currentPlanFeatures = getPlanFeatures(subscription.plan);
  const newPlanFeatures = getPlanFeatures(newPlan);
  const effectiveDate = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'the end of your current billing period';
  await sendPlanChangeEmail(subscription.userId, 'downgrade-scheduled', {
    currentPlan: currentPlanFeatures.name,
    newPlan: newPlanFeatures.name,
    currentAmount: getCanonicalPlanPrice(subscription.plan, subscription.billingInterval).toFixed(
      2
    ),
    newAmount: getCanonicalPlanPrice(newPlan, subscription.billingInterval).toFixed(2),
    billingCycle: subscription.billingInterval === 'year' ? 'yearly' : 'monthly',
    effectiveDate,
  });

  return updated;
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
  try {
    await enforcePhotoGalleryLimit(subscription.userId);
  } catch (err) {
    logger.error('applyPendingPlan: enforcePhotoGalleryLimit failed:', err);
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
    try {
      await enforcePhotoGalleryLimit(subscription.userId);
    } catch (err) {
      logger.error('cancelSubscription: enforcePhotoGalleryLimit failed:', err);
    }
  }
  return updated;
}

/**
 * Cancel a user's live Stripe subscription and mark it canceled locally.
 *
 * Account deletion must not leave a Stripe subscription billing someone who
 * no longer has an account, a dashboard, or a Billing Portal link to cancel
 * it themselves — see routes/profile.js (self-service delete) and
 * services/adminUserDeletion.service.js (admin-driven delete), both of which
 * call this before removing the user record.
 *
 * Cancels immediately rather than at period end: the account (and any
 * remaining service period the customer could still use) is being deleted
 * right now, so there is nothing left to run out the period for.
 *
 * Best-effort by design — a Stripe API failure is logged loudly (so it can
 * be caught and cancelled manually from the Stripe dashboard) but does not
 * throw, so a billing hiccup never blocks someone from deleting their own
 * account.
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function cancelSubscriptionForAccountDeletion(userId) {
  const subscription = await getSubscriptionByUserId(userId);
  if (!subscription || subscription.status === 'canceled') {
    return;
  }

  if (subscription.stripeSubscriptionId) {
    try {
      const paymentService = require('./paymentService');
      if (paymentService.STRIPE_ENABLED) {
        await paymentService.cancelStripeSubscription(subscription.stripeSubscriptionId, true);
      }
    } catch (err) {
      logger.error(
        `cancelSubscriptionForAccountDeletion: Stripe cancellation FAILED for user ${userId}, ` +
          `subscription ${subscription.stripeSubscriptionId} — MANUAL CANCELLATION REQUIRED in ` +
          `the Stripe dashboard:`,
        err.message
      );
    }
  }

  try {
    await cancelSubscription(subscription.id, 'Account deleted', true);
  } catch (err) {
    logger.error(
      `cancelSubscriptionForAccountDeletion: failed to update local subscription record for ` +
        `user ${userId}:`,
      err.message
    );
  }
}

async function getFallbackUserTier(userId) {
  const user = await dbUnified.findOne('users', { id: userId });
  if (user?.subscriptionTier && user.subscriptionTier !== 'free' && isFuture(user.proExpiresAt)) {
    return user.subscriptionTier;
  }
  return 'free';
}

/**
 * Re-derive isPro/subscriptionTier/proExpiresAt for a user (and every
 * supplier they own) from their actual subscription record.
 *
 * This exists so callers that want to reflect a subscription right after
 * checkout — before the Stripe webhook has necessarily landed — have a safe
 * way to do it: it only ever mirrors what `subscriptions` already says is
 * true, it never fabricates or grants a tier of its own accord. If no
 * subscription record exists yet, the user's current state is left
 * untouched rather than guessed at.
 * @param {string} userId
 * @returns {Promise<string>} The tier now reflected on the user record.
 */
async function refreshUserEntitlements(userId) {
  const subscription = await getSubscriptionByUserId(userId);
  if (!subscription) {
    return getFallbackUserTier(userId);
  }
  const live = isLiveEntitlement(subscription);
  const tier = live ? subscription.plan : 'free';
  await persistUserSubscriptionState(userId, {
    subscriptionTier: tier,
    isPro: live && subscription.plan !== 'free',
    proExpiresAt: live ? subscription.currentPeriodEnd || subscription.trialEnd || null : null,
  });
  return tier;
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

/**
 * Resolve a numeric allowance from the plan matrix for a user.
 *
 * The matrix uses -1 for "no limit". Callers get that back unchanged so they
 * can decide what unlimited means for them, rather than this guessing with a
 * sentinel of its own.
 * @param {string} userId Owner of the resource being limited.
 * @param {string} feature Feature key in `PLAN_FEATURES[tier].features`.
 * @param {number} fallback Value to use when the plan does not define one.
 * @returns {Promise<number>} The allowance, or -1 for unlimited.
 */
async function getNumericAllowance(userId, feature, fallback) {
  const features = await getUserFeatures(userId);
  const limit = features?.features?.[feature];
  return Number.isFinite(limit) ? limit : fallback;
}

/**
 * How many gallery photos a supplier's owner may publish.
 *
 * The uploader used to cap everyone at ten regardless of plan, which made
 * "unlimited photos" on Professional a promise the product did not keep. The
 * allowance now comes from the same matrix that gates package listings.
 * @param {string} ownerUserId Supplier's owner.
 * @returns {Promise<number>} Photo allowance, or -1 for unlimited.
 */
function getPhotoAllowance(ownerUserId) {
  return getNumericAllowance(ownerUserId, 'maxPhotos', 10);
}

/**
 * How far back a supplier may look in their profile analytics.
 *
 * Every tier can see their analytics; the paid plans see more history. That
 * is what makes the analytics row on the pricing page a real difference
 * rather than something free suppliers already had in full.
 * @param {string} ownerUserId Supplier's owner.
 * @returns {Promise<number>} Window in days.
 */
function getAnalyticsWindowDays(ownerUserId) {
  return getNumericAllowance(ownerUserId, 'analyticsWindowDays', 7);
}

async function enforceActivePackageLimit(userId) {
  const features = await getUserFeatures(userId);
  const maxPackages = features.features.maxPackages;
  if (maxPackages === -1) {
    return [];
  }

  const mySuppliers = await dbUnified.find('suppliers', { ownerUserId: userId });
  const supplierIds = mySuppliers.map(s => s.id);
  if (supplierIds.length === 0) {
    return [];
  }

  const allPkgs = await dbUnified.find('packages', { supplierId: { $in: supplierIds } });
  const activePkgs = allPkgs.filter(p => p.paused !== true);
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

/**
 * Hide a supplier's oldest gallery photos beyond the plan's photo allowance
 * from public view, mirroring enforceActivePackageLimit's pattern exactly
 * (same oldest-first ordering, same "flag rather than delete" approach, same
 * call sites) — a downgrade or cancellation must retroactively enforce
 * "up to N photos" the same way it already does for packages, or a
 * Professional Plus supplier's public gallery keeps showing hundreds of
 * photos on Starter with nothing to stop it.
 *
 * Unlike packages, photos live as an array field directly on each supplier
 * document rather than their own collection, so this hides per-supplier
 * (matching how the upload allowance is already checked per-supplier in
 * routes/photos.js checkPhotoAllowance) rather than across a shared
 * collection. Hidden photos are never deleted — only flagged
 * hiddenByPlanLimit so an upgrade or manual gallery cleanup can be reflected
 * without losing the original upload. Hidden photos also stop counting
 * toward the allowance for new uploads, the same way a paused package
 * doesn't count toward the active package limit.
 * @param {string} userId
 * @returns {Promise<string[]>} IDs of suppliers whose gallery was changed.
 */
async function enforcePhotoGalleryLimit(userId) {
  const maxPhotos = await getPhotoAllowance(userId);
  if (maxPhotos === -1) {
    return [];
  }

  const mySuppliers = await dbUnified.find('suppliers', { ownerUserId: userId });
  const changedSupplierIds = [];

  for (const supplier of mySuppliers) {
    const gallery = Array.isArray(supplier.photosGallery) ? supplier.photosGallery : [];
    const visible = gallery.filter(p => !p?.hiddenByPlanLimit);
    if (visible.length <= maxPhotos) {
      continue;
    }

    const sortedVisible = [...visible].sort((a, b) => {
      const aTime = a?.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
      const bTime = b?.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
      return aTime - bTime;
    });
    const toHide = new Set(sortedVisible.slice(0, sortedVisible.length - maxPhotos));

    const updatedGallery = gallery.map(photo =>
      toHide.has(photo) ? { ...photo, hiddenByPlanLimit: true } : photo
    );

    await dbUnified.updateOne(
      'suppliers',
      { id: supplier.id },
      { $set: { photosGallery: updatedGallery } }
    );
    changedSupplierIds.push(supplier.id);
  }

  return changedSupplierIds;
}

async function addBillingRecord(subscriptionId, billingRecord) {
  const subscription = await getSubscription(subscriptionId);
  if (!subscription) {
    throw new Error('Subscription not found');
  }
  const billingHistory = subscription.billingHistory || [];
  // Idempotency: if a webhook handler fails partway through after this step
  // already ran, Stripe retries the whole event from the top. Without this
  // check, the retry would push a second line item for the same invoice.
  if (
    billingRecord.invoiceId &&
    billingHistory.some(record => record.invoiceId === billingRecord.invoiceId)
  ) {
    return subscription;
  }
  billingHistory.push({
    invoiceId: billingRecord.invoiceId,
    amount: billingRecord.amount,
    currency: billingRecord.currency,
    paid: billingRecord.paid,
    date: billingRecord.date || new Date().toISOString(),
  });
  return updateSubscription(subscriptionId, { billingHistory });
}

function updateBillingDates(subscriptionId, periodStart, periodEnd) {
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
  cancelSubscriptionForAccountDeletion,
  checkFeatureAccess,
  getFallbackUserTier,
  refreshUserEntitlements,
  getUserFeatures,
  getNumericAllowance,
  getPhotoAllowance,
  getAnalyticsWindowDays,
  enforceActivePackageLimit,
  enforcePhotoGalleryLimit,
  addBillingRecord,
  updateBillingDates,
  isInTrial,
  isLiveEntitlement,
  listSubscriptions,
  getSubscriptionStats,
  getAllPlans,
  processSubscriptionPlanChange,
};
