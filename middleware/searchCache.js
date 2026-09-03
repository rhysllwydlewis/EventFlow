/**
 * Search Cache Middleware
 * Intelligent caching for search queries with TTL based on popularity
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const cache = require('../cache');

// Cache TTL configuration (in seconds)
const CACHE_TTL = {
  popular: 30 * 60, // 30 minutes for popular queries (>100 searches/day)
  regular: 10 * 60, // 10 minutes for regular queries (10-100 searches/day)
  unpopular: 2 * 60, // 2 minutes for unpopular queries (<10 searches/day)
  autocomplete: 60 * 60, // 60 minutes for autocomplete
  categories: 24 * 60 * 60, // 24 hours for categories/locations
  trending: 10 * 60, // 10 minutes for trending
};

// Popularity thresholds (searches per day)
const POPULARITY_THRESHOLDS = {
  high: 100,
  medium: 10,
};

/**
 * Generate cache key for search query
 * @param {Object} req - Express request
 * @returns {string} Cache key
 */
function generateCacheKey(req) {
  const { path, query, body } = req;

  // Create a stable object for hashing
  const cacheObject = {
    path,
    query: sortObject(query),
    body: body ? sortObject(body) : null,
  };

  // Generate hash
  const hash = crypto.createHash('sha256').update(JSON.stringify(cacheObject)).digest('hex');

  return `search:v2:${hash}`;
}

/**
 * Sort object keys for consistent hashing
 * @param {Object} obj - Object to sort
 * @returns {Object} Sorted object
 */
function sortObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  return Object.keys(obj)
    .sort()
    .reduce((result, key) => {
      result[key] =
        typeof obj[key] === 'object' && obj[key] !== null ? sortObject(obj[key]) : obj[key];
      return result;
    }, {});
}

/**
 * Get query popularity and determine TTL
 * @param {string} queryText - Search query text
 * @returns {Promise<Object>} Popularity info
 */
async function getQueryPopularity(queryText) {
  if (!queryText) {
    return { ttl: CACHE_TTL.regular, popularity: 'regular' };
  }

  try {
    // Check if we have popularity data cached
    const popKey = `search:popularity:${queryText.toLowerCase()}`;
    const cached = await cache.get(popKey);

    if (cached) {
      return cached;
    }

    // Default to regular for new queries
    const result = {
      ttl: CACHE_TTL.regular,
      popularity: 'regular',
    };

    // Cache the popularity result for 1 hour
    await cache.set(popKey, result, 3600);

    return result;
  } catch (error) {
    logger.error('Error getting query popularity:', error);
    return { ttl: CACHE_TTL.regular, popularity: 'regular' };
  }
}

/**
 * Update query popularity tracking
 * @param {string} queryText - Search query text
 * @returns {Promise<void>}
 */
async function updateQueryPopularity(queryText) {
  if (!queryText) {
    return;
  }

  try {
    const countKey = `search:count:${queryText.toLowerCase()}`;
    const count = (await cache.get(countKey)) || 0;
    const newCount = count + 1;

    // Store count with 24 hour expiry
    await cache.set(countKey, newCount, 24 * 60 * 60);

    // Determine popularity tier
    let popularity = 'unpopular';
    let ttl = CACHE_TTL.unpopular;

    if (newCount >= POPULARITY_THRESHOLDS.high) {
      popularity = 'popular';
      ttl = CACHE_TTL.popular;
    } else if (newCount >= POPULARITY_THRESHOLDS.medium) {
      popularity = 'regular';
      ttl = CACHE_TTL.regular;
    }

    // Update popularity cache
    const popKey = `search:popularity:${queryText.toLowerCase()}`;
    await cache.set(popKey, { ttl, popularity, count: newCount }, 3600);
  } catch (error) {
    logger.error('Error updating query popularity:', error);
  }
}

/**
 * Search cache middleware
 * @param {Object} options - Middleware options
 * @returns {Function} Express middleware
 */
