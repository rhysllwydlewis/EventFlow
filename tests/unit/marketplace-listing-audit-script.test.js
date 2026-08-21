/**
 * The marketplace listing location audit script.
 *
 * Mirrors the supplier audit script's own test suite for the rules that
 * matter operationally: a dry run changes nothing, --apply writes only
 * mappings it is sure of, it refuses anything but a healthy MongoDB, and it
 * proves every write it counts actually landed.
 */

'use strict';

const store = new Map();

let backendState = { type: 'mongodb', connected: true, state: 'completed', error: null };
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
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  EXIT_CODES,
  auditListingLocation,
  checkPreconditions,
  main,
  run,
} = require('../../scripts/audit-marketplace-listing-locations');
const { AUDIT_STATUSES } = require('../../models/LocationContent');

const MONGO = { type: 'mongodb', connected: true, state: 'completed', error: null };
const LOCAL = { type: 'local', connected: true, state: 'completed', error: null };

function seedListings(listings) {
  store.set('marketplace_listings', listings);
}

function storedListings() {
  return store.get('marketplace_listings') || [];
}

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
});

describe('auditListingLocation', () => {
  it('treats an existing valid citySlug as already mapped', () => {
    const row = auditListingLocation({ id: 'l1', citySlug: 'cardiff' });
    expect(row.status).toBe(AUDIT_STATUSES.alreadyMapped);
    expect(row.citySlug).toBe('cardiff');
  });

  it('resolves a geocoded coordinate to the nearest registry city', () => {
    const row = auditListingLocation({
      id: 'l1',
      locationCoordinates: { lat: 51.4816, lng: -3.1791 },
    });
    expect(row.status).toBe(AUDIT_STATUSES.highConfidence);
    expect(row.citySlug).toBe('cardiff');
    expect(row.source).toBe('postcode_lookup');
  });

  it('falls back to classifying the free-text location', () => {
    const row = auditListingLocation({ id: 'l1', location: 'Cardiff' });
    expect(row.status).toBe(AUDIT_STATUSES.highConfidence);
    expect(row.citySlug).toBe('cardiff');
    expect(row.source).toBe('legacy_text');
  });

  it('flags ambiguous text for a human rather than guessing', () => {
    const row = auditListingLocation({ id: 'l1', location: 'Cardiff and the Vale' });
    expect(row.status).toBe(AUDIT_STATUSES.reviewRequired);
  });

  it('leaves text naming no city unmapped', () => {
    const row = auditListingLocation({ id: 'l1', location: 'Somewhere lovely' });
    expect(row.status).toBe(AUDIT_STATUSES.unmapped);
  });
});

describe('preconditions', () => {
  it('refuses to apply against local file storage', () => {
    const decision = checkPreconditions(options({ apply: true }), LOCAL, {});
    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(' ')).toMatch(/Refusing to --apply against backend "local"/);
  });

  it('refuses a production apply without --confirm-production', () => {
    const decision = checkPreconditions(options({ apply: true }), MONGO, {
      NODE_ENV: 'production',
    });
    expect(decision.allowed).toBe(false);
  });

  it('allows a confirmed production apply against a healthy MongoDB', () => {
    const decision = checkPreconditions(options({ apply: true, confirmProduction: true }), MONGO, {
      NODE_ENV: 'production',
    });
    expect(decision.allowed).toBe(true);
  });
});

describe('dry run', () => {
  it('changes no records and classifies each without guessing', async () => {
    seedListings([
      { id: 'mapped', citySlug: 'cardiff' },
      { id: 'exact', location: 'Cardiff' },
      { id: 'ambiguous', location: 'Cardiff and the Vale' },
      { id: 'unknown', location: 'Somewhere lovely' },
    ]);
    const report = await run(options(), MONGO);

    expect(mockDb.updateOne).not.toHaveBeenCalled();
    expect(report.written).toBe(0);
    expect(report.mode).toBe('dry-run');
    expect(report.counts[AUDIT_STATUSES.alreadyMapped]).toBe(1);
    expect(report.counts[AUDIT_STATUSES.highConfidence]).toBe(1);
    expect(report.counts[AUDIT_STATUSES.reviewRequired]).toBe(1);
    expect(report.counts[AUDIT_STATUSES.unmapped]).toBe(1);
  });

  it('honours the limit', async () => {
    seedListings(
      Array.from({ length: 10 }, (_value, index) => ({ id: `l${index}`, location: 'Cardiff' }))
    );
    const report = await run(options({ limit: 3 }), MONGO);
    expect(report.audited).toBe(3);
    expect(report.totalListings).toBe(10);
  });
});

