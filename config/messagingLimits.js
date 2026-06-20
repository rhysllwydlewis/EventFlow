/**
 * Message Limits Configuration
 * Defines messaging limits based on subscription tier.
 * Supported tiers: free, pro, pro_plus.
 * Unknown/legacy tiers are mapped to free by getMessagingLimitsForTier().
 */

'use strict';

const MESSAGE_LIMITS = {
  free: {
    messagesPerDay: 10,
    messagesPerHour: 20,
    // Beta default: keep an anti-spam guard without blocking normal testing after 3 starts.
    threadsPerDay: 30,
    maxMessageLength: 500,
  },
  pro: {
    messagesPerDay: -1, // unlimited
    messagesPerHour: 500,
    threadsPerDay: -1, // unlimited
    maxMessageLength: 5000,
  },
  pro_plus: {
    messagesPerDay: -1, // unlimited
    messagesPerHour: 1000,
    threadsPerDay: -1, // unlimited
    maxMessageLength: 10000,
  },
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on']);

function isEnabled(value) {
  return typeof value === 'string' && TRUE_VALUES.has(value.trim().toLowerCase());
}

function parseLimitOverride(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function getEnvOverridesForTier(tier, baseLimits) {
  const normalisedTier = typeof tier === 'string' ? tier.trim().toLowerCase() : 'free';

  if (isEnabled(process.env.MESSAGING_DISABLE_THREAD_LIMITS)) {
    return { threadsPerDay: -1 };
  }

  if (normalisedTier === 'free') {
    return {
      threadsPerDay: parseLimitOverride(
        process.env.MESSAGING_FREE_THREADS_PER_DAY,
        baseLimits.threadsPerDay
      ),
    };
  }

  return {};
}

/**
 * Return the messaging limits for the given tier.
 * Falls back to the free-tier limits for any unrecognised or legacy tier
 * (e.g. 'basic', 'premium', 'enterprise') so callers can never crash
 * or receive undefined limits.
 *
 * @param {string} tier - Subscription tier key
 * @returns {Object} Messaging limits for the tier
 */
function getMessagingLimitsForTier(tier) {
  const normalisedTier = typeof tier === 'string' ? tier.trim().toLowerCase() : 'free';
  const effectiveTier = MESSAGE_LIMITS[normalisedTier] ? normalisedTier : 'free';
  const baseLimits = MESSAGE_LIMITS[effectiveTier];
  return {
    ...baseLimits,
    ...getEnvOverridesForTier(effectiveTier, baseLimits),
  };
}

module.exports = { MESSAGE_LIMITS, getMessagingLimitsForTier };
