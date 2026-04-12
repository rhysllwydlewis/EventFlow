/**
 * Shared configuration utility
 * Provides consistent access to application configuration values
 */

'use strict';

/**
 * Get the application base URL
 * Checks APP_BASE_URL, then BASE_URL, then falls back to localhost
 * @returns {string} Application base URL
 */
function getBaseUrl() {
  return process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
}

/**
 * Derive the Stripe secret key mode from the key prefix without exposing the key.
 * Returns 'live' when STRIPE_SECRET_KEY starts with 'sk_live_',
 * 'test' when it starts with 'sk_test_', or 'unknown' otherwise.
 * This is used in health checks and admin debug tooling to surface
 * test-vs-live mismatches that cause Stripe API 400 errors.
 * @returns {'live'|'test'|'unknown'}
 */
function getStripeKeyMode() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return 'unknown';
  }
  if (key.startsWith('sk_live_')) {
    return 'live';
  }
  if (key.startsWith('sk_test_')) {
    return 'test';
  }
  return 'unknown';
}

module.exports = {
  getBaseUrl,
  getStripeKeyMode,
};
