/**
 * Captcha & ALTCHA Routes
 * Challenge generation and verification for spam prevention.
 *
 * Split out of routes/misc.js (Effort 3.1 — route structure cleanup).
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { createChallenge } = require('altcha-lib');
const router = express.Router();

let writeLimiter;
let verifyAltcha;

function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Captcha routes: dependencies object is required');
  }
  const required = ['writeLimiter', 'verifyAltcha'];
  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Captcha routes: missing required dependencies: ${missing.join(', ')}`);
  }
  writeLimiter = deps.writeLimiter;
  verifyAltcha = deps.verifyAltcha;
}

function applyWriteLimiter(req, res, next) {
  if (!writeLimiter) {
    return res.status(503).json({ error: 'Rate limiter not initialized' });
  }
  return writeLimiter(req, res, next);
}

router.get('/altcha/challenge', applyWriteLimiter, async (req, res) => {
  try {
    if (!process.env.ALTCHA_HMAC_KEY) {
      // In development, return a dummy challenge so the widget can still render
      if (process.env.NODE_ENV !== 'production') {
        const challenge = await createChallenge({ hmacKey: 'dev-only-key', maxNumber: 100000 });
        return res.json(challenge);
      }
      return res.status(503).json({ error: 'ALTCHA not configured' });
    }
    const challenge = await createChallenge({
      hmacKey: process.env.ALTCHA_HMAC_KEY,
      maxNumber: 100000,
    });
    res.json(challenge);
  } catch (error) {
    logger.error('Error generating ALTCHA challenge:', error);
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

router.post('/verify-captcha', applyWriteLimiter, async (req, res) => {
  try {
    const { token } = req.body || {};
    const result = await verifyAltcha(token);

    if (result.success) {
      return res.json(result);
    } else {
      const statusCode = result.error === 'CAPTCHA verification not configured' ? 500 : 400;
      return res.status(statusCode).json(result);
    }
  } catch (error) {
    logger.error('Error verifying captcha:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
