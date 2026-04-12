/**
 * Action Prompt Scheduler
 * Schedules automated action-prompt reminder emails for supplier users.
 *
 * Reads the cron expression and enable flag from settings (DB-backed) at runtime,
 * so admin changes take effect on the next scheduled execution without restart.
 * A periodic poll every CRON_POLL_INTERVAL_MS detects cron changes in the DB and
 * reschedules the job without a server restart.
 *
 * Environment variables:
 *   ACTION_PROMPTS_CRON         — override cron expression (default: '0 9 * * *')
 *   ACTION_PROMPTS_ENABLED      — set to 'false'/'0' to disable outside production
 *   ACTION_PROMPTS_MAX_SEND_PER_RUN — hard cap on emails sent per run (default: 500 in prod, 50 in dev)
 *   ACTION_PROMPTS_UNSUBSCRIBE_TTL_DAYS — token expiry in days (default: 30)
 */

'use strict';

const schedule = require('node-schedule');
const crypto = require('crypto');
const {
  getSupplierActionItems,
  evaluateCadence,
  updateCadenceState,
} = require('./actionPromptService');
const postmark = require('../utils/postmark');
const logger = require('../utils/logger');
const dbUnified = require('../db-unified');

const DEFAULT_CRON = '0 9 * * *'; // 09:00 every day
const CRON_POLL_INTERVAL_MS = 5 * 60 * 1000; // Check for DB cron changes every 5 minutes

// In-memory lock to prevent overlapping runs
let _running = false;

// Track the currently active scheduled job and its cron expression
let _activeJob = null;
let _activeCronExpr = null;

// ── RAG colour palette ──────────────────────────────────────────────────────

const RAG = {
  red: {
    bgColor: '#FEF2F2',
    borderColor: '#DC2626',
    textColor: '#991B1B',
    badgeBg: '#DC2626',
    badgeText: '#FFFFFF',
    label: 'CRITICAL',
    statusLabel: 'Action Required',
    statusSubtitle: 'Important items need your attention before customers can find you.',
    progressColor: '#DC2626',
  },
  amber: {
    bgColor: '#FFFBEB',
    borderColor: '#D97706',
    textColor: '#92400E',
    badgeBg: '#D97706',
    badgeText: '#FFFFFF',
    label: 'IMPORTANT',
    statusLabel: 'Quick Wins Available',
    statusSubtitle: 'A few improvements will help your profile stand out to event planners.',
    progressColor: '#D97706',
  },
  green: {
    bgColor: '#ECFDF5',
    borderColor: '#059669',
    textColor: '#065F46',
    badgeBg: '#059669',
    badgeText: '#FFFFFF',
    label: 'COMPLETE',
    statusLabel: 'All Complete!',
    statusSubtitle: 'Your profile is looking great. Keep it up!',
    progressColor: '#059669',
  },
};

// ── HTML builder helpers ────────────────────────────────────────────────────

/**
 * Build the full RAG-rated HTML section for the email.
 * Includes: status banner with progress bar, outstanding items (red/amber),
 * completed items (green), and a platform promo block.
 *
 * @param {{ outstanding: Array, completed: Array, ragStatus: string, completionPercent: number }} report
 * @param {string} baseUrl
 * @returns {string} HTML string
 */
