/**
 * The supplier location audit script.
 *
 * The rules under test are the ones that matter operationally: a dry run must
 * change nothing, an --apply run must only write mappings it is sure of, it
 * must refuse to touch anything but a healthy MongoDB, and it must be able to
 * prove that every write it counted actually landed.
 */

'use strict';

const store = new Map();

/** The backend the mocked db-unified reports. Reassigned per test. */
let backendState = { type: 'mongodb', connected: true, state: 'completed', error: null };

/** Forced outcome for the next updateOne calls, for failure-path tests. */
let updateOutcome = null;

const mockDb = {
  initializeDatabase: jest.fn(async () => backendState.type),
  getDatabaseStatus: jest.fn(() => ({ ...backendState })),
  getDatabaseType: jest.fn(() => backendState.type),
  read: jest.fn(async collection => (store.get(collection) || []).map(record => ({ ...record }))),
  findOne: jest.fn(async (collection, filter) => {
    const record = (store.get(collection) || []).find(item => item.id === filter.id);
    return record ? { ...record } : null;
  }),
  updateOne: jest.fn(async (collection, filter, updates) => {
    if (updateOutcome === 'unacknowledged') {
      return false;
    }
    const records = store.get(collection) || [];
    const index = records.findIndex(item => item.id === filter.id);
    if (index < 0) {
      return false;
    }
    if (updateOutcome === 'silentNoop') {
      return true;
    }
    if (updateOutcome === 'clobbersLegacy') {
      records[index] = { ...records[index], ...updates, location: 'overwritten' };
      return true;
    }
    records[index] = { ...records[index], ...updates };
    return true;
  }),
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
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  EXIT_CODES,
  buildBaseLocation,
  checkPreconditions,
  main,
  parseArgs,
  resolveBackend,
  run,
} = require('../../scripts/audit-supplier-locations');
const registry = require('../../services/locationRegistry.service');
const { AUDIT_STATUSES } = require('../../models/LocationContent');

const MONGO = { type: 'mongodb', connected: true, state: 'completed', error: null };
const LOCAL = { type: 'local', connected: true, state: 'completed', error: null };

/**
 * Seed the supplier collection.
 * @param {Object[]} suppliers Supplier records.
 * @returns {void} Nothing.
 */
function seedSuppliers(suppliers) {
  store.set('suppliers', suppliers);
}

/**
 * Read the seeded suppliers back out of the mock store.
 * @returns {Object[]} Stored records.
 */
function storedSuppliers() {
  return store.get('suppliers') || [];
}

/**
 * Default dry-run options.
 * @param {Object} overrides Option overrides.
 * @returns {Object} Options.
 */
function options(overrides = {}) {
  return {
    apply: false,
    limit: Infinity,
    json: null,
    requireMongodb: false,
    confirmProduction: false,
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  updateOutcome = null;
  backendState = { ...MONGO };
  mockDb.updateOne.mockClear();
  mockDb.findOne.mockClear();
  mockDb.initializeDatabase.mockClear();
});

describe('argument parsing', () => {
  it('defaults to a dry run with no safety flags set', () => {
    expect(parseArgs(['node', 'script'])).toEqual({
      apply: false,
      limit: Infinity,
      json: null,
      requireMongodb: false,
      confirmProduction: false,
    });
  });

  it('reads every option', () => {
    expect(
      parseArgs([
        'node',
        'script',
        '--apply',
        '--limit',
        '25',
        '--json',
        'out.json',
        '--require-mongodb',
        '--confirm-production',
      ])
    ).toEqual({
      apply: true,
      limit: 25,
      json: 'out.json',
      requireMongodb: true,
      confirmProduction: true,
    });
  });

  it('ignores a nonsensical limit', () => {
    expect(parseArgs(['node', 'script', '--limit', 'lots']).limit).toBe(Infinity);
  });
});

