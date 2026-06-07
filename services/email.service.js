/**
 * Email Service
 * Handles email sending operations via Postmark
 */

'use strict';

const emailConfig = require('../config/email');
const postmark = require('../utils/postmark');
const logger = require('../utils/logger');

/**
 * Send email via Postmark
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Email text body
 * @param {string} [options.html] - Email HTML body
 * @param {string} [options.template] - Template name
 * @param {Object} [options.templateData] - Template data
 * @param {string} [options.messageStream] - Postmark message stream
 * @returns {Promise<Object>} Email send result
 */
async function sendEmail(options) {
  try {
    const result = await emailConfig.sendMail(options);
    logger.info('Email sent successfully', {
      to: options.to,
      subject: options.subject,
    });
    return result;
  } catch (error) {
    logger.error('Email send failed', {
      to: options.to,
      subject: options.subject,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Send verification email
 * @param {string} to - Recipient email
 * @param {string} name - Recipient name
 * @param {string} verificationLink - Verification link
 * @returns {Promise<Object>} Email send result
 */
async function sendVerificationEmail(to, name, verificationLink) {
  return sendEmail({
    to,
    subject: 'Verify your email address',
    template: 'verification',
    templateData: {
      name,
      verificationLink,
    },
    from: postmark.FROM_NOREPLY,
    messageStream: 'outbound',
    tags: ['verification', 'transactional'],
    criticalDelivery: true,
  });
}

/**
 * Send password reset email
 * @param {string} to - Recipient email
 * @param {string} name - Recipient name
 * @param {string} resetLink - Password reset link
 * @returns {Promise<Object>} Email send result
 */
async function sendPasswordResetEmail(to, name, resetLink) {
  return sendEmail({
    to,
    subject: 'Reset your password',
    template: 'password-reset',
    templateData: {
      name,
      resetLink,
    },
    from: postmark.FROM_NOREPLY,
    messageStream: 'password-reset',
    tags: ['password-reset', 'transactional'],
    criticalDelivery: true,
  });
}

/**
 * Send welcome email
 * @param {string} to - Recipient email
 * @param {string} name - Recipient name
 * @returns {Promise<Object>} Email send result
 */
async function sendWelcomeEmail(to, name) {
  return sendEmail({
    to,
    subject: 'Welcome to EventFlow',
    template: 'welcome',
    templateData: {
      name,
    },
    from: postmark.FROM_HELLO,
    messageStream: 'outbound',
  });
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
};
