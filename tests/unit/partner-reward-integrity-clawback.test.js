'use strict';

const mockCollections = { partners: [], partner_credit_transactions: [], partner_reward_integrity_events: [] };
function mockMatches(item, query) { return Object.entries(query || {}).every(([key, value]) => item[key] === value); }
const mockDb = {
  findOne: jest.fn(async (collection, query) => (mockCollections[collection] || []).find(item => mockMatches(item, query)) || null),
  find: jest.fn(async (collection, query) => (mockCollections[collection] || []).filter(item => mockMatches(item, query))),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (mockCollections[collection] || []).find(candidate => mockMatches(candidate, query));
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  }),
};
const mockPartnerService = { CREDIT_TYPES: { REDEEM: 'REDEEM' }, debitPoints: jest.fn() };
const mockBaseIntegrity = {
  methodRewardEvidence: jest.fn(async () => ({ eligible: true, packageId: 'pkg_1', invoiceId: 'inv_1' })),
  recordIntegrityEvent: jest.fn(async () => ({ id: 'pri_1' })),
};
const mockSupplierEvidence = { methodRewardEvidence: jest.fn(async () => ({ eligible: true })) };
const mockAdvancedIntegrity = {
  getConfig: jest.fn(() => ({ revalidationDays: 30 })),
  methodRewardEvidence: jest.fn(async () => ({ eligible: true })),
};
const mockStripeEvidence = { subscriptionRewardEvidence: jest.fn(async () => ({ eligible: true })) };

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerService', () => mockPartnerService);
jest.mock('../../services/partnerRewardIntegrityService', () => mockBaseIntegrity);
jest.mock('../../services/partnerRewardSupplierEvidenceService', () => mockSupplierEvidence);
jest.mock('../../services/partnerRewardIntegrityAdvancedService', () => mockAdvancedIntegrity);
jest.mock('../../services/partnerRewardStripeEvidenceService', () => mockStripeEvidence);
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const service = require('../../services/partnerRewardIntegrityClawbackService');

function reward(overrides = {}) {
  return { id: 'reward_1', partnerId: 'partner_1', supplierUserId: 'supplier_1', type: 'PACKAGE_BONUS', amount: 10, createdAt: new Date(Date.now() - 48 * 3600000).toISOString(), ...overrides };
}

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockBaseIntegrity.methodRewardEvidence.mockResolvedValue({ eligible: true, packageId: 'pkg_1', invoiceId: 'inv_1' });
  mockSupplierEvidence.methodRewardEvidence.mockResolvedValue({ eligible: true });
  mockAdvancedIntegrity.getConfig.mockReturnValue({ revalidationDays: 30 });
  mockAdvancedIntegrity.methodRewardEvidence.mockResolvedValue({ eligible: true });
  mockStripeEvidence.subscriptionRewardEvidence.mockResolvedValue({ eligible: true });
  mockPartnerService.debitPoints.mockImplementation(async ({ partnerId, amount, notes, externalRef }) => {
    const debit = { id: `redeem_${mockCollections.partner_credit_transactions.length}`, partnerId, supplierUserId: null, type: 'REDEEM', amount: -Math.abs(amount), notes, externalRef, createdAt: new Date().toISOString() };
    mockCollections.partner_credit_transactions.push(debit);
    return debit;
  });
});

test('creates one financial debit and reapplies audit markers on retries', async () => {
  const original = reward();
  mockCollections.partner_credit_transactions.push(original);
  const first = await service.clawBackRewardTransaction(original, 'QUALIFYING_PACKAGE_MISSING');
  const second = await service.clawBackRewardTransaction(original, 'QUALIFYING_PACKAGE_MISSING');
  expect(second.id).toBe(first.id);
  expect(mockPartnerService.debitPoints).toHaveBeenCalledTimes(1);
  expect(original).toMatchObject({ reversedAt: expect.any(String), reversalTxnId: first.id, reversalReason: 'QUALIFYING_PACKAGE_MISSING' });
});