function buildRagHtml(report, baseUrl) {
  const { outstanding, completed, ragStatus, completionPercent } = report;
  const rag = RAG[ragStatus] || RAG.amber;

  const itemCount = outstanding.length;
  const completedCount = completed.length;
  const totalCount = itemCount + completedCount;
  const progressPct = Math.max(0, Math.min(100, completionPercent));
  const remainPct = 100 - progressPct;

  // ── Status banner with progress bar ────────────────────────────────────
  const progressBarHtml =
    remainPct > 0
      ? `<td width="${progressPct}%" height="10" style="height:10px;background-color:${rag.progressColor};font-size:0;line-height:0;">&nbsp;</td>` +
        `<td width="${remainPct}%" height="10" style="height:10px;font-size:0;line-height:0;">&nbsp;</td>`
      : `<td width="100%" height="10" style="height:10px;background-color:${rag.progressColor};font-size:0;line-height:0;">&nbsp;</td>`;

  let html = `
  <!-- STATUS BANNER -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
    <tr>
      <td style="background-color:${rag.bgColor};border:2px solid ${rag.borderColor};border-radius:14px;padding:0;overflow:hidden;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:22px 24px 14px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:top;">
                    <p style="margin:0 0 4px;font-size:18px;font-weight:800;color:${rag.textColor};letter-spacing:-0.3px;">${rag.statusLabel}</p>
                    <p style="margin:0 0 12px;font-size:13px;color:${rag.textColor};opacity:0.85;line-height:1.5;">${rag.statusSubtitle}</p>
                    <p style="margin:0;font-size:13px;color:${rag.textColor};font-weight:600;">
                      <strong>${completedCount}</strong> of <strong>${totalCount}</strong> items complete &nbsp;·&nbsp; <strong>${progressPct}%</strong> done
                    </p>
                  </td>
                  <td width="56" style="vertical-align:top;padding-left:16px;text-align:right;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:52px;height:52px;background-color:${rag.borderColor};border-radius:50%;text-align:center;vertical-align:middle;font-size:22px;line-height:52px;color:#ffffff;font-weight:700;">${progressPct}%</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 16px 24px;">
              <!-- Progress bar -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E5E7EB;border-radius:99px;overflow:hidden;line-height:0;font-size:0;">
                <tr>${progressBarHtml}</tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  `;

  // ── Outstanding items ───────────────────────────────────────────────────
  if (outstanding.length > 0) {
    // Sort: red items first, then amber
    const sorted = [
      ...outstanding.filter(a => a.severity === 'red'),
      ...outstanding.filter(a => a.severity !== 'red'),
    ];

    html += `
  <!-- OUTSTANDING ACTIONS HEADER -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;">
    <tr>
      <td>
        <p style="margin:0;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#6B7280;">&#9888; Needs Your Attention</p>
      </td>
    </tr>
  </table>`;

    for (const action of sorted) {
      const isRed = action.severity === 'red';
      const itemRag = isRed ? RAG.red : RAG.amber;

      html += `
  <!-- ACTION ITEM: ${action.key} -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
    <tr>
      <td style="background-color:${itemRag.bgColor};border-left:5px solid ${itemRag.borderColor};border-radius:0 12px 12px 0;padding:18px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <!-- Severity badge -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;">
                <tr>
                  <td style="background-color:${itemRag.badgeBg};color:${itemRag.badgeText};font-size:10px;font-weight:800;letter-spacing:1px;padding:3px 10px;border-radius:4px;">${itemRag.label}</td>
                </tr>
              </table>
              <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#0B1220;letter-spacing:-0.2px;">${action.title}</p>
              <p style="margin:0 0 14px;font-size:13px;color:#475569;line-height:1.65;">${action.description}</p>
              <a href="${action.ctaUrl}" style="display:inline-block;padding:9px 20px;background-color:${itemRag.borderColor};color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:700;letter-spacing:0.2px;">${action.ctaText || 'Take Action'} &#8594;</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
    }
  }

  // ── Completed items ─────────────────────────────────────────────────────
  if (completed.length > 0) {
    html += `
  <!-- COMPLETED ITEMS HEADER -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;margin-bottom:10px;">
    <tr>
      <td>
        <p style="margin:0;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#6B7280;">&#10003; Completed</p>
      </td>
    </tr>
  </table>`;

    for (const item of completed) {
      html += `
  <!-- COMPLETED ITEM: ${item.key} -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
    <tr>
      <td style="background-color:#F0FDF4;border-left:5px solid #10B981;border-radius:0 10px 10px 0;padding:12px 16px;">
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:middle;padding-right:10px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:22px;height:22px;background-color:#10B981;border-radius:50%;text-align:center;vertical-align:middle;color:#ffffff;font-size:13px;font-weight:900;line-height:22px;">&#10003;</td>
                </tr>
              </table>
            </td>
            <td style="vertical-align:middle;">
              <p style="margin:0;font-size:13px;font-weight:600;color:#065F46;">${item.title}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
    }
  }

  // ── Platform promo block ────────────────────────────────────────────────
  html += `
  <!-- PROMO BLOCK -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;margin-bottom:8px;">
    <tr>
      <td style="background:linear-gradient(135deg,#0B8073 0%,#0d9488 55%,#13B6A2 100%);border-radius:14px;padding:22px 24px;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.75);">&#128161; Did you know?</p>
        <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#ffffff;line-height:1.5;">Suppliers with complete profiles and active packages receive up to <span style="text-decoration:underline;">3&times; more enquiries</span> on EventFlow.</p>
        <p style="margin:0 0 18px;font-size:13px;color:rgba(255,255,255,0.88);line-height:1.6;">Every detail counts &mdash; from your description to your photos. Event planners compare profiles before reaching out, so make yours unmissable.</p>
        <a href="${baseUrl}" style="display:inline-block;padding:10px 22px;background-color:rgba(255,255,255,0.18);border:1.5px solid rgba(255,255,255,0.55);color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:700;letter-spacing:0.2px;">Explore EventFlow &#8594;</a>
      </td>
    </tr>
  </table>`;

  return html;
}

