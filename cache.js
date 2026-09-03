/**
 * Redis Cache Management Utility
 * Provides caching functionality with Redis
 * Falls back to in-memory cache if Redis is not available
 */

'use strict';
const logger = require('./utils/logger');

let redis = null;
let redisClient = null;
let cacheEnabled = false;
let cacheType = 'none';

// In-memory fallback cache
const memoryCache = new Map();
const cacheExpiry = new Map();

// Cache statistics
let cacheStats = {
  hits: 0,
  misses: 0,
  sets: 0,
  deletes: 0,
  errors: 0,
};

/**
 * Initialize Redis connection
 * Falls back to in-memory cache if Redis is not available
 */
async function initializeCache() {
  if (cacheEnabled) {
    return cacheType;
  }

  // Try to load Redis
  try {
    const redisUrl = process.env.REDIS_URL || process.env.REDIS_URI;

    if (!redisUrl) {
      logger.info('ℹ️  No Redis configuration found, using in-memory cache');
      cacheType = 'memory';
      cacheEnabled = true;
      return cacheType;
    }

    // Try to load ioredis
    try {
      // eslint-disable-next-line global-require, node/no-missing-require
      redis = require('ioredis');
    } catch (err) {
      // Try redis package as fallback
      // eslint-disable-next-line global-require, node/no-missing-require
      redis = require('redis');
    }

    // Initialize Redis client
    if (redis.createClient) {
      // Using redis package
      redisClient = redis.createClient({ url: redisUrl });
      await redisClient.connect();
      redisClient.on('error', err => {
        logger.error('Redis error:', err);
        cacheStats.errors++;
      });
    } else {
      // Using ioredis package
      redisClient = new redis(redisUrl);
      redisClient.on('error', err => {
        logger.error('Redis error:', err);
        cacheStats.errors++;
      });
    }

    cacheType = 'redis';
    cacheEnabled = true;
    logger.info('✅ Redis cache initialized');
    return cacheType;
  } catch (error) {
    logger.info('⚠️  Redis not available, using in-memory cache:', error.message);
    cacheType = 'memory';
    cacheEnabled = true;
    return cacheType;
  }
}

/**
 * Get value from cache
 * @param {string} key - Cache key
 * @returns {Promise<any>} Cached value or null
 */
async function get(key) {
  await initializeCache();

  try {
    if (cacheType === 'redis' && redisClient) {
      const value = await redisClient.get(key);
      if (value) {
        cacheStats.hits++;
        return JSON.parse(value);
      }
      cacheStats.misses++;
      return null;
    }

    // In-memory cache
    const expiry = cacheExpiry.get(key);
    if (expiry && expiry < Date.now()) {
      memoryCache.delete(key);
      cacheExpiry.delete(key);
      cacheStats.misses++;
      return null;
    }

    const value = memoryCache.get(key);
    if (value !== undefined) {
      cacheStats.hits++;
      return value;
    }

    cacheStats.misses++;
    return null;
  } catch (error) {
    logger.error('Cache get error:', error);
    cacheStats.errors++;
    return null;
  }
}

/**
 * Set value in cache
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttl - Time to live in seconds (default: 300)
 * @returns {Promise<boolean>} Success status
 */
async function set(key, value, ttl = 300) {
  await initializeCache();

  try {
    cacheStats.sets++;

    if (cacheType === 'redis' && redisClient) {
      await redisClient.setex(key, ttl, JSON.stringify(value));
      return true;
    }

    // In-memory cache
    memoryCache.set(key, value);
    cacheExpiry.set(key, Date.now() + ttl * 1000);
    return true;
  } catch (error) {
    logger.error('Cache set error:', error);
    cacheStats.errors++;
    return false;
  }
}

/**
 * Delete value from cache
 * @param {string} key - Cache key
 * @returns {Promise<boolean>} Success status
 */
async function del(key) {
  await initializeCache();

  try {
    cacheStats.deletes++;

    if (cacheType === 'redis' && redisClient) {
      await redisClient.del(key);
      return true;
    }

    // In-memory cache
    memoryCache.delete(key);
    cacheExpiry.delete(key);
    return true;
  } catch (error) {
    logger.error('Cache delete error:', error);
    cacheStats.errors++;
    return false;
  }
}

/**
 * Delete all keys matching a pattern
 * @param {string} pattern - Pattern to match (e.g., 'user:*')
 * @returns {Promise<number>} Number of keys deleted
 */
async function delPattern(pattern) {
  await initializeCache();

  try {
    if (cacheType === 'redis' && redisClient) {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
      return keys.length;
    }

    // In-memory cache
    let count = 0;
    const regex = new RegExp(`^${pattern.replace('*', '.*')}$`);
    for (const key of memoryCache.keys()) {
      if (regex.test(key)) {
        memoryCache.delete(key);
        cacheExpiry.delete(key);
        count++;
      }
    }
    return count;
  } catch (error) {
    logger.error('Cache delete pattern error:', error);
    cacheStats.errors++;
    return 0;
  }
}

/**
 * Clear all cache
 * @returns {Promise<boolean>} Success status
 */
async function clear() {
  await initializeCache();

  try {
    if (cacheType === 'redis' && redisClient) {
      await redisClient.flushdb();
      return true;
    }

    // In-memory cache
    memoryCache.clear();
    cacheExpiry.clear();
    return true;
  } catch (error) {
    logger.error('Cache clear error:', error);
    cacheStats.errors++;
    return false;
  }
}

/**
 * Get cache statistics
 * @returns {Object} Cache statistics
 */
function getStats() {
  const hitRate =
    cacheStats.hits + cacheStats.misses > 0
      ? ((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100).toFixed(2)
      : 0;

  return {
    ...cacheStats,
    hitRate: `${hitRate}%`,
    type: cacheType,
    enabled: cacheEnabled,
  };
}

/**
 * Reset cache statistics
 */
function resetStats() {
  cacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
  };
}

/**
 * Close Redis connection
 */
async function close() {
  if (redisClient) {
    try {
      if (redisClient.quit) {
        await redisClient.quit();
      } else if (redisClient.disconnect) {
        await redisClient.disconnect();
      }
    } catch (error) {
      logger.error('Cache close error:', error);
    }
  }
}

/**
 * Cache warming utility - preload critical data
 * @param {Object} data - Data to warm cache with
 * @param {number} ttl - Time to live in seconds
 * @returns {Promise<number>} Number of keys cached
 */
async function warmCache(data, ttl = 3600) {
  let count = 0;
  for (const [key, value] of Object.entries(data)) {
    const success = await set(key, value, ttl);
    if (success) {
      count++;
    }
  }
  return count;
}

/**
 * Generate ETag for response data
 * @param {any} data - Data to generate ETag for
 * @returns {string} ETag string
 */
function generateETag(data) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return `"${hash}"`;
}

module.exports = {
  initializeCache,
  get,
  set,
  del,
  delPattern,
  clear,
  getStats,
  resetStats,
  close,
  warmCache,
  generateETag,
};
