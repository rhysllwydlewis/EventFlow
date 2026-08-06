'use strict';

const fs = require('fs');
const path = require('path');

const DateManagementService = require('../../services/dateManagementService');

const ADMIN_ROUTES = path.resolve(__dirname, '../../routes/admin.js');

function logger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe('policy review date management', () => {
  it('reports unknown rather than up to date when deployment git evidence is unavailable', () => {
    const service = new DateManagementService(null, logger());
    service.getLastCommitDate = jest.fn(() => null);
    const result = service.hasLegalContentChanged();
    expect(result).toEqual(expect.objectContaining({ changed: false, evidenceAvailable: false }));
    expect(result.reason).toContain('unknown');
  });
  it('compares source changes to reviewed dates by calendar day', () => {
    const service = new DateManagementService(null, logger());
    service.getLastCommitDate = jest.fn(() => new Date('2026-08-06T23:59:59.000Z'));

    const result = service.hasLegalContentChanged();

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

  it('refuses runtime policy-date mutation', () => {
    const service = new DateManagementService(null, logger());
    expect(service.updateLegalDates()).toEqual(
      expect.objectContaining({
        success: false,
        code: 'POLICY_METADATA_REVIEW_REQUIRED',
      })
    );
  });

  it('keeps legacy admin endpoints read-only instead of retaining a mutation bypass', () => {
    const routes = fs.readFileSync(ADMIN_ROUTES, 'utf8');

    expect(routes).not.toContain('dateService.updateLegalDates');
    expect(routes).not.toContain("action: 'MANUAL_DATE_UPDATE'");
    expect(routes).not.toContain('legalLastUpdated:\\s*[');
    expect(routes).not.toContain('legalEffectiveDate:\\s*[');
  });
});
