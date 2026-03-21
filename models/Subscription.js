/**
 * Subscription Model
 * MongoDB schema and methods for user subscriptions
 */

'use strict';

/**
 * Subscription Schema Definition
 * Tracks user subscriptions, billing cycles, and payment history
 */
const subscriptionSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'userId', 'plan', 'status'],
      properties: {
        id: {
          bsonType: 'string',
          description: 'Unique subscription identifier',
        },
        userId: {
          bsonType: 'string',
          description: 'User ID who owns this subscription',
        },
        stripeSubscriptionId: {
          bsonType: 'string',
          description: 'Stripe subscription ID for payment tracking',
        },
        stripeCustomerId: {
          bsonType: 'string',
          description: 'Stripe customer ID',
        },
        plan: {
          enum: ['free', 'pro', 'pro_plus'],
          description: 'Subscription plan tier',
        },
        pendingPlan: {
          enum: ['free', 'pro', 'pro_plus'],
          description: 'Scheduled next tier (applied at period end after a downgrade)',
        },
        status: {
          enum: ['active', 'trialing', 'past_due', 'canceled', 'unpaid'],
          description: 'Current subscription status',
        },
        trialStart: {
          bsonType: 'string',
          description: 'Trial period start date (ISO 8601)',
        },
        trialEnd: {
          bsonType: 'string',
          description: 'Trial period end date (ISO 8601)',
        },
        currentPeriodStart: {
          bsonType: 'string',
          description: 'Current billing period start date',
        },
        currentPeriodEnd: {
          bsonType: 'string',
          description: 'Current billing period end date',
        },
        nextBillingDate: {
          bsonType: 'string',
          description: 'Next billing date (ISO 8601)',
        },
        cancelAtPeriodEnd: {
          bsonType: 'bool',
          description: 'Whether subscription will cancel at period end',
        },
        canceledAt: {
          bsonType: 'string',
          description: 'When subscription was canceled (ISO 8601)',
        },
        cancelReason: {
          bsonType: 'string',
          description: 'Reason for cancellation',
        },
        billingHistory: {
          bsonType: 'array',
          description: 'Historical billing records',
          items: {
            bsonType: 'object',
            properties: {
              invoiceId: {
                bsonType: 'string',
                description: 'Invoice identifier',
              },
              amount: {
                bsonType: 'number',
                description: 'Billing amount',
              },
              currency: {
                bsonType: 'string',
                description: 'Currency code (USD, GBP, etc.)',
              },
              paid: {
                bsonType: 'bool',
                description: 'Payment status',
              },
              date: {
                bsonType: 'string',
                description: 'Billing date (ISO 8601)',
              },
            },
          },
        },
        metadata: {
          bsonType: 'object',
          description: 'Additional metadata from Stripe or custom fields',
        },
        createdAt: {
          bsonType: 'string',
          description: 'Subscription creation timestamp (ISO 8601)',
        },
        updatedAt: {
          bsonType: 'string',
          description: 'Last update timestamp (ISO 8601)',
        },
      },
    },
  },
};

/**
 * Plan feature definitions
 * Maps plan tiers to available features.
 * Supported tiers: free, pro, pro_plus.
 * The basic and enterprise tiers are no longer active; unknown tiers fall back to free.
 */
const PLAN_FEATURES = {
  free: {
    name: 'Free',
    price: 0,
    interval: 'month',
    features: {
      maxSuppliers: 1,
      maxPackages: 3,
      maxPhotos: 10,
      maxBookings: 10,
      messaging: true,
      analytics: false,
      prioritySupport: false,
      priorityListing: false,
      badge: null,
      customBranding: false,
      homepageCarousel: false,
      apiAccess: false,
    },
  },
  pro: {
    name: 'Professional',
    price: 29.99,
    interval: 'month',
    features: {
      maxSuppliers: 10,
      maxPackages: 50,
      maxPhotos: 500,
      maxBookings: 50,
      messaging: true,
      analytics: true,
      prioritySupport: true,
      priorityListing: true,
      badge: 'pro',
      customBranding: false,
      homepageCarousel: false,
      apiAccess: true,
    },
  },
  pro_plus: {
    name: 'Professional Plus',
    price: 59.0,
    interval: 'month',
    features: {
      maxSuppliers: -1, // unlimited
      maxPackages: -1,
      maxPhotos: -1,
      maxBookings: -1,
      messaging: true,
      analytics: true,
      prioritySupport: true,
      priorityListing: true,
      badge: 'pro_plus',
      customBranding: true,
      homepageCarousel: true,
      apiAccess: true,
    },
  },
};

/**
 * Get feature configuration for a plan
 * @param {string} plan - Plan tier (free, pro, pro_plus)
 * @returns {Object} Feature configuration
 */
function getPlanFeatures(plan) {
  return PLAN_FEATURES[plan] || PLAN_FEATURES.free;
}

/**
 * Check if a feature is enabled for a plan
 * @param {string} plan - Plan tier
 * @param {string} feature - Feature name
 * @returns {boolean} Whether feature is enabled
 */
function hasFeature(plan, feature) {
  const planConfig = getPlanFeatures(plan);
  return planConfig.features[feature] || false;
}

/**
 * Get all available plans
 * @returns {Array} Array of plan configurations
 */
function getAllPlans() {
  const orderedPlans = ['free', 'pro', 'pro_plus'];
  return orderedPlans.map(planId => ({
    id: planId,
    ...PLAN_FEATURES[planId],
  }));
}

module.exports = {
  subscriptionSchema,
  PLAN_FEATURES,
  getPlanFeatures,
  hasFeature,
  getAllPlans,
  /** Tier level ordering — single source of truth for gate middleware */
  TIER_LEVELS: { free: 0, pro: 1, pro_plus: 2 },
};
