'use strict';

/**
 * Nudges customers who saved a supplier but never followed up with an
 * enquiry — nothing currently re-engages this segment at all: saves are
 * tracked (savedItems) and enquiries are tracked (quoteRequests), but
 * nothing cross-references the two.
 *
 * A customer is eligible when they have at least one still-unconverted
 * saved supplier from the last SAVED_LOOKBACK_DAYS days, and have never
 * submitted a quote request at all (a coarse but safe "never engaged"
 * proxy — see isEligibleForNudge). Reuses utils/postmark.js's
 * sendMarketingEmail(), which already handles the notify_marketing opt-out
 * check and unsubscribe-link generation, so this doesn't need its own
 * consent/token plumbing.
 */

const schedule = require('node-schedule');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const postmark = require('../utils/postmark');
const { buildPublicSupplierSlug, supplierDisplayName } = require('./publicSupplierSeo.service');
const { JOB_KEYS } = require('./backgroundJobTelemetry.service');
const schedulerLock = require('./schedulerLock.service');
const { runScheduledJob, runIfMissed } = require('./scheduledJobRunner');

const DEFAULT_CRON = '15 10 * * *'; // 10:15 UTC daily
const EXPECTED_INTERVAL_MS = 24 * 60 * 60 * 1000;

const SAVED_LOOKBACK_MIN_DAYS = 3; // give them a few days to book on their own first
const SAVED_LOOKBACK_MAX_DAYS = 14; // a save older than this is no longer "recent"
const RENUDGE_GAP_DAYS = 30; // minimum gap between nudges to the same customer
const MAX_NUDGES = 4; // lifetime cap so this never reads as spam
const MAX_SUPPLIERS_PER_EMAIL = 3;

let scheduledJob = null;

function daysToMs(days) {
  return days * 24 * 60 * 60 * 1000;
}

/**
 * @param {Object} user
 * @param {number} now - Date.now()
 * @returns {boolean}
 */
function isEligibleForNudge(user, now) {
  if (!user || !user.email || user.role !== 'customer') {
    return false;
  }
  if (user.emailUnsubscribed) {
    return false;
  }
  if (user.browseNudgeOptOut === true) {
    return false;
  }

  const state = user.browseNudgeState || {};
  const remindersSent = Array.isArray(state.remindersSent) ? state.remindersSent : [];
  if (remindersSent.length >= MAX_NUDGES) {
    return false;
  }

  const lastSentMs = state.lastSentAt ? Date.parse(state.lastSentAt) : NaN;
  if (Number.isFinite(lastSentMs) && now - lastSentMs < daysToMs(RENUDGE_GAP_DAYS)) {
    return false;
  }

  return true;
}

/**
 * Resolve up to MAX_SUPPLIERS_PER_EMAIL still-relevant saved suppliers for a
 * customer: saved within the lookback window, not already converted to a
 * quote request, and the supplier still exists / hasn't been removed.
 *
 * @param {string} userId
 * @param {Array} savedItems - full savedItems collection (pre-loaded once per run)
 * @param {Array} suppliers - full suppliers collection (pre-loaded once per run)
 * @param {Array} packages - full packages collection (pre-loaded once per run)
 * @param {Set<string>} enquiredSupplierIds - supplierIds this customer already enquired about
 * @param {number} now - Date.now()
 * @returns {Array<Object>} supplier documents, most recently saved first
 */