function searchCacheMiddleware(options = {}) {
  const { enabled = true, fixedTtl = null } = options;

  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET' || !enabled) {
      return next();
    }

    const cacheKey = generateCacheKey(req);

    try {
      // Try to get from cache
      const cachedData = await cache.get(cacheKey);

      if (cachedData) {
        const cacheAge = Math.round((Date.now() - cachedData.timestamp) / 1000);

        // Add cache headers
        res.set({
          'X-Cache': 'HIT',
          'X-Cache-Age': `${cacheAge}s`,
          'Cache-Control': `public, max-age=${cachedData.ttl}`,
        });

        // Mark as cached for analytics
        if (cachedData.data && typeof cachedData.data === 'object') {
          cachedData.data.cached = true;
          cachedData.data.cacheAge = `${cacheAge}s`;
        }

        return res.json(cachedData.data);
      }

      // Cache miss
      res.set('X-Cache', 'MISS');

      // Store original json method
      const originalJson = res.json.bind(res);

      // Override json method to cache response
      res.json = async function (data) {
        try {
          // Determine TTL
          let ttl = fixedTtl;
          if (!ttl) {
            const queryText = req.query.q || req.body?.queryText || '';
            const popularityInfo = await getQueryPopularity(queryText);
            ttl = popularityInfo.ttl;

            // Update popularity counter
            if (queryText) {
              updateQueryPopularity(queryText).catch(err =>
                logger.error('Failed to update popularity:', err)
              );
            }
          }

          // Only cache successful responses
          if (res.statusCode === 200 && data) {
            const cacheData = {
              data,
              timestamp: Date.now(),
              ttl,
            };

            await cache.set(cacheKey, cacheData, ttl);
          }

          // Add cache control header
          res.set('Cache-Control', `public, max-age=${ttl}`);
        } catch (error) {
          logger.error('Error caching search response:', error);
        }

        return originalJson(data);
      };

      next();
    } catch (error) {
      logger.error('Search cache middleware error:', error);
      next();
    }
  };
}

/**
 * Cache invalidation middleware for write operations
 * @param {Object} options - Invalidation options
 * @returns {Function} Express middleware
 */
function invalidateSearchCacheMiddleware(options = {}) {
  const { pattern = 'search:v2:*' } = options;

  return (req, res, next) => {
    // Only invalidate on write operations
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next();
    }

    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json method to invalidate after response
    res.json = function (data) {
      // Invalidate cache after successful response
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.delPattern(pattern).catch(err => {
          logger.error('Cache invalidation error:', err);
        });
      }

      return originalJson(data);
    };

    next();
  };
}

/**
 * Get cache statistics for monitoring
 * @returns {Promise<Object>} Cache statistics
 */
function getCacheStats() {
  try {
    const stats = cache.getStats
      ? cache.getStats()
      : {
          hits: 0,
          misses: 0,
          sets: 0,
          deletes: 0,
          errors: 0,
        };

    // Calculate hit rate
    const totalRequests = stats.hits + stats.misses;
    const hitRate = totalRequests > 0 ? (stats.hits / totalRequests) * 100 : 0;

    return {
      ...stats,
      hitRate: Math.round(hitRate * 100) / 100,
      totalRequests,
    };
  } catch (error) {
    logger.error('Error getting cache stats:', error);
    return {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      hitRate: 0,
      totalRequests: 0,
    };
  }
}

/**
 * Clear all search cache
 * @returns {Promise<void>}
 */
async function clearSearchCache() {
  try {
    await cache.delPattern('search:v2:*');
    await cache.delPattern('search:count:*');
    await cache.delPattern('search:popularity:*');
    await cache.delPattern('search:popular:*');
    await cache.delPattern('search:trending:*');
    await cache.delPattern('search:autocomplete:*');
  } catch (error) {
    logger.error('Error clearing search cache:', error);
    throw error;
  }
}

module.exports = {
  searchCacheMiddleware,
  invalidateSearchCacheMiddleware,
  getCacheStats,
  clearSearchCache,
  generateCacheKey,
  CACHE_TTL,
};
