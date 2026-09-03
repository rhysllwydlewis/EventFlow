#!/usr/bin/env node
/**
 * Audit and migrate supplier locations onto the UK city registry.
 *
 * Dry run by default: it reads every supplier, classifies how confidently its
 * location can be mapped to a registry city, and prints a report. Nothing is
 * written unless `--apply` is passed, and even then only high-confidence
 * mappings are written — anything ambiguous is listed for a human instead.
 *
 * Safety rules, all enforced here rather than left to the operator:
 *
 * - `--apply` refuses to run unless the active backend is a healthy MongoDB
 *   connection. Local file storage is a development fallback; migrating it
 *   would write to a copy of the data nobody is serving.
 * - Under `NODE_ENV=production`, `--apply` additionally requires
 *   `--confirm-production`.
 * - Every write is checked and then re-read. A write that does not land stops
 *   the run with a non-zero exit code instead of being counted as success.
 * - The legacy `location` string is never modified, and re-running after a
 *   successful migration classifies the same records as `already_mapped`.
 *
 * Usage:
 *   # Dry run — reads only, writes nothing. Safe to run against production.
 *   NODE_ENV=production node scripts/audit-supplier-locations.js \
 *     --require-mongodb --json audit-dry-run.json
 *
 *   # Apply — writes high-confidence mappings only.
 *   NODE_ENV=production node scripts/audit-supplier-locations.js \
 *     --require-mongodb --confirm-production --apply --json audit-apply.json
 *
 *   # Verify — re-run the dry run; every migrated record is now already_mapped.
 *   NODE_ENV=production node scripts/audit-supplier-locations.js \
 *     --require-mongodb --json audit-verify.json
 *
 *   # Other options
 *   node scripts/audit-supplier-locations.js --limit 50   # audit the first 50
 */

'use strict';

const fs = require('fs');
const path = require('path');

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const registry = require('../services/locationRegistry.service');
const supplierLocation = require('../services/supplierLocation.service');
const { geocodePostcode, isValidUKPostcode } = require('../utils/geocoding');
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
 *
 * The script would otherwise discover its backend implicitly on the first read,
 * which is exactly the moment it is too late to refuse.
 * @returns {Promise<Object>} `{type, connected, state, error}`.
 */
