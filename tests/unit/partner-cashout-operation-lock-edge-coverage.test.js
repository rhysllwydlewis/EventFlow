'use strict';

// Preserve owner-token, expiry and lease-boundary behaviour across lock-service refactors.
const localBackend = { backend: 'local', authoritative: false };
const mockStrictStore = {
  ensureAuthoritative: jest.fn(async () => localBackend),
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  isDuplicateKey: jest.fn(error => error?.code === 11000),
};

jest.mock('../../services/partnerCashoutStrictStore', () => mockStrictStore);

const service = require('../../services/partnerCashoutOperationLockService');

beforeEach(() => {
  jest.clearAllMocks();
  service._test.resetLocalLocksForTests();
  mockStrictStore.ensureAuthoritative.mockResolvedValue(localBackend);
});

test('local expired locks are removed before a replacement owner is admitted', async () => {
  const first = await service.acquire('partner:partner_1', 5000);
  first.expiresAt = new Date(Date.now() - 1000);

  const replacement = await service.acquire('partner:partner_1', 5000);
  expect(replacement).not.toBeNull();
  expect(replacement.ownerToken).not.toBe(first.ownerToken);
});

test('local renewal extends only the current owner lease', async () => {
  const lock = await service.acquire('request:cashout_1', 5000);
  const previousExpiry = lock.expiresAt.getTime();
  await new Promise(resolve => setTimeout(resolve, 2));

  await expect(service.renew(lock, 10000)).resolves.toBe(true);
  expect(lock.expiresAt.getTime()).toBeGreaterThan(previousExpiry);
  await expect(service.renew({ ...lock, ownerToken: 'wrong-owner' }, 10000)).resolves.toBe(false);
});

test('lock construction clamps leases and rejects an empty scope', async () => {
  const short = service._test.buildLock('scope', 1);
  const long = service._test.buildLock('scope', 9999999);
  expect(short.leaseMs).toBe(5000);
  expect(long.leaseMs).toBe(300000);
  expect(service._test.lockId('  request:1  ')).toBe('partner-cashout:request:1');
  await expect(service.acquire('   ')).rejects.toThrow('scope is required');
});

test('invalid lock objects cannot be renewed or released', async () => {
  await expect(service.renew(null)).resolves.toBe(false);
  await expect(service.release({ id: 'missing-owner' })).resolves.toBe(false);
  expect(mockStrictStore.ensureAuthoritative).not.toHaveBeenCalled();
});
