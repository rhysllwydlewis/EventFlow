/**
 * Public Routes
 * Public-facing endpoints that don't require authentication
 * Includes homepage settings, public stats, and other publicly accessible data
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const crypto = require('crypto');
const dbUnified = require('../db-unified');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter, apiLimiter } = require('../middleware/rateLimits');
const { enforceCoreFeatureFlags } = require('../middleware/features');
const { stripPublicSupplierPrivateFields } = require('../utils/supplierPublicProfile');
const {
  buildHomepageManager,
  getHomepageCollageWidget,
  normaliseHomepageVersion,
  resolveHomepageMedia,
} = require('../utils/homepage-manager');

function isCollageDebugEnabled() {
  return process.env.NODE_ENV === 'development' || process.env.DEBUG_COLLAGE === 'true';
}

const ALLOWED_PEXELS_KEYS = ['intervalSeconds', 'queries', 'perPage', 'orientation', 'tags'];

const DEFAULT_PEXELS_SETTINGS = {
  intervalSeconds: 2.5,
  queries: {
    venues: 'wedding venue elegant ballroom',
    catering: 'wedding catering food elegant',
    entertainment: 'live band wedding party',
    photography: 'wedding photography professional',
  },
};

const DEFAULT_PEXELS_VIDEO_QUERIES = {
  venues: 'wedding venue video aerial',
  catering: 'catering food preparation video',
  entertainment: 'live band music performance video',
  photography: 'wedding videography cinematic',
};

const DEFAULT_HERO_VIDEO_SETTINGS = {
  enabled: true,
  autoplay: false,
  muted: true,
  loop: true,
  quality: 'hd',
};

const DEFAULT_VIDEO_QUALITY_SETTINGS = {
  preference: 'hd',
  adaptive: true,
  mobileOptimized: true,
};

const DEFAULT_TRANSITION_SETTINGS = {
  effect: 'fade',
  duration: 1000,
};

const DEFAULT_PRELOADING_SETTINGS = {
  enabled: true,
  count: 3,
};

const DEFAULT_MOBILE_VIDEO_SETTINGS = {
  slowerTransitions: true,
  disableVideos: false,
  touchControls: true,
};

const DEFAULT_CONTENT_FILTERING_SETTINGS = {
  aspectRatio: 'any',
  orientation: 'any',
  minResolution: 'SD',
};

const DEFAULT_PLAYBACK_SETTINGS = {
  showControls: false,
  pauseOnHover: true,
  fullscreen: false,
};

function sanitizePexelsSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    return DEFAULT_PEXELS_SETTINGS;
  }
  const sanitized = {};
  ALLOWED_PEXELS_KEYS.forEach(key => {
    if (settings[key] !== undefined) {
      sanitized[key] = settings[key];
    }
  });
  if (sanitized.intervalSeconds !== undefined) {
    const interval = Number(sanitized.intervalSeconds);
    if (isNaN(interval) || interval < 1 || interval > 60) {
      sanitized.intervalSeconds = DEFAULT_PEXELS_SETTINGS.intervalSeconds;
    } else {
      sanitized.intervalSeconds = interval;
    }
  } else {
    sanitized.intervalSeconds = DEFAULT_PEXELS_SETTINGS.intervalSeconds;
  }
  if (!sanitized.queries || typeof sanitized.queries !== 'object') {
    sanitized.queries = DEFAULT_PEXELS_SETTINGS.queries;
  }
  if (settings.interval && !sanitized.intervalSeconds) {
    const interval = Number(settings.interval);
    if (!isNaN(interval) && interval >= 1 && interval <= 60) {
      sanitized.intervalSeconds = interval;
    }
  }
  return sanitized;
}

function inferHomepageVersionFromReferer(req) {
  const referer = req.get('referer') || req.get('referrer') || '';
  try {
    const pathname = new URL(referer).pathname.toLowerCase();
    if (pathname.includes('home-v3')) {
      return 'v3';
    }
    if (pathname.includes('home-v2')) {
      return 'v2';
    }
  } catch (_) {
    if (/home-v3/i.test(referer)) {
      return 'v3';
    }
    if (/home-v2/i.test(referer)) {
      return 'v2';
    }
  }
  return null;
}

function getRequestedHomepageVersion(req) {
  return normaliseHomepageVersion(req.query.version) || inferHomepageVersionFromReferer(req);
}

function buildPublicCollageWidget(settings = {}, requestedVersion) {
  const features = settings.features || {};
  const manager = buildHomepageManager(settings);
  const homepageVersion = normaliseHomepageVersion(requestedVersion) || manager.activeVersion;
  const versionSettings = manager.versions?.[homepageVersion]?.settings || {};
  const collageWidget = getHomepageCollageWidget(settings, homepageVersion);
  const homepageMedia = resolveHomepageMedia({
    collageWidget,
    mediaLibrary: versionSettings.mediaLibrary || settings.mediaLibrary,
  });
  const legacyPexelsEnabled = features.pexelsCollage === true;
  const collageEnabled =
    collageWidget.enabled !== undefined ? collageWidget.enabled : legacyPexelsEnabled;
  const pexelsCollageSettings = sanitizePexelsSettings(settings.pexelsCollageSettings);

  return {
    homepageVersion,
    activeHomepageVersion: manager.activeVersion,
    collageWidget: {
      enabled: collageEnabled,
      source: homepageMedia.source || collageWidget.source || 'pexels',
      mediaTypes: homepageMedia.mediaTypes ||
        collageWidget.mediaTypes || { photos: true, videos: true },
      intervalSeconds: collageWidget.intervalSeconds || pexelsCollageSettings.intervalSeconds,
      pexelsQueries: collageWidget.pexelsQueries || pexelsCollageSettings.queries,
      pexelsVideoQueries: collageWidget.pexelsVideoQueries || DEFAULT_PEXELS_VIDEO_QUERIES,
      uploadGallery: collageWidget.uploadGallery || [],
      fallbackToPexels:
        homepageMedia.fallback?.enabled === true ||
        (homepageMedia.fallback === null || homepageMedia.fallback === undefined
          ? false
          : homepageMedia.fallback.enabled !== false),
      heroVideo: {
        ...DEFAULT_HERO_VIDEO_SETTINGS,
        ...(collageWidget.heroVideo || {}),
      },
      videoQuality: {
        ...DEFAULT_VIDEO_QUALITY_SETTINGS,
        ...(collageWidget.videoQuality || {}),
      },
      transition: {
        ...DEFAULT_TRANSITION_SETTINGS,
        ...(collageWidget.transition || {}),
      },
      preloading: {
        ...DEFAULT_PRELOADING_SETTINGS,
        ...(collageWidget.preloading || {}),
      },
      mobileOptimizations: {
        ...DEFAULT_MOBILE_VIDEO_SETTINGS,
        ...(collageWidget.mobileOptimizations || {}),
      },
      contentFiltering: {
        ...DEFAULT_CONTENT_FILTERING_SETTINGS,
        ...(collageWidget.contentFiltering || {}),
      },
      playbackControls: {
        ...DEFAULT_PLAYBACK_SETTINGS,
        ...(collageWidget.playbackControls || {}),
      },
      mediaLibrary: homepageMedia.mediaLibrary,
      selectedMedia: homepageMedia.selected,
      heroSelectedMedia: homepageMedia.heroMedia,
      effectiveMediaSource: homepageMedia.source,
    },
    pexelsCollageEnabled: legacyPexelsEnabled,
    pexelsCollageSettings,
  };
}

function transformPexelsVideo(video) {
  const videoFiles = video.videoFiles || video.video_files || [];

  return {
    id: video.id,
    url: video.url,
    image: video.image,
    duration: video.duration,
    user: {
      name: video.user?.name || video.videographer || 'Pexels',
      url: video.user?.url || video.videographer_url || 'https://www.pexels.com',
    },
    video_files: videoFiles
      .filter(file => file?.link)
      .map(file => ({
        id: file.id,
        quality: file.quality,
        file_type: file.fileType || file.file_type || 'video/mp4',
        width: file.width,
        height: file.height,
        link: file.link,
      })),
  };
}

function getFallbackHomepageVideos(count = 8) {
  const { getRandomFallbackVideos } = require('../config/pexels-fallback');
  return getRandomFallbackVideos(count)
    .map(transformPexelsVideo)
    .filter(video => video.video_files.length > 0);
}

router.get('/homepage-settings', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, private');
    const settings = (await dbUnified.read('settings')) || {};
    const publicSettings = buildPublicCollageWidget(settings, getRequestedHomepageVersion(req));
    const collageWidgetResponse = publicSettings.collageWidget;

    if (isCollageDebugEnabled()) {
      logger.info('[Homepage Settings] Returning collage config:', {
        collageEnabled: collageWidgetResponse.enabled,
        source: collageWidgetResponse.source,
        homepageVersion: publicSettings.homepageVersion,
        activeHomepageVersion: publicSettings.activeHomepageVersion,
        hasQueries: !!collageWidgetResponse.pexelsQueries,
        hasVideoQueries: !!collageWidgetResponse.pexelsVideoQueries,
        uploadGalleryCount: collageWidgetResponse.uploadGallery.length,
      });
    }

    res.json(publicSettings);
  } catch (error) {
    if (!res.headersSent) {
      logger.error('[ERROR] Failed to read homepage settings:', error.message);
      res.status(500).json({ error: 'Failed to read homepage settings' });
    }
  }
});

const SIGNUP_POPUP_MODES = ['disabled', 'popup', 'banner'];

router.get('/signup-popup', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, private');
    const settings = (await dbUnified.read('settings')) || {};
    const signupPopup = settings.signupPopup || {};

    // Legacy records only had a boolean `enabled`, which predates the banner
    // mode and maps to the popup presentation.
    let mode = SIGNUP_POPUP_MODES.includes(signupPopup.mode) ? signupPopup.mode : null;
    if (!mode) {
      mode = signupPopup.enabled === true ? 'popup' : 'disabled';
    }

    res.json({
      mode,
      enabled: mode !== 'disabled',
      delaySeconds: Number.isInteger(signupPopup.delaySeconds) ? signupPopup.delaySeconds : 5,
    });
  } catch (error) {
    logger.error('Error reading signup popup settings:', error.message);
    // Fail closed on error so a settings-read failure can't force the popup onto every visitor
    res.status(200).json({ mode: 'disabled', enabled: false, delaySeconds: 5 });
  }
});

router.get('/homepage-video', apiLimiter, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, private');
    const query = String(req.query.query || '').trim();

    if (!query) {
      return res.status(400).json({
        error: 'Query parameter required',
        errorType: 'validation',
      });
    }

    const settings = (await dbUnified.read('settings')) || {};
    const { collageWidget } = buildPublicCollageWidget(settings, getRequestedHomepageVersion(req));
    const source = collageWidget.source || 'pexels';
    const videosEnabled = collageWidget.mediaTypes?.videos !== false;
    const canUsePexels =
      source === 'pexels' ||
      (source === 'uploads' && collageWidget.fallbackToPexels !== false) ||
      (source === 'selected_with_fallback' && collageWidget.fallbackToPexels !== false);

    if (!collageWidget.enabled) {
      return res.status(404).json({
        error: 'Homepage collage widget is not enabled',
        errorType: 'feature_disabled',
      });
    }

    if (!videosEnabled) {
      return res.status(400).json({
        error: 'Videos are not enabled in homepage settings',
        errorType: 'videos_disabled',
      });
    }

    if (!canUsePexels) {
      return res.status(400).json({
        error: 'Pexels fallback is disabled for this homepage media mode',
        errorType: 'pexels_fallback_disabled',
      });
    }

    const { getPexelsService } = require('../utils/pexels-service');
    const pexels = getPexelsService();

    if (pexels.isConfigured()) {
      try {
        const results = await pexels.searchVideos(query, 8, 1);
        const videos = (results.videos || [])
          .map(transformPexelsVideo)
          .filter(video => video.video_files.length > 0);

        if (videos.length > 0) {
          return res.json({
            success: true,
            videos,
            query,
            usingFallback: false,
            source: 'pexels-api',
          });
        }

        logger.warn(`[Homepage Video] No Pexels videos found for query "${query}", using fallback`);
      } catch (apiError) {
        logger.warn(
          `[Homepage Video] Pexels API failed for query "${query}" (${apiError.type || 'unknown'}): ${apiError.message}`
        );
      }
    }

    const fallbackVideos = getFallbackHomepageVideos(8);

    res.json({
      success: true,
      videos: fallbackVideos,
      query,
      usingFallback: true,
      source: 'fallback',
      message: 'Using curated fallback videos from Pexels collection',
    });
  } catch (error) {
    logger.error('[ERROR] Failed to fetch homepage video playlist:', error);
    res.status(500).json({
      error: 'Failed to fetch homepage video playlist',
      message: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      errorType: error.type || 'unknown',
    });
  }
});

let statsCache = null;
let statsCacheTime = 0;
const STATS_CACHE_DURATION = 5 * 60 * 1000;

/**
 * GET /api/v1/public/features
 * Returns the subset of feature flags that are safe to expose publicly.
 * Used by the auth page to pre-check registration availability before submit,
 * and to hide the Supplier role option when supplierApplications is disabled.
 */