function resolveNudgeSuppliers({
  userId,
  savedItems,
  suppliers,
  packages,
  enquiredSupplierIds,
  now,
}) {
  const minAgeMs = daysToMs(SAVED_LOOKBACK_MIN_DAYS);
  const maxAgeMs = daysToMs(SAVED_LOOKBACK_MAX_DAYS);
  const supplierById = new Map(suppliers.map(s => [s.id, s]));
  const packageById = new Map(packages.map(p => [p.id, p]));

  const candidates = savedItems
    .filter(item => item.userId === userId)
    .map(item => {
      const savedAtMs = Date.parse(item.savedAt || '');
      if (!Number.isFinite(savedAtMs)) {
        return null;
      }
      const ageMs = now - savedAtMs;
      if (ageMs < minAgeMs || ageMs > maxAgeMs) {
        return null;
      }
      const supplierId =
        item.itemType === 'supplier' ? item.itemId : packageById.get(item.itemId)?.supplierId;
      if (!supplierId || enquiredSupplierIds.has(supplierId)) {
        return null;
      }
      const supplier = supplierById.get(supplierId);
      if (!supplier || supplier.deleted || supplier.approved === false) {
        return null;
      }
      return { supplier, savedAtMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.savedAtMs - a.savedAtMs);

  const seen = new Set();
  const result = [];
  for (const { supplier } of candidates) {
    if (seen.has(supplier.id)) {
      continue;
    }
    seen.add(supplier.id);
    result.push(supplier);
    if (result.length >= MAX_SUPPLIERS_PER_EMAIL) {
      break;
    }
  }
  return result;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildSuppliersHtml(suppliers, baseUrl) {
  return suppliers
    .map(supplier => {
      const name = supplierDisplayName(supplier) || 'Event supplier';
      const slug = buildPublicSupplierSlug(supplier);
      const url = `${baseUrl}/supplier/${slug}`;
      // category is enum-constrained at the schema level (models/Supplier.js),
      // but escaped here anyway as cheap defense-in-depth against raw HTML
      // interpolation into an email body.
      const category = escapeHtml(supplier.category || supplier.primaryCategory || '');
      return `
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
    <tr>
      <td style="background-color:#F8FAFB;border:1px solid #E7EAF0;border-radius:10px;padding:16px 18px;">
        <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#0B1220;">${name}</p>
        ${category ? `<p style="margin:0 0 12px;font-size:13px;color:#667085;">${category}</p>` : ''}
        <a href="${url}" style="display:inline-block;padding:8px 18px;background:linear-gradient(135deg,#0B8073,#13B6A2);color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:700;">View profile &#8594;</a>
      </td>
    </tr>
  </table>`;
    })
    .join('\n');
}

async function sendNudge(user, suppliers, baseUrl) {
  const suppliersHtml = buildSuppliersHtml(suppliers, baseUrl);
  const message = `<p>Hi ${escapeHtml(user.name) || 'there'},</p><p>You saved ${
    suppliers.length === 1 ? 'this supplier' : 'these suppliers'
  } a little while ago — still planning? Here's a quick way back to them.</p>${suppliersHtml}`;

  const sendResult = await postmark.sendMarketingEmail(
    user,
    'Still thinking about these suppliers?',
    message,
    { tags: ['browse_nudge'] }
  );

  const state = user.browseNudgeState || {};
  const remindersSent = Array.isArray(state.remindersSent) ? state.remindersSent : [];
  const nowIso = new Date().toISOString();

  await dbUnified.updateOne(
    'users',
    { id: user.id },
    {
      $set: {
        browseNudgeState: {
          remindersSent: [...remindersSent, nowIso],
          lastSentAt: nowIso,
        },
      },
    }
  );

  return sendResult;
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.trigger]
 * @returns {Promise<{ scanned: number, eligible: number, sent: number, skippedOptedOut: number, errors: number }>}
 */
async function runBrowseNudges({ trigger = 'scheduler' } = {}) {
  const [users, savedItems, suppliers, packages, quoteRequests] = await Promise.all([
    dbUnified.read('users'),
    dbUnified.read('savedItems'),
    dbUnified.read('suppliers'),
    dbUnified.read('packages'),
    dbUnified.read('quoteRequests'),
  ]);

  const now = Date.now();
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';

  // Coarse "never engaged" proxy: any quote request ever, from any of their
  // saved suppliers, disqualifies them entirely — a customer who already
  // reached out doesn't need a nudge back to the same list. Indexed by both
  // userId and normalised email: routes/quote-requests.js allows an
  // unauthenticated quote request (userId null, email always set), so a
  // customer who enquired as a guest and later saved the same supplier
  // under an account with the same email must still be excluded.
  const enquiredByUser = new Map();
  const enquiredByEmail = new Map();
  for (const qr of quoteRequests || []) {
    const supplierIds = (qr.suppliers || []).map(s => s.supplierId).filter(Boolean);
    if (!supplierIds.length) {
      continue;
    }
    if (qr.userId) {
      const set = enquiredByUser.get(qr.userId) || new Set();
      supplierIds.forEach(id => set.add(id));
      enquiredByUser.set(qr.userId, set);
    }
    if (qr.email) {
      const key = String(qr.email).toLowerCase().trim();
      const set = enquiredByEmail.get(key) || new Set();
      supplierIds.forEach(id => set.add(id));
      enquiredByEmail.set(key, set);
    }
  }

  let eligible = 0;
  let sent = 0;
  let errors = 0;

  for (const user of users || []) {
    if (!isEligibleForNudge(user, now)) {
      continue;
    }

    const enquiredSupplierIds = new Set(enquiredByUser.get(user.id) || []);
    if (user.email) {
      const byEmail = enquiredByEmail.get(String(user.email).toLowerCase().trim());
      if (byEmail) {
        byEmail.forEach(id => enquiredSupplierIds.add(id));
      }
    }

    const suppliersToNudge = resolveNudgeSuppliers({
      userId: user.id,
      savedItems: savedItems || [],
      suppliers: suppliers || [],
      packages: packages || [],
      enquiredSupplierIds,
      now,
    });

    if (suppliersToNudge.length === 0) {
      continue;
    }

    eligible++;
    try {
      await sendNudge(user, suppliersToNudge, baseUrl);
      sent++;
    } catch (err) {
      errors++;
      logger.error(`[browse-nudge] Failed to send nudge to user ${user.id}:`, err.message);
    }
  }

  logger.info(
    `[browse-nudge] Run complete (${trigger}): scanned=${(users || []).length}, eligible=${eligible}, sent=${sent}, errors=${errors}`
  );

  return { scanned: (users || []).length, eligible, sent, errors };
}

function isEnabled() {
  const configured = process.env.BROWSE_NUDGE_ENABLED;
  if (configured === undefined) {
    return process.env.NODE_ENV === 'production';
  }
  return configured !== 'false' && configured !== '0';
}

function runTracked(trigger) {
  return runScheduledJob(JOB_KEYS.BROWSE_NUDGE, () => runBrowseNudges({ trigger }), { trigger });
}

// A customer's eligibility is fully re-derived from their savedItems +
// quoteRequests + browseNudgeState on every run (no separate "due" flag to
// go stale), so a missed-tick catch-up can never double-send: anyone
// already nudged today falls outside RENUDGE_GAP_DAYS next time it runs.
function runCatchUpIfMissed() {
  return runIfMissed(
    JOB_KEYS.BROWSE_NUDGE,
    () => runBrowseNudges({ trigger: 'missed-run-catchup' }),
    { expectedIntervalMs: EXPECTED_INTERVAL_MS }
  );
}

function start() {
  if (scheduledJob) {
    scheduledJob.cancel();
  }
  if (!isEnabled()) {
    logger.info('[browse-nudge] Scheduler disabled');
    logger.info('   Set BROWSE_NUDGE_ENABLED=true to enable');
    scheduledJob = null;
    return { scheduled: false, nextRun: null };
  }

  const cronExpr = process.env.BROWSE_NUDGE_CRON || DEFAULT_CRON;
  // Pinned explicitly rather than relying on the container's default timezone.
  scheduledJob = schedule.scheduleJob({ rule: cronExpr, tz: 'Etc/UTC' }, () =>
    schedulerLock.withLock(JOB_KEYS.BROWSE_NUDGE, () => runTracked('scheduler'))
  );

  if (!scheduledJob) {
    logger.error('[browse-nudge] Failed to schedule job — invalid cron expression?');
    return { scheduled: false, nextRun: null };
  }

  setImmediate(() => schedulerLock.withLock(JOB_KEYS.BROWSE_NUDGE, runCatchUpIfMissed));

  const nextRun = scheduledJob.nextInvocation();
  logger.info(
    `[browse-nudge] Scheduled: cron="${cronExpr}", nextRun=${nextRun ? nextRun.toISOString() : 'unknown'}`
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
  runBrowseNudges,
  runTracked,
  runCatchUpIfMissed,
  isEligibleForNudge,
  resolveNudgeSuppliers,
  start,
  stop,
};
