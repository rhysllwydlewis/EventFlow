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

    const report = await syncPackagePrices({ apply: true, backend: MONGO });

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
    await syncPackagePrices({ apply: true, backend: MONGO });
    const again = await syncPackagePrices({ apply: true, backend: MONGO });

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

  test('the report carries ids only, no supplier or customer text', async () => {
    const report = await syncPackagePrices({ backend: MONGO });
    expect(JSON.stringify(report)).not.toMatch(/£|No price at all/);
  });
});
