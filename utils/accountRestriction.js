/**
 * Whether an account may sign in and use the site.
 *
 * An admin can suspend an account (optionally for a set time) or ban it. Both used to be only
 * labels: nothing at sign-in or on later requests looked at them. This is the one place that
 * decides, so sign-in, the logged-in check and the "who am I" endpoint all agree.
 *
 * The owner account is never restricted (the admin routes refuse to suspend or ban it, and this
 * keeps a bad record from locking the owner out).
 */

'use strict';

const domainAdmin = require('../middleware/domain-admin');

const RESTRICTION = Object.freeze({ BANNED: 'banned', SUSPENDED: 'suspended' });

const MESSAGES = Object.freeze({
  [RESTRICTION.BANNED]:
    'This account has been banned. Please contact support if you think this is a mistake.',
  [RESTRICTION.SUSPENDED]:
    'This account has been suspended. Please contact support if you think this is a mistake.',
});

/**
 * Whether a timed suspension has run out.
 * @param {Object} user - Stored user
 * @param {number} now - Current time in ms
 * @returns {boolean} True when an expiry is set and has passed
 */
function suspensionHasExpired(user, now) {
  if (!user.suspensionExpiresAt) {
    return false;
  }
  const expires = Date.parse(user.suspensionExpiresAt);
  return Number.isFinite(expires) && expires <= now;
}

/**
 * The restriction on an account right now, if any.
 * @param {Object|null} user - Stored user
 * @param {number} [now] - Current time in ms
 * @returns {{type: 'banned'|'suspended', reason: string|null}|null} The restriction, or null
 */
function getAccountRestriction(user, now = Date.now()) {
  if (!user || user.isOwner === true || domainAdmin.isOwnerEmail(user.email || '')) {
    return null;
  }
  if (user.banned === true) {
    return { type: RESTRICTION.BANNED, reason: user.banReason || null };
  }
  if (user.suspended === true && !suspensionHasExpired(user, now)) {
    return { type: RESTRICTION.SUSPENDED, reason: user.suspensionReason || null };
  }
  return null;
}

/**
 * JSON body to answer a restricted account with. The reason an admin typed is internal and is
 * not sent back.
 * @param {{type: string}} restriction - Result of getAccountRestriction()
 * @returns {{error: string, code: string}} Response body
 */
function restrictionBody(restriction) {
  return {
    error: MESSAGES[restriction.type],
    code: restriction.type === RESTRICTION.BANNED ? 'ACCOUNT_BANNED' : 'ACCOUNT_SUSPENDED',
  };
}

/**
 * Where to send a browser whose account is restricted.
 * @param {{type: string}} restriction - Result of getAccountRestriction()
 * @returns {string} Sign-in page address with the reason
 */
function restrictionRedirect(restriction) {
  return `/auth?reason=${restriction.type}`;
}

/**
 * Clears a timed suspension that has run out, so the admin screens stop showing the account as
 * suspended. Safe to call on any user: it does nothing unless an expired suspension is on record.
 * @param {Object} db - db-unified
 * @param {Object} user - Stored user
 * @param {number} [now] - Current time in ms
 * @returns {Promise<boolean>} True when a suspension was cleared
 */
async function releaseExpiredSuspension(db, user, now = Date.now()) {
  if (!user || user.suspended !== true || !suspensionHasExpired(user, now)) {
    return false;
  }
  await db.updateOne(
    'users',
    { id: user.id },
    {
      $set: {
        suspended: false,
        suspendedAt: null,
        suspendedBy: null,
        suspensionReason: null,
        suspensionDuration: null,
        suspensionExpiresAt: null,
        updatedAt: new Date(now).toISOString(),
      },
    }
  );
  return true;
}

module.exports = {
  RESTRICTION,
  getAccountRestriction,
  releaseExpiredSuspension,
  restrictionBody,
  restrictionRedirect,
  suspensionHasExpired,
};
