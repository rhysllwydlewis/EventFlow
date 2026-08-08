'use strict';

const schedule = require('node-schedule');
const mongoDb = require('../db');
const logger = require('../utils/logger');
const NotificationService = require('./notification.service');

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

function start() {
  if (scheduledJob) {
    scheduledJob.cancel();
  }
  // Daily at 03:20 — off-peak, away from other scheduled jobs.
  scheduledJob = schedule.scheduleJob('20 3 * * *', () => run('scheduler'));
  return { scheduled: Boolean(scheduledJob), nextRun: scheduledJob?.nextInvocation() || null };
}

function stop() {
  if (scheduledJob) {
    scheduledJob.cancel();
  }
  scheduledJob = null;
}

module.exports = { run, start, stop };
