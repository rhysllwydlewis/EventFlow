'use strict';

/**
 * Applies email suppression when Postmark reports a hard bounce, a spam
 * complaint, or a link-tracker unsubscribe. Keeps `users.emailUnsubscribed`
 * and the matching `newsletterSubscribers` row in sync so a bounced or
 * complained address is never re-targeted by a future campaign send.
 */

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const REASON_HARD_BOUNCE = 'hard_bounce';
const REASON_SPAM_COMPLAINT = 'spam_complaint';
const REASON_LINK_UNSUBSCRIBE = 'link_tracker_unsubscribe';

function normaliseEmail(rawEmail) {
  return String(rawEmail || '')
    .trim()
    .toLowerCase();
}

async function suppressEmail(rawEmail, reason, extraUserFields = {}) {
  const email = normaliseEmail(rawEmail);
  if (!email) {
    return { usersUpdated: false, newsletterUpdated: false };
  }

  const now = new Date().toISOString();

  const [usersUpdated, newsletterUpdated] = await Promise.all([
    dbUnified.updateOne(
      'users',
      { email },
      {
        $set: {
          emailUnsubscribed: true,
          emailUnsubscribedAt: now,
          emailUnsubscribedReason: reason,
          ...extraUserFields,
        },
      }
    ),
    dbUnified.updateOne(
      'newsletterSubscribers',
      { email },
      {
        $set: {
          status: 'unsubscribed',
          unsubscribedAt: now,
          unsubscribedReason: reason,
        },
      }
    ),
  ]);

  if (usersUpdated || newsletterUpdated) {
    // `email` and `reason` come from the Postmark webhook payload, so they
    // are passed as structured metadata rather than interpolated into the
    // log message itself — a crafted value can't forge additional log
    // entries this way (CodeQL js/log-injection).
    logger.warn('[email-suppression] Suppressed address', {
      email,
      reason,
      usersUpdated: Boolean(usersUpdated),
      newsletterUpdated: Boolean(newsletterUpdated),
    });
  }

  return { usersUpdated: Boolean(usersUpdated), newsletterUpdated: Boolean(newsletterUpdated) };
}

/**
 * Applies suppression for a normalised Postmark webhook payload — expects
 * RecordType already aliased by routes/postmark-webhook.js's
 * normalizePostmarkPayload (Bounce -> Bounced, SubscriptionChange ->
 * SubscriptionChanged).
 */
function applyWebhookSuppression(payload = {}) {
  const recordType = payload.RecordType || payload.Type;
  const email = payload.Email || payload.Recipient;

  if (recordType === 'Bounced' && payload.Type === 'HardBounce') {
    return suppressEmail(email, REASON_HARD_BOUNCE, {
      emailBounced: true,
      emailBouncedAt: new Date().toISOString(),
      emailBouncedReason: payload.Description || payload.Details || null,
      emailBouncedType: payload.Type,
    });
  }

  if (recordType === 'SpamComplaint') {
    return suppressEmail(email, REASON_SPAM_COMPLAINT);
  }

  if (recordType === 'SubscriptionChanged' && payload.SuppressSending) {
    return suppressEmail(email, REASON_LINK_UNSUBSCRIBE);
  }

  return { usersUpdated: false, newsletterUpdated: false };
}

module.exports = {
  REASON_HARD_BOUNCE,
  REASON_SPAM_COMPLAINT,
  REASON_LINK_UNSUBSCRIBE,
  suppressEmail,
  applyWebhookSuppression,
};
