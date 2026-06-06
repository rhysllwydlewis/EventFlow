/**
 * Admin Campaigns Routes
 *
 * Provides admin-only endpoints for composing, previewing, and sending
 * marketing email campaigns to opted-in recipients.
 *
 * Endpoints:
 *   POST /campaigns/preview  – render template and return HTML for live preview
 *   POST /campaigns/test     – send a single test email to a supplied address
 *   POST /campaigns/send     – send campaign to all opted-in recipients in batches
 *
 * Auth:  authRequired + roleRequired('admin') on every route
 * CSRF:  csrfProtection on /test and /send (state-changing POSTs).
 *        /preview has no CSRF protection because it is idempotent (no side-effects).
 */

'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const postmark = require('../utils/postmark');
const { EMAIL_ENABLED } = require('../config/email');

/**
 * Templates that can be used for admin campaigns.
 * Only these template names are accepted for preview, test and send.
 * This prevents path traversal and accidental use of transactional templates.
 */
const CAMPAIGN_SAFE_TEMPLATES = new Set(['marketing', 'notification']);

// ── Template variable replacement ─────────────────────────────────────────────

const APP_BASE_URL = process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';

const DEFAULT_RECIPIENT_NAME = 'Subscriber';

/**
 * Postmark message stream used for campaign emails.
 * Use 'outbound' (always available) unless a dedicated broadcasts stream is configured.
 * Override via CAMPAIGN_MESSAGE_STREAM env var (e.g. 'broadcasts') if your Postmark
 * account has a custom marketing stream set up.
 */
const CAMPAIGN_MESSAGE_STREAM = process.env.CAMPAIGN_MESSAGE_STREAM || 'outbound';

/**
 * Build a personalised unsubscribe link for a recipient email address.
 * @param {string} email
 * @returns {string}
 */
