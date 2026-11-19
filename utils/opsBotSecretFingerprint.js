'use strict';

const crypto = require('crypto');

/**
 * A short, one-way fingerprint of the Ops Assistant shared secret.
 *
 * Both sides of the link (the production service and the routine's environment)
 * can print this and compare it, which answers "do we hold the same secret?"
 * without either side revealing it. It is the first 8 hex characters of SHA-256,
 * so it cannot be used to recover or forge anything.
 *
 * Kept free of other dependencies so `scripts/ops-bot-secret-fingerprint.js` can
 * run in an environment that has no `node_modules`.
 *
 * @param {string} secret The shared secret.
 * @returns {string} 8 lowercase hex characters.
 */
function secretFingerprint(secret) {
  return crypto
    .createHash('sha256')
    .update(String(secret || ''))
    .digest('hex')
    .slice(0, 8);
}

module.exports = { secretFingerprint };
