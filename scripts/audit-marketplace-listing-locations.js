#!/usr/bin/env node
/**
 * Audit and migrate marketplace listing locations onto the UK city registry.
 *
 * The live write path (`routes/marketplace.js`) derives a listing's city on
 * every create and on every edit that changes its location text, so this
 * script exists only to backfill listings that predate that change. It
 * mirrors `scripts/audit-supplier-locations.js` field for field: dry run by
 * default, only high-confidence mappings are ever written, and every write is
 * checked and re-read before it counts as successful.
 *
 * Usage:
 *   # Dry run — reads only, writes nothing. Safe to run against production.
 *   NODE_ENV=production node scripts/audit-marketplace-listing-locations.js \
 *     --require-mongodb --json audit-dry-run.json
 *
 *   # Apply — writes high-confidence mappings only.
 *   NODE_ENV=production node scripts/audit-marketplace-listing-locations.js \
 *     --require-mongodb --confirm-production --apply --json audit-apply.json
 *
 *   # Verify — re-run the dry run; every migrated record is now already_mapped.
 *   NODE_ENV=production node scripts/audit-marketplace-listing-locations.js \
 *     --require-mongodb --json audit-verify.json
 *
 *   # Other options
 *   node scripts/audit-marketplace-listing-locations.js --limit 50   # audit the first 50
 */

'use strict';

const fs = require('fs');
const path = require('path');

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const registry = require('../services/locationRegistry.service');
const supplierLocation = require('../services/supplierLocation.service');
const marketplaceListingLocation = require('../services/marketplaceListingLocation.service');
const { AUDIT_STATUSES, CONFIDENCE, MAPPING_SOURCES } = require('../models/LocationContent');

/** The only backend a migration may write to. */
const REQUIRED_BACKEND = 'mongodb';

/** Exit codes, so a CI job or a runbook can tell the failures apart. */
const EXIT_CODES = {
  ok: 0,
  refused: 2,
  writeFailed: 3,
};

/**
 * Parse the command line.
 * @param {string[]} argv Raw arguments.
 * @returns {Object} Options.
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    apply: false,
    limit: Infinity,
    json: null,
    requireMongodb: false,
    confirmProduction: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--require-mongodb') {
      options.requireMongodb = true;
    } else if (arg === '--confirm-production') {
      options.confirmProduction = true;
    } else if (arg === '--limit') {
      const value = Number(args[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        options.limit = value;
      }
      index += 1;
    } else if (arg === '--json') {
      options.json = args[index + 1] || null;
      index += 1;
    }
  }

  return options;
}

/**
 * Initialise the database and describe the backend the script is talking to.
 * @returns {Promise<Object>} `{type, connected, state, error}`.
 */
async function resolveBackend() {
  try {
    await dbUnified.initializeDatabase();
  } catch (error) {
    return { type: 'unknown', connected: false, state: 'failed', error: error.message };
  }

  const status = dbUnified.getDatabaseStatus() || {};
  return {
    type: status.type || dbUnified.getDatabaseType(),
    connected: Boolean(status.connected),
    state: status.state || 'unknown',
    error: status.error ? String(status.error.message || status.error) : null,
  };
}

/**
 * Decide whether this invocation is allowed to proceed.
 * @param {Object} options Parsed options.
 * @param {Object} backend Backend description.
 * @param {Object} [env] Environment, defaulting to `process.env`.
 * @returns {{allowed: boolean, refusals: string[]}} Decision.
 */
function checkPreconditions(options, backend, env = process.env) {
  const refusals = [];
  const healthyMongo = backend.type === REQUIRED_BACKEND && backend.connected;

  if (options.requireMongodb && !healthyMongo) {
    refusals.push(
      `--require-mongodb was given, but the active backend is "${backend.type}" (connected: ${backend.connected}). ` +
        'Set MONGODB_URI and re-run.'
    );
  }

  if (options.apply && !healthyMongo) {
    refusals.push(
      `Refusing to --apply against backend "${backend.type}" (connected: ${backend.connected}). ` +
        'Listing city mappings may only be written to MongoDB.'
    );
  }

  if (options.apply && env.NODE_ENV === 'production' && !options.confirmProduction) {
    refusals.push(
      'Refusing to --apply in production without --confirm-production. ' +
        'Run the dry run first, read the report, then re-run with --confirm-production.'
    );
  }

  return { allowed: refusals.length === 0, refusals };
}

