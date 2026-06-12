#!/usr/bin/env node
'use strict';

const dbUnified = require('../db-unified');
const databaseConfig = require('../config/database');
const photoUpload = require('../photo-upload');
const suppliersRouter = require('../routes/suppliers');
const { repairPackageImages } = require('../utils/packageImageRepair');

function getArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

async function main() {
  const supplierId = getArg('supplierId');
  const packageIds = getArg('packageIds')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const apply = process.argv.includes('--apply');

  if (!supplierId && packageIds.length === 0) {
    throw new Error(
      'Pass --supplierId=<id> and/or --packageIds=<id1,id2>. Dry-run is default; add --apply to write changes.'
    );
  }

  await databaseConfig.initializeDatabase();

  let packages = [];
  if (packageIds.length > 0) {
    for (const id of packageIds) {
      const pkg = await dbUnified.findOne('packages', { id });
      if (pkg) {
        packages.push(pkg);
      }
    }
  } else {
    packages = await dbUnified.find('packages', { supplierId });
  }

  if (supplierId) {
    packages = packages.filter(pkg => pkg.supplierId === supplierId);
  }

  const report = await repairPackageImages(packages, {
    dryRun: !apply,
    dbUnified,
    photoUpload,
    invalidateCaches: suppliersRouter.invalidatePackageCaches,
  });

  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
