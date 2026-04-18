'use strict';

const express = require('express');
const { authRequired } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimits');
const logger = require('../utils/logger');

const router = express.Router();
const MAX_BODY_BYTES = 8 * 1024;

function validateTelemetryPayload(body) {
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
  const counters = body?.counters;
  if (!sessionId || sessionId.length > 128) {
    return 'sessionId must be a non-empty string up to 128 characters';
  }
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) {
    return 'counters must be an object';
  }
  const keys = ['dupSeqDrops', 'cmidReconciles', 'maxGapSize', 'timeToLiveMs'];
  for (const key of keys) {
    const value = counters[key];
    if (!Number.isFinite(Number(value)) || Number(value) < 0) {
      return `${key} must be a non-negative number`;
    }
  }
  return null;
}

router.post('/messenger', apiLimiter, authRequired, express.json({ limit: '8kb' }), (req, res) => {
  const bodyBytes = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
  if (bodyBytes > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Payload too large' });
  }
  const error = validateTelemetryPayload(req.body);
  if (error) {
    return res.status(400).json({ error });
  }
  const { sessionId, counters } = req.body;
  logger.info('metric.messenger.telemetry', {
    userId: req.user?.id || null,
    sessionId,
    counters: {
      dupSeqDrops: Number(counters.dupSeqDrops),
      cmidReconciles: Number(counters.cmidReconciles),
      maxGapSize: Number(counters.maxGapSize),
      timeToLiveMs: Number(counters.timeToLiveMs),
    },
  });
  return res.status(202).json({ ok: true });
});

module.exports = router;
