/**
 * Retention of supplier profile-view events.
 *
 * A `profile_view` event (utils/supplierAnalytics.js trackProfileView, written by the
 * /api/analytics/track beacon) holds a supplier id, a time, and a keyed-hash visitor key or the
 * signed-in visitor's user id. It used to be kept forever. It now carries an `expiresAt` date, and
 * a TTL index on `events.expiresAt` (db-unified.js createSupplierEventIndexes) removes it then.
 *
 * Why 400 days: the longest history any dashboard can show is 365 days (Professional Plus,
 * `analyticsWindowDays: 365` in models/Subscription.js; the analytics routes cap a request at
 * 365). A window of N days is today plus the N-1 whole UTC days before it, so its oldest event
 * is under 365 days and 24 hours old. 400 days leaves a month of margin over that, so a clock
 * difference, a late-arriving write or a short delay in the database's TTL sweep can never remove
 * an event the dashboard still shows, while the events do not outlive any use the product has for
 * them. Whatever this number is, public/privacy.html (section 2.10 and the section 6 table) states
 * it: change both together.
 *
 * `stampMissingExpiry` gives the same expiry to the events written before this existed.
 */

'use strict';

const logger = require('./logger');
const dbUnified = require('../db-unified');

/** Days a profile-view event is kept. Keep in step with public/privacy.html. */
const PROFILE_VIEW_RETENTION_DAYS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;

const EVENT_TYPE = 'profile_view';
const MARKER_COLLECTION = 'maintenance_markers';
const MARKER_ID = 'profile_view_expiry_backfill';

/** A finished backfill is repeated after this long, to catch rows an older server wrote meanwhile. */
const RECHECK_AFTER_MS = 7 * DAY_MS;

/**
 * When a profile-view event written at `fromMs` expires.
 *
 * @param {number} [fromMs] - Time the event was written (epoch milliseconds); defaults to now
 * @returns {Date} Expiry time
 */
function profileViewExpiry(fromMs = Date.now()) {
  return new Date(fromMs + PROFILE_VIEW_RETENTION_DAYS * DAY_MS);
}

/**
 * Expiry for an existing event, from its stored timestamp. Every event of one UTC day gets the same
 * value (the end of that day plus the retention period), which lets a batch be stamped with one
 * update per day instead of one per event, and is never earlier than the event's own timestamp plus
 * the retention period. An unreadable timestamp is treated as written now, so such a row still ends.
 *
 * @param {Object} event - Stored event
 * @param {number} nowMs - Current time (epoch milliseconds)
 * @returns {Date} Expiry time
 */