// ── Token generation ────────────────────────────────────────────────────────

/**
 * Resolve the HMAC secret for unsubscribe tokens.
 * In production, requires UNSUBSCRIBE_SECRET or JWT_SECRET to be set.
 * Returns null when no secret is available (caller must handle gracefully).
 * @returns {string|null}
 */
function resolveUnsubscribeSecret() {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn(
        '[ActionPrompts] UNSUBSCRIBE_SECRET / JWT_SECRET not set — unsubscribe links disabled in production'
      );
      return null;
    }
    // Development only: use a deterministic fallback (never in production)
    return 'dev-fallback-secret';
  }
  return secret;
}

/**
 * Generate an HMAC-based unsubscribe token for a user.
 * Token includes iat (issued-at) and exp (expiry) for revocation support.
 * Returns null when no secret is configured in production.
 *
 * @param {string} userId
 * @param {string} email
 * @returns {string|null}
 */
function generateActionPromptUnsubscribeToken(userId, email) {
  const secret = resolveUnsubscribeSecret();
  if (!secret) {
    return null;
  }
  const ttlDays = Number(process.env.ACTION_PROMPTS_UNSUBSCRIBE_TTL_DAYS) || 30;
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      userId,
      email: email.toLowerCase(),
      purpose: 'actionPrompts',
      iat: now,
      exp: now + ttlDays * 24 * 60 * 60,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

// ── Email sender ────────────────────────────────────────────────────────────

/**
 * Determine a contextual email subject from the report.
 * @param {{ ragStatus: string }} report
 * @param {number} sendCount - how many emails have been sent so far (0 = first email)
 * @returns {string}
 */
function getEmailSubject(report, sendCount) {
  if (sendCount === 0) {
    return 'A quick note on your EventFlow supplier profile';
  }
  if (report.ragStatus === 'red') {
    return '\u26a0\ufe0f Action required on your EventFlow supplier profile';
  }
  return '\ud83d\udca1 Here\u2019s how to get more from EventFlow';
}

/**
 * Send an action-prompt email to a single supplier user.
 *
 * @param {Object} user     - User document
 * @param {Object} report   - { outstanding, completed, ragStatus, completionPercent }
 * @param {string} baseUrl  - Application base URL
 * @param {boolean} dryRun  - If true, log but do not send
 */
async function sendActionPromptEmail(user, report, baseUrl, dryRun) {
  const unsubscribeToken = generateActionPromptUnsubscribeToken(user.id, user.email);
  const unsubscribeUrl = unsubscribeToken
    ? `${baseUrl}/email/action-prompts/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`
    : null;
  const managePrefsUrl = `${baseUrl}/settings`;
  const loginUrl = `${baseUrl}/dashboard/supplier`;
  const actionsHtml = buildRagHtml(report, baseUrl);

  // Total emails sent across all cadence stages
  const state = user.actionPromptState;
  const totalSendCount =
    (state?.sendCountDaily ?? 0) + (state?.sendCountWeekly ?? 0) + (state?.sendCountMonthly ?? 0);
  const subject = getEmailSubject(report, totalSendCount);

  if (dryRun) {
    logger.info(
      `[ActionPrompts] DRY RUN — would email ${user.email} (${report.outstanding.length} action(s)): ${report.outstanding.map(a => a.key).join(', ')}`
    );
    return;
  }

  const templateData = {
    name: user.firstName || user.name || 'there',
    actionsHtml,
    loginUrl,
    managePrefsUrl,
    unsubscribeSection: unsubscribeUrl
      ? `&nbsp;&middot;&nbsp;<a href="${unsubscribeUrl}" style="color:#94A3B8;text-decoration:none;">Unsubscribe from reminders</a>`
      : '',
  };

  await postmark.sendMail({
    to: user.email,
    subject,
    template: 'action-prompts',
    templateData,
    from: postmark.FROM_NOREPLY,
    messageStream: 'outbound',
    tags: ['action_prompt'],
  });

  logger.info(
    `[ActionPrompts] Sent to ${user.email} — cadence: ${state?.cadence ?? 'daily'}, status: ${report.ragStatus}, actions: ${report.outstanding.map(a => a.key).join(', ')}`
  );
}

// ── Main run / schedule ─────────────────────────────────────────────────────

/**
 * Run action-prompt emails for all eligible suppliers.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false] - Log actions without sending
 * @param {number}  [opts.limit]        - Override max send cap for this run
 * @returns {Promise<Object>} Summary stats
 */
async function runActionPrompts({ dryRun = false, limit } = {}) {
  if (_running) {
    logger.warn('[ActionPrompts] Previous run still in progress — skipping');
    return { skipped: true, reason: 'already-running' };
  }

  _running = true;
  const startedAt = new Date();
  const isProduction = process.env.NODE_ENV === 'production';
  const defaultCap = isProduction ? 500 : 50;
  const maxSendPerRun =
    limit ?? (Number(process.env.ACTION_PROMPTS_MAX_SEND_PER_RUN) || defaultCap);

  logger.info(
    `[ActionPrompts] Run started at ${startedAt.toISOString()} (dryRun=${dryRun}, maxSendPerRun=${maxSendPerRun})`
  );

  let scanned = 0;
  let sent = 0;
  let skippedCadence = 0;
  let cappedByLimit = false;
  let errors = 0;
  const sampleRecipients = [];

  try {
    const items = await getSupplierActionItems();
    scanned = items.length;

    const now = new Date();
    const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';

    for (const { user, report } of items) {
      // Hard cap to prevent bulk sends
      if (sent >= maxSendPerRun) {
        cappedByLimit = true;
        logger.warn(
          `[ActionPrompts] Reached max send cap (${maxSendPerRun}) — stopping run. Remaining users will be processed next run.`
        );
        break;
      }

      try {
        const { shouldSend, nextState } = evaluateCadence(user.actionPromptState, now);

        if (!shouldSend) {
          skippedCadence++;
          logger.debug(
            `[ActionPrompts] Skipping ${user.email} — cadence: ${user.actionPromptState?.cadence ?? 'daily'}, next send at ${user.actionPromptState?.nextSendAt || nextState.nextSendAt}`
          );
          // Persist initial state if this is the first detection
          if (!user.actionPromptState && !dryRun) {
            await updateCadenceState(user.id, nextState);
          }
          continue;
        }

        if (sampleRecipients.length < 5) {
          sampleRecipients.push({ email: user.email, actions: report.outstanding.map(a => a.key) });
        }

        await sendActionPromptEmail(user, report, baseUrl, dryRun);

        if (!dryRun) {
          await updateCadenceState(user.id, nextState);
        }

        sent++;
      } catch (err) {
        errors++;
        logger.error(`[ActionPrompts] Error processing user ${user.id}:`, err.message);
      }
    }
  } finally {
    _running = false;
  }

  const finishedAt = new Date();
  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    dryRun,
    scanned,
    sent,
    skippedCadence,
    cappedByLimit,
    errors,
    sampleRecipients,
  };

  logger.info(
    `[ActionPrompts] Run complete: scanned=${scanned}, sent=${sent}, skippedCadence=${skippedCadence}, errors=${errors}, cappedByLimit=${cappedByLimit}`
  );

  // Persist lastRun + runHistory to settings so admin UI can display it
  if (!dryRun) {
    try {
      const settings = (await dbUnified.read('settings')) || {};
      settings.emailAutomation = settings.emailAutomation || {};
      settings.emailAutomation.actionPrompts = settings.emailAutomation.actionPrompts || {};
      settings.emailAutomation.actionPrompts.lastRun = summary;

      // Maintain a capped history list (last 20 runs, most-recent first)
      const RUN_HISTORY_MAX = 20;
      const historyEntry = {
        finishedAt: summary.finishedAt,
        startedAt: summary.startedAt,
        durationMs: summary.durationMs,
        dryRun: summary.dryRun,
        scanned: summary.scanned,
        sent: summary.sent,
        skippedCadence: summary.skippedCadence,
        cappedByLimit: summary.cappedByLimit,
        errors: summary.errors,
      };
      const existing = settings.emailAutomation.actionPrompts.runHistory || [];
      settings.emailAutomation.actionPrompts.runHistory = [historyEntry, ...existing].slice(
        0,
        RUN_HISTORY_MAX
      );

      await dbUnified.writeAndVerify('settings', settings);
    } catch (err) {
      logger.warn('[ActionPrompts] Failed to persist lastRun to settings:', err.message);
    }
  }

  return summary;
}

