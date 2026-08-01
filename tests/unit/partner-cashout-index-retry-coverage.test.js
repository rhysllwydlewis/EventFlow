'use strict';

// Exercise both the successful memoised bootstrap and the failure-reset retry path.
const mockCreateIndex = jest.fn(async () => 'ok');
const mockCollection = jest.fn(() => ({ createIndex: mockCreateIndex }));
const mockDb = { collection: mockCollection };
const mockGetDb = jest.fn(async () => mockDb);
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

jest.mock('../../db', () => ({ getDb: mockGetDb }));
jest.mock('../../utils/logger', () => mockLogger);

const service = require('../../services/partnerCashoutOperationsIndexService');

beforeEach(() => {
  jest.clearAllMocks();
  service._test.resetForTests();
  mockGetDb.mockResolvedValue(mockDb);
  mockCollection.mockImplementation(() => ({ createIndex: mockCreateIndex }));
  mockCreateIndex.mockResolvedValue('ok');
});

test('index initialisation is memoised until explicitly reset', async () => {
  await expect(service.ensureIndexes()).resolves.toBe(true);
  await expect(service.ensureIndexes()).resolves.toBe(true);
  expect(mockGetDb).toHaveBeenCalledTimes(1);
  expect(mockLogger.info).toHaveBeenCalledWith(
    '[PARTNER-CASHOUT-OPS] Cashout operations indexes ensured'
  );

  service._test.resetForTests();
  await expect(service.ensureIndexes()).resolves.toBe(true);
  expect(mockGetDb).toHaveBeenCalledTimes(2);
});

test('a failed index build clears the memoised promise and permits a clean retry', async () => {
  mockCreateIndex.mockRejectedValueOnce(new Error('index build failed'));
  await expect(service.ensureIndexes()).rejects.toThrow('index build failed');
  expect(mockLogger.warn).toHaveBeenCalledWith(
    '[PARTNER-CASHOUT-OPS] Cashout operations index initialization failed',
    { error: 'index build failed' }
  );

  mockCreateIndex.mockResolvedValue('ok');
  await expect(service.ensureIndexes()).resolves.toBe(true);
  expect(mockGetDb).toHaveBeenCalledTimes(2);
});
