'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { authRequired, roleRequired } = require('../middleware/auth');
const { getPexelsService } = require('../utils/pexels-service');
const { buildAdminManagementOverview } = require('../utils/admin-management-overview');

const router = express.Router();
const collageUploadDir = path.join(__dirname, '../public/uploads/homepage-collage');

function listCollageMedia() {
  try {
    if (!fs.existsSync(collageUploadDir)) {
      return [];
    }

    const mediaExtensions = new Set([
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
      '.gif',
      '.mp4',
      '.webm',
      '.mov',
    ]);
    const videoExtensions = new Set(['.mp4', '.webm', '.mov']);

    return fs
      .readdirSync(collageUploadDir)
      .filter(file => mediaExtensions.has(path.extname(file).toLowerCase()))
      .map(file => {
        const filePath = path.join(collageUploadDir, file);
        const stats = fs.statSync(filePath);
        const ext = path.extname(file).toLowerCase();

        return {
          filename: file,
          url: `/uploads/homepage-collage/${file}`,
          type: videoExtensions.has(ext) ? 'video' : 'photo',
          size: stats.size,
          uploadedAt: stats.birthtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  } catch (error) {
    logger.warn('Failed to inspect homepage collage media:', error.message);
    return [];
  }
}

function getPexelsHealth() {
  try {
    const pexels = getPexelsService();
    return {
      status: {
        configured: pexels.isConfigured(),
      },
      metrics: pexels.getMetrics(),
    };
  } catch (error) {
    logger.warn('Failed to inspect Pexels health:', error.message);
    return {
      status: { configured: false },
      metrics: {},
    };
  }
}

router.get('/overview', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    const [settings, content, photos, packages, collageMedia, dbStatus] = await Promise.all([
      dbUnified.read('settings'),
      dbUnified.read('content'),
      dbUnified.read('photos'),
      dbUnified.read('packages'),
      listCollageMedia(),
      dbUnified.getDatabaseStatus(),
    ]);
    const pexelsHealth = getPexelsHealth();

    res.json({
      success: true,
      overview: buildAdminManagementOverview({
        settings,
        content,
        photos,
        packages,
        collageMedia,
        pexelsStatus: pexelsHealth.status,
        pexelsMetrics: pexelsHealth.metrics,
        dbStatus,
      }),
    });
  } catch (error) {
    logger.error('Failed to build admin management overview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to build admin management overview',
    });
  }
});

module.exports = router;
