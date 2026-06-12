#!/usr/bin/env node
'use strict';

const dbUnified = require('../db-unified');
const { invalidatePublicSupplierCaches } = require('../services/adminUserDeletion.service');

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

async function auditOrphanedSupplierData(options = {}) {
  const apply = options.apply === true;
  await dbUnified.initializeDatabase();

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

if (require.main === module) {
  auditOrphanedSupplierData({ apply: hasFlag('--apply') }).catch(error => {
    console.error('Orphan supplier data audit failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { auditOrphanedSupplierData };
