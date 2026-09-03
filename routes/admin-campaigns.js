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
const {
  sanitizeContent,
  escapeHtml: escapeSanitizerHtml,
} = require('../services/contentSanitizer');

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
 *
 * The engagement-systems audit that drove this PR recommended flipping this
 * default to a broadcast stream, on the assumption that Postmark
 * auto-provisions one on every server. Verification during this PR found
 * conflicting evidence for that (and this file's own long-standing comment,
 * presumably written from firsthand testing against this project's actual
 * Postmark account, says the opposite: a 'broadcasts' stream must be
 * created manually first, or sending fails with a 500). Given a wrong
 * default here breaks every campaign send in production, this stays
 * 'outbound' — deliberately not applying that part of the audit.
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
    intro = '',
    bodyText = '',
    featureList = '',
    bannerUrl = '',
    secondaryNote = '',
    ctaText = '',
    ctaUrl = '',
    name = DEFAULT_RECIPIENT_NAME,
  } = fields;

  const blocks = [];
  if (bannerUrl && /^https?:\/\//i.test(bannerUrl)) {
    blocks.push(
      `<p style="margin:0 0 20px;text-align:center;"><img src="${escapeAttr(bannerUrl)}" alt="Campaign banner" style="max-width:100%;height:auto;border-radius:14px;border:0;"></p>`
    );
  }
  if (intro) {
    blocks.push(`<p>${escapeSanitizerHtml(intro)}</p>`);
  }
  if (bodyText) {
    blocks.push(
      `<p>${escapeSanitizerHtml(bodyText)
        .replace(/\n{2,}/g, '</p><p>')
        .replace(/\n/g, '<br>')}</p>`
    );
  }
  if (featureList) {
    const items = featureList
      .split(/\n+/)
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => `<li>${escapeSanitizerHtml(item.replace(/^[-*•]\s*/, ''))}</li>`)
      .join('');
    if (items) {
      blocks.push(`<ul>${items}</ul>`);
    }
  }
  if (bodyHtml) {
    blocks.push(sanitizeContent(bodyHtml, false));
  }
  if (secondaryNote) {
    blocks.push(
      `<p style="font-size:14px;color:#64748B;"><em>${escapeSanitizerHtml(secondaryNote)}</em></p>`
    );
  }

  // Append a CTA button to the message body if both button fields are present
  let message = blocks.join('\n');
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

function validateCampaignLinks({ ctaText, ctaUrl, bannerUrl }) {
  if ((ctaText && !ctaUrl) || (ctaUrl && !ctaText)) {
    return 'CTA button text and CTA URL must be provided together.';
  }
  if (ctaUrl && !/^https?:\/\//i.test(ctaUrl)) {
    return 'CTA URL must start with http:// or https://';
  }
  if (bannerUrl && !/^https?:\/\//i.test(bannerUrl)) {
    return 'Banner image URL must start with http:// or https://';
  }
  return '';
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

  // Read both stores regardless of the requested audience — a recipient
  // surfaced from one store must still be excluded if the *other* store
  // says they unsubscribed, otherwise unsubscribing via the newsletter
  // link doesn't stop marketing sends (and vice versa).
  const [users, subs] = await Promise.all([
    dbUnified.read('users').catch(() => []),
    dbUnified.read('newsletterSubscribers').catch(() => []),
  ]);

  const suppressed = new Set();
  for (const u of users || []) {
    if (u.emailUnsubscribed && u.email) {
      suppressed.add(String(u.email).toLowerCase().trim());
    }
  }
  for (const s of subs || []) {
    if (s.status === 'unsubscribed' && s.email) {
      suppressed.add(String(s.email).toLowerCase().trim());
    }
  }

  function addRecipient(email, name) {
    if (!email || typeof email !== 'string') {
      return;
    }
    const key = email.toLowerCase().trim();
    if (emailSet.has(key) || suppressed.has(key)) {
      return;
    }
    emailSet.add(key);
    recipients.push({ email: email.trim(), name: name || DEFAULT_RECIPIENT_NAME });
  }

  if (audience === 'marketing' || audience === 'both') {
    for (const u of users || []) {
      // Must have marketing opt-in and must not be globally unsubscribed
      if ((u.notify_marketing === true || u.marketingOptIn === true) && !u.emailUnsubscribed) {
        addRecipient(u.email, u.name || u.username || '');
      }
    }
  }

  if (audience === 'newsletter' || audience === 'both') {
    for (const s of subs || []) {
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

// ── Recurring newsletter automation config ─────────────────────────────────────
// Read/write settings.newsletterAutomation, consumed by
// services/newsletterCadenceScheduler.js. Kept in the same file as the
// manual send endpoints since it configures the same underlying send path.

const VALID_CADENCES = ['weekly', 'monthly'];
const VALID_AUDIENCES = ['both', 'marketing', 'newsletter'];

router.get('/automation', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    return res.json({ ok: true, automation: settings.newsletterAutomation || null });
  } catch (err) {
    logger.error('[campaigns/automation] Error reading config:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to load automation settings.' });
  }
});

