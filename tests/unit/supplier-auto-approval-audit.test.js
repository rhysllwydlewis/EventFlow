'use strict';

describe('supplier automatic approval audit', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('records an approval audit event when provisioning auto-approves a supplier', async () => {
    const auditLog = jest.fn(async () => ({ id: 'audit_1' }));
    const dbUnified = {
      read: jest.fn(async collection =>
        collection === 'settings' ? { features: { autoApproveSupplierVerification: true } } : []
      ),
      findOne: jest.fn(async () => null),
      insertOne: jest.fn(async (_collection, doc) => doc),
      uid: jest.fn(prefix => `${prefix}_new`),
    };

    jest.doMock('../../db-unified', () => dbUnified);
    jest.doMock('../../middleware/audit', () => ({
      auditLog,
      AUDIT_ACTIONS: { SUPPLIER_APPROVED: 'supplier_approved' },
    }));
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    const {
      ensureSupplierProfileForUser,
    } = require('../../services/supplierProfileProvisioning.service');
    const supplier = await ensureSupplierProfileForUser({
      id: 'usr_supplier',
      role: 'supplier',
      email: 'supplier@example.com',
      company: 'Example Events',
    });

    expect(supplier).toMatchObject({
      id: 'sup_new',
      approved: true,
      approvedBy: 'system',
      verificationStatus: 'approved',
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'system',
        adminEmail: 'system',
        action: 'supplier_approved',
        targetType: 'supplier',
        targetId: 'sup_new',
        details: expect.objectContaining({ source: 'autoApproveSupplierVerification' }),
      })
    );
  });

  test('does not record approval audit when auto-approval is disabled', async () => {
    const auditLog = jest.fn();
    const dbUnified = {
      read: jest.fn(async collection =>
        collection === 'settings' ? { features: { autoApproveSupplierVerification: false } } : []
      ),
      findOne: jest.fn(async () => null),
      insertOne: jest.fn(async (_collection, doc) => doc),
      uid: jest.fn(prefix => `${prefix}_new`),
    };

    jest.doMock('../../db-unified', () => dbUnified);
    jest.doMock('../../middleware/audit', () => ({
      auditLog,
      AUDIT_ACTIONS: { SUPPLIER_APPROVED: 'supplier_approved' },
    }));
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    const {
      ensureSupplierProfileForUser,
    } = require('../../services/supplierProfileProvisioning.service');
    const supplier = await ensureSupplierProfileForUser({
      id: 'usr_supplier',
      role: 'supplier',
      email: 'supplier@example.com',
    });

    expect(supplier.approved).toBe(false);
    expect(auditLog).not.toHaveBeenCalled();
  });
});