/**
 * Resolve the effective cron expression.
 * env var > DB setting > hard-coded default.
 * @param {Object} [dbSettings] - Loaded settings document (optional)
 * @returns {string}
 */
function resolveActiveCronExpr(dbSettings) {
  if (process.env.ACTION_PROMPTS_CRON) {
    return process.env.ACTION_PROMPTS_CRON;
  }
  const dbCron = dbSettings?.emailAutomation?.actionPrompts?.cron;
  return dbCron || DEFAULT_CRON;
}

/**
 * Reschedule the action-prompt job with a new cron expression.
 * Cancels the existing job first to avoid overlaps.
 * @param {string} newCronExpr
 */
function _rescheduleJob(newCronExpr) {
  if (_activeJob) {
    _activeJob.cancel();
    _activeJob = null;
    logger.info(`[ActionPrompts] Cancelled previous job (was: "${_activeCronExpr}")`);
  }

  const job = schedule.scheduleJob(newCronExpr, async () => {
    try {
      await runActionPrompts();
    } catch (err) {
      logger.error('[ActionPrompts] Scheduled run failed:', err.message);
    }
  });

  if (!job) {
    logger.error(
      `[ActionPrompts] Failed to schedule job — invalid cron expression? "${newCronExpr}"`
    );
    _activeJob = null;
    _activeCronExpr = null;
    return;
  }

  _activeJob = job;
  _activeCronExpr = newCronExpr;
  const nextRun = job.nextInvocation();
  logger.info(
    `[ActionPrompts] Scheduled: cron="${newCronExpr}", nextRun=${nextRun ? nextRun.toISOString() : 'unknown'}`
  );
}

