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
const {
  getPreheader,
  renderPlainTextTemplate,
  isKnownTemplate,
} = require('./emailTemplateRegistry');
const fs = require('fs');
const crypto = require('crypto');
const emailLogService = require('../services/emailLog.service');

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

// Postmark's own 4xx errors (invalid API key, malformed request, inactive
// recipient) mean the same call will fail identically on every retry — only
// retry transient failures: 5xx/429 responses, and network-level errors.
// The postmark client's ErrorHandler wraps every thrown error in a
// PostmarkError, whose constructor defaults statusCode to 0 (not undefined)
// when the failure never reached Postmark's servers at all (timeout,
// ECONNRESET, DNS failure) — so `typeof error.statusCode !== 'number'`
// never actually catches those; check for the 0 sentinel value instead.
function isRetryablePostmarkError(error) {
  if (!error || typeof error.statusCode !== 'number') {
    return true;
  }
  return error.statusCode === 0 || error.statusCode >= 500 || error.statusCode === 429;
}

/**
 * Send via the Postmark client with retry/backoff for transient failures.
 * Direct sends (outside the BullMQ email queue, which already retries 5x)
 * previously failed permanently on the first transient error.
 */
async function sendEmailWithRetry(emailData, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await postmarkClient.sendEmail(emailData);
    } catch (error) {
      lastError = error;

      if (!isRetryablePostmarkError(error) || attempt === maxRetries) {
        throw error;
      }

      const delay = 2 ** (attempt - 1) * 1000;
      logger.warn(
        `Postmark send failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${delay}ms...`
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

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

function escapeHtmlValue(text) {
  if (typeof text !== 'string') {
    return text;
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeHttpUrl(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return '#';
  }
  return url.replace(/"/g, '%22');
}

const RAW_HTML_TEMPLATE_KEYS = new Set([
  // Backend-generated or sanitised rich content only. See docs/EMAIL_TEMPLATES.md.
  'message',
  'html',
  'features',
  'actionsHtml',
  'unsubscribeSection',
  'notesSection',
  'ctaSection',
  'replyMessageHtml',
  'trialRow',
  'previewHtml',
]);

function buildHiddenPreheader(preheader) {
  if (!preheader) {
    return '';
  }
  return `<div class="ef-preheader" style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;">${preheader}</div>`;
}

function injectPreheader(html, preheader) {
  if (!preheader || html.includes('ef-preheader')) {
    return html;
  }
  const hidden = buildHiddenPreheader(preheader);
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${hidden}`);
  }
  return `${hidden}${html}`;
}

function injectEmailBranding(html) {
  const fallbackTile =
    '<span style="display:inline-block;width:100%;height:100%;line-height:inherit;color:inherit;font:inherit;letter-spacing:inherit;">EF</span>';
  return html
    .replace(/<td([^>]*?)>EF<\/td>/, `<td$1>${fallbackTile}</td>`)
    .replace(
      />EventFlow<\/div>/,
      '>EventFlow<span style="font-size:13px;font-weight:500;opacity:.82;"> &middot; Event planning made simple</span></div>'
    );
}

/**
 * Load and process email template
 * @param {string} templateName - Name of template file (without .html)
 * @param {Object} data - Template variables to replace
 * @returns {string|null} Processed HTML template or null
 */
function loadEmailTemplate(templateName, data = {}) {
  try {
    if (!isKnownTemplate(templateName)) {
      logger.error(`Email template not found or not allowlisted: ${templateName}.html`);
      return null;
    }
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
      const value = RAW_HTML_TEMPLATE_KEYS.has(key) ? data[key] : escapeHtml(data[key]);
      html = html.replace(regex, value || '');
    });

    // Add current year
    html = html.replace(/{{year}}/g, new Date().getFullYear());

    // Add base URL
    html = html.replace(/{{baseUrl}}/g, APP_BASE_URL);

    const preheader = escapeHtml(data.preheader || getPreheader(templateName));
    html = html.replace(/{{preheader}}/g, preheader);
    html = injectPreheader(html, preheader);
    html = injectEmailBranding(html);

    // Clear any remaining unresolved template placeholders
    html = html.replace(/\{\{[^}]+\}\}/g, '');

    return html;
  } catch (err) {
    logger.error('Error loading email template:', err.message);
    return null;
  }
}

async function updateEmailLogSafe(log, updates) {
  if (!log || !log.id) {
    return;
  }
  try {
    await emailLogService.updateStatus(log.id, updates);
  } catch (err) {
    logger.warn('[email-log] Failed to update email log:', err.message);
  }
}

async function createEmailAttemptLogSafe(options) {
  if (options && options.logEmail === false) {
    return null;
  }
  try {
    return await emailLogService.createAttempt(options);
  } catch (err) {
    logger.warn('[email-log] Failed to create email log:', err.message);
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
    criticalDelivery = false,
    // The BullMQ email queue (services/queue/workers/email.worker.js) already
    // retries a failed job 5x with its own exponential backoff, so it opts
    // out of sendEmailWithRetry's in-process retry here — otherwise a single
    // logical send during an outage becomes up to 5 outer attempts x 3 inner
    // attempts, and each blocked-in-process retry adds up to 3s to a job
    // BullMQ was already about to reschedule on its own.
    retryOnFailure = true,
    // When set, adds RFC 8058 one-click unsubscribe headers — required by
    // Gmail/Yahoo's bulk-sender rules (Feb 2024) or mail gets bulk-foldered
    // or rejected outright. Only pass this for marketing/broadcast sends;
    // POST /api/auth/unsubscribe (the one-click target) is the same
    // token-verified action the link itself performs.
    unsubscribeUrl,
  } = options;

  const logOptions = {
    ...options,
    from,
    subject: subject || '(from template)',
    messageStream: options.messageStream || 'outbound',
  };
  const emailLog = await createEmailAttemptLogSafe(logOptions);
  const logId = emailLog && emailLog.id ? emailLog.id : null;

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

  try {
    // Check if Postmark is enabled
    if (!POSTMARK_ENABLED || !postmarkClient) {
      logger.warn('⚠️  Postmark not configured - saving email to /outbox instead');
      if (criticalDelivery && process.env.NODE_ENV === 'production') {
        const criticalError = new Error(
          'Critical email delivery failed: Postmark is not configured in production'
        );
        await updateEmailLogSafe(emailLog, {
          provider: 'postmark',
          status: 'failed',
          errorMessage: criticalError.message,
        });
        throw criticalError;
      }

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
        TextBody: text || (template ? renderPlainTextTemplate(template, templateData) : undefined),
        Template: template,
      };
      saveEmailToOutbox(outboxData);

      const outboxMessageId = `outbox-${Date.now()}`;
      const sentAt = new Date().toISOString();
      await updateEmailLogSafe(emailLog, {
        provider: 'outbox',
        status: 'sent',
        postmarkMessageId: outboxMessageId,
        sentAt,
      });

      return {
        status: 'disabled',
        message: 'Postmark not configured. Email saved to outbox.',
        MessageID: outboxMessageId,
        PostmarkMessageID: null,
        emailLogId: logId,
        provider: 'outbox',
        emailLogStatus: 'sent',
        sentAt,
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
      // Provide text fallback if HTML is used. Prefer curated template text, then caller text.
      if (!text && template) {
        emailData.TextBody = renderPlainTextTemplate(template, templateData);
      } else if (!text) {
        // Simple HTML to text conversion fallback for ad-hoc HTML emails
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

    // RFC 8058 one-click unsubscribe headers. Only add List-Unsubscribe-Post
    // (which promises a POST-only, no-body one-click action) alongside a
    // real https link the mail client can POST to directly — never for a
    // bare mailto: link, which can't satisfy that contract.
    if (unsubscribeUrl && /^https?:\/\//i.test(unsubscribeUrl)) {
      emailData.Headers = [
        ...(emailData.Headers || []),
        { Name: 'List-Unsubscribe', Value: `<${unsubscribeUrl}>` },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      ];
    }

    try {
      const response = retryOnFailure
        ? await sendEmailWithRetry(emailData)
        : await postmarkClient.sendEmail(emailData);
      logger.info(`✅ Email sent successfully via Postmark`);
      logger.info(`   To: ${emailData.To}`);
      logger.info(`   Subject: ${emailData.Subject}`);
      logger.info(`   MessageID: ${response.MessageID}`);
      logger.info(`   Stream: ${emailData.MessageStream}`);
      const sentAt = new Date().toISOString();
      await updateEmailLogSafe(emailLog, {
        provider: 'postmark',
        status: 'sent',
        postmarkMessageId: response.MessageID || null,
        sentAt,
      });
      return {
        ...response,
        PostmarkMessageID: response.MessageID || null,
        emailLogId: logId,
        provider: 'postmark',
        emailLogStatus: 'sent',
        sentAt,
      };
    } catch (err) {
      logger.error('❌ Postmark send error:', err.message);
      logger.error('   To:', emailData.To);
      logger.error('   Subject:', emailData.Subject);

      // Save to outbox as fallback for debugging outside production critical auth flows
      if (!(criticalDelivery && process.env.NODE_ENV === 'production')) {
        saveEmailToOutbox(emailData);
      }

      // Re-throw error so calling code can handle it (e.g., rollback)
      throw new Error(`Failed to send email via Postmark: ${err.message}`);
    }
  } catch (error) {
    await updateEmailLogSafe(emailLog, {
      status: 'failed',
      errorMessage: error.message ? error.message.slice(0, 500) : 'Email send failed',
    });
    throw error;
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
// eslint-disable-next-line require-await -- signature locked by tests/integration/postmark-email-integration.test.js source-match assertions
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
    criticalDelivery: true,
  });
}

/**
 * Send password reset email to user
 * @param {Object} user - User object with email, name
 * @param {string} resetToken - Password reset token
 * @returns {Promise<Object>} Send result
 * @throws {Error} If email sending fails
 */
// eslint-disable-next-line require-await -- signature locked by tests/integration/postmark-email-integration.test.js source-match assertions
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
    criticalDelivery: true,
  });
}

/**
 * Send welcome email to newly verified user
 * @param {Object} user - User object with email, name
 * @returns {Promise<Object>} Send result
 * @throws {Error} If email sending fails
 */
// eslint-disable-next-line require-await -- signature locked by tests/integration/postmark-email-integration.test.js source-match assertions
async function sendWelcomeEmail(user) {
  const from = FROM_HELLO;
  const welcomeTemplateConfig = { template: 'welcome' };
  const template = welcomeTemplateConfig.template;
  const normalizedRole = typeof user.role === 'string' ? user.role.trim().toLowerCase() : '';
  const roleTemplate = normalizedRole === 'supplier' ? 'welcome-supplier' : 'welcome-customer';

  logger.info(`📧 Sending welcome email to ${user.email}`);
  logger.info(`   Role: ${normalizedRole || 'missing (defaulting to customer)'}`);
  logger.info(`   Selected welcome template: ${roleTemplate}`);

  return sendMail({
    to: user.email,
    subject: 'Welcome to EventFlow!',
    template: roleTemplate || template,
    templateData: {
      name: user.name || 'there',
    },
    from,
    tags: ['welcome', normalizedRole || 'customer', 'transactional'],
    messageStream: 'outbound',
  });
}

/**
 * Send password reset confirmation email
 * @param {Object} user - User object with email, name
 * @returns {Promise<Object>} Send result
 * @throws {Error} If email sending fails
 */
function sendPasswordResetConfirmation(user) {
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
// eslint-disable-next-line require-await -- signature locked by tests/integration/postmark-email-integration.test.js source-match assertions
async function sendMarketingEmail(user, subject, message, options = {}) {
  const {
    template: selectedTemplate = 'marketing',
    templateData: extraTemplateData = {},
    messageStream: selectedMessageStream = 'broadcasts',
    ctaText,
    ctaLink,
    ...sendOptions
  } = options;

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
  if (ctaText && ctaLink) {
    fullMessage += `\n\n<div style="text-align: center; margin: 24px 0;">
      <a href="${safeHttpUrl(ctaLink)}" class="cta-button" style="display: inline-block; padding: 14px 28px; background: linear-gradient(180deg, #16c3ad, #0ea896); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px;">${escapeHtmlValue(ctaText)}</a>
    </div>`;
  }

  const templateData = {
    ...extraTemplateData,
    name: user.name || 'there',
    title: subject,
    message: fullMessage,
    unsubscribeLink: unsubscribeLink,
  };

  return sendMail({
    ...sendOptions,
    to: user.email,
    subject: subject,
    template: selectedTemplate,
    templateData: templateData,
    from: sendOptions.from || FROM_INFO,
    tags: sendOptions.tags || ['marketing'],
    messageStream: selectedMessageStream,
    unsubscribeUrl: unsubscribeLink,
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
// eslint-disable-next-line require-await -- signature locked by tests/integration/postmark-email-integration.test.js source-match assertions
async function sendNotificationEmail(user, subject, message, options = {}) {
  const {
    template: selectedTemplate = 'notification',
    templateData: extraTemplateData = {},
    actionUrl: optionActionUrl,
    actionText: optionActionText,
    ...sendOptions
  } = options;

  // Check if user has opted in to account notifications
  if (user.notify_account === false) {
    logger.info(`Skipping notification email to ${user.email} (user opted out)`);
    return null;
  }

  // Build optional CTA section — avoids empty href="" in template when no CTA is needed
  const actionUrl = optionActionUrl || extraTemplateData.actionUrl;
  const actionText = optionActionText || extraTemplateData.actionText;
  const ctaSection =
    actionUrl && actionText && /^https?:\/\//i.test(actionUrl)
      ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;"><tr><td align="center"><a href="${safeHttpUrl(actionUrl)}" style="display:inline-block;padding:15px 40px;background:linear-gradient(135deg,#0B8073,#13B6A2);color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.2px;">${escapeHtmlValue(actionText)}</a></td></tr></table>`
      : '';

  const templateData = {
    ...extraTemplateData,
    name: user.name || 'there',
    title: subject,
    message: message,
    preferencesLink: `${APP_BASE_URL}/settings/notifications`,
    ctaSection,
  };

  return sendMail({
    ...sendOptions,
    to: user.email,
    subject: subject,
    template: selectedTemplate,
    templateData: templateData,
    from: sendOptions.from || FROM_SUPPORT,
    tags: sendOptions.tags || ['notification', 'transactional'],
    messageStream: sendOptions.messageStream || 'outbound',
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
  RAW_HTML_TEMPLATE_KEYS,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
};
