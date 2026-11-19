/**
 * A dry run against local fallback storage reads zero records and reports "0
 * findings", which looks like a clean result but is not one (see #1680: the
 * scheduled routine could not reach MongoDB, every audit "passed", and nothing
 * was actually checked).
 *
 * The routine cannot pass a flag per run, so `AUDIT_REQUIRE_MONGODB=true` asks
 * all three database audit scripts for the same guarantee as `--require-mongodb`.
 */

'use strict';

const mockDb = {
  initializeDatabase: jest.fn(async () => 'local'),
  getDatabaseStatus: jest.fn(() => ({ type: 'local', connected: false, state: 'completed' })),
  getDatabaseType: jest.fn(() => 'local'),
  read: jest.fn(async () => []),
  findOne: jest.fn(async () => null),
  deleteMany: jest.fn(async () => 0),
  updateMany: jest.fn(async () => 0),
  updateOne: jest.fn(async () => true),
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

const orphaned = require('../../scripts/audit-orphaned-supplier-data');

const MONGO = { type: 'mongodb', connected: true, state: 'completed', error: null };
const LOCAL = { type: 'local', connected: false, state: 'completed', error: null };
const ENV_KEY = 'AUDIT_REQUIRE_MONGODB';

describe('AUDIT_REQUIRE_MONGODB for the database audit scripts', () => {
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
    jest.resetModules();
  });

  describe('orphaned supplier data audit', () => {
    it('lets a dry run proceed on local storage by default', () => {
      const decision = orphaned.checkPreconditions({ apply: false }, LOCAL);
      expect(decision.allowed).toBe(true);
    });

    it('refuses a dry run on local storage when mongodb is required', () => {
      const decision = orphaned.checkPreconditions({ apply: false, requireMongodb: true }, LOCAL);
      expect(decision.allowed).toBe(false);
      expect(decision.refusals).toHaveLength(1);
      expect(decision.refusals[0]).toMatch(/--require-mongodb/);
      expect(decision.refusals[0]).toMatch(/AUDIT_REQUIRE_MONGODB/);
      expect(decision.refusals[0]).toMatch(/"local"/);
    });

    it('allows a dry run against a healthy mongodb when it is required', () => {
      const decision = orphaned.checkPreconditions({ apply: false, requireMongodb: true }, MONGO);
      expect(decision.allowed).toBe(true);
    });

    it('main() exits with the refused code when the env var is set and the backend is local', async () => {
      process.env[ENV_KEY] = 'true';
      const code = await orphaned.main();
      expect(code).toBe(orphaned.EXIT_CODES.refused);
      expect(mockDb.read).not.toHaveBeenCalled();
    });

    it('main() runs the dry run on local storage when the env var is not set', async () => {
      delete process.env[ENV_KEY];
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const code = await orphaned.main();
      console.log.mockRestore();
      expect(code).toBe(orphaned.EXIT_CODES.ok);
    });
  });

  describe.each([
    ['supplier location audit', '../../scripts/audit-supplier-locations'],
    ['marketplace listing location audit', '../../scripts/audit-marketplace-listing-locations'],
  ])('%s', (_name, modulePath) => {
    it('does not require mongodb by default', () => {
      delete process.env[ENV_KEY];
      const { parseArgs } = require(modulePath);
      expect(parseArgs(['node', 'script']).requireMongodb).toBe(false);
    });

    it('requires mongodb when AUDIT_REQUIRE_MONGODB=true', () => {
      process.env[ENV_KEY] = 'true';
      const { parseArgs } = require(modulePath);
      expect(parseArgs(['node', 'script']).requireMongodb).toBe(true);
    });

    it('ignores other values of AUDIT_REQUIRE_MONGODB', () => {
      process.env[ENV_KEY] = 'yes';
      const { parseArgs } = require(modulePath);
      expect(parseArgs(['node', 'script']).requireMongodb).toBe(false);
    });

    it('still honours the --require-mongodb flag', () => {
      delete process.env[ENV_KEY];
      const { parseArgs } = require(modulePath);
      expect(parseArgs(['node', 'script', '--require-mongodb']).requireMongodb).toBe(true);
    });

    it('refuses a dry run on local storage when required through the environment', () => {
      process.env[ENV_KEY] = 'true';
      const { parseArgs, checkPreconditions } = require(modulePath);
      const options = parseArgs(['node', 'script']);
      const decision = checkPreconditions(options, LOCAL, {});
      expect(decision.allowed).toBe(false);
    });
  });
});
