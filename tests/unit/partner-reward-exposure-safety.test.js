'use strict';

const mockTransactions = [];
const mockDb = {
  find: jest.fn(async collection =>
    collection === 'partner_credit_transactions' ? mockTransactions : []
  ),
};
const mockPartnerService = { CREDIT_MATURITY_DAYS: 30 };

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerService', () => mockPartnerService);

const service = require('../../services/partnerRewardExposureSafetyService');

beforeEach(() => {
  mockTransactions.splice(0, mockTransactions.length);
  jest.clearAllMocks();
  delete process.env.PARTNER_REWARD_PENDING_POINTS_CAP;
});

test('counts rewards younger than normal maturity as pending', () => {
  expect(
    service._test.isPendingReward({
      type: 'PACKAGE_BONUS',
      amount: 10,
      createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    })
  ).toBe(true);
});

test('counts an explicitly extended reward as pending even after the normal 30-day window', () => {
  expect(
    service._test.isPendingReward({
      type: 'SUBSCRIPTION_BONUS',
      amount: 100,
      createdAt: new Date(Date.now() - 40 * 86400000).toISOString(),
      maturesAt: new Date(Date.now() + 20 * 86400000).toISOString(),
    })
  ).toBe(true);
});

test('does not count reversed or fully mature rewards as pending exposure', () => {
  expect(
    service._test.isPendingReward({
      type: 'PACKAGE_BONUS',
      amount: 10,
      reversedAt: new Date().toISOString(),
      createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    })
  ).toBe(false);
  expect(
    service._test.isPendingReward({
      type: 'PACKAGE_BONUS',
      amount: 10,
      createdAt: new Date(Date.now() - 40 * 86400000).toISOString(),
    })
  ).toBe(false);
});

test('blocks a new reward when effective pending exposure would exceed the cap', async () => {
  process.env.PARTNER_REWARD_PENDING_POINTS_CAP = '130';
  mockTransactions.push({
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    type: 'SUBSCRIPTION_BONUS',
    amount: 100,
    createdAt: new Date(Date.now() - 40 * 86400000).toISOString(),
    maturesAt: new Date(Date.now() + 20 * 86400000).toISOString(),
  });

  await expect(
    service.pendingExposureDecision({ partnerId: 'partner_1', amount: 100 })
  ).resolves.toMatchObject({
    eligible: false,
    reason: 'PENDING_REWARD_EXPOSURE_CAP_REACHED',
    evidence: { current: 100, attempted: 100, cap: 130 },
  });
});
