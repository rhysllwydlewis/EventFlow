'use strict';

const schedule = require('node-schedule');
const logger = require('../utils/logger');
const reviewTasks = require('./contentReviewTask.service');

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

function start() {
  if (scheduledJob) {
    scheduledJob.cancel();
  }
  scheduledJob = schedule.scheduleJob('17 8 * * *', () => run('scheduler'));
  setImmediate(() => run('startup-catch-up'));
  return { scheduled: Boolean(scheduledJob), nextRun: scheduledJob?.nextInvocation() || null };
}

function stop() {
  if (scheduledJob) {
    scheduledJob.cancel();
  }
  scheduledJob = null;
}

module.exports = { run, start, stop };