router.put('/automation', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
  try {
    const {
      enabled = false,
      cadence,
      dayOfWeek,
      dayOfMonth,
      audience = 'both',
      subject,
      title,
      bodyHtml,
      ctaText,
      ctaUrl,
    } = req.body || {};

    if (enabled) {
      if (!VALID_CADENCES.includes(cadence)) {
        return res.status(400).json({ ok: false, error: 'cadence must be "weekly" or "monthly".' });
      }
      if (cadence === 'weekly') {
        const dow = Number(dayOfWeek);
        if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
          return res.status(400).json({ ok: false, error: 'dayOfWeek must be an integer 0–6.' });
        }
      }
      if (cadence === 'monthly') {
        const dom = Number(dayOfMonth);
        if (!Number.isInteger(dom) || dom < 1 || dom > 31) {
          return res.status(400).json({ ok: false, error: 'dayOfMonth must be an integer 1–31.' });
        }
      }
      if (!subject || typeof subject !== 'string' || !subject.trim()) {
        return res
          .status(400)
          .json({ ok: false, error: 'subject is required when enabling automation.' });
      }
      if (!bodyHtml || typeof bodyHtml !== 'string' || !bodyHtml.trim()) {
        return res
          .status(400)
          .json({ ok: false, error: 'bodyHtml is required when enabling automation.' });
      }
    }

    if (!VALID_AUDIENCES.includes(audience)) {
      return res.status(400).json({ ok: false, error: 'Invalid audience value.' });
    }

    const validationError = validateCampaignLinks({ ctaText, ctaUrl });
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    const settings = (await dbUnified.read('settings')) || {};
    const existing = settings.newsletterAutomation || {};
    settings.newsletterAutomation = {
      ...existing,
      enabled: Boolean(enabled),
      cadence: cadence || existing.cadence,
      dayOfWeek: dayOfWeek !== undefined ? Number(dayOfWeek) : existing.dayOfWeek,
      dayOfMonth: dayOfMonth !== undefined ? Number(dayOfMonth) : existing.dayOfMonth,
      audience,
      subject: subject !== undefined ? subject : existing.subject,
      title: title !== undefined ? title : existing.title,
      bodyHtml: bodyHtml !== undefined ? bodyHtml : existing.bodyHtml,
      ctaText: ctaText !== undefined ? ctaText : existing.ctaText,
      ctaUrl: ctaUrl !== undefined ? ctaUrl : existing.ctaUrl,
    };
    await dbUnified.writeAndVerify('settings', settings);

    return res.json({ ok: true, automation: settings.newsletterAutomation });
  } catch (err) {
    logger.error('[campaigns/automation] Error saving config:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to save automation settings.' });
  }
});

// ── POST /campaigns/preview ────────────────────────────────────────────────────
// No csrfProtection: preview is idempotent (renders template, no side-effects).
// It still requires authRequired + roleRequired('admin') to prevent unauthenticated access.

