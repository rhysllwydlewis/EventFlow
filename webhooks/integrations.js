/**
 * Webhook Integrations Catalog
 *
 * Single source of truth for all webhook integrations used by EventFlow.
 * The admin debug webhook-test endpoint iterates this catalog to probe every
 * integration, so adding a new webhook here automatically makes it appear in
 * the Admin → Debug → Webhooks tab.
 *
 * Each entry must implement:
 *   name            {string}   Unique slug (used in audit logs and API output).
 *   label           {string}   Human-readable display name.
 *   path            {string}   URL path relative to baseUrl for the probe POST.
 *   isConfigured()  {fn}       Returns { configured: boolean, missing: string[] }.
 *   buildProbe()    {fn}       Returns { body, headers, notes } or null when not configured.
 *   successCriteria {fn}       fn(status: number) → boolean — which HTTP statuses count as ok.
 */

'use strict';

const crypto = require('crypto');

const integrations = [
  // ── Stripe (canonical) ───────────────────────────────────────────────────
  {
    name: 'stripe',
    label: 'Stripe',
    path: '/api/v2/webhooks/stripe',
    isConfigured() {
      const missing = [];
      if (!process.env.STRIPE_WEBHOOK_SECRET) {
        missing.push('STRIPE_WEBHOOK_SECRET');
      }
      return { configured: missing.length === 0, missing };
    },
    buildProbe() {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        return null;
      }
      const timestamp = Math.floor(Date.now() / 1000);
      const testBody = JSON.stringify({ type: 'ping', data: { object: {} } });
      const signedPayload = `${timestamp}.${testBody}`;
      const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
      return {
        body: JSON.parse(testBody),
        headers: {
          'stripe-signature': `t=${timestamp},v1=${sig}`,
          'content-type': 'application/json',
        },
        notes:
          'HTTP 200 = event accepted; HTTP 400 = signature accepted, event type unknown — both count as ok',
      };
    },
    successCriteria(status) {
      // 400 is expected for the 'ping' event type — signature verification still passed
      return status === 200 || status === 400;
    },
  },

  // ── Stripe legacy deprecated endpoint ────────────────────────────────────
  {
    name: 'stripe-legacy',
    label: 'Stripe (deprecated /api/v1/payments/webhook)',
    path: '/api/v1/payments/webhook',
    isConfigured() {
      const missing = [];
      if (!process.env.STRIPE_WEBHOOK_SECRET) {
        missing.push('STRIPE_WEBHOOK_SECRET');
      }
      return { configured: missing.length === 0, missing };
    },
    buildProbe() {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        return null;
      }
      const timestamp = Math.floor(Date.now() / 1000);
      const testBody = JSON.stringify({ type: 'ping', data: { object: {} } });
      const signedPayload = `${timestamp}.${testBody}`;
      const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
      return {
        body: JSON.parse(testBody),
        headers: {
          'stripe-signature': `t=${timestamp},v1=${sig}`,
          'content-type': 'application/json',
        },
        notes: 'Deprecated — migrate Stripe dashboard to POST /api/v2/webhooks/stripe',
      };
    },
    successCriteria(status) {
      return status === 200 || status === 400;
    },
  },

  // ── Postmark ─────────────────────────────────────────────────────────────
  {
    name: 'postmark',
    label: 'Postmark',
    path: '/api/v1/webhooks/postmark',
    isConfigured() {
      const missing = [];
      if (!process.env.POSTMARK_WEBHOOK_USER) {
        missing.push('POSTMARK_WEBHOOK_USER');
      }
      if (!process.env.POSTMARK_WEBHOOK_PASS) {
        missing.push('POSTMARK_WEBHOOK_PASS');
      }
      return { configured: missing.length === 0, missing };
    },
    buildProbe() {
      const user = process.env.POSTMARK_WEBHOOK_USER;
      const pass = process.env.POSTMARK_WEBHOOK_PASS;
      if (!user || !pass) {
        return null;
      }
      const creds = Buffer.from(`${user}:${pass}`).toString('base64');
      return {
        body: {
          RecordType: 'Open',
          MessageID: 'test-debug-probe',
          Recipient: 'debug@test.invalid',
        },
        headers: { Authorization: `Basic ${creds}` },
        notes: 'Synthetic Open event with Basic auth credentials',
      };
    },
    successCriteria(status) {
      return status >= 200 && status < 300;
    },
  },

  // ── MongoDB Atlas ─────────────────────────────────────────────────────────
  {
    name: 'mongodb',
    label: 'MongoDB Atlas',
    path: '/api/v1/webhooks/mongodb',
    isConfigured() {
      const missing = [];
      if (!process.env.MONGODB_WEBHOOK_SECRET) {
        missing.push('MONGODB_WEBHOOK_SECRET');
      }
      return { configured: missing.length === 0, missing };
    },
    buildProbe() {
      const secret = process.env.MONGODB_WEBHOOK_SECRET;
      if (!secret) {
        return null;
      }
      const body = JSON.stringify({
        operationType: 'insert',
        ns: { db: 'eventflow', coll: '__debug_probe__' },
        documentKey: { _id: `debug-probe-${Date.now()}` },
        fullDocument: { _debug: true },
      });
      const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
      return {
        body: JSON.parse(body),
        headers: { 'x-mongodb-webhook-signature': `sha256=${sig}` },
        notes: 'Synthetic insert event with HMAC-SHA256 signature',
      };
    },
    successCriteria(status) {
      return status >= 200 && status < 300;
    },
  },
];

module.exports = { integrations };
