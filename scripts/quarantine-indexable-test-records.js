#!/usr/bin/env node
/**
 * Quarantine test/fixture suppliers and packages that leaked into the public
 * index (SEO-006/SEO-007).
 *
 * The SEO audit found records like the "test-no2-yy7lo4" package and a
 * "Romeo Test" supplier actually indexed by Google, because the old public
 * eligibility rule checked only `approved`, not whether a record was
 * seed/fixture data. services/seoEligibility.service.js now rejects any
 * record services/seoRecordLifecycle.util.js's isKnownTestFixture()
 * recognises — an explicit `isTest` flag, a name/slug that is literally
 * "Test", or one that carries "test" as its own word (e.g. "Romeo Test",
 * "test-no2-yy7lo4") — so those records can no longer pass canBeIndexed or
 * canAppearInSitemap going forward. This script is the other half: finding
 * and cleaning up records that already leaked before that fix existed.
 *
 * Dry run by default: it reads suppliers and packages, reports every known
 * test/fixture record and whether it is currently `approved` (i.e. was
 * actually reachable as a public, potentially-indexed page), and writes
 * nothing. Nothing is mutated unless `--apply` is passed.
 *
 * `--apply` quarantines rather than deletes: it sets `approved: false` plus
 * an explicit `seoQuarantined` marker and reason, so the record is
 * unpublished (canBeViewedPublicly/canBeIndexed both then fail it, same as
 * everywhere else in the app) without losing the underlying data — an
 * operator can always reverse a false positive by hand. Re-running with
 * `--apply` after a previous run is a no-op for records already
 * quarantined: it writes only the records that are not yet marked, so
 * running it twice does not double-mutate or error.
 *
 * Usage:
 *   # Dry run — reads only, writes nothing. Safe to run at any time.
 *   node scripts/quarantine-indexable-test-records.js
 *
 *   # Apply — quarantines every known test/fixture record found.
 *   node scripts/quarantine-indexable-test-records.js --apply
 *
 *   # Restrict to one collection.
 *   node scripts/quarantine-indexable-test-records.js --suppliers
 *   node scripts/quarantine-indexable-test-records.js --packages
 *
 *   # Write the full report as JSON, for a runbook or a follow-up ticket.
 *   node scripts/quarantine-indexable-test-records.js --json report.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { isKnownTestFixture } = require('../services/seoRecordLifecycle.util');

const QUARANTINE_REASON = 'test_fixture_record';

/**
 * Parse the command line.
 * @param {string[]} argv Raw arguments.
 * @returns {Object} Options.
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    apply: false,
    suppliers: false,
    packages: false,
    json: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--suppliers') {
      options.suppliers = true;
    } else if (arg === '--packages') {
      options.packages = true;
    } else if (arg === '--json') {
      options.json = args[index + 1] || null;
      index += 1;
    }
  }

  // Neither flag given means both collections, exactly like
  // scripts/cleanup-test-data.js's --all default.
  if (!options.suppliers && !options.packages) {
    options.suppliers = true;
    options.packages = true;
  }

  return options;
}

/**
 * A record's display name/title, for the report only.
 * @param {Object} record Supplier or package record.
 * @returns {string} Best-effort label.
 */
function recordLabel(record) {
  return String(record.name || record.businessName || record.title || record.id || 'unknown');
}

/**
 * Find every known test/fixture record in one collection.
 * @param {string} collectionName 'suppliers' or 'packages'.
 * @returns {Promise<Object[]>} Report rows.
 */
async function scanCollection(collectionName) {
  const records = (await dbUnified.read(collectionName)) || [];
  return records
    .filter(record => record && isKnownTestFixture(record) && record.seoQuarantined !== true)
    .map(record => ({
      collection: collectionName,
      id: record.id,
      label: recordLabel(record),
      slug: record.slug || null,
      // The record's own approved flag, before this run touches anything —
      // true here is exactly the leak the audit found: fixture data that was
      // (or still is, until --apply runs) reachable as a live public page.
      wasApproved: record.approved === true,
      isTestFlag: record.isTest === true,
    }));
}

/**
 * Records already marked quarantined by a previous run, reported separately
 * so an operator can see the cleanup is holding without re-scanning by hand.
 * @param {string} collectionName 'suppliers' or 'packages'.
 * @returns {Promise<number>} Count already quarantined.
 */
async function countAlreadyQuarantined(collectionName) {
  const records = (await dbUnified.read(collectionName)) || [];
  return records.filter(record => record && record.seoQuarantined === true).length;
}

/**
 * Quarantine one record: unpublish it and mark why, without deleting it.
 * @param {string} collectionName 'suppliers' or 'packages'.
 * @param {Object} row Report row from scanCollection.
 * @returns {Promise<{ok: boolean, reason: string|null}>} Write outcome.
 */
