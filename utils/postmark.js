/**
 * Postmark Email Utility (POSTMARK ONLY)
 * Provides secure, server-side email sending exclusively via Postmark API
 *
 * Environment Variables Required:
 * - POSTMARK_API_KEY: Your Postmark Server API key
 * - POSTMARK_FROM: Default sender email address (must be verified in Postmark - use noreply@event-flow.co.uk)
 * - EMAIL_DOMAIN: Base domain for all sender addresses (default: event-flow.co.uk). Set this to customise all FROM addresses at once.
 * - POSTMARK_FROM_BILLING: Billing emails sender (overrides EMAIL_DOMAIN-derived default)
 * - POSTMARK_FROM_SUPPORT: Support emails sender (overrides EMAIL_DOMAIN-derived default)
 * - POSTMARK_FROM_HELLO: Welcome/friendly emails sender (overrides EMAIL_DOMAIN-derived default)
 * - POSTMARK_FROM_INFO: Newsletter/info emails sender (overrides EMAIL_DOMAIN-derived default)
 * - POSTMARK_FROM_ADMIN: Admin/system emails sender (overrides EMAIL_DOMAIN-derived default)
 * - BASE_URL or APP_BASE_URL: Application base URL for email links
 *
 * TEMPLATE USAGE:
 * ===============
 * This utility uses LOCAL HTML templates from /email-templates/ directory.
 * No Postmark-hosted templates are required.
 *
 * Example:
 *    sendMail({
 *      to: 'user@example.com',
 *      subject: 'Password Reset',
 *      template: 'password-reset',
 *      templateData: { name: 'John', resetLink: 'https://...' },
 *      messageStream: 'password-reset'  // Use 'password-reset' stream for resets
 *    });
 *
 * MESSAGE STREAMS:
 * ================
 * - 'outbound': Default for transactional emails (verification, notifications)
 * - 'password-reset': For password reset emails
 * - 'broadcasts': For marketing emails
 *
 * FALLBACK BEHAVIOR:
 * ==================
 * If Postmark is not configured (missing POSTMARK_API_KEY), emails are saved to /outbox folder.
 */

'use strict';

const path = require('path');
const logger = require('./logger');
const fs = require('fs');
const crypto = require('crypto');

// Lazy-load Postmark to avoid errors if not configured
let postmarkClient = null;
let POSTMARK_ENABLED = false;

// Configuration - POSTMARK_API_KEY and POSTMARK_FROM are required
const POSTMARK_API_KEY = process.env.POSTMARK_API_KEY;
const APP_BASE_URL = process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET;

// Named sender addresses per email category.
// All addresses derive from EMAIL_DOMAIN by default, so forks only need to set one variable.
// Each address can still be overridden individually via its own env var.
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || 'event-flow.co.uk';
const POSTMARK_FROM = process.env.POSTMARK_FROM || `noreply@${EMAIL_DOMAIN}`;
const FROM_NOREPLY = process.env.POSTMARK_FROM_NOREPLY || `noreply@${EMAIL_DOMAIN}`;
const FROM_HELLO = process.env.POSTMARK_FROM_HELLO || `hello@${EMAIL_DOMAIN}`;
const FROM_BILLING = process.env.POSTMARK_FROM_BILLING || `billing@${EMAIL_DOMAIN}`;
const FROM_SUPPORT = process.env.POSTMARK_FROM_SUPPORT || `support@${EMAIL_DOMAIN}`;
const FROM_INFO = process.env.POSTMARK_FROM_INFO || `info@${EMAIL_DOMAIN}`;
const FROM_ADMIN = process.env.POSTMARK_FROM_ADMIN || `admin@${EMAIL_DOMAIN}`;

/**
 * Initialize Postmark client
 */