describe('apply mode', () => {
  it('writes only high-confidence mappings and leaves the legacy string in place', async () => {
    seedListings([
      { id: 'exact', location: 'Cardiff' },
      { id: 'ambiguous', location: 'Cardiff and the Vale' },
      { id: 'unknown', location: 'By the sea' },
    ]);
    const report = await run(options({ apply: true }), MONGO);

    expect(report.written).toBe(1);
    expect(mockDb.updateOne).toHaveBeenCalledTimes(1);
    const [, filter, update] = mockDb.updateOne.mock.calls[0];
    expect(filter).toEqual({ id: 'exact' });
    expect(update.citySlug).toBe('cardiff');
    expect(update).not.toHaveProperty('location');
    expect(storedListings().find(l => l.id === 'exact').location).toBe('Cardiff');
  });

  it('verifies each write by reading the record back', async () => {
    seedListings([{ id: 'exact', location: 'Cardiff' }]);
    const report = await run(options({ apply: true }), MONGO);

    expect(mockDb.findOne).toHaveBeenCalledWith('marketplace_listings', { id: 'exact' });
    expect(report.verified).toBe(1);
    expect(report.failedWrites).toEqual([]);
  });
});

describe('failed writes', () => {
  it('does not count an unacknowledged update as written, and stops the run', async () => {
    updateOutcome = 'unacknowledged';
    seedListings([
      { id: 'first', location: 'Cardiff' },
      { id: 'second', location: 'Bristol' },
    ]);
    const report = await run(options({ apply: true }), MONGO);

    expect(report.written).toBe(0);
    expect(report.stoppedEarly).toBe(true);
    expect(report.failedWrites).toEqual([
      {
        listingId: 'first',
        citySlug: 'cardiff',
        reason: 'updateOne reported no modified document',
      },
    ]);
  });

  it('treats a changed legacy location as a failed write', async () => {
    updateOutcome = 'clobbersLegacy';
    seedListings([{ id: 'exact', location: 'Cardiff' }]);
    const report = await run(options({ apply: true }), MONGO);

    expect(report.written).toBe(0);
    expect(report.failedWrites[0].reason).toMatch(/legacy location string changed/);
  });
});

describe('idempotency', () => {
  it('classifies a migrated record as already mapped on the next run', async () => {
    seedListings([{ id: 'exact', location: 'Cardiff' }]);

    const first = await run(options({ apply: true }), MONGO);
    expect(first.written).toBe(1);

    mockDb.updateOne.mockClear();
    const second = await run(options({ apply: true }), MONGO);

    expect(second.counts[AUDIT_STATUSES.alreadyMapped]).toBe(1);
    expect(second.written).toBe(0);
    expect(mockDb.updateOne).not.toHaveBeenCalled();
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
    seedListings([{ id: 'exact', location: 'Cardiff' }]);
    process.argv = ['node', 'script', '--apply'];

    expect(await main()).toBe(EXIT_CODES.refused);
    expect(mockDb.updateOne).not.toHaveBeenCalled();
  });

  it('completes a confirmed production apply', async () => {
    process.env.NODE_ENV = 'production';
    seedListings([{ id: 'exact', location: 'Cardiff' }]);
    process.argv = ['node', 'script', '--apply', '--require-mongodb', '--confirm-production'];

    expect(await main()).toBe(EXIT_CODES.ok);
    expect(storedListings()[0].citySlug).toBe('cardiff');
  });
});
