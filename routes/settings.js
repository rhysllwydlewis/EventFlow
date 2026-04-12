/**
 * User Settings Routes
 * Handles user notification preferences and settings
 */

'use strict';

const express = require('express');
const { authRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/me/settings
 * Get user notification settings including email preferences
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const users = await dbUnified.read('users');
    const i = users.findIndex(u => u.id === req.user.id);
    if (i < 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const user = users[i];
    // Default ON when field is absent (backward compatible)
    const actionPrompts = user.emailPrefs?.actionPrompts || {};
    res.json({
      notify: user.notify !== false,
      emailPrefs: {
        actionPrompts: {
          enabled: actionPrompts.enabled !== false,
          missingPackages: actionPrompts.missingPackages !== false,
          incompleteProfile: actionPrompts.incompleteProfile !== false,
          missingPhotos: actionPrompts.missingPhotos !== false,
        },
      },
    });
  } catch (error) {
    logger.error('Error fetching user settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * POST /api/me/settings
 * Update user notification settings including email preferences
 */
router.post('/', writeLimiter, authRequired, csrfProtection, async (req, res) => {
  try {
    const body = req.body || {};
    const notify = !!body.notify;

    const updateFields = { notify };

    // Update emailPrefs.actionPrompts if provided
    if (body.emailPrefs && typeof body.emailPrefs.actionPrompts === 'object') {
      const ap = body.emailPrefs.actionPrompts;
      if (ap.enabled !== undefined && typeof ap.enabled !== 'boolean') {
        return res
          .status(400)
          .json({ error: 'emailPrefs.actionPrompts.enabled must be a boolean' });
      }
      if (ap.missingPackages !== undefined && typeof ap.missingPackages !== 'boolean') {
        return res
          .status(400)
          .json({ error: 'emailPrefs.actionPrompts.missingPackages must be a boolean' });
      }
      if (ap.incompleteProfile !== undefined && typeof ap.incompleteProfile !== 'boolean') {
        return res
          .status(400)
          .json({ error: 'emailPrefs.actionPrompts.incompleteProfile must be a boolean' });
      }
      if (ap.missingPhotos !== undefined && typeof ap.missingPhotos !== 'boolean') {
        return res
          .status(400)
          .json({ error: 'emailPrefs.actionPrompts.missingPhotos must be a boolean' });
      }
      if (ap.enabled !== undefined) {
        updateFields['emailPrefs.actionPrompts.enabled'] = ap.enabled;
      }
      if (ap.missingPackages !== undefined) {
        updateFields['emailPrefs.actionPrompts.missingPackages'] = ap.missingPackages;
      }
      if (ap.incompleteProfile !== undefined) {
        updateFields['emailPrefs.actionPrompts.incompleteProfile'] = ap.incompleteProfile;
      }
      if (ap.missingPhotos !== undefined) {
        updateFields['emailPrefs.actionPrompts.missingPhotos'] = ap.missingPhotos;
      }
    }

    const updated = await dbUnified.updateOne('users', { id: req.user.id }, { $set: updateFields });
    if (!updated) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ ok: true, notify });
  } catch (error) {
    logger.error('Error updating user settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
