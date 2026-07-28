'use strict';

const mockCollections = {
  partners: [],
  partner_credit_transactions: [],
  partner_reward_integrity_events: [],
};

function mockMatches(item, query) {
  return Object.entries(query || {}).every(([key, value]) => item[key] === value);
}

const mockDb = {
  findOne: jest.fn(async (collection, query) =>
    (mockCollections[collection] || []).find(item => mockMatches(item, query)) || null
  ),
  find: jest.fn(async (collection, query) =>
    (mockCollections[collection] || []).filter(item => mockMatches(item, query))
  ),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (mockCollections[collection] || []).find(candidate => mockMatches(candidate, query));
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  }),
};

const mockPartnerService = {
  CREDIT_MATURITY_DAYS: 30,
  CREDIT_TYPES: { REDEEM: 'REDEEM' },
  debitPoints: jest.fn(),
};
const mockBaseIntegrity = {
  methodRewardEvidence: jest.fn(async () => ({ eligible: true, packageId: 'pkg_1', invoiceId: 'inv_1' })),
  recordIntegrityEvent: jest.fn(async () => ({ id: 'pri_1' })),
};
const mockSupplierEvidence = {
  methodRewardEvidence: jest.fn(async () => ({ eligible: true })),
};
const mockAdvancedIntegrity = {
  getConfig: jest.fn(() => ({ revalidationDays: 30 })),
  methodRewardEvidence: jest.fn(async () => ({ eligible: true })),
};
const mockStripeEvidence = {
  subscriptionRewardEvidence: jest.fn(async () => ({ eligible: true })),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerService', () => mockPartnerService);
jest.mock('../../services/partnerRewardIntegrityService', () => mockBaseIntegrity);
jest.mock('../../services/partnerRewardSupplierEvidenceService', () => mockSupplierEvidence);
jest.mock('../../services/partnerRewardIntegrityAdvancedService', () => mockAdvancedIntegrity);
jest.mock('../../services/partnerRewardStripeEvidenceService', () => mockStripeEvidence);
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const service = require('../../services/partnerRewardIntegrityClawbackService');

function pendingReward(overrides = {}) {
  return {
    id: 'reward_1',
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    type: 'PACKAGE_BONUS',
    amount: 10,
    createdAt: new Date(Date.now() - 48 * 3600000).toISOString(),
    ...overrides,
  };
}

function matureReward(overrides = {}) {
  return pendingReward({
    createdAt: new Date(Date.now() - 40 * 86400000).toISOString(),
    ...overrides,
  });
}

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockBaseIntegrity.methodRewardEvidence.mockResolvedValue({
    eligible: true,
    packageId: 'pkg_1',
    invoiceId: 'inv_1',
  });
  mockSupplierEvidence.methodRewardEvidence.mockResolvedValue({ eligible: true });
  mockAdvancedIntegrity.getConfig.mockReturnValue({ revalidationDays: 30 });
  mockAdvancedIntegrity.methodRewardEvidence.mockResolvedValue({ eligible: true });
  mockStripeEvidence.subscriptionRewardEvidence.mockResolvedValue({ eligible: true });
  mockPartnerService.debitPoints.mockImplementation(async ({ partnerId, amount, notes, externalRef }) => {
    const debit = {
      id: `redeem_${mockCollections.partner_credit_transactions.length}`,
      partnerId,
      supplierUserId: null,
      type: 'REDEEM',
      amount: -Math.abs(amount),
      notes,
      externalRef,
      createdAt: new Date().toISOString(),
    };
    mockCollections.partner_credit_transactions.push(debit);
    return debit;
  });
});

test('voids an invalid pending reward without debiting other legitimate points', async () => {
  const original = pendingReward();
  mockCollections.partner_credit_transactions.push(original);

  const first = await service.clawBackRewardTransaction(original, 'QUALIFYING_PACKAGE_MISSING');
  const second = await service.clawBackRewardTransaction(original, 'QUALIFYING_PACKAGE_MISSING');

  expect(first).toMatchObject({ reversalMode: 'void_pending', id: null });
  expect(second).toMatchObject({ reversalMode: 'void_pending', id: null });
  expect(mockPartnerService.debitPoints).not.toHaveBeenCalled();
  expect(original).toMatchObject({
    reversedAt: expect.any(String),
    reversalTxnId: null,
    reversalReason: 'QUALIFYING_PACKAGE_MISSING',
    reversalMode: 'void_pending',
  });
});

