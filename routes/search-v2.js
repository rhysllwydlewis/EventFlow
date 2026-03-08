/**
 * Search V2 API Routes
 * Advanced search and discovery endpoints with caching and analytics
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const express = require('express');
const router = express.Router();
const dbUnified = require('../db-unified');
const { authRequired, roleRequired, getUserFromCookie } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const {
  searchCacheMiddleware,
  clearSearchCache,
  getCacheStats,
} = require('../middleware/searchCache');
const searchService = require('../services/searchService');
const searchAnalytics = require('../utils/searchAnalytics');
const validator = require('validator');

// Generate session ID for anonymous users
function getSessionId(req) {
  return req.sessionID || req.cookies?.sessionId || `anon_${Date.now()}_${crypto.randomUUID()}`;
}

// ========================================

// ========================================
// CORE SEARCH ENDPOINTS
// ========================================

/**
 * GET /api/v2/search/suppliers
 * Advanced supplier search with weighted relevance
 *
 * Query normalization and sort validation are handled centrally by
 * searchService.normalizeSupplierQuery so this route only needs to
 * reject inputs that are structurally invalid before passing them on.
 */
router.get('/suppliers', searchCacheMiddleware({ fixedTtl: null }), async (req, res) => {
  try {
    // Pass raw query params — the service normalizes and validates them
    const results = await searchService.searchSuppliers(req.query);

    // Track search for analytics (use normalized values from results)
    const user = await getUserFromCookie(req);
    searchAnalytics
      .trackSearch({
        userId: user?.id,
        sessionId: getSessionId(req),
        queryText: req.query.q ? String(req.query.q).trim().slice(0, 200) : '',
        filters: {
          category: req.query.category,
          location: req.query.location,
          minPrice: req.query.minPrice,
          maxPrice: req.query.maxPrice,
          minRating: req.query.minRating,
          amenities: req.query.amenities,
          sortBy: results.appliedSort,
          page: results.pagination.page,
        },
        resultsCount: results.pagination.total,
        durationMs: results.durationMs,
        userAgent: req.headers['user-agent'],
        cached: false,
      })
      .catch(err => logger.error('Failed to track search:', err));

    res.json({
      success: true,
      data: results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Supplier search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform search',
    });
  }
});

/**
 * GET /api/v2/search/packages
 * Search packages across all suppliers
 */
router.get('/packages', searchCacheMiddleware({ fixedTtl: 600 }), async (req, res) => {
  try {
    // Pass raw query params — the service normalizes and validates them
    const results = await searchService.searchPackages(req.query);

    // Track search
    const user = await getUserFromCookie(req);
    searchAnalytics
      .trackSearch({
        userId: user?.id,
        sessionId: getSessionId(req),
        queryText: req.query.q ? String(req.query.q).trim().slice(0, 200) : '',
        filters: {
          category: req.query.category,
          location: req.query.location,
          minPrice: req.query.minPrice,
          maxPrice: req.query.maxPrice,
          sortBy: results.appliedSort,
          page: results.pagination.page,
        },
        resultsCount: results.pagination.total,
        durationMs: results.durationMs,
        userAgent: req.headers['user-agent'],
      })
      .catch(err => logger.error('Failed to track search:', err));

    res.json({
      success: true,
      data: results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Package search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search packages',
    });
  }
});

/**
 * POST /api/v2/search/advanced
 * Advanced search with complex criteria
 */
router.post('/advanced', async (req, res) => {
  try {
    const criteria = req.body;

    // Validate criteria
    if (!criteria || typeof criteria !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid search criteria',
      });
    }

    const results = await searchService.advancedSearch(criteria);

    // Track search
    const user = await getUserFromCookie(req);
    searchAnalytics
      .trackSearch({
        userId: user?.id,
        sessionId: getSessionId(req),
        queryText: criteria.q || '',
        filters: {
          category: criteria.category,
          location: criteria.location,
          minPrice: criteria.minPrice,
          maxPrice: criteria.maxPrice,
          minRating: criteria.minRating,
          sortBy: results.appliedSort,
          page: results.pagination?.page,
        },
        resultsCount: results.pagination?.total || 0,
        durationMs: results.durationMs,
        userAgent: req.headers['user-agent'],
      })
      .catch(err => logger.error('Failed to track search:', err));

    res.json({
      success: true,
      data: results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Advanced search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform advanced search',
    });
  }
});

