'use strict';

const DateManagementService = require('../../services/dateManagementService');

function logger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe('policy review date management', () => {
  it('compares source changes to reviewed dates by calendar day', async () => {
    const service = new DateManagementService(null, logger());
    service.getLastCommitDate = jest.fn(() => new Date('2026-08-06T23:59:59.000Z'));

    const result = await service.hasLegalContentChanged();

    expect(result.changed).toBe(false);
    expect(result.files.every(file => file.needsReview === false)).toBe(true);
  });

  it('flags a source change after review without changing public dates', async () => {
    const service = new DateManagementService(null, logger());
    service.hasLegalContentChanged = jest.fn().mockResolvedValue({
      changed: true,
      reason: '1 policy source file(s) changed after review',
      changedFiles: [{ sourcePath: 'public/terms.html' }],
    });
    service.notifyAdmins = jest.fn().mockResolvedValue(undefined);
    service.updateLegalDates = jest.fn();

    const result = await service.performMonthlyCheck({ trigger: 'manual', userId: 'admin-1' });

    expect(result.performed).toBe(true);
    expect(result.notified).toBe(true);
    expect(result.datesChanged).toBe(false);
    expect(service.updateLegalDates).not.toHaveBeenCalled();
    expect(service.notifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REVIEW_REQUIRED',
        trigger: 'manual',
        requestedBy: 'admin-1',
      })
    );
  });

  it('refuses runtime policy-date mutation', async () => {
    const service = new DateManagementService(null, logger());
    await expect(service.updateLegalDates()).resolves.toEqual(
      expect.objectContaining({
        success: false,
        code: 'POLICY_METADATA_REVIEW_REQUIRED',
      })
    );
  });
});
