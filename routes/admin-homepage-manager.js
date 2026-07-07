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
  assignPexelsMediaToVersion,
  removePexelsMediaFromVersion,
  updateMediaLibraryForVersion,
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

router.get('/media-library', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    const manager = buildHomepageManager(settings);
    const versions = Object.fromEntries(
      Object.entries(manager.versions).map(([key, version]) => [key, version.settings.mediaLibrary])
    );
    res.json({ success: true, activeVersion: manager.activeVersion, versions });
  } catch (error) {
    logger.error('Error reading homepage media library:', error);
    res.status(500).json({ error: 'Unable to load homepage media library.' });
  }
});

router.get('/media-library/:version', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    const manager = buildHomepageManager(settings);
    const version = manager.versions[req.params.version];
    if (!version) {
      return res.status(400).json({ error: 'Choose a valid homepage version.' });
    }
    res.json({
      success: true,
      version: req.params.version,
      mediaLibrary: version.settings.mediaLibrary,
    });
  } catch (error) {
    logger.error('Error reading homepage media library version:', error);
    res.status(500).json({ error: 'Unable to load homepage media library.' });
  }
});

router.post(
  '/media-library/:version/pexels',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const settings = (await dbUnified.read('settings')) || {};
      const nextSettings = assignPexelsMediaToVersion(
        settings,
        req.params.version,
        req.body,
        req.user
      );
      const result = await dbUnified.writeAndVerify('settings', nextSettings);
      const manager = buildHomepageManager(result.data);
      const mediaLibrary = manager.versions[req.params.version]?.settings.mediaLibrary;
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'HOMEPAGE_MEDIA_ASSIGNED',
        targetType: 'homepage-media',
        targetId: req.params.version,
        details: {
          version: req.params.version,
          target: req.body?.target,
          providerId: req.body?.media?.providerId,
        },
      });
      const versionLabel = String(req.params.version).toUpperCase();
      const mediaType = req.body?.media?.type === 'video' ? 'Video' : 'Photo';
      const targetLabel =
        req.body?.target === 'hero'
          ? 'hero'
          : req.body?.target === 'general'
            ? 'general homepage media'
            : 'collage';
      const modeAfterAssign = req.body?.modeAfterAssign || 'unchanged';
      const modeMessage =
        modeAfterAssign === 'selected_with_fallback'
          ? `${versionLabel} is now set to use selected media with automatic fallback.`
          : modeAfterAssign === 'selected_pexels'
            ? `${versionLabel} is now set to use selected Pexels media only.`
            : `${versionLabel} media source was not changed.`;
      const liveMessage =
        manager.activeVersion === req.params.version
          ? `${versionLabel} is currently live.`
          : `${versionLabel} is not currently live. Preview ${versionLabel} or publish it to use this on the live homepage.`;
      res.json({
        success: true,
        version: req.params.version,
        activeVersion: manager.activeVersion,
        mediaLibrary,
        modeAfterAssign,
        modeChanged: modeAfterAssign !== 'unchanged',
        message: `${mediaType} assigned to ${versionLabel} ${targetLabel}. ${modeMessage} ${liveMessage}`,
      });
    } catch (error) {
      logger.error('Error assigning homepage media:', error);
      res.status(400).json({ error: error.message || 'Could not assign media. Please try again.' });
    }
  }
);

router.delete(
  '/media-library/:version/pexels/:mediaId',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const settings = (await dbUnified.read('settings')) || {};
      const nextSettings = removePexelsMediaFromVersion(
        settings,
        req.params.version,
        req.params.mediaId,
        req.user
      );
      const result = await dbUnified.writeAndVerify('settings', nextSettings);
      const manager = buildHomepageManager(result.data);
      res.json({
        success: true,
        version: req.params.version,
        mediaLibrary: manager.versions[req.params.version].settings.mediaLibrary,
      });
    } catch (error) {
      logger.error('Error removing homepage media:', error);
      res.status(400).json({ error: error.message || 'Could not remove selected media.' });
    }
  }
);

router.patch(
  '/media-library/:version',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const settings = (await dbUnified.read('settings')) || {};
      const nextSettings = updateMediaLibraryForVersion(
        settings,
        req.params.version,
        req.body || {},
        req.user
      );
      const result = await dbUnified.writeAndVerify('settings', nextSettings);
      const manager = buildHomepageManager(result.data);
      res.json({
        success: true,
        version: req.params.version,
        mediaLibrary: manager.versions[req.params.version].settings.mediaLibrary,
      });
    } catch (error) {
      logger.error('Error updating homepage media library:', error);
      res.status(400).json({ error: error.message || 'Could not update homepage media settings.' });
    }
  }
);

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
