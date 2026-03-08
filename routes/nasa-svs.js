'use strict';

/**
 * NASA SVS Routes
 * Exposes the NASA Scientific Visualization Studio Moon 3D model metadata.
 *
 * GET /api/nasa-svs/moon        – Moon model metadata + local GLB availability
 * GET /api/nasa-svs/moon/status – Quick status check (API reachable, local GLB, cache age)
 *
 * Both endpoints are public (no auth required).
 */

const express = require('express');
const logger = require('../utils/logger');
const { apiLimiter } = require('../middleware/rateLimits');
const nasaSvsService = require('../services/nasa-svs.service');

const router = express.Router();

/**
 * Initialize dependencies from server.js.
 * This route calls the NASA SVS service directly and requires no injected
 * dependencies, but the function is exported so server.js can call it
 * uniformly with all other route modules.
 */
function initializeDependencies() {}

// ---------------------------------------------------------------------------
// GET /api/nasa-svs/moon
// Returns Moon model metadata from the NASA SVS API plus local GLB status.
// ---------------------------------------------------------------------------
router.get('/moon', apiLimiter, async (req, res) => {
  try {
    const [metadata, localGlb] = await Promise.all([
      nasaSvsService.fetchMoonMetadata(),
      Promise.resolve(nasaSvsService.getLocalGlbStatus()),
    ]);

    return res.json({
      ok: true,
      metadata,
      localGlb,
    });
  } catch (err) {
    logger.error(`NASA SVS /moon error: ${err.message}`);
    return res.status(500).json({ ok: false, error: 'Failed to retrieve Moon metadata' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/nasa-svs/moon/status
// Returns a quick status check without full metadata fetch.
// ---------------------------------------------------------------------------
router.get('/moon/status', apiLimiter, async (req, res) => {
  try {
    const [apiReachable, localGlb, cacheStatus] = await Promise.all([
      nasaSvsService.checkApiReachable(),
      Promise.resolve(nasaSvsService.getLocalGlbStatus()),
      Promise.resolve(nasaSvsService.getCacheStatus()),
    ]);

    return res.json({
      ok: true,
      apiReachable,
      localGlb,
      cache: cacheStatus,
    });
  } catch (err) {
    logger.error(`NASA SVS /moon/status error: ${err.message}`);
    return res.status(500).json({ ok: false, error: 'Status check failed' });
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
