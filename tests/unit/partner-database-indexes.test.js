'use strict';

const mockCreateIndex = jest.fn(async () => 'index_name');
const mockCollection = jest.fn(() => ({
  createIndex: mockCreateIndex,
  countDocuments: jest.fn(async () => 0),
}));
const mockDb = {
  listCollections: jest.fn(() => ({ toArray: jest.fn(async () => []) })),
  createCollection: jest.fn(async () => undefined),
  collection: mockCollection,
  stats: jest.fn(async () => ({ db: 'eventflow-test', collections: 0, dataSize: 0, indexSize: 0 })),
};

jest.mock('../../db', () => ({ getDb: jest.fn(async () => mockDb) }));
jest.mock('../../models', () => ({
  initializeCollections: jest.fn(async () => undefined),
  createIndexes: jest.fn(async () => undefined),
}));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const databaseInit = require('../../db-init');

test('defines unique indexes only for actual partner reward milestone types', () => {
  const transactions = databaseInit.ADDITIONAL_COLLECTIONS.find(
    collection => collection.name === 'partner_credit_transactions'
  );
  const rewardIndex = transactions.indexes.find(
    index => index.keys.supplierUserId === 1 && index.keys.type === 1
  );

  expect(rewardIndex.options).toMatchObject({
    unique: true,
    partialFilterExpression: {
      supplierUserId: { $type: 'string' },
      type: { $in: databaseInit.REWARD_TYPES },
    },
  });
  expect(databaseInit.REWARD_TYPES).toEqual([
    'PACKAGE_BONUS',
    'SUBSCRIPTION_BONUS',
    'REFERRAL_SIGNUP_BONUS',
    'FIRST_REVIEW_BONUS',
  ]);
});

test('creates cashout, assessment and clawback idempotency indexes during initialisation', async () => {
  await databaseInit.initializeDatabase();

  expect(mockCreateIndex).toHaveBeenCalledWith(
    { partnerId: 1, idempotencyKey: 1 },
    expect.objectContaining({ unique: true })
  );
  expect(mockCreateIndex).toHaveBeenCalledWith(
    { requestId: 1 },
    expect.objectContaining({ unique: true })
  );
  expect(mockCreateIndex).toHaveBeenCalledWith(
    { type: 1, externalRef: 1 },
    expect.objectContaining({ unique: true })
  );
});

test('includes partner anti-abuse collections in database statistics', async () => {
  const stats = await databaseInit.getDatabaseStats();

  expect(stats).toMatchObject({ database: 'eventflow-test' });
  expect(mockCollection).toHaveBeenCalledWith('partner_fraud_assessments');
  expect(stats.collectionCounts).toHaveProperty('partner_cashout_requests', 0);
  expect(stats.collectionCounts).toHaveProperty('partner_fraud_assessments', 0);
});