function expiryForStoredEvent(event, nowMs) {
  const writtenMs = Date.parse(event?.timestamp);
  const baseMs = Number.isFinite(writtenMs) ? writtenMs : nowMs;
  const endOfDayMs = Math.floor(baseMs / DAY_MS) * DAY_MS + DAY_MS;
  return profileViewExpiry(endOfDayMs);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Give every profile-view event that has no `expiresAt` one. Safe to run any number of times and
 * from several servers at once: it only ever sets a missing field, and a row another run already
 * stamped no longer matches. It reads and writes in small batches (a read of `batchSize` rows, then
 * one update per UTC day in the batch) with a pause between them, walking the collection in `_id`
 * order so the cost is one pass, not one pass per batch.
 *
 * @param {Object} [options] - Options
 * @param {number} [options.batchSize=500] - Events read per batch
 * @param {number} [options.pauseMs=100] - Pause between batches, to leave the database room
 * @param {number} [options.maxBatches=Infinity] - Stop after this many batches
 * @param {number} [options.nowMs] - Current time (for tests)
 * @returns {Promise<{scanned: number, stamped: number, batches: number, stalled: boolean}>} Totals;
 *   `stalled` is true when a batch could not be written (the run stops rather than loop)
 */
async function stampMissingExpiry(options = {}) {
  const batchSize = Math.max(1, Math.floor(options.batchSize || 500));
  const pauseMs = Number.isFinite(options.pauseMs) ? options.pauseMs : 100;
  const maxBatches = options.maxBatches || Infinity;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();

  const totals = { scanned: 0, stamped: 0, batches: 0, stalled: false };
  let lastId = null;

  while (totals.batches < maxBatches) {
    const filter = { type: EVENT_TYPE, expiresAt: { $exists: false } };
    if (lastId !== null) {
      filter._id = { $gt: lastId };
    }
    const batch = await dbUnified.findWithOptions('events', filter, {
      limit: batchSize,
      sort: { _id: 1 },
      throwOnError: true,
    });
    if (!batch || batch.length === 0) {
      break;
    }
    totals.batches += 1;
    totals.scanned += batch.length;

    // MongoDB rows carry _id (indexed, and the cursor); the local store only has `id`.
    const idField = batch[0]._id !== undefined ? '_id' : 'id';
    const byExpiry = new Map();
    for (const event of batch) {
      const expiresAt = expiryForStoredEvent(event, nowMs);
      const key = expiresAt.getTime();
      if (!byExpiry.has(key)) {
        byExpiry.set(key, { expiresAt, ids: [] });
      }
      byExpiry.get(key).ids.push(event[idField]);
    }

    let stampedInBatch = 0;
    for (const { expiresAt, ids } of byExpiry.values()) {
      stampedInBatch += await dbUnified.updateMany(
        'events',
        { type: EVENT_TYPE, [idField]: { $in: ids }, expiresAt: { $exists: false } },
        { $set: { expiresAt } }
      );
    }
    totals.stamped += stampedInBatch;

    if (stampedInBatch === 0) {
      // Rows were found but none could be written (updateMany reports a failure as 0): stop
      // instead of reading the same rows again for ever.
      totals.stalled = true;
      break;
    }
    if (idField === '_id') {
      lastId = batch[batch.length - 1]._id;
    }
    if (batch.length < batchSize) {
      break;
    }
    if (pauseMs > 0) {
      await sleep(pauseMs);
    }
  }
  return totals;
}

/**
 * Start-up entry point: run the backfill in the background, once in a while, and say so in the log.
 *
 * - Runs when it has never completed, or last completed more than 7 days ago (the repeat is what
 *   catches rows written by an older server during a rolling deploy). Between those it costs one
 *   small read.
 * - `PROFILE_VIEW_RETENTION_BACKFILL=off` switches it off; `=force` ignores the completion record.
 * - It never throws: a failure is logged and the next start-up tries again.
 *
 * @param {Object} [options] - Options passed to stampMissingExpiry, plus `env` and `nowMs` for tests
 * @returns {Promise<{ran: boolean, reason?: string, totals?: Object}>} What happened
 */
async function runProfileViewExpiryBackfill(options = {}) {
  const env = options.env || process.env;
  const mode = String(env.PROFILE_VIEW_RETENTION_BACKFILL || '')
    .trim()
    .toLowerCase();
  if (mode === 'off') {
    return { ran: false, reason: 'disabled' };
  }
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  try {
    if (mode !== 'force') {
      const marker = await dbUnified.findOne(MARKER_COLLECTION, { id: MARKER_ID });
      const doneMs = marker ? Date.parse(marker.completedAt) : NaN;
      if (Number.isFinite(doneMs) && nowMs - doneMs < RECHECK_AFTER_MS) {
        return { ran: false, reason: 'recently-completed' };
      }
    }
    logger.info('Profile-view retention: stamping an expiry on older profile-view events...');
    const totals = await stampMissingExpiry(options);
    if (totals.stalled) {
      logger.warn(
        `Profile-view retention: stopped early after stamping ${totals.stamped} of ${totals.scanned} events seen; it will retry at the next start-up`
      );
    } else {
      await dbUnified.upsertOne(
        MARKER_COLLECTION,
        { id: MARKER_ID },
        { completedAt: new Date(nowMs).toISOString(), stamped: totals.stamped }
      );
      logger.info(
        `Profile-view retention: done, ${totals.stamped} older profile-view events now expire ${PROFILE_VIEW_RETENTION_DAYS} days after they were written`
      );
    }
    return { ran: true, totals };
  } catch (error) {
    logger.warn('Profile-view retention backfill failed (non-fatal):', error.message);
    return { ran: false, reason: 'error' };
  }
}

/**
 * Start the backfill in the background once the server is up. Never runs under the test suite, and
 * a failure is logged, never thrown.
 *
 * @returns {void}
 */
function startProfileViewExpiryBackfill() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  setImmediate(() => {
    runProfileViewExpiryBackfill().catch(error => {
      logger.warn('Profile-view retention backfill failed (non-fatal):', error);
    });
  });
}

module.exports = {
  startProfileViewExpiryBackfill,
  PROFILE_VIEW_RETENTION_DAYS,
  RECHECK_AFTER_MS,
  MARKER_COLLECTION,
  MARKER_ID,
  profileViewExpiry,
  expiryForStoredEvent,
  stampMissingExpiry,
  runProfileViewExpiryBackfill,
};
