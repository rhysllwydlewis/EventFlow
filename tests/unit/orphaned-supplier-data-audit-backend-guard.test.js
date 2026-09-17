/**
 * scripts/audit-orphaned-supplier-data.js must refuse `--apply` against
 * anything but a healthy MongoDB connection, the same rule already enforced
 * (and tested) for its sibling location-audit scripts. Unlike those scripts,
 * this one has no writes gated behind `--require-mongodb` for the dry run —
 * only `--apply` (a destructive delete) needs to be refused.
 */

'use strict';

let backendState = { type: 'mongodb', connected: true, state: 'completed', error: null };

const mockDb = {
  initializeDatabase: jest.fn(async () => backendState.type),
  getDatabaseStatus: jest.fn(() => ({ ...backendState })),
  getDatabaseType: jest.fn(() => backendState.type),
  read: jest.fn(async () => []),
  findOne: jest.fn(async () => null),
  deleteMany: jest.fn(async () => 0),
  updateMany: jest.fn(async () => 0),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/adminUserDeletion.service', () => ({
  invalidatePublicSupplierCaches: jest.fn(async () => undefined),
}));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  EXIT_CODES,
  auditOrphanedSupplierData,
  checkPreconditions,
  resolveBackend,
} = require('../../scripts/audit-orphaned-supplier-data');

const MONGO = { type: 'mongodb', connected: true, state: 'completed', error: null };
const LOCAL = { type: 'local', connected: false, state: 'completed', error: null };

beforeEach(() => {
  backendState = { ...MONGO };
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  console.log.mockRestore();
});

describe('backend resolution', () => {
  it('names the active backend', async () => {
    backendState = { ...LOCAL };
    const backend = await resolveBackend();
    expect(backend.type).toBe('local');
    expect(backend.connected).toBe(false);
  });

  it('reports a healthy MongoDB connection', async () => {
    const backend = await resolveBackend();
    expect(backend).toEqual(MONGO);
  });
});

describe('checkPreconditions', () => {
  it('refuses to --apply against local fallback storage', () => {
    const decision = checkPreconditions({ apply: true }, LOCAL);
    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(' ')).toMatch(/Refusing to --apply against backend "local"/);
  });

  it('refuses to --apply against a disconnected MongoDB backend', () => {
    const decision = checkPreconditions({ apply: true }, { type: 'mongodb', connected: false });
    expect(decision.allowed).toBe(false);
  });

  it('allows --apply against a healthy MongoDB backend', () => {
    expect(checkPreconditions({ apply: true }, MONGO).allowed).toBe(true);
  });

  it('allows a dry run regardless of backend', () => {
    expect(checkPreconditions({ apply: false }, LOCAL).allowed).toBe(true);
  });
});

describe('auditOrphanedSupplierData() called directly (bypassing main())', () => {
  it('refuses to apply against local storage even when called programmatically', async () => {
    await expect(auditOrphanedSupplierData({ apply: true, backend: LOCAL })).rejects.toThrow(
      /Refusing to --apply against backend "local"/
    );
    expect(mockDb.deleteMany).not.toHaveBeenCalled();
  });

  it('proceeds when called programmatically against a healthy MongoDB backend', async () => {
    await expect(auditOrphanedSupplierData({ apply: true, backend: MONGO })).resolves.toMatchObject(
      { backend: MONGO }
    );
  });
});

describe('main()', () => {
  it('exits with the refused code and performs no deletes when --apply targets local storage', async () => {
    backendState = { ...LOCAL };
    process.argv = ['node', 'script', '--apply'];

    const { main } = require('../../scripts/audit-orphaned-supplier-data');
    const code = await main();

    expect(code).toBe(EXIT_CODES.refused);
    expect(mockDb.deleteMany).not.toHaveBeenCalled();
  });
});
