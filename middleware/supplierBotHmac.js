'use strict';

const crypto = require('crypto');

const MAX_SKEW_MS = 5 * 60 * 1000;

function signatureFor(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left || '') || !/^[a-f0-9]{64}$/i.test(right || '')) return false;
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifySupplierBotHmac(req, res, next) {
  if (process.env.SUPPLIER_BOT_INGESTION_ENABLED !== 'true') {
    return res.status(503).json({ error: 'Supplier Bot ingestion is disabled' });
  }

  const secret = String(process.env.EVENTFLOW_BOT_HMAC_SECRET || '');
  if (secret.length < 32) {
    return res.status(503).json({ error: 'Supplier Bot ingestion secret is not configured' });
  }

  const timestamp = String(req.get('x-eventflow-bot-timestamp') || '');
  const signatureHeader = String(req.get('x-eventflow-bot-signature') || '');
  const signature = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader;
  const timestampMs = Number(timestamp);

  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_SKEW_MS) {
    return res.status(401).json({ error: 'Supplier Bot request timestamp is invalid or expired' });
  }

  const body = JSON.stringify(req.body || {});
  const expected = signatureFor(secret, timestamp, body);
  if (!safeEqualHex(signature, expected)) {
    return res.status(401).json({ error: 'Invalid Supplier Bot signature' });
  }

  return next();
}

module.exports = {
  MAX_SKEW_MS,
  signatureFor,
  verifySupplierBotHmac,
};
