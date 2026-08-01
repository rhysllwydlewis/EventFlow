'use strict';

const collections = {
  packages: [],
  reviews: [],
  users: [],
  suppliers: [],
  threads: [],
  messages: [],
  partner_credit_transactions: [],
};

function matches(item, query) {
  return Object.entries(query || {}).every(([key, value]) => item[key] === value);
}

const mockDb = {
  findOne: jest.fn(
    async (collection, query) =>
      (collections[collection] || []).find(item => matches(item, query)) || null
  ),
  find: jest.fn(async (collection, query) =>
    (collections[collection] || []).filter(item => matches(item, query))
  ),
  read: jest.fn(async collection => collections[collection] || []),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (collections[collection] || []).find(candidate => matches(candidate, query));
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  }),
};

const mockBase = {
  getConfig: jest.fn(() => ({ reviewerMinAccountHours: 24, reviewMinAgeHours: 24 })),
  packageQuality: jest.fn(pkg =>
    pkg.approved === true
      ? { eligible: true, price: Number(pkg.price || 10) }
      : { eligible: false, reason: 'PACKAGE_NOT_APPROVED' }
  ),
  _test: {
    reviewTextKey: review =>
      String(`${review.title || ''} ${review.comment || ''}`)
        .trim()
        .toLowerCase(),
    hoursBetween: (earlier, later = new Date().toISOString()) => {
      const start = Date.parse(earlier);
      const end = Date.parse(later);
      return Number.isFinite(start) && Number.isFinite(end) && end >= start
        ? (end - start) / 3600000
        : null;
    },
  },
};

