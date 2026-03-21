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
    threadsPerDay: 3,
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
  return MESSAGE_LIMITS[tier] || MESSAGE_LIMITS.free;
}

module.exports = { MESSAGE_LIMITS, getMessagingLimitsForTier };
