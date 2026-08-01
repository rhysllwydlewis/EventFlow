'use strict';

describe('auditLog persistence result', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function loadAudit(insertOne, uid = jest.fn(() => 'audit_1')) {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    jest.doMock('../../db-unified', () => ({
      uid,
      insertOne,
      read: jest.fn(async () => []),
    }));
    jest.doMock('../../utils/logger', () => logger);
    const { auditLog } = require('../../middleware/audit');
    return { auditLog, logger };
  }

  const params = {
    adminId: 'admin_1',
    adminEmail: 'admin@example.com',
    action: 'supplier_trust_badge_confirmed',
    targetType: 'supplier',
    targetId: 'sup_1',
  };

  test('returns the audit entry after a confirmed insert', async () => {
    const insertOne = jest.fn(async (_collection, entry) => entry);
    const { auditLog, logger } = loadAudit(insertOne);

    const result = await auditLog(params);

    expect(result).toMatchObject({
      id: 'audit_1',
      adminId: 'admin_1',
      targetId: 'sup_1',
    });
    expect(insertOne).toHaveBeenCalledWith(
      'audit_logs',
      expect.objectContaining({ id: 'audit_1' })
    );
    expect(logger.info).toHaveBeenCalled();
  });

  test('returns null when dbUnified normalizes a failed insert to null', async () => {
    const insertOne = jest.fn(async () => null);
    const { auditLog, logger } = loadAudit(insertOne);

    const result = await auditLog(params);

    expect(result).toBeNull();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  test('returns null when the audit insert throws', async () => {
    const insertOne = jest.fn(async () => {
      throw new Error('database unavailable');
    });
    const { auditLog, logger } = loadAudit(insertOne);

    const result = await auditLog(params);

    expect(result).toBeNull();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[AUDIT ERROR] Failed to write audit log:',
      'database unavailable'
    );
  });

  test('returns null instead of throwing if audit entry ID creation fails', async () => {
    const insertOne = jest.fn();
    const uid = jest.fn(() => {
      throw new Error('uid unavailable');
    });
    const { auditLog, logger } = loadAudit(insertOne, uid);

    await expect(auditLog(params)).resolves.toBeNull();
    expect(insertOne).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[AUDIT ERROR] Failed to write audit log:',
      'uid unavailable'
    );
  });
});
