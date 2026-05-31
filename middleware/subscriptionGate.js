'use strict';

const subscriptionService = require('../services/subscriptionService');
const logger = require('../utils/logger');
const dbUnified = require('../db-unified');
const { TIER_LEVELS } = require('../models/Subscription');

function isSubscriptionLive(subscription) {
  if (!subscription) return false;
  if (subscription.status !== 'active' && subscription.status !== 'trialing') return false;
  if (subscription.plan === 'free') return true;
  if (subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd) > new Date()) return true;
  if (subscription.trialEnd && new Date(subscription.trialEnd) > new Date()) return true;
  return false;
}

async function resolveEffectiveTier(userId) {
  const subscription = await subscriptionService.getSubscriptionByUserId(userId);
  if (subscription) {
    if (isSubscriptionLive(subscription)) return { tier: subscription.plan, subscription };
    return { tier: 'free', subscription: null };
  }
  const users = await dbUnified.read('users');
  const user = users.find(u => u.id === userId);
  if (user && user.subscriptionTier && user.subscriptionTier !== 'free') {
    if (user.proExpiresAt && new Date(user.proExpiresAt) > new Date()) {
      return { tier: user.subscriptionTier, subscription: null };
    }
  }
  return { tier: 'free', subscription: null };
}

function requireSubscription(minTier = 'free') {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
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
        upgradeUrl: '/supplier/subscription.html',
      });
    } catch (error) {
      logger.error('Error checking subscription:', error);
      return res.status(500).json({ error: 'Failed to check subscription status' });
    }
  };
}

function checkFeatureLimit(feature) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    try {
      const hasAccess = await subscriptionService.checkFeatureAccess(req.user.id, feature);
      if (hasAccess) return next();
      return res.status(403).json({
        error: 'Feature requires subscription upgrade',
        feature,
        upgradeUrl: '/supplier/subscription.html',
      });
    } catch (error) {
      logger.error('Error checking feature access:', error);
      return res.status(500).json({ error: 'Failed to check feature access' });
    }
  };
}

module.exports = { requireSubscription, checkFeatureLimit, resolveEffectiveTier, TIER_LEVELS };