router.post('/preview', authRequired, roleRequired('admin'), (req, res) => {
  try {
    const {
      templateName = 'marketing',
      title,
      bodyHtml,
      intro,
      bodyText,
      featureList,
      bannerUrl,
      secondaryNote,
      ctaText,
      ctaUrl,
    } = req.body;

    const safeTemplateName = typeof templateName === 'string' ? templateName.trim() : '';
    if (!CAMPAIGN_SAFE_TEMPLATES.has(safeTemplateName)) {
      return res.status(400).json({
        ok: false,
        error: `Template "${escapeHtml(safeTemplateName || String(templateName))}" is not available for campaigns.`,
      });
    }

    const validationError = validateCampaignLinks({ ctaText, ctaUrl, bannerUrl });
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    const templateData = buildTemplateData({
      title,
      bodyHtml,
      intro,
      bodyText,
      featureList,
      bannerUrl,
      secondaryNote,
      ctaText,
      ctaUrl,
    });
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
        intro,
        bodyText,
        featureList,
        bannerUrl,
        secondaryNote,
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

      const validationError = validateCampaignLinks({ ctaText, ctaUrl, bannerUrl });
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }

      const templateData = buildTemplateData({
        title,
        bodyHtml,
        intro,
        bodyText,
        featureList,
        bannerUrl,
        secondaryNote,
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
        unsubscribeUrl: templateData.unsubscribeLink,
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

/**
 * Core campaign-send logic, shared by the admin /send endpoint and
 * services/newsletterCadenceScheduler.js's automated recurring send.
 * Validates nothing itself (callers validate audience/template/links per
 * their own input source) — just resolves recipients and sends in batches.
 *
 * @param {Object} config
 * @param {string} config.audience - 'both'|'marketing'|'newsletter'
 * @param {string} config.subject
 * @param {string} config.templateName - must be in CAMPAIGN_SAFE_TEMPLATES
 * @param {string} [config.bodyHtml]
 * @param {string} [config.intro]
 * @param {string} [config.bodyText]
 * @param {string} [config.featureList]
 * @param {string} [config.bannerUrl]
 * @param {string} [config.secondaryNote]
 * @param {string} [config.title]
 * @param {string} [config.ctaText]
 * @param {string} [config.ctaUrl]
 * @returns {Promise<{ sent: number, failed: number, total: number }>}
 */
async function sendCampaign({
  audience,
  subject,
  templateName,
  bodyHtml,
  intro,
  bodyText,
  featureList,
  bannerUrl,
  secondaryNote,
  title,
  ctaText,
  ctaUrl,
}) {
  const recipients = await collectRecipients(audience);
  const total = recipients.length;

  if (total === 0) {
    return { sent: 0, failed: 0, total: 0 };
  }

  let sent = 0;
  let failed = 0;

  // Send in batches to avoid timeouts
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async ({ email, name }) => {
        try {
          const templateData = buildTemplateData({
            title,
            bodyHtml,
            intro,
            bodyText,
            featureList,
            bannerUrl,
            secondaryNote,
            ctaText,
            ctaUrl,
            name,
          });
          templateData.unsubscribeLink = buildUnsubscribeLink(email);

          await postmark.sendMail({
            to: email,
            subject,
            template: templateName,
            templateData,
            messageStream: CAMPAIGN_MESSAGE_STREAM,
            tags: ['campaign'],
            unsubscribeUrl: templateData.unsubscribeLink,
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
  return { sent, failed, total };
}

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
        intro,
        bodyText,
        featureList,
        bannerUrl,
        secondaryNote,
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

      const validationError = validateCampaignLinks({ ctaText, ctaUrl, bannerUrl });
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }

      const { sent, failed, total } = await sendCampaign({
        audience,
        subject,
        templateName: safeTemplateName,
        bodyHtml,
        intro,
        bodyText,
        featureList,
        bannerUrl,
        secondaryNote,
        title,
        ctaText,
        ctaUrl,
      });

      if (total === 0) {
        return res.json({
          ok: true,
          sent: 0,
          skipped: 0,
          total: 0,
          message: 'No opted-in recipients found.',
        });
      }

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
module.exports.buildTemplateData = buildTemplateData;
module.exports.validateCampaignLinks = validateCampaignLinks;
module.exports.sendCampaign = sendCampaign;
module.exports.collectRecipients = collectRecipients;