describe('backend resolution', () => {
  it('initialises the database explicitly rather than waiting for the first read', async () => {
    const backend = await resolveBackend();
    expect(mockDb.initializeDatabase).toHaveBeenCalledTimes(1);
    expect(backend).toEqual({
      type: 'mongodb',
      connected: true,
      state: 'completed',
      error: null,
    });
  });

  it('reports an unreachable backend instead of throwing', async () => {
    mockDb.initializeDatabase.mockImplementationOnce(async () => {
      throw new Error('no route to host');
    });
    const backend = await resolveBackend();
    expect(backend.connected).toBe(false);
    expect(backend.error).toBe('no route to host');
  });

  it('names the active backend in the report', async () => {
    seedSuppliers([{ id: 's1', approved: true, location: 'Cardiff' }]);
    const report = await run(options(), LOCAL);
    expect(report.backend.type).toBe('local');
  });
});

describe('preconditions', () => {
  it('refuses to apply against local file storage', () => {
    const decision = checkPreconditions(options({ apply: true }), LOCAL, {});
    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(' ')).toMatch(/Refusing to --apply against backend "local"/);
  });

  it('refuses to apply against local storage even without --require-mongodb', () => {
    const decision = checkPreconditions(options({ apply: true, requireMongodb: false }), LOCAL, {});
    expect(decision.allowed).toBe(false);
  });

  it('refuses to apply to a MongoDB backend that is not connected', () => {
    const decision = checkPreconditions(
      options({ apply: true }),
      { type: 'mongodb', connected: false, state: 'failed', error: 'timeout' },
      {}
    );
    expect(decision.allowed).toBe(false);
  });

  it('fails a --require-mongodb dry run when the backend is local storage', () => {
    const decision = checkPreconditions(options({ requireMongodb: true }), LOCAL, {});
    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(' ')).toMatch(/--require-mongodb was given/);
  });

  it('allows a --require-mongodb dry run against a healthy MongoDB', () => {
    expect(checkPreconditions(options({ requireMongodb: true }), MONGO, {}).allowed).toBe(true);
  });

  it('allows a dry run against local storage when MongoDB was not demanded', () => {
    expect(checkPreconditions(options(), LOCAL, {}).allowed).toBe(true);
  });

  it('refuses a production apply without --confirm-production', () => {
    const decision = checkPreconditions(options({ apply: true }), MONGO, {
      NODE_ENV: 'production',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(' ')).toMatch(/without --confirm-production/);
  });

  it('allows a production apply once it is confirmed', () => {
    const decision = checkPreconditions(options({ apply: true, confirmProduction: true }), MONGO, {
      NODE_ENV: 'production',
    });
    expect(decision.allowed).toBe(true);
  });

  it('does not require production confirmation outside production', () => {
    expect(
      checkPreconditions(options({ apply: true }), MONGO, { NODE_ENV: 'staging' }).allowed
    ).toBe(true);
  });

  it('reports every refusal at once rather than one per run', () => {
    const decision = checkPreconditions(options({ apply: true, requireMongodb: true }), LOCAL, {
      NODE_ENV: 'production',
    });
    expect(decision.refusals).toHaveLength(3);
  });
});

