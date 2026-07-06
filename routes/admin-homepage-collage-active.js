'use strict';

const express = require('express');

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { auditLog } = require('../middleware/audit');
const { getPexelsService } = require('../utils/pexels-service');
const { buildHomepageManager, getHomepageCollageWidget } = require('../utils/homepage-manager');
const { getRandomFallbackPhotos, getRandomFallbackVideos } = require('../config/pexels-fallback');

const router = express.Router();
const VALID_CATEGORIES = ['venues', 'catering', 'entertainment', 'photography'];

function isCollageDebugEnabled() {
  return process.env.NODE_ENV === 'development' || process.env.DEBUG_COLLAGE === 'true';
}

function syncActiveHomepageWidget(settings, widget, user = {}) {
  const updatedAt = new Date().toISOString();
  const manager = buildHomepageManager(settings);
  const activeVersion = manager.activeVersion;
  const activeSlot = manager.versions[activeVersion];

  settings.collageWidget = {
    ...(settings.collageWidget || {}),
    ...widget,
    updatedAt,
    updatedBy: user.email || null,
    enabledExplicit: widget.enabled !== undefined ? true : settings.collageWidget?.enabledExplicit,
  };

  activeSlot.settings.collageWidget = {
    ...(activeSlot.settings.collageWidget || {}),
    ...settings.collageWidget,
  };
  activeSlot.status = 'published';
  activeSlot.updatedAt = updatedAt;
  activeSlot.updatedBy = user.email || null;
  manager.updatedAt = updatedAt;
  manager.updatedBy = user.email || null;
  settings.homepageManager = manager;

  return settings;
}

function validateWidgetPayload(payload = {}) {
  const { enabled, source, intervalSeconds, transition, preloading, videoQuality, uploadGallery } =
    payload;

  if (enabled !== undefined && typeof enabled !== 'boolean') {
    return 'enabled must be a boolean';
  }

  if (source && !['pexels', 'uploads'].includes(source)) {
    return 'source must be "pexels" or "uploads"';
  }

  if (intervalSeconds !== undefined) {
    const interval = Number(intervalSeconds);
    if (Number.isNaN(interval) || interval < 1 || interval > 60) {
      return 'intervalSeconds must be between 1 and 60';
    }
  }

  if (transition?.effect && !['fade', 'slide', 'zoom', 'crossfade'].includes(transition.effect)) {
    return 'Invalid transition effect';
  }

  if (preloading?.count !== undefined) {
    const count = Number(preloading.count);
    if (Number.isNaN(count) || count < 0 || count > 5) {
      return 'Preloading count must be between 0 and 5';
    }
  }

  if (videoQuality?.preference && !['hd', 'sd', 'auto'].includes(videoQuality.preference)) {
    return 'Invalid video quality preference';
  }

  if (uploadGallery !== undefined) {
    if (!Array.isArray(uploadGallery)) {
      return 'uploadGallery must be an array';
    }
    if (uploadGallery.some(item => typeof item !== 'string' || !item.trim())) {
      return 'All uploadGallery items must be non-empty strings';
    }
  }

  if (
    payload.enabled &&
    payload.source === 'uploads' &&
    payload.fallbackToPexels === false &&
    (!uploadGallery || uploadGallery.length === 0)
  ) {
    return 'Upload gallery cannot be empty when source is "uploads", widget is enabled, and Pexels fallback is off';
  }

  return null;
}

function canUsePexels(widget = {}) {
  const source = widget.source || 'pexels';
  return source === 'pexels' || (source === 'uploads' && widget.fallbackToPexels !== false);
}

function transformPhoto(photo, fallbackAlt) {
  return {
    id: photo.id,
    url: photo.url,
    photographer: photo.photographer || 'Pexels',
    photographer_url: photo.photographer_url || photo.photographerUrl || 'https://www.pexels.com',
    src: {
      original: photo.src?.original || '',
      large: photo.src?.large || photo.src?.large2x || photo.src?.original || '',
      medium: photo.src?.medium || photo.src?.large || '',
      small: photo.src?.small || photo.src?.medium || '',
    },
    alt: photo.alt || fallbackAlt,
  };
}