async function quarantineRecord(collectionName, row) {
  const acknowledged = await dbUnified.updateOne(
    collectionName,
    { id: row.id },
    {
      approved: false,
      seoQuarantined: true,
      seoQuarantineReason: QUARANTINE_REASON,
      seoQuarantinedAt: new Date().toISOString(),
    }
  );

  if (!acknowledged) {
    return { ok: false, reason: 'updateOne reported no modified document' };
  }

  const stored = await dbUnified.findOne(collectionName, { id: row.id });
  if (!stored || stored.seoQuarantined !== true || stored.approved !== false) {
    return { ok: false, reason: 'record could not be re-read as quarantined after the update' };
  }

  return { ok: true, reason: null };
}

/**
 * Run the scan (and, in apply mode, the quarantine writes).
 * @param {Object} options Parsed options.
 * @returns {Promise<Object>} Report.
 */
async function run(options) {
  const collections = [
    ...(options.suppliers ? ['suppliers'] : []),
    ...(options.packages ? ['packages'] : []),
  ];

  const byCollection = {};
  let quarantinedNow = 0;
  const failedWrites = [];

  for (const collectionName of collections) {
    const rows = await scanCollection(collectionName);
    const alreadyQuarantined = await countAlreadyQuarantined(collectionName);

    if (options.apply) {
      for (const row of rows) {
        const outcome = await quarantineRecord(collectionName, row);
        row.applyOutcome = outcome.ok ? 'quarantined' : 'failed';
        if (outcome.ok) {
          quarantinedNow += 1;
        } else {
          failedWrites.push({ collection: collectionName, id: row.id, reason: outcome.reason });
        }
      }
    }

    byCollection[collectionName] = { rows, alreadyQuarantined };
  }

  const found = Object.values(byCollection).reduce((sum, entry) => sum + entry.rows.length, 0);
  const wasLive = Object.values(byCollection).reduce(
    (sum, entry) => sum + entry.rows.filter(row => row.wasApproved).length,
    0
  );

  return {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    collections,
    found,
    wasLive,
    quarantinedNow,
    failedWrites,
    byCollection,
  };
}

/**
 * Print a human-readable summary.
 * @param {Object} report Report.
 * @returns {void} Nothing.
 */
function printReport(report) {
  const line = '─'.repeat(64);
  logger.info(line);
  logger.info(`SEO test/fixture record quarantine (${report.mode})`);
  logger.info(line);
  logger.info(`Collections scanned:      ${report.collections.join(', ')}`);
  logger.info(`Test/fixture records found: ${report.found}`);
  logger.info(`  of which currently live (approved: true): ${report.wasLive}`);
  if (report.mode === 'apply') {
    logger.info(`Newly quarantined this run: ${report.quarantinedNow}`);
  }

  for (const [collectionName, entry] of Object.entries(report.byCollection)) {
    if (entry.alreadyQuarantined) {
      logger.info(
        `  ${collectionName}: ${entry.alreadyQuarantined} already quarantined by a previous run`
      );
    }
    for (const row of entry.rows) {
      const flags = [
        row.isTestFlag ? 'isTest' : null,
        row.wasApproved ? 'WAS LIVE' : null,
        row.applyOutcome || null,
      ]
        .filter(Boolean)
        .join(', ');
      logger.info(
        `  [${collectionName}] ${row.id}  "${row.label}"${row.slug ? ` (${row.slug})` : ''}  ${flags ? `— ${flags}` : ''}`
      );
    }
  }

  if (report.failedWrites.length) {
    logger.info(line);
    logger.error('Quarantine writes that did not land:');
    for (const failure of report.failedWrites) {
      logger.error(`  [${failure.collection}] ${failure.id}: ${failure.reason}`);
    }
  }

  if (report.mode === 'dry-run') {
    logger.info(line);
    logger.info(
      report.found
        ? 'Dry run: no records were changed. Re-run with --apply to quarantine them.'
        : 'Dry run: no known test/fixture records found among currently public records.'
    );
  }
}

/**
 * Entry point.
 * @returns {Promise<number>} Process exit code.
 */
async function main() {
  const options = parseArgs(process.argv);
  await dbUnified.initializeDatabase();

  const report = await run(options);
  printReport(report);

  if (options.json) {
    const target = path.resolve(process.cwd(), options.json);
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    logger.info(`Report written to ${target}`);
  }

  return report.failedWrites.length ? 1 : 0;
}

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(error => {
      logger.error('Fatal error running the quarantine script:', error);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  scanCollection,
  run,
  QUARANTINE_REASON,
};
