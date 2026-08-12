'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../middleware/domain-admin', () => ({
  isOwnerEmail: email => email === 'owner@example.com',
}));
jest.mock('../../services/partnerService', () => ({
  softDeletePartnerByUserId: jest.fn(async () => true),
}));
jest.mock('../../services/catalogCache', () => ({ invalidate: jest.fn(async () => undefined) }));
jest.mock('../../cache', () => ({ delPattern: jest.fn(async () => undefined) }));

function matches(row, filter = {}) {
  return Object.keys(filter).every(key => {
    const expected = filter[key];
    const actual = row[key];
    if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
      return expected.$in.includes(actual);
    }
    return actual === expected;
  });
}

function buildDb(seed = {}) {
  const data = {
    users: [],
    suppliers: [],
    packages: [],
    photos: [],
    supplierAnalytics: [],
    reviewRequests: [],
    public_calendar_events: [],
    marketplace_listings: [],
    savedItems: [],
    shortlists: [],
    quoteRequests: [],
    enquiries: [],
    threads: [],
    messages: [],
    bookings: [],
    reviews: [],
    plans: [],
    settings: {},
    ...seed,
  };
  return {
    data,
    initializeDatabase: jest.fn(async () => undefined),
    read: jest.fn(async collection => data[collection] || []),
    find: jest.fn(async (collection, filter) =>
      (data[collection] || []).filter(row => matches(row, filter))
    ),
    findOne: jest.fn(
      async (collection, filter) =>
        (data[collection] || []).find(row => matches(row, filter)) || null
    ),
    deleteMany: jest.fn(async (collection, filter) => {
      const rows = data[collection] || [];
      const kept = rows.filter(row => !matches(row, filter));
      const removed = rows.length - kept.length;
      data[collection] = kept;
      return removed;
    }),
    updateMany: jest.fn(async (collection, filter, update) => {
      let changed = 0;
      for (const row of data[collection] || []) {
        if (matches(row, filter)) {
          Object.assign(row, update.$set || update);
          changed += 1;
        }
      }
      return changed;
    }),
    deleteOne: jest.fn(async (collection, filter) => {
      const rows = data[collection] || [];
      const realFilter = typeof filter === 'string' ? { id: filter } : filter;
      const index = rows.findIndex(row => matches(row, realFilter));
      if (index === -1) {
        return false;
      }
      rows.splice(index, 1);
      return true;
    }),
  };
}

