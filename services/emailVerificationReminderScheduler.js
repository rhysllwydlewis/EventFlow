'use strict';

/**
 * Nudges users who signed up but never verified their email address.
 *
 * Verification email sending itself is already handled at signup and via
 * the user-triggered `POST /api/auth/resend-verification` — this adds the
 * missing proactive side: an unverified account that never comes back to
 * click resend just silently stays unverified forever. Reuses the exact
 * same token-issuing and email-sending path resend-verification uses (see
 * routes/auth.js), so a reminder link behaves identically to a manual
 * resend.
 *
 * Sends at most two reminders per account — one ~3 days after signup, one
 * ~7 days after — then stops regardless of whether the account ever
 * verifies. `userProvenance.canResendVerification()` already excludes
 * OAuth-provisioned accounts (Google/Apple/Facebook — their email is
 * already provider-verified) and admin/owner-created accounts, so this
 * only ever targets genuine email/password signups still mid-funnel.
 */

const schedule = require('node-schedule');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const postmark = require('../utils/postmark');
const tokenUtils = require('../utils/token');
const userProvenance = require('./userProvenance.service');
const { JOB_KEYS } = require('./backgroundJobTelemetry.service');
const schedulerLock = require('./schedulerLock.service');
const { runScheduledJob, runIfMissed } = require('./scheduledJobRunner');

const DEFAULT_CRON = '40 9 * * *'; // 09:40 UTC daily
const EXPECTED_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TOKEN_EXPIRES_HOURS = 24;

// Reminder cadence, measured from account creation: first reminder once the
// account is at least 3 days old, second once at least 7 days old. Capped
// at two total — this is a nudge, not a drip campaign.
const REMINDER_THRESHOLDS_DAYS = [3, 7];
const MAX_REMINDERS = REMINDER_THRESHOLDS_DAYS.length;

let scheduledJob = null;

/**
 * @param {Object} user
 * @param {number} now - Date.now()
 * @returns {boolean}
 */
function isEligibleForReminder(user, now) {
  if (!user || !user.email) {
    return false;
  }
  if (user.verified === true || user.emailVerified === true) {
    return false;
  }
  if (user.emailUnsubscribed) {
    return false;
  }
  if (user.verificationReminderOptOut === true) {
    return false;
  }
  // Excludes OAuth-provisioned accounts (already provider-verified) and
  // admin/owner-created accounts — see services/userProvenance.service.js.
  if (!userProvenance.canResendVerification(user)) {
    return false;
  }

  const createdAtMs = Date.parse(user.createdAt || '');
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }

  const state = user.verificationReminderState || {};
  const remindersSent = Array.isArray(state.remindersSent) ? state.remindersSent : [];
  if (remindersSent.length >= MAX_REMINDERS) {
    return false;
  }

  const thresholdDays = REMINDER_THRESHOLDS_DAYS[remindersSent.length];
  const dueAtMs = createdAtMs + thresholdDays * 24 * 60 * 60 * 1000;
  return now >= dueAtMs;
}

/**
 * Issue a fresh verification token and send the reminder, reusing the exact
 * same send path as a user-triggered resend so the link/email are identical.
 * @param {Object} user
 */
async function sendReminder(user) {
  const verificationToken = tokenUtils.generateVerificationToken(user, {
    expiresInHours: TOKEN_EXPIRES_HOURS,
  });
  const tokenExpiresAt = new Date(Date.now() + TOKEN_EXPIRES_HOURS * 60 * 60 * 1000).toISOString();

  const sendResult = await postmark.sendVerificationEmail(user, verificationToken);

  const state = user.verificationReminderState || {};
  const remindersSent = Array.isArray(state.remindersSent) ? state.remindersSent : [];
  const nowIso = new Date().toISOString();

  await dbUnified.updateOne(
    'users',
    { id: user.id },
    {
      $set: {
        verificationToken,
        verificationTokenExpiresAt: tokenExpiresAt,
        ...userProvenance.metadataFromSendResult(sendResult),
        verificationReminderState: {
          remindersSent: [...remindersSent, nowIso],
          lastSentAt: nowIso,
        },
      },
    }
  );
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.trigger]
 * @returns {Promise<{ scanned: number, eligible: number, sent: number, errors: number }>}
 */
async function runVerificationReminders({ trigger = 'scheduler' } = {}) {
  const users = (await dbUnified.read('users')) || [];
  const now = Date.now();

  let eligible = 0;
  let sent = 0;
  let errors = 0;

  for (const user of users) {
    if (!isEligibleForReminder(user, now)) {
      continue;
    }
    eligible++;
    try {
      await sendReminder(user);
      sent++;
    } catch (err) {
      errors++;
      logger.error(
        `[verification-reminder] Failed to send reminder to user ${user.id}:`,
        err.message
      );
    }
  }

  logger.info(
    `[verification-reminder] Run complete (${trigger}): scanned=${users.length}, eligible=${eligible}, sent=${sent}, errors=${errors}`
  );

  return { scanned: users.length, eligible, sent, errors };
}

function isEnabled() {
  const configured = process.env.EMAIL_VERIFICATION_REMINDER_ENABLED;
  if (configured === undefined) {
    return process.env.NODE_ENV === 'production';
  }
  return configured !== 'false' && configured !== '0';
}

function runTracked(trigger) {
  return runScheduledJob(
    JOB_KEYS.VERIFICATION_REMINDER,
    () => runVerificationReminders({ trigger }),
    {
      trigger,
    }
  );
}

// Eligibility is fully re-derived from each user's createdAt/reminder-state
// on every run, so re-running (or catching up a missed tick) never sends a
// duplicate — a user already reminded today simply falls outside the
// threshold check next time.
function runCatchUpIfMissed() {
  return runIfMissed(
    JOB_KEYS.VERIFICATION_REMINDER,
    () => runVerificationReminders({ trigger: 'missed-run-catchup' }),
    { expectedIntervalMs: EXPECTED_INTERVAL_MS }
  );
}

function start() {
  if (scheduledJob) {
    scheduledJob.cancel();
  }
  if (!isEnabled()) {
    logger.info('[verification-reminder] Scheduler disabled');
    logger.info('   Set EMAIL_VERIFICATION_REMINDER_ENABLED=true to enable');
    scheduledJob = null;
    return { scheduled: false, nextRun: null };
  }

  const cronExpr = process.env.EMAIL_VERIFICATION_REMINDER_CRON || DEFAULT_CRON;
  // Pinned explicitly rather than relying on the container's default timezone.
  scheduledJob = schedule.scheduleJob({ rule: cronExpr, tz: 'Etc/UTC' }, () =>
    schedulerLock.withLock(JOB_KEYS.VERIFICATION_REMINDER, () => runTracked('scheduler'))
  );

  if (!scheduledJob) {
    logger.error('[verification-reminder] Failed to schedule job — invalid cron expression?');
    return { scheduled: false, nextRun: null };
  }

  setImmediate(() => schedulerLock.withLock(JOB_KEYS.VERIFICATION_REMINDER, runCatchUpIfMissed));

  const nextRun = scheduledJob.nextInvocation();
  logger.info(
    `[verification-reminder] Scheduled: cron="${cronExpr}", nextRun=${nextRun ? nextRun.toISOString() : 'unknown'}`
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
  runVerificationReminders,
  runTracked,
  runCatchUpIfMissed,
  isEligibleForReminder,
  start,
  stop,
};
