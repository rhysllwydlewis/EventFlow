'use strict';

const mockCollections = {
  partner_referrals: [],
  partner_credit_transactions: [],
};

jest.mock('../../db-unified', () => ({
  findOne: jest.fn(async (collection, query) =>
    (mockCollections[collection] || []).find(item =>
      Object.entries(query).every(([key, value]) => item[key] === value)
    ) || null
  ),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (mockCollections[collection] || []).find(candidate =>
      Object.entries(query).every(([key, value]) => candidate[key] === value)
    );
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  }),
}));

const mockDebitPoints = jest.fn(async ({ partnerId, amount, notes, externalRef }) => {
  const txn = {
    id: 'ptx_clawback',
    partnerId,
    supplierUserId: null,
    type: 'REDEEM',
    amount: -amount,
    notes,
    externalRef,
  };
  mockCollections.partner_credit_transactions.push(txn);
  return txn;
});

jest.mock('../../services/partnerService', () => ({
  CREDIT_TYPES: { SUBSCRIPTION_BONUS: 'SUBSCRIPTION_BONUS', REDEEM: 'REDEEM' },
  SUBSCRIPTION_BONUS: 100,
  debitPoints: mockDebitPoints,
}));

jest.mock('../../utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

const clawback = require('../../services/partnerRewardClawbackService');

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
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
});

test('creates one REDEEM debit across repeated refund and dispute updates', async () => {
  const payment = {
    id: 'pay_1',
    userId: 'usr_supplier',
    stripePaymentId: 'pi_1',
  };

  const first = await clawback.clawBackForPaymentRecord(payment, 'refunded');
  const second = await clawback.clawBackForPaymentRecord(payment, 'disputed');

  expect(first).toMatchObject({
    type: 'REDEEM',
    subtype: clawback.CLAWBACK_SUBTYPE,
    supplierUserId: 'usr_supplier',
    amount: -100,
  });
  expect(second).toMatchObject({ id: 'ptx_clawback', type: 'REDEEM' });
  expect(mockDebitPoints).toHaveBeenCalledTimes(1);
  expect(
    mockCollections.partner_credit_transactions.find(item => item.id === 'ptx_clawback')
  ).toMatchObject({
    type: 'REDEEM',
    subtype: 'PARTNER_REWARD_CLAWBACK',
    originalRewardTxnId: 'ptx_reward',
  });
  expect(mockCollections.partner_referrals[0]).toMatchObject({
    subscriptionRewardReversalRef: 'payment:pi_1:partner-subscription-reward',
  });
});

test('does nothing when the supplier never generated a subscription reward', async () => {
  mockCollections.partner_credit_transactions.splice(0, 1);
  await expect(
    clawback.clawBackForPaymentRecord(
      { id: 'pay_2', userId: 'usr_supplier', stripePaymentId: 'pi_2' },
      'refunded'
    )
  ).resolves.toBeNull();
  expect(mockDebitPoints).not.toHaveBeenCalled();
});

test('ignores non-adverse payment statuses', async () => {
  await expect(
    clawback.clawBackForPaymentRecord(
      { id: 'pay_3', userId: 'usr_supplier', stripePaymentId: 'pi_3' },
      'succeeded'
    )
  ).resolves.toBeNull();
  expect(mockDebitPoints).not.toHaveBeenCalled();
});
