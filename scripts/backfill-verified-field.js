#!/usr/bin/env node
/**
 * Backfill: sync `verified` onto users who only have `emailVerified`
 *
 * routes/emailVerification.js used to mark accounts verified by setting
 * `emailVerified: true` without also setting the canonical `verified` field
 * that services/actionPromptService.js (and other admin tooling) actually
 * gates on. That write path now sets both fields together, but any account
 * verified before the fix landed can still be sitting with
 * `emailVerified: true` and `verified` missing/false — silently excluded
 * from supplier action-prompt reminders and any other `verified`-gated
 * feature.
 *
 * Safe to run multiple times (idempotent) — only touches users matching
 * `emailVerified: true, verified: { $ne: true }`.
 *
 * Usage:
 *   node scripts/backfill-verified-field.js          # apply the backfill
 *   node scripts/backfill-verified-field.js --dry-run # report only, no writes
 */

'use strict';

require('dotenv').config();

const dbUnified = require('../db-unified');

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const users = await dbUnified.read('users');
  const affected = users.filter(u => u.emailVerified === true && u.verified !== true);

  console.log(
    `Found ${affected.length} user(s) with emailVerified=true and verified!=true out of ${users.length} total.`
  );

  if (affected.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  if (dryRun) {
    console.log('--dry-run set — no writes will be made. Affected user IDs:');
    for (const u of affected) {
      console.log(`  ${u.id || u._id} (${u.email})`);
    }
    return;
  }

  const nowIso = new Date().toISOString();
  const modified = await dbUnified.updateMany(
    'users',
    { emailVerified: true, verified: { $ne: true } },
    {
      $set: {
        verified: true,
        verifiedAt: nowIso,
        verificationMethod: 'eventflow_email',
        verifiedBy: {
          type: 'user',
          reason: 'Backfilled from emailVerified during verification-field consolidation',
        },
      },
    }
  );

  console.log(`Backfilled ${modified} user(s).`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
