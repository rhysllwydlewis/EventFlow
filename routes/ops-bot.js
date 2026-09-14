'use strict';

const express = require('express');
const { verifyOpsBotHmac } = require('../middleware/opsBotHmac');
const { apiLimiter } = require('../middleware/rateLimits');
const reviewTasks = require('../services/contentReviewTask.service');

const router = express.Router();
router.use(apiLimiter, verifyOpsBotHmac);

const OPS_BOT_ACTOR = { id: 'ops-bot' };

router.get('/content-review-tasks', async (_req, res) => {
  const tasks = await reviewTasks.listTasks();
  res.json({ ok: true, tasks });
});

router.patch('/content-review-tasks/:id', async (req, res) => {
  try {
    const task = await reviewTasks.updateTask(req.params.id, req.body || {}, OPS_BOT_ACTOR);
    if (!task) {
      return res.status(404).json({ ok: false, error: 'Review task not found' });
    }
    return res.json({ ok: true, task });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

module.exports = router;
