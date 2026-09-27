/**
 * Public Announcements Route
 * Serves the site-wide announcement banner content that admin-content.html's
 * "Announcements" tab manages. No auth — this is meant to be readable by any
 * visitor so the banner can render on every public page.
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const dbUnified = require('../db-unified');
const { apiLimiter } = require('../middleware/rateLimits');

const router = express.Router();

/**
 * GET /api/v1/announcements
 * List active announcements, newest first. Only fields the banner needs are
 * returned — no createdBy/updatedBy, which are admin-internal.
 */
router.get('/announcements', apiLimiter, async (req, res) => {
  try {
    const content = (await dbUnified.read('content')) || {};
    const announcements = (content.announcements || [])
      .filter(a => a.active)
      .map(a => ({
        id: a.id,
        message: a.message,
        type: a.type || 'info',
        createdAt: a.createdAt,
      }))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json({ announcements });
  } catch (error) {
    logger.error('Error loading public announcements:', error);
    res.status(500).json({ error: 'Failed to load announcements' });
  }
});

module.exports = router;
