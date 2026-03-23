/**
 * Feature Flag Middleware
 * Enforces feature flags from settings database
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

/**
 * Get current feature flags from settings
 * @returns {Promise<Object>} Feature flags object
 */
async function getFeatureFlags() {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    const features = settings.features || {};

    return {
      registration: features.registration !== false,
      supplierApplications: features.supplierApplications !== false,
      reviews: features.reviews !== false,
      photoUploads: features.photoUploads !== false,
      supportTickets: features.supportTickets !== false,
      pexelsCollage: features.pexelsCollage === true,
      photoAutoApprove: features.photoAutoApprove !== false,
    };
  } catch (error) {
    logger.error('Error reading feature flags:', error);
    // Return all features enabled as fallback to prevent breaking the site
    return {
      registration: true,
      supplierApplications: true,
      reviews: true,
      photoUploads: true,
      supportTickets: true,
      pexelsCollage: false,
      photoAutoApprove: true,
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
      // Allow request to proceed on error to prevent breaking the site
      next();
    }
  };
}

module.exports = {
  featureRequired,
  getFeatureFlags,
};
