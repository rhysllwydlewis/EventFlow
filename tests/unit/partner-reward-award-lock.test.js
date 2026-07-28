'use strict';

const mockFindOneAndUpdate = jest.fn();
const mockDeleteOne = jest.fn(async () => ({ deletedCount: 1 }));
const mockCollection = {
  findOneAndUpdate: mockFindOneAndUpdate,
  deleteOne: mockDeleteOne,
};
const mockDb = { collection: jest.fn(() => mockCollection) };
const mockGetDb = jest.fn(async () => mockDb);

jest.mock('../../db', () => ({ getDb: mockGetDb }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const service = require('../../services/partnerRewardAwardLockService');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.PARTNER_REWARD_AWARD_LOCK_LEASE_MS;
  delete process.env.PARTNER_REWARD_AWARD_LOCK_WAIT_MS;
  delete process.env.PARTNER_REWARD_AWARD_LOCK_RETRY_MS;
  mockFindOneAndUpdate.mockImplementation(async (_filter, update) => ({
    value: {
      _id: 'partner_1',
      owner: update.$set.owner,
      expiresAt: update.$set.expiresAt,
    },
  }));
});

test('acquires a Mongo-backed partner lock, runs the award and always releases it', async () => {
  const operation = jest.fn(async () => 'awarded');
  await expect(service.withPartnerAwardLock('partner_1', operation)).resolves.toBe('awarded');
  expect(mockDb.collection).toHaveBeenCalledWith('partner_reward_award_locks');
  expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ _id: 'partner_1' }),
    expect.objectContaining({ $set: expect.objectContaining({ owner: expect.any(String), expiresAt: expect.any(Date) }) }),
    { upsert: true, returnDocument: 'after' }
  );
  expect(operation).toHaveBeenCalledTimes(1);
  expect(mockDeleteOne).toHaveBeenCalledWith({ _id: 'partner_1', owner: expect.any(String) });
});

test('releases the partner lock even when the protected operation fails', async () => {
  const failure = new Error('award failed');
  await expect(
    service.withPartnerAwardLock('partner_1', async () => {
      throw failure;
    })
  ).rejects.toThrow('award failed');
  expect(mockDeleteOne).toHaveBeenCalledTimes(1);
});

test('treats duplicate-key contention as another process holding the lock, then retries', async () => {
  const duplicate = new Error('duplicate key');
  duplicate.code = 11000;
  mockFindOneAndUpdate.mockRejectedValueOnce(duplicate).mockImplementationOnce(async (_filter, update) => ({
    value: { _id: 'partner_1', owner: update.$set.owner, expiresAt: update.$set.expiresAt },
  }));

  await expect(service.withPartnerAwardLock('partner_1', async () => true)).resolves.toBe(true);
  expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(2);
});

test('propagates real database failures instead of pretending they are contention', async () => {
  mockFindOneAndUpdate.mockRejectedValueOnce(new Error('database offline'));
  await expect(service.withPartnerAwardLock('partner_1', async () => true)).rejects.toThrow(
    'database offline'
  );
  expect(mockDeleteOne).not.toHaveBeenCalled();
});
