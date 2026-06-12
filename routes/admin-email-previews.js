'use strict';

const express = require('express');
const validator = require('validator');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const postmark = require('../utils/postmark');
const logger = require('../utils/logger');
const {
  listTemplateDetails,
  getTemplateDetails,
  isKnownTemplate,
  renderPlainTextTemplate,
} = require('../utils/emailTemplateRegistry');

const router = express.Router();

function renderTemplate(name) {
  const detail = getTemplateDetails(name);
  if (!detail) {
    return null;
  }
  const html = postmark.loadEmailTemplate(name, detail.sampleData);
  return {
    ...detail,
    html,
    text: renderPlainTextTemplate(name, detail.sampleData),
  };
}

router.get('/', authRequired, roleRequired('admin'), (req, res) => {
  try {
    const templates = listTemplateDetails().map(template => ({
      ...template,
      html: postmark.loadEmailTemplate(template.name, template.sampleData),
      textPreview: renderPlainTextTemplate(template.name, template.sampleData).slice(0, 800),
    }));
    return res.json({
      ok: true,
      warning: 'Sample data only. No real customer, supplier or subscriber data is used.',
      defaultTestEmail: req.user?.email || '',
      templates,
    });
  } catch (err) {
    logger.error('[admin-email-previews] list error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to load email previews.' });
  }
});

router.get('/:templateName', authRequired, roleRequired('admin'), (req, res) => {
  const { templateName } = req.params;
  if (!isKnownTemplate(templateName)) {
    return res.status(404).json({ ok: false, error: 'Unknown email template.' });
  }
  const rendered = renderTemplate(templateName);
  if (!rendered || !rendered.html) {
    return res.status(500).json({ ok: false, error: 'Failed to render template.' });
  }
  return res.json({ ok: true, template: rendered });
});

router.post(
  '/:templateName/test-send',
  writeLimiter,
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { templateName } = req.params;
    if (!isKnownTemplate(templateName)) {
      return res.status(404).json({ ok: false, error: 'Unknown email template.' });
    }

    const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
    if (!to) {
      return res.status(400).json({ ok: false, error: 'Missing required field: to.' });
    }
    if (/[;,\s]/.test(to.replace(/\s+$/, '')) || !validator.isEmail(to)) {
      return res.status(422).json({ ok: false, error: 'Enter one valid recipient email address.' });
    }

    const detail = getTemplateDetails(templateName);
    try {
      await postmark.sendMail({
        to,
        subject: `[TEST] EventFlow ${detail.purpose}`,
        template: templateName,
        templateData: detail.sampleData,
        text: renderPlainTextTemplate(templateName, detail.sampleData),
        tags: ['email-preview-test', templateName],
        messageStream: 'outbound',
      });
      return res.json({ ok: true, message: `Test email sent to ${to}.` });
    } catch (err) {
      logger.error('[admin-email-previews] test send error:', {
        templateName,
        message: err.message,
      });
      return res
        .status(500)
        .json({ ok: false, error: err.message || 'Failed to send test email.' });
    }
  }
);

module.exports = router;
