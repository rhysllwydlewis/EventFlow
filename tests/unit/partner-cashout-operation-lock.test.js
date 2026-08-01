'use strict';

const locks = [];
function matches(item, query) {
  return Object.entries(query || {}).every(([key, value]) => item[key] === value);
}

const mockStrictStore = {
  ensureAuthoritative: jest.fn(async () => ({ backend: 'mongodb', authoritative: true })),
  findOne: jest.fn(async (_collection, query) => locks.find(item => matches(item, query)) || null),
  insertOne: jest.fn(async (_collection, item) => {
    if (locks.some(existing => existing.id === item.id)) {
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    }
    locks.push(item);
    return item;
  }),
  updateOne: jest.fn(async (_collection, query, update) => {
    const item = locks.find(candidate => matches(candidate, query));
    if (!item) return false;
    Object.assign(item, update.$set || update);
    return true;
  }),
  deleteOne: jest.fn(async (_collection, query) => {
    const index = locks.findIndex(item => matches(item, query));
    if (index < 0) return false;
    locks.splice(index, 1);
    return true;
  }),
  isDuplicateKey: jest.fn(error => error?.code === 11000),
  _test: {
    isDuplicateKey: jest.fn(error => error?.code === 11000),
  },
};

jest.mock('../../services/partnerCashoutStrictStore', () => mockStrictStore);

const service = require('../../services/partnerCashoutOperationLockService');

beforeEach(() => {
  locks.splice(0, locks.length);
  jest.clearAllMocks();
  service._test.resetLocalLocksForTests();
  mockStrictStore.ensureAuthoritative.mockResolvedValue({ backend: 'mongodb', authoritative: true });
  mockStrictStore.isDuplicateKey.mockImplementation(error => error?.code === 11000);
  mockStrictStore._test.isDuplicateKey.mockImplementation(error => error?.code === 11000);
  mockStrictStore.findOne.mockImplementation(
    async (_collection, query) => locks.find(item => matches(item, query)) || null
  );
  mockStrictStore.insertOne.mockImplementation(async (_collection, item) => {
    if (locks.some(existing => existing.id === item.id)) {
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    }
    locks.push(item);
    return item;
  });
  mockStrictStore.updateOne.mockImplementation(async (_collection, query, update) => {
    const item = locks.find(candidate => matches(candidate, query));
    if (!item) return false;
    Object.assign(item, update.$set || update);
    return true;
  });
  mockStrictStore.deleteOne.mockImplementation(async (_collection, query) => {
    const index = locks.findIndex(item => matches(item, query));
    if (index < 0) return false;
    locks.splice(index, 1);
    return true;
  });
});

test('only one authoritative owner can hold the same cashout scope at a time', async () => {
  const first = await service.acquire('partner:partner_1');
  const second = await service.acquire('partner:partner_1');
  expect(first).toMatchObject({ id: 'partner-cashout:partner:partner_1' });
  expect(second).toBeNull();
});

test('an ambiguous lock write failure fails closed instead of pretending to be busy', async () => {
  mockStrictStore.insertOne.mockRejectedValueOnce(new Error('write concern failed'));

  await expect(service.acquire('partner:partner_1')).rejects.toMatchObject({
    code: 'PARTNER_CASHOUT_LOCK_STORAGE_UNAVAILABLE',
  });
});

test('a duplicate lock is only treated as busy when a live competing owner can be verified', async () => {
  mockStrictStore.insertOne.mockRejectedValueOnce(
    Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
  );
  mockStrictStore.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

  await expect(service.acquire('partner:partner_1')).rejects.toMatchObject({
    code: 'PARTNER_CASHOUT_LOCK_STORAGE_UNAVAILABLE',
  });
});

