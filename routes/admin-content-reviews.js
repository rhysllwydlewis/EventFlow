'use strict';

const express = require('express');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const reviewTasks = require('../services/contentReviewTask.service');
const scheduler = require('../services/contentReviewScheduler');

const router = express.Router();
router.use(authRequired, roleRequired('admin'));

router.get('/', async (_req, res) => {
  const [tasks, settings] = await Promise.all([reviewTasks.listTasks(), reviewTasks.getSettings()]);
  res.json({ ok: true, tasks, settings });
});

router.post('/run', writeLimiter, csrfProtection, async (_req, res) => {
  const result = await scheduler.run('manual');
  res.json({ ok: !result.error, ...result });
});

router.put('/settings', writeLimiter, csrfProtection, async (req, res) => {
  const settings = await reviewTasks.updateSettings(req.body || {}, req.user);
  res.json({ ok: true, settings });
});

router.patch('/:id', writeLimiter, csrfProtection, async (req, res) => {
  try {
    const task = await reviewTasks.updateTask(req.params.id, req.body || {}, req.user);
    if (!task) {
      return res.status(404).json({ ok: false, error: 'Review task not found' });
    }
    return res.json({ ok: true, task });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

module.exports = router;