/**
 * Schedule action-prompt emails using node-schedule.
 * Sets up a periodic cron-change poll so admin updates take effect without restart.
 *
 * @returns {{ scheduled: boolean, cronExpr: string|null, nextRun: Date|null }}
 */
function scheduleActionPrompts() {
  const enabledEnv = process.env.ACTION_PROMPTS_ENABLED;
  const isProduction = process.env.NODE_ENV === 'production';
  const enabled =
    enabledEnv !== undefined ? enabledEnv !== 'false' && enabledEnv !== '0' : isProduction;

  if (!enabled) {
    logger.info('[ActionPrompts] Scheduler disabled');
    return { scheduled: false, cronExpr: null, nextRun: null };
  }

  const cronExpr = resolveActiveCronExpr();
  _rescheduleJob(cronExpr);

  if (!_activeJob) {
    return { scheduled: false, cronExpr, nextRun: null };
  }

  // Periodic poll to detect DB cron changes
  setInterval(async () => {
    try {
      const enabledNow =
        process.env.ACTION_PROMPTS_ENABLED !== undefined
          ? process.env.ACTION_PROMPTS_ENABLED !== 'false' &&
            process.env.ACTION_PROMPTS_ENABLED !== '0'
          : process.env.NODE_ENV === 'production';
      if (!enabledNow) {
        return;
      }
      const settings = await dbUnified.read('settings');
      const newCron = resolveActiveCronExpr(settings);
      if (newCron !== _activeCronExpr) {
        logger.info(
          `[ActionPrompts] Cron changed (${_activeCronExpr} → ${newCron}) — rescheduling`
        );
        _rescheduleJob(newCron);
      }
    } catch (err) {
      logger.debug('[ActionPrompts] Cron poll error (non-fatal):', err.message);
    }
  }, CRON_POLL_INTERVAL_MS);

  const nextRun = _activeJob.nextInvocation();
  return { scheduled: true, cronExpr, nextRun };
}

/**
 * Trigger an immediate reschedule after an admin cron update.
 * Called by the admin settings PUT endpoint so changes take effect faster than the poll.
 */
async function notifyCronChanged() {
  try {
    const settings = await dbUnified.read('settings');
    const newCron = resolveActiveCronExpr(settings);
    if (newCron !== _activeCronExpr) {
      logger.info(`[ActionPrompts] Admin triggered reschedule: ${_activeCronExpr} → ${newCron}`);
      _rescheduleJob(newCron);
    }
  } catch (err) {
    logger.warn('[ActionPrompts] notifyCronChanged error (non-fatal):', err.message);
  }
}

module.exports = {
  runActionPrompts,
  scheduleActionPrompts,
  notifyCronChanged,
  generateActionPromptUnsubscribeToken,
  resolveUnsubscribeSecret,
  buildRagHtml,
  getEmailSubject,
};
