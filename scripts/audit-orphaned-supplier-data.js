#!/usr/bin/env node
/**
 * Audit (and optionally repair) orphaned supplier-linked records.
 *
 * Dry run by default: reads every collection and reports what it finds.
 * Nothing is deleted or modified unless `--apply` is passed.
 *
 * Safety rule, matching `scripts/audit-supplier-locations.js` and
 * `scripts/audit-marketplace-listing-locations.js`: `--apply` refuses to run
 * unless the active backend is a healthy MongoDB connection. Local file
 * storage is a development fallback — deleting "orphans" out of a copy of
 * the data nobody is serving would look like a real cleanup while touching
 * nothing that matters, or worse, permanently losing local-only state that
 * was never actually orphaned in production.
 *
 * The dry-run report always names the backend it actually read from
 * (`report.backend`), so "0 orphans found" against local fallback storage
 * can't be mistaken for a clean result against production data.
 */
'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { invalidatePublicSupplierCaches } = require('../services/adminUserDeletion.service');

/** The only backend an --apply run may modify. */
const REQUIRED_BACKEND = 'mongodb';

/** Exit codes, so a CI job or a runbook can tell the failures apart. */
const EXIT_CODES = {
  ok: 0,
  refused: 2,
};

function hasFlag(flag, argv = process.argv.slice(2)) {
  return argv.includes(flag);
}

function ids(rows) {
  return rows.map(row => row && row.id).filter(Boolean);
}

async function deleteMany(collection, filter) {
  const count = await dbUnified.deleteMany(collection, filter);
  return Number.isFinite(count) ? count : 0;
}

async function updateMany(collection, filter, update) {
  if (typeof dbUnified.updateMany === 'function') {
    const count = await dbUnified.updateMany(collection, filter, update);
    return Number.isFinite(count) ? count : 0;
  }
  return 0;
}

/**
 * Initialise the database and describe the backend the audit actually read
 * from, so a report against local fallback storage can never be confused
 * with a report against production.
 * @returns {Promise<Object>} `{type, connected, state, error}`.
 */
async function resolveBackend() {
  try {
    await dbUnified.initializeDatabase();
  } catch (error) {
    return { type: 'unknown', connected: false, state: 'failed', error: error.message };
  }

  try {
    const status = (dbUnified.getDatabaseStatus && dbUnified.getDatabaseStatus()) || {};
    return {
      type: status.type || (dbUnified.getDatabaseType ? dbUnified.getDatabaseType() : 'unknown'),
      connected: Boolean(status.connected),
      state: status.state || 'unknown',
      error: status.error ? String(status.error.message || status.error) : null,
    };
  } catch (error) {
    return { type: 'unknown', connected: false, state: 'unknown', error: error.message };
  }
}

/**
 * Decide whether an `--apply` run is allowed to proceed.
 * @param {Object} options Parsed options.
 * @param {Object} backend Backend description.
 * @returns {{allowed: boolean, refusals: string[]}} Decision.
 */
function checkPreconditions(options, backend) {
  const refusals = [];
  const healthyMongo = backend.type === REQUIRED_BACKEND && backend.connected;

  if (options.apply && !healthyMongo) {
    refusals.push(
      `Refusing to --apply against backend "${backend.type}" (connected: ${backend.connected}). ` +
        'Orphaned supplier data may only be deleted from MongoDB.'
    );
  }

  return { allowed: refusals.length === 0, refusals };
}

