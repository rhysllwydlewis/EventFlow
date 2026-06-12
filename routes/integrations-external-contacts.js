/**
 * External Contacts Ingestion Route
 *
 * Server-to-server endpoint for VEXI and Chlo to forward contact form
 * submissions into EventFlow. Protected by a shared secret header.
 *
 * POST /api/v1/integrations/external-contacts
 *
 * Security:
 * - X-EventFlow-Integration-Secret header must match EXTERNAL_CONTACTS_INGEST_SECRET env var
 * - X-EventFlow-Source header must be in EXTERNAL_CONTACTS_ALLOWED_SOURCES env var
 * - Source from body is ignored; only the verified header value is trusted
 * - Personal data is stored but not echoed in logs
 * - IP stored only as SHA-256 hash (if known), never raw
 */

'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { notifyAdmins } = require('../services/notifyAdmins.service');
const { writeLimiter } = require('../middleware/rateLimits');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCE_LABELS = { vexi: 'VEXI', chlo: 'Chlo' };
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ── Helpers ─────────────────────────────────────────────────────────────────

function getSecret() {
  return process.env.EXTERNAL_CONTACTS_INGEST_SECRET || '';
}

function getAllowedSources() {
  const raw = process.env.EXTERNAL_CONTACTS_ALLOWED_SOURCES || 'vexi,chlo';
  return new Set(
    raw
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function hashIp(ip) {
  if (!ip || ip === 'unknown') {
    return null;
  }
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

function headerValue(val) {
  if (Array.isArray(val)) {
    return val[0] || '';
  }
  return typeof val === 'string' ? val : '';
}

function sanitiseStr(val, maxLen = 500) {
  if (typeof val !== 'string') {
    return '';
  }
  return val.trim().slice(0, maxLen);
}

function sanitiseLogSource(source) {
  return sanitiseStr(source, 50).replace(/[^a-z0-9_-]/gi, '');
}

function sanitisePageUrl(val) {
  const url = sanitiseStr(val, 500);
  if (!url) {
    return '';
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : '';
  } catch {
    return '';
  }
}

function safeSecretEquals(incomingSecret, expectedSecret) {
  if (!expectedSecret) {
    return false;
  }

  const incomingBuffer = Buffer.from(incomingSecret);
  const expectedBuffer = Buffer.from(expectedSecret);
  return (
    incomingBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(incomingBuffer, expectedBuffer)
  );
}

// ── POST /api/v1/integrations/external-contacts ──────────────────────────────

router.post('/', writeLimiter, async (req, res) => {
  const secret = getSecret();
  const incomingSecret = headerValue(req.headers['x-eventflow-integration-secret']);
  const incomingSource = headerValue(req.headers['x-eventflow-source']).toLowerCase().trim();

  // ─── Secret check ─────────────────────────────────────────────────────────
  // Timing-safe comparison prevents timing attacks on the secret
  const secretValid = safeSecretEquals(incomingSecret, secret);
  if (!secretValid) {
    logger.warn('[ext-contacts] invalid or missing integration secret', {
      source: sanitiseLogSource(incomingSource),
      hasSecret: !!incomingSecret,
    });
    return res.status(401).json({ ok: false, error: 'Unauthorised' });
  }

  // ─── Source check ─────────────────────────────────────────────────────────
  const allowed = getAllowedSources();
  if (!incomingSource || !allowed.has(incomingSource)) {
    logger.warn('[ext-contacts] unknown source', { source: sanitiseLogSource(incomingSource) });
    return res.status(403).json({ ok: false, error: 'Forbidden — unknown source' });
  }

  // ─── Payload validation ───────────────────────────────────────────────────
  const body = req.body || {};
  const name = sanitiseStr(body.name, 200);
  const email = sanitiseStr(body.email, 254);
  const message = sanitiseStr(body.message, 5000);
  const phone = sanitiseStr(body.phone, 30);
  const company = sanitiseStr(body.company, 200);
  const subject = sanitiseStr(body.subject, 300);
  const pageUrl = sanitisePageUrl(body.pageUrl);

  const errors = [];
  if (!name) {
    errors.push('name is required');
  }
  if (!email) {
    errors.push('email is required');
  }
  if (!EMAIL_RE.test(email)) {
    errors.push('email is invalid');
  }
  if (!message) {
    errors.push('message is required');
  }

  if (errors.length) {
    return res.status(400).json({ ok: false, error: errors.join('; ') });
  }

  // ─── Duplicate check ──────────────────────────────────────────────────────
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
  try {
    const existing = await dbUnified.find('external_contacts', {
      source: incomingSource,
      email,
      message,
      receivedAt: { $gte: cutoff },
    });
    if (existing && existing.length > 0) {
      logger.info('[ext-contacts] duplicate suppressed', { source: incomingSource });
      return res.status(200).json({ ok: true, id: existing[0].id, duplicate: true });
    }
  } catch {
    /* non-fatal — proceed to create */
  }

  // ─── Build record ─────────────────────────────────────────────────────────
  const ip = headerValue(req.headers['x-forwarded-for']).split(',')[0].trim() || 'unknown';
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const sourceLabel = SOURCE_LABELS[incomingSource] || incomingSource;

  const record = {
    id,
    source: incomingSource,
    sourceLabel,
    name,
    email,
    phone: phone || null,
    company: company || null,
    subject: subject || null,
    message,
    status: 'new',
    pageUrl: pageUrl || null,
    userAgent: sanitiseStr(req.headers['user-agent'] || '', 300) || null,
    ipHash: hashIp(ip),
    consent: !!body.consent,
    marketingConsent: !!body.marketingConsent,
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    receivedAt: now,
    createdAt: now,
    updatedAt: now,
    readAt: null,
    archivedAt: null,
    repliedAt: null,
    notes: [],
  };

  try {
    await dbUnified.insertOne('external_contacts', record);
  } catch (err) {
    logger.error('[ext-contacts] failed to insert record:', err.message);
    return res.status(500).json({ ok: false, error: 'Storage error' });
  }

  logger.info('[ext-contacts] new record created', {
    id,
    source: incomingSource,
    // Do not log name, email or message
  });

  // ─── Notify admins (fire-and-forget) ──────────────────────────────────────
  notifyAdmins({
    type: 'system', // 'external_contact' not in NOTIFICATION_TYPES; use system + metadata
    title: `New ${sourceLabel} enquiry`,
    message: `${name} submitted a contact request from ${sourceLabel}`,
    actionUrl: `/admin-external-contacts?id=${id}`,
    actionText: 'View enquiry',
    priority: 'normal',
    metadata: { category: 'external_contact', source: incomingSource, externalContactId: id },
  }).catch(() => {});

  return res.status(201).json({ ok: true, id });
});

module.exports = router;
