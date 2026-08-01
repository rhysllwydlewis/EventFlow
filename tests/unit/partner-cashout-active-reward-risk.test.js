'use strict';

const collections = {
  partners: [],
  users: [],
  partner_referrals: [],
  partner_credit_transactions: [],
  suppliers: [],
  packages: [],
  reviews: [],
};
const mockDb = { read: jest.fn(async collection => collections[collection] || []) };
const mockAntiAbuse = {
  MILESTONE_REWARD_TYPES: [
    'PACKAGE_BONUS',
    'SUBSCRIPTION_BONUS',
    'REFERRAL_SIGNUP_BONUS',
    'FIRST_REVIEW_BONUS',
  ],
  identityOverlap: jest.fn(() => ({ strongMatch: false })),
  isMeaningfulPackage: jest.fn(pkg => pkg.approved === true),
  isIndependentVerifiedReview: jest.fn(review => review.approved === true),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerAntiAbuseService', () => mockAntiAbuse);

const service = require('../../services/partnerCashoutActiveRewardRiskService');

beforeEach(() => {
  Object.values(collections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockAntiAbuse.identityOverlap.mockReturnValue({ strongMatch: false });
  mockAntiAbuse.isMeaningfulPackage.mockImplementation(pkg => pkg.approved === true);
  mockAntiAbuse.isIndependentVerifiedReview.mockImplementation(review => review.approved === true);
});

function seedPartner() {
  collections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  collections.users.push(
    { id: 'partner_user', verified: true, email: 'partner@example.com' },
    { id: 'supplier_1', verified: true, email: 'supplier@example.org' }
  );
  collections.partner_referrals.push({
    id: 'ref_1',
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    supplierCreatedAt: new Date(Date.now() - 72 * 3600000).toISOString(),
  });
  collections.suppliers.push({ id: 'sup_1', ownerUserId: 'supplier_1', approved: true });
}

test('removes reward-derived fraud signals when the only reward was already reversed', async () => {
  seedPartner();
  collections.partner_credit_transactions.push({
    id: 'reward_1',
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    type: 'PACKAGE_BONUS',
    amount: 10,
    reversedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });

  const adjusted = await service.adjustAssessment(
    {
      score: 70,
      riskLevel: 'high',
      blockApproval: true,
      requiresManualReview: true,
      signals: [
        { code: 'FIRST_CASHOUT', score: 20, message: 'First cashout' },
        { code: 'POSSIBLE_SELF_REFERRAL', score: 50, message: 'Old reversed reward signal' },
      ],
      metrics: { identityMatchCount: 1, rewardedReferralCount: 1 },
    },
    { partnerId: 'partner_1' }
  );

  expect(adjusted.signals.map(item => item.code)).toEqual(['FIRST_CASHOUT']);
  expect(adjusted).toMatchObject({
    score: 20,
    riskLevel: 'low',
    blockApproval: false,
    requiresManualReview: true,
    metrics: {
      activeRewardTransactionCount: 0,
      reversedRewardTransactionCount: 1,
      identityMatchCount: 0,
      rewardedReferralCount: 0,
    },
  });
});

test('keeps reward-derived risk for an active unreversed reward', async () => {
  seedPartner();
  collections.partner_credit_transactions.push({
    id: 'reward_1',
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    type: 'PACKAGE_BONUS',
    amount: 10,
    createdAt: new Date().toISOString(),
  });
  mockAntiAbuse.identityOverlap.mockReturnValue({ strongMatch: true });

  const adjusted = await service.adjustAssessment(
    { score: 20, signals: [{ code: 'FIRST_CASHOUT', score: 20 }], metrics: {} },
    { partnerId: 'partner_1' }
  );

  expect(adjusted.signals.map(item => item.code)).toContain('POSSIBLE_SELF_REFERRAL');
  expect(adjusted.blockApproval).toBe(true);
  expect(adjusted.metrics.activeRewardTransactionCount).toBe(1);
});

test('recomputes weak package signals using only active package rewards', async () => {
  seedPartner();
  collections.partner_credit_transactions.push({
    id: 'active_package',
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    type: 'PACKAGE_BONUS',
    amount: 10,
    createdAt: new Date().toISOString(),
  });
  mockAntiAbuse.isMeaningfulPackage.mockReturnValue(false);

  const result = await service.recomputeRewardSignals('partner_1');
  expect(result.signals).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_REWARD_WITHOUT_QUALIFYING_PACKAGE', score: 60 }),
    ])
  );
  expect(result.metrics.weakPackageRewardCount).toBe(1);
});

test('preserves non-reward registration and first-cashout signals while replacing reward signals', async () => {
  seedPartner();
  const adjusted = await service.adjustAssessment(
    {
      score: 95,
      signals: [
        { code: 'PARTNER_REGISTRATION_RISK', score: 20 },
        { code: 'FIRST_CASHOUT', score: 20 },
        { code: 'UNVERIFIED_REFERRED_SUPPLIERS', score: 30 },
      ],
      metrics: {},
    },
    { partnerId: 'partner_1' }
  );
  expect(adjusted.signals.map(item => item.code)).toEqual([
    'PARTNER_REGISTRATION_RISK',
    'FIRST_CASHOUT',
  ]);
  expect(adjusted.score).toBe(40);
  expect(adjusted.riskLevel).toBe('review');
});
