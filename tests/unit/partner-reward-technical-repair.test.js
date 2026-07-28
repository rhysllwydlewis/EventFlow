'use strict';

const collections = {
  partner_referrals: [],
  partners: [],
  partner_credit_transactions: [],
};
function matches(item, query) {
  return Object.entries(query || {}).every(([key, value]) => item[key] === value);
}
const mockDb = {
  findOne: jest.fn(async (collection, query) =>
    (collections[collection] || []).find(item => matches(item, query)) || null
  ),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (collections[collection] || []).find(candidate => matches(candidate, query));
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  }),
};
const mockPartnerService = {
  CREDIT_MATURITY_DAYS: 30,
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
};
const mockAntiAbuse = {
  supplierRewardEligibility: jest.fn(async () => ({ eligible: true })),
};
const mockIntegrity = {
  canAwardCredit: jest.fn(async () => ({ eligible: true })),
  recordIntegrityEvent: jest.fn(async () => ({ id: 'event_1' })),
  recordAttributionConflict: jest.fn(),
};
const mockCandidates = {
  selectRewardEvidence: jest.fn(async () => ({ eligible: true, packageId: 'pkg_1' })),
};
const mockSupplierEvidence = {
  methodRewardEvidence: jest.fn(async () => ({ eligible: true, supplierId: 'sup_1' })),
};
const mockAdvanced = {
  methodRewardEvidence: jest.fn(async () => ({ eligible: true })),
  exposureDecision: jest.fn(async () => ({ eligible: true })),
  maturityExtensionDays: jest.fn(async () => 0),
};
const mockExposure = {
  pendingExposureDecision: jest.fn(async () => ({ eligible: true })),
};
const mockStripe = {
  subscriptionRewardEvidence: jest.fn(async () => ({ eligible: true })),
};
const mockQualification = {
  buildSnapshot: jest.fn(() => ({ version: 1, packageId: 'pkg_1' })),
  persistSnapshot: jest.fn(async (transaction, snapshot) => ({
    ...transaction,
    qualificationEvidence: snapshot,
  })),
};
const mockClawback = {
  clawBackRewardTransaction: jest.fn(),
  revalidatePartnerRewards: jest.fn(),
};
const mockIndexes = { ensureIndexes: jest.fn(async () => true) };
const mockLock = {
  withPartnerAwardLock: jest.fn(async (_partnerId, operation) => operation()),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerService', () => mockPartnerService);
jest.mock('../../services/partnerAntiAbuseService', () => mockAntiAbuse);
jest.mock('../../services/partnerRewardIntegrityService', () => mockIntegrity);
jest.mock('../../services/partnerRewardCandidateSelectionService', () => mockCandidates);
jest.mock('../../services/partnerRewardSupplierEvidenceService', () => mockSupplierEvidence);
jest.mock('../../services/partnerRewardIntegrityAdvancedService', () => mockAdvanced);
jest.mock('../../services/partnerRewardExposureSafetyService', () => mockExposure);
jest.mock('../../services/partnerRewardStripeEvidenceService', () => mockStripe);
jest.mock('../../services/partnerRewardQualificationEvidenceService', () => mockQualification);
jest.mock('../../services/partnerRewardIntegrityClawbackService', () => mockClawback);
jest.mock('../../services/partnerRewardIntegrityIndexService', () => mockIndexes);
jest.mock('../../services/partnerRewardAwardLockService', () => mockLock);
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const runtime = require('../../services/partnerRewardIntegrityRuntime');

function quarantinedReward(overrides = {}) {
  return {
    id: 'reward_1',
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    type: 'PACKAGE_BONUS',
    amount: 10,
    createdAt: new Date().toISOString(),
    reversedAt: new Date().toISOString(),
    reversalMode: 'void_pending',
    reversalReason: 'QUALIFICATION_EVIDENCE_PERSIST_FAILED',
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(collections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  collections.partner_referrals.push({
    id: 'ref_1',
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
  });
  collections.partners.push({ id: 'partner_1', userId: 'partner_user', status: 'active' });
  mockAntiAbuse.supplierRewardEligibility.mockResolvedValue({ eligible: true });
  mockCandidates.selectRewardEvidence.mockResolvedValue({ eligible: true, packageId: 'pkg_1' });
  mockSupplierEvidence.methodRewardEvidence.mockResolvedValue({ eligible: true, supplierId: 'sup_1' });
  mockAdvanced.methodRewardEvidence.mockResolvedValue({ eligible: true });
  mockAdvanced.exposureDecision.mockResolvedValue({ eligible: true });
  mockAdvanced.maturityExtensionDays.mockResolvedValue(0);
  mockExposure.pendingExposureDecision.mockResolvedValue({ eligible: true });
  mockIntegrity.canAwardCredit.mockResolvedValue({ eligible: true });
  mockQualification.persistSnapshot.mockImplementation(async (transaction, snapshot) => ({
    ...transaction,
    qualificationEvidence: snapshot,
  }));
  mockLock.withPartnerAwardLock.mockImplementation(async (_partnerId, operation) => operation());
});

test('recognises only the designated technical reversal reasons as repairable quarantine', () => {
  expect(runtime.isTechnicalQuarantinedReward(quarantinedReward())).toBe(true);
  expect(
    runtime.isTechnicalQuarantinedReward(
      quarantinedReward({ reversalReason: 'MATURITY_EXTENSION_PERSIST_FAILED' })
    )
  ).toBe(true);
  expect(
    runtime.isTechnicalQuarantinedReward(
      quarantinedReward({ reversalReason: 'DUPLICATE_SUPPLIER_BUSINESS_IDENTITY' })
    )
  ).toBe(false);
});

test('repairs the same ledger transaction after evidence and cap checks recover', async () => {
  const original = quarantinedReward();
  collections.partner_credit_transactions.push(original);

  const result = await runtime.repairTechnicalReward(original);

  expect(mockAntiAbuse.supplierRewardEligibility).toHaveBeenCalledWith(
    'supplier_1',
    'awardReferralSignupBonus'
  );
  expect(mockCandidates.selectRewardEvidence).toHaveBeenCalledWith({
    supplierUserId: 'supplier_1',
    partnerUserId: 'partner_user',
    methodName: 'awardPackageBonus',
  });
  expect(mockIntegrity.canAwardCredit).toHaveBeenCalledWith({
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    type: 'PACKAGE_BONUS',
    amount: 0,
  });
  expect(mockAdvanced.exposureDecision).toHaveBeenCalledWith({
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    type: 'PACKAGE_BONUS',
    amount: 0,
  });
  expect(mockExposure.pendingExposureDecision).toHaveBeenCalledWith({
    partnerId: 'partner_1',
    amount: 10,
  });
  expect(mockQualification.persistSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'reward_1' }),
    expect.objectContaining({ version: 1 })
  );
  expect(result).toMatchObject({
    id: 'reward_1',
    reversedAt: null,
    reversalMode: null,
    reversalReason: null,
    technicalRepairAt: expect.any(String),
  });
  expect(mockIntegrity.recordIntegrityEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'reward_technical_repair',
      reason: 'TECHNICAL_REWARD_REPAIRED',
    })
  );
});