test('release is owner-token scoped and allows a later operation', async () => {
  const first = await service.acquire('request:cashout_1');
  await expect(service.release({ ...first, ownerToken: 'wrong-owner' })).resolves.toBe(false);
  expect(locks).toHaveLength(1);
  await expect(service.release(first)).resolves.toBe(true);
  await expect(service.acquire('request:cashout_1')).resolves.toMatchObject({
    id: 'partner-cashout:request:cashout_1',
  });
});

test('lease renewal is owner-token scoped and extends the lock expiry', async () => {
  const first = await service.acquire('request:cashout_1', 5000);
  const originalExpiry = first.expiresAt.getTime();
  await new Promise(resolve => setTimeout(resolve, 2));

  await expect(service.renew(first, 10000)).resolves.toBe(true);
  expect(locks[0].expiresAt.getTime()).toBeGreaterThan(originalExpiry);
  await expect(service.renew({ ...first, ownerToken: 'wrong-owner' }, 10000)).resolves.toBe(false);
});

test('expired lock cleanup is owner-token scoped so a stale cleaner cannot delete a replacement lock', async () => {
  const id = 'partner-cashout:partner:partner_1';
  const expired = {
    id,
    scope: 'partner:partner_1',
    ownerToken: 'expired-owner',
    expiresAt: new Date(Date.now() - 1000),
  };
  const replacement = {
    id,
    scope: 'partner:partner_1',
    ownerToken: 'new-owner',
    expiresAt: new Date(Date.now() + 60000),
  };
  locks.push(expired);
  mockStrictStore.deleteOne.mockImplementationOnce(async (_collection, query) => {
    locks[0] = replacement;
    const index = locks.findIndex(item => matches(item, query));
    if (index < 0) return false;
    locks.splice(index, 1);
    return true;
  });

  await expect(service._test.removeExpired(id, Date.now(), 'mongodb')).resolves.toBe(false);
  expect(mockStrictStore.deleteOne).toHaveBeenCalledWith(service.COLLECTION, {
    id,
    ownerToken: 'expired-owner',
  });
  expect(locks).toEqual([replacement]);
});

test('an ordinary expired Mongo lock is removed before a new owner is admitted', async () => {
  locks.push({
    id: 'partner-cashout:partner:partner_1',
    scope: 'partner:partner_1',
    ownerToken: 'expired-owner',
    expiresAt: new Date(Date.now() - 1000),
  });
  const replacement = await service.acquire('partner:partner_1');
  expect(replacement).not.toBeNull();
  expect(replacement.ownerToken).not.toBe('expired-owner');
  expect(locks).toHaveLength(1);
});

test('non-production local fallback uses an in-process lock rather than claiming distributed safety', async () => {
  mockStrictStore.ensureAuthoritative.mockResolvedValueOnce({ backend: 'local', authoritative: false });
  const first = await service.acquire('partner:partner_1');
  mockStrictStore.ensureAuthoritative.mockResolvedValueOnce({ backend: 'local', authoritative: false });
  const second = await service.acquire('partner:partner_1');
  expect(first).not.toBeNull();
  expect(second).toBeNull();
  expect(mockStrictStore.insertOne).not.toHaveBeenCalled();
  mockStrictStore.ensureAuthoritative.mockResolvedValueOnce({ backend: 'local', authoritative: false });
  await expect(service.release(first)).resolves.toBe(true);
});

test('production/storage failure is exposed as a lock-storage failure', async () => {
  mockStrictStore.ensureAuthoritative.mockRejectedValueOnce(
    Object.assign(new Error('Mongo unavailable'), { code: 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE' })
  );
  await expect(service.acquire('partner:partner_1')).rejects.toMatchObject({
    code: 'PARTNER_CASHOUT_LOCK_STORAGE_UNAVAILABLE',
  });
});

test('TTL helper recognises Date and ISO expiry values', () => {
  expect(service._test.isExpired({ expiresAt: new Date(Date.now() - 1000) })).toBe(true);
  expect(service._test.isExpired({ expiresAt: new Date(Date.now() + 10000).toISOString() })).toBe(false);
});
