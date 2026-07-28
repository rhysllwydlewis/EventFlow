'use strict';

const collections = { partners: [], partner_credit_transactions: [] };
function matches(item, query) {
  return Object.entries(query || {}).every(([key, value]) => item[key] === value);
}
const mockDb = {
  findOne: jest.fn(async (collection, query) =>
    (collections[collection] || []).find(item => matches(item, query)) || null
  ),
  find: jest.fn(async (collection, query) =>
    (collections[collection] || []).filter(item => matches(item, query))
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
  CREDIT_TYPES: { REDEEM: 'REDEEM' },
  debitPoints: jest.fn(async ({ partnerId, amount, externalRef }) => {
    const debit = {
      id: 'debit_1',
      partnerId,
      type: 'REDEEM',
      amount: -Math.abs(amount),
      externalRef,
    };
    collections.partner_credit_transactions.push(debit);
    return debit;
  }),
};
const mockAntiAbuse = {
  supplierRewardEligibility: jest.fn(async () => ({ eligible: true })),
};
const mockBase = {
  duplicateSupplierBusinessEvidence: jest.fn(async () => ({ duplicate: false })),
  methodRewardEvidence: jest.fn(async () => ({ eligible: true })),
  recordIntegrityEvent: jest.fn(async () => ({ id: 'event_1' })),
};
const mockSupplier = { methodRewardEvidence: jest.fn(async () => ({ eligible: true })) };
const mockAdvanced = {
  getConfig: jest.fn(() => ({ revalidationDays: 90 })),
  methodRewardEvidence: jest.fn(async () => ({ eligible: true })),
};
const mockStripe = { subscriptionRewardEvidence: jest.fn(async () => ({ eligible: true })) };
const mockQualification = { revalidateSnapshot: jest.fn(async () => ({ eligible: true })) };

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerService', () => mockPartnerService);
jest.mock('../../services/partnerAntiAbuseService', () => mockAntiAbuse);
jest.mock('../../services/partnerRewardIntegrityService', () => mockBase);
jest.mock('../../services/partnerRewardSupplierEvidenceService', () => mockSupplier);
jest.mock('../../services/partnerRewardIntegrityAdvancedService', () => mockAdvanced);
jest.mock('../../services/partnerRewardStripeEvidenceService', () => mockStripe);
jest.mock('../../services/partnerRewardQualificationEvidenceService', () => mockQualification);
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const service = require('../../services/partnerRewardIntegrityClawbackService');

function reward(overrides = {}) {
  return {
    id: 'reward_1',
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    type: 'PACKAGE_BONUS',
    amount: 10,
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    qualificationEvidence: { version: 1, packageId: 'pkg_earned' },
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(collections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  collections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  mockAntiAbuse.supplierRewardEligibility.mockResolvedValue({ eligible: true });
  mockBase.duplicateSupplierBusinessEvidence.mockResolvedValue({ duplicate: false });
  mockSupplier.methodRewardEvidence.mockResolvedValue({ eligible: true });
  mockAdvanced.methodRewardEvidence.mockResolvedValue({ eligible: true });
  mockQualification.revalidateSnapshot.mockResolvedValue({ eligible: true });
});

test('revalidation asks the qualification service about the exact snapshot attached to the reward', async () => {
  const original = reward();
  collections.partner_credit_transactions.push(original);

  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({
    checked: 1,
    clawedBack: 0,
  });
  expect(mockQualification.revalidateSnapshot).toHaveBeenCalledWith(original, 'partner_user');
  expect(mockBase.methodRewardEvidence).not.toHaveBeenCalled();
});

test('exact evidence removal voids the still-pending reward even if some other milestone could exist', async () => {
  const original = reward();
  collections.partner_credit_transactions.push(original);
  mockQualification.revalidateSnapshot.mockResolvedValueOnce({
    eligible: false,
    reason: 'QUALIFYING_PACKAGE_MISSING',
  });

  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({
    checked: 1,
    clawedBack: 1,
  });
  expect(original).toMatchObject({
    reversedAt: expect.any(String),
    reversalMode: 'void_pending',
    reversalReason: 'QUALIFYING_PACKAGE_MISSING',
  });
});

test('a durable supplier fraud hold overrides a soft shared-network snapshot signal', async () => {
  const original = reward({ type: 'FIRST_REVIEW_BONUS', amount: 15 });
  collections.partner_credit_transactions.push(original);
  mockQualification.revalidateSnapshot.mockResolvedValueOnce({
    eligible: false,
    reason: 'REVIEW_RING_SHARED_IP',
  });
  mockAdvanced.methodRewardEvidence.mockResolvedValueOnce({
    eligible: false,
    reason: 'SUPPLIER_REWARD_HOLD_ACTIVE',
  });

  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({
    checked: 1,
    clawedBack: 1,
  });
  expect(original.reversalReason).toBe('SUPPLIER_REWARD_HOLD_ACTIVE');
});

test('a newly detected duplicate business identity overrides temporary payment evidence unavailability', async () => {
  const original = reward({
    type: 'SUBSCRIPTION_BONUS',
    amount: 100,
    qualificationEvidence: { version: 1, invoiceId: 'inv_earned' },
  });
  collections.partner_credit_transactions.push(original);
  mockQualification.revalidateSnapshot.mockResolvedValueOnce({
    eligible: false,
    reason: 'STRIPE_PAYMENT_EVIDENCE_UNAVAILABLE',
  });
  mockBase.duplicateSupplierBusinessEvidence.mockResolvedValueOnce({
    duplicate: true,
    reason: 'companyNumber',
    otherSupplierUserId: 'supplier_2',
  });

  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({
    checked: 1,
    clawedBack: 1,
  });
  expect(original.reversalReason).toBe('DUPLICATE_SUPPLIER_BUSINESS_IDENTITY');
});

test('legacy rewards without snapshots still use the compatibility revalidation path', async () => {
  const original = reward({ qualificationEvidence: undefined });
  collections.partner_credit_transactions.push(original);
  mockQualification.revalidateSnapshot.mockResolvedValueOnce(null);

  await service.revalidatePartnerRewards('partner_1');
  expect(mockBase.methodRewardEvidence).toHaveBeenCalledWith(
    expect.objectContaining({ supplierUserId: 'supplier_1', methodName: 'awardPackageBonus' })
  );
});
