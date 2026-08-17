/**
 * EventFlow Community — email digests
 *
 * The community's notification-preference field
 * (`user.communityNotificationPreferences.email`, one of
 * 'immediate' | 'daily' | 'weekly' | 'none') has been readable and writable
 * via GET/PATCH /api/v1/community/me(/profile) since the preference UI was
 * built, but nothing ever consumed the 'daily'/'weekly' values to actually
 * send anything — every member who opted in was quietly never emailed. This
 * service closes that gap: it sends a digest of new/active discussions to
 * everyone whose preference matches the cadence currently running.
 *
 * 'immediate' and 'none' are not handled here. 'immediate' would need
 * per-event dispatch triggered from the write path (out of scope for a
 * scheduled digest); 'none' means exactly what it says.
 */

'use strict';

const schedule = require('node-schedule');

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const sentry = require('../utils/sentry');
const community = require('./community.service');
const postmark = require('../utils/postmark');
const backgroundJobs = require('./backgroundJobTelemetry.service');
const schedulerLock = require('./schedulerLock.service');

const DEFAULT_DAILY_CRON = '0 8 * * *'; // 08:00 every day
const DEFAULT_WEEKLY_CRON = '0 8 * * 1'; // 08:00 every Monday
const MAX_DISCUSSIONS_IN_DIGEST = 8;

/**
 * Discussions with meaningful activity since `sinceIso`, newest first.
 * @param {string} sinceIso ISO timestamp lower bound (exclusive-ish; >=).
 * @param {Date} now Clock injection for tests.
 * @returns {Promise<Object[]>} Discussion cards, capped at MAX_DISCUSSIONS_IN_DIGEST.
 */
async function buildDigestDiscussions(sinceIso, now) {
  const discussions = await community.loadPublicDiscussions(undefined, now);
  return discussions
    .filter(item => (item.lastActivityAt || item.createdAt) >= sinceIso)
    .sort((a, b) =>
      (b.lastActivityAt || b.createdAt).localeCompare(a.lastActivityAt || a.createdAt)
    )
    .slice(0, MAX_DISCUSSIONS_IN_DIGEST)
    .map(item => community.toDiscussionCard(item, { now }));
}

/**
 * Build the digest HTML/text body shared by every recipient of a given run —
 * personalised only by greeting, not by content, keeping this a genuine
 * "what's new" digest rather than a per-user feed.
 * @param {Object[]} discussionCards From buildDigestDiscussions().
 * @param {string} cadence 'daily' | 'weekly'
 * @param {string} baseUrl Application base URL.
 * @returns {{subject: string, html: string, text: string}} Email body.
 */
