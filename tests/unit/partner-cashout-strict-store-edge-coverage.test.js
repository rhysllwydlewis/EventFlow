'use strict';

const mockCursor = {
  sort: jest.fn(function () {
    return this;
  }),
  skip: jest.fn(function () {
    return this;
  }),
  limit: jest.fn(function () {
    return this;
  }),
  toArray: jest.fn(),
};
const mockCollection = {
  findOne: jest.fn(),
  find: jest.fn(() => mockCursor),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  countDocuments: jest.fn(),
};
const mockDb = { collection: jest.fn(() => mockCollection) };
const mockUnified = {
  initializeDatabase: jest.fn(async () => true),
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
const mockGetDb = jest.fn(async () => mockDb);

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
  mockCollection.find.mockReturnValue(mockCursor);
  mockCursor.sort.mockReturnThis();
  mockCursor.skip.mockReturnThis();
  mockCursor.limit.mockReturnThis();
  mockCursor.toArray.mockResolvedValue([]);
});

test('local development mode delegates every strict-store operation without claiming authority', async () => {
  mockUnified.findOne.mockResolvedValue({ id: 'one' });
  mockUnified.find.mockResolvedValue([{ id: 'one' }]);
  mockUnified.insertOne.mockResolvedValue({ id: 'two' });
  mockUnified.updateOne.mockResolvedValue(true);
  mockUnified.deleteOne.mockResolvedValue(true);
  mockUnified.findWithOptions.mockResolvedValue([{ id: 'paged' }]);
  mockUnified.count.mockResolvedValue(3);

  await expect(store.findOne('items', { id: 'one' })).resolves.toEqual({ id: 'one' });
  await expect(store.find('items', { active: true })).resolves.toEqual([{ id: 'one' }]);
  await expect(store.read('items')).resolves.toEqual([{ id: 'one' }]);
  await expect(store.insertOne('items', { id: 'two' })).resolves.toEqual({ id: 'two' });
  await expect(store.updateOne('items', { id: 'two' }, { $set: { active: true } })).resolves.toBe(
    true
  );
  await expect(store.deleteOne('items', { id: 'two' })).resolves.toBe(true);
  await expect(
    store.findWithOptions('items', { active: true }, { limit: 5, skip: 2 })
  ).resolves.toEqual([{ id: 'paged' }]);
  await expect(store.count('items', { active: true })).resolves.toBe(3);

  expect(mockUnified.find).toHaveBeenCalledWith('items', {});
  expect(mockUnified.findWithOptions).toHaveBeenCalledWith(
    'items',
    { active: true },
    { limit: 5, skip: 2 }
  );
  expect(mockGetDb).not.toHaveBeenCalled();
});

test('Mongo paged queries apply sort, skip and limit and count through the authoritative collection', async () => {
  mockUnified.getDatabaseType.mockReturnValue('mongodb');
  mockCursor.toArray.mockResolvedValue([{ id: 'paged' }]);
  mockCollection.countDocuments.mockResolvedValue(7);

  await expect(
    store.findWithOptions('items', { active: true }, { sort: { createdAt: -1 }, skip: 4, limit: 2 })
  ).resolves.toEqual([{ id: 'paged' }]);
  await expect(store.count('items', { active: true })).resolves.toBe(7);

  expect(mockCursor.sort).toHaveBeenCalledWith({ createdAt: -1 });
  expect(mockCursor.skip).toHaveBeenCalledWith(4);
  expect(mockCursor.limit).toHaveBeenCalledWith(2);
  expect(mockCollection.countDocuments).toHaveBeenCalledWith({ active: true });
});

test('an unacknowledged Mongo insert fails closed', async () => {
  mockUnified.getDatabaseType.mockReturnValue('mongodb');
  mockCollection.insertOne.mockResolvedValue({ acknowledged: false });

  await expect(store.insertOne('items', { id: 'one' })).rejects.toMatchObject({
    code: 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE',
  });
});

test.each([
  [
    'delete',
    () => store.deleteOne('items', { id: 'one' }),
    () => mockCollection.deleteOne.mockRejectedValueOnce(new Error('delete failed')),
  ],
  [
    'paged query',
    () => store.findWithOptions('items', {}, { limit: 2 }),
    () => mockCursor.toArray.mockRejectedValueOnce(new Error('cursor failed')),
  ],
  [
    'count',
    () => store.count('items', {}),
    () => mockCollection.countDocuments.mockRejectedValueOnce(new Error('count failed')),
  ],
])(
  'Mongo %s failures are normalised to the fail-closed storage error',
  async (_name, operation, fail) => {
    mockUnified.getDatabaseType.mockReturnValue('mongodb');
    fail();
    await expect(operation()).rejects.toMatchObject({
      code: 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE',
    });
  }
);
