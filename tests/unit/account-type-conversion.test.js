'use strict';

function mockLogger() {
  jest.doMock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }));
}

function matches(row, filter) {
  return Object.keys(filter).every(key => row[key] === filter[key]);
}

function makeDbUnified(seed = {}) {
  const data = { users: [], suppliers: [], audit_logs: [], ...seed };
  let idCounter = 0;
  return {
    data,
    uid: jest.fn(prefix => `${prefix}_${++idCounter}`),
    find: jest.fn(async (collection, filter = {}) =>
      (data[collection] || []).filter(row => matches(row, filter))
    ),
    findOne: jest.fn(
      async (collection, filter) =>
        (data[collection] || []).find(row => matches(row, filter)) || null
    ),
    insertOne: jest.fn(async (collection, doc) => {
      data[collection] = data[collection] || [];
      data[collection].push(doc);
      return doc;
    }),
    updateOne: jest.fn(async (collection, filter, update) => {
      const rows = data[collection] || [];
      const row = rows.find(item => matches(item, filter));
      if (!row) {
        return false;
      }
      Object.assign(row, update.$set || update);
      if (update.$unset) {
        for (const key of Object.keys(update.$unset)) {
          delete row[key];
        }
      }
      return true;
    }),
  };
}

describe('accountTypeConversion.service', () => {
  const actorSelf = { type: 'self', id: 'usr_1', email: 'usr@example.com' };
  const actorAdmin = { type: 'admin', id: 'usr_admin', email: 'admin@example.com' };

  beforeEach(() => {
    jest.resetModules();
    mockLogger();
  });

  function loadService(dbUnified) {
    jest.doMock('../../db-unified', () => dbUnified);
    jest.doMock('../../services/catalogCache', () => ({
      invalidate: jest.fn(async () => undefined),
    }));
    jest.doMock('../../services/subscriptionService', () => ({
      cancelSubscriptionForAccountDeletion: jest.fn(async () => undefined),
    }));
    return require('../../services/accountTypeConversion.service');
  }

  describe('convertToSupplier', () => {
    it('flips the role, provisions a supplier profile, and records an audit entry', async () => {
      const dbUnified = makeDbUnified({
        users: [{ id: 'usr_1', role: 'customer', email: 'usr@example.com', company: '' }],
      });
      const service = loadService(dbUnified);

      const result = await service.convertToSupplier(dbUnified.data.users[0], {
        supplierInfo: { company: 'Acme Events', category: 'Catering', location: 'London' },
        actor: actorSelf,
      });

      expect(result.role).toBe('supplier');
      expect(result.previousRole).toBe('customer');
      expect(dbUnified.data.users[0].role).toBe('supplier');
      expect(dbUnified.data.users[0].previousRole).toBe('customer');
      expect(dbUnified.data.users[0].lastAccountTypeChangeAt).toBeTruthy();
      expect(dbUnified.data.suppliers).toHaveLength(1);
      expect(dbUnified.data.suppliers[0]).toMatchObject({
        ownerUserId: 'usr_1',
        name: 'Acme Events',
        category: 'Catering',
      });
      expect(dbUnified.data.audit_logs).toHaveLength(1);
      expect(dbUnified.data.audit_logs[0]).toMatchObject({
        action: 'user_role_changed',
        details: expect.objectContaining({ initiatedBy: 'self', from: 'customer', to: 'supplier' }),
      });
    });

    it('rejects self-service conversion without a company name', async () => {
      const dbUnified = makeDbUnified({
        users: [{ id: 'usr_1', role: 'customer', email: 'usr@example.com' }],
      });
      const service = loadService(dbUnified);

      await expect(
        service.convertToSupplier(dbUnified.data.users[0], { supplierInfo: {}, actor: actorSelf })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', field: 'company' });
      expect(dbUnified.data.users[0].role).toBe('customer');
    });

    it('rolls back the role change if supplier profile provisioning fails', async () => {
      const dbUnified = makeDbUnified({
        users: [{ id: 'usr_1', role: 'customer', email: 'usr@example.com' }],
      });
      dbUnified.insertOne = jest.fn(async () => null);
      // Force the provisioning service's post-insert-failure re-read to also fail.
      dbUnified.findOne = jest.fn(async (collection, filter) => {
        if (collection === 'suppliers') {
          return null;
        }
        return (dbUnified.data[collection] || []).find(row => matches(row, filter)) || null;
      });
      const service = loadService(dbUnified);

      await expect(
        service.convertToSupplier(dbUnified.data.users[0], {
          supplierInfo: { company: 'Acme Events' },
          actor: actorSelf,
        })
      ).rejects.toMatchObject({ code: 'SUPPLIER_PROFILE_PROVISIONING_FAILED' });

      expect(dbUnified.data.users[0].role).toBe('customer');
      expect(dbUnified.data.users[0].previousRole).toBeUndefined();
      expect(dbUnified.data.users[0].lastAccountTypeChangeAt).toBeUndefined();
    });

    it('reactivates a profile suspended by a previous conversion instead of leaving it suspended', async () => {
      const dbUnified = makeDbUnified({
        users: [{ id: 'usr_1', role: 'customer', email: 'usr@example.com' }],
        suppliers: [
          {
            id: 'sup_1',
            ownerUserId: 'usr_1',
            name: 'Acme Events',
            status: 'suspended',
            verificationStatus: 'suspended',
            approved: false,
            verified: false,
            suspendedReason: 'owner_converted_to_customer',
          },
        ],
      });
      const service = loadService(dbUnified);

      const result = await service.convertToSupplier(dbUnified.data.users[0], {
        supplierInfo: { company: 'Acme Events' },
        actor: actorSelf,
      });

      expect(dbUnified.data.suppliers).toHaveLength(1);
      expect(result.supplierProfile).toMatchObject({
        id: 'sup_1',
        status: 'draft',
        verificationStatus: 'pending_review',
        approved: false,
      });
      expect(dbUnified.data.suppliers[0].suspendedReason).toBeUndefined();
    });

    it('rejects converting an admin account', async () => {
      const dbUnified = makeDbUnified({
        users: [{ id: 'usr_1', role: 'admin', email: 'usr@example.com' }],
      });
      const service = loadService(dbUnified);

      await expect(
        service.convertToSupplier(dbUnified.data.users[0], {
          supplierInfo: { company: 'Acme' },
          actor: actorSelf,
        })
      ).rejects.toMatchObject({ code: 'ADMIN_ROLE_PROTECTED' });
    });

    it('does not write lastAccountTypeChangeAt for an admin-initiated conversion', async () => {
      // An admin-initiated conversion must not start/reset the user's own
      // self-service cooldown — otherwise a support fix would lock the user
      // out of converting themselves again for 30 days.
      const dbUnified = makeDbUnified({
        users: [{ id: 'usr_1', role: 'customer', email: 'usr@example.com' }],
      });
      const service = loadService(dbUnified);

      await service.convertToSupplier(dbUnified.data.users[0], {
        supplierInfo: { company: 'Acme' },
        actor: actorAdmin,
      });

      expect(dbUnified.data.users[0].role).toBe('supplier');
      expect(dbUnified.data.users[0].lastAccountTypeChangeAt).toBeUndefined();
      expect(dbUnified.data.users[0].previousRole).toBe('customer');
    });

    it('restores prior previousRole/lastAccountTypeChangeAt (not unset) when provisioning fails after a previous conversion', async () => {
      const priorChangeAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago, outside cooldown
      const dbUnified = makeDbUnified({
        users: [
          {
            id: 'usr_1',
            role: 'customer',
            email: 'usr@example.com',
            previousRole: 'supplier', // this user converted supplier -> customer once before
            lastAccountTypeChangeAt: priorChangeAt,
          },
        ],
      });
      dbUnified.insertOne = jest.fn(async () => null);
      dbUnified.findOne = jest.fn(async (collection, filter) => {
        if (collection === 'suppliers') {
          return null;
        }
        return (dbUnified.data[collection] || []).find(row => matches(row, filter)) || null;
      });
      const service = loadService(dbUnified);

      await expect(
        service.convertToSupplier(dbUnified.data.users[0], {
          supplierInfo: { company: 'Acme Events' },
          actor: actorSelf,
        })
      ).rejects.toMatchObject({ code: 'SUPPLIER_PROFILE_PROVISIONING_FAILED' });

      expect(dbUnified.data.users[0].role).toBe('customer');
      // Must restore the pre-attempt values, not wipe this user's real history.
      expect(dbUnified.data.users[0].previousRole).toBe('supplier');
      expect(dbUnified.data.users[0].lastAccountTypeChangeAt).toBe(priorChangeAt);
    });

    it('propagates a supplier-profile reactivation failure as a provisioning failure and rolls back the role', async () => {
      const dbUnified = makeDbUnified({
        users: [{ id: 'usr_1', role: 'customer', email: 'usr@example.com' }],
        suppliers: [
          {
            id: 'sup_1',
            ownerUserId: 'usr_1',
            name: 'Acme Events',
            status: 'suspended',
            verificationStatus: 'suspended',
            approved: false,
            verified: false,
            suspendedReason: 'owner_converted_to_customer',
          },
        ],
      });
      const originalUpdateOne = dbUnified.updateOne;
      dbUnified.updateOne = jest.fn(async (collection, filter, update) => {
        if (collection === 'suppliers') {
          // Simulate a transient write failure during reactivation.
          return false;
        }
        return originalUpdateOne(collection, filter, update);
      });
      const service = loadService(dbUnified);

      await expect(
        service.convertToSupplier(dbUnified.data.users[0], {
          supplierInfo: { company: 'Acme Events' },
          actor: actorSelf,
        })
      ).rejects.toMatchObject({ code: 'SUPPLIER_PROFILE_PROVISIONING_FAILED' });

      // Must not silently succeed with a still-suspended listing.
      expect(dbUnified.data.users[0].role).toBe('customer');
      expect(dbUnified.data.suppliers[0].status).toBe('suspended');
    });

    it('enforces the self-service cooldown but not the admin path', async () => {
      const recentChange = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
      const dbUnified = makeDbUnified({
        users: [
          {
            id: 'usr_1',
            role: 'customer',
            email: 'usr@example.com',
            lastAccountTypeChangeAt: recentChange,
          },
        ],
      });
      const service = loadService(dbUnified);

      await expect(
        service.convertToSupplier(dbUnified.data.users[0], {
          supplierInfo: { company: 'Acme' },
          actor: actorSelf,
        })
      ).rejects.toMatchObject({ code: 'COOLDOWN_ACTIVE' });
      expect(dbUnified.data.users[0].role).toBe('customer');

      // Admin-initiated conversions are exempt from the same cooldown.
      const result = await service.convertToSupplier(dbUnified.data.users[0], {
        supplierInfo: { company: 'Acme' },
        actor: actorAdmin,
      });
      expect(result.role).toBe('supplier');
    });
  });

  describe('convertToCustomer', () => {
    function supplierUser(overrides = {}) {
      return { id: 'usr_2', role: 'supplier', email: 'sup@example.com', ...overrides };
    }

    it('suspends the linked supplier profile with the full four-field recipe and invalidates the catalog cache', async () => {
      const dbUnified = makeDbUnified({
        users: [supplierUser()],
        suppliers: [
          {
            id: 'sup_2',
            ownerUserId: 'usr_2',
            status: 'published',
            approved: true,
            verified: true,
            verificationStatus: 'approved',
          },
        ],
      });
      const catalogCache = { invalidate: jest.fn(async () => undefined) };
      jest.doMock('../../db-unified', () => dbUnified);
      jest.doMock('../../services/catalogCache', () => catalogCache);
      jest.doMock('../../services/subscriptionService', () => ({
        cancelSubscriptionForAccountDeletion: jest.fn(async () => undefined),
      }));
      const service = require('../../services/accountTypeConversion.service');

      const result = await service.convertToCustomer(dbUnified.data.users[0], { actor: actorSelf });

      expect(result.role).toBe('customer');
      expect(result.supplierSuspended).toBe(true);
      expect(dbUnified.data.users[0].role).toBe('customer');
      expect(dbUnified.data.suppliers[0]).toMatchObject({
        approved: false,
        verified: false,
        verificationStatus: 'suspended',
        status: 'suspended',
        suspendedReason: 'owner_converted_to_customer',
      });
      expect(catalogCache.invalidate).toHaveBeenCalled();
    });

    it('rolls back the role change if the supplier suspend write fails', async () => {
      const dbUnified = makeDbUnified({
        users: [supplierUser()],
        suppliers: [{ id: 'sup_2', ownerUserId: 'usr_2', status: 'published', approved: true }],
      });
      const originalUpdateOne = dbUnified.updateOne;
      dbUnified.updateOne = jest.fn(async (collection, filter, update) => {
        if (collection === 'suppliers') {
          return false;
        }
        return originalUpdateOne(collection, filter, update);
      });
      const service = loadService(dbUnified);

      await expect(
        service.convertToCustomer(dbUnified.data.users[0], { actor: actorSelf })
      ).rejects.toMatchObject({ code: 'SUPPLIER_SUSPEND_FAILED' });

      expect(dbUnified.data.users[0].role).toBe('supplier');
    });

    it('restores prior previousRole/lastAccountTypeChangeAt (not unset) when the suspend write fails after a previous conversion', async () => {
      const priorChangeAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const dbUnified = makeDbUnified({
        users: [
          supplierUser({
            previousRole: 'customer', // converted customer -> supplier once before
            lastAccountTypeChangeAt: priorChangeAt,
          }),
        ],
        suppliers: [{ id: 'sup_2', ownerUserId: 'usr_2', status: 'published', approved: true }],
      });
      const originalUpdateOne = dbUnified.updateOne;
      dbUnified.updateOne = jest.fn(async (collection, filter, update) => {
        if (collection === 'suppliers') {
          return false;
        }
        return originalUpdateOne(collection, filter, update);
      });
      const service = loadService(dbUnified);

      await expect(
        service.convertToCustomer(dbUnified.data.users[0], { actor: actorSelf })
      ).rejects.toMatchObject({ code: 'SUPPLIER_SUSPEND_FAILED' });

      expect(dbUnified.data.users[0].role).toBe('supplier');
      expect(dbUnified.data.users[0].previousRole).toBe('customer');
      expect(dbUnified.data.users[0].lastAccountTypeChangeAt).toBe(priorChangeAt);
    });

    it('does not write lastAccountTypeChangeAt for an admin-initiated downgrade', async () => {
      const dbUnified = makeDbUnified({ users: [supplierUser()] });
      const service = loadService(dbUnified);

      await service.convertToCustomer(dbUnified.data.users[0], { actor: actorAdmin });

      expect(dbUnified.data.users[0].role).toBe('customer');
      expect(dbUnified.data.users[0].lastAccountTypeChangeAt).toBeUndefined();
    });

    it('does not require a linked supplier profile to exist', async () => {
      const dbUnified = makeDbUnified({ users: [supplierUser()] });
      const service = loadService(dbUnified);

      const result = await service.convertToCustomer(dbUnified.data.users[0], { actor: actorSelf });

      expect(result.role).toBe('customer');
      expect(result.supplierSuspended).toBe(false);
    });

    it('rejects converting an already-customer account', async () => {
      const dbUnified = makeDbUnified({ users: [{ id: 'usr_3', role: 'customer' }] });
      const service = loadService(dbUnified);

      await expect(
        service.convertToCustomer(dbUnified.data.users[0], { actor: actorSelf })
      ).rejects.toMatchObject({ code: 'ALREADY_TARGET_ROLE' });
    });
  });
});
