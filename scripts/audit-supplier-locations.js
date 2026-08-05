#!/usr/bin/env node
/**
 * Audit and migrate supplier locations onto the UK city registry.
 *
 * Dry run by default: it reads every supplier, classifies how confidently its
 * location can be mapped to a registry city, and prints a report. Nothing is
 * written unless `--apply` is passed, and even then only high-confidence
 * mappings are written — anything ambiguous is listed for a human instead.
 *
 * Usage:
 *   node scripts/audit-supplier-locations.js                # dry run report
 *   node scripts/audit-supplier-locations.js --json report.json
 *   node scripts/audit-supplier-locations.js --apply        # write mappings
 *   node scripts/audit-supplier-locations.js --apply --limit 50
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

/**
 * Parse the command line.
 * @param {string[]} argv Raw arguments.
 * @returns {{apply: boolean, limit: number, json: string|null}} Options.
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const options = { apply: false, limit: Infinity, json: null };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') {
      options.apply = true;
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
 * Resolve a supplier's postcode to a city, when it has one.
 *
 * A postcode is the only signal strong enough to map a record automatically
 * where the free text was not already an exact city name.
 * @param {Object} row Audit row.
 * @returns {Promise<Object|null>} Postcode resolution, or null.
 */
async function resolveByPostcode(row) {
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
 * Run the audit.
 * @param {Object} options Parsed options.
 * @returns {Promise<Object>} Report.
 */
async function run(options) {
  const suppliers = (await dbUnified.read('suppliers')) || [];
  const rows = [];
  const counts = {
    [AUDIT_STATUSES.alreadyMapped]: 0,
    [AUDIT_STATUSES.highConfidence]: 0,
    [AUDIT_STATUSES.reviewRequired]: 0,
    [AUDIT_STATUSES.unmapped]: 0,
  };
  let written = 0;

  for (const supplier of suppliers) {
    if (rows.length >= options.limit) {
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
      await dbUnified.updateOne(
        'suppliers',
        { id: row.supplierId },
        {
          baseLocation: buildBaseLocation(registry.getCity(row.citySlug), row.postcodeResult),
          locationMappingReviewRequired: false,
        }
      );
      written += 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    totalSuppliers: suppliers.length,
    audited: rows.length,
    counts,
    written,
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
  logger.info(`Suppliers read:        ${report.totalSuppliers}`);
  logger.info(`Suppliers audited:     ${report.audited}`);
  logger.info(`Already mapped:        ${report.counts[AUDIT_STATUSES.alreadyMapped]}`);
  logger.info(`High confidence:       ${report.counts[AUDIT_STATUSES.highConfidence]}`);
  logger.info(`Review required:       ${report.counts[AUDIT_STATUSES.reviewRequired]}`);
  logger.info(`Unmapped:              ${report.counts[AUDIT_STATUSES.unmapped]}`);
  logger.info(`Records written:       ${report.written}`);

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

  if (report.mode === 'dry-run') {
    logger.info(line);
    logger.info('Dry run: no supplier records were changed. Re-run with --apply to write.');
  }
}

/**
 * Entry point.
 * @returns {Promise<void>} Resolves when the audit finishes.
 */
async function main() {
  const options = parseArgs(process.argv);
  const report = await run(options);
  printReport(report);

  if (options.json) {
    const target = path.resolve(process.cwd(), options.json);
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    logger.info(`Report written to ${target}`);
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      logger.error('Supplier location audit failed:', error);
      process.exit(1);
    });
}

module.exports = { buildBaseLocation, parseArgs, run };