test('leaves the reward quarantined while current evidence is still invalid', async () => {
  const original = quarantinedReward();
  collections.partner_credit_transactions.push(original);
  mockCandidates.selectRewardEvidence.mockResolvedValueOnce({
    eligible: false,
    reason: 'QUALIFYING_PACKAGE_MISSING',
  });

  await expect(runtime.repairTechnicalReward(original)).resolves.toBeNull();
  expect(original.reversedAt).toEqual(expect.any(String));
  expect(mockQualification.persistSnapshot).not.toHaveBeenCalled();
});

test('leaves the reward quarantined if current caps no longer permit restoration', async () => {
  const original = quarantinedReward();
  collections.partner_credit_transactions.push(original);
  mockIntegrity.canAwardCredit.mockResolvedValueOnce({
    eligible: false,
    reason: 'DAILY_REWARD_CAP_REACHED',
  });

  await expect(runtime.repairTechnicalReward(original)).resolves.toBeNull();
  expect(mockQualification.persistSnapshot).not.toHaveBeenCalled();
});

test('lock contention keeps the technical reward safely quarantined for a later retry', async () => {
  const original = quarantinedReward();
  collections.partner_credit_transactions.push(original);
  const error = new Error('busy');
  error.code = 'PARTNER_REWARD_AWARD_LOCK_TIMEOUT';
  mockLock.withPartnerAwardLock.mockRejectedValueOnce(error);

  await expect(runtime.repairTechnicalReward(original)).resolves.toBeNull();
  expect(original.reversedAt).toEqual(expect.any(String));
});
