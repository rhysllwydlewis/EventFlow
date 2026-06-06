'use strict';

const express = require('express');
const emailLogService = require('../services/emailLog.service');
const postmark = require('../utils/postmark');
const { EMAIL_ENABLED } = require('../config/email');

const router = express.Router();

router.get('/summary', async (_req, res) => {
  const emailSummary = await emailLogService.getSummary();
  const status = postmark.getPostmarkStatus();
  res.json({
    ok: true,
    summary: emailSummary.summary,
    health: {
      emailEnabled: EMAIL_ENABLED,
      postmarkConfigured: Boolean(status.apiKeyConfigured),
      provider: status.enabled ? 'postmark' : 'outbox',
      defaultFrom: status.from || null,
      emailDomain: null,
      campaignMessageStream: 'outbound',
      lastWebhookAt: emailSummary.lastWebhookAt,
    },
  });
});

module.exports = router;
