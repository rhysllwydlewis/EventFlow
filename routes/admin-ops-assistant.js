'use strict';

const express = require('express');
const crypto = require('crypto');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');

const router = express.Router();
router.use(authRequired, roleRequired('admin'));

function secretConfigured() {
  return String(process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET || '').length >= 32;
}

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    enabled: process.env.OPS_ASSISTANT_ENABLED === 'true',
    secretConfigured: secretConfigured(),
  });
});

// Generates a new signing secret for the Ops Assistant to authenticate its
// requests with. The secret is returned once and never stored server-side --
// it must be set as the EVENTFLOW_OPS_BOT_HMAC_SECRET environment variable
// for the worker's requests to verify. Generating a new one invalidates the
// old one the moment the environment variable is updated.
router.post('/generate-secret', writeLimiter, csrfProtection, (_req, res) => {
  const secret = crypto.randomBytes(32).toString('hex');
  res.json({
    ok: true,
    secret,
    instructions:
      'Copy this secret now -- it will not be shown again. Set it as the EVENTFLOW_OPS_BOT_HMAC_SECRET environment variable, and set OPS_ASSISTANT_ENABLED=true, then redeploy for it to take effect.',
  });
});

module.exports = router;
