'use strict';

const express = require('express');
const validator = require('validator');
const { csrfProtection } = require('../middleware/csrf');
const { registrationLimiter } = require('../middleware/rateLimits');
const logger = require('../utils/logger');
const { notifyAdmins } = require('../services/notifyAdmins.service');
const riskService = require('../services/partnerRegistrationRiskService');

const router = express.Router();

router.post('/abuse-appeals', registrationLimiter, csrfProtection, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const name = String(req.body?.name || '').trim();
    const message = String(req.body?.message || '').trim();
    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (message.length < 20) {
      return res.status(400).json({ error: 'Please provide at least 20 characters of context.' });
    }
    const appeal = await riskService.createAppeal({ email, name, message });
    notifyAdmins({
      type: 'system',
      title: 'Partner anti-abuse appeal received',
      message: `A registration appeal was submitted (${appeal.id}).`,
      actionUrl: '/admin-partners',
      actionText: 'Review appeal',
      priority: 'high',
      metadata: { appealId: appeal.id },
    }).catch(() => {});
    return res.status(201).json({
      ok: true,
      appealId: appeal.id,
      message: 'Your appeal has been recorded for review.',
    });
  } catch (error) {
    logger.error('[PARTNER-ABUSE-APPEAL] Failed to create appeal', { error: error.message });
    return res.status(500).json({ error: 'Unable to submit appeal. Please try again later.' });
  }
});

module.exports = router;
