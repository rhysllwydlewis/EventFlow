'use strict';

const express = require('express');
const { authRequired, roleRequired } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimits');
const emailLogService = require('../services/emailLog.service');
const { EMAIL_ENABLED } = require('../config/email');
const postmark = require('../utils/postmark');

const router = express.Router();

function safeDomain(address) {
  if (!address || typeof address !== 'string' || !address.includes('@')) {
    return process.env.EMAIL_DOMAIN || null;
  }
  return address.split('@').pop() || null;
}

router.get('/summary', apiLimiter, authRequired, roleRequired('admin'), async (_req, res) => {
  const { summary, lastWebhookAt } = await emailLogService.getSummary();
  const postmarkStatus = postmark.getPostmarkStatus();
  const defaultFrom = postmarkStatus.from || null;
  res.json({
    ok: true,
    summary,
    health: {
      emailEnabled: EMAIL_ENABLED,
      postmarkConfigured: !!postmarkStatus.apiKeyConfigured,
      provider: !EMAIL_ENABLED ? 'disabled' : postmarkStatus.enabled ? 'postmark' : 'outbox',
      defaultFrom,
      emailDomain: process.env.EMAIL_DOMAIN || safeDomain(defaultFrom),
      campaignMessageStream: process.env.CAMPAIGN_MESSAGE_STREAM || 'outbound',
      lastWebhookAt,
    },
  });
});

module.exports = router;
