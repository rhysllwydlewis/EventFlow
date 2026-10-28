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
 * When a timed suspension ends. The admin screens write suspensionExpiresAt; the older bulk
 * suspend route wrote suspendedUntil, so both are honoured.
 * @param {Object} user - Stored user
 * @returns {string|null} Expiry timestamp, or null for an open-ended suspension
 */
function suspensionExpiry(user) {
  return user.suspensionExpiresAt || user.suspendedUntil || null;
}

/**
 * Whether a timed suspension has run out.
 * @param {Object} user - Stored user
 * @param {number} now - Current time in ms
 * @returns {boolean} True when an expiry is set and has passed
 */
function suspensionHasExpired(user, now) {
  const expiry = suspensionExpiry(user);
  if (!expiry) {
    return false;
  }
  const expires = Date.parse(expiry);
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
 * @param {Object} database - db-unified
 * @param {Object} user - Stored user
 * @param {number} [now] - Current time in ms
 * @returns {Promise<boolean>} True when a suspension was cleared
 */
async function releaseExpiredSuspension(database, user, now = Date.now()) {
  if (!user || user.suspended !== true || !suspensionHasExpired(user, now)) {
    return false;
  }
  // Only clear the suspension that was seen to have expired: if an admin has renewed it since,
  // the stored expiry no longer matches and the new suspension is left alone.
  const filter = { id: user.id, suspended: true };
  for (const field of ['suspensionExpiresAt', 'suspendedUntil']) {
    if (user[field]) {
      filter[field] = user[field];
    }
  }
  await database.updateOne('users', filter, {
    $set: {
      suspended: false,
      suspendedAt: null,
      suspendedBy: null,
      suspensionReason: null,
      suspensionDuration: null,
      suspensionExpiresAt: null,
      suspendedUntil: null,
      updatedAt: new Date(now).toISOString(),
    },
  });
  return true;
}

/**
 * Ends a user's live (WebSocket) connections, so a suspension or ban takes effect on a chat that
 * is already open and not only on the next request. Does nothing when realtime is not running.
 * @param {string} userId - User whose connections to close
 * @returns {boolean} True when a connection server was asked to disconnect them
 */
function dropLiveSessions(userId) {
  const server = global.wsServerV2;
  if (!userId || !server || typeof server.disconnectUser !== 'function') {
    return false;
  }
  server.disconnectUser(userId);
  return true;
}

module.exports = {
  RESTRICTION,
  dropLiveSessions,
  suspensionExpiry,
  getAccountRestriction,
  releaseExpiredSuspension,
  restrictionBody,
  restrictionRedirect,
  suspensionHasExpired,
};