function transformVideo(video) {
  const videoFiles = video.videoFiles || video.video_files || [];
  const bestFile =
    videoFiles.find(file => file.quality === 'hd') ||
    videoFiles.find(file => file.quality === 'sd') ||
    videoFiles[0];

  if (!bestFile?.link) {
    return null;
  }

  return {
    type: 'video',
    id: video.id,
    url: video.url,
    src: {
      large: bestFile.link,
      original: bestFile.link,
    },
    thumbnail: video.image,
    image: video.image,
    videographer: video.user?.name || 'Pexels',
    videographer_url: video.user?.url || 'https://www.pexels.com',
    duration: video.duration,
    width: video.width || bestFile.width,
    height: video.height || bestFile.height,
    video_files: videoFiles.map(file => ({
      id: file.id,
      quality: file.quality,
      file_type: file.fileType || file.file_type,
      width: file.width,
      height: file.height,
      link: file.link,
    })),
  };
}

async function loadActiveWidget(res) {
  const settings = (await dbUnified.read('settings')) || {};
  const widget = getHomepageCollageWidget(settings);

  if (!widget.enabled) {
    res.status(404).json({
      error: 'Homepage collage widget is not enabled',
      errorType: 'feature_disabled',
    });
    return null;
  }

  if (!canUsePexels(widget)) {
    res.status(400).json({
      error: 'Pexels fallback is disabled for uploaded homepage media',
      errorType: 'invalid_source',
      message: 'Configure collage widget to use Pexels source or enable Pexels fallback.',
    });
    return null;
  }

  return { settings, widget };
}

router.get('/homepage/collage-widget', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    res.json(getHomepageCollageWidget(settings));
  } catch (error) {
    logger.error('Error reading active homepage collage widget:', error);
    res.status(500).json({ error: 'Failed to read collage widget configuration' });
  }
});

router.put(
  '/homepage/collage-widget',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const validationError = validateWidgetPayload(req.body || {});
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const settings = (await dbUnified.read('settings')) || {};
      const currentWidget = getHomepageCollageWidget(settings);
      const nextWidget = {
        ...currentWidget,
        ...req.body,
        heroVideo: { ...(currentWidget.heroVideo || {}), ...(req.body.heroVideo || {}) },
        videoQuality: { ...(currentWidget.videoQuality || {}), ...(req.body.videoQuality || {}) },
        transition: { ...(currentWidget.transition || {}), ...(req.body.transition || {}) },
        preloading: { ...(currentWidget.preloading || {}), ...(req.body.preloading || {}) },
        mobileOptimizations: {
          ...(currentWidget.mobileOptimizations || {}),
          ...(req.body.mobileOptimizations || {}),
        },
        contentFiltering: {
          ...(currentWidget.contentFiltering || {}),
          ...(req.body.contentFiltering || {}),
        },
        playbackControls: {
          ...(currentWidget.playbackControls || {}),
          ...(req.body.playbackControls || {}),
        },
      };

      const result = await dbUnified.writeAndVerify(
        'settings',
        syncActiveHomepageWidget(settings, nextWidget, req.user)
      );

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'COLLAGE_WIDGET_UPDATED',
        targetType: 'homepage',
        targetId: 'active-homepage-collage-widget',
        details: {
          activeVersion: result.data.homepageManager?.activeVersion,
          enabled: nextWidget.enabled,
          source: nextWidget.source,
          mediaTypes: nextWidget.mediaTypes,
        },
      });

      res.json({
        success: true,
        collageWidget: getHomepageCollageWidget(result.data),
      });
    } catch (error) {
      logger.error('Error updating active homepage collage widget:', error);
      res.status(500).json({ error: 'Failed to update collage widget configuration' });
    }
  }
);

