/**
 * Feature Flag Middleware
 * Enforces feature flags from settings database
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const FAIL_CLOSED_FEATURES = new Set([
  'marketplaceAvailability',
  'quoteBooking',
  'bookingPayments',
]);

/**
 * Get current feature flags from settings
 * @returns {Promise<Object>} Feature flags object
 */
async function getFeatureFlags() {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    const features = settings.features || {};
    const quoteBooking = features.quoteBooking === true;

    return {
      registration: features.registration !== false,
      supplierApplications: features.supplierApplications !== false,
      reviews: features.reviews !== false,
      photoUploads: features.photoUploads !== false,
      supportTickets: features.supportTickets !== false,
      pexelsCollage: features.pexelsCollage === true,
      photoAutoApprove: features.photoAutoApprove !== false,
      marketplaceAvailability: features.marketplaceAvailability === true,
      quoteBooking,
      bookingPayments: quoteBooking && features.bookingPayments === true,
    };
  } catch (error) {
    logger.error('Error reading feature flags:', error);
    // Preserve established site defaults, but keep incomplete commercial rollouts disabled.
    return {
      registration: true,
      supplierApplications: true,
      reviews: true,
      photoUploads: true,
      supportTickets: true,
      pexelsCollage: false,
      photoAutoApprove: true,
      marketplaceAvailability: false,
      quoteBooking: false,
      bookingPayments: false,
    };
  }
}

/**
 * Middleware to require a specific feature to be enabled
 * Returns 503 Service Unavailable if feature is disabled
 * @param {string} featureName - Name of the feature to check
 * @returns {Function} Express middleware function
 */
function featureRequired(featureName) {
  return async (req, res, next) => {
    try {
      const features = await getFeatureFlags();

      if (!features[featureName]) {
        return res.status(503).json({
          error: 'Feature temporarily unavailable',
          message: `The ${featureName} feature is currently disabled. Please try again later.`,
          feature: featureName,
        });
      }

      next();
    } catch (error) {
      logger.error(`Error checking feature flag '${featureName}':`, error);
      if (FAIL_CLOSED_FEATURES.has(featureName)) {
        return res.status(503).json({
          error: 'Feature temporarily unavailable',
          message: `The ${featureName} feature is currently unavailable. Please try again later.`,
          feature: featureName,
        });
      }
      // Preserve the established fail-open behaviour for existing non-commercial features.
      next();
    }
  };
}

module.exports = {
  featureRequired,
  getFeatureFlags,
};
