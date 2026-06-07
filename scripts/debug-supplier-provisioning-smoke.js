#!/usr/bin/env node
'use strict';

/**
 * Debug smoke test for supplier provisioning/package linkage.
 *
 * This intentionally writes short-lived dummy records and cleans them up again.
 * It is designed for manual pre-merge or staging checks against MongoDB:
 *   MONGODB_URI=... npm run debug:supplier-provisioning-smoke
 *
 * Without MONGODB_URI it exits successfully with a warning so local/CI runs do not
 * accidentally populate the file-backed development store. Set ALLOW_LOCAL_DEBUG_SMOKE=1
 * if you explicitly want to exercise the local store.
 */

const dbUnified = require('../db-unified');
const { ensureSupplierProfileForUser } = require('../services/supplierProfileProvisioning.service');

function uniqueId(prefix, runId) {
  return `${prefix}_debug_${runId}`;
}

async function cleanup(context) {
  const ids = context.ids || {};
  const supplierIds = new Set([ids.supplierId].filter(Boolean));

  // If provisioning created a supplier but the script failed before recording the id,
  // find it by ownerUserId so cleanup still removes it.
  if (ids.supplierUserId) {
    const supplierByOwner = await dbUnified.findOne('suppliers', {
      ownerUserId: ids.supplierUserId,
    });
    if (supplierByOwner?.id) {
      supplierIds.add(supplierByOwner.id);
    }
  }

  const operations = [];
  if (ids.packageId) {
    operations.push(['packages', { id: ids.packageId }]);
  }
  for (const supplierId of supplierIds) {
    operations.push(['packages', { supplierId }]);
  }
  for (const supplierId of supplierIds) {
    operations.push(['suppliers', { id: supplierId }]);
  }
  if (ids.supplierUserId) {
    operations.push(['suppliers', { ownerUserId: ids.supplierUserId }]);
    operations.push(['users', { id: ids.supplierUserId }]);
  }
  if (ids.customerUserId) {
    operations.push(['users', { id: ids.customerUserId }]);
  }
  if (context.supplierEmail) {
    operations.push(['users', { email: context.supplierEmail }]);
  }
  if (context.customerEmail) {
    operations.push(['users', { email: context.customerEmail }]);
  }

  const summary = { attempted: operations.length, deleted: 0 };
  for (const [collection, filter] of operations) {
    const deleted = await dbUnified.deleteOne(collection, filter);
    if (deleted) {
      summary.deleted += 1;
    }
  }
  return summary;
}

async function runSmoke() {
  if (!process.env.MONGODB_URI && process.env.ALLOW_LOCAL_DEBUG_SMOKE !== '1') {
    console.warn(
      'Skipping debug supplier provisioning smoke test: MONGODB_URI is not set. Set ALLOW_LOCAL_DEBUG_SMOKE=1 to run against local storage.'
    );
    return { skipped: true, reason: 'MONGODB_URI not set' };
  }

  await dbUnified.initializeDatabase();

  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ids = {
    customerUserId: uniqueId('usr_customer', runId),
    supplierUserId: uniqueId('usr_supplier', runId),
    packageId: uniqueId('pkg', runId),
    supplierId: null,
  };

  const nowIso = new Date().toISOString();
  const customerEmail = `debug-customer-${runId}@example.invalid`;
  const supplierEmail = `debug-supplier-${runId}@example.invalid`;
  const customerUser = {
    id: ids.customerUserId,
    role: 'customer',
    email: customerEmail,
    name: 'Debug Customer',
    location: 'Debug City',
    verified: true,
    createdAt: nowIso,
  };
  const supplierUser = {
    id: ids.supplierUserId,
    role: 'supplier',
    email: supplierEmail,
    name: 'Debug Supplier Owner',
    company: 'Debug Supplier Co',
    location: 'Debug City',
    verified: true,
    createdAt: nowIso,
  };

  try {
    const insertedCustomer = await dbUnified.insertOne('users', customerUser);
    if (!insertedCustomer) {
      throw new Error('Failed to insert debug customer user');
    }

    const customerSupplierProfile = await ensureSupplierProfileForUser(customerUser);
    if (customerSupplierProfile !== null) {
      throw new Error('Customer user unexpectedly received a supplier profile');
    }

    const insertedSupplier = await dbUnified.insertOne('users', supplierUser);
    if (!insertedSupplier) {
      throw new Error('Failed to insert debug supplier user');
    }

    const supplierProfile = await ensureSupplierProfileForUser(supplierUser);
    ids.supplierId = supplierProfile?.id || null;
    if (!supplierProfile || supplierProfile.ownerUserId !== supplierUser.id) {
      throw new Error('Supplier profile was not linked to the supplier user');
    }

    const secondProvision = await ensureSupplierProfileForUser(supplierUser);
    if (!secondProvision || secondProvision.id !== supplierProfile.id) {
      throw new Error('Supplier profile provisioning was not idempotent');
    }

    const packageDoc = {
      id: ids.packageId,
      supplierId: supplierProfile.id,
      title: 'Debug Package',
      price: '£1',
      primaryCategoryKey: 'debug',
      eventTypes: ['other'],
      approved: true,
      createdAt: nowIso,
    };
    const insertedPackage = await dbUnified.insertOne('packages', packageDoc);
    if (!insertedPackage) {
      throw new Error('Failed to insert debug package');
    }

    const ownedSupplier = await dbUnified.findOne('suppliers', {
      id: supplierProfile.id,
      ownerUserId: supplierUser.id,
    });
    const linkedPackage = await dbUnified.findOne('packages', {
      id: ids.packageId,
      supplierId: supplierProfile.id,
    });
    if (!ownedSupplier || !linkedPackage) {
      throw new Error('Supplier/package ownership linkage verification failed');
    }

    console.log('Debug supplier provisioning smoke test passed', {
      customerUserId: customerUser.id,
      supplierUserId: supplierUser.id,
      supplierId: supplierProfile.id,
      packageId: packageDoc.id,
    });
    return { skipped: false, ok: true };
  } finally {
    const cleanupSummary = await cleanup({ ids, customerEmail, supplierEmail });
    console.log('Debug supplier provisioning smoke cleanup complete', cleanupSummary);
  }
}

if (require.main === module) {
  runSmoke().catch(error => {
    console.error('Debug supplier provisioning smoke test failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  cleanup,
  runSmoke,
};
