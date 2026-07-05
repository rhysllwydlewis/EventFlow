/**
 * Admin Homepage Manager Routes
 * Dedicated V1/V2/V3 homepage slot management.
 */

'use strict';

const express = require('express');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { auditLog } = require('../middleware/audit');
const {
  buildHomepageManager,
  duplicateHomepageVersion,
  publishHomepageVersion,
  updateHomepageVersion,
  validateHomepageVersionPayload,
} = require('../utils/homepage-manager');

const router = express.Router();

router.get('/', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    res.json({ success: true, manager: buildHomepageManager(settings) });
  } catch (error) {
    logger.error('Error reading homepage manager:', error);
    res.status(500).json({ error: 'Failed to read homepage manager' });
  }
});

router.put(
  '/version/:version',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const validationError = validateHomepageVersionPayload(req.body);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const settings = (await dbUnified.read('settings')) || {};
      const nextSettings = updateHomepageVersion(settings, req.params.version, req.body, req.user);
      const result = await dbUnified.writeAndVerify('settings', nextSettings);
      const manager = buildHomepageManager(result.data);

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'HOMEPAGE_VERSION_UPDATED',
        targetType: 'homepage',
        targetId: req.params.version,
        details: {
          version: req.params.version,
          tabName: req.body.tabName,
          status: req.body.status,
        },
      });

      res.json({ success: true, manager, version: manager.versions[req.params.version] });
    } catch (error) {
      logger.error('Error updating homepage version:', error);
      res.status(400).json({ error: error.message || 'Failed to update homepage version' });
    }
  }
);

router.post(
  '/publish/:version',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const settings = (await dbUnified.read('settings')) || {};
      const nextSettings = publishHomepageVersion(settings, req.params.version, req.user);
      const result = await dbUnified.writeAndVerify('settings', nextSettings);
      const manager = buildHomepageManager(result.data);

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'HOMEPAGE_VERSION_PUBLISHED',
        targetType: 'homepage',
        targetId: req.params.version,
        details: { activeVersion: manager.activeVersion },
      });

      res.json({ success: true, manager });
    } catch (error) {
      logger.error('Error publishing homepage version:', error);
      res.status(400).json({ error: error.message || 'Failed to publish homepage version' });
    }
  }
);

router.post('/duplicate', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
  try {
    const { sourceVersion, targetVersion } = req.body || {};
    const settings = (await dbUnified.read('settings')) || {};
    const nextSettings = duplicateHomepageVersion(settings, sourceVersion, targetVersion, req.user);
    const result = await dbUnified.writeAndVerify('settings', nextSettings);
    const manager = buildHomepageManager(result.data);

    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'HOMEPAGE_VERSION_DUPLICATED',
      targetType: 'homepage',
      targetId: targetVersion,
      details: { sourceVersion, targetVersion },
    });

    res.json({ success: true, manager });
  } catch (error) {
    logger.error('Error duplicating homepage version:', error);
    res.status(400).json({ error: error.message || 'Failed to duplicate homepage version' });
  }
});

module.exports = router;
