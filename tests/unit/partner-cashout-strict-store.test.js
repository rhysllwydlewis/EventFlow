'use strict';

const mockCollection = {
  findOne: jest.fn(),
  find: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  countDocuments: jest.fn(),
};
const mockCursor = {
  sort: jest.fn(function () { return this; }),
  skip: jest.fn(function () { return this; }),
  limit: jest.fn(function () { return this; }),
  toArray: jest.fn(),
};
const mockMongoDb = {
  collection: jest.fn(() => mockCollection),
};
const mockUnified = {
  initializeDatabase: jest.fn(async () => 'local'),
  getDatabaseType: jest.fn(() => 'local'),
  findOne: jest.fn(),
  find: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  findWithOptions: jest.fn(),
  count: jest.fn(),
};
const mockEnsureIndexes = jest.fn(async () => true);
const mockGetDb = jest.fn(async () => mockMongoDb);

jest.mock('../../db-unified', () => mockUnified);
jest.mock('../../db', () => ({ getDb: mockGetDb }));
jest.mock('../../services/partnerCashoutOperationsIndexService', () => ({
  ensureIndexes: mockEnsureIndexes,
}));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const store = require('../../services/partnerCashoutStrictStore');

beforeEach(() => {
  jest.clearAllMocks();
  mockUnified.getDatabaseType.mockReturnValue('local');
  mockMongoDb.collection.mockReturnValue(mockCollection);
  mockCollection.find.mockReturnValue(mockCursor);
  mockCursor.sort.mockReturnThis();
  mockCursor.skip.mockReturnThis();
  mockCursor.limit.mockReturnThis();
  mockCursor.toArray.mockResolvedValue([]);
});

test('production refuses local fallback for cashout safety data', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  mockUnified.getDatabaseType.mockReturnValue('local');
  try {
    await expect(store.ensureAuthoritative()).rejects.toMatchObject({
      code: 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE',
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('Mongo findOne failures become a standard fail-closed storage error instead of an empty result', async () => {
  mockUnified.getDatabaseType.mockReturnValue('mongodb');
  mockCollection.findOne.mockRejectedValueOnce(new Error('network read failed'));

  await expect(store.findOne('partner_cashout_requests', { id: 'cashout_1' })).rejects.toMatchObject({
    code: 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE',
    message: 'Authoritative cashout storage read failed.',
  });
});

test('Mongo collection scan failures become a standard fail-closed storage error instead of an empty array', async () => {
  mockUnified.getDatabaseType.mockReturnValue('mongodb');
  mockCursor.toArray.mockRejectedValueOnce(new Error('cursor failed'));

  await expect(
    store.find('partner_cashout_requests', { partnerId: 'partner_1' })
  ).rejects.toMatchObject({
    code: 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE',
    message: 'Authoritative cashout storage query failed.',
  });
});

test('Mongo duplicate-key errors remain observable to the distributed lock and idempotency layers', async () => {
  mockUnified.getDatabaseType.mockReturnValue('mongodb');
  const duplicate = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
  mockCollection.insertOne.mockRejectedValueOnce(duplicate);

  await expect(
    store.insertOne('partner_cashout_operation_locks', { id: 'partner-cashout:partner:1' })
  ).rejects.toMatchObject({ code: 11000 });
  expect(store.isDuplicateKey(duplicate)).toBe(true);
});

test('Mongo writes require acknowledgement and preserve matched/deleted semantics', async () => {
  mockUnified.getDatabaseType.mockReturnValue('mongodb');
  mockCollection.insertOne.mockResolvedValueOnce({ acknowledged: true, insertedId: '1' });
  mockCollection.updateOne.mockResolvedValueOnce({ matchedCount: 1 });
  mockCollection.deleteOne.mockResolvedValueOnce({ deletedCount: 1 });

  await expect(store.insertOne('x', { id: '1' })).resolves.toEqual({ id: '1' });
  await expect(store.updateOne('x', { id: '1' }, { $set: { ok: true } })).resolves.toBe(true);
  await expect(store.deleteOne('x', { id: '1' })).resolves.toBe(true);
});

test('non-duplicate Mongo write failures are normalised to storage unavailable', async () => {
  mockUnified.getDatabaseType.mockReturnValue('mongodb');
  mockCollection.updateOne.mockRejectedValueOnce(new Error('write concern timeout'));

  await expect(store.updateOne('x', { id: '1' }, { $set: { ok: true } })).rejects.toMatchObject({
    code: 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE',
    message: 'Authoritative cashout storage update failed.',
  });
});

test('index/bootstrap failures are normalised to storage unavailable', async () => {
  mockUnified.getDatabaseType.mockReturnValue('mongodb');
  mockEnsureIndexes.mockRejectedValueOnce(new Error('index build failed'));

  await expect(store.ensureAuthoritative()).rejects.toMatchObject({
    code: 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE',
    message: 'Authoritative cashout storage could not be initialised.',
  });
});

test('non-production local mode deliberately delegates to db-unified', async () => {
  mockUnified.getDatabaseType.mockReturnValue('local');
  mockUnified.findOne.mockResolvedValueOnce({ id: 'local_1' });

  await expect(store.findOne('partners', { id: 'local_1' })).resolves.toEqual({ id: 'local_1' });
  expect(mockUnified.findOne).toHaveBeenCalledWith('partners', { id: 'local_1' });
  expect(mockGetDb).not.toHaveBeenCalled();
});