async function resolveBackend() {
  try {
    await dbUnified.initializeDatabase();
  } catch (error) {
    return {
      type: 'unknown',
      connected: false,
      state: 'failed',
      error: error.message,
    };
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
 *
 * Refusals are collected rather than thrown one at a time, so an operator sees
 * everything wrong with their command in one go.
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

  // Applies whether or not --require-mongodb was passed: a migration must never
  // rewrite the local file store that a development machine happens to hold.
  if (options.apply && !healthyMongo) {
    refusals.push(
      `Refusing to --apply against backend "${backend.type}" (connected: ${backend.connected}). ` +
        'Supplier mappings may only be written to MongoDB.'
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
 * Resolve a supplier's postcode to a city, when it has one.
 *
 * A postcode is the only signal strong enough to map a record automatically
 * where the free text was not already an exact city name.
 * @param {Object} row Audit row.
 * @returns {Promise<Object|null>} Postcode resolution, or null.
 */
function resolveByPostcode(row) {
  if (!row.postcode || !isValidUKPostcode(row.postcode)) {
    return null;
  }
  return registry.resolvePostcodeToCity(row.postcode, { geocodePostcode });
}

/**
 * Build the base location document a supplier should be given.
 * @param {Object} city Registry city.
 * @param {Object|null} postcodeResult Postcode resolution, when used.
 * @returns {Object} `baseLocation` document.
 */
function buildBaseLocation(city, postcodeResult) {
  const point =
    postcodeResult && Array.isArray(postcodeResult.coordinates?.coordinates)
      ? {
          longitude: postcodeResult.coordinates.coordinates[0],
          latitude: postcodeResult.coordinates.coordinates[1],
        }
      : null;

  return supplierLocation.buildBaseLocationDocument(city, {
    point,
    postcode: postcodeResult ? postcodeResult.postcode : null,
    source: postcodeResult ? MAPPING_SOURCES.postcodeLookup : MAPPING_SOURCES.registryName,
    confidence: CONFIDENCE.high,
  });
}

/**
 * Write one mapping and prove it landed.
 *
 * `updateOne` reports whether it modified anything, and a re-read confirms both
 * that the mapping is present and that the legacy `location` string came
 * through untouched. Anything less would let a silent no-op be counted as a
 * migrated record.
 * @param {Object} supplier The supplier as it was read.
 * @param {Object} baseLocation The mapping to write.
 * @returns {Promise<{ok: boolean, reason: string|null}>} Write outcome.
 */
async function writeMapping(supplier, baseLocation) {
  const acknowledged = await dbUnified.updateOne(
    'suppliers',
    { id: supplier.id },
    {
      baseLocation,
      locationMappingReviewRequired: false,
    }
  );

  if (!acknowledged) {
    return { ok: false, reason: 'updateOne reported no modified document' };
  }

  const stored = await dbUnified.findOne('suppliers', { id: supplier.id });
  if (!stored) {
    return { ok: false, reason: 'supplier could not be re-read after the update' };
  }
  if (!stored.baseLocation || stored.baseLocation.citySlug !== baseLocation.citySlug) {
    return { ok: false, reason: 'stored baseLocation does not match what was written' };
  }
  // The legacy string is the rollback path; if it moved, the migration is not
  // the reversible operation it claims to be.
  if ((stored.location || null) !== (supplier.location || null)) {
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
  const suppliers = (await dbUnified.read('suppliers')) || [];
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

  for (const supplier of suppliers) {
    if (rows.length >= options.limit || stoppedEarly) {
      break;
    }
    const row = supplierLocation.auditSupplierLocation(supplier);

    // A postcode can rescue a record whose free text was too vague to map.
    if (row.status !== AUDIT_STATUSES.alreadyMapped && row.postcode) {
      const resolved = await resolveByPostcode(row);
      if (resolved) {
        row.status = AUDIT_STATUSES.highConfidence;
        row.citySlug = resolved.city.slug;
        row.confidence = CONFIDENCE.high;
        row.source = MAPPING_SOURCES.postcodeLookup;
        row.reason = `postcode resolves to ${resolved.city.name} (${supplierLocation.roundMiles(resolved.distanceMiles)} miles from the city centre)`;
        row.postcodeResult = resolved;
      }
    }

    counts[row.status] = (counts[row.status] || 0) + 1;
    rows.push(row);

    if (
      options.apply &&
      row.status === AUDIT_STATUSES.highConfidence &&
      row.citySlug &&
      registry.getCity(row.citySlug)
    ) {
      // The legacy `location` string is deliberately left untouched: it stays
      // readable through the whole migration, and the supplier is asked to
      // confirm the structured value on their next profile edit.
      const outcome = await writeMapping(
        supplier,
        buildBaseLocation(registry.getCity(row.citySlug), row.postcodeResult)
      );

      if (outcome.ok) {
        written += 1;
        verified += 1;
        row.writeStatus = 'written';
      } else {
        failedWrites.push({
          supplierId: row.supplierId,
          citySlug: row.citySlug,
          reason: outcome.reason,
        });
        row.writeStatus = 'failed';
        // A write that did not land means the picture the report is building is
        // no longer true. Stop rather than march on through the rest of the
        // collection producing a report nobody can trust.
        stoppedEarly = true;
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    backend: backend || { type: dbUnified.getDatabaseType(), connected: null, state: 'unknown' },
    nodeEnv: process.env.NODE_ENV || 'development',
    totalSuppliers: suppliers.length,
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
  logger.info(`Supplier location audit (${report.mode})`);
  logger.info(line);
  logger.info(
    `Database backend:      ${report.backend.type} (connected: ${report.backend.connected})`
  );
  logger.info(`NODE_ENV:              ${report.nodeEnv}`);
  logger.info(`Suppliers read:        ${report.totalSuppliers}`);
  logger.info(`Suppliers audited:     ${report.audited}`);
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
        `  ${row.supplierId}  "${row.legacyLocation || ''}"  →  ${row.citySlug || 'unresolved'}  (${row.reason})`
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
      logger.error(`  ${failure.supplierId} → ${failure.citySlug}: ${failure.reason}`);
    }
    if (report.stoppedEarly) {
      logger.error('The run stopped at the first failed write; no further records were touched.');
    }
  }

  if (report.mode === 'dry-run') {
    logger.info(line);
    logger.info('Dry run: no supplier records were changed. Re-run with --apply to write.');
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
      logger.error('Supplier location audit failed:', error);
      process.exit(1);
    });
}

module.exports = {
  EXIT_CODES,
  buildBaseLocation,
  checkPreconditions,
  main,
  parseArgs,
  resolveBackend,
  run,
  writeMapping,
};