describe('dry run', () => {
  it('changes no records', async () => {
    seedSuppliers([
      { id: 's1', name: 'A', approved: true, location: 'Cardiff' },
      { id: 's2', name: 'B', approved: true, location: 'Bristol' },
    ]);
    const report = await run(options(), MONGO);

    expect(mockDb.updateOne).not.toHaveBeenCalled();
    expect(report.written).toBe(0);
    expect(report.mode).toBe('dry-run');
    expect(report.counts[AUDIT_STATUSES.highConfidence]).toBe(2);
  });

  it('leaves every stored record byte-identical', async () => {
    seedSuppliers([{ id: 's1', approved: true, location: 'Cardiff', postcode: 'CF10 1AA' }]);
    const before = JSON.stringify(storedSuppliers());
    await run(options(), MONGO);
    expect(JSON.stringify(storedSuppliers())).toBe(before);
  });

  it('classifies each record without guessing', async () => {
    seedSuppliers([
      { id: 'mapped', approved: true, baseLocation: { citySlug: 'cardiff' } },
      { id: 'exact', approved: true, location: 'Cardiff' },
      { id: 'ambiguous', approved: true, location: 'Cardiff and South Wales' },
      { id: 'unknown', approved: true, location: 'Somewhere lovely' },
    ]);
    const report = await run(options(), MONGO);

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
    const report = await run(options({ limit: 3 }), MONGO);
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
    const report = await run(options({ apply: true }), MONGO);

    expect(report.written).toBe(1);
    expect(mockDb.updateOne).toHaveBeenCalledTimes(1);
    const [, filter, update] = mockDb.updateOne.mock.calls[0];
    expect(filter).toEqual({ id: 'exact' });
    expect(update.baseLocation.citySlug).toBe('cardiff');
  });

  it('leaves the legacy location string in place', async () => {
    seedSuppliers([{ id: 'exact', approved: true, location: 'Cardiff' }]);
    await run(options({ apply: true }), MONGO);

    const [, , update] = mockDb.updateOne.mock.calls[0];
    expect(update).not.toHaveProperty('location');
    expect(storedSuppliers()[0].location).toBe('Cardiff');
  });

  it('verifies each write by reading the record back', async () => {
    seedSuppliers([{ id: 'exact', approved: true, location: 'Cardiff' }]);
    const report = await run(options({ apply: true }), MONGO);

    expect(mockDb.findOne).toHaveBeenCalledWith('suppliers', { id: 'exact' });
    expect(report.verified).toBe(1);
    expect(report.failedWrites).toEqual([]);
  });

  it('rescues an unmappable record through its postcode', async () => {
    seedSuppliers([
      { id: 'postcoded', approved: true, location: 'By the sea', postcode: 'CF10 1AA' },
    ]);
    const report = await run(options({ apply: true }), MONGO);

    expect(report.counts[AUDIT_STATUSES.highConfidence]).toBe(1);
    const [, , update] = mockDb.updateOne.mock.calls[0];
    expect(update.baseLocation.citySlug).toBe('cardiff');
    expect(update.baseLocation.source).toBe('postcode_lookup');
    expect(update.baseLocation.postcode).toBe('CF10 1AA');
  });

  it('does not rescue a record whose postcode resolves to nothing', async () => {
    seedSuppliers([{ id: 'far', approved: true, location: 'Elsewhere', postcode: 'ZZ99 9ZZ' }]);
    const report = await run(options({ apply: true }), MONGO);
    expect(report.written).toBe(0);
  });
});

describe('failed writes', () => {
  it('does not count an unacknowledged update as written', async () => {
    updateOutcome = 'unacknowledged';
    seedSuppliers([{ id: 'exact', approved: true, location: 'Cardiff' }]);
    const report = await run(options({ apply: true }), MONGO);

    expect(report.written).toBe(0);
    expect(report.verified).toBe(0);
    expect(report.failedWrites).toEqual([
      {
        supplierId: 'exact',
        citySlug: 'cardiff',
        reason: 'updateOne reported no modified document',
      },
    ]);
  });

  it('does not count an acknowledged update that did not actually store anything', async () => {
    updateOutcome = 'silentNoop';
    seedSuppliers([{ id: 'exact', approved: true, location: 'Cardiff' }]);
    const report = await run(options({ apply: true }), MONGO);

    expect(report.written).toBe(0);
    expect(report.failedWrites[0].reason).toMatch(/does not match what was written/);
  });

  it('treats a changed legacy location as a failed write', async () => {
    updateOutcome = 'clobbersLegacy';
    seedSuppliers([{ id: 'exact', approved: true, location: 'Cardiff' }]);
    const report = await run(options({ apply: true }), MONGO);

    expect(report.written).toBe(0);
    expect(report.failedWrites[0].reason).toMatch(/legacy location string changed/);
  });

  it('stops at the first failed write instead of marching on', async () => {
    updateOutcome = 'unacknowledged';
    seedSuppliers([
      { id: 'first', approved: true, location: 'Cardiff' },
      { id: 'second', approved: true, location: 'Bristol' },
      { id: 'third', approved: true, location: 'Leeds' },
    ]);
    const report = await run(options({ apply: true }), MONGO);

    expect(mockDb.updateOne).toHaveBeenCalledTimes(1);
    expect(report.stoppedEarly).toBe(true);
    expect(report.audited).toBe(1);
  });

  it('counts only the writes that landed', async () => {
    seedSuppliers([
      { id: 'first', approved: true, location: 'Cardiff' },
      { id: 'second', approved: true, location: 'Bristol' },
      { id: 'ambiguous', approved: true, location: 'Cardiff and the Vale' },
    ]);
    const report = await run(options({ apply: true }), MONGO);

    expect(report.written).toBe(2);
    expect(report.verified).toBe(2);
    expect(report.stoppedEarly).toBe(false);
  });
});

