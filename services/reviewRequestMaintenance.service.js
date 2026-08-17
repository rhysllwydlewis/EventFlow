'use strict';

const crypto = require('crypto');
const schedule = require('node-schedule');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const sentry = require('../utils/sentry');
const backgroundJobs = require('./backgroundJobTelemetry.service');
const schedulerLock = require('./schedulerLock.service');
const { runIfMissed } = require('./scheduledJobRunner');

const COLLECTION = 'reviewRequests';
const DEFAULT_CRON = '15 * * * *';
const EXPECTED_INTERVAL_MS = 60 * 60 * 1000;
const ACTIVE_STATUSES = ['pending', 'sent', 'opened'];

let maintenanceRunning = false;

function normaliseNow(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Review request maintenance requires a valid date');
  }
  return date;
}

async function expireStaleRequests({ db = dbUnified, now = new Date(), log = logger } = {}) {
  if (maintenanceRunning) {
    return { checked: 0, expired: 0, skipped: true };
  }

  maintenanceRunning = true;
  try {
    const currentTime = normaliseNow(now);
    const currentIso = currentTime.toISOString();
    const stale = await db.find(COLLECTION, {
      status: { $in: ACTIVE_STATUSES },
      expiresAt: { $lte: currentIso },
    });

    let expired = 0;
    for (const request of stale || []) {
      const updated = await db.updateOne(
        COLLECTION,
        {
          id: request.id,
          status: request.status,
          expiresAt: request.expiresAt,
        },
        {
          $set: {
            id: `rreq_${crypto.randomUUID()}`,
            status: 'expired',
            expiredAt: currentIso,
            updatedAt: currentIso,
          },
        }
      );
      if (updated) {
        expired += 1;
      }
    }

    if (expired > 0) {
      log.info(`[review-request-maintenance] Expired ${expired} stale review request(s)`);
    }

    return {
      checked: Array.isArray(stale) ? stale.length : 0,
      expired,
      skipped: false,
    };
  } finally {
    maintenanceRunning = false;
  }
}

function scheduleMaintenance({ db = dbUnified, log = logger, scheduleModule = schedule } = {}) {
  const enabledValue = process.env.REVIEW_REQUEST_MAINTENANCE_ENABLED;
  const enabled =
    enabledValue === undefined
      ? process.env.NODE_ENV === 'production'
      : enabledValue !== 'false' && enabledValue !== '0';

  if (!enabled) {
    log.info('[review-request-maintenance] Scheduler disabled');
    return { scheduled: false, cronExpr: null, nextRun: null };
  }

  const cronExpr = process.env.REVIEW_REQUEST_MAINTENANCE_CRON || DEFAULT_CRON;
  // Pinned explicitly rather than relying on the container's default timezone.
  const job = scheduleModule.scheduleJob({ rule: cronExpr, tz: 'Etc/UTC' }, () =>
    schedulerLock.withLock(backgroundJobs.JOB_KEYS.REVIEW_REQUEST_MAINTENANCE, async () => {
      const startedAt = new Date();
      try {
        const result = await expireStaleRequests({ db, log });
        await backgroundJobs.recordRun(
          {
            jobKey: backgroundJobs.JOB_KEYS.REVIEW_REQUEST_MAINTENANCE,
            status: result.skipped ? 'skipped' : 'success',
            startedAt,
            finishedAt: new Date(),
            metrics: result,
          },
          { db, log }
        );
      } catch (error) {
        log.error('[review-request-maintenance] Scheduled expiry failed:', error.message);
        sentry.captureException(error, {
          tags: { scheduledJob: backgroundJobs.JOB_KEYS.REVIEW_REQUEST_MAINTENANCE },
        });
        await backgroundJobs.recordRun(
          {
            jobKey: backgroundJobs.JOB_KEYS.REVIEW_REQUEST_MAINTENANCE,
            status: 'failed',
            startedAt,
            finishedAt: new Date(),
            error: error.message,
          },
          { db, log }
        );
      }
    })
  );

  if (!job) {
    log.error('[review-request-maintenance] Invalid maintenance cron:', cronExpr);
    return { scheduled: false, cronExpr, nextRun: null };
  }

  // Expiry is idempotent (only touches requests still in an active status),
  // so it's safe to catch up on every boot if an hourly tick was missed.
  setImmediate(() =>
    schedulerLock.withLock(backgroundJobs.JOB_KEYS.REVIEW_REQUEST_MAINTENANCE, () =>
      runIfMissed(
        backgroundJobs.JOB_KEYS.REVIEW_REQUEST_MAINTENANCE,
        () => expireStaleRequests({ db, log }),
        { expectedIntervalMs: EXPECTED_INTERVAL_MS, db, log }
      )
    )
  );

  const nextRun = job.nextInvocation();
  log.info(
    `[review-request-maintenance] Scheduled: cron="${cronExpr}", nextRun=${
      nextRun ? nextRun.toISOString() : 'unknown'
    }`
  );
  return { scheduled: true, cronExpr, nextRun };
}

module.exports = {
  ACTIVE_STATUSES,
  COLLECTION,
  DEFAULT_CRON,
  expireStaleRequests,
  normaliseNow,
  scheduleMaintenance,
};