function renderDigest(discussionCards, cadence, baseUrl) {
  const period = cadence === 'daily' ? 'today' : 'this week';
  const rows = discussionCards
    .map(
      card => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #E5E7EB;">
            <a href="${baseUrl}${card.url}" style="color:#111827;font-weight:600;text-decoration:none;font-size:15px;">${escapeHtml(card.title)}</a>
            <div style="color:#6B7280;font-size:13px;margin-top:4px;">
              ${escapeHtml(card.category.name || '')} &middot; ${card.replyCount} ${card.replyCount === 1 ? 'reply' : 'replies'}
            </div>
          </td>
        </tr>`
    )
    .join('');

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">
      <h1 style="font-size:20px;color:#111827;">What's new in the EventFlow community</h1>
      <p style="color:#4B5563;font-size:14px;">The most active discussions from ${period}.</p>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <p style="margin-top:24px;">
        <a href="${baseUrl}/community" style="display:inline-block;padding:10px 20px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Browse the community &rarr;</a>
      </p>
      <p style="color:#9CA3AF;font-size:12px;margin-top:32px;">
        You're receiving this because your community notification preference is set to "${cadence}".
        <a href="${baseUrl}/community/member" style="color:#9CA3AF;">Manage your preferences</a>.
      </p>
    </div>`;

  const text = [
    `What's new in the EventFlow community — the most active discussions from ${period}.`,
    '',
    ...discussionCards.map(card => `- ${card.title} (${baseUrl}${card.url})`),
    '',
    `Browse the community: ${baseUrl}/community`,
  ].join('\n');

  return {
    subject: `${discussionCards.length} new ${discussionCards.length === 1 ? 'discussion' : 'discussions'} in the EventFlow community`,
    html,
    text,
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Send a digest run for one cadence to every opted-in, verified member.
 * @param {Object} [options]
 * @param {string} options.cadence 'daily' | 'weekly'
 * @param {Object} [options.db] Database handle.
 * @param {Object} [options.log] Logger.
 * @param {Date} [options.now] Clock injection.
 * @param {Function} [options.sendMail] Injectable for tests (defaults to utils/postmark.sendMail).
 * @returns {Promise<{sent: number, recipients: number, discussionsIncluded: number, skipped: boolean}>}
 */
async function sendCommunityDigests({
  cadence,
  db = dbUnified,
  log = logger,
  now = new Date(),
  sendMail = postmark.sendMail,
} = {}) {
  if (cadence !== 'daily' && cadence !== 'weekly') {
    throw new Error(`Unknown digest cadence: ${cadence}`);
  }

  const windowMs = cadence === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const sinceIso = new Date(now.getTime() - windowMs).toISOString();

  const discussionCards = await buildDigestDiscussions(sinceIso, now);
  if (discussionCards.length === 0) {
    return { sent: 0, recipients: 0, discussionsIncluded: 0, skipped: true };
  }

  const users = await db.read('users');
  const recipients = (users || []).filter(
    user =>
      user &&
      user.verified &&
      user.email &&
      user.communityNotificationPreferences &&
      user.communityNotificationPreferences.email === cadence
  );

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
  const { subject, html, text } = renderDigest(discussionCards, cadence, baseUrl);

  let sent = 0;
  for (const user of recipients) {
    try {
      await sendMail({
        to: user.email,
        from: postmark.FROM_INFO,
        subject,
        html,
        text,
        messageStream: 'broadcasts',
        tags: ['community-digest', cadence],
      });
      sent += 1;
    } catch (error) {
      log.error(
        `[community-digest] Failed to send ${cadence} digest to ${user.id}:`,
        error.message
      );
    }
  }

  log.info(
    `[community-digest] Sent ${sent}/${recipients.length} ${cadence} digest(s), ${discussionCards.length} discussion(s) included`
  );

  return {
    sent,
    recipients: recipients.length,
    discussionsIncluded: discussionCards.length,
    skipped: false,
  };
}

/**
 * Register the daily and weekly digest cron jobs.
 * @param {Object} [options] Dependencies, mirroring the other schedulers in this codebase.
 * @returns {{scheduled: boolean, dailyCron: string|null, weeklyCron: string|null}} Schedule result.
 */
function scheduleCommunityDigest({ db = dbUnified, log = logger, scheduleModule = schedule } = {}) {
  const enabledValue = process.env.COMMUNITY_DIGEST_ENABLED;
  const enabled =
    enabledValue === undefined
      ? process.env.NODE_ENV === 'production'
      : enabledValue !== 'false' && enabledValue !== '0';

  if (!enabled) {
    log.info('[community-digest] Scheduler disabled');
    return { scheduled: false, dailyCron: null, weeklyCron: null };
  }

  const dailyCron = process.env.COMMUNITY_DIGEST_DAILY_CRON || DEFAULT_DAILY_CRON;
  const weeklyCron = process.env.COMMUNITY_DIGEST_WEEKLY_CRON || DEFAULT_WEEKLY_CRON;

  const runCadenceTracked = (cadence, trigger = 'scheduler') =>
    schedulerLock.withLock(`${backgroundJobs.JOB_KEYS.COMMUNITY_DIGEST}:${cadence}`, async () => {
      const startedAt = new Date();
      try {
        const result = await sendCommunityDigests({ cadence, db, log });
        await backgroundJobs.recordRun(
          {
            jobKey: backgroundJobs.JOB_KEYS.COMMUNITY_DIGEST,
            status: result.skipped ? 'skipped' : 'success',
            trigger,
            startedAt,
            finishedAt: new Date(),
            metrics: { cadence, sent: result.sent, recipients: result.recipients },
          },
          { db, log }
        );
      } catch (error) {
        log.error(`[community-digest] Scheduled ${cadence} run failed:`, error.message);
        sentry.captureException(error, {
          tags: { scheduledJob: backgroundJobs.JOB_KEYS.COMMUNITY_DIGEST, cadence },
        });
        await backgroundJobs.recordRun(
          {
            jobKey: backgroundJobs.JOB_KEYS.COMMUNITY_DIGEST,
            status: 'failed',
            trigger,
            startedAt,
            finishedAt: new Date(),
            error: error.message,
          },
          { db, log }
        );
      }
    });

  // Pinned explicitly rather than relying on the container's default timezone.
  const dailyJob = scheduleModule.scheduleJob({ rule: dailyCron, tz: 'Etc/UTC' }, () =>
    runCadenceTracked('daily')
  );
  const weeklyJob = scheduleModule.scheduleJob({ rule: weeklyCron, tz: 'Etc/UTC' }, () =>
    runCadenceTracked('weekly')
  );

  if (!dailyJob || !weeklyJob) {
    log.error('[community-digest] Invalid cron expression(s)', { dailyCron, weeklyCron });
    return { scheduled: false, dailyCron, weeklyCron };
  }

  // Deliberately no missed-run catch-up here, unlike the other schedulers in
  // this codebase: sendCommunityDigests() selects discussions active within a
  // fixed lookback window ending "now" (see buildDigestDiscussions/sinceIso
  // above), not "since this member's last digest". A catch-up run and the
  // next regular tick shortly after would have heavily overlapping windows,
  // so members would receive the same discussions twice — a real duplicate
  // email, not just a wasted computation. Fixing that would mean tracking a
  // genuine last-sent-per-member watermark, which is out of scope here.
  log.info(`[community-digest] Scheduled: daily="${dailyCron}", weekly="${weeklyCron}"`);
  return { scheduled: true, dailyCron, weeklyCron };
}

/**
 * Schedule the jobs and report the outcome in the same startup-banner style
 * `server.js` uses for its other schedulers.
 * @param {Object} [options] Forwarded to `scheduleCommunityDigest`.
 * @returns {{scheduled: boolean, dailyCron: string|null, weeklyCron: string|null}} Schedule result.
 */
function logSchedulerStartup(options = {}) {
  const log = options.log || logger;
  log.info('');
  log.info('💬 Initializing Community Digest Scheduler...');
  const result = scheduleCommunityDigest(options);

  if (result.scheduled) {
    log.info('   ✅ Community digest scheduled');
    log.info(`   ✅ Daily cron: ${result.dailyCron}`);
    log.info(`   ✅ Weekly cron: ${result.weeklyCron}`);
  } else {
    log.info('   ℹ️  Community digest scheduler disabled');
    log.info('   Set COMMUNITY_DIGEST_ENABLED=true to enable');
  }

  return result;
}

module.exports = {
  DEFAULT_DAILY_CRON,
  DEFAULT_WEEKLY_CRON,
  MAX_DISCUSSIONS_IN_DIGEST,
  buildDigestDiscussions,
  renderDigest,
  sendCommunityDigests,
  scheduleCommunityDigest,
  logSchedulerStartup,
};