/**
 * Classify one listing's mapping state.
 * @param {Object} listing Marketplace listing record.
 * @returns {Object} Audit row.
 */
function auditListingLocation(listing) {
  const id = listing?.id ? String(listing.id) : '';

  if (listing.citySlug && registry.getCity(listing.citySlug)) {
    return {
      listingId: id,
      status: AUDIT_STATUSES.alreadyMapped,
      citySlug: listing.citySlug,
      confidence: listing.citySlugConfidence || CONFIDENCE.high,
      source: listing.citySlugSource || null,
      legacyLocation: listing.location || null,
      reason: 'listing already has a stored city mapping',
    };
  }

  const point = marketplaceListingLocation.readListingPoint(listing);
  if (point) {
    const nearest = registry.nearestCity(point);
    if (nearest) {
      return {
        listingId: id,
        status: AUDIT_STATUSES.highConfidence,
        citySlug: nearest.city.slug,
        confidence: CONFIDENCE.high,
        source: MAPPING_SOURCES.postcodeLookup,
        legacyLocation: listing.location || null,
        reason: `geocoded coordinates fall ${supplierLocation.roundMiles(nearest.distanceMiles)} miles from ${nearest.city.name}`,
      };
    }
  }

  const classification = supplierLocation.classifyLegacyLocation(listing.location);
  return {
    listingId: id,
    status: classification.status,
    citySlug: classification.citySlug,
    confidence:
      classification.status === AUDIT_STATUSES.highConfidence ? CONFIDENCE.high : CONFIDENCE.low,
    source: MAPPING_SOURCES.legacyText,
    legacyLocation: listing.location || null,
    matchedNames: classification.matchedNames,
    reason: classification.reason,
  };
}

/**
 * Write one mapping and prove it landed.
 * @param {Object} listing The listing as it was read.
 * @param {Object} row The classification row driving the write.
 * @returns {Promise<{ok: boolean, reason: string|null}>} Write outcome.
 */
async function writeMapping(listing, row) {
  const acknowledged = await dbUnified.updateOne(
    'marketplace_listings',
    { id: listing.id },
    { citySlug: row.citySlug, citySlugSource: row.source, citySlugConfidence: row.confidence }
  );

  if (!acknowledged) {
    return { ok: false, reason: 'updateOne reported no modified document' };
  }

  const stored = await dbUnified.findOne('marketplace_listings', { id: listing.id });
  if (!stored) {
    return { ok: false, reason: 'listing could not be re-read after the update' };
  }
  if (stored.citySlug !== row.citySlug) {
    return { ok: false, reason: 'stored citySlug does not match what was written' };
  }
  // The legacy string is the rollback path; if it moved, the migration is not
  // the reversible operation it claims to be.
  if ((stored.location || null) !== (listing.location || null)) {
    return { ok: false, reason: 'legacy location string changed during the update' };
  }

  return { ok: true, reason: null };
}

/**
 * Run the audit.
 * @param {Object} options Parsed options.
 * @param {Object} [backend] Backend description for the report.
 * @returns {Promise<Object>} Report.
 */
