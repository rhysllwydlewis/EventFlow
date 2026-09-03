'use strict';

const subscriptionService = require('../services/subscriptionService');
const logger = require('../utils/logger');
const { TIER_LEVELS } = require('../models/Subscription');

// This middleware is not currently imported by any route (verified by
// repo-wide grep) — kept for whichever route wires it up next. Its fallback
// used to duplicate subscriptionService.isLiveEntitlement's logic by hand
// (reading user.subscriptionTier/proExpiresAt directly) rather than reusing
// it, which had drifted out of sync with the canonical rule used everywhere
// else. Delegating to isLiveEntitlement keeps this middleware correct
// automatically if that rule ever changes again.
function isSubscriptionLive(subscription) {
  return subscriptionService.isLiveEntitlement(subscription);
}

async function resolveEffectiveTier(userId) {
  const subscription = await subscriptionService.getSubscriptionByUserId(userId);
  if (subscription) {
    if (isSubscriptionLive(subscription)) {
      return { tier: subscription.plan, subscription };
    }
    return { tier: 'free', subscription: null };
  }
  // No subscriptions-collection record at all — defer to
  // subscriptionService's own fallback rule instead of re-deriving the
  // user.subscriptionTier/proExpiresAt expiry check by hand here.
  const tier = await subscriptionService.getFallbackUserTier(userId);
  return { tier, subscription: null };
}

function requireSubscription(minTier = 'free') {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    try {
      const result = await resolveEffectiveTier(req.user.id);
      if ((TIER_LEVELS[result.tier] || 0) >= (TIER_LEVELS[minTier] || 0)) {
        req.subscription = result.subscription;
        req.subscriptionTier = result.tier;
        return next();
      }
      return res.status(403).json({
        error: 'Subscription upgrade required',
        currentTier: result.tier,
        requiredTier: minTier,
        upgradeUrl: '/supplier/subscription',
      });
    } catch (error) {
      logger.error('Error checking subscription:', error);
      return res.status(500).json({ error: 'Failed to check subscription status' });
    }
  };
}

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
        error: `Feature ${feature} requires subscription upgrade`,
        feature,
        upgradeUrl: '/supplier/subscription',
      });
    } catch (error) {
      logger.error('Error checking feature access:', error);
      return res.status(500).json({ error: 'Failed to check feature access' });
    }
  };
}

module.exports = { requireSubscription, checkFeatureLimit, resolveEffectiveTier, TIER_LEVELS };
