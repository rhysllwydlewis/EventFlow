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
 *
 * Integrations are enumerated from the shared catalog:
 *   webhooks/integrations.js
 * Adding a new entry to that module automatically includes it here.
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { auditLog } = require('../middleware/audit');
const { integrations } = require('../webhooks/integrations');

const router = express.Router();

/**
 * Send a synthetic POST to a local webhook endpoint and return a raw result.
 * baseUrl is derived from environment variables only (never from request headers)
 * to prevent SSRF via a forged Host header.
 *
 * @param {string} baseUrl  Origin derived from process.env.BASE_URL or localhost.
 * @param {string} name     Integration slug.
 * @param {string} path     URL path relative to baseUrl.
 * @param {Object} body     JSON payload to send.
 * @param {Object} headers  Additional request headers.
 * @returns {Promise<{name, configured, status, ok, error}>}
 */
async function probeWebhook(baseUrl, name, path, body, headers = {}) {
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

/**
 * POST /test-webhooks
 * Iterates the integrations catalog and probes each webhook endpoint.
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

    try {
      const results = [];

      for (const integration of integrations) {
        const { configured, missing } = integration.isConfigured();

        if (!configured) {
          results.push({
            name: integration.name,
            label: integration.label,
            path: integration.path,
            configured: false,
            ok: null,
            details: `Not configured — missing env var${missing.length !== 1 ? 's' : ''}: ${missing.join(', ')}`,
          });
          continue;
        }

        const probe = integration.buildProbe();
        if (!probe) {
          // buildProbe returned null despite isConfigured() returning true — defensive fallback
          results.push({
            name: integration.name,
            label: integration.label,
            path: integration.path,
            configured: false,
            ok: null,
            details: 'Could not build probe — integration may not be fully configured',
          });
          continue;
        }

        const result = await probeWebhook(
          baseUrl,
          integration.name,
          integration.path,
          probe.body,
          probe.headers
        );

        result.label = integration.label;
        result.path = integration.path;

        if (result.status !== null) {
          result.ok = integration.successCriteria(result.status);
          result.details = `HTTP ${result.status}${probe.notes ? ` — ${probe.notes}` : ''}`;
        } else {
          result.details = result.error || 'Request failed';
        }

        results.push(result);
      }

      // ── Summary ─────────────────────────────────────────────────────────
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

      res.json({
        ok: configured === 0 || passed === configured,
        results,
        summary: { total: results.length, configured, passed },
      });
    } catch (err) {
      logger.error(`[ADMIN DEBUG] Webhook test failed unexpectedly: ${err.message}`);
      res.status(500).json({ error: 'Webhook test failed', message: err.message });
    }
  }
);

module.exports = router;
