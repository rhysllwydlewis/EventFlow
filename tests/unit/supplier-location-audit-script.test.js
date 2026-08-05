/**
 * The supplier location audit script.
 *
 * The rule under test is the one that matters operationally: a dry run must
 * change nothing, and even an --apply run must only write mappings it is sure
 * of.
 */

'use strict';

const store = new Map();

const mockDb = {
  read: jest.fn(async collection => store.get(collection) || []),
  updateOne: jest.fn(async () => true),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../utils/geocoding', () => ({
  geocodePostcode: jest.fn(async postcode =>
    String(postcode).replace(/\s/g, '').toUpperCase() === 'CF101AA'
      ? { latitude: 51.4816, longitude: -3.1791, postcode: 'CF10 1AA' }
      : null
  ),
  isValidUKPostcode: jest.requireActual('../../utils/geocoding').isValidUKPostcode,
  calculateDistance: jest.requireActual('../../utils/geocoding').calculateDistance,
}));

const { parseArgs, run, buildBaseLocation } = require('../../scripts/audit-supplier-locations');
const registry = require('../../services/locationRegistry.service');
const { AUDIT_STATUSES } = require('../../models/LocationContent');

/**
 * Seed the supplier collection.
 * @param {Object[]} suppliers Supplier records.
 * @returns {void} Nothing.
 */
function seedSuppliers(suppliers) {
  store.set('suppliers', suppliers);
}

beforeEach(() => {
  store.clear();
  mockDb.updateOne.mockClear();
});

describe('argument parsing', () => {
  it('defaults to a dry run', () => {
    const options = parseArgs(['node', 'script']);
    expect(options.apply).toBe(false);
    expect(options.limit).toBe(Infinity);
    expect(options.json).toBeNull();
  });

  it('reads --apply, --limit and --json', () => {
    const options = parseArgs(['node', 'script', '--apply', '--limit', '25', '--json', 'out.json']);
    expect(options).toEqual({ apply: true, limit: 25, json: 'out.json' });
  });

  it('ignores a nonsensical limit', () => {
    expect(parseArgs(['node', 'script', '--limit', 'lots']).limit).toBe(Infinity);
  });
});

describe('dry run', () => {
  it('changes no records', async () => {
    seedSuppliers([
      { id: 's1', name: 'A', approved: true, location: 'Cardiff' },
      { id: 's2', name: 'B', approved: true, location: 'Bristol' },
    ]);
    const report = await run({ apply: false, limit: Infinity, json: null });

    expect(mockDb.updateOne).not.toHaveBeenCalled();
    expect(report.written).toBe(0);
    expect(report.mode).toBe('dry-run');
    expect(report.counts[AUDIT_STATUSES.highConfidence]).toBe(2);
  });

  it('classifies each record without guessing', async () => {
    seedSuppliers([
      { id: 'mapped', approved: true, baseLocation: { citySlug: 'cardiff' } },
      { id: 'exact', approved: true, location: 'Cardiff' },
      { id: 'ambiguous', approved: true, location: 'Cardiff and South Wales' },
      { id: 'unknown', approved: true, location: 'Somewhere lovely' },
    ]);
    const report = await run({ apply: false, limit: Infinity, json: null });

    expect(report.counts[AUDIT_STATUSES.alreadyMapped]).toBe(1);
    expect(report.counts[AUDIT_STATUSES.highConfidence]).toBe(1);
    expect(report.counts[AUDIT_STATUSES.reviewRequired]).toBe(1);
    expect(report.counts[AUDIT_STATUSES.unmapped]).toBe(1);
  });

  it('honours the limit', async () => {
    seedSuppliers(
      Array.from({ length: 10 }, (_value, index) => ({
        id: `s${index}`,
        approved: true,
        location: 'Cardiff',
      }))
    );
    const report = await run({ apply: false, limit: 3, json: null });
    expect(report.audited).toBe(3);
    expect(report.totalSuppliers).toBe(10);
  });
});

describe('apply mode', () => {
  it('writes only high-confidence mappings', async () => {
    seedSuppliers([
      { id: 'exact', approved: true, location: 'Cardiff' },
      { id: 'ambiguous', approved: true, location: 'Cardiff and the Vale' },
      { id: 'unknown', approved: true, location: 'By the sea' },
    ]);
    const report = await run({ apply: true, limit: Infinity, json: null });

    expect(report.written).toBe(1);
    expect(mockDb.updateOne).toHaveBeenCalledTimes(1);
    const [, filter, update] = mockDb.updateOne.mock.calls[0];
    expect(filter).toEqual({ id: 'exact' });
    expect(update.baseLocation.citySlug).toBe('cardiff');
  });

  it('leaves the legacy location string in place', async () => {
    seedSuppliers([{ id: 'exact', approved: true, location: 'Cardiff' }]);
    await run({ apply: true, limit: Infinity, json: null });
    const [, , update] = mockDb.updateOne.mock.calls[0];
    expect(update).not.toHaveProperty('location');
  });

  it('rescues an unmappable record through its postcode', async () => {
    seedSuppliers([
      { id: 'postcoded', approved: true, location: 'By the sea', postcode: 'CF10 1AA' },
    ]);
    const report = await run({ apply: true, limit: Infinity, json: null });

    expect(report.counts[AUDIT_STATUSES.highConfidence]).toBe(1);
    const [, , update] = mockDb.updateOne.mock.calls[0];
    expect(update.baseLocation.citySlug).toBe('cardiff');
    expect(update.baseLocation.source).toBe('postcode_lookup');
    expect(update.baseLocation.postcode).toBe('CF10 1AA');
  });

  it('does not rescue a record whose postcode resolves to nothing', async () => {
    seedSuppliers([{ id: 'far', approved: true, location: 'Elsewhere', postcode: 'ZZ99 9ZZ' }]);
    const report = await run({ apply: true, limit: Infinity, json: null });
    expect(report.written).toBe(0);
  });
});

describe('base location documents', () => {
  it('uses GeoJSON longitude, latitude order', () => {
    const base = buildBaseLocation(registry.getCity('cardiff'), null);
    expect(base.coordinates.type).toBe('Point');
    expect(base.coordinates.coordinates[0]).toBeCloseTo(-3.1791, 3);
    expect(base.coordinates.coordinates[1]).toBeCloseTo(51.4816, 3);
    expect(base.source).toBe('registry_name');
    expect(base.confidence).toBe('high');
  });

  it('records the postcode source when one was used', () => {
    const base = buildBaseLocation(registry.getCity('cardiff'), {
      postcode: 'CF10 1AA',
      coordinates: { type: 'Point', coordinates: [-3.17, 51.48] },
    });
    expect(base.source).toBe('postcode_lookup');
    expect(base.postcode).toBe('CF10 1AA');
  });
});
