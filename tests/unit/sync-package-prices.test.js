'use strict';

jest.mock('../../db-unified', () => require('../helpers/fake-db-unified'));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const fakeDb = require('../helpers/fake-db-unified');
const { syncPackagePrices, planPriceSync } = require('../../scripts/sync-package-prices');
const { packagePriceText } = require('../../utils/packagePrice');

const MONGO = { type: 'mongodb', connected: true };

const seed = () => ({
  packages: [
    { id: 'same', price: '£500', price_display: '£500' },
    { id: 'diverged', price: '£500', price_display: 'From £900' },
    { id: 'admin-only', price_display: 'From £700' },
    { id: 'supplier-only', price: '£300' },
    { id: 'numeric', price: 450 },
    { id: 'nothing', title: 'No price at all' },
  ],
});

beforeEach(() => fakeDb.__reset(seed()));

describe('planPriceSync', () => {
  test('keeps the price the site shows today and brings the other field into line', () => {
    const plan = planPriceSync(seed().packages);

    expect(plan.consistent).toBe(1);
    expect(plan.noPrice).toEqual(['nothing']);
    expect(plan.needsFix.map(item => [item.id, item.to])).toEqual([
      ['diverged', 'From £900'],
      ['admin-only', 'From £700'],
      ['supplier-only', '£300'],
      ['numeric', '450'],
    ]);
  });
});

describe('the catalog cache after a repair', () => {
  test('is cleared when prices were repaired, and not when nothing was', async () => {
    const invalidateCache = jest.fn(async () => undefined);
    const dry = await syncPackagePrices({ backend: MONGO, invalidateCache });
    expect(dry.cacheCleared).toBe(false);
    const applied = await syncPackagePrices({
      apply: true,
      prefer: 'shown',
      backend: MONGO,
      invalidateCache,
    });
    expect(applied.updated).toBeGreaterThan(0);
    expect(applied.cacheCleared).toBe(true);
    expect(invalidateCache).toHaveBeenCalledTimes(1);
    // Nothing left to repair: the second run does not clear it again.
    const again = await syncPackagePrices({
      apply: true,
      prefer: 'shown',
      backend: MONGO,
      invalidateCache,
    });
    expect(again.cacheCleared).toBe(false);
    expect(invalidateCache).toHaveBeenCalledTimes(1);
  });

  test('a cache that cannot be cleared does not hide that the prices were repaired', async () => {
    const report = await syncPackagePrices({
      apply: true,
      prefer: 'shown',
      backend: MONGO,
      invalidateCache: async () => {
        throw new Error('redis down');
      },
    });
    expect(report.updated).toBeGreaterThan(0);
    expect(report.cacheCleared).toBe(false);
  });
});

describe('syncPackagePrices', () => {
  test('a dry run reports and changes nothing', async () => {
    const report = await syncPackagePrices({ backend: MONGO });

    expect(report).toMatchObject({
      mode: 'dry-run',
      packages: 6,
      consistent: 1,
      needingFix: 4,
      updated: 0,
      withoutAnyPrice: 1,
      fixIds: ['diverged', 'admin-only', 'supplier-only', 'numeric'],
    });
    expect(fakeDb.__store().packages).toEqual(seed().packages);
  });

  test('--apply makes both fields equal and never changes the price a customer sees', async () => {
    const before = Object.fromEntries(seed().packages.map(pkg => [pkg.id, packagePriceText(pkg)]));

    const report = await syncPackagePrices({ apply: true, prefer: 'shown', backend: MONGO });

    expect(report).toMatchObject({ mode: 'apply', updated: 4 });
    fakeDb.__store().packages.forEach(pkg => {
      expect(packagePriceText(pkg)).toBe(before[pkg.id]);
      if (before[pkg.id]) {
        expect(pkg.price).toBe(before[pkg.id]);
        expect(pkg.price_display).toBe(before[pkg.id]);
      }
    });
    expect(fakeDb.__store().packages.find(pkg => pkg.id === 'nothing')).toEqual({
      id: 'nothing',
      title: 'No price at all',
    });
  });

  test('running it again finds nothing left to do', async () => {
    await syncPackagePrices({ apply: true, prefer: 'shown', backend: MONGO });
    const again = await syncPackagePrices({ apply: true, prefer: 'shown', backend: MONGO });

    expect(again).toMatchObject({ needingFix: 0, updated: 0, consistent: 5 });
  });

  test('refuses --apply anywhere but a connected MongoDB, and changes nothing', async () => {
    await expect(
      syncPackagePrices({ apply: true, backend: { type: 'local', connected: true } })
    ).rejects.toThrow(/Refusing to --apply/);
    await expect(
      syncPackagePrices({ apply: true, backend: { type: 'mongodb', connected: false } })
    ).rejects.toThrow(/Refusing to --apply/);
    expect(fakeDb.__store().packages).toEqual(seed().packages);
  });

  test('the report lists packages that hold two different prices, with both, and nothing else', async () => {
    const report = await syncPackagePrices({ backend: MONGO });
    expect(report.conflictCount).toBe(1);
    expect(report.conflicts).toEqual([
      { id: 'diverged', price: '£500', price_display: 'From £900', wouldKeep: 'From £900' },
    ]);
    // No package titles or other text: ids and the two prices only.
    expect(JSON.stringify(report)).not.toMatch(/No price at all/);
  });
});

describe('packages that hold two different prices', () => {
  test('--apply refuses until someone chooses which price wins, and changes nothing', async () => {
    await expect(syncPackagePrices({ apply: true, backend: MONGO })).rejects.toMatchObject({
      name: 'DecisionNeededError',
      message: expect.stringMatching(/--prefer=shown.*--prefer=price/),
    });
    expect(fakeDb.__store().packages).toEqual(seed().packages);
  });

  test('--prefer=shown keeps what the public site shows today', async () => {
    await syncPackagePrices({ apply: true, prefer: 'shown', backend: MONGO });
    const diverged = fakeDb.__store().packages.find(pkg => pkg.id === 'diverged');
    expect(diverged).toMatchObject({ price: 'From £900', price_display: 'From £900' });
  });

  test("--prefer=price keeps the supplier's own price, and the report says so first", async () => {
    const dryRun = await syncPackagePrices({ prefer: 'price', backend: MONGO });
    expect(dryRun.conflicts[0]).toMatchObject({ id: 'diverged', wouldKeep: '£500' });
    expect(fakeDb.__store().packages).toEqual(seed().packages);

    await syncPackagePrices({ apply: true, prefer: 'price', backend: MONGO });
    const diverged = fakeDb.__store().packages.find(pkg => pkg.id === 'diverged');
    expect(diverged).toMatchObject({ price: '£500', price_display: '£500' });
  });

  test('--prefer only matters for conflicts: filling in a missing field needs no decision', async () => {
    fakeDb.__reset({
      packages: [
        { id: 'admin-only', price_display: 'From £700' },
        { id: 'supplier-only', price: '£300' },
      ],
    });
    const report = await syncPackagePrices({ apply: true, backend: MONGO });
    expect(report).toMatchObject({ updated: 2, conflictCount: 0 });
  });

  test('planPriceSync flags only the packages with two different non-empty prices', () => {
    const plan = planPriceSync(seed().packages);
    expect(plan.needsFix.filter(item => item.conflict).map(item => item.id)).toEqual(['diverged']);
  });
});
