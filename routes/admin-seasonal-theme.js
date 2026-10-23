/**
 * Admin Seasonal Theme — API Routes
 * Read and change how the public navbar's seasonal theme is chosen.
 * Mounted at: /api/v1/admin/settings/seasonal-theme (and /api/admin/settings/seasonal-theme)
 *
 * The rule that turns these settings into "which theme right now" lives in
 * services/seasonalTheme.service.js and is also what the public endpoint uses,
 * so what this screen reports is exactly what visitors get.
 */
'use strict';

const express = require('express');
const router = express.Router();
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const { auditLog } = require('../middleware/audit');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const seasonalTheme = require('../services/seasonalTheme.service');

/** The settings plus everything the admin card needs to describe them. */
function describe(rawSettings, now = new Date()) {
  const settings = seasonalTheme.normalizeSettings(rawSettings);
  const resolved = seasonalTheme.resolveTheme(settings, now);
  return {
    settings,
    resolved: { theme: resolved.theme, source: resolved.source },
    ukDate: resolved.ukDate,
    next: seasonalTheme.nextChange(settings, now),
    occasions: seasonalTheme.upcomingWindows(now),
    chineseNewYearTableEndsIn: seasonalTheme.CHINESE_NEW_YEAR_LAST_YEAR,
  };
}

router.get('/', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    res.set('Cache-Control', 'no-store, private');
    res.json(describe(settings.seasonalTheme));
  } catch (error) {
    logger.error('Error reading seasonal theme settings:', error);
    res.status(500).json({ error: 'Failed to read settings' });
  }
});

// Saves are read-modify-write on the shared settings document, so they take turns.
let writeQueue = Promise.resolve();
const inTurn = task => {
  const run = writeQueue.then(task);
  writeQueue = run.catch(() => undefined);
  return run;
};

router.put(
  '/',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const parsed = seasonalTheme.validateSettingsInput(req.body);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }

      const { before, saved } = await inTurn(async () => {
        const settings = (await dbUnified.read('settings')) || {};
        const previous = seasonalTheme.normalizeSettings(settings.seasonalTheme);

        settings.seasonalTheme = {
          ...parsed.value,
          updatedAt: new Date().toISOString(),
          updatedBy: req.user.email,
        };

        // writeAndVerify reports a failed write by resolving { success: false },
        // so check it: nothing may be audited or reported as saved unless it was.
        const result = await dbUnified.writeAndVerify('settings', settings);
        if (!result || result.success !== true || !result.data || !result.data.seasonalTheme) {
          throw new Error(result?.error || 'The settings write did not complete');
        }
        return { before: previous, saved: result.data.seasonalTheme };
      });

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'SEASONAL_THEME_UPDATED',
        targetType: 'seasonalTheme',
        targetId: null,
        details: { before, after: parsed.value },
      });

      res.set('Cache-Control', 'no-store, private');
      return res.json({ success: true, ...describe(saved) });
    } catch (error) {
      logger.error('Error updating seasonal theme settings:', error);
      return res.status(500).json({ error: 'Failed to update settings' });
    }
  }
);

module.exports = router;
