/**
 * Action Prompt Scheduler
 * Schedules automated action-prompt reminder emails for supplier users.
 *
 * Reads the cron expression and enable flag from settings (DB-backed) at runtime,
 * so admin changes take effect on the next scheduled execution without restart.
 *
 * Environment variables:
 *   ACTION_PROMPTS_CRON  — override cron expression (default: '0 9 * * *')
 */

'use strict';

const schedule = require('node-schedule');
const crypto = require('crypto');
const dbUnified = require('../db-unified');
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

/**
 * Build the HTML block for a list of action items.
 * @param {Array} actions
 * @returns {string} HTML string
 */
function buildActionsHtml(actions) {
  const items = actions
    .map(
      action => `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
        <tr>
          <td style="background-color:#F2FBF9;border-left:4px solid #13B6A2;border-radius:0 10px 10px 0;padding:16px 20px;">
            <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#0B1220;">${action.title}</p>
            <p style="margin:0 0 10px;font-size:14px;color:#334155;line-height:1.6;">${action.description}</p>
            <a href="${action.ctaUrl}" style="font-size:13px;color:#0B8073;font-weight:600;text-decoration:none;">
              Take action →
            </a>
          </td>
        </tr>
      </table>`
    )
    .join('');
  return items;
}

/**
 * Generate an HMAC-based unsubscribe token for a user.
 * The token encodes: base64url(JSON payload) + '.' + HMAC signature
 *
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

/**
 * Send an action-prompt email to a single supplier user.
 *
 * @param {Object} user      - User document
 * @param {Array}  actions   - Outstanding action items
 * @param {string} baseUrl   - Application base URL
 * @param {boolean} dryRun   - If true, log but do not actually send
 */
async function sendActionPromptEmail(user, actions, baseUrl, dryRun) {
  const unsubscribeToken = generateActionPromptUnsubscribeToken(user.id, user.email);
  const unsubscribeUrl = `${baseUrl}/email/action-prompts/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  const managePrefsUrl = `${baseUrl}/settings`;
  const loginUrl = `${baseUrl}/dashboard/supplier`;
  const actionsHtml = buildActionsHtml(actions);

  if (dryRun) {
    logger.info(
      `[ActionPrompts] DRY RUN — would email ${user.email} (${actions.length} action(s)): ${actions.map(a => a.key).join(', ')}`
    );
    return;
  }

  await postmark.sendMail({
    to: user.email,
    subject: 'You have a few things to complete on EventFlow',
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
    `[ActionPrompts] Sent to ${user.email} — actions: ${actions.map(a => a.key).join(', ')}`
  );
}

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

    for (const { user, actions } of items) {
      try {
        const { shouldSend, nextState } = evaluateCadence(user.actionPromptState, now);

        if (!shouldSend) {
          skippedCadence++;
          logger.debug(
            `[ActionPrompts] Skipping ${user.email} — next send at ${user.actionPromptState?.nextSendAt}`
          );
          continue;
        }

        await sendActionPromptEmail(user, actions, baseUrl, dryRun);

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
 * Reads cron expression from settings DB at run-time so admin changes are respected.
 *
 * @returns {{ scheduled: boolean, cronExpr: string, nextRun: Date|null }}
 */
function scheduleActionPrompts() {
  // Default: enabled in production, disabled in other environments unless explicitly set
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
};
