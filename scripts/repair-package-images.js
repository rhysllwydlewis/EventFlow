#!/usr/bin/env node
'use strict';

/**
 * Convert base64 package images into stored uploads, and report package images that
 * hold a `javascript:` URL or HTML. Dry run by default; nothing is written without --apply.
 *
 *   node scripts/repair-package-images.js --supplierId=<id>        one supplier's packages
 *   node scripts/repair-package-images.js --packageIds=<a>,<b>     specific packages
 *   node scripts/repair-package-images.js --all                    every package (summary report)
 *
 * Add --apply to write. Add --verbose for the full per-package report (for --all this
 * includes each package's whole stored image, so it can be very large).
 * Add --limit=<n> to stop after n packages.
 *
 * See docs/PACKAGE_IMAGE_REPAIR.md.
 */

const BATCH_SIZE = 50;

function getArg(argv, name) {
  const prefix = `--${name}=`;
  const found = argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

/**
 * @param {string[]} argv Arguments after the script name.
 * @returns {{supplierId: string, packageIds: string[], all: boolean, apply: boolean, verbose: boolean, limit: number}}
 */
function parseArgs(argv = process.argv.slice(2)) {
  const limit = Number.parseInt(getArg(argv, 'limit'), 10);
  return {
    supplierId: getArg(argv, 'supplierId'),
    packageIds: getArg(argv, 'packageIds')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
    all: argv.includes('--all'),
    apply: argv.includes('--apply'),
    verbose: argv.includes('--verbose'),
    limit: Number.isFinite(limit) && limit > 0 ? limit : Infinity,
  };
}

function usageError(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

/** Exactly one way of choosing packages, so a typo cannot widen a write to everything. */
function validateArgs(options) {
  const choices = [Boolean(options.supplierId), options.packageIds.length > 0, options.all].filter(
    Boolean
  ).length;
  if (choices === 0) {
    throw usageError(
      'Choose packages with --supplierId=<id>, --packageIds=<id1,id2> or --all. ' +
        'Dry-run is default; add --apply to write changes.'
    );
  }
  if (choices > 1) {
    throw usageError('Use only one of --supplierId, --packageIds and --all.');
  }
}

/**
 * @param {Object} options Parsed options.
 * @param {Object} dbUnified Database layer.
 * @returns {Promise<Object[]>} The packages to scan.
 */
async function selectPackages(options, dbUnified) {
  let packages = [];
  if (options.packageIds.length > 0) {
    for (const id of options.packageIds) {
      const pkg = await dbUnified.findOne('packages', { id });
      if (pkg) {
        packages.push(pkg);
      }
    }
  } else if (options.supplierId) {
    packages = await dbUnified.find('packages', { supplierId: options.supplierId });
  } else {
    packages = await dbUnified.find('packages', {});
  }

  if (options.supplierId) {
    packages = packages.filter(pkg => pkg.supplierId === options.supplierId);
  }
  return packages.slice(0, options.limit);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  validateArgs(options);

  // Loaded here so the argument handling above can be used (and tested) without them.
  const dbUnified = require('../db-unified');
  const databaseConfig = require('../config/database');
  const photoUpload = require('../photo-upload');
  const suppliersRouter = require('../routes/suppliers');
  const { repairPackageImages, summariseRepairReport } = require('../utils/packageImageRepair');

  await databaseConfig.initializeDatabase();
  if (options.apply && dbUnified.getDatabaseType && dbUnified.getDatabaseType() !== 'mongodb') {
    throw new Error(
      `Refusing to --apply against the "${dbUnified.getDatabaseType()}" backend: set MONGODB_URI and make sure the database is reachable.`
    );
  }

  const packages = await selectPackages(options, dbUnified);

  // Batches keep one slow image conversion from holding the rest of a large catalogue.
  const results = [];
  let changed = 0;
  let unsafePackages = 0;
  for (let start = 0; start < packages.length; start += BATCH_SIZE) {
    const batch = await repairPackageImages(packages.slice(start, start + BATCH_SIZE), {
      dryRun: !options.apply,
      dbUnified,
      photoUpload,
      invalidateCaches: suppliersRouter.invalidatePackageCaches,
    });
    results.push(...batch.results);
    changed += batch.changed;
    unsafePackages += batch.unsafePackages;
  }
  const report = {
    dryRun: !options.apply,
    scanned: packages.length,
    changed,
    unsafePackages,
    results,
  };

  console.log(
    JSON.stringify(
      options.verbose || !options.all ? report : summariseRepairReport(report),
      null,
      2
    )
  );
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      // A usage mistake needs the message, not a stack trace.
      console.error(err && err.usage ? err.message : err && err.stack ? err.stack : err);
      process.exit(1);
    });
}

module.exports = { BATCH_SIZE, main, parseArgs, selectPackages, validateArgs };
