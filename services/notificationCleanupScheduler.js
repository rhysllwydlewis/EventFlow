'use strict';

const schedule = require('node-schedule');
const mongoDb = require('../db');
const logger = require('../utils/logger');
const NotificationService = require('./notification.service');
const { runScheduledJob, runIfMissed } = require('./scheduledJobRunner');
const { JOB_KEYS } = require('./backgroundJobTelemetry.service');
const schedulerLock = require('./schedulerLock.service');

const EXPECTED_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CRON = '20 3 * * *'; // 03:20 UTC — off-peak, away from other scheduled jobs.

let scheduledJob = null;

async function run(trigger = 'scheduler') {
  try {
    const db = await mongoDb.getDb();
    if (!db) {
      return { deleted: 0, skipped: true, reason: 'Database not connected' };
    }
    const svc = new NotificationService(db, null);
    const expiredDeleted = await svc.cleanupExpired();
    const staleDeleted = await svc.cleanupStale();
    const deleted = expiredDeleted + staleDeleted;
    logger.info('[notification-cleanup] stale notifications purged', {
      trigger,
      expiredDeleted,
      staleDeleted,
    });
    return { deleted, expiredDeleted, staleDeleted, skipped: false };
  } catch (error) {
    logger.error('[notification-cleanup] cleanup run failed:', error);
    return { deleted: 0, error: error.message };
  }
}

// `run()` itself stays non-throwing (tests in
// notification-cleanup-scheduler.test.js depend on it) — this converts its
// error-object contract into a thrown exception so the shared runner can
// record it as a failed run and report it to Sentry.
async function runOrThrow(trigger) {
  const result = await run(trigger);
  if (result.error) {
    throw new Error(result.error);
  }
  return result;
}

function runTracked(trigger) {
  return runScheduledJob(JOB_KEYS.NOTIFICATION_CLEANUP, () => runOrThrow(trigger), { trigger });
}

// Cleanup is idempotent (deletes rows already past their expiry), so a
// missed nightly tick just means slightly more to purge next time — safe to
// catch up on every boot without any risk of duplicate side effects.
function runCatchUpIfMissed() {
  return runIfMissed(JOB_KEYS.NOTIFICATION_CLEANUP, () => runOrThrow('missed-run-catchup'), {
    expectedIntervalMs: EXPECTED_INTERVAL_MS,
  });
}

function isEnabled() {
  const configured = process.env.NOTIFICATION_CLEANUP_ENABLED;
  if (configured === undefined) {
    return process.env.NODE_ENV === 'production';
  }
  return configured !== 'false' && configured !== '0';
}

function start() {
  if (scheduledJob) {
    scheduledJob.cancel();
  }
  if (!isEnabled()) {
    logger.info('[notification-cleanup] Scheduler disabled');
    logger.info('   Set NOTIFICATION_CLEANUP_ENABLED=true to enable');
    scheduledJob = null;
    return { scheduled: false, nextRun: null };
  }
  // Pinned explicitly rather than relying on the container's default
  // timezone. `NOTIFICATION_CLEANUP_CRON` overrides the default — this must
  // stay in sync with the schedule backgroundJobTelemetry.service.js
  // advertises on the dashboard.
  const cronExpr = process.env.NOTIFICATION_CLEANUP_CRON || DEFAULT_CRON;
  scheduledJob = schedule.scheduleJob({ rule: cronExpr, tz: 'Etc/UTC' }, () =>
    schedulerLock.withLock(JOB_KEYS.NOTIFICATION_CLEANUP, () => runTracked('scheduler'))
  );
  setImmediate(() =>
    schedulerLock.withLock(JOB_KEYS.NOTIFICATION_CLEANUP, () => runCatchUpIfMissed())
  );
  return { scheduled: Boolean(scheduledJob), nextRun: scheduledJob?.nextInvocation() || null };
}

function stop() {
  if (scheduledJob) {
    scheduledJob.cancel();
  }
  scheduledJob = null;
}

module.exports = { run, runTracked, runCatchUpIfMissed, start, stop };
