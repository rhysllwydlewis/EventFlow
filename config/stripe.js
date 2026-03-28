/**
 * Stripe Configuration
 * Handles Stripe client initialization
 */

'use strict';

const logger = require('../utils/logger');

let STRIPE_ENABLED = false;
let stripeClient = null;
let initializationError = null;

/**
 * Initialize Stripe client
 * Lazy-loads Stripe library to avoid errors if not configured
 */
function initializeStripe() {
  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (secret) {
      // Lazy-load Stripe so the app still runs if the dependency is missing
      // eslint-disable-next-line global-require, node/no-missing-require
      const stripeLib = require('stripe');
      stripeClient = stripeLib(secret, {
        apiVersion: '2025-12-15',
      });
      STRIPE_ENABLED = true;

      // Warn if test keys are used in production
      if (process.env.NODE_ENV === 'production' && secret.startsWith('sk_test_')) {
        logger.warn(
          '⚠️  Stripe is using TEST keys in production! Switch to live keys before go-live.'
        );
      }

      logger.info('✅ Stripe: Configured');
    } else {
      logger.info('ℹ️  Stripe: Not configured (optional)');
    }
  } catch (err) {
    initializationError = err.message;
    logger.warn('Stripe initialization failed:', err.message);
    logger.error('Stripe configuration error details:', {
      error: err.message,
      stack: err.stack,
    });
  }

  return STRIPE_ENABLED;
}

/**
 * Get Stripe client instance
 * @returns {Object|null} Stripe client or null if not configured
 */
function getStripeClient() {
  return stripeClient;
}

/**
 * Check if Stripe is enabled
 * @returns {boolean} True if Stripe is configured
 */
function isStripeEnabled() {
  return STRIPE_ENABLED;
}

/**
 * Get initialization error if any
 * @returns {string|null} Error message or null
 */
function getInitializationError() {
  return initializationError;
}

module.exports = {
  initializeStripe,
  getStripeClient,
  isStripeEnabled,
  getInitializationError,
};