// ========================================
// SAVED SEARCHES & HISTORY
// ========================================

/**
 * POST /api/v2/search/saved
 * Save a search for quick access
 */
router.post('/saved', authRequired, csrfProtection, async (req, res) => {
  try {
    const { name, criteria, description } = req.body;

    if (!name || !criteria) {
      return res.status(400).json({
        success: false,
        error: 'Name and criteria are required',
      });
    }

    // Validate name
    if (name.length < 3 || name.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Name must be between 3 and 100 characters',
      });
    }

    const savedSearch = {
      id: `saved_${Date.now()}_${crypto.randomUUID()}`,
      userId: req.user.id,
      name: validator.escape(name),
      description: description ? validator.escape(description) : '',
      criteria,
      notificationsEnabled: false,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      useCount: 0,
    };

    await dbUnified.insertOne('savedSearches', savedSearch);

    res.json({
      success: true,
      data: { savedSearchId: savedSearch.id },
      message: 'Search saved successfully',
    });
  } catch (error) {
    logger.error('Save search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save search',
    });
  }
});

/**
 * GET /api/v2/search/saved
 * Get user's saved searches
 */
router.get('/saved', authRequired, async (req, res) => {
  try {
    const savedSearches = (await dbUnified.read('savedSearches')) || [];
    const userSearches = savedSearches
      .filter(s => s.userId === req.user.id)
      .sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt));

    res.json({
      success: true,
      data: { searches: userSearches },
    });
  } catch (error) {
    logger.error('Get saved searches error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve saved searches',
    });
  }
});

/**
 * DELETE /api/v2/search/saved/:id
 * Delete a saved search
 */
router.delete('/saved/:id', authRequired, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const savedSearches = (await dbUnified.read('savedSearches')) || [];

    const index = savedSearches.findIndex(s => s.id === id && s.userId === req.user.id);

    if (index === -1) {
      return res.status(404).json({
        success: false,
        error: 'Saved search not found',
      });
    }

    await dbUnified.deleteOne('savedSearches', id);

    res.json({
      success: true,
      message: 'Saved search deleted',
    });
  } catch (error) {
    logger.error('Delete saved search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete saved search',
    });
  }
});

/**
 * GET /api/v2/search/history
 * Get user's search history
 */
router.get('/history', authRequired, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const skip = Number(req.query.skip) || 0;

    const searchHistory = (await dbUnified.read('searchHistory')) || [];
    const userHistory = searchHistory
      .filter(s => s.userId === req.user.id)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(skip, skip + limit);

    res.json({
      success: true,
      data: {
        history: userHistory,
        total: searchHistory.filter(s => s.userId === req.user.id).length,
      },
    });
  } catch (error) {
    logger.error('Get search history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve search history',
    });
  }
});

// ========================================
// SUGGESTIONS & AUTOCOMPLETE
// ========================================

/**
 * GET /api/v2/search/suggestions
 * Get autocomplete suggestions
 */
router.get('/suggestions', searchCacheMiddleware({ fixedTtl: 3600 }), async (req, res) => {
  try {
    const q = req.query.q ? String(req.query.q).trim() : '';

    if (!q || q.length < 2) {
      return res.json({
        success: true,
        data: { suggestions: [] },
      });
    }

    if (q.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Query too long',
      });
    }

    const suggestions = await searchAnalytics.getAutocompleteSuggestions(q, 10);

    res.json({
      success: true,
      data: { suggestions },
    });
  } catch (error) {
    logger.error('Suggestions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get suggestions',
    });
  }
});

/**
 * GET /api/v2/search/trending
 * Get trending searches
 */
router.get('/trending', searchCacheMiddleware({ fixedTtl: 600 }), async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '24h';
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    if (!['1h', '24h', '7d', '30d'].includes(timeRange)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid time range',
      });
    }

    const trending = await searchAnalytics.getTrendingSearches(timeRange, limit);

    res.json({
      success: true,
      data: { trending, timeRange },
    });
  } catch (error) {
    logger.error('Trending searches error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get trending searches',
    });
  }
});

/**
 * GET /api/v2/search/popular-queries
 * Get popular search queries
 */
