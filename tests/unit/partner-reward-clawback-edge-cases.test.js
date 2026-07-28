'use strict';

const mockCollections = {
  partner_referrals: [],
  partner_credit_transactions: [],
};

function matches(item, query) {
  return Object.entries(query).every(([key, value]) => item[key] === value);
}

const mockDb = {
  findOne: jest.fn(
    async (collection, query) =>
      (mockCollections[collection] || []).find(item => matches(item, query)) || null
  ),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (mockCollections[collection] || []).find(candidate => matches(candidate, query));
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  }),
};

const mockDebitPoints = jest.fn(async ({ partnerId, amount, notes, externalRef }) => {
  const debit = {
    id: 'ptx_debit',
    partnerId,
    supplierUserId: null,
    type: 'REDEEM',
    amount: -amount,
    notes,
    externalRef,
  };
  mockCollections.partner_credit_transactions.push(debit);
  return debit;
});

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerService', () => ({
  CREDIT_TYPES: { SUBSCRIPTION_BONUS: 'SUBSCRIPTION_BONUS' },
  SUBSCRIPTION_BONUS: 100,
  debitPoints: mockDebitPoints,
}));
jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

const clawback = require('../../services/partnerRewardClawbackService');

function seedReward() {
  mockCollections.partner_referrals.push({
    id: 'ref_1',
    partnerId: 'prt_1',
    supplierUserId: 'usr_supplier',
  });
  mockCollections.partner_credit_transactions.push({
    id: 'ptx_reward',
    partnerId: 'prt_1',
    supplierUserId: 'usr_supplier',
    type: 'SUBSCRIPTION_BONUS',
    amount: 100,
  });
}

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockDebitPoints.mockImplementation(async ({ partnerId, amount, notes, externalRef }) => {
    const debit = {
      id: 'ptx_debit',
      partnerId,
      supplierUserId: null,
      type: 'REDEEM',
      amount: -amount,
      notes,
      externalRef,
    };
    mockCollections.partner_credit_transactions.push(debit);
    return debit;
  });
  mockDb.updateOne.mockImplementation(async (collection, query, update) => {
    const item = (mockCollections[collection] || []).find(candidate => matches(candidate, query));
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  });
});

test('does not attempt a clawback without a supplier and stable external reference', async () => {
  await expect(
    clawback.clawBackSubscriptionReward({ supplierUserId: '', externalRef: 'payment:1' })
  ).resolves.toBeNull();
  await expect(
    clawback.clawBackSubscriptionReward({ supplierUserId: 'usr_supplier', externalRef: '' })
  ).resolves.toBeNull();
  expect(mockDb.findOne).not.toHaveBeenCalled();
});

test('does nothing when the supplier has no referral attribution', async () => {
  await expect(
    clawback.clawBackSubscriptionReward({
      supplierUserId: 'usr_supplier',
      externalRef: 'payment:1',
    })
  ).resolves.toBeNull();
  expect(mockDebitPoints).not.toHaveBeenCalled();
});

test('returns an existing completed debit when historic source records no longer exist', async () => {
  const existing = {
    id: 'ptx_existing',
    type: 'REDEEM',
    subtype: 'PARTNER_REWARD_CLAWBACK',
    externalRef: 'payment:1',
  };
  mockCollections.partner_credit_transactions.push(existing);

  await expect(
    clawback.clawBackSubscriptionReward({
      supplierUserId: 'usr_supplier',
      externalRef: 'payment:1',
    })
  ).resolves.toBe(existing);
  expect(mockDebitPoints).not.toHaveBeenCalled();
});

test('repairs a completed debit when the referral reversal marker was not stored', async () => {
  seedReward();
  mockCollections.partner_credit_transactions.push({
    id: 'ptx_existing',
    partnerId: 'prt_1',
    supplierUserId: 'usr_supplier',
    type: 'REDEEM',
    subtype: 'PARTNER_REWARD_CLAWBACK',
    externalRef: 'payment:1',
    amount: -100,
  });

  const result = await clawback.clawBackSubscriptionReward({
    supplierUserId: 'usr_supplier',
    externalRef: 'payment:1',
  });

  expect(result).toMatchObject({ id: 'ptx_existing', subtype: 'PARTNER_REWARD_CLAWBACK' });
  expect(mockDebitPoints).not.toHaveBeenCalled();
  expect(mockCollections.partner_referrals[0]).toMatchObject({
    subscriptionRewardReversalRef: 'payment:1',
    subscriptionRewardReversedAt: expect.any(String),
  });
});

test('fails closed when the clawback debit does not persist', async () => {
  seedReward();
  mockDebitPoints.mockResolvedValueOnce(null);

  await expect(
    clawback.clawBackSubscriptionReward({
      supplierUserId: 'usr_supplier',
      externalRef: 'payment:1',
      reason: 'payment refunded',
    })
  ).rejects.toThrow('Partner reward clawback debit did not persist');
});

test('fails closed when clawback audit fields do not persist', async () => {
  seedReward();
  mockDb.updateOne.mockResolvedValueOnce(null);

  await expect(
    clawback.clawBackSubscriptionReward({
      supplierUserId: 'usr_supplier',
      externalRef: 'payment:1',
    })
  ).rejects.toThrow('Partner reward clawback audit fields did not persist');
});

test('fails closed when referral reversal state does not persist', async () => {
  seedReward();
  mockDb.updateOne
    .mockImplementationOnce(async (collection, query, update) => {
      const item = mockCollections[collection].find(candidate => matches(candidate, query));
      Object.assign(item, update.$set || update);
      return item;
    })
    .mockResolvedValueOnce(null);

  await expect(
    clawback.clawBackSubscriptionReward({
      supplierUserId: 'usr_supplier',
      externalRef: 'payment:1',
    })
  ).rejects.toThrow('Partner referral clawback state did not persist');
});