function initializePostmark() {
  if (!POSTMARK_API_KEY) {
    logger.warn('⚠️  Postmark not configured: POSTMARK_API_KEY environment variable required');
    logger.warn('   Emails will be saved to /outbox folder instead');
    logger.warn('   Set POSTMARK_API_KEY and POSTMARK_FROM in your .env file');
    return false;
  }

  try {
    const postmark = require('postmark');
    postmarkClient = new postmark.ServerClient(POSTMARK_API_KEY);

    POSTMARK_ENABLED = true;
    logger.info(`✅ Postmark configured successfully`);
    logger.info(`   From: ${POSTMARK_FROM}`);
    logger.info(`   Base URL: ${APP_BASE_URL}`);
    // Only log API key preview in development for debugging
    if (process.env.NODE_ENV !== 'production') {
      logger.info(`   API key: ${POSTMARK_API_KEY.substring(0, 8)}...`);
    }
    return true;
  } catch (err) {
    logger.error('❌ Failed to initialize Postmark:', err.message);
    logger.error('   Run: npm install postmark');
    return false;
  }
}

// Initialize on module load
initializePostmark();

/**
 * Generate secure unsubscribe token for email address
 * @param {string} email - User email address
 * @returns {string} HMAC-SHA256 token
 */
function generateUnsubscribeToken(email) {
  return crypto.createHmac('sha256', UNSUBSCRIBE_SECRET).update(email.toLowerCase()).digest('hex');
}

/**
 * Verify unsubscribe token matches email
 * @param {string} email - User email address
 * @param {string} token - Token to verify
 * @returns {boolean} True if token is valid for this email
 */
function verifyUnsubscribeToken(email, token) {
  const expectedToken = generateUnsubscribeToken(email);
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));
}

/**
 * Mask email address for logging in production
 * @param {string} email - Email address to mask
 * @returns {string} Masked email address
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') {
    return '***';
  }
  const [localPart, domain] = email.split('@');
  if (!domain) {
    return '***';
  }

  // Show first char of local part and domain
  const maskedLocal =
    localPart.length > 1 ? localPart[0] + '*'.repeat(Math.min(localPart.length - 1, 5)) : '*';
  return `${maskedLocal}@${domain}`;
}

/**
 * Load and process email template
 * @param {string} templateName - Name of template file (without .html)
 * @param {Object} data - Template variables to replace
 * @returns {string|null} Processed HTML template or null
 */
function loadEmailTemplate(templateName, data = {}) {
  try {
    const templatePath = path.join(__dirname, '..', 'email-templates', `${templateName}.html`);
    if (!fs.existsSync(templatePath)) {
      logger.error(`Email template not found: ${templateName}.html`);
      return null;
    }

    let html = fs.readFileSync(templatePath, 'utf8');

    // Helper to escape HTML entities to prevent XSS
    const escapeHtml = text => {
      if (typeof text !== 'string') {
        return text;
      }
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    // Replace template variables with HTML-escaped values
    Object.keys(data).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      // Don't escape if the value contains HTML tags (for message content)
      const value =
        key === 'message' || key === 'html' || key === 'features'
          ? data[key]
          : escapeHtml(data[key]);
      html = html.replace(regex, value || '');
    });

    // Add current year
    html = html.replace(/{{year}}/g, new Date().getFullYear());

    // Add base URL
    html = html.replace(/{{baseUrl}}/g, APP_BASE_URL);

    // Clear any remaining unresolved template placeholders
    html = html.replace(/\{\{[^}]+\}\}/g, '');

    return html;
  } catch (err) {
    logger.error('Error loading email template:', err.message);
    return null;
  }
}

/**
 * Send email via Postmark (local templates only)
 * @param {Object} options - Email options
 * @param {string|string[]} options.to - Recipient email address(es)
 * @param {string} options.subject - Email subject line
 * @param {string} [options.text] - Plain text email body
 * @param {string} [options.html] - HTML email body
 * @param {string} [options.template] - Template name (loads from email-templates/)
 * @param {Object} [options.templateData] - Data for template variables
 * @param {string} [options.from] - Sender email (defaults to POSTMARK_FROM)
 * @param {string|string[]} [options.tags] - Postmark tags for tracking (max 10)
 * @param {boolean} [options.trackOpens] - Track email opens (default: true)
 * @param {string} [options.trackLinks] - Track link clicks (default: 'HtmlAndText')
 * @param {string} [options.messageStream] - Postmark message stream (default: 'outbound', use 'password-reset' for resets)
 * @returns {Promise<Object>} Postmark response object
 * @throws {Error} If email sending fails or required fields are missing
 */
