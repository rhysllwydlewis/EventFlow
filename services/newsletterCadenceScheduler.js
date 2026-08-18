'use strict';

/**
 * Automated recurring newsletter send.
 *
 * Newsletter/campaign sending (routes/admin-campaigns.js) was previously
 * 100% admin-triggered — nothing sends unless an admin remembers to click
 * "Send" each time, unlike services/communityDigest.service.js which is
 * fully automated. This adds a genuinely automated cadence for it, while
 * keeping content admin-curated (auto-generating marketing copy is out of
 * scope and risky) via a single admin-configured recurring template stored
 * at settings.newsletterAutomation.
 *
 * Runs daily; only actually sends when `enabled`, content is configured,
 * and today matches the configured cadence (weekly day-of-week or monthly
 * day-of-month) and hasn't already sent today.
 */

const schedule = require('node-schedule');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { EMAIL_ENABLED } = require('../config/email');
const { JOB_KEYS } = require('./backgroundJobTelemetry.service');
const schedulerLock = require('./schedulerLock.service');
const { runScheduledJob, runIfMissed } = require('./scheduledJobRunner');

const DEFAULT_CRON = '30 8 * * *'; // 08:30 UTC daily — checks whether today is due
const EXPECTED_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TEMPLATE_NAME = 'marketing';

let scheduledJob = null;

function dateKeyUtc(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function daysInUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * @param {Object} config - settings.newsletterAutomation
 * @param {Date} now
 * @returns {boolean}
 */
function isDueToday(config, now) {
  if (!config || config.enabled !== true) {
    return false;
  }
  if (!config.subject || !config.bodyHtml) {
    return false;
  }
  if (config.lastSentDateKey === dateKeyUtc(now)) {
    return false;
  }

  if (config.cadence === 'weekly') {
    const dayOfWeek = Number(config.dayOfWeek);
    return Number.isInteger(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek <= 6
      ? now.getUTCDay() === dayOfWeek
      : false;
  }

  if (config.cadence === 'monthly') {
    const dayOfMonth = Number(config.dayOfMonth);
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      return false;
    }
    // Clamp to the last real day of shorter months (e.g. day 31 fires on
    // the 30th in a 30-day month) rather than silently never firing.
    const effectiveDay = Math.min(
      dayOfMonth,
      daysInUtcMonth(now.getUTCFullYear(), now.getUTCMonth())
    );
    return now.getUTCDate() === effectiveDay;
  }

  return false;
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.trigger]
 * @returns {Promise<{ skipped: boolean, reason?: string, sent?: number, failed?: number, total?: number }>}
 */
async function runNewsletterCadence({ trigger = 'scheduler' } = {}) {
  const settings = (await dbUnified.read('settings')) || {};
  const config = settings.newsletterAutomation || {};
  const now = new Date();

  if (!isDueToday(config, now)) {
    return { skipped: true, reason: 'not-due' };
  }

  // sendCampaign() itself doesn't check this — routes/admin-campaigns.js's
  // manual /send endpoint enforces it as a route-level guard, which this
  // scheduler bypasses entirely by calling sendCampaign() directly. Without
  // this check, an operator setting EMAIL_ENABLED=false (the default) to
  // hold all app email would still have the recurring newsletter go out.
  // Deliberately not folded into isDueToday(): today should still count as
  // "due" once EMAIL_ENABLED is back on, so this must not touch
  // lastSentDateKey.
  if (!EMAIL_ENABLED) {
    logger.info('[newsletter-cadence] Due today but EMAIL_ENABLED is false — skipping send');
    return { skipped: true, reason: 'email-disabled' };
  }

  // Lazy require to avoid a route module being pulled in at service-startup
  // time before its own dependencies are ready.
  const { sendCampaign } = require('../routes/admin-campaigns');

  const { sent, failed, total } = await sendCampaign({
    audience: config.audience || 'both',
    subject: config.subject,
    templateName: DEFAULT_TEMPLATE_NAME,
    title: config.title,
    bodyHtml: config.bodyHtml,
    ctaText: config.ctaText,
    ctaUrl: config.ctaUrl,
  });

  settings.newsletterAutomation = {
    ...config,
    lastSentAt: now.toISOString(),
    lastSentDateKey: dateKeyUtc(now),
    lastRunStats: { sent, failed, total, trigger },
  };
  await dbUnified.writeAndVerify('settings', settings);

  logger.info(
    `[newsletter-cadence] Sent recurring newsletter (${trigger}): sent=${sent}, failed=${failed}, total=${total}`
  );

  return { skipped: false, sent, failed, total };
}

function isEnabled() {
  const configured = process.env.NEWSLETTER_CADENCE_ENABLED;
  if (configured === undefined) {
    return process.env.NODE_ENV === 'production';
  }
  return configured !== 'false' && configured !== '0';
}

function runTracked(trigger) {
  return runScheduledJob(JOB_KEYS.NEWSLETTER_CADENCE, () => runNewsletterCadence({ trigger }), {
    trigger,
  });
}

// isDueToday()'s lastSentDateKey check makes this idempotent per calendar
// day, so a missed-tick catch-up can never double-send the same day's
// scheduled newsletter.
function runCatchUpIfMissed() {
  return runIfMissed(
    JOB_KEYS.NEWSLETTER_CADENCE,
    () => runNewsletterCadence({ trigger: 'missed-run-catchup' }),
    { expectedIntervalMs: EXPECTED_INTERVAL_MS }
  );
}

function start() {
  if (scheduledJob) {
    scheduledJob.cancel();
  }
  if (!isEnabled()) {
    logger.info('[newsletter-cadence] Scheduler disabled');
    logger.info('   Set NEWSLETTER_CADENCE_ENABLED=true to enable');
    scheduledJob = null;
    return { scheduled: false, nextRun: null };
  }

  const cronExpr = process.env.NEWSLETTER_CADENCE_CRON || DEFAULT_CRON;
  // Pinned explicitly rather than relying on the container's default timezone.
  scheduledJob = schedule.scheduleJob({ rule: cronExpr, tz: 'Etc/UTC' }, () =>
    schedulerLock.withLock(JOB_KEYS.NEWSLETTER_CADENCE, () => runTracked('scheduler'))
  );

  if (!scheduledJob) {
    logger.error('[newsletter-cadence] Failed to schedule job — invalid cron expression?');
    return { scheduled: false, nextRun: null };
  }

  setImmediate(() => schedulerLock.withLock(JOB_KEYS.NEWSLETTER_CADENCE, runCatchUpIfMissed));

  const nextRun = scheduledJob.nextInvocation();
  logger.info(
    `[newsletter-cadence] Scheduled: cron="${cronExpr}", nextRun=${nextRun ? nextRun.toISOString() : 'unknown'}`
  );
  return { scheduled: true, nextRun };
}

function stop() {
  if (scheduledJob) {
    scheduledJob.cancel();
  }
  scheduledJob = null;
}

module.exports = {
  runNewsletterCadence,
  runTracked,
  runCatchUpIfMissed,
  isDueToday,
  start,
  stop,
};