async function run(options, backend = null) {
  const listings = (await dbUnified.read('marketplace_listings')) || [];
  const rows = [];
  const counts = {
    [AUDIT_STATUSES.alreadyMapped]: 0,
    [AUDIT_STATUSES.highConfidence]: 0,
    [AUDIT_STATUSES.reviewRequired]: 0,
    [AUDIT_STATUSES.unmapped]: 0,
  };
  const failedWrites = [];
  let written = 0;
  let verified = 0;
  let stoppedEarly = false;

  for (const listing of listings) {
    if (rows.length >= options.limit || stoppedEarly) {
      break;
    }
    const row = auditListingLocation(listing);
    counts[row.status] = (counts[row.status] || 0) + 1;
    rows.push(row);

    if (
      options.apply &&
      row.status === AUDIT_STATUSES.highConfidence &&
      row.citySlug &&
      registry.getCity(row.citySlug)
    ) {
      const outcome = await writeMapping(listing, row);

      if (outcome.ok) {
        written += 1;
        verified += 1;
        row.writeStatus = 'written';
      } else {
        failedWrites.push({
          listingId: row.listingId,
          citySlug: row.citySlug,
          reason: outcome.reason,
        });
        row.writeStatus = 'failed';
        // A write that did not land means the picture the report is building
        // is no longer true. Stop rather than march on through the rest of
        // the collection producing a report nobody can trust.
        stoppedEarly = true;
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    backend: backend || { type: dbUnified.getDatabaseType(), connected: null, state: 'unknown' },
    nodeEnv: process.env.NODE_ENV || 'development',
    totalListings: listings.length,
    audited: rows.length,
    counts,
    written,
    verified,
    failedWrites,
    stoppedEarly,
    rows,
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
  logger.info(`Marketplace listing location audit (${report.mode})`);
  logger.info(line);
  logger.info(
    `Database backend:      ${report.backend.type} (connected: ${report.backend.connected})`
  );
  logger.info(`NODE_ENV:              ${report.nodeEnv}`);
  logger.info(`Listings read:         ${report.totalListings}`);
  logger.info(`Listings audited:      ${report.audited}`);
  logger.info(`Already mapped:        ${report.counts[AUDIT_STATUSES.alreadyMapped]}`);
  logger.info(`High confidence:       ${report.counts[AUDIT_STATUSES.highConfidence]}`);
  logger.info(`Review required:       ${report.counts[AUDIT_STATUSES.reviewRequired]}`);
  logger.info(`Unmapped:              ${report.counts[AUDIT_STATUSES.unmapped]}`);
  logger.info(`Records written:       ${report.written}`);
  logger.info(`Writes verified:       ${report.verified}`);
  logger.info(`Failed writes:         ${report.failedWrites.length}`);

  const needsReview = report.rows.filter(row => row.status === AUDIT_STATUSES.reviewRequired);
  if (needsReview.length) {
    logger.info(line);
    logger.info('Records needing a human decision:');
    for (const row of needsReview.slice(0, 50)) {
      logger.info(
        `  ${row.listingId}  "${row.legacyLocation || ''}"  →  ${row.citySlug || 'unresolved'}  (${row.reason})`
      );
    }
    if (needsReview.length > 50) {
      logger.info(`  … and ${needsReview.length - 50} more; use --json for the full list.`);
    }
  }

  if (report.failedWrites.length) {
    logger.info(line);
    logger.error('Writes that did not land:');
    for (const failure of report.failedWrites) {
      logger.error(`  ${failure.listingId} → ${failure.citySlug}: ${failure.reason}`);
    }
    if (report.stoppedEarly) {
      logger.error('The run stopped at the first failed write; no further records were touched.');
    }
  }

  if (report.mode === 'dry-run') {
    logger.info(line);
    logger.info('Dry run: no listing records were changed. Re-run with --apply to write.');
  }
}

/**
 * Entry point.
 * @returns {Promise<number>} Process exit code.
 */
async function main() {
  const options = parseArgs(process.argv);
  const backend = await resolveBackend();
  const decision = checkPreconditions(options, backend);

  if (!decision.allowed) {
    for (const refusal of decision.refusals) {
      logger.error(refusal);
    }
    return EXIT_CODES.refused;
  }

  const report = await run(options, backend);
  printReport(report);

  if (options.json) {
    const target = path.resolve(process.cwd(), options.json);
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    logger.info(`Report written to ${target}`);
  }

  return report.failedWrites.length ? EXIT_CODES.writeFailed : EXIT_CODES.ok;
}

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(error => {
      logger.error('Marketplace listing location audit failed:', error);
      process.exit(1);
    });
}

module.exports = {
  EXIT_CODES,
  auditListingLocation,
  checkPreconditions,
  main,
  parseArgs,
  resolveBackend,
  run,
  writeMapping,
};
