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
  CREDIT_MATURITY_DAYS: 30,
  awardReferralSignupBonus: jest.fn(async supplierUserId => ({ id: `signup_${supplierUserId}`, createdAt: '2026-07-01T00:00:00.000Z' })),
  awardPackageBonus: jest.fn(async supplierUserId => ({ id: `package_${supplierUserId}`, createdAt: '2026-07-01T00:00:00.000Z' })),
  awardFirstReviewBonus: jest.fn(async supplierUserId => ({ id: `review_${supplierUserId}`, createdAt: '2026-07-01T00:00:00.000Z' })),
  awardSubscriptionBonus: jest.fn(async supplierUserId => ({ id: `subscription_${supplierUserId}`, createdAt: '2026-07-01T00:00:00.000Z' })),
  recordReferral: jest.fn(async input => ({ id: 'ref_new', ...input })),
};

const mockCollections = { partner_referrals: [], partners: [], partner_credit_transactions: [] };
const mockDb = {
  findOne: jest.fn(async (collection, query) =>
    (mockCollections[collection] || []).find(item => Object.entries(query || {}).every(([key, value]) => item[key] === value)) || null
  ),
  updateOne: jest.fn(async (collection, query, update) => {
    const items = mockCollections[collection] || [];
    let item = items.find(candidate => Object.entries(query || {}).every(([key, value]) => candidate[key] === value));
    if (!item && collection === 'partner_credit_transactions') {
      item = { id: query.id };
      items.push(item);
    }
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  }),
};
const mockIntegrity = {
  methodRewardEvidence: jest.fn(async () => ({ eligible: true, packageId: 'pkg_1', invoiceId: 'inv_1' })),
  canAwardCredit: jest.fn(async () => ({ eligible: true })),
  recordIntegrityEvent: jest.fn(async () => ({ id: 'pri_1' })),
  recordAttributionConflict: jest.fn(async () => ({ id: 'pri_conflict' })),
};
const mockSupplierEvidence = { methodRewardEvidence: jest.fn(async () => ({ eligible: true })) };
const mockAdvancedIntegrity = {
  methodRewardEvidence: jest.fn(async () => ({ eligible: true })),
  exposureDecision: jest.fn(async () => ({ eligible: true })),
  maturityExtensionDays: jest.fn(async () => 0),
};
const mockStripeEvidence = { subscriptionRewardEvidence: jest.fn(async () => ({ eligible: true })) };
const mockClawback = { revalidatePartnerRewards: jest.fn(async () => ({ checked: 0, clawedBack: 0 })) };

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerService', () => mockPartnerService);
jest.mock('../../services/partnerRewardIntegrityService', () => mockIntegrity);
jest.mock('../../services/partnerRewardSupplierEvidenceService', () => mockSupplierEvidence);
jest.mock('../../services/partnerRewardIntegrityAdvancedService', () => mockAdvancedIntegrity);
jest.mock('../../services/partnerRewardStripeEvidenceService', () => mockStripeEvidence);
jest.mock('../../services/partnerRewardIntegrityClawbackService', () => mockClawback);
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const runtime = require('../../services/partnerRewardIntegrityRuntime');

beforeAll(() => runtime.install());
beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockIntegrity.methodRewardEvidence.mockResolvedValue({ eligible: true, packageId: 'pkg_1', invoiceId: 'inv_1' });
  mockIntegrity.canAwardCredit.mockResolvedValue({ eligible: true });
  mockSupplierEvidence.methodRewardEvidence.mockResolvedValue({ eligible: true });
  mockAdvancedIntegrity.methodRewardEvidence.mockResolvedValue({ eligible: true });
  mockAdvancedIntegrity.exposureDecision.mockResolvedValue({ eligible: true });
  mockAdvancedIntegrity.maturityExtensionDays.mockResolvedValue(0);
  mockStripeEvidence.subscriptionRewardEvidence.mockResolvedValue({ eligible: true });
});

function seedReferral() {
  mockCollections.partner_referrals.push({ id: 'ref_1', partnerId: 'partner_1', supplierUserId: 'supplier_1' });
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user', status: 'active' });
}

test('allows a package reward only after all evidence and exposure checks pass', async () => {
  seedReferral();
  await expect(mockPartnerService.awardPackageBonus('supplier_1')).resolves.toMatchObject({ id: 'package_supplier_1' });
  expect(mockIntegrity.methodRewardEvidence).toHaveBeenCalledWith(expect.objectContaining({ methodName: 'awardPackageBonus' }));
  expect(mockSupplierEvidence.methodRewardEvidence).toHaveBeenCalledWith({ supplierUserId: 'supplier_1', methodName: 'awardPackageBonus' });
  expect(mockAdvancedIntegrity.methodRewardEvidence).toHaveBeenCalled();
  expect(mockIntegrity.canAwardCredit).toHaveBeenCalled();
  expect(mockAdvancedIntegrity.exposureDecision).toHaveBeenCalled();
  expect(mockStripeEvidence.subscriptionRewardEvidence).not.toHaveBeenCalled();
});