router.get('/features', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, private');
    const settings = (await dbUnified.read('settings')) || {};
    const features = enforceCoreFeatureFlags(settings.features || {});
    res.json({
      registration: features.registration !== false,
      supplierApplications: features.supplierApplications !== false,
    });
  } catch (error) {
    logger.error('[ERROR] Failed to read feature flags:', error.message);
    // Default to enabled so a DB hiccup doesn't silently block sign-ups
    res.status(500).json({ registration: true, supplierApplications: true });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const now = Date.now();
    if (statsCache && now - statsCacheTime < STATS_CACHE_DURATION) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.json(statsCache);
    }
    const suppliers = (await dbUnified.read('suppliers')) || [];
    const packages = (await dbUnified.read('packages')) || [];
    const marketplaceListings = (await dbUnified.read('marketplace_listings')) || [];
    const reviews = (await dbUnified.read('reviews')) || [];
    const stats = {
      suppliersVerified: suppliers.filter(s => s.approved === true || s.verified === true).length,
      packagesApproved: packages.filter(p => p.approved === true).length,
      marketplaceListingsActive: marketplaceListings.filter(
        m => m.approved === true && m.status === 'active'
      ).length,
      reviewsApproved: reviews.filter(r => r.approved === true).length,
    };
    statsCache = stats;
    statsCacheTime = now;
    res.set('Cache-Control', 'public, max-age=300');
    res.json(stats);
  } catch (error) {
    logger.error('[ERROR] Failed to read public stats:', error.message);
    res.status(500).json({
      error: 'Failed to read public stats',
      suppliersVerified: 0,
      packagesApproved: 0,
      marketplaceListingsActive: 0,
      reviewsApproved: 0,
    });
  }
});

