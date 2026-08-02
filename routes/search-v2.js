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
const searchService = require('../services/rankedSupplierSearch.service');
const { addPublicProfilePaths } = require('../utils/publicSupplierProfilePath');
const searchAnalytics = require('../utils/searchAnalytics');
const validator = require('validator');

function getSessionId(req) {
  return req.sessionID || req.cookies?.sessionId || `anon_${Date.now()}_${crypto.randomUUID()}`;
}

router.get('/suppliers', searchCacheMiddleware({ fixedTtl: null }), async (req, res) => {
  try {
    const rawResults = await searchService.searchSuppliers(req.query);
    const results = addPublicProfilePaths(rawResults);
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
    res.json({ success: true, data: results, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Supplier search error:', error);
    res.status(500).json({ success: false, error: 'Failed to perform search' });
  }
});

router.get('/packages', searchCacheMiddleware({ fixedTtl: 600 }), async (req, res) => {
  try {
    const results = await searchService.searchPackages(req.query);
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
    res.json({ success: true, data: results, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Package search error:', error);
    res.status(500).json({ success: false, error: 'Failed to search packages' });
  }
});

router.post('/advanced', async (req, res) => {
  try {
    const criteria = req.body;
    if (!criteria || typeof criteria !== 'object') {
      return res.status(400).json({ success: false, error: 'Invalid search criteria' });
    }
    const results = await searchService.advancedSearch(criteria);
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
    return res.json({ success: true, data: results, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Advanced search error:', error);
    return res.status(500).json({ success: false, error: 'Failed to perform advanced search' });
  }
});

router.post('/saved', authRequired, csrfProtection, async (req, res) => {
  try {
    const { name, criteria, description } = req.body;
    if (!name || !criteria) {
      return res.status(400).json({ success: false, error: 'Name and criteria are required' });
    }
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
    const searchInserted = await dbUnified.insertOne('savedSearches', savedSearch);
    if (!searchInserted) {
      logger.error('[SEARCH] insertOne failed', { searchId: savedSearch.id });
      return res.status(500).json({ error: 'Failed to save search. Please try again.' });
    }
    return res.json({
      success: true,
      data: { savedSearchId: savedSearch.id },
      message: 'Search saved successfully',
    });
  } catch (error) {
    logger.error('Save search error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save search' });
  }
});

router.get('/saved', authRequired, async (req, res) => {
  try {
    const allUserSearches = await dbUnified.find('savedSearches', { userId: req.user.id });
    const userSearches = allUserSearches.sort(
      (a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt)
    );
    return res.json({ success: true, data: { searches: userSearches } });
  } catch (error) {
    logger.error('Get saved searches error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve saved searches' });
  }
});

router.delete('/saved/:id', authRequired, csrfProtection, async (req, res) => {
  try {
    const savedSearch = await dbUnified.findOne('savedSearches', {
      id: req.params.id,
      userId: req.user.id,
    });
    if (!savedSearch) {
      return res.status(404).json({ success: false, error: 'Saved search not found' });
    }
    await dbUnified.deleteOne('savedSearches', { id: req.params.id });
    return res.json({ success: true, message: 'Saved search deleted' });
  } catch (error) {
    logger.error('Delete saved search error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete saved search' });
  }
});

router.get('/history', authRequired, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const skip = Number(req.query.skip) || 0;
    const allHistory = await dbUnified.find('searchHistory', { userId: req.user.id });
    const history = allHistory
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(skip, skip + limit);
    return res.json({ success: true, data: { history, total: allHistory.length } });
  } catch (error) {
    logger.error('Get search history error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve search history' });
  }
});

router.get('/suggestions', searchCacheMiddleware({ fixedTtl: 3600 }), async (req, res) => {
  try {
    const q = req.query.q ? String(req.query.q).trim() : '';
    if (!q || q.length < 2) {
      return res.json({ success: true, data: { suggestions: [] } });
    }
    if (q.length > 100) {
      return res.status(400).json({ success: false, error: 'Query too long' });
    }
    const suggestions = await searchAnalytics.getAutocompleteSuggestions(q, 10);
    return res.json({ success: true, data: { suggestions } });
  } catch (error) {
    logger.error('Suggestions error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get suggestions' });
  }
});

router.get('/trending', searchCacheMiddleware({ fixedTtl: 600 }), async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '24h';
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    if (!['1h', '24h', '7d', '30d'].includes(timeRange)) {
      return res.status(400).json({ success: false, error: 'Invalid time range' });
    }
    const trending = await searchAnalytics.getTrendingSearches(timeRange, limit);
    return res.json({ success: true, data: { trending, timeRange } });
  } catch (error) {
    logger.error('Trending searches error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get trending searches' });
  }
});

router.get('/popular-queries', searchCacheMiddleware({ fixedTtl: 1800 }), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const popular = await searchAnalytics.getPopularQueries(limit);
    return res.json({ success: true, data: { queries: popular } });
  } catch (error) {
    logger.error('Popular queries error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get popular queries' });
  }
});

router.get('/categories', searchCacheMiddleware({ fixedTtl: 86400 }), async (_req, res) => {
  try {
    const suppliers = await dbUnified.read('suppliers');
    const counts = {};
    suppliers
      .filter(supplier => supplier.approved)
      .forEach(supplier => {
        if (supplier.category) counts[supplier.category] = (counts[supplier.category] || 0) + 1;
      });
    const categories = Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    return res.json({ success: true, data: { categories } });
  } catch (error) {
    logger.error('Get categories error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get categories' });
  }
});