async function auditOrphanedSupplierData(options = {}) {
  const apply = options.apply === true;
  const backend = options.backend || (await resolveBackend());

  const [users, suppliers, packages, photos, analytics, calendarEvents, listings] =
    await Promise.all([
      dbUnified.read('users'),
      dbUnified.read('suppliers'),
      dbUnified.read('packages'),
      dbUnified.read('photos'),
      dbUnified.read('supplierAnalytics'),
      dbUnified.read('public_calendar_events'),
      dbUnified.read('marketplace_listings'),
    ]);

  const userIds = new Set(users.map(user => user.id).filter(Boolean));
  const supplierIds = new Set(suppliers.map(supplier => supplier.id).filter(Boolean));

  const orphanSuppliers = suppliers.filter(
    supplier => supplier.ownerUserId && !userIds.has(supplier.ownerUserId)
  );
  const legacyUnownedSuppliers = suppliers.filter(
    supplier => supplier.ownerUserId === null || supplier.ownerUserId === undefined
  );
  const orphanPackages = packages.filter(pkg => pkg.supplierId && !supplierIds.has(pkg.supplierId));
  const orphanPhotos = photos.filter(
    photo => photo.supplierId && !supplierIds.has(photo.supplierId)
  );
  const orphanAnalytics = analytics.filter(
    row => row.supplierId && !supplierIds.has(row.supplierId)
  );
  const orphanCalendarEvents = calendarEvents.filter(
    event => event.supplierId && !supplierIds.has(event.supplierId)
  );
  const orphanMarketplaceListings = listings.filter(
    listing => listing.supplierId && !supplierIds.has(listing.supplierId)
  );
  const publicOrphanPackages = orphanPackages.filter(
    pkg => pkg.approved || pkg.public || pkg.featured
  );

  const summary = {
    backend,
    checkedSuppliers: suppliers.length,
    legacyUnownedSuppliers: legacyUnownedSuppliers.length,
    orphanSuppliers: orphanSuppliers.length,
    orphanPackages: orphanPackages.length,
    publicOrphanPackages: publicOrphanPackages.length,
    orphanPhotos: orphanPhotos.length,
    orphanAnalytics: orphanAnalytics.length,
    orphanPublicCalendarEvents: orphanCalendarEvents.length,
    orphanMarketplaceListings: orphanMarketplaceListings.length,
    removedSuppliers: 0,
    removedPackages: 0,
    removedPhotos: 0,
    removedAnalytics: 0,
    removedPublicCalendarEvents: 0,
    removedMarketplaceListings: 0,
    cleanedReferences: 0,
    cacheInvalidated: false,
    errors: [],
  };

  console.log(`${apply ? 'Applying repair' : 'Dry run'}: orphaned supplier data audit`);
  console.log(`Database backend: ${backend.type} (connected: ${backend.connected})`);
  if (backend.type !== REQUIRED_BACKEND || !backend.connected) {
    console.log(
      '⚠️  Not reading from a healthy MongoDB connection — this report reflects local fallback storage, not production data. Treat "0 findings" as inconclusive, not clean.'
    );
  }
  console.log('Orphan supplier ids:', ids(orphanSuppliers));
  console.log(
    'Legacy/unowned supplier ids (reported only by default):',
    ids(legacyUnownedSuppliers)
  );
  console.log('Orphan package ids:', ids(orphanPackages));
  console.log('Approved/public orphan package ids:', ids(publicOrphanPackages));

  if (apply) {
    const orphanSupplierIds = ids(orphanSuppliers);
    const missingSupplierIds = [
      ...new Set(orphanPackages.map(pkg => pkg.supplierId).filter(Boolean)),
    ];
    const allCleanupSupplierIds = [...new Set([...orphanSupplierIds, ...missingSupplierIds])];
    const orphanPackageIds = ids(orphanPackages);

    try {
      if (orphanSupplierIds.length) {
        summary.removedPackages += await deleteMany('packages', {
          supplierId: { $in: orphanSupplierIds },
        });
        summary.removedSuppliers += await deleteMany('suppliers', {
          id: { $in: orphanSupplierIds },
        });
      }
      if (missingSupplierIds.length) {
        summary.removedPackages += await deleteMany('packages', {
          supplierId: { $in: missingSupplierIds },
        });
      }
      if (allCleanupSupplierIds.length) {
        const supplierFilter = { supplierId: { $in: allCleanupSupplierIds } };
        summary.removedPhotos += await deleteMany('photos', supplierFilter);
        summary.removedAnalytics += await deleteMany('supplierAnalytics', supplierFilter);
        summary.removedPublicCalendarEvents += await deleteMany(
          'public_calendar_events',
          supplierFilter
        );
        summary.removedMarketplaceListings += await deleteMany(
          'marketplace_listings',
          supplierFilter
        );
        summary.cleanedReferences += await deleteMany('savedItems', supplierFilter);
        summary.cleanedReferences += await deleteMany('shortlists', supplierFilter);
        const anonymise = {
          $set: {
            supplierDeleted: true,
            supplierDeletedAt: new Date().toISOString(),
            supplierId: null,
          },
        };
        for (const collection of [
          'quoteRequests',
          'enquiries',
          'threads',
          'messages',
          'bookings',
          'reviews',
          'plans',
        ]) {
          summary.cleanedReferences += await updateMany(collection, supplierFilter, anonymise);
        }
      }
      if (orphanPackageIds.length) {
        summary.cleanedReferences += await deleteMany('savedItems', {
          packageId: { $in: orphanPackageIds },
        });
        summary.cleanedReferences += await deleteMany('shortlists', {
          packageId: { $in: orphanPackageIds },
        });
      }
      await invalidatePublicSupplierCaches();
      summary.cacheInvalidated = true;
    } catch (err) {
      summary.errors.push(err.message);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  const options = { apply: hasFlag('--apply') };
  const backend = await resolveBackend();
  const decision = checkPreconditions(options, backend);

  if (!decision.allowed) {
    for (const refusal of decision.refusals) {
      logger.error(refusal);
    }
    return EXIT_CODES.refused;
  }

  await auditOrphanedSupplierData({ ...options, backend });
  return EXIT_CODES.ok;
}

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(error => {
      console.error('Orphan supplier data audit failed:', error.message);
      process.exit(1);
    });
}

module.exports = {
  EXIT_CODES,
  auditOrphanedSupplierData,
  checkPreconditions,
  main,
  resolveBackend,
};