describe('admin supplier maintenance hardening', () => {
  beforeEach(() => jest.resetModules());

  test('admin creation routes provision supplier profiles', () => {
    const adminV2 = fs.readFileSync(path.join(__dirname, '../../routes/admin-v2.js'), 'utf8');
    expect(adminV2).toContain("adminUpdates.role === 'supplier'");
    expect(adminV2).toContain('SUPPLIER_PROFILE_PROVISIONING_FAILED');
  });

  test('admin role changes go through the dedicated account-type endpoint, not the generic edit-user PUT', () => {
    // See docs/ACCOUNT_TYPE_CONVERSION_PLAN.md §5.3: the generic PUT /users/:id
    // "edit any field" endpoint used to accept a raw `role` field and only ever
    // handled customer->supplier correctly (supplier->customer silently left
    // the linked listing live). Role changes now go exclusively through
    // POST /users/:id/account-type, backed by the shared
    // accountTypeConversion service, which handles both directions correctly.
    const adminUsers = fs.readFileSync(
      path.join(__dirname, '../../routes/admin-user-management.js'),
      'utf8'
    );
    expect(adminUsers).toContain("'/users/:id/account-type'");
    expect(adminUsers).toContain('accountTypeConversion.convertToSupplier');
    expect(adminUsers).toContain('accountTypeConversion.convertToCustomer');
    // Regression guard: the generic endpoint must not read or apply a role field.
    expect(adminUsers).toContain('const { name, email, verified, marketingOptIn } = req.body;');
    expect(adminUsers).not.toContain('setFields.role');
  });

  test('shared deletion service deletes supplier public data before user record', async () => {
    const db = buildDb({
      users: [{ id: 'usr_supplier', role: 'supplier', email: 'supplier@example.com' }],
      suppliers: [{ id: 'sup_1', ownerUserId: 'usr_supplier', approved: true }],
      packages: [{ id: 'pkg_1', supplierId: 'sup_1', approved: true }],
      photos: [{ id: 'photo_1', supplierId: 'sup_1' }],
      supplierAnalytics: [{ id: 'analytics_1', supplierId: 'sup_1' }],
      public_calendar_events: [{ id: 'cal_1', supplierId: 'sup_1' }],
      marketplace_listings: [{ id: 'listing_1', supplierId: 'sup_1' }],
      bookings: [{ id: 'book_1', supplierId: 'sup_1' }],
    });
    jest.doMock('../../db-unified', () => db);
    jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
    const { deleteUserAndOwnedData } = require('../../services/adminUserDeletion.service');

    const summary = await deleteUserAndOwnedData('usr_supplier', { id: 'admin_1', role: 'admin' });

    expect(summary).toMatchObject({
      deletedUser: true,
      deletedSuppliers: 1,
      deletedPackages: 1,
      deletedPhotos: 1,
      deletedSupplierAnalytics: 1,
      deletedPublicCalendarEvents: 1,
      deletedMarketplaceListings: 1,
    });
    expect(db.data.users).toHaveLength(0);
    expect(db.data.suppliers).toHaveLength(0);
    expect(db.data.packages).toHaveLength(0);
    expect(db.data.bookings[0]).toMatchObject({ supplierDeleted: true, supplierId: null });
    const userDeleteOrder =
      db.deleteOne.mock.invocationCallOrder[
        db.deleteOne.mock.calls.findIndex(call => call[0] === 'users')
      ];
    const supplierDeleteOrder =
      db.deleteMany.mock.invocationCallOrder[
        db.deleteMany.mock.calls.findIndex(call => call[0] === 'suppliers')
      ];
    expect(supplierDeleteOrder).toBeDefined();
    expect(userDeleteOrder).toBeGreaterThan(supplierDeleteOrder);
  });

  test('admin-driven deletion cancels the user Stripe subscription before deleting the user', async () => {
    const db = buildDb({
      users: [{ id: 'usr_supplier', role: 'supplier', email: 'supplier@example.com' }],
      suppliers: [{ id: 'sup_1', ownerUserId: 'usr_supplier', approved: true }],
    });
    jest.doMock('../../db-unified', () => db);
    jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
    const cancelSubscriptionForAccountDeletion = jest.fn(async () => {});
    jest.doMock('../../services/subscriptionService', () => ({
      cancelSubscriptionForAccountDeletion,
    }));
    const { deleteUserAndOwnedData } = require('../../services/adminUserDeletion.service');

    const summary = await deleteUserAndOwnedData('usr_supplier', { id: 'admin_1', role: 'admin' });

    expect(cancelSubscriptionForAccountDeletion).toHaveBeenCalledWith('usr_supplier');
    expect(summary.deletedUser).toBe(true);
    expect(db.data.users).toHaveLength(0);
  });

  test('admin-driven deletion still proceeds if Stripe cancellation fails', async () => {
    const db = buildDb({
      users: [{ id: 'usr_supplier', role: 'supplier', email: 'supplier@example.com' }],
      suppliers: [],
    });
    jest.doMock('../../db-unified', () => db);
    jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
    jest.doMock('../../services/subscriptionService', () => ({
      cancelSubscriptionForAccountDeletion: jest.fn(async () => {
        throw new Error('Stripe unreachable');
      }),
    }));
    const { deleteUserAndOwnedData } = require('../../services/adminUserDeletion.service');

    const summary = await deleteUserAndOwnedData('usr_supplier', { id: 'admin_1', role: 'admin' });

    expect(summary.deletedUser).toBe(true);
    expect(summary.errors.some(e => e.includes('subscription:'))).toBe(true);
  });

  test('orphan audit dry-run detects orphan supplier/package and preserves legacy unowned suppliers', async () => {
    const db = buildDb({
      users: [{ id: 'usr_live' }],
      suppliers: [
        { id: 'sup_orphan', ownerUserId: 'usr_deleted' },
        { id: 'sup_legacy', ownerUserId: null },
      ],
      packages: [{ id: 'pkg_orphan', supplierId: 'sup_missing', approved: true }],
    });
    jest.doMock('../../db-unified', () => db);
    jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { auditOrphanedSupplierData } = require('../../scripts/audit-orphaned-supplier-data');

    const summary = await auditOrphanedSupplierData({ apply: false });

    expect(summary).toMatchObject({
      orphanSuppliers: 1,
      legacyUnownedSuppliers: 1,
      orphanPackages: 1,
      publicOrphanPackages: 1,
    });
    expect(db.data.suppliers).toHaveLength(2);
    expect(db.data.packages).toHaveLength(1);
  });

  test('orphan audit apply removes orphan public supplier/package data and invalidates caches', async () => {
    const db = buildDb({
      users: [],
      suppliers: [
        { id: 'sup_orphan', ownerUserId: 'usr_deleted' },
        { id: 'sup_legacy', ownerUserId: null },
      ],
      packages: [
        { id: 'pkg_1', supplierId: 'sup_orphan', approved: true },
        { id: 'pkg_2', supplierId: 'sup_missing', approved: true },
      ],
      photos: [{ id: 'photo_1', supplierId: 'sup_missing' }],
      supplierAnalytics: [{ id: 'a_1', supplierId: 'sup_missing' }],
    });
    jest.doMock('../../db-unified', () => db);
    jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const catalogCache = require('../../services/catalogCache');
    const { auditOrphanedSupplierData } = require('../../scripts/audit-orphaned-supplier-data');

    const summary = await auditOrphanedSupplierData({ apply: true });

    expect(summary.removedSuppliers).toBe(1);
    expect(summary.removedPackages).toBe(2);
    expect(summary.cacheInvalidated).toBe(true);
    expect(catalogCache.invalidate).toHaveBeenCalled();
    expect(db.data.suppliers).toEqual([{ id: 'sup_legacy', ownerUserId: null }]);
    expect(db.data.packages).toHaveLength(0);
  });
});
