'use strict';

/**
 * A minimal distributed lock for node-schedule cron callbacks.
 *
 * Every scheduler in this codebase guards against overlap with an
 * in-process flag (or nothing at all) — that does nothing across multiple
 * instances of the `web` service. If it's ever scaled to 2+ replicas, every
 * scheduler fires once per replica: duplicate supplier emails, duplicate
 * digests, duplicate page publishes. Acquiring this lock before running is
 * what makes that safe.
 *
 * Backed by a unique index on `scheduler_locks.id` (see db-unified.js
 * createIndexes()) — a losing concurrent insert fails with a duplicate-key
 * error, so acquisition is atomic regardless of how many processes race for
 * it. A TTL index auto-clears a lock left behind by a process that crashed
 * mid-run. Falls back to an in-process Map when MongoDB isn't configured
 * (local/dev), which is equivalent to the in-process flags this replaces —
 * safe there because local/dev only ever runs one process.
 */

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const COLLECTION = 'scheduler_locks';
const DEFAULT_TTL_MS = 10 * 60 * 1000; // generous relative to any scheduler's actual runtime
const localLocks = new Map();

function lockId(jobKey) {
  return `scheduler:${jobKey}`;
}

function isExpired(lock, now = Date.now()) {
  const expiresAt = Date.parse(lock?.expiresAt || 0);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

async function isMongoBacked() {
  // getDatabaseType() only reports what's already been resolved — without
  // this, a call before anything else has touched the database would read
  // the pre-init 'unknown' value and wrongly fall back to the single-process
  // local lock even when MongoDB is actually configured.
  if (typeof dbUnified.initializeDatabase === 'function') {
    await dbUnified.initializeDatabase();
  }
  return (
    typeof dbUnified.getDatabaseType === 'function' && dbUnified.getDatabaseType() === 'mongodb'
  );
}

/**
 * Attempt to acquire the named lock.
 * @param {string} jobKey
 * @param {number} [ttlMs]
 * @returns {Promise<(() => Promise<void>)|null>} a release function if
 *   acquired, or null if another process already holds the lock
 */
async function acquireLock(jobKey, ttlMs = DEFAULT_TTL_MS) {
  const id = lockId(jobKey);
  const now = Date.now();
  const expiresAtDate = new Date(now + Math.max(30000, ttlMs));

  if (!(await isMongoBacked())) {
    const existing = localLocks.get(id);
    if (existing && !isExpired(existing, now)) {
      return null;
    }
    localLocks.set(id, { expiresAt: expiresAtDate.toISOString() });
    return () => {
      localLocks.delete(id);
    };
  }

  // Stored as a real BSON Date, not an ISO string — the TTL index on
  // `expiresAt` (see db-unified.js createIndexes()) only expires documents
  // whose field is a Date. An ISO string would never be reaped by Mongo,
  // so a lock left behind by a crashed process would permanently block
  // every future acquisition for that jobKey via the unique `id` index.
  const inserted = await dbUnified.insertOne(COLLECTION, {
    id,
    jobKey,
    acquiredAt: new Date(now),
    expiresAt: expiresAtDate,
  });
  if (!inserted) {
    // Either the unique-index insert lost the race, or another process
    // already holds an unexpired lock — either way, we don't have it.
    return null;
  }

  return async () => {
    const released = await dbUnified.deleteOne(COLLECTION, { id });
    if (!released) {
      logger.warn(`[scheduler-lock] Release for ${jobKey} found nothing to delete`);
    }
  };
}

/**
 * Runs `fn` only if the named lock can be acquired; otherwise logs and
 * returns `{ skipped: true, reason: 'locked' }` without calling `fn`.
 * Always releases the lock afterwards, including if `fn` throws.
 * @param {string} jobKey
 * @param {() => Promise<Object>} fn
 * @param {number} [ttlMs]
 */
async function withLock(jobKey, fn, ttlMs = DEFAULT_TTL_MS) {
  const release = await acquireLock(jobKey, ttlMs);
  if (!release) {
    logger.info(`[scheduler-lock] ${jobKey} is already running elsewhere — skipping this tick`);
    return { skipped: true, reason: 'locked' };
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}

module.exports = { acquireLock, withLock };
