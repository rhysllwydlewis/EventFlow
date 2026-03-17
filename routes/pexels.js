/**
 * Pexels Stock Photos API Routes
 * Provides endpoints for browsing and selecting Pexels stock photos
 * For use with category images, hero banners, and other site content
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const { getPexelsService } = require('../utils/pexels-service');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');

/**
 * GET /api/pexels/search
 * Search for stock photos by query
 * Query params: q (search term), page (page number), perPage (results per page),
 *               orientation (portrait/landscape/square), size (large/medium/small),
 *               color (e.g., red, orange, yellow), locale (e.g., en-US, pt-BR)
 * Requires admin or supplier authentication
 */
router.get('/search', authRequired, roleRequired(['admin', 'supplier']), async (req, res) => {
  try {
    const pexels = getPexelsService();

    if (!pexels.isConfigured()) {
      return res.status(503).json({
        error: 'Pexels API not configured',
        message: 'Please configure PEXELS_API_KEY in your environment variables',
      });
    }

    const { q, page = 1, perPage = 15, orientation, size, color, locale } = req.query;

    if (!q) {
      return res.status(400).json({
        error: 'Missing query parameter',
        message: 'Query parameter "q" is required',
      });
    }

    // Build filters object
    const filters = {};
    if (orientation) {
      filters.orientation = orientation;
    }
    if (size) {
      filters.size = size;
    }
    if (color) {
      filters.color = color;
    }
    if (locale) {
      filters.locale = locale;
    }

    logger.info(`🔍 Admin searching photos: "${q}" with filters:`, filters);
    const results = await pexels.searchPhotos(q, parseInt(perPage), parseInt(page), filters);

    res.json({
      success: true,
      query: q,
      filters,
      ...results,
    });
  } catch (error) {
    logger.error('Pexels search error:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: 'Failed to search photos',
      message: error.userFriendlyMessage || error.message,
      errorType: error.type || 'unknown',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/pexels/curated
 * Get curated stock photos (editor's picks)
 * Query params: page (page number), perPage (results per page)
 * Requires admin or supplier authentication
 */
router.get('/curated', authRequired, roleRequired(['admin', 'supplier']), async (req, res) => {
  try {
    const pexels = getPexelsService();

    if (!pexels.isConfigured()) {
      return res.status(503).json({
        error: 'Pexels API not configured',
        message: 'Please configure PEXELS_API_KEY in your environment variables',
      });
    }

    const { page = 1, perPage = 15 } = req.query;

    const results = await pexels.getCuratedPhotos(parseInt(perPage), parseInt(page));

    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    logger.error('Pexels curated error:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: 'Failed to fetch curated photos',
      message: error.userFriendlyMessage || error.message,
      errorType: error.type || 'unknown',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/pexels/photo/:id
 * Get specific photo by ID
 * Requires admin authentication
 */
router.get('/photo/:id', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const pexels = getPexelsService();

    if (!pexels.isConfigured()) {
      return res.status(503).json({
        error: 'Pexels API not configured',
        message: 'Please configure PEXELS_API_KEY in your environment variables',
      });
    }

    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        error: 'Invalid photo ID',
        message: 'Photo ID must be a number',
      });
    }

    const photo = await pexels.getPhotoById(parseInt(id));

    res.json({
      success: true,
      photo,
    });
  } catch (error) {
    logger.error('Pexels photo error:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: 'Failed to fetch photo',
      message: error.userFriendlyMessage || error.message,
      errorType: error.type || 'unknown',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/pexels/categories
 * Get suggested search queries for each category
 * Requires admin authentication
 */
router.get('/categories', authRequired, roleRequired('admin'), (req, res) => {
  const { PexelsService } = require('../utils/pexels-service');
  const categories = PexelsService.getCategorySuggestions();

  res.json({
    success: true,
    categories,
  });
});

/**
 * GET /api/pexels/status
 * Check if Pexels API is configured and available
 * Requires admin authentication
 */
router.get('/status', authRequired, roleRequired('admin'), (req, res) => {
  const pexels = getPexelsService();

  res.json({
    configured: pexels.isConfigured(),
    apiKey: pexels.isConfigured() ? '***configured***' : null,
  });
});

/**
 * GET /api/pexels/test
 * Test Pexels API connection and validate API key
 * Requires admin authentication
 * Returns detailed status including connection test results and fallback availability
 */
router.get('/test', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const pexels = getPexelsService();
    const { getFallbackPhotos, getFallbackVideos } = require('../config/pexels-fallback');

    logger.info('🔍 Admin testing Pexels API connection...');
    const testResult = await pexels.testConnection();

    // Add fallback information
    const fallbackPhotosCount = getFallbackPhotos().length;
    const fallbackVideosCount = getFallbackVideos().length;
    const hasFallback = fallbackPhotosCount > 0 || fallbackVideosCount > 0;

    // Determine current mode
    let mode = 'unavailable';
    if (testResult.success) {
      mode = 'api'; // API is working
    } else if (hasFallback) {
      mode = 'fallback'; // API not working but fallback available
    }

    // Enhanced response with fallback info
    const enhancedResult = {
      ...testResult,
      mode,
      fallback: {
        available: hasFallback,
        photosCount: fallbackPhotosCount,
        videosCount: fallbackVideosCount,
      },
      timestamp: new Date().toISOString(),
    };

    // Return appropriate HTTP status based on result
    // 200 = Success (API working)
    // 424 = Failed Dependency (API not working but fallback available)
    const statusCode = testResult.success ? 200 : 424;

    res.status(statusCode).json(enhancedResult);
  } catch (error) {
    logger.error('Pexels test error:', error);

    // Even on error, check if fallback is available
    try {
      const { getFallbackPhotos, getFallbackVideos } = require('../config/pexels-fallback');
      const fallbackPhotosCount = getFallbackPhotos().length;
      const fallbackVideosCount = getFallbackVideos().length;
      const hasFallback = fallbackPhotosCount > 0 || fallbackVideosCount > 0;

      res.status(500).json({
        success: false,
        message: 'Failed to test Pexels API connection',
        mode: hasFallback ? 'fallback' : 'unavailable',
        fallback: {
          available: hasFallback,
          photosCount: fallbackPhotosCount,
          videosCount: fallbackVideosCount,
        },
        details: {
          error: error.message,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (fallbackError) {
      // Fallback check also failed
      res.status(500).json({
        success: false,
        message: 'Failed to test Pexels API connection',
        mode: 'unavailable',
        details: {
          error: error.message,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }
});

/**
 * GET /api/pexels/videos/search
 * Search for videos by query
 * Query params: q (search term), page, perPage, orientation, size, locale
 * Requires admin authentication
 */
router.get('/videos/search', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const pexels = getPexelsService();

    if (!pexels.isConfigured()) {
      return res.status(503).json({
        error: 'Pexels API not configured',
        message: 'Please configure PEXELS_API_KEY in your environment variables',
      });
    }

    const { q, page = 1, perPage = 15, orientation, size, locale } = req.query;

    if (!q) {
      return res.status(400).json({
        error: 'Missing query parameter',
        message: 'Query parameter "q" is required',
      });
    }

    // Build filters object
    const filters = {};
    if (orientation) {
      filters.orientation = orientation;
    }
    if (size) {
      filters.size = size;
    }
    if (locale) {
      filters.locale = locale;
    }

    logger.info(`🎥 Admin searching videos: "${q}" with filters:`, filters);
    const results = await pexels.searchVideos(q, parseInt(perPage), parseInt(page), filters);

    res.json({
      success: true,
      query: q,
      filters,
      ...results,
    });
  } catch (error) {
    logger.error('Pexels video search error:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: 'Failed to search videos',
      message: error.userFriendlyMessage || error.message,
      errorType: error.type || 'unknown',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/pexels/videos/popular
 * Get popular videos
 * Query params: page, perPage
 * Requires admin authentication
 */
router.get('/videos/popular', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const pexels = getPexelsService();

    if (!pexels.isConfigured()) {
      return res.status(503).json({
        error: 'Pexels API not configured',
        message: 'Please configure PEXELS_API_KEY in your environment variables',
      });
    }

    const { page = 1, perPage = 15 } = req.query;

    logger.info(`🎥 Admin fetching popular videos`);
    const results = await pexels.getPopularVideos(parseInt(perPage), parseInt(page));

    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    logger.error('Pexels popular videos error:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: 'Failed to fetch popular videos',
      message: error.userFriendlyMessage || error.message,
      errorType: error.type || 'unknown',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/pexels/videos/:id
 * Get specific video by ID
 * Requires admin authentication
 */
router.get('/videos/:id', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const pexels = getPexelsService();

    if (!pexels.isConfigured()) {
      return res.status(503).json({
        error: 'Pexels API not configured',
        message: 'Please configure PEXELS_API_KEY in your environment variables',
      });
    }

    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        error: 'Invalid video ID',
        message: 'Video ID must be a number',
      });
    }

    logger.info(`🎥 Admin fetching video: ${id}`);
    const video = await pexels.getVideoById(parseInt(id));

    res.json({
      success: true,
      video,
    });
  } catch (error) {
    logger.error('Pexels video error:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: 'Failed to fetch video',
      message: error.userFriendlyMessage || error.message,
      errorType: error.type || 'unknown',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/pexels/collections/featured
 * Get featured collections
 * Query params: page, perPage
 * Requires admin authentication
 */
router.get('/collections/featured', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const pexels = getPexelsService();

    if (!pexels.isConfigured()) {
      return res.status(503).json({
        error: 'Pexels API not configured',
        message: 'Please configure PEXELS_API_KEY in your environment variables',
      });
    }

    const { page = 1, perPage = 15 } = req.query;

    logger.info(`📚 Admin fetching featured collections`);
    const results = await pexels.getFeaturedCollections(parseInt(perPage), parseInt(page));

    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    logger.error('Pexels featured collections error:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: 'Failed to fetch featured collections',
      message: error.userFriendlyMessage || error.message,
      errorType: error.type || 'unknown',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/pexels/collections
 * Get user collections
 * Query params: page, perPage
 * Requires admin authentication
 */
router.get('/collections', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const pexels = getPexelsService();

    if (!pexels.isConfigured()) {
      return res.status(503).json({
        error: 'Pexels API not configured',
        message: 'Please configure PEXELS_API_KEY in your environment variables',
      });
    }

    const { page = 1, perPage = 15 } = req.query;

    logger.info(`📚 Admin fetching user collections`);
    const results = await pexels.getUserCollections(parseInt(perPage), parseInt(page));

    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    logger.error('Pexels user collections error:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: 'Failed to fetch user collections',
      message: error.userFriendlyMessage || error.message,
      errorType: error.type || 'unknown',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/pexels/collections/:id
 * Get media from a collection
 * Query params: page, perPage, type (photos/videos)
 * Requires admin authentication
 */
router.get('/collections/:id', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const pexels = getPexelsService();

    if (!pexels.isConfigured()) {
      return res.status(503).json({
        error: 'Pexels API not configured',
        message: 'Please configure PEXELS_API_KEY in your environment variables',
      });
    }

    const { id } = req.params;
    const { page = 1, perPage = 15, type } = req.query;

    logger.info(`📚 Admin fetching collection media: ${id}`);
    const results = await pexels.getCollectionMedia(id, parseInt(perPage), parseInt(page), type);

    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    logger.error('Pexels collection media error:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: 'Failed to fetch collection media',
      message: error.userFriendlyMessage || error.message,
      errorType: error.type || 'unknown',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/pexels/collection/:id/media
 * Get media from a collection (alternative route for frontend convenience)
 * Query params: page, perPage, type (photos/videos)
 * Requires admin authentication
 */
router.get('/collection/:id/media', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const pexels = getPexelsService();

    if (!pexels.isConfigured()) {
      return res.status(503).json({
        error: 'Pexels API not configured',
        message: 'Please configure PEXELS_API_KEY in your environment variables',
      });
    }

    const { id } = req.params;
    const { page = 1, perPage = 15, type } = req.query;

    logger.info(`📚 Admin fetching collection media: ${id}`);
    const results = await pexels.getCollectionMedia(id, parseInt(perPage), parseInt(page), type);

    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    logger.error('Pexels collection media error:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: 'Failed to fetch collection media',
      message: error.userFriendlyMessage || error.message,
      errorType: error.type || 'unknown',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/pexels/metrics
 * Get Pexels API usage metrics
 * Requires admin authentication
 */
router.get('/metrics', authRequired, roleRequired('admin'), (req, res) => {
  const pexels = getPexelsService();

  const metrics = pexels.getMetrics();

  res.json({
    success: true,
    metrics,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/pexels/cache/clear
 * Clear Pexels API response cache
 * Requires admin authentication and CSRF protection
 */
router.post('/cache/clear', csrfProtection, authRequired, roleRequired('admin'), (req, res) => {
  const pexels = getPexelsService();

  pexels.clearCache();

  res.json({
    success: true,
    message: 'Cache cleared successfully',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
