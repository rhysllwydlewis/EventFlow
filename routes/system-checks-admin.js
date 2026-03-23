/**
 * Admin System-Checks Routes
 * Exposes the system-check results to authenticated admin users.
 *
 * GET  /api/admin/health                 - lightweight admin health probe (auth required)
 * GET  /api/admin/system-checks          - latest runs (up to ?limit=30)
 * GET  /api/admin/system-checks/catalog  - full check catalog (no run)
 * POST /api/admin/system-checks/run      - trigger an immediate run
 */

'use strict';

const express = require('express');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { apiLimiter, writeLimiter } = require('../middleware/rateLimits');
const { runSystemChecks, getRecentRuns, getCatalog } = require('../services/systemCheckService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/admin/health
 * Lightweight health probe for the admin layer.
 * Requires a valid admin session — the system-check catalog uses this
 * endpoint (expecting 200 when authed, 401 when not) to confirm the
 * admin auth middleware and routing are functioning correctly.
 */
router.get('/health', apiLimiter, authRequired, roleRequired('admin'), (req, res) => {
  res.json({
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    ts: new Date().toISOString(),
  });
});

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
 * GET /api/admin/system-checks/catalog
 * Returns the static catalog of all check descriptors (paths, groups, descriptions).
 * Does NOT execute any checks.
 */
router.get(
  '/system-checks/catalog',
  apiLimiter,
  authRequired,
  roleRequired('admin'),
  (req, res) => {
    try {
      const catalog = getCatalog();
      return res.json({ catalog, count: catalog.length });
    } catch (err) {
      logger.error('GET /api/admin/system-checks/catalog error:', err.message);
      return res.status(500).json({ error: 'Failed to fetch check catalog' });
    }
  }
);

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
      const triggeredBy = req.user
        ? { id: req.user.id, email: req.user.email, role: req.user.role }
        : null;

      const run = await runSystemChecks({ triggeredBy });

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
