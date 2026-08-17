'use strict';

/**
 * Shared node-schedule cron-callback wrapper.
 *
 * Every scheduler in this codebase used to hand-write the same try/catch
 * around its work function: log on failure, record a `background_job_runs`
 * entry either way. That boilerplate never called Sentry, so a scheduled
 * job failing in production surfaced only as a console log line — nobody
 * was paged. This wrapper is the one place that now happens.
 */

const logger = require('../utils/logger');
const sentry = require('../utils/sentry');
const backgroundJobs = require('./backgroundJobTelemetry.service');

/**
 * @param {string} jobKey - one of backgroundJobTelemetry.JOB_KEYS
 * @param {() => Promise<Object>} fn - does the actual work; may resolve
 *   `{ skipped: true, ... }` to report a non-error skip instead of success
 * @param {Object} [options]
 * @param {Object} [options.db] - forwarded to backgroundJobTelemetry.recordRun
 * @param {Object} [options.log] - defaults to utils/logger
 * @param {string} [options.trigger] - forwarded to recordRun (default 'scheduler')
 * @returns {Promise<Object|null>} the work function's result, or null if it threw
 */
async function runScheduledJob(jobKey, fn, options = {}) {
  const { db, log = logger, trigger = 'scheduler' } = options;
  const startedAt = new Date();

  try {
    const result = (await fn()) || {};
    await backgroundJobs.recordRun(
      {
        jobKey,
        status: result.skipped ? 'skipped' : 'success',
        trigger,
        startedAt,
        finishedAt: new Date(),
        metrics: result,
      },
      { db, log }
    );
    return result;
  } catch (error) {
    log.error(`[${jobKey}] Scheduled run failed:`, error.message);
    sentry.captureException(error, { tags: { scheduledJob: jobKey } });
    await backgroundJobs.recordRun(
      {
        jobKey,
        status: 'failed',
        trigger,
        startedAt,
        finishedAt: new Date(),
        error: error.message,
      },
      { db, log }
    );
    return null;
  }
}

/**
 * Runs `fn` once at startup only if the job's last recorded run is older
 * than `expectedIntervalMs` (or there is no recorded run at all) — recovers
 * from a scheduled tick silently missed because the process wasn't running
 * at the time (e.g. a deploy landing near the scheduled hour). node-schedule
 * has no built-in misfire handling, so without this a missed tick is simply
 * gone until the next one.
 *
 * Safe to call unconditionally on every boot: it only actually invokes `fn`
 * when a run genuinely looks overdue, so it won't re-run (and, for the
 * email-sending schedulers, re-notify) on every ordinary restart or deploy.
 *
 * @param {string} jobKey - one of backgroundJobTelemetry.JOB_KEYS
 * @param {() => Promise<Object>} fn - same contract as runScheduledJob's fn
 * @param {Object} options
 * @param {number} options.expectedIntervalMs - the job's normal cron interval
 * @param {Object} [options.db]
 * @param {Object} [options.log]
 * @param {Object} [options.extraFilter] - forwarded to getLatestRun, for
 *   jobs that share one jobKey across multiple cadences (see
 *   backgroundJobTelemetry.service.js getLatestRun())
 * @returns {Promise<Object|null>} runScheduledJob's result, or null if no
 *   catch-up was needed
 */
async function runIfMissed(jobKey, fn, options = {}) {
  const { expectedIntervalMs, db, log = logger, extraFilter } = options;
  const latest = await backgroundJobs.getLatestRun(jobKey, { db, log, extraFilter });
  const latestFinishedAt = latest ? Date.parse(latest.finishedAt || latest.startedAt || '') : NaN;
  const isStale =
    !Number.isFinite(latestFinishedAt) || Date.now() - latestFinishedAt > expectedIntervalMs;

  if (!isStale) {
    return null;
  }

  log.info(`[${jobKey}] No recent run found — running a missed-tick catch-up now`);
  return runScheduledJob(jobKey, fn, { db, log, trigger: 'missed-run-catchup' });
}

module.exports = { runScheduledJob, runIfMissed };
