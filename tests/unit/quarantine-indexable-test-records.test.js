/**
 * scripts/quarantine-indexable-test-records.js — dry-run-first quarantine
 * tooling for test/fixture supplier and package records that leaked into
 * the public index (SEO-006/SEO-007).
 */

'use strict';

const store = new Map();

const mockDb = {
  reset() {
    store.clear();
  },
  seed(collection, records) {
    store.set(
      collection,
      records.map(record => ({ ...record }))
    );
  },
  read: jest.fn(async collection => (store.get(collection) || []).map(record => ({ ...record }))),
  findOne: jest.fn(async (collection, filter) => {
    const entries = Object.entries(filter || {});
    const record = (store.get(collection) || []).find(item =>
      entries.every(([key, value]) => item[key] === value)
    );
    return record ? { ...record } : null;
  }),
  updateOne: jest.fn(async (collection, filter, updates) => {
    const records = store.get(collection) || [];
    const index = records.findIndex(item => item.id === filter.id);
    if (index === -1) {
      return false;
    }
    records[index] = { ...records[index], ...updates };
    return true;
  }),
  initializeDatabase: jest.fn(async () => {}),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { parseArgs, run } = require('../../scripts/quarantine-indexable-test-records');

const ordinarySupplier = {
  id: 'sup-ordinary',
  name: 'Contest Caterers Ltd',
  approved: true,
};
const testFlagSupplier = {
  id: 'sup-isTest',
  name: 'Seed Supplier Nine',
  approved: true,
  isTest: true,
};
const romeoTestSupplier = {
  id: 'sup-romeo',
  name: 'Romeo Test',
  approved: true,
};
const unapprovedTestSupplier = {
  id: 'sup-unapproved-test',
  name: 'Draft Test Account',
  approved: false,
};
const testPackage = {
  id: 'pkg-test-no2',
  slug: 'test-no2-yy7lo4',
  title: 'Photography package',
  approved: true,
};
const literalTestPackage = {
  id: 'pkg-literal-test',
  title: 'Test',
  approved: true,
};
const ordinaryPackage = {
  id: 'pkg-ordinary',
  title: 'Full Day Wedding Photography',
  approved: true,
};

beforeEach(() => {
  mockDb.reset();
  jest.clearAllMocks();
  mockDb.seed('suppliers', [
    ordinarySupplier,
    testFlagSupplier,
    romeoTestSupplier,
    unapprovedTestSupplier,
  ]);
  mockDb.seed('packages', [testPackage, literalTestPackage, ordinaryPackage]);
});

describe('parseArgs', () => {
  it('defaults to a dry run covering both collections', () => {
    const options = parseArgs(['node', 'script.js']);
    expect(options.apply).toBe(false);
    expect(options.suppliers).toBe(true);
    expect(options.packages).toBe(true);
  });

  it('recognises --apply', () => {
    expect(parseArgs(['node', 'script.js', '--apply']).apply).toBe(true);
  });

  it('restricts to one collection when asked', () => {
    expect(parseArgs(['node', 'script.js', '--suppliers']).packages).toBe(false);
    expect(parseArgs(['node', 'script.js', '--packages']).suppliers).toBe(false);
  });

  it('reads a --json output path', () => {
    expect(parseArgs(['node', 'script.js', '--json', 'out.json']).json).toBe('out.json');
  });
});

describe('dry run (default)', () => {
  it('reports every known test/fixture record and makes zero writes', async () => {
    const report = await run(parseArgs(['node', 'script.js']));

    expect(report.mode).toBe('dry-run');
    const ids = report.byCollection.suppliers.rows.map(row => row.id);
    expect(ids).toEqual(expect.arrayContaining(['sup-isTest', 'sup-romeo', 'sup-unapproved-test']));
    expect(ids).not.toContain('sup-ordinary');

    const packageIds = report.byCollection.packages.rows.map(row => row.id);
    expect(packageIds).toEqual(expect.arrayContaining(['pkg-test-no2', 'pkg-literal-test']));
    expect(packageIds).not.toContain('pkg-ordinary');

    expect(mockDb.updateOne).not.toHaveBeenCalled();
  });

  it('flags currently-live records separately from already-unapproved ones', async () => {
    const report = await run(parseArgs(['node', 'script.js']));
    const romeo = report.byCollection.suppliers.rows.find(row => row.id === 'sup-romeo');
    const draft = report.byCollection.suppliers.rows.find(row => row.id === 'sup-unapproved-test');
    expect(romeo.wasApproved).toBe(true);
    expect(draft.wasApproved).toBe(false);
    expect(report.wasLive).toBeGreaterThanOrEqual(1);
  });

  it('does not flag an ordinary business name that merely contains a substring like "contest"', async () => {
    const report = await run(parseArgs(['node', 'script.js']));
    const ids = report.byCollection.suppliers.rows.map(row => row.id);
    expect(ids).not.toContain('sup-ordinary');
  });
});

describe('--apply mode', () => {
  it('quarantines (unpublishes) every known test/fixture record rather than deleting it', async () => {
    const report = await run(parseArgs(['node', 'script.js', '--apply']));

    expect(report.mode).toBe('apply');
    expect(report.quarantinedNow).toBe(5); // 3 suppliers + 2 packages
    expect(report.failedWrites).toEqual([]);

    const stillThere = await mockDb.findOne('suppliers', { id: 'sup-romeo' });
    expect(stillThere).not.toBeNull();
    expect(stillThere.approved).toBe(false);
    expect(stillThere.seoQuarantined).toBe(true);
    expect(stillThere.seoQuarantineReason).toBe('test_fixture_record');
    expect(stillThere.name).toBe('Romeo Test'); // data preserved, not wiped
  });

  it('leaves ordinary records completely untouched', async () => {
    await run(parseArgs(['node', 'script.js', '--apply']));
    const ordinary = await mockDb.findOne('suppliers', { id: 'sup-ordinary' });
    expect(ordinary.approved).toBe(true);
    expect(ordinary.seoQuarantined).toBeUndefined();
  });

  it('is idempotent: running twice does not error or double-mutate', async () => {
    const first = await run(parseArgs(['node', 'script.js', '--apply']));
    expect(first.quarantinedNow).toBe(5);

    const second = await run(parseArgs(['node', 'script.js', '--apply']));
    expect(second.quarantinedNow).toBe(0);
    expect(second.failedWrites).toEqual([]);
    expect(second.byCollection.suppliers.alreadyQuarantined).toBe(3);
    expect(second.byCollection.packages.alreadyQuarantined).toBe(2);

    const romeo = await mockDb.findOne('suppliers', { id: 'sup-romeo' });
    expect(romeo.seoQuarantined).toBe(true);
  });

  it('restricts writes to the requested collection only', async () => {
    await run(parseArgs(['node', 'script.js', '--apply', '--suppliers']));
    const pkg = await mockDb.findOne('packages', { id: 'pkg-test-no2' });
    expect(pkg.approved).toBe(true);
    expect(pkg.seoQuarantined).toBeUndefined();
  });
});

describe('interaction with the sitemap (SEO-007)', () => {
  it('a test/fixture record that leaked into approved data never reaches the sitemap, before or after quarantine', async () => {
    jest.resetModules();
    const dbUnifiedForSitemap = require('../../db-unified');
    dbUnifiedForSitemap.read.mockImplementation(async collection =>
      (store.get(collection) || []).map(record => ({ ...record }))
    );
    const { generateSitemap } = require('../../sitemap');

    const beforeXml = await generateSitemap('https://event-flow.co.uk');
    expect(beforeXml).not.toContain('test-no2-yy7lo4');
    expect(beforeXml).not.toContain('sup-romeo');

    await run(parseArgs(['node', 'script.js', '--apply']));
    const afterXml = await generateSitemap('https://event-flow.co.uk');
    expect(afterXml).not.toContain('test-no2-yy7lo4');
    expect(afterXml).not.toContain('sup-romeo');
  });
});
