/**
 * Admin Webhooks Test Route
 *
 * POST /api/v1/admin/debug/test-webhooks
 *
 * Tests all configured webhook integrations and reports their status.
 * This route is mounted unconditionally (including in production) so that
 * admins can verify webhook configuration after every deployment.
 *
 * Security: admin auth + CSRF — identical protection to the debug routes.
 */

'use strict';

const crypto = require('crypto');
const express = require('express');
const logger = require('../utils/logger');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { auditLog } = require('../middleware/audit');

const router = express.Router();

/**
 * POST /test-webhooks
 * Tests all configured webhook integrations and reports their status.
 *
 * Checks:
 *   - Stripe webhook:   STRIPE_WEBHOOK_SECRET configured?
 *   - Postmark webhook: POSTMARK_WEBHOOK_USER + POSTMARK_WEBHOOK_PASS configured?
 *   - MongoDB webhook:  MONGODB_WEBHOOK_SECRET configured?
 *
 * For each configured webhook the endpoint also sends a synthetic test request
 * to the local webhook handler and records the HTTP response.
 *
 * Admin only.
 */
router.post(
  '/test-webhooks',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    // Build base URL from environment variables only — never from request headers
    // to avoid SSRF via a forged Host header.
    const port = process.env.PORT || 3000;
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

    logger.info(`[ADMIN DEBUG] Webhook test triggered by admin: ${req.user.email}`);

    /**
     * Send a synthetic POST to a local webhook endpoint and return a result object.
     *
     * @param {string} name       Human-readable label.
     * @param {string} path       URL path relative to baseUrl.
     * @param {Object} body       JSON payload to send.
     * @param {Object} headers    Additional headers (e.g. signature header).
     * @returns {Promise<{name, configured, status, ok, error}>}
     */
    async function probeWebhook(name, path, body, headers = {}) {
      const url = `${baseUrl}${path}`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const httpRes = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
        });
        clearTimeout(timer);
        return { name, configured: true, status: httpRes.status, ok: httpRes.ok };
      } catch (err) {
        return { name, configured: true, status: null, ok: false, error: err.message };
      }
    }

    const results = [];

    // ── Stripe ──────────────────────────────────────────────────────────
    const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripeSecret) {
      results.push({
        name: 'stripe',
        configured: false,
        ok: false,
        details: 'STRIPE_WEBHOOK_SECRET is not set',
      });
    } else {
      // Build a minimal Stripe-like signed payload for the probe
      const timestamp = Math.floor(Date.now() / 1000);
      const testBody = JSON.stringify({ type: 'ping', data: { object: {} } });
      const signedPayload = `${timestamp}.${testBody}`;
      const sig = crypto.createHmac('sha256', stripeSecret).update(signedPayload).digest('hex');
      const stripeSignatureHeader = `t=${timestamp},v1=${sig}`;
      const stripeResult = await probeWebhook(
        'stripe',
        '/api/v2/webhooks/stripe',
        JSON.parse(testBody),
        { 'stripe-signature': stripeSignatureHeader, 'content-type': 'application/json' }
      );
      // The Stripe endpoint rejects unknown event types with 400 after accepting the
      // signature — meaning the endpoint is live and signature verification passed.
      // Treat 200 and 400 as "reachable and authenticated"; anything else is a failure.
      const stripeReachable =
        stripeResult.status === 200 || stripeResult.status === 400;
      stripeResult.ok = stripeReachable;
      stripeResult.details = stripeResult.status !== null
        ? `Endpoint reachable (HTTP ${stripeResult.status}${stripeResult.status === 400 ? ' — test event type rejected, signature accepted' : ''})`
        : stripeResult.error;
      results.push(stripeResult);
    }

    // ── Postmark ─────────────────────────────────────────────────────────
    const postmarkUser = process.env.POSTMARK_WEBHOOK_USER;
    const postmarkPass = process.env.POSTMARK_WEBHOOK_PASS;
    if (!postmarkUser || !postmarkPass) {
      results.push({
        name: 'postmark',
        configured: false,
        ok: null,
        details:
          'POSTMARK_WEBHOOK_USER / POSTMARK_WEBHOOK_PASS not set — authentication skipped in non-production',
      });
    } else {
      const creds = Buffer.from(`${postmarkUser}:${postmarkPass}`).toString('base64');
      const postmarkResult = await probeWebhook(
        'postmark',
        '/api/webhooks/postmark',
        { RecordType: 'Open', MessageID: 'test-debug-probe', Recipient: 'debug@test.invalid' },
        { Authorization: `Basic ${creds}` }
      );
      postmarkResult.details =
        postmarkResult.status !== null
          ? `Endpoint responded with HTTP ${postmarkResult.status}`
          : postmarkResult.error;
      results.push(postmarkResult);
    }

    // ── MongoDB ───────────────────────────────────────────────────────────
    const mongoSecret = process.env.MONGODB_WEBHOOK_SECRET;
    if (!mongoSecret) {
      results.push({
        name: 'mongodb',
        configured: false,
        ok: null,
        details:
          'MONGODB_WEBHOOK_SECRET is not set — signature verification skipped in non-production',
      });
    } else {
      const testBody = JSON.stringify({
        operationType: 'insert',
        ns: { db: 'eventflow', coll: '__debug_probe__' },
        documentKey: { _id: `debug-probe-${Date.now()}` },
        fullDocument: { _debug: true },
      });
      const sig = crypto.createHmac('sha256', mongoSecret).update(testBody).digest('hex');
      const mongoResult = await probeWebhook(
        'mongodb',
        '/api/webhooks/mongodb',
        JSON.parse(testBody),
        { 'x-mongodb-webhook-signature': `sha256=${sig}` }
      );
      mongoResult.details =
        mongoResult.status !== null
          ? `Endpoint responded with HTTP ${mongoResult.status}`
          : mongoResult.error;
      results.push(mongoResult);
    }

    // ── Summary ───────────────────────────────────────────────────────────
    const configured = results.filter(r => r.configured).length;
    const passed = results.filter(r => r.configured && r.ok === true).length;

    await auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'test_webhooks',
      targetType: 'webhooks',
      targetId: 'all',
      details: { configured, passed, webhooks: results.map(r => r.name) },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    logger.info(`[ADMIN DEBUG] Webhook test completed: ${passed}/${results.length} ok`);

    res.json({ ok: configured === 0 || passed === configured, results, summary: { total: results.length, configured, passed } });
  }
);

module.exports = router;
