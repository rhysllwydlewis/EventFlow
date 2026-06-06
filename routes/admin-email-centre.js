'use strict';

const express = require('express');
const auth = require('../middleware/auth');
const limits = require('../middleware/rateLimits');
const emailLogService = require('../services/emailLog.service');
const postmark = require('../utils/postmark');
const { EMAIL_ENABLED } = require('../config/email');

const router = express.Router();

function safeDomain(address) {
  if (!address || typeof address !== 'string' || !address.includes('@')) {
    return process.env.EMAIL_DOMAIN || null;
  }
  return address.split('@').pop() || null;
}

router.get('/summary', limits.apiLimiter, auth.authRequired, auth.roleRequired('admin'), async (_req, res) => {
  const emailSummary = await emailLogService.getSummary();
  const status = postmark.getPostmarkStatus();
  const defaultFrom = status.from || null;
  res.json({
    ok: true,
    summary: emailSummary.summary,
    health: {
      emailEnabled: EMAIL_ENABLED,
      postmarkConfigured: Boolean(status.apiKeyConfigured),
      provider: !EMAIL_ENABLED ? 'disabled' : status.enabled ? 'postmark' : 'outbox',
      defaultFrom,
      emailDomain: process.env.EMAIL_DOMAIN || safeDomain(defaultFrom),
      campaignMessageStream: process.env.CAMPAIGN_MESSAGE_STREAM || 'outbound',
      lastWebhookAt: emailSummary.lastWebhookAt,
    },
  });
});

module.exports = router;
