'use strict';

const mockPartnerService = {
  CREDIT_TYPES: {
    REFERRAL_SIGNUP_BONUS: 'REFERRAL_SIGNUP_BONUS',
    PACKAGE_BONUS: 'PACKAGE_BONUS',
    FIRST_REVIEW_BONUS: 'FIRST_REVIEW_BONUS',
    SUBSCRIPTION_BONUS: 'SUBSCRIPTION_BONUS',
  },
  REFERRAL_SIGNUP_BONUS: 5,
  PACKAGE_BONUS: 10,
  FIRST_REVIEW_BONUS: 15,
  SUBSCRIPTION_BONUS: 100,
  awardReferralSignupBonus: jest.fn(async supplierUserId => ({ id: `signup_${supplierUserId}` })),
  awardPackageBonus: jest.fn(async supplierUserId => ({ id: `package_${supplierUserId}` })),
  awardFirstReviewBonus: jest.fn(async supplierUserId => ({ id: `review_${supplierUserId}` })),
  awardSubscriptionBonus: jest.fn(async supplierUserId => ({ id: `subscription_${supplierUserId}` })),
  recordReferral: jest.fn(async input => ({ id: 'ref_new', ...input })),
};

const collections = {
  partner_referrals: [],
  partners: [],
};

const mockDb = {
  findOne: jest.fn(async (collection, query) =>
    (collections[collection] || []).find(item =>
      Object.entries(query || {}).every(([key, value]) => item[key] === value)
    ) || null
  ),
};

const mockIntegrity = {
  methodRewardEvidence: jest.fn(async () => ({ eligible: true })),
  canAwardCredit: jest.fn(async () => ({ eligible: true })),
  recordIntegrityEvent: jest.fn(async () => ({ id: 'pri_1' })),
  recordAttributionConflict: jest.fn(async () => ({ id: 'pri_conflict' })),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerService', () => mockPartnerService);
jest.mock('../../services/partnerRewardIntegrityService', () => mockIntegrity);
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const runtime = require('../../services/partnerRewardIntegrityRuntime');

beforeAll(() => {
  runtime.install();
});

beforeEach(() => {
  collections.partner_referrals.splice(0, collections.partner_referrals.length);
  collections.partners.splice(0, collections.partners.length);
  jest.clearAllMocks();
  mockIntegrity.methodRewardEvidence.mockResolvedValue({ eligible: true });
  mockIntegrity.canAwardCredit.mockResolvedValue({ eligible: true });
});

function seedReferral() {
  collections.partner_referrals.push({
    id: 'ref_1',
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
  });
  collections.partners.push({ id: 'partner_1', userId: 'partner_user', status: 'active' });
}

test('allows a reward only after qualification evidence and earning caps both pass', async () => {
  seedReferral();

  await expect(mockPartnerService.awardPackageBonus('supplier_1')).resolves.toEqual({
    id: 'package_supplier_1',
  });
  expect(mockIntegrity.methodRewardEvidence).toHaveBeenCalledWith({
    supplierUserId: 'supplier_1',
    partnerId: 'partner_1',
    partnerUserId: 'partner_user',
    methodName: 'awardPackageBonus',
  });
  expect(mockIntegrity.canAwardCredit).toHaveBeenCalledWith({
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    type: 'PACKAGE_BONUS',
    amount: 10,
  });
});

test('withholds and audits a reward when qualification evidence fails', async () => {
  seedReferral();
  mockIntegrity.methodRewardEvidence.mockResolvedValueOnce({
    eligible: false,
    reason: 'PACKAGE_MIN_LIVE_PERIOD_NOT_MET',
    evidence: { liveHours: 2, requiredHours: 24 },
  });

  await expect(mockPartnerService.awardPackageBonus('supplier_1')).resolves.toBeNull();
  expect(mockIntegrity.canAwardCredit).not.toHaveBeenCalled();
  expect(mockIntegrity.recordIntegrityEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      partnerId: 'partner_1',
      supplierUserId: 'supplier_1',
      rewardType: 'PACKAGE_BONUS',
      reason: 'PACKAGE_MIN_LIVE_PERIOD_NOT_MET',
    })
  );
});

test('withholds and audits a reward when a rolling cap is reached', async () => {
  seedReferral();
  mockIntegrity.canAwardCredit.mockResolvedValueOnce({
    eligible: false,
    reason: 'DAILY_REWARD_CAP_REACHED',
    evidence: { current: 5000, attempted: 100, cap: 5000 },
  });

  await expect(mockPartnerService.awardSubscriptionBonus('supplier_1')).resolves.toBeNull();
  expect(mockIntegrity.recordIntegrityEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      rewardType: 'SUBSCRIPTION_BONUS',
      reason: 'DAILY_REWARD_CAP_REACHED',
    })
  );
});

test('preserves first attribution and records an attempted reassignment', async () => {
  collections.partner_referrals.push({
    id: 'ref_existing',
    partnerId: 'partner_original',
    supplierUserId: 'supplier_1',
  });

  const result = await mockPartnerService.recordReferral({
    partnerId: 'partner_attempted',
    supplierUserId: 'supplier_1',
  });

  expect(result).toMatchObject({ id: 'ref_existing', partnerId: 'partner_original' });
  expect(mockIntegrity.recordAttributionConflict).toHaveBeenCalledWith({
    supplierUserId: 'supplier_1',
    existingPartnerId: 'partner_original',
    attemptedPartnerId: 'partner_attempted',
  });
});