async function sendMail(options) {
  if (!options || !options.to) {
    const error = new Error('Missing required email field: to');
    logger.error('❌ Email send failed:', error.message);
    throw error;
  }

  const {
    to,
    subject,
    text,
    html,
    template,
    templateData = {},
    from = POSTMARK_FROM,
    tags,
    trackOpens = true,
    trackLinks = 'HtmlAndText',
  } = options;

  // Log email attempt for debugging (mask email in production)
  const isProduction = process.env.NODE_ENV === 'production';
  const recipientDisplay = isProduction
    ? maskEmail(Array.isArray(to) ? to[0] : to)
    : Array.isArray(to)
      ? to.join(',')
      : to;

  logger.info(`📧 Attempting to send email to ${recipientDisplay}`);
  logger.info(`   Subject: ${subject || '(from template)'}`);
  logger.info(`   Template: ${template || 'none'}`);
  logger.info(`   Message Stream: ${options.messageStream || 'outbound'}`);

  // Check if Postmark is enabled
  if (!POSTMARK_ENABLED || !postmarkClient) {
    logger.warn('⚠️  Postmark not configured - saving email to /outbox instead');

    // Load template for outbox if needed
    let outboxHtml = html;
    if (template && !html) {
      outboxHtml = loadEmailTemplate(template, templateData);
    }

    // Save to outbox for development/testing
    const outboxData = {
      To: Array.isArray(to) ? to.join(',') : to,
      From: from,
      Subject: subject || '(from template)',
      HtmlBody: outboxHtml,
      TextBody: text,
      Template: template,
    };
    saveEmailToOutbox(outboxData);

    return {
      status: 'disabled',
      message: 'Postmark not configured. Email saved to outbox.',
      MessageID: `outbox-${Date.now()}`,
    };
  }

  // Require subject for all emails
  if (!subject) {
    const error = new Error('Missing required email field: subject');
    logger.error('❌ Email send failed:', error.message);
    throw error;
  }

  // Load local template if specified and HTML not provided
  let emailHtml = html;
  if (template && !html) {
    logger.info(`   Loading local template: ${template}.html`);
    emailHtml = loadEmailTemplate(template, templateData);
    if (!emailHtml) {
      const error = new Error(`Failed to load email template: ${template}`);
      logger.error('❌ Email send failed:', error.message);
      throw error;
    }
  }

  // Build email data for Postmark
  const emailData = {
    From: from,
    To: Array.isArray(to) ? to.join(',') : to,
    Subject: subject,
    TrackOpens: trackOpens,
    TrackLinks: trackLinks,
    MessageStream: options.messageStream || 'outbound',
  };

  // Add body content
  if (emailHtml) {
    emailData.HtmlBody = emailHtml;
    // Provide text fallback if HTML is used
    if (!text) {
      // Simple HTML to text conversion
      emailData.TextBody = emailHtml
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      emailData.TextBody = text;
    }
  } else if (text) {
    emailData.TextBody = text;
  } else {
    const error = new Error('Email must have either text, html, or template content');
    logger.error('❌ Email send failed:', error.message);
    throw error;
  }

  // Add tags if provided (Postmark supports up to 10 tags)
  if (tags) {
    const tagArray = Array.isArray(tags) ? tags : [tags];
    emailData.Tag = tagArray.slice(0, 10).join(',');
  }

  try {
    const response = await postmarkClient.sendEmail(emailData);
    logger.info(`✅ Email sent successfully via Postmark`);
    logger.info(`   To: ${emailData.To}`);
    logger.info(`   Subject: ${emailData.Subject}`);
    logger.info(`   MessageID: ${response.MessageID}`);
    logger.info(`   Stream: ${emailData.MessageStream}`);
    return response;
  } catch (err) {
    logger.error('❌ Postmark send error:', err.message);
    logger.error('   To:', emailData.To);
    logger.error('   Subject:', emailData.Subject);

    // Save to outbox as fallback for debugging
    saveEmailToOutbox(emailData);

    // Re-throw error so calling code can handle it (e.g., rollback)
    throw new Error(`Failed to send email via Postmark: ${err.message}`);
  }
}

