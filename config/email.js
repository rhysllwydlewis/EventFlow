/**
 * Email Configuration
 * Handles Postmark client initialization and configuration
 */

'use strict';

const postmark = require('../utils/postmark');
const logger = require('../utils/logger');

// Email enabled flag
const EMAIL_ENABLED = String(process.env.EMAIL_ENABLED || 'false').toLowerCase() === 'true';

/**
 * Validate email configuration in production
 */
function validateEmailConfig() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && EMAIL_ENABLED) {
    if (!postmark.isPostmarkEnabled()) {
      logger.warn('⚠️  Warning: EMAIL_ENABLED=true but Postmark is not configured.');
      logger.warn('   Set POSTMARK_API_KEY and POSTMARK_FROM in your .env file.');
      logger.warn('   Emails will be saved to /outbox folder until Postmark is configured.');
    }
    if (!process.env.POSTMARK_FROM) {
      logger.warn('⚠️  Warning: POSTMARK_FROM not set. Using default: noreply@event-flow.co.uk');
    }
  }
}

/**
 * Send email via Postmark
 * Wrapper function that delegates to utils/postmark.js
 *
 * @param {string|Object} toOrOpts - Email address or options object
 * @param {string} [subject] - Email subject (if using legacy format)
 * @param {string} [text] - Email text body (if using legacy format)
 * @returns {Promise<Object>} Postmark response
 */
function sendMail(toOrOpts, subject, text) {
  // Support both legacy (to, subject, text) and object-based calls
  let options = {};

  if (toOrOpts && typeof toOrOpts === 'object') {
    options = toOrOpts;
  } else {
    options = {
      to: toOrOpts,
      subject: subject,
      text: text,
    };
  }

  // Delegate to Postmark utility
  return postmark.sendMail(options);
}

/**
 * Check if Postmark is enabled
 * @returns {boolean} True if Postmark is configured
 */
function isPostmarkEnabled() {
  return postmark.isPostmarkEnabled();
}

/**
 * Get Postmark status
 * @returns {Object} Status object
 */
function getPostmarkStatus() {
  return postmark.getPostmarkStatus();
}

module.exports = {
  EMAIL_ENABLED,
  validateEmailConfig,
  sendMail,
  isPostmarkEnabled,
  getPostmarkStatus,
};
