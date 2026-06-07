#!/usr/bin/env node
'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { ensureSupplierProfileForUser } = require('../services/supplierProfileProvisioning.service');

function parseArgs(argv = process.argv.slice(2)) {
  return { apply: argv.includes('--apply') };
}

async function findMissingSupplierProfiles() {
  const supplierUsers = await dbUnified.find('users', { role: 'supplier' });
  const missing = [];

  for (const user of supplierUsers) {
    const profile = await dbUnified.findOne('suppliers', { ownerUserId: user.id });
    if (!profile) {
      missing.push(user);
    }
  }

  return { supplierUsers, missing };
}

async function runBackfill(options = {}) {
  const apply = options.apply === true;
  const summary = {
    checked: 0,
    missing: 0,
    created: 0,
    skipped: 0,
    errors: 0,
  };

  await dbUnified.initializeDatabase();
  const { supplierUsers, missing } = await findMissingSupplierProfiles();
  summary.checked = supplierUsers.length;
  summary.missing = missing.length;

  for (const user of missing) {
    const label = `${user.email || '(no email)'} (${user.id})`;
    console.log(`MISSING supplier profile: ${label}`);

    if (!apply) {
      summary.skipped += 1;
      continue;
    }

    try {
      const profile = await ensureSupplierProfileForUser(user);
      if (profile) {
        summary.created += 1;
        console.log(`CREATED supplier profile ${profile.id} for ${label}`);
      } else {
        summary.skipped += 1;
        console.log(`SKIPPED ${label}: user is not a supplier`);
      }
    } catch (error) {
      summary.errors += 1;
      console.error(`ERROR creating supplier profile for ${label}: ${error.message}`);
    }
  }

  console.log(
    `Summary: checked=${summary.checked} missing=${summary.missing} created=${summary.created} skipped=${summary.skipped} errors=${summary.errors} mode=${apply ? 'apply' : 'dry-run'}`
  );
  return summary;
}

if (require.main === module) {
  runBackfill(parseArgs()).catch(error => {
    logger.error('Backfill missing supplier profiles failed:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  findMissingSupplierProfiles,
  runBackfill,
};