router.get('/public/pexels-collage', async (req, res) => {
  try {
    const active = await loadActiveWidget(res);
    if (!active) {
      return;
    }

    const { widget } = active;
    const { category, photos = 'true', videos = 'true' } = req.query;

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
        errorType: 'validation',
        validCategories: VALID_CATEGORIES,
      });
    }

    const shouldFetchPhotos = photos === 'true' && widget.mediaTypes?.photos !== false;
    const shouldFetchVideos = videos === 'true' && widget.mediaTypes?.videos !== false;
    const pexels = getPexelsService();
    const pexelsQueries = widget.pexelsQueries || {};
    const pexelsVideoQueries = widget.pexelsVideoQueries || {};
    let photoItems = [];
    let videoItems = [];
    let usingFallback = false;

    if (pexels.isConfigured()) {
      try {
        const requests = [];
        if (shouldFetchPhotos) {
          requests.push(
            pexels.searchPhotos(pexelsQueries[category] || category, 4, 1).then(results => {
              photoItems = (results.photos || []).map(photo => transformPhoto(photo, category));
            })
          );
        }
        if (shouldFetchVideos) {
          requests.push(
            pexels.searchVideos(pexelsVideoQueries[category] || category, 4, 1).then(results => {
              videoItems = (results.videos || []).map(transformVideo).filter(Boolean);
            })
          );
        }
        await Promise.all(requests);
      } catch (error) {
        usingFallback = true;
        logger.warn(`Pexels collage request failed for ${category}:`, error.message);
      }
    } else {
      usingFallback = true;
    }

    if (usingFallback) {
      if (shouldFetchPhotos) {
        photoItems = getRandomFallbackPhotos(4).map(photo => transformPhoto(photo, category));
      }
      if (shouldFetchVideos) {
        videoItems = getRandomFallbackVideos(4).map(transformVideo).filter(Boolean);
      }
    }

    if (isCollageDebugEnabled()) {
      logger.info('[Active Homepage Collage] Returning media:', {
        category,
        photos: photoItems.length,
        videos: videoItems.length,
        usingFallback,
      });
    }

    res.json({
      success: true,
      category,
      photos: photoItems,
      videos: videoItems,
      usingFallback,
      source: usingFallback ? 'fallback' : 'search',
    });
  } catch (error) {
    logger.error('Error fetching active homepage collage media:', error);
    res.status(500).json({
      error: 'Failed to fetch Pexels images',
      message: error.message,
      errorType: error.type || 'unknown',
    });
  }
});

router.get('/public/pexels-video', async (req, res) => {
  try {
    const active = await loadActiveWidget(res);
    if (!active) {
      return;
    }

    const { widget } = active;
    const query = String(req.query.query || '').trim();

    if (!query) {
      return res.status(400).json({
        error: 'Query parameter required',
        errorType: 'validation',
      });
    }

    if (widget.mediaTypes?.videos === false) {
      return res.status(400).json({
        error: 'Videos are not enabled in collage widget settings',
        errorType: 'videos_disabled',
      });
    }

    const pexels = getPexelsService();
    let videos = [];
    let usingFallback = false;

    if (pexels.isConfigured()) {
      try {
        const results = await pexels.searchVideos(query, 5, 1);
        videos = (results.videos || []).map(transformVideo).filter(Boolean);
      } catch (error) {
        usingFallback = true;
        logger.warn(`Pexels hero video request failed for ${query}:`, error.message);
      }
    } else {
      usingFallback = true;
    }

    if (usingFallback) {
      videos = getRandomFallbackVideos(5).map(transformVideo).filter(Boolean);
    }

    res.json({
      success: true,
      videos,
      usingFallback,
      source: usingFallback ? 'fallback' : 'search',
    });
  } catch (error) {
    logger.error('Error fetching active homepage Pexels video:', error);
    res.status(500).json({
      error: 'Failed to fetch Pexels videos',
      message: error.message,
      errorType: error.type || 'unknown',
    });
  }
});

module.exports = router;
