/**
 * Admin System-Checks Routes
 * Exposes the system-check results to authenticated admin users.
 *
 * GET  /api/admin/system-checks          - latest runs (up to ?limit=30)
 * POST /api/admin/system-checks/run      - trigger an immediate run
 */

'use strict';

const express = require('express');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { apiLimiter, writeLimiter } = require('../middleware/rateLimits');
const { runSystemChecks, getRecentRuns } = require('../services/systemCheckService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/admin/system-checks
 * Returns the latest system-check runs.
 * Query params:
 *   limit  (number, 1-100, default 30)
 */
router.get('/system-checks', apiLimiter, authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30;

    const runs = await getRecentRuns(limit);
    return res.json({ runs, count: runs.length });
  } catch (err) {
    logger.error('GET /api/admin/system-checks error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch system-check runs' });
  }
});

/**
 * POST /api/admin/system-checks/run
 * Triggers an immediate system-check run.
 * Returns the run document (or 409 if a run is already in progress).
 */
router.post(
  '/system-checks/run',
  writeLimiter,
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const run = await runSystemChecks();

      if (run === null) {
        return res.status(409).json({ error: 'A system-check run is already in progress' });
      }

      return res.status(201).json({ run });
    } catch (err) {
      logger.error('POST /api/admin/system-checks/run error:', err.message);
      return res.status(500).json({ error: 'Failed to execute system-check run' });
    }
  }
);

module.exports = router;