/**
 * Save email to outbox folder for development/testing
 * @param {Object} emailData - Email data to save
 */
function saveEmailToOutbox(emailData) {
  try {
    const outboxDir = path.join(__dirname, '..', 'outbox');
    if (!fs.existsSync(outboxDir)) {
      fs.mkdirSync(outboxDir, { recursive: true });
    }

    const timestamp = Date.now();
    const filename = `email-${timestamp}.eml`;
    const content = `To: ${emailData.To}
From: ${emailData.From}
Subject: ${emailData.Subject}

${emailData.HtmlBody || emailData.TextBody}
`;

    fs.writeFileSync(path.join(outboxDir, filename), content, 'utf8');
    logger.info(`Email saved to outbox: ${filename}`);
  } catch (err) {
    logger.error('Failed to save email to outbox:', err.message);
  }
}

/**
 * Send verification email to user
 * @param {Object} user - User object with email, name
 * @param {string} verificationToken - Verification token
 * @returns {Promise<Object>} Send result
 * @throws {Error} If email sending fails
 */
async function sendVerificationEmail(user, verificationToken) {
  const verificationLink = `${APP_BASE_URL}/verify?token=${encodeURIComponent(verificationToken)}`;

  logger.info(`📧 Sending verification email to ${user.email}`);

  return sendMail({
    to: user.email,
    subject: 'Confirm your EventFlow account',
    template: 'verification',
    templateData: {
      name: user.name || 'there',
      verificationLink: verificationLink,
    },
    from: FROM_NOREPLY,
    tags: ['verification', 'transactional'],
    messageStream: 'outbound',
  });
}

/**
 * Send password reset email to user
 * @param {Object} user - User object with email, name
 * @param {string} resetToken - Password reset token
 * @returns {Promise<Object>} Send result
 * @throws {Error} If email sending fails
 */
