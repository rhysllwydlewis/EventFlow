'use strict';

const mockCreateIndex = jest.fn(async () => 'index');
const mockCollection = jest.fn(() => ({ createIndex: mockCreateIndex }));
const mockDb = { collection: mockCollection };

jest.mock('../../config/database', () => ({
  mongoDb: { getDb: jest.fn(() => mockDb) },
}));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const database = require('../../utils/database');

beforeEach(() => {
  jest.clearAllMocks();
});

test('creates runtime TTL and correlation indexes for registration anti-abuse evidence', async () => {
  await database.addDatabaseIndexes();

  expect(mockCollection).toHaveBeenCalledWith('partner_abuse_events');
  expect(mockCreateIndex).toHaveBeenCalledWith({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
  expect(mockCreateIndex).toHaveBeenCalledWith({ outcome: 1, createdAt: -1 });
  expect(mockCreateIndex).toHaveBeenCalledWith({ deviceCookieHash: 1, createdAt: -1 });
  expect(mockCreateIndex).toHaveBeenCalledWith({ phoneHash: 1, createdAt: -1 });
  expect(mockCreateIndex).toHaveBeenCalledWith({ companyAddressHash: 1, createdAt: -1 });
});

test('keeps administrator override evidence until audit retention expiry', async () => {
  await database.addDatabaseIndexes();

  expect(mockCollection).toHaveBeenCalledWith('partner_abuse_overrides');
  expect(mockCreateIndex).toHaveBeenCalledWith(
    { retentionExpiresAtDate: 1 },
    { expireAfterSeconds: 0 }
  );
  expect(mockCreateIndex).toHaveBeenCalledWith({ subjectHash: 1, scope: 1, createdAt: -1 });
});

test('creates appeal lookup and TTL indexes', async () => {
  await database.addDatabaseIndexes();

  expect(mockCollection).toHaveBeenCalledWith('partner_abuse_appeals');
  expect(mockCreateIndex).toHaveBeenCalledWith({ status: 1, createdAt: -1 });
  expect(mockCreateIndex).toHaveBeenCalledWith({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
});
