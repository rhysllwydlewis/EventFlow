'use strict';

const express = require('express');
const router = express.Router();

router.get('/summary', async (_req, res) => {
  res.json({ ok: true, summary: {}, health: {} });
});

module.exports = router;