test('creates one financial debit for an invalid reward that already matured', async () => {
  const original = matureReward();
  mockCollections.partner_credit_transactions.push(original);

  const first = await service.clawBackRewardTransaction(original, 'QUALIFYING_PACKAGE_MISSING');
  const second = await service.clawBackRewardTransaction(original, 'QUALIFYING_PACKAGE_MISSING');

  expect(first).toMatchObject({ reversalMode: 'debit_matured', subtype: 'PARTNER_REWARD_INTEGRITY_CLAWBACK' });
  expect(second.id).toBe(first.id);
  expect(mockPartnerService.debitPoints).toHaveBeenCalledTimes(1);
  expect(original).toMatchObject({
    reversedAt: expect.any(String),
    reversalTxnId: first.id,
    reversalReason: 'QUALIFYING_PACKAGE_MISSING',
    reversalMode: 'debit_matured',
  });
});

test('repairs original mature reward markers when the clawback debit already exists', async () => {
  const original = matureReward();
  mockCollections.partner_credit_transactions.push(
    original,
    {
      id: 'existing_debit',
      partnerId: 'partner_1',
      supplierUserId: 'supplier_1',
      type: 'REDEEM',
      subtype: 'PARTNER_REWARD_INTEGRITY_CLAWBACK',
      externalRef: 'reward-integrity:reward_1',
      amount: -10,
    }
  );

  await expect(
    service.clawBackRewardTransaction(original, 'QUALIFYING_PACKAGE_MISSING')
  ).resolves.toMatchObject({ id: 'existing_debit', reversalMode: 'debit_matured' });
  expect(mockPartnerService.debitPoints).not.toHaveBeenCalled();
  expect(original).toMatchObject({
    reversalTxnId: 'existing_debit',
    reversedAt: expect.any(String),
    reversalMode: 'debit_matured',
  });
});

test('never converts an already voided pending reward into a debit after time passes', async () => {
  const original = pendingReward({
    reversedAt: new Date(Date.now() - 40 * 86400000).toISOString(),
    reversalMode: 'void_pending',
    reversalReason: 'QUALIFYING_PACKAGE_MISSING',
    createdAt: new Date(Date.now() - 100 * 86400000).toISOString(),
  });
  await expect(
    service.clawBackRewardTransaction(original, 'QUALIFYING_PACKAGE_MISSING')
  ).resolves.toMatchObject({ reversalMode: 'void_pending', id: null });
  expect(mockPartnerService.debitPoints).not.toHaveBeenCalled();
});

test('rejects invalid reward amount before writing any reversal', async () => {
  await expect(
    service.clawBackRewardTransaction(pendingReward({ amount: 0 }), 'QUALIFYING_PACKAGE_MISSING')
  ).rejects.toMatchObject({ code: 'PARTNER_REWARD_CLAWBACK_AMOUNT_INVALID' });
  expect(mockPartnerService.debitPoints).not.toHaveBeenCalled();
});

test('revalidation voids a pending reward when durable base evidence is invalidated', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  const original = pendingReward({ type: 'FIRST_REVIEW_BONUS', amount: 15 });
  mockCollections.partner_credit_transactions.push(original);
  mockBaseIntegrity.methodRewardEvidence.mockResolvedValueOnce({
    eligible: false,
    reason: 'INDEPENDENT_CUSTOMER_INTERACTION_MISSING',
  });

  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({
    checked: 1,
    clawedBack: 1,
  });
  expect(original).toMatchObject({ reversedAt: expect.any(String), reversalMode: 'void_pending' });
  expect(mockPartnerService.debitPoints).not.toHaveBeenCalled();
});

