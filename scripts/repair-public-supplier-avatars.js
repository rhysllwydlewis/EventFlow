#!/usr/bin/env node
'use strict';

const {
  repairPublicSupplierAvatars,
  diagnoseKnownSupplierAvatar,
} = require('../services/publicSupplierAvatar.service');

async function main() {
  const force = process.argv.includes('--force');
  const summary = await repairPublicSupplierAvatars({ force });
  console.log('Public supplier avatar repair summary');
  console.log(`suppliers scanned: ${summary.scanned}`);
  console.log(`avatars repaired: ${summary.repaired}`);
  console.log(`skipped because already had publicProfileAvatarUrl: ${summary.skippedExisting}`);
  console.log(`skipped because no image found: ${summary.skippedNoImage}`);
  console.log(`failed updates: ${summary.failed}`);
  if (summary.sources) {
    console.log('source fields used:');
    for (const [source, count] of Object.entries(summary.sources)) {
      console.log(`- ${source}: ${count}`);
    }
  }

  const diagnostic = await diagnoseKnownSupplierAvatar({
    supplierId: 'sup_wtlrt6uiftxg2y',
    checkReachability: process.argv.includes('--check-reachable'),
    baseUrl: process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://event-flow.co.uk',
  });
  console.log('Known supplier diagnostic:', JSON.stringify(diagnostic, null, 2));
}

main().catch(error => {
  console.error('Public supplier avatar repair failed:', error);
  process.exitCode = 1;
});
