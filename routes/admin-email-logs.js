'use strict';

const express = require('express');
const { authRequired, roleRequired } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimits');
const emailLogService = require('../services/emailLog.service');

const router = express.Router();

router.get('/', apiLimiter, authRequired, roleRequired('admin'), async (req, res) => {
  const result = await emailLogService.listLogs(req.query || {});
  res.json({ ok: true, ...result });
});

router.get('/:id', apiLimiter, authRequired, roleRequired('admin'), async (req, res) => {
  const item = await emailLogService.getLog(req.params.id);
  if (!item) {
    return res.status(404).json({ ok: false, error: 'Email log not found.' });
  }
  return res.json({ ok: true, item });
});

module.exports = router;