test('revalidation debits a mature reward when durable evidence is invalidated after maturity', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  const original = matureReward({ type: 'FIRST_REVIEW_BONUS', amount: 15 });
  mockCollections.partner_credit_transactions.push(original);
  mockBaseIntegrity.methodRewardEvidence.mockResolvedValueOnce({
    eligible: false,
    reason: 'INDEPENDENT_CUSTOMER_INTERACTION_MISSING',
  });

  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({
    checked: 1,
    clawedBack: 1,
  });
  expect(original.reversalMode).toBe('debit_matured');
  expect(mockPartnerService.debitPoints).toHaveBeenCalledWith(
    expect.objectContaining({ partnerId: 'partner_1', amount: 15 })
  );
});

test('revalidation voids a pending reward when supplier evidence becomes invalid', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  const original = pendingReward();
  mockCollections.partner_credit_transactions.push(original);
  mockSupplierEvidence.methodRewardEvidence.mockResolvedValueOnce({
    eligible: false,
    reason: 'SUPPLIER_REWARD_HOLD_ACTIVE',
  });

  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({
    checked: 1,
    clawedBack: 1,
  });
  expect(original.reversalReason).toBe('SUPPLIER_REWARD_HOLD_ACTIVE');
  expect(mockPartnerService.debitPoints).not.toHaveBeenCalled();
});

test('temporary timing evidence does not reverse a reward', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  const original = pendingReward();
  mockCollections.partner_credit_transactions.push(original);
  mockBaseIntegrity.methodRewardEvidence.mockResolvedValueOnce({
    eligible: false,
    reason: 'PACKAGE_MIN_LIVE_PERIOD_NOT_MET',
  });

  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({
    checked: 1,
    clawedBack: 0,
  });
  expect(original.reversedAt).toBeUndefined();
  expect(mockPartnerService.debitPoints).not.toHaveBeenCalled();
});

test('shared-network-only review risk is recorded elsewhere but never claws back by itself', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  const original = pendingReward({ type: 'FIRST_REVIEW_BONUS', amount: 15 });
  mockCollections.partner_credit_transactions.push(original);
  mockAdvancedIntegrity.methodRewardEvidence.mockResolvedValueOnce({
    eligible: false,
    reason: 'REVIEW_RING_SHARED_IP',
  });

  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({
    checked: 1,
    clawedBack: 0,
  });
  expect(original.reversedAt).toBeUndefined();
  expect(mockPartnerService.debitPoints).not.toHaveBeenCalled();
});

test('subscription reward is debited when live Stripe evidence becomes durably invalid after maturity', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  const original = matureReward({ type: 'SUBSCRIPTION_BONUS', amount: 100 });
  mockCollections.partner_credit_transactions.push(original);
  mockStripeEvidence.subscriptionRewardEvidence.mockResolvedValueOnce({
    eligible: false,
    reason: 'STRIPE_TEST_PAYMENT_NOT_ELIGIBLE',
  });

  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({
    checked: 1,
    clawedBack: 1,
  });
  expect(mockStripeEvidence.subscriptionRewardEvidence).toHaveBeenCalledWith('supplier_1', 'inv_1');
  expect(original.reversalMode).toBe('debit_matured');
});

test('temporary Stripe lookup failure never reverses an existing reward', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  const original = matureReward({ type: 'SUBSCRIPTION_BONUS', amount: 100 });
  mockCollections.partner_credit_transactions.push(original);
  mockStripeEvidence.subscriptionRewardEvidence.mockResolvedValueOnce({
    eligible: false,
    reason: 'STRIPE_PAYMENT_EVIDENCE_UNAVAILABLE',
  });

  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({
    checked: 1,
    clawedBack: 0,
  });
  expect(original.reversedAt).toBeUndefined();
});

test('keeps mature rewards in the automatic revalidation window for at least 90 days', () => {
  expect(service._test.effectiveRevalidationDays()).toBe(90);
  expect(
    service._test.isWithinRevalidationWindow(
      matureReward({ createdAt: new Date(Date.now() - 60 * 86400000).toISOString() })
    )
  ).toBe(true);
});

test('does not revalidate rewards older than the 90-day safety window by default', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  mockCollections.partner_credit_transactions.push(
    pendingReward({ createdAt: new Date(Date.now() - 91 * 86400000).toISOString() })
  );

  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({
    checked: 0,
    clawedBack: 0,
  });
  expect(mockBaseIntegrity.methodRewardEvidence).not.toHaveBeenCalled();
});