describe('idempotency', () => {
  it('classifies migrated records as already mapped on the next run', async () => {
    seedSuppliers([
      { id: 'exact', approved: true, location: 'Cardiff' },
      { id: 'ambiguous', approved: true, location: 'Cardiff and the Vale' },
    ]);

    const first = await run(options({ apply: true }), MONGO);
    expect(first.written).toBe(1);

    mockDb.updateOne.mockClear();
    const second = await run(options({ apply: true }), MONGO);

    expect(second.counts[AUDIT_STATUSES.alreadyMapped]).toBe(1);
    expect(second.counts[AUDIT_STATUSES.highConfidence]).toBe(0);
    expect(second.written).toBe(0);
    expect(mockDb.updateOne).not.toHaveBeenCalled();
  });

  it('keeps the legacy string readable after the migration', async () => {
    seedSuppliers([{ id: 'exact', approved: true, location: 'Cardiff' }]);
    await run(options({ apply: true }), MONGO);
    expect(storedSuppliers()[0].location).toBe('Cardiff');
    expect(storedSuppliers()[0].baseLocation.citySlug).toBe('cardiff');
  });
});

describe('exit codes', () => {
  const originalArgv = process.argv;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.argv = originalArgv;
    process.env.NODE_ENV = originalEnv;
  });

  it('returns a refusal code rather than applying to local storage', async () => {
    backendState = { ...LOCAL };
    seedSuppliers([{ id: 'exact', approved: true, location: 'Cardiff' }]);
    process.argv = ['node', 'script', '--apply'];

    expect(await main()).toBe(EXIT_CODES.refused);
    expect(mockDb.updateOne).not.toHaveBeenCalled();
  });

  it('returns a refusal code for a production apply that was not confirmed', async () => {
    process.env.NODE_ENV = 'production';
    seedSuppliers([{ id: 'exact', approved: true, location: 'Cardiff' }]);
    process.argv = ['node', 'script', '--apply', '--require-mongodb'];

    expect(await main()).toBe(EXIT_CODES.refused);
    expect(mockDb.updateOne).not.toHaveBeenCalled();
  });

  it('succeeds for a MongoDB-required dry run', async () => {
    seedSuppliers([{ id: 'exact', approved: true, location: 'Cardiff' }]);
    process.argv = ['node', 'script', '--require-mongodb'];

    expect(await main()).toBe(EXIT_CODES.ok);
    expect(mockDb.updateOne).not.toHaveBeenCalled();
  });

  it('returns a write-failure code when a write does not land', async () => {
    updateOutcome = 'unacknowledged';
    seedSuppliers([{ id: 'exact', approved: true, location: 'Cardiff' }]);
    process.argv = ['node', 'script', '--apply', '--require-mongodb'];

    expect(await main()).toBe(EXIT_CODES.writeFailed);
  });

  it('completes a confirmed production apply', async () => {
    process.env.NODE_ENV = 'production';
    seedSuppliers([{ id: 'exact', approved: true, location: 'Cardiff' }]);
    process.argv = ['node', 'script', '--apply', '--require-mongodb', '--confirm-production'];

    expect(await main()).toBe(EXIT_CODES.ok);
    expect(storedSuppliers()[0].baseLocation.citySlug).toBe('cardiff');
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
