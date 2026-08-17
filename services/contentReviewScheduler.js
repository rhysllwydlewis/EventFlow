'use strict';

const schedule = require('node-schedule');
const logger = require('../utils/logger');
const reviewTasks = require('./contentReviewTask.service');
const { runScheduledJob } = require('./scheduledJobRunner');
const { JOB_KEYS } = require('./backgroundJobTelemetry.service');

let scheduledJob = null;

async function run(trigger = 'scheduler') {
  try {
    const result = await reviewTasks.ensureMonthlyTasks();
    let productChanges = null;
    if (result.skipped) {
      productChanges = { skipped: true, reason: 'content review automation disabled' };
    } else {
      try {
        productChanges = await require('./productChangeReview.service').inspectDeploymentChanges();
      } catch (error) {
        logger.warn('[content-review] product-change inspection deferred:', error.message);
        productChanges = { error: error.message };
      }
    }
    logger.info('[content-review] monthly review task check complete', {
      trigger,
      created: result.created.length,
      skipped: result.skipped,
    });
    return { ...result, productChanges };
  } catch (error) {
    logger.error('[content-review] review task check failed:', error);
    return { created: [], error: error.message };
  }
}

// The cron/startup-catch-up path routes through the shared runner so a
// failure is recorded to the telemetry dashboard and reported to Sentry —
// unlike `run()` itself, which stays non-throwing (see above) since
// routes/admin-content-reviews.js's manual "run now" endpoint calls it
// directly and depends on that contract.
function runTracked(trigger) {
  return runScheduledJob(
    JOB_KEYS.CONTENT_REVIEW,
    async () => {
      const result = await run(trigger);
      if (result.error) {
        throw new Error(result.error);
      }
      return {
        created: Array.isArray(result.created) ? result.created.length : 0,
        skipped: Boolean(result.skipped),
      };
    },
    { trigger }
  );
}

function isEnabled() {
  const configured = process.env.CONTENT_REVIEW_ENABLED;
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
    logger.info('[content-review] Scheduler disabled');
    logger.info('   Set CONTENT_REVIEW_ENABLED=true to enable');
    scheduledJob = null;
    return { scheduled: false, nextRun: null };
  }
  // Pinned explicitly rather than relying on the container's default
  // timezone (see the Dockerfile's TZ=UTC comment).
  scheduledJob = schedule.scheduleJob({ rule: '17 8 * * *', tz: 'Etc/UTC' }, () =>
    runTracked('scheduler')
  );
  setImmediate(() => runTracked('startup-catch-up'));
  return { scheduled: Boolean(scheduledJob), nextRun: scheduledJob?.nextInvocation() || null };
}

function stop() {
  if (scheduledJob) {
    scheduledJob.cancel();
  }
  scheduledJob = null;
}

module.exports = { run, runTracked, start, stop };