router.get('/popular-queries', searchCacheMiddleware({ fixedTtl: 1800 }), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const popular = await searchAnalytics.getPopularQueries(limit);

    res.json({
      success: true,
      data: { queries: popular },
    });
  } catch (error) {
    logger.error('Popular queries error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get popular queries',
    });
  }
});

// ========================================
// FILTERS & FACETS
// ========================================

/**
 * GET /api/v2/search/categories
 * Get all searchable categories
 */
router.get('/categories', searchCacheMiddleware({ fixedTtl: 86400 }), async (req, res) => {
  try {
    const suppliers = await dbUnified.read('suppliers');
    const categoryCounts = {};

    suppliers
      .filter(s => s.approved)
      .forEach(s => {
        if (s.category) {
          categoryCounts[s.category] = (categoryCounts[s.category] || 0) + 1;
        }
      });

    const categories = Object.entries(categoryCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      data: { categories },
    });
  } catch (error) {
    logger.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get categories',
    });
  }
});

/**
 * GET /api/v2/search/amenities
 * Get all filterable amenities
 */
router.get('/amenities', searchCacheMiddleware({ fixedTtl: 86400 }), async (req, res) => {
  try {
    const suppliers = await dbUnified.read('suppliers');
    const amenityCounts = {};

    suppliers
      .filter(s => s.approved && s.amenities)
      .forEach(s => {
        s.amenities.forEach(amenity => {
          amenityCounts[amenity] = (amenityCounts[amenity] || 0) + 1;
        });
      });

    const amenities = Object.entries(amenityCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      data: { amenities },
    });
  } catch (error) {
    logger.error('Get amenities error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get amenities',
    });
  }
});

/**
 * GET /api/v2/search/locations
 * Get popular locations
 */
router.get('/locations', searchCacheMiddleware({ fixedTtl: 86400 }), async (req, res) => {
  try {
    const suppliers = await dbUnified.read('suppliers');
    const locationCounts = {};

    suppliers
      .filter(s => s.approved && s.location)
      .forEach(s => {
        locationCounts[s.location] = (locationCounts[s.location] || 0) + 1;
      });

    const locations = Object.entries(locationCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    res.json({
      success: true,
      data: { locations },
    });
  } catch (error) {
    logger.error('Get locations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get locations',
    });
  }
});

// ========================================
// ANALYTICS & INSIGHTS (Admin Only)
// ========================================

/**
 * GET /api/v2/search/analytics
 * Admin dashboard search analytics
 */
router.get('/analytics', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const analytics = await searchAnalytics.getSearchAnalytics();

    res.json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    logger.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get search analytics',
    });
  }
});

/**
 * GET /api/v2/search/analytics/trends
 * Search trend analytics
 */
router.get('/analytics/trends', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '7d';
    const trending = await searchAnalytics.getTrendingSearches(timeRange, 50);

    res.json({
      success: true,
      data: { trends: trending, timeRange },
    });
  } catch (error) {
    logger.error('Get trends error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get trends',
    });
  }
});

/**
 * GET /api/v2/search/analytics/user-behavior
 * User search behavior insights
 */
router.get('/analytics/user-behavior', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const insights = await searchAnalytics.getUserBehaviorInsights();

    res.json({
      success: true,
      data: insights,
    });
  } catch (error) {
    logger.error('Get user behavior error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user behavior insights',
    });
  }
});

// ========================================
// PERFORMANCE & CACHE MANAGEMENT (Admin)
// ========================================

/**
 * GET /api/v2/search/performance
 * Search performance metrics
 */
router.get('/performance', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const cacheStats = await getCacheStats();
    const analytics = await searchAnalytics.getSearchAnalytics();

    res.json({
      success: true,
      data: {
        cache: cacheStats,
        performance: analytics.performance,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Get performance error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get performance metrics',
    });
  }
});

/**
 * POST /api/v2/search/cache/clear
 * Clear search cache
 */
router.post(
  '/cache/clear',
  authRequired,
  csrfProtection,
  roleRequired('admin'),
  async (req, res) => {
    try {
      await clearSearchCache();

      res.json({
        success: true,
        message: 'Search cache cleared successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Clear cache error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear cache',
      });
    }
  }
);

/**
 * GET /api/v2/search/cache/stats
 * Get cache statistics
 */
router.get('/cache/stats', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const stats = await getCacheStats();

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Get cache stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get cache statistics',
    });
  }
});

module.exports = router;
