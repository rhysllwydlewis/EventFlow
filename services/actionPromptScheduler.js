/**
 * Action Prompt Scheduler
 * Schedules automated action-prompt reminder emails for supplier users.
 *
 * Reads the cron expression and enable flag from settings (DB-backed) at runtime,
 * so admin changes take effect on the next scheduled execution without restart.
 *
 * Environment variables:
 *   ACTION_PROMPTS_CRON  — override cron expression (default: '0 9 * * *')
 *   ACTION_PROMPTS_ENABLED — set to 'false'/'0' to disable outside production
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

const DEFAULT_CRON = '0 9 * * *'; // 09:00 every day

// In-memory lock to prevent overlapping runs
let _running = false;

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
 * Generate an HMAC-based unsubscribe token for a user.
 * @param {string} userId
 * @param {string} email
 * @returns {string}
 */
function generateActionPromptUnsubscribeToken(userId, email) {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'fallback-secret';
  const payload = Buffer.from(
    JSON.stringify({ userId, email: email.toLowerCase(), purpose: 'actionPrompts' })
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
  const unsubscribeUrl = `${baseUrl}/email/action-prompts/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  const managePrefsUrl = `${baseUrl}/settings`;
  const loginUrl = `${baseUrl}/dashboard/supplier`;
  const actionsHtml = buildRagHtml(report, baseUrl);

  const sendCount = user.actionPromptState?.sendCount ?? 0;
  const subject = getEmailSubject(report, sendCount);

  if (dryRun) {
    logger.info(
      `[ActionPrompts] DRY RUN — would email ${user.email} (${report.outstanding.length} action(s)): ${report.outstanding.map(a => a.key).join(', ')}`
    );
    return;
  }

  await postmark.sendMail({
    to: user.email,
    subject,
    template: 'action-prompts',
    templateData: {
      name: user.firstName || user.name || 'there',
      actionsHtml,
      loginUrl,
      managePrefsUrl,
      unsubscribeUrl,
    },
    from: postmark.FROM_NOREPLY,
    messageStream: 'outbound',
    tags: ['action_prompt'],
  });

  logger.info(
    `[ActionPrompts] Sent to ${user.email} — status: ${report.ragStatus}, actions: ${report.outstanding.map(a => a.key).join(', ')}`
  );
}

// ── Main run / schedule ─────────────────────────────────────────────────────

/**
 * Run action-prompt emails for all eligible suppliers.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false] - Log actions without sending
 * @returns {Promise<Object>} Summary stats
 */
async function runActionPrompts({ dryRun = false } = {}) {
  if (_running) {
    logger.warn('[ActionPrompts] Previous run still in progress — skipping');
    return { skipped: true, reason: 'already-running' };
  }

  _running = true;
  const startedAt = new Date();
  logger.info(`[ActionPrompts] Run started at ${startedAt.toISOString()} (dryRun=${dryRun})`);

  let scanned = 0;
  let sent = 0;
  let skippedCadence = 0;
  let errors = 0;

  try {
    const items = await getSupplierActionItems();
    scanned = items.length;

    const now = new Date();
    const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';

    for (const { user, report } of items) {
      try {
        const { shouldSend, nextState } = evaluateCadence(user.actionPromptState, now);

        if (!shouldSend) {
          skippedCadence++;
          logger.debug(
            `[ActionPrompts] Skipping ${user.email} — next send at ${user.actionPromptState?.nextSendAt || nextState.nextSendAt}`
          );
          // Persist initial state if this is the first detection
          if (!user.actionPromptState && !dryRun) {
            await updateCadenceState(user.id, nextState);
          }
          continue;
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
    errors,
  };

  logger.info('[ActionPrompts] Run complete:', JSON.stringify(summary));
  return summary;
}

/**
 * Schedule action-prompt emails using node-schedule.
 *
 * @returns {{ scheduled: boolean, cronExpr: string, nextRun: Date|null }}
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

  const cronExpr = process.env.ACTION_PROMPTS_CRON || DEFAULT_CRON;

  const job = schedule.scheduleJob(cronExpr, async () => {
    try {
      await runActionPrompts();
    } catch (err) {
      logger.error('[ActionPrompts] Scheduled run failed:', err.message);
    }
  });

  if (!job) {
    logger.error('[ActionPrompts] Failed to schedule job — invalid cron expression?', cronExpr);
    return { scheduled: false, cronExpr, nextRun: null };
  }

  const nextRun = job.nextInvocation();
  logger.info(
    `[ActionPrompts] Scheduled: cron="${cronExpr}", nextRun=${nextRun ? nextRun.toISOString() : 'unknown'}`
  );

  return { scheduled: true, cronExpr, nextRun };
}

module.exports = {
  runActionPrompts,
  scheduleActionPrompts,
  generateActionPromptUnsubscribeToken,
  buildRagHtml,
  getEmailSubject,
};