const mockAdvanced = {
  packageCopyEvidence: jest.fn(async () => ({ eligible: true })),
  reviewNetworkEvidence: jest.fn(async () => ({ eligible: true })),
};
const mockStripe = {
  subscriptionRewardEvidence: jest.fn(async (_supplierUserId, invoiceId) => ({
    eligible: true,
    invoiceId,
    paymentEvidence: { paymentIntentId: 'pi_1' },
  })),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerRewardIntegrityService', () => mockBase);
jest.mock('../../services/partnerRewardIntegrityAdvancedService', () => mockAdvanced);
jest.mock('../../services/partnerRewardStripeEvidenceService', () => mockStripe);

const service = require('../../services/partnerRewardQualificationEvidenceService');

beforeEach(() => {
  Object.values(collections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockBase.getConfig.mockReturnValue({ reviewerMinAccountHours: 24, reviewMinAgeHours: 24 });
  mockAdvanced.packageCopyEvidence.mockResolvedValue({ eligible: true });
  mockAdvanced.reviewNetworkEvidence.mockResolvedValue({ eligible: true });
  mockStripe.subscriptionRewardEvidence.mockImplementation(async (_supplierUserId, invoiceId) => ({
    eligible: true,
    invoiceId,
    paymentEvidence: { paymentIntentId: 'pi_1' },
  }));
});

test('builds a minimal non-sensitive snapshot tied to the evidence that earned the reward', () => {
  const snapshot = service.buildSnapshot({
    methodName: 'awardSubscriptionBonus',
    supplierDecision: { supplierId: 'sup_1' },
    baseEvidence: { invoiceId: 'inv_1' },
    stripeDecision: {
      invoiceId: 'inv_1',
      paymentEvidence: {
        paymentIntentId: 'pi_1',
        stripeChargeId: 'ch_1',
        paymentInstrumentHash: 'secret-hash',
      },
    },
  });
  expect(snapshot).toMatchObject({
    version: 1,
    methodName: 'awardSubscriptionBonus',
    supplierId: 'sup_1',
    invoiceId: 'inv_1',
    paymentIntentId: 'pi_1',
    stripeChargeId: 'ch_1',
  });
  expect(snapshot).not.toHaveProperty('paymentInstrumentHash');
});

test('fails closed if the qualification snapshot cannot be persisted', async () => {
  const reward = { id: 'ptx_1' };
  await expect(service.persistSnapshot(reward, { version: 1 })).rejects.toMatchObject({
    code: 'PARTNER_REWARD_EVIDENCE_WRITE_FAILED',
  });
});

test('revalidates the exact package that earned the reward rather than another package', async () => {
  collections.suppliers.push({ id: 'sup_1', ownerUserId: 'supplier_1' });
  collections.packages.push(
    { id: 'pkg_earned', supplierId: 'sup_1', approved: false, price: 10 },
    { id: 'pkg_other', supplierId: 'sup_1', approved: true, price: 10 }
  );
  const transaction = {
    supplierUserId: 'supplier_1',
    qualificationEvidence: { version: 1, packageId: 'pkg_earned' },
  };
  await expect(service._test.revalidateExactPackage(transaction)).resolves.toMatchObject({
    eligible: false,
    reason: 'PACKAGE_NOT_APPROVED',
  });
  expect(mockAdvanced.packageCopyEvidence).not.toHaveBeenCalledWith('supplier_1', 'pkg_other');
});

test('revalidates the exact review and requires two-way customer-supplier interaction', async () => {
  const now = Date.now();
  collections.suppliers.push({ id: 'sup_1', ownerUserId: 'supplier_1' });
  collections.users.push({
    id: 'customer_1',
    role: 'customer',
    verified: true,
    createdAt: new Date(now - 10 * 86400000).toISOString(),
  });
  collections.reviews.push({
    id: 'rev_earned',
    supplierId: 'sup_1',
    userId: 'customer_1',
    approved: true,
    flagged: false,
    verified: true,
    emailVerified: true,
    createdAt: new Date(now - 3 * 86400000).toISOString(),
    title: 'Genuine event review',
    comment: 'A detailed and unique customer review of the supplier.',
  });
  collections.threads.push({ id: 'thread_1', customerId: 'customer_1', supplierId: 'sup_1' });
  collections.messages.push(
    { id: 'msg_1', threadId: 'thread_1', senderId: 'customer_1', isDraft: false },
    { id: 'msg_2', threadId: 'thread_1', senderId: 'supplier_1', isDraft: false }
  );

  await expect(
    service._test.revalidateExactReview(
      {
        supplierUserId: 'supplier_1',
        qualificationEvidence: { version: 1, reviewId: 'rev_earned' },
      },
      'partner_user'
    )
  ).resolves.toEqual({ eligible: true });
  expect(mockAdvanced.reviewNetworkEvidence).toHaveBeenCalledWith(
    'supplier_1',
    'partner_user',
    'rev_earned'
  );
});

test('an exact review cannot be replaced by a later clean review after it is removed', async () => {
  collections.suppliers.push({ id: 'sup_1', ownerUserId: 'supplier_1' });
  collections.reviews.push({ id: 'rev_other', supplierId: 'sup_1', approved: true });
  await expect(
    service._test.revalidateExactReview(
      {
        supplierUserId: 'supplier_1',
        qualificationEvidence: { version: 1, reviewId: 'rev_missing' },
      },
      'partner_user'
    )
  ).resolves.toMatchObject({ eligible: false, reason: 'QUALIFYING_REVIEW_MISSING' });
});

test('subscription snapshot revalidation uses the exact invoice that earned the points', async () => {
  await service._test.revalidateExactSubscription({
    supplierUserId: 'supplier_1',
    qualificationEvidence: { version: 1, invoiceId: 'inv_earned' },
  });
  expect(mockStripe.subscriptionRewardEvidence).toHaveBeenCalledWith('supplier_1', 'inv_earned');
});

test('legacy rewards without a versioned snapshot are explicitly delegated to legacy revalidation', async () => {
  await expect(
    service.revalidateSnapshot(
      { type: 'PACKAGE_BONUS', supplierUserId: 'supplier_1' },
      'partner_user'
    )
  ).resolves.toBeNull();
});
