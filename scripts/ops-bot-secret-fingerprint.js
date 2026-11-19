#!/usr/bin/env node
'use strict';

/**
 * Print a short, one-way fingerprint of EVENTFLOW_OPS_BOT_HMAC_SECRET.
 *
 * Run it in the environment that holds the secret (production service, or the
 * Ops Assistant routine's environment) and compare the output. If the two
 * fingerprints differ, the secrets differ and every signed request will fail
 * with 401 "Invalid Ops Assistant signature" until they are re-synced. The
 * production service also logs this fingerprint whenever it rejects a request.
 *
 * The secret itself is never printed.
 *
 *   EVENTFLOW_OPS_BOT_HMAC_SECRET=... node scripts/ops-bot-secret-fingerprint.js
 */

const { secretFingerprint } = require('../utils/opsBotSecretFingerprint');

const secret = String(process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET || '');

if (secret.length < 32) {
  console.error(
    'EVENTFLOW_OPS_BOT_HMAC_SECRET is not set or is shorter than 32 characters. ' +
      'The server answers 503 until it is.'
  );
  process.exitCode = 1;
} else {
  console.log(`EVENTFLOW_OPS_BOT_HMAC_SECRET fingerprint: ${secretFingerprint(secret)}`);
}
