/**
 * Spam Detection Service
 * Detects and prevents spam messages
 */

'use strict';

const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Rate limiter cache
 * Key: userId, Value: { count, resetAt }
 *
 * NOTE: This is an in-memory store and does NOT work correctly in clustered/multi-process
 * environments. Each process maintains its own independent counters, so rate limits can
 * be exceeded across processes.
 * Used as fallback when Redis is not available.
 */
const rateLimitCache = new Map();

/**
 * Recent messages cache for duplicate detection
 * Key: userId, Value: [{ content, timestamp }]
 *
 * NOTE: Same in-memory clustering limitation as rateLimitCache above.
 * Used as fallback when Redis is not available.
 */
const recentMessagesCache = new Map();

// Redis client — lazily initialised; null if Redis is unavailable
let redisClient = null;
let redisInitialised = false;

/**
 * Attempt to initialise a Redis client using ioredis.
 * Falls back gracefully to null if ioredis is not installed or REDIS_URL is not set.
 */
function initRedis() {
  if (redisInitialised) {
    return;
  }
  redisInitialised = true;

  const redisUrl = process.env.REDIS_URL || process.env.REDIS_URI;
  if (!redisUrl) {
    return;
  }

  try {
    // eslint-disable-next-line global-require, node/no-missing-require
    const Redis = require('ioredis');
    redisClient = new Redis(redisUrl, { lazyConnect: true, enableOfflineQueue: false });
    redisClient.on('error', err => {
      logger.warn('SpamDetection: Redis error, falling back to in-memory:', err.message);
      redisClient = null;
    });
  } catch (_e) {
    // ioredis not available; silently use in-memory fallback
  }
}

/**
 * Get spam keywords from environment
 */
