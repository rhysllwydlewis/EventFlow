'use strict';

const mockDb = {
  read: jest.fn(),
  updateOne: jest.fn().mockResolvedValue(true),
};
jest.mock('../../db-unified', () => mockDb);
jest.mock('../../utils/auditTrail', () => ({ createAuditLog: jest.fn().mockResolvedValue(true) }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { batchApprove } = require('../../services/adminService');

describe('moderation approval paths', () => {
  test('batch approval refuses confirmed fixtures and approves only ordinary records', async () => {
    mockDb.read.mockResolvedValue([
      { id: 'fixture', title: 'Test', approved: false },
      { id: 'real', title: 'Full Day Photography', approved: false },
    ]);
    const result = await batchApprove({
      type: 'packages',
      ids: ['fixture', 'real'],
      actor: { id: 'admin-1' },
    });
    expect(result.data.approved).toBe(1);
    expect(result.data.errors).toContainEqual(
      expect.objectContaining({ id: 'fixture', code: 'confirmed_test_fixture' })
    );
    expect(mockDb.updateOne).toHaveBeenCalledTimes(1);
    expect(mockDb.updateOne).toHaveBeenCalledWith(
      'packages',
      { id: 'real' },
      expect.any(Object)
    );
  });
});