test('withholds when supplier profile evidence is incomplete', async () => {
  seedReferral();
  mockSupplierEvidence.methodRewardEvidence.mockResolvedValueOnce({ eligible: false, reason: 'SUPPLIER_PROFILE_EVIDENCE_INCOMPLETE' });
  await expect(mockPartnerService.awardReferralSignupBonus('supplier_1')).resolves.toBeNull();
  expect(mockAdvancedIntegrity.methodRewardEvidence).not.toHaveBeenCalled();
  expect(mockIntegrity.recordIntegrityEvent).toHaveBeenCalledWith(expect.objectContaining({ reason: 'SUPPLIER_PROFILE_EVIDENCE_INCOMPLETE' }));
});

test('withholds when advanced evidence fails', async () => {
  seedReferral();
  mockAdvancedIntegrity.methodRewardEvidence.mockResolvedValueOnce({ eligible: false, reason: 'NEAR_DUPLICATE_PACKAGE_CONTENT' });
  await expect(mockPartnerService.awardPackageBonus('supplier_1')).resolves.toBeNull();
  expect(mockIntegrity.canAwardCredit).not.toHaveBeenCalled();
});

test('requires live Stripe payment evidence before a subscription reward', async () => {
  seedReferral();
  mockStripeEvidence.subscriptionRewardEvidence.mockResolvedValueOnce({ eligible: false, reason: 'STRIPE_TEST_PAYMENT_NOT_ELIGIBLE' });
  await expect(mockPartnerService.awardSubscriptionBonus('supplier_1')).resolves.toBeNull();
  expect(mockStripeEvidence.subscriptionRewardEvidence).toHaveBeenCalledWith('supplier_1', 'inv_1');
  expect(mockIntegrity.canAwardCredit).not.toHaveBeenCalled();
  expect(mockIntegrity.recordIntegrityEvent).toHaveBeenCalledWith(expect.objectContaining({ reason: 'STRIPE_TEST_PAYMENT_NOT_ELIGIBLE' }));
});

test('withholds when a rolling cap is reached', async () => {
  seedReferral();
  mockIntegrity.canAwardCredit.mockResolvedValueOnce({ eligible: false, reason: 'DAILY_REWARD_CAP_REACHED' });
  await expect(mockPartnerService.awardSubscriptionBonus('supplier_1')).resolves.toBeNull();
  expect(mockAdvancedIntegrity.exposureDecision).not.toHaveBeenCalled();
});

test('withholds when an exposure cap is reached', async () => {
  seedReferral();
  mockAdvancedIntegrity.exposureDecision.mockResolvedValueOnce({ eligible: false, reason: 'PER_SUPPLIER_REWARD_CAP_REACHED' });
  await expect(mockPartnerService.awardFirstReviewBonus('supplier_1')).resolves.toBeNull();
  expect(mockIntegrity.recordIntegrityEvent).toHaveBeenCalledWith(expect.objectContaining({ reason: 'PER_SUPPLIER_REWARD_CAP_REACHED' }));
});

test('persists extended maturity when registration risk requires it', async () => {
  seedReferral();
  mockAdvancedIntegrity.maturityExtensionDays.mockResolvedValueOnce(30);
  const reward = await mockPartnerService.awardPackageBonus('supplier_1');
  expect(mockDb.updateOne).toHaveBeenCalledWith(
    'partner_credit_transactions',
    { id: 'package_supplier_1' },
    { $set: expect.objectContaining({ maturityExtensionDays: 30, maturesAt: expect.any(String) }) }
  );
  expect(reward).toMatchObject({ maturityExtensionDays: 30 });
});

test('preserves first attribution and records attempted reassignment', async () => {
  mockCollections.partner_referrals.push({ id: 'ref_existing', partnerId: 'partner_original', supplierUserId: 'supplier_1' });
  const result = await mockPartnerService.recordReferral({ partnerId: 'partner_attempted', supplierUserId: 'supplier_1' });
  expect(result).toMatchObject({ id: 'ref_existing', partnerId: 'partner_original' });
  expect(mockIntegrity.recordAttributionConflict).toHaveBeenCalledWith({ supplierUserId: 'supplier_1', existingPartnerId: 'partner_original', attemptedPartnerId: 'partner_attempted' });
});

test('delegates lifecycle revalidation to clawback service', async () => {
  await runtime.revalidatePartnerRewards('partner_1');
  expect(mockClawback.revalidatePartnerRewards).toHaveBeenCalledWith('partner_1');
});
