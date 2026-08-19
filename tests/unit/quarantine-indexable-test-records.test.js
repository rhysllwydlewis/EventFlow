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
  category: 'Catering',
  location: 'Cardiff',
  description_short: 'Independent event catering for weddings and celebrations across South Wales.',
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
  supplierId: 'sup-ordinary',
  title: 'Full Day Wedding Photography',
  approved: true,
  description: 'A complete full-day package with planning, coverage and edited photographs included.',
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

  it('reads a signed --review-file path', () => {
    expect(parseArgs(['node', 'script.js', '--review-file', 'review.json']).reviewFile).toBe(
      'review.json'
    );
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

  it('marks each row confirmed or not, so a dry run previews exactly what --apply would (and would not) touch', async () => {
    const report = await run(parseArgs(['node', 'script.js']));
    const supplierRows = report.byCollection.suppliers.rows;
    const packageRows = report.byCollection.packages.rows;

    expect(supplierRows.find(row => row.id === 'sup-isTest').confirmed).toBe(true);
    expect(supplierRows.find(row => row.id === 'sup-romeo').confirmed).toBe(false);
    expect(supplierRows.find(row => row.id === 'sup-unapproved-test').confirmed).toBe(false);
    expect(packageRows.find(row => row.id === 'pkg-literal-test').confirmed).toBe(true);
    expect(packageRows.find(row => row.id === 'pkg-test-no2').confirmed).toBe(false);
  });
});

describe('--apply mode', () => {
  it('quarantines (unpublishes) only the confirmed tier: explicit isTest, or a name/slug that IS "test"', async () => {
    const report = await run(parseArgs(['node', 'script.js', '--apply']));

    expect(report.mode).toBe('apply');
    // Confirmed: sup-isTest (explicit flag) + pkg-literal-test (exact "Test"
    // title). Romeo Test / Draft Test Account / test-no2-yy7lo4 only match
    // the broader whole-word heuristic, so --apply must not touch them.
    expect(report.quarantinedNow).toBe(2);
    expect(report.failedWrites).toEqual([]);

    const isTestFlagRecord = await mockDb.findOne('suppliers', { id: 'sup-isTest' });
    expect(isTestFlagRecord.approved).toBe(false);
    expect(isTestFlagRecord.seoQuarantined).toBe(true);
    expect(isTestFlagRecord.seoQuarantineReason).toBe('test_fixture_record');

    const literalTitlePackage = await mockDb.findOne('packages', { id: 'pkg-literal-test' });
    expect(literalTitlePackage.approved).toBe(false);
    expect(literalTitlePackage.seoQuarantined).toBe(true);
  });

  it('never auto-unpublishes a record that only matches the broader name/slug heuristic — reports it for manual review instead', async () => {
    const report = await run(parseArgs(['node', 'script.js', '--apply']));

    expect(report.needsReview).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'sup-romeo' }),
        expect.objectContaining({ id: 'sup-unapproved-test' }),
        expect.objectContaining({ id: 'pkg-test-no2' }),
      ])
    );
    expect(report.needsReview).toHaveLength(3);

    const romeo = await mockDb.findOne('suppliers', { id: 'sup-romeo' });
    expect(romeo.approved).toBe(true); // untouched — data preserved
    expect(romeo.seoQuarantined).toBeUndefined();
    expect(romeo.name).toBe('Romeo Test');

    const pkg = await mockDb.findOne('packages', { id: 'pkg-test-no2' });
    expect(pkg.approved).toBe(true);
    expect(pkg.seoQuarantined).toBeUndefined();
  });

  it('leaves ordinary records completely untouched', async () => {
    await run(parseArgs(['node', 'script.js', '--apply']));
    const ordinary = await mockDb.findOne('suppliers', { id: 'sup-ordinary' });
    expect(ordinary.approved).toBe(true);
    expect(ordinary.seoQuarantined).toBeUndefined();
  });

  it('is idempotent: running twice does not error or double-mutate', async () => {
    const first = await run(parseArgs(['node', 'script.js', '--apply']));
    expect(first.quarantinedNow).toBe(2);

    const second = await run(parseArgs(['node', 'script.js', '--apply']));
    expect(second.quarantinedNow).toBe(0);
    expect(second.failedWrites).toEqual([]);
    expect(second.byCollection.suppliers.alreadyQuarantined).toBe(1);
    expect(second.byCollection.packages.alreadyQuarantined).toBe(1);

    const isTestFlagRecord = await mockDb.findOne('suppliers', { id: 'sup-isTest' });
    expect(isTestFlagRecord.seoQuarantined).toBe(true);
  });

  it('restricts writes to the requested collection only', async () => {
    await run(parseArgs(['node', 'script.js', '--apply', '--suppliers']));
    const pkg = await mockDb.findOne('packages', { id: 'pkg-literal-test' });
    expect(pkg.approved).toBe(true);
    expect(pkg.seoQuarantined).toBeUndefined();
  });

  it('reports approved but incomplete acquisition records without auto-mutating them', async () => {
    mockDb.seed('suppliers', [
      ordinarySupplier,
      { id: 'sup-incomplete', name: 'Imported Supplier', approved: true },
    ]);
    const dryRun = await run(parseArgs(['node', 'script.js', '--suppliers']));
    expect(dryRun.byCollection.suppliers.rows).toContainEqual(
      expect.objectContaining({
        id: 'sup-incomplete',
        candidateType: 'incomplete_acquisition',
        confirmed: false,
        eligibilityReasons: expect.arrayContaining(['missing_category_classification']),
      })
    );
    await run(parseArgs(['node', 'script.js', '--apply', '--suppliers']));
    expect((await mockDb.findOne('suppliers', { id: 'sup-incomplete' })).approved).toBe(true);
  });

  it('applies exact reviewed decisions and records before/after evidence', async () => {
    const report = await run(
      parseArgs([
        'node',
        'script.js',
        '--apply',
        '--review-file',
        'tests/fixtures/seo-review-example.json',
      ])
    );
    const romeo = report.byCollection.suppliers.rows.find(row => row.id === 'sup-romeo');
    const packageRow = report.byCollection.packages.rows.find(row => row.id === 'pkg-test-no2');
    expect(romeo.applyOutcome).toBe('quarantined');
    expect(romeo.before.approved).toBe(true);
    expect(romeo.after).toEqual(
      expect.objectContaining({ approved: false, seoQuarantined: true })
    );
    expect(packageRow.applyOutcome).toBe('reviewed_keep');
    expect((await mockDb.findOne('packages', { id: 'pkg-test-no2' })).approved).toBe(true);
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