/**
 * POST /api/public/faq/vote
 * Vote on FAQ helpfulness
 * CSRF protected to prevent unauthorized votes
 * Duplicate votes prevented by session/IP tracking
 */
router.post('/faq/vote', writeLimiter, csrfProtection, async (req, res) => {
  try {
    const { faqId, helpful } = req.body;

    if (!faqId || typeof helpful !== 'boolean') {
      return res.status(400).json({ error: 'Missing or invalid faqId or helpful flag' });
    }

    // Generate visitor ID from session or IP (hashed for privacy)
    // Reject vote if neither session ID nor IP is available to prevent shared anonymous votes
    const visitorIdentifier = req.sessionID || req.ip;
    if (!visitorIdentifier) {
      return res.status(400).json({
        error:
          'Unable to identify visitor. Please enable cookies or check your network connection.',
      });
    }

    const visitorId = crypto
      .createHash('sha256')
      .update(visitorIdentifier + (process.env.JWT_SECRET || 'salt'))
      .digest('hex')
      .substring(0, 16);

    // Read existing votes
    let faqVotes = [];
    try {
      faqVotes = await dbUnified.read('faqVotes');
    } catch (e) {
      // Collection doesn't exist yet, will be created on first vote
      logger.debug('faqVotes collection not yet initialised:', e.message);
    }

    // Check for existing vote from this visitor on this FAQ
    const existingVoteIndex = faqVotes.findIndex(
      v => v.faqId === faqId && v.visitorId === visitorId
    );

    if (existingVoteIndex !== -1) {
      // Update existing vote instead of creating duplicate
      faqVotes[existingVoteIndex].helpful = helpful;
      faqVotes[existingVoteIndex].updatedAt = new Date().toISOString();
      await dbUnified.updateOne(
        'faqVotes',
        { id: faqVotes[existingVoteIndex].id },
        { $set: { helpful, updatedAt: faqVotes[existingVoteIndex].updatedAt } }
      );
      return res.json({ success: true, message: 'Thank you for your feedback!' });
    }

    // Create vote record with visitor tracking
    const { uid } = require('../store');
    const vote = {
      id: uid('faqvote'),
      faqId,
      helpful,
      visitorId,
      createdAt: new Date().toISOString(),
      ipAddress: req.ip || req.headers['x-forwarded-for'] || 'unknown',
    };

    const faqVoteInserted = await dbUnified.insertOne('faqVotes', vote);
    if (!faqVoteInserted) {
      logger.error('[PUBLIC] faqVote insertOne failed');
    }

    res.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (error) {
    logger.error('Error recording FAQ vote:', error);
    res.status(500).json({
      error: 'Failed to record vote',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/public/recommendations
 * Get recommended suppliers based on user preferences
 */
router.get('/recommendations', async (req, res) => {
  try {
    const { category, location, budget } = req.query;

    const suppliers = await dbUnified.read('suppliers');

    // Filter active and verified suppliers
    let recommended = suppliers.filter(
      s => s.verified === true && s.subscriptionStatus === 'active'
    );

    // Apply category filter
    if (category) {
      recommended = recommended.filter(s => s.category === category);
    }

    // Apply location filter (basic match)
    if (location) {
      const locationLower = location.toLowerCase();
      recommended = recommended.filter(s => {
        const supplierLocation = (s.location || '').toLowerCase();
        return supplierLocation.includes(locationLower) || locationLower.includes(supplierLocation);
      });
    }

    // Apply budget filter (if supplier has pricing info)
    if (budget) {
      const budgetNum = parseFloat(budget);
      if (!isNaN(budgetNum)) {
        recommended = recommended.filter(s => {
          if (!s.priceRange) {
            return true;
          }
          const minPrice = parseFloat(s.priceRange.min || 0);
          const maxPrice = parseFloat(s.priceRange.max || 999999);
          return budgetNum >= minPrice && budgetNum <= maxPrice;
        });
      }
    }

    // Score and sort by relevance
    recommended = recommended.map(s => {
      let score = 0;

      // Boost score for category match
      if (category && s.category === category) {
        score += 10;
      }

      // Boost for location proximity
      if (location && (s.location || '').toLowerCase().includes(location.toLowerCase())) {
        score += 5;
      }

      // Boost for reviews
      score += (s.reviewCount || 0) * 0.1;
      score += (s.averageRating || 0) * 2;

      return { ...stripPublicSupplierPrivateFields(s), recommendationScore: score };
    });

    // Sort by score descending
    recommended.sort((a, b) => b.recommendationScore - a.recommendationScore);

    // Return top 3
    const top3 = recommended.slice(0, 3);

    res.json({
      success: true,
      recommendations: top3,
      total: recommended.length,
    });
  } catch (error) {
    logger.error('Error fetching recommendations:', error);
    res.status(500).json({
      error: 'Failed to fetch recommendations',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/public/auth-photos
 * Returns event-themed photos for the auth page left-panel slideshow.
 * No authentication required — uses Pexels API if configured, or falls back
 * to curated hardcoded photos from pexels-fallback.js.
 * Response is cached for 5 minutes to minimise API calls.
 */
const AUTH_PHOTO_QUERIES = [
  'wedding celebration venue',
  'corporate event conference',
  'birthday party celebration',
  'event planning elegant flowers',
];

const AUTH_PHOTO_PEXELS_DOMAIN = 'images.pexels.com';
const AUTH_PHOTO_PEXELS_PROFILE_DOMAIN = 'www.pexels.com';

function isSafeAuthPexelsUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === AUTH_PHOTO_PEXELS_DOMAIN ||
        parsed.hostname === AUTH_PHOTO_PEXELS_PROFILE_DOMAIN)
    );
  } catch {
    return false;
  }
}

// Return the first URL in the list that passes isSafeAuthPexelsUrl, or null.
function pickSafeAuthUrl(...candidates) {
  for (const u of candidates) {
    if (u && isSafeAuthPexelsUrl(u)) {
      return u;
    }
  }
  return null;
}

// Build a high-resolution, portrait-cropped Pexels CDN URL from the base
// (query-string-free) photo URL. Pexels serves on-the-fly resizing via query
// params, so we request a size/crop that matches this panel's tall aspect
// ratio instead of relying on the pre-set landscape `large` variant.
function toPortraitCropUrl(baseUrl) {
  if (!baseUrl) {
    return null;
  }
  const [path] = baseUrl.split('?');
  return `${path}?auto=compress&cs=tinysrgb&fit=crop&w=1200&h=1600&dpr=2`;
}

function buildAuthFallbackResponse(fallbacks) {
  return {
    source: 'fallback',
    photos: fallbacks
      .map(p => {
        const url = pickSafeAuthUrl(toPortraitCropUrl(p.url), p.src && p.src.large, p.url);
        if (!url) {
          return null;
        }
        return {
          url,
          photographer: String(p.photographer || 'Pexels').slice(0, 80),
          photographerUrl: 'https://www.pexels.com',
          alt: String(p.alt || 'Event photo').slice(0, 120),
        };
      })
      .filter(Boolean),
  };
}

router.get('/auth-photos', apiLimiter, async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=300');

    const { getPexelsService } = require('../utils/pexels-service');
    const { getRandomFallbackPhotos } = require('../config/pexels-fallback');

    const pexels = getPexelsService();

    if (!pexels.isConfigured()) {
      return res.json(buildAuthFallbackResponse(getRandomFallbackPhotos(8)));
    }

    const query = AUTH_PHOTO_QUERIES[Math.floor(Math.random() * AUTH_PHOTO_QUERIES.length)];

    let results;
    try {
      results = await pexels.searchPhotos(query, 8, 1, { orientation: 'portrait', size: 'large' });
    } catch (_) {
      results = { photos: [] };
    }

    const photos = (results.photos || [])
      .map(p => {
        const url =
          p.src && pickSafeAuthUrl(p.src.portrait, p.src.large2x, p.src.large, p.src.medium);
        const photographerUrl =
          p.photographer_url && isSafeAuthPexelsUrl(p.photographer_url)
            ? p.photographer_url
            : 'https://www.pexels.com';
        if (!url) {
          return null;
        }
        return {
          url,
          photographer: String(p.photographer || 'Pexels').slice(0, 80),
          photographerUrl,
          alt: String(p.alt || 'Event photo').slice(0, 120),
        };
      })
      .filter(Boolean);

    if (photos.length === 0) {
      return res.json(buildAuthFallbackResponse(getRandomFallbackPhotos(6)));
    }

    res.json({ source: 'pexels', photos });
  } catch (error) {
    logger.error('Auth photos error:', error);
    try {
      const { getRandomFallbackPhotos } = require('../config/pexels-fallback');
      res.set('Cache-Control', 'public, max-age=60');
      res.json(buildAuthFallbackResponse(getRandomFallbackPhotos(8)));
    } catch (_) {
      res.status(500).json({ photos: [] });
    }
  }
});

module.exports = router;
