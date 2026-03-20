/**
 * Catalog Cache Service
 *
 * Provides a thin, purpose-built cache layer for the JadeAssist Catalog API.
 * It wraps the shared `cache.js` (Redis-backed with in-memory fallback) and
 * adds:
 *
 *   - A single configurable TTL (`CATALOG_CACHE_TTL_SECONDS`, default 300 s)
 *   - Namespaced keys (`catalog:*`) so all catalog entries can be mass-purged
 *   - `invalidate()` — call this whenever a supplier is created, updated,
 *     approved, rejected, or suspended so JadeAssist always sees fresh data
 *   - `startRefreshTimer()` — optional background interval that pre-warms
 *     the cache at the configured TTL cadence (safe to skip in test/edge
 *     environments; the routes work without it via lazy population)
 *
 * Usage:
 *   const catalogCache = require('./services/catalogCache');
 *
 *   // Serve from cache (or populate on miss):
 *   let data = await catalogCache.get('suppliers:all');
 *   if (!data) {
 *     data = await fetchFromDB();
 *     await catalogCache.set('suppliers:all', data);
 *   }
 *
 *   // Invalidate after a supplier change:
 *   await catalogCache.invalidate();
 */

'use strict';

const cache = require('../cache');
const logger = require('../utils/logger');

// ─── Config ──────────────────────────────────────────────────────────────────

/** All catalog cache keys are prefixed with this namespace. */
const KEY_PREFIX = 'catalog:';

/**
 * Time-to-live in seconds for catalog cache entries.
 * Override via `CATALOG_CACHE_TTL_SECONDS` env var.
 * Default: 300 (5 minutes).
 */
const TTL_SECONDS = (() => {
  const raw = parseInt(process.env.CATALOG_CACHE_TTL_SECONDS, 10);
  return !isNaN(raw) && raw > 0 ? raw : 300;
})();

// ─── Internals ────────────────────────────────────────────────────────────────

/** Whether the background refresh timer is currently running. */
let _refreshTimerHandle = null;

/** Optional callback registered by `startRefreshTimer` to refresh data. */
let _refreshCallback = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve a cached catalog value by key.
 *
 * @param {string} key - Short key (without prefix), e.g. `'suppliers:all'`.
 * @returns {Promise<any|null>} Cached value, or `null` on miss / error.
 */
async function get(key) {
  try {
    return await cache.get(`${KEY_PREFIX}${key}`);
  } catch (err) {
    logger.warn('[catalogCache] get error:', err.message);
    return null;
  }
}

/**
 * Store a value in the catalog cache.
 *
 * @param {string} key   - Short key (without prefix).
 * @param {any}    value - Serialisable value to store.
 * @returns {Promise<void>}
 */
async function set(key, value) {
  try {
    await cache.set(`${KEY_PREFIX}${key}`, value, TTL_SECONDS);
  } catch (err) {
    logger.warn('[catalogCache] set error:', err.message);
  }
}

/**
 * Invalidate all catalog cache entries.
 *
 * This is the primary hook called after any supplier state change
 * (approve, reject, suspend, profile edit, new supplier registration).
 * Subsequent requests will repopulate the cache from the database.
 *
 * @returns {Promise<void>}
 */
async function invalidate() {
  try {
    await cache.delPattern(`${KEY_PREFIX}*`);
    logger.info('[catalogCache] Cache invalidated');
  } catch (err) {
    // Never let a cache error break the caller's response path
    logger.warn('[catalogCache] invalidate error (non-fatal):', err.message);
  }
}

/**
 * Return the configured TTL in seconds (read-only).
 *
 * @returns {number}
 */
function getTtl() {
  return TTL_SECONDS;
}

/**
 * Start a background timer that calls `refreshFn` at `TTL_SECONDS` cadence.
 * The timer keeps the catalog warm so the first request after each cycle
 * still benefits from a cache hit.
 *
 * Safe to call multiple times — subsequent calls are no-ops if already running.
 *
 * @param {Function} refreshFn - Async function that re-populates the cache.
 *   It should call `get()` / `set()` internally and is invoked with no args.
 * @returns {void}
 */
function startRefreshTimer(refreshFn) {
  if (_refreshTimerHandle) {
    return; // Already running
  }

  if (typeof refreshFn !== 'function') {
    logger.warn('[catalogCache] startRefreshTimer: refreshFn must be a function');
    return;
  }

  _refreshCallback = refreshFn;
  _refreshTimerHandle = setInterval(async () => {
    try {
      logger.info('[catalogCache] Background refresh started');
      await _refreshCallback();
      logger.info('[catalogCache] Background refresh complete');
    } catch (err) {
      logger.warn('[catalogCache] Background refresh error:', err.message);
    }
  }, TTL_SECONDS * 1000);

  // Prevent the timer from keeping the process alive in test environments
  if (_refreshTimerHandle.unref) {
    _refreshTimerHandle.unref();
  }

  logger.info(`[catalogCache] Refresh timer started (every ${TTL_SECONDS}s)`);
}

/**
 * Stop the background refresh timer.
 * Useful in tests or when the server is shutting down.
 *
 * @returns {void}
 */
function stopRefreshTimer() {
  if (_refreshTimerHandle) {
    clearInterval(_refreshTimerHandle);
    _refreshTimerHandle = null;
    _refreshCallback = null;
    logger.info('[catalogCache] Refresh timer stopped');
  }
}

module.exports = {
  get,
  set,
  invalidate,
  getTtl,
  startRefreshTimer,
  stopRefreshTimer,
  KEY_PREFIX,
  TTL_SECONDS,
};
