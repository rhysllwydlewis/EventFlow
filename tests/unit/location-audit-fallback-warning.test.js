/**
 * The supplier and marketplace-listing location audits must say so when they
 * did not read from a healthy MongoDB connection, because local file storage
 * holds none of the production data and an all-zero report against it looks
 * exactly like a clean result. (scripts/audit-orphaned-supplier-data.js
 * already does this; see issue #1696.)
 */

'use strict';

const mockDb = {
  initializeDatabase: jest.fn(async () => 'local'),
  getDatabaseStatus: jest.fn(() => ({ type: 'local', connected: false })),
  getDatabaseType: jest.fn(() => 'local'),
  read: jest.fn(async () => []),
  findOne: jest.fn(async () => null),
  updateOne: jest.fn(async () => true),
  getReadFallbackCount: jest.fn(() => 0),
};
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../utils/logger', () => mockLogger);

const scripts = {
  'audit-supplier-locations': require('../../scripts/audit-supplier-locations'),
  'audit-marketplace-listing-locations': require('../../scripts/audit-marketplace-listing-locations'),
};

const healthy = { type: 'mongodb', connected: true, state: 'completed', error: null };
const fallbacks = {
  'local storage': { type: 'local', connected: false, state: 'completed', error: null },
  'mongodb that is not connected': {
    type: 'mongodb',
    connected: false,
    state: 'failed',
    error: 'x',
  },
  'failed init': { type: 'unknown', connected: false, state: 'failed', error: 'boom' },
};

describe.each(Object.entries(scripts))('%s fallback warning', (_name, script) => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.getReadFallbackCount.mockReturnValue(0);
  });

  const warningsAfterPrinting = async backend => {
    const report = await script.run(script.parseArgs(['node', 'script']), backend);
    script.printReport(report);
    return mockLogger.warn.mock.calls.map(call => call[0]);
  };

  test('no warning when reading from healthy MongoDB', async () => {
    expect(script.backendFallbackWarning(healthy)).toBeNull();
    expect(await warningsAfterPrinting(healthy)).toEqual([]);
  });

  test.each(Object.entries(fallbacks))(
    'warns that 0 findings is inconclusive on %s',
    async (_label, backend) => {
      expect(script.backendFallbackWarning(backend)).toMatch(/inconclusive/);
      const warnings = await warningsAfterPrinting(backend);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/local fallback storage/);
      expect(warnings[0]).toMatch(/inconclusive, not clean/);
    }
  );

  test('warns when a read fell back mid-run even though the backend still says MongoDB', async () => {
    expect(script.backendFallbackWarning(healthy, 2)).toMatch(/2 read\(s\) failed/);
    mockDb.getReadFallbackCount.mockReturnValue(1);
    const warnings = await warningsAfterPrinting(healthy);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/served from local fallback storage/);
    expect(warnings[0]).toMatch(/inconclusive, not clean/);
  });
});