function buildUnsubscribeLink(email) {
  const token = postmark.generateUnsubscribeToken(email);
  return `${APP_BASE_URL}/api/auth/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}

/**
 * Build template data object from campaign fields.
 * Injects the CTA button HTML into the message if ctaText/ctaUrl are provided.
 *
 * @param {Object} fields
 * @returns {Object} templateData suitable for postmark.loadEmailTemplate
 */
function buildTemplateData(fields) {
  const {
    title = '',
    bodyHtml = '',
    ctaText = '',
    ctaUrl = '',
    name = DEFAULT_RECIPIENT_NAME,
  } = fields;

  // Append a CTA button to the message body if both button fields are present
  let message = bodyHtml;
  if (ctaText && ctaUrl) {
    // Inline-styled button for email client compatibility (existing template uses inline styles)
    message += `\n<p style="margin:24px 0 0;text-align:center;">
  <a href="${escapeAttr(ctaUrl)}"
     style="display:inline-block;background:#0B8073;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:10px;">${escapeHtml(ctaText)}</a>
</p>`;
  }

  return { title, message, name };
}

function escapeHtml(str) {
  if (typeof str !== 'string') {
    return '';
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
  if (typeof str !== 'string') {
    return '';
  }
  // Only allow http/https URLs
  if (!/^https?:\/\//i.test(str)) {
    return '#';
  }
  return str.replace(/"/g, '%22');
}

// ── Recipient collection ───────────────────────────────────────────────────────

/**
 * Collect opted-in recipients from users and/or newsletter subscribers.
 * Deduplicates by email (case-insensitive) and excludes suppressed addresses.
 *
 * @param {string} audience – 'both' | 'marketing' | 'newsletter'
 * @returns {Promise<Array<{email:string, name:string}>>}
 */
async function collectRecipients(audience) {
  const emailSet = new Set();
  const recipients = [];

  function addRecipient(email, name) {
    if (!email || typeof email !== 'string') {
      return;
    }
    const key = email.toLowerCase().trim();
    if (emailSet.has(key)) {
      return;
    }
    emailSet.add(key);
    recipients.push({ email: email.trim(), name: name || DEFAULT_RECIPIENT_NAME });
  }

  if (audience === 'marketing' || audience === 'both') {
    const users = (await dbUnified.read('users')) || [];
    for (const u of users) {
      // Must have marketing opt-in and must not be globally unsubscribed
      if ((u.notify_marketing === true || u.marketingOptIn === true) && !u.emailUnsubscribed) {
        addRecipient(u.email, u.name || u.username || '');
      }
    }
  }

  if (audience === 'newsletter' || audience === 'both') {
    const subs = (await dbUnified.read('newsletterSubscribers')) || [];
    for (const s of subs) {
      if (s.status === 'active') {
        addRecipient(s.email, s.name || '');
      }
    }
  }

  return recipients;
}

// ── GET /campaigns/recipient-count ───────────────────────────────────────────

router.get('/recipient-count', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    // Support ?audience=both|marketing|newsletter query param for per-audience counts
    const requestedAudience = req.query.audience;
    const validAudiences = ['both', 'marketing', 'newsletter'];
    const audience = validAudiences.includes(requestedAudience) ? requestedAudience : 'both';
    const recipients = await collectRecipients(audience);
    return res.json({ ok: true, total: recipients.length, audience });
  } catch (err) {
    logger.error('[campaigns/recipient-count] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to count recipients.' });
  }
});

// ── POST /campaigns/preview ────────────────────────────────────────────────────
// No csrfProtection: preview is idempotent (renders template, no side-effects).
// It still requires authRequired + roleRequired('admin') to prevent unauthenticated access.

router.post('/preview', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const { templateName = 'marketing', subject, title, bodyHtml, ctaText, ctaUrl } = req.body;

    const safeTemplateName = typeof templateName === 'string' ? templateName.trim() : '';
    if (!CAMPAIGN_SAFE_TEMPLATES.has(safeTemplateName)) {
      return res.status(400).json({
        ok: false,
        error: `Template "${escapeHtml(safeTemplateName || String(templateName))}" is not available for campaigns.`,
      });
    }

    const templateData = buildTemplateData({ title, bodyHtml, ctaText, ctaUrl });
    // Add a placeholder unsubscribe link so the template renders a visible link
    // in preview mode (the real personalised link is only generated on /test and /send).
    templateData.unsubscribeLink = `${APP_BASE_URL}/api/auth/unsubscribe?preview=1`;
    const html = postmark.loadEmailTemplate(safeTemplateName, templateData);

    if (!html) {
      return res
        .status(404)
        .json({ ok: false, error: `Template "${escapeHtml(templateName)}" not found.` });
    }

    return res.json({ ok: true, html });
  } catch (err) {
    logger.error('[campaigns/preview] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to render preview.' });
  }
});

// ── POST /campaigns/test ───────────────────────────────────────────────────────

router.post(
  '/test',
  writeLimiter,
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    if (!EMAIL_ENABLED) {
      return res
        .status(503)
        .json({ ok: false, error: 'Email sending is disabled. Set EMAIL_ENABLED=true to enable.' });
    }

    try {
      const {
        to,
        subject = '(Test) EventFlow Campaign',
        templateName = 'marketing',
        bodyHtml,
        title,
        ctaText,
        ctaUrl,
      } = req.body;

      if (!to || typeof to !== 'string') {
        return res.status(400).json({ ok: false, error: 'Missing required field: to' });
      }

      // Basic email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(to.trim())) {
        return res.status(422).json({ ok: false, error: 'Invalid email address.' });
      }

      const safeTemplateName = typeof templateName === 'string' ? templateName.trim() : '';
      if (!CAMPAIGN_SAFE_TEMPLATES.has(safeTemplateName)) {
        return res.status(400).json({
          ok: false,
          error: `Template "${escapeHtml(safeTemplateName || String(templateName))}" is not available for campaigns.`,
        });
      }

      // CTA URL must be http/https if CTA text is provided
      if (ctaText && ctaUrl && !/^https?:\/\//i.test(ctaUrl)) {
        return res
          .status(400)
          .json({ ok: false, error: 'CTA URL must start with http:// or https://' });
      }
      // CTA text required when CTA URL is provided
      if (ctaUrl && !ctaText) {
        return res
          .status(400)
          .json({ ok: false, error: 'CTA button text is required when a CTA URL is provided.' });
      }

      const templateData = buildTemplateData({
        title,
        bodyHtml,
        ctaText,
        ctaUrl,
        name: 'Test Recipient',
      });
      templateData.unsubscribeLink = buildUnsubscribeLink(to.trim());

      await postmark.sendMail({
        to: to.trim(),
        subject: `[TEST] ${subject}`,
        template: safeTemplateName,
        templateData,
        messageStream: CAMPAIGN_MESSAGE_STREAM,
        tags: ['campaign-test'],
      });

      logger.info(`[campaigns/test] Test sent to ${to}`);
      return res.json({ ok: true, message: `Test email sent to ${to}.` });
    } catch (err) {
      logger.error('[campaigns/test] Error:', { message: err.message, to: req.body?.to });
      return res
        .status(500)
        .json({ ok: false, error: err.message || 'Failed to send test email.' });
    }
  }
);

// ── POST /campaigns/send ───────────────────────────────────────────────────────

const BATCH_SIZE = 50;

router.post(
  '/send',
  writeLimiter,
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    if (!EMAIL_ENABLED) {
      return res
        .status(503)
        .json({ ok: false, error: 'Email sending is disabled. Set EMAIL_ENABLED=true to enable.' });
    }

    try {
      const {
        audience = 'both',
        subject,
        templateName = 'marketing',
        bodyHtml,
        title,
        ctaText,
        ctaUrl,
      } = req.body;

      if (!subject || typeof subject !== 'string' || !subject.trim()) {
        return res.status(400).json({ ok: false, error: 'Missing required field: subject' });
      }

      const validAudiences = ['both', 'marketing', 'newsletter'];
      if (!validAudiences.includes(audience)) {
        return res.status(400).json({ ok: false, error: 'Invalid audience value.' });
      }

      const safeTemplateName = typeof templateName === 'string' ? templateName.trim() : '';
      if (!CAMPAIGN_SAFE_TEMPLATES.has(safeTemplateName)) {
        return res.status(400).json({
          ok: false,
          error: `Template "${escapeHtml(safeTemplateName || String(templateName))}" is not available for campaigns.`,
        });
      }

      // CTA URL must be http/https if provided alongside CTA text
      if (ctaText && ctaUrl && !/^https?:\/\//i.test(ctaUrl)) {
        return res
          .status(400)
          .json({ ok: false, error: 'CTA URL must start with http:// or https://' });
      }
      if (ctaUrl && !ctaText) {
        return res
          .status(400)
          .json({ ok: false, error: 'CTA button text is required when a CTA URL is provided.' });
      }

      const recipients = await collectRecipients(audience);
      const total = recipients.length;

      if (total === 0) {
        return res.json({
          ok: true,
          sent: 0,
          skipped: 0,
          total: 0,
          message: 'No opted-in recipients found.',
        });
      }

      let sent = 0;
      let failed = 0;

      // Send in batches to avoid timeouts
      for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
        const batch = recipients.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map(async ({ email, name }) => {
            try {
              const templateData = buildTemplateData({ title, bodyHtml, ctaText, ctaUrl, name });
              templateData.unsubscribeLink = buildUnsubscribeLink(email);

              await postmark.sendMail({
                to: email,
                subject,
                template: safeTemplateName,
                templateData,
                messageStream: CAMPAIGN_MESSAGE_STREAM,
                tags: ['campaign'],
              });
              sent++;
            } catch (err) {
              failed++;
              logger.warn(`[campaigns/send] Failed to send to ${email}: ${err.message}`);
            }
          })
        );
      }

      logger.info(
        `[campaigns/send] Done. sent=${sent} failed=${failed} total=${total} audience=${audience}`
      );
      return res.json({
        ok: true,
        sent,
        skipped: failed,
        total,
        message: `Campaign delivered. ${sent} sent, ${failed} failed out of ${total} recipients.`,
      });
    } catch (err) {
      logger.error('[campaigns/send] Error:', err.message);
      return res.status(500).json({ ok: false, error: err.message || 'Failed to send campaign.' });
    }
  }
);

module.exports = router;
module.exports.CAMPAIGN_SAFE_TEMPLATES = CAMPAIGN_SAFE_TEMPLATES;
