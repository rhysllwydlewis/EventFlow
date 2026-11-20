#!/usr/bin/env node
/**
 * Find, and optionally delete, stored photo images that nothing uses any more.
 *
 * Dry run by default: reads every collection and reports what it would delete. Nothing is
 * changed unless `--apply` is passed, and `--apply` refuses to run unless the active backend is a
 * healthy MongoDB connection (the same rule as scripts/audit-orphaned-supplier-data.js: a run
 * against local fallback storage would read nothing, and "0 orphans" must not be mistaken for a
 * clean result against production).
 *
 * How an image is judged used, and every other safety (grace period, per-run limit, refusing when
 * the scan looks wrong), is documented in utils/orphanPhotoSweep.js. In short: an image is used if
 * its address appears anywhere in any other collection.
 *
 * Usage:
 *   node scripts/sweep-orphan-photos.js                       # report only
 *   node scripts/sweep-orphan-photos.js --grace-days=30       # keep anything younger than 30 days
 *   node scripts/sweep-orphan-photos.js --apply               # delete (up to --limit images)
 *   node scripts/sweep-orphan-photos.js --apply --limit=1000
 *   node scripts/sweep-orphan-photos.js --json                # the report as JSON
 *
 * Exit codes: 0 done (or dry run), 1 failed, 2 refused (see the message).
 */
'use strict';

const dbUnified = require('../db-unified');
const mongoDb = require('../db');
const { sweepOrphanPhotos } = require('../utils/orphanPhotoSweep');

const REQUIRED_BACKEND = 'mongodb';
const EXIT_CODES = { ok: 0, failed: 1, refused: 2 };

/**
 * @param {string[]} argv - Arguments after the script name
 * @returns {{apply: boolean, json: boolean, allowLarge: boolean, graceDays: number, limit: number,
 *   errors: string[]}} The options, and a message for each argument that is not understood
 */
function parseArgs(argv) {
  const options = {
    apply: false,
    json: false,
    allowLarge: false,
    graceDays: 14,
    limit: 5000,
    errors: [],
  };
  for (const arg of argv) {
    const number = name => {
      const value = Number(arg.slice(name.length + 1));
      return Number.isFinite(value) && value >= 0 ? value : null;
    };
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--allow-large') {
      options.allowLarge = true;
    } else if (arg.startsWith('--grace-days=')) {
      const value = number('--grace-days');
      if (value === null) {
        options.errors.push(`${arg}: expected a number of days`);
      } else {
        options.graceDays = value;
      }
    } else if (arg.startsWith('--limit=')) {
      const value = number('--limit');
      if (value === null || value < 1) {
        options.errors.push(`${arg}: expected a whole number of images, 1 or more`);
      } else {
        options.limit = Math.floor(value);
      }
    } else {
      options.errors.push(`${arg}: not an option this script knows`);
    }
  }
  return options;
}

function describe(report) {
  const mb = bytes => (bytes / (1024 * 1024)).toFixed(1);
  const perRun = report.candidates > report.limit ? `, of which up to ${report.limit} per run` : '';
  const lines = [
    `Mode: ${report.mode}`,
    `Images stored: ${report.imagesTotal}; addresses found in other records: ${report.referencedIds}`,
    `Kept: ${report.kept.used} in use, ${report.kept.tooRecent} younger than ${report.graceDays} days, ${report.kept.undated} with no readable date`,
  ];
  lines.push(
    `Orphaned (older than ${report.graceDays} days, used by nothing): ${report.candidates}${perRun}`,
    `Size of this run: ${mb(report.candidateBytes)} MB; by type: ${JSON.stringify(report.byType)}`
  );
  if (report.sample.length > 0) {
    lines.push(`Sample ids: ${report.sample.join(', ')}`);
  }
  if (report.refused) {
    lines.push(`REFUSED, nothing was deleted: ${report.refused}`);
  } else {
    lines.push(
      report.mode === 'apply'
        ? `Deleted: ${report.deleted}`
        : 'Nothing was deleted. Re-run with --apply to delete.'
    );
  }
  lines.push(`Records read, by collection: ${JSON.stringify(report.scanned)}`);
  return lines.join('\n');
}

async function main(argv = process.argv.slice(2), log = console.log) {
  const options = parseArgs(argv);
  if (options.errors.length > 0) {
    log(options.errors.join('\n'));
    return EXIT_CODES.failed;
  }

  await dbUnified.initializeDatabase();
  const status = (dbUnified.getDatabaseStatus && dbUnified.getDatabaseStatus()) || {};
  const healthyMongo = status.type === REQUIRED_BACKEND && Boolean(status.connected);
  if (!healthyMongo) {
    log(
      `Refusing to run: the active backend is "${status.type}" (connected: ${Boolean(status.connected)}). ` +
        'This reads every collection, so it only makes sense against MongoDB. Set MONGODB_URI and make sure the database is reachable.'
    );
    return EXIT_CODES.refused;
  }

  const report = await sweepOrphanPhotos(await mongoDb.getDb(), options);
  log(options.json ? JSON.stringify(report, null, 2) : describe(report));
  return report.refused ? EXIT_CODES.refused : EXIT_CODES.ok;
}

if (require.main === module) {
  main()
    .then(code => {
      process.exitCode = code;
    })
    .catch(error => {
      console.error('Orphan photo sweep failed:', error.message);
      process.exitCode = EXIT_CODES.failed;
    })
    .finally(() => setTimeout(() => process.exit(process.exitCode), 200));
}

module.exports = { EXIT_CODES, describe, main, parseArgs };