router.get('/amenities', searchCacheMiddleware({ fixedTtl: 86400 }), async (_req, res) => {
  try {
    const suppliers = await dbUnified.read('suppliers');
    const counts = {};
    suppliers
      .filter(supplier => supplier.approved && supplier.amenities)
      .forEach(supplier => {
        supplier.amenities.forEach(amenity => {
          counts[amenity] = (counts[amenity] || 0) + 1;
        });
      });
    const amenities = Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    return res.json({ success: true, data: { amenities } });
  } catch (error) {
    logger.error('Get amenities error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get amenities' });
  }
});

router.get('/locations', searchCacheMiddleware({ fixedTtl: 86400 }), async (_req, res) => {
  try {
    const suppliers = await dbUnified.read('suppliers');
    const counts = {};
    suppliers
      .filter(supplier => supplier.approved && supplier.location)
      .forEach(supplier => {
        counts[supplier.location] = (counts[supplier.location] || 0) + 1;
      });
    const locations = Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
    return res.json({ success: true, data: { locations } });
  } catch (error) {
    logger.error('Get locations error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get locations' });
  }
});

router.get('/analytics', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    return res.json({ success: true, data: await searchAnalytics.getSearchAnalytics() });
  } catch (error) {
    logger.error('Get analytics error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get search analytics' });
  }
});

router.get('/analytics/trends', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '7d';
    const trends = await searchAnalytics.getTrendingSearches(timeRange, 50);
    return res.json({ success: true, data: { trends, timeRange } });
  } catch (error) {
    logger.error('Get trends error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get trends' });
  }
});

router.get('/analytics/user-behavior', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    return res.json({ success: true, data: await searchAnalytics.getUserBehaviorInsights() });
  } catch (error) {
    logger.error('Get user behavior error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get user behavior insights',
    });
  }
});

router.get('/performance', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    const [cache, analytics] = await Promise.all([
      getCacheStats(),
      searchAnalytics.getSearchAnalytics(),
    ]);
    return res.json({
      success: true,
      data: { cache, performance: analytics.performance, timestamp: new Date().toISOString() },
    });
  } catch (error) {
    logger.error('Get performance error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get performance metrics' });
  }
});

router.post(
  '/cache/clear',
  authRequired,
  csrfProtection,
  roleRequired('admin'),
  async (_req, res) => {
    try {
      await clearSearchCache();
      return res.json({
        success: true,
        message: 'Search cache cleared successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Clear cache error:', error);
      return res.status(500).json({ success: false, error: 'Failed to clear cache' });
    }
  }
);

router.get('/cache/stats', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    return res.json({
      success: true,
      data: await getCacheStats(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Get cache stats error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get cache statistics' });
  }
});

router.get('/similar/:supplierId', searchCacheMiddleware({ fixedTtl: 1800 }), async (req, res) => {
  try {
    const { supplierId } = req.params;
    if (!supplierId || !/^[a-zA-Z0-9_-]{1,100}$/.test(supplierId)) {
      return res.status(400).json({ success: false, error: 'Invalid supplierId' });
    }
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = !isNaN(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 12) : 6;
    const results = await searchService.getSimilarSuppliers(supplierId, limit);
    return res.json({
      success: true,
      data: { supplierId, results, count: results.length },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Similar suppliers error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get similar suppliers' });
  }
});

router.get('/discovery', searchCacheMiddleware({ fixedTtl: 600 }), async (req, res) => {
  try {
    const parseLimit = (value, fallback) => {
      const parsed = parseInt(value, 10);
      return !isNaN(parsed) && parsed > 0 ? Math.min(parsed, 12) : fallback;
    };
    const feed = await searchService.getDiscoveryFeed({
      featuredLimit: parseLimit(req.query.featuredLimit, 4),
      topRatedLimit: parseLimit(req.query.topRatedLimit, 6),
      newArrivalsLimit: parseLimit(req.query.newArrivalsLimit, 6),
    });
    return res.json({ success: true, data: feed, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Discovery feed error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get discovery feed' });
  }
});

router.get('/personalized', searchCacheMiddleware({ fixedTtl: null }), async (req, res) => {
  try {
    const user = await getUserFromCookie(req);
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = !isNaN(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 24) : 12;
    const parsedBudget = parseInt(req.query.budget, 10);
    const budget =
      !isNaN(parsedBudget) && parsedBudget >= 1 && parsedBudget <= 4 ? parsedBudget : undefined;
    const feed = await searchService.getPersonalizedFeed(
      user?.id || null,
      {
        eventType: req.query.eventType
          ? String(req.query.eventType).trim().slice(0, 100)
          : undefined,
        location: req.query.location ? String(req.query.location).trim() : undefined,
        budget,
      },
      { limit }
    );
    return res.json({ success: true, data: feed, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Personalized feed error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get personalized feed' });
  }
});

router.get(
  '/also-viewed/:supplierId',
  searchCacheMiddleware({ fixedTtl: 1800 }),
  async (req, res) => {
    try {
      const { supplierId } = req.params;
      if (!supplierId || !/^[a-zA-Z0-9_-]{1,100}$/.test(supplierId)) {
        return res.status(400).json({ success: false, error: 'Invalid supplierId' });
      }
      const parsedLimit = parseInt(req.query.limit, 10);
      const limit = !isNaN(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 12) : 6;
      const results = await searchService.getPeopleAlsoViewed(supplierId, limit);
      return res.json({
        success: true,
        data: { supplierId, results, count: results.length },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Also-viewed error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to get also-viewed suppliers',
      });
    }
  }
);

module.exports = router;
