/**
 * Admin Debug Status Route
 * Reports whether the emergency admin-debug routes are currently mounted.
 * This endpoint is ALWAYS available (not gated) so the UI can decide what to show.
 *
 * GET /api/admin/debug/status
 */

'use strict';

const express = require('express');
const { authRequired, roleRequired } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimits');

const router = express.Router();

// Populated at startup by routes/index.js when debug routes are mounted.
let _debugRoutesEnabled = false;
let _disabledReason = '';

/**
 * Called by routes/index.js to record whether the debug tools are live.
 * @param {boolean} enabled
 * @param {string} reason - human-readable reason if disabled
 */
function setDebugRoutesStatus(enabled, reason) {
  _debugRoutesEnabled = !!enabled;
  _disabledReason = String(reason || '');
}

/**
 * GET /api/admin/debug/status
 * Returns whether the emergency debug routes are enabled and why.
 * Auth required (admin only) — the status itself is not secret, but we
 * don't want unauthenticated callers probing which debug capabilities exist.
 */
router.get('/status', apiLimiter, authRequired, roleRequired('admin'), (req, res) => {
  const environment = process.env.NODE_ENV || 'development';
  res.json({
    enabled: _debugRoutesEnabled,
    environment,
    disabledReason: _debugRoutesEnabled ? null : _disabledReason,
    enableInstructions: _debugRoutesEnabled
      ? null
      : 'Set ENABLE_ADMIN_DEBUG_ROUTES=true in a non-production environment to enable emergency account tools.',
  });
});

module.exports = router;
module.exports.setDebugRoutesStatus = setDebugRoutesStatus;