async function sendPasswordResetEmail(user, resetToken) {
  const resetLink = `${APP_BASE_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;

  logger.info(`📧 Sending password reset email to ${user.email}`);

  return sendMail({
    to: user.email,
    subject: 'Reset your EventFlow password',
    template: 'password-reset',
    templateData: {
      name: user.name || 'there',
      resetLink: resetLink,
    },
    from: FROM_NOREPLY,
    tags: ['password-reset', 'transactional'],
    messageStream: 'password-reset', // Use dedicated password-reset stream
  });
}

/**
 * Send welcome email to newly verified user
 * @param {Object} user - User object with email, name
 * @returns {Promise<Object>} Send result
 * @throws {Error} If email sending fails
 */
async function sendWelcomeEmail(user) {
  logger.info(`📧 Sending welcome email to ${user.email}`);

  return sendMail({
    to: user.email,
    subject: 'Welcome to EventFlow!',
    template: 'welcome',
    templateData: {
      name: user.name || 'there',
    },
    from: FROM_HELLO,
    tags: ['welcome', 'transactional'],
    messageStream: 'outbound',
  });
}

/**
 * Send password reset confirmation email
 * @param {Object} user - User object with email, name
 * @returns {Promise<Object>} Send result
 * @throws {Error} If email sending fails
 */
async function sendPasswordResetConfirmation(user) {
  logger.info(`📧 Sending password reset confirmation to ${user.email}`);

  return sendMail({
    to: user.email,
    subject: 'Your password has been reset',
    template: 'password-reset-confirmation',
    templateData: {
      name: user.name || 'there',
      resetTime: new Date().toLocaleString(),
    },
    from: FROM_NOREPLY,
    tags: ['password-reset-confirmation', 'transactional'],
    messageStream: 'outbound',
  });
}

/**
 * Send marketing email (respects user preferences)
 * @param {Object} user - User object with email, name, notify_marketing
 * @param {string} subject - Email subject
 * @param {string} message - Email message content
 * @param {Object} [options] - Additional options (template, templateData)
 * @returns {Promise<Object|null>} Send result or null if user opted out
 */
async function sendMarketingEmail(user, subject, message, options = {}) {
  // Check if user has opted in to marketing emails
  if (user.notify_marketing === false) {
    logger.info(`Skipping marketing email to ${user.email} (user opted out)`);
    return null;
  }

  // Generate secure unsubscribe link with token
  const unsubscribeToken = generateUnsubscribeToken(user.email);
  const unsubscribeLink = `${APP_BASE_URL}/api/auth/unsubscribe?email=${encodeURIComponent(user.email)}&token=${unsubscribeToken}`;

  // Build message with optional CTA button
  let fullMessage = message;
  if (options.ctaText && options.ctaLink) {
    fullMessage += `\n\n<div style="text-align: center; margin: 24px 0;">
      <a href="${options.ctaLink}" class="cta-button" style="display: inline-block; padding: 14px 28px; background: linear-gradient(180deg, #16c3ad, #0ea896); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px;">${options.ctaText}</a>
    </div>`;
  }

  const templateData = {
    name: user.name || 'there',
    title: subject,
    message: fullMessage,
    unsubscribeLink: unsubscribeLink,
    ...(options.templateData || {}),
  };

  return sendMail({
    to: user.email,
    subject: subject,
    template: options.template || 'marketing',
    templateData: templateData,
    from: FROM_INFO,
    tags: ['marketing'],
    messageStream: options.messageStream || 'broadcasts',
    ...options,
  });
}

/**
 * Send transactional notification email (respects user preferences)
 * @param {Object} user - User object with email, name, notify_account
 * @param {string} subject - Email subject
 * @param {string} message - Email message content
 * @param {Object} [options] - Additional options (template, templateData)
 * @returns {Promise<Object|null>} Send result or null if user opted out
 */
async function sendNotificationEmail(user, subject, message, options = {}) {
  // Check if user has opted in to account notifications
  if (user.notify_account === false) {
    logger.info(`Skipping notification email to ${user.email} (user opted out)`);
    return null;
  }

  const templateData = {
    name: user.name || 'there',
    title: subject,
    message: message,
    preferencesLink: `${APP_BASE_URL}/settings/notifications`,
    ...(options.templateData || {}),
  };

  return sendMail({
    to: user.email,
    subject: subject,
    template: options.template || 'notification',
    templateData: templateData,
    from: FROM_SUPPORT,
    tags: ['notification', 'transactional'],
    messageStream: 'outbound',
    ...options,
  });
}

/**
 * Check if Postmark is properly configured and enabled
 * @returns {boolean} True if Postmark is ready to use
 */
function isPostmarkEnabled() {
  return POSTMARK_ENABLED;
}

/**
 * Get Postmark configuration status
 * @returns {Object} Configuration status
 */
function getPostmarkStatus() {
  return {
    enabled: POSTMARK_ENABLED,
    from: POSTMARK_FROM,
    appBaseUrl: APP_BASE_URL,
    apiKeyConfigured: !!POSTMARK_API_KEY,
  };
}

module.exports = {
  // Core email functions
  sendMail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordResetConfirmation,
  sendWelcomeEmail,
  sendMarketingEmail,
  sendNotificationEmail,

  // Named sender address constants
  // Use these when calling sendMail() directly to ensure the correct from address
  FROM_NOREPLY,
  FROM_HELLO,
  FROM_BILLING,
  FROM_SUPPORT,
  FROM_INFO,
  FROM_ADMIN,

  // Status and utility functions
  isPostmarkEnabled,
  getPostmarkStatus,
  loadEmailTemplate,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
};
