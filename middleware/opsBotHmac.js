'use strict';

const crypto = require('crypto');

const MAX_SKEW_MS = 5 * 60 * 1000;

// Binds the signature to the method and path (not just the timestamp and body)
// so a captured signed request can't be replayed against a different route or
// a different resource id within the skew window.
function signatureFor(secret, timestamp, method, path, body) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${method}.${path}.${body}`)
    .digest('hex');
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left || '') || !/^[a-f0-9]{64}$/i.test(right || '')) {
    return false;
  }
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return (
    leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function verifyOpsBotHmac(req, res, next) {
  if (process.env.OPS_ASSISTANT_ENABLED !== 'true') {
    return res.status(503).json({ error: 'Ops Assistant is disabled' });
  }

  const secret = String(process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET || '');
  if (secret.length < 32) {
    return res.status(503).json({ error: 'Ops Assistant secret is not configured' });
  }

  const timestamp = String(req.get('x-eventflow-bot-timestamp') || '');
  const signatureHeader = String(req.get('x-eventflow-bot-signature') || '');
  const signature = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader;
  const timestampMs = Number(timestamp);

  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_SKEW_MS) {
    return res.status(401).json({ error: 'Ops Assistant request timestamp is invalid or expired' });
  }

  const body = JSON.stringify(req.body || {});
  const expected = signatureFor(secret, timestamp, req.method, req.originalUrl, body);
  if (!safeEqualHex(signature, expected)) {
    return res.status(401).json({ error: 'Invalid Ops Assistant signature' });
  }

  return next();
}

module.exports = {
  MAX_SKEW_MS,
  signatureFor,
  verifyOpsBotHmac,
};
