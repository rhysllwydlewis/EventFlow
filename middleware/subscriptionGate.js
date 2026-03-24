/**
 * Subscription-based feature gating middleware
 * Replaces legacy isPro checks with proper subscription service
 */

'use strict';

const subscriptionService = require('../services/subscriptionService');
const logger = require('../utils/logger');
const dbUnified = require('../db-unified');
const { TIER_LEVELS } = require('../models/Subscription');

/**
 * Resolve the effective tier for a user, considering:
 * 1. Active subscriptions table record (period not expired, not past_due/canceled without renewal)
 *    — if a record exists but is expired/past_due/canceled, returns 'free' without checking the
 *      user fallback (prevents stale subscriptionTier from granting access after expiry).
 * 2. User record subscriptionTier field (set by Stripe webhook on purchase)
 *    — only consulted when NO subscription record exists at all.
 * 3. Default: 'free'
 */
async function resolveEffectiveTier(userId) {
  // Check subscriptions table first (most authoritative)
  const subscription = await subscriptionService.getSubscriptionByUserId(userId);

  if (subscription) {
    const { plan, status, currentPeriodEnd } = subscription;
    // Treat as active when status is active/trialing OR period hasn't yet ended
    const periodStillValid = !currentPeriodEnd || new Date(currentPeriodEnd) > new Date();
    if ((status === 'active' || status === 'trialing') && periodStillValid) {
      return { tier: plan, subscription };
    }
    // Subscription record exists but is expired / past_due / canceled:
    // return free immediately — do not fall through to a potentially stale user fallback.
    return { tier: 'free', subscription: null };
  }

  // Fallback: user record subscriptionTier set directly by Stripe webhook
  const users = await dbUnified.read('users');
  const user = users.find(u => u.id === userId);
  if (user?.subscriptionTier && user.subscriptionTier !== 'free') {
    // Honour proExpiresAt if present
    if (user.proExpiresAt && new Date(user.proExpiresAt) < new Date()) {
      return { tier: 'free', subscription: null };
    }
    return { tier: user.subscriptionTier, subscription: null };
  }

  return { tier: 'free', subscription: null };
}

/**
 * Require a minimum subscription tier
 * @param {string} minTier - Minimum tier required (free, pro, pro_plus)
 * @returns {Function} Express middleware
 */
function requireSubscription(minTier = 'free') {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const { tier, subscription } = await resolveEffectiveTier(req.user.id);

      if ((TIER_LEVELS[tier] ?? 0) >= (TIER_LEVELS[minTier] ?? 0)) {
        req.subscription = subscription; // Attach to request
        req.subscriptionTier = tier;
        return next();
      }

      return res.status(403).json({
        error: 'Subscription upgrade required',
        currentTier: tier,
        requiredTier: minTier,
        upgradeUrl: '/supplier/subscription.html',
      });
    } catch (error) {
      logger.error('Error checking subscription:', error);
      return res.status(500).json({ error: 'Failed to check subscription status' });
    }
  };
}

/**
 * Check if user has access to a specific feature
 * @param {string} feature - Feature name to check
 * @returns {Function} Express middleware
 */
function checkFeatureLimit(feature) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const hasAccess = await subscriptionService.checkFeatureAccess(req.user.id, feature);

      if (hasAccess) {
        return next();
      }

      return res.status(403).json({
        error: `Feature '${feature}' requires subscription upgrade`,
        upgradeUrl: '/supplier/subscription.html',
      });
    } catch (error) {
      logger.error('Error checking feature access:', error);
      return res.status(500).json({ error: 'Failed to check feature access' });
    }
  };
}

module.exports = { requireSubscription, checkFeatureLimit, resolveEffectiveTier, TIER_LEVELS };