test('repairs original reward markers when a clawback debit already exists', async () => {
  const original = reward();
  mockCollections.partner_credit_transactions.push(original, { id: 'existing_debit', partnerId: 'partner_1', supplierUserId: 'supplier_1', type: 'REDEEM', subtype: 'PARTNER_REWARD_INTEGRITY_CLAWBACK', externalRef: 'reward-integrity:reward_1', amount: -10 });
  await expect(service.clawBackRewardTransaction(original, 'QUALIFYING_PACKAGE_MISSING')).resolves.toMatchObject({ id: 'existing_debit' });
  expect(mockPartnerService.debitPoints).not.toHaveBeenCalled();
  expect(original).toMatchObject({ reversalTxnId: 'existing_debit', reversedAt: expect.any(String) });
});

test('rejects invalid reward amount before writing a debit', async () => {
  await expect(service.clawBackRewardTransaction(reward({ amount: 0 }), 'QUALIFYING_PACKAGE_MISSING')).rejects.toMatchObject({ code: 'PARTNER_REWARD_CLAWBACK_AMOUNT_INVALID' });
  expect(mockPartnerService.debitPoints).not.toHaveBeenCalled();
});

test('revalidation claws back durable base evidence invalidation', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  const original = reward({ type: 'FIRST_REVIEW_BONUS', amount: 15 });
  mockCollections.partner_credit_transactions.push(original);
  mockBaseIntegrity.methodRewardEvidence.mockResolvedValueOnce({ eligible: false, reason: 'INDEPENDENT_CUSTOMER_INTERACTION_MISSING' });
  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({ checked: 1, clawedBack: 1 });
  expect(original.reversedAt).toEqual(expect.any(String));
});

test('revalidation claws back when supplier evidence becomes invalid', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  const original = reward();
  mockCollections.partner_credit_transactions.push(original);
  mockSupplierEvidence.methodRewardEvidence.mockResolvedValueOnce({ eligible: false, reason: 'SUPPLIER_REWARD_HOLD_ACTIVE' });
  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({ checked: 1, clawedBack: 1 });
  expect(original.reversalReason).toBe('SUPPLIER_REWARD_HOLD_ACTIVE');
});

test('temporary timing evidence does not claw back a reward', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  const original = reward();
  mockCollections.partner_credit_transactions.push(original);
  mockBaseIntegrity.methodRewardEvidence.mockResolvedValueOnce({ eligible: false, reason: 'PACKAGE_MIN_LIVE_PERIOD_NOT_MET' });
  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({ checked: 1, clawedBack: 0 });
  expect(mockPartnerService.debitPoints).not.toHaveBeenCalled();
});

test('advanced durable evidence invalidation triggers a clawback', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  const original = reward();
  mockCollections.partner_credit_transactions.push(original);
  mockAdvancedIntegrity.methodRewardEvidence.mockResolvedValueOnce({ eligible: false, reason: 'NEAR_DUPLICATE_PACKAGE_CONTENT' });
  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({ checked: 1, clawedBack: 1 });
  expect(original.reversalReason).toBe('NEAR_DUPLICATE_PACKAGE_CONTENT');
});

test('subscription reward is clawed back when live Stripe evidence becomes durably invalid', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  const original = reward({ type: 'SUBSCRIPTION_BONUS', amount: 100 });
  mockCollections.partner_credit_transactions.push(original);
  mockStripeEvidence.subscriptionRewardEvidence.mockResolvedValueOnce({ eligible: false, reason: 'STRIPE_TEST_PAYMENT_NOT_ELIGIBLE' });
  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({ checked: 1, clawedBack: 1 });
  expect(mockStripeEvidence.subscriptionRewardEvidence).toHaveBeenCalledWith('supplier_1', 'inv_1');
});

test('temporary Stripe lookup failure never claws back an existing reward', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  const original = reward({ type: 'SUBSCRIPTION_BONUS', amount: 100 });
  mockCollections.partner_credit_transactions.push(original);
  mockStripeEvidence.subscriptionRewardEvidence.mockResolvedValueOnce({ eligible: false, reason: 'STRIPE_PAYMENT_EVIDENCE_UNAVAILABLE' });
  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({ checked: 1, clawedBack: 0 });
  expect(original.reversedAt).toBeUndefined();
});

test('does not revalidate rewards outside configured window', async () => {
  mockCollections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  mockCollections.partner_credit_transactions.push(reward({ createdAt: new Date(Date.now() - 31 * 86400000).toISOString() }));
  await expect(service.revalidatePartnerRewards('partner_1')).resolves.toEqual({ checked: 0, clawedBack: 0 });
  expect(mockBaseIntegrity.methodRewardEvidence).not.toHaveBeenCalled();
});