function getSpamKeywords() {
  const keywords = process.env.SPAM_KEYWORDS || '';
  return keywords
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Check if user is rate limited
 * @param {string} userId - User ID
 * @param {number} maxPerMinute - Maximum messages per minute
 * @returns {Promise<Object>} { limited: boolean, retryAfter: number }
 */
async function checkRateLimit(userId, maxPerMinute = 30) {
  initRedis();

  // Redis-backed atomic rate limiting (INCR + EXPIRE)
  if (redisClient) {
    try {
      const key = `spam:rate:${userId}`;
      const count = await redisClient.incr(key);
      if (count === 1) {
        await redisClient.expire(key, 60);
      }
      if (count > maxPerMinute) {
        const ttl = await redisClient.ttl(key);
        return { limited: true, retryAfter: ttl > 0 ? ttl : 60 };
      }
      return { limited: false, retryAfter: 0 };
    } catch (err) {
      logger.warn('SpamDetection: Redis rate-limit check failed, using in-memory:', err.message);
      // Fall through to in-memory
    }
  }

  // In-memory fallback
  const now = Date.now();
  const cache = rateLimitCache.get(userId);

  if (!cache) {
    rateLimitCache.set(userId, {
      count: 1,
      resetAt: now + 60000, // 1 minute
    });
    return { limited: false, retryAfter: 0 };
  }

  // Reset if window expired
  if (now >= cache.resetAt) {
    rateLimitCache.set(userId, {
      count: 1,
      resetAt: now + 60000,
    });
    return { limited: false, retryAfter: 0 };
  }

  // Increment count
  cache.count++;

  if (cache.count > maxPerMinute) {
    const retryAfter = Math.ceil((cache.resetAt - now) / 1000);
    return { limited: true, retryAfter };
  }

  return { limited: false, retryAfter: 0 };
}

/**
 * Check for duplicate messages
 * @param {string} userId - User ID
 * @param {string} content - Message content
 * @param {number} windowSeconds - Detection window in seconds
 * @returns {Promise<boolean>} True if duplicate detected
 */
async function checkDuplicate(userId, content, windowSeconds = 5) {
  initRedis();
  const normalized = content.trim().toLowerCase();

  // Redis-backed duplicate detection using a hash of content with TTL
  if (redisClient) {
    try {
      // Use a per-user set of content hashes with TTL
      const key = `spam:dup:${userId}`;
      // Store content hash to bound key size
      const contentHash = crypto.createHash('sha256').update(normalized).digest('hex');

      // Check if this content hash was recently sent
      const exists = await redisClient.hexists(key, contentHash);

      // Record this message and set expiry
      await redisClient.hset(key, contentHash, Date.now().toString());
      await redisClient.expire(key, windowSeconds * 10); // Keep window with buffer

      return exists === 1;
    } catch (err) {
      logger.warn('SpamDetection: Redis duplicate check failed, using in-memory:', err.message);
      // Fall through to in-memory
    }
  }

  // In-memory fallback
  const now = Date.now();

  let recent = recentMessagesCache.get(userId);
  if (!recent) {
    recent = [];
    recentMessagesCache.set(userId, recent);
  }

  // Clean expired entries
  const cutoff = now - windowSeconds * 1000;
  const filtered = recent.filter(msg => msg.timestamp > cutoff);

  // Check for duplicate
  const isDuplicate = filtered.some(msg => msg.content === normalized);

  // Add current message
  filtered.push({ content: normalized, timestamp: now });

  // Keep only last 10 messages
  if (filtered.length > 10) {
    filtered.shift();
  }

  recentMessagesCache.set(userId, filtered);

  return isDuplicate;
}

/**
 * Count URLs in message
 * @param {string} content - Message content
 * @returns {number} Number of URLs
 */
function countUrls(content) {
  if (!content || typeof content !== 'string') {
    return 0;
  }

  const urlRegex = /https?:\/\/[^\s<>"]+/gi;
  const matches = content.match(urlRegex);
  return matches ? matches.length : 0;
}

/**
 * Check for spam keywords
 * @param {string} content - Message content
 * @returns {Array<string>} Detected spam keywords
 */
function detectSpamKeywords(content) {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const keywords = getSpamKeywords();
  const normalized = content.toLowerCase();
  const detected = [];

  for (const keyword of keywords) {
    if (normalized.includes(keyword)) {
      detected.push(keyword);
    }
  }

  return detected;
}

/**
 * Check if message is spam
 * @param {string} userId - User ID
 * @param {string} content - Message content
 * @param {Object} options - Detection options
 * @returns {Promise<Object>} { isSpam: boolean, reason: string, score: number }
 */
async function checkSpam(userId, content, options = {}) {
  const {
    maxUrlCount = 5,
    maxPerMinute = 30,
    checkDuplicates = true,
    checkKeywords = true,
  } = options;

  let score = 0;
  const reasons = [];

  // Rate limit check
  const rateLimit = await checkRateLimit(userId, maxPerMinute);
  if (rateLimit.limited) {
    score += 100;
    reasons.push(`Rate limit exceeded (${maxPerMinute} messages/minute)`);
  }

  // Duplicate check
  if (checkDuplicates && (await checkDuplicate(userId, content))) {
    score += 50;
    reasons.push('Duplicate message detected');
  }

  // URL spam check
  const urlCount = countUrls(content);
  if (urlCount > maxUrlCount) {
    score += 30 * (urlCount - maxUrlCount);
    reasons.push(`Excessive URLs (${urlCount})`);
  }

  // Keyword check
  if (checkKeywords) {
    const spamKeywords = detectSpamKeywords(content);
    if (spamKeywords.length > 0) {
      score += 20 * spamKeywords.length;
      reasons.push(`Spam keywords: ${spamKeywords.join(', ')}`);
    }
  }

  // Spam threshold
  const isSpam = score >= 50;

  return {
    isSpam,
    score,
    reason: reasons.join('; '),
    details: {
      rateLimit: rateLimit.limited ? rateLimit : null,
      urlCount,
      spamKeywords: checkKeywords ? detectSpamKeywords(content) : null,
    },
  };
}

/**
 * Clean up expired cache entries
 * Should be called periodically
 */
function cleanupCache() {
  const now = Date.now();

  // Clean rate limit cache
  for (const [userId, cache] of rateLimitCache.entries()) {
    if (now >= cache.resetAt) {
      rateLimitCache.delete(userId);
    }
  }

  // Clean recent messages cache
  for (const [userId, recent] of recentMessagesCache.entries()) {
    const filtered = recent.filter(msg => now - msg.timestamp < 60000); // Keep 1 minute
    if (filtered.length === 0) {
      recentMessagesCache.delete(userId);
    } else {
      recentMessagesCache.set(userId, filtered);
    }
  }
}

// Cleanup every 5 minutes
const cleanupInterval = setInterval(cleanupCache, 5 * 60 * 1000);

// Prevent this housekeeping timer from keeping Node.js/Jest processes alive.
if (typeof cleanupInterval.unref === 'function') {
  cleanupInterval.unref();
}

module.exports = {
  checkRateLimit,
  checkDuplicate,
  countUrls,
  detectSpamKeywords,
  checkSpam,
  cleanupCache,
};
