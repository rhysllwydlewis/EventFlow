'use strict';

const collections = {
  suppliers: [],
  packages: [],
  reviews: [],
  invoices: [],
};

function matches(item, query) {
  return Object.entries(query || {}).every(([key, value]) => item[key] === value);
}

const mockDb = {
  read: jest.fn(async collection => collections[collection] || []),
  find: jest.fn(async (collection, query) =>
    (collections[collection] || []).filter(item => matches(item, query))
  ),
};

const mockBase = {
  getConfig: jest.fn(() => ({ minSubscriptionAmount: 1 })),
  duplicateSupplierBusinessEvidence: jest.fn(async () => ({ duplicate: false, strongKeyCount: 0 })),
  signupRewardEvidence: jest.fn(async () => ({ eligible: true })),
  packageQuality: jest.fn(pkg =>
    pkg.baseEligible === false
      ? { eligible: false, reason: pkg.reason || 'PACKAGE_INCOMPLETE' }
      : { eligible: true, price: Number(pkg.price || 10) }
  ),
};

const mockAdvanced = {
  packageCopyEvidence: jest.fn(async (_supplierUserId, packageId) =>
    packageId === 'pkg_bad'
      ? { eligible: false, reason: 'NEAR_DUPLICATE_PACKAGE_CONTENT' }
      : { eligible: true }
  ),
};

const mockStripe = {
  subscriptionRewardEvidence: jest.fn(async (_supplierUserId, invoiceId) =>
    invoiceId === 'inv_bad'
      ? { eligible: false, reason: 'STRIPE_PAYMENT_REFUNDED' }
      : { eligible: true, invoiceId, paymentEvidence: { paymentIntentId: `pi_${invoiceId}` } }
  ),
};

const mockQualification = {
  SNAPSHOT_VERSION: 1,
  _test: {
    revalidateExactReview: jest.fn(async transaction => {
      const reviewId = transaction.qualificationEvidence.reviewId;
      if (reviewId === 'rev_bad') {
        return { eligible: false, reason: 'DUPLICATE_REVIEW_CONTENT' };
      }
      if (reviewId === 'rev_soft') {
        return {
          eligible: false,
          reason: 'REVIEW_RING_SHARED_IP',
          evidence: { reviewerCount: 5 },
        };
      }
      return { eligible: true };
    }),
  },
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerRewardIntegrityService', () => mockBase);
jest.mock('../../services/partnerRewardIntegrityAdvancedService', () => mockAdvanced);
jest.mock('../../services/partnerRewardStripeEvidenceService', () => mockStripe);
jest.mock('../../services/partnerRewardQualificationEvidenceService', () => mockQualification);

const service = require('../../services/partnerRewardCandidateSelectionService');

beforeEach(() => {
  Object.values(collections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockBase.duplicateSupplierBusinessEvidence.mockResolvedValue({
    duplicate: false,
    strongKeyCount: 0,
  });
  mockBase.signupRewardEvidence.mockResolvedValue({ eligible: true });
  mockBase.packageQuality.mockImplementation(pkg =>
    pkg.baseEligible === false
      ? { eligible: false, reason: pkg.reason || 'PACKAGE_INCOMPLETE' }
      : { eligible: true, price: Number(pkg.price || 10) }
  );
  mockAdvanced.packageCopyEvidence.mockImplementation(async (_supplierUserId, packageId) =>
    packageId === 'pkg_bad'
      ? { eligible: false, reason: 'NEAR_DUPLICATE_PACKAGE_CONTENT' }
      : { eligible: true }
  );
  mockStripe.subscriptionRewardEvidence.mockImplementation(async (_supplierUserId, invoiceId) =>
    invoiceId === 'inv_bad'
      ? { eligible: false, reason: 'STRIPE_PAYMENT_REFUNDED' }
      : { eligible: true, invoiceId, paymentEvidence: { paymentIntentId: `pi_${invoiceId}` } }
  );
});

test('chooses a clean package when an earlier package is copied or otherwise invalid', async () => {
  collections.suppliers.push({ id: 'sup_1', ownerUserId: 'supplier_1', approved: true });
  collections.packages.push(
    { id: 'pkg_bad', supplierId: 'sup_1', price: 10 },
    { id: 'pkg_good', supplierId: 'sup_1', price: 25 }
  );

  await expect(service._test.selectPackageEvidence('supplier_1')).resolves.toMatchObject({
    eligible: true,
    packageId: 'pkg_good',
    price: 25,
  });
});

test('chooses a clean review when an earlier review has invalid content', async () => {
  collections.suppliers.push({ id: 'sup_1', ownerUserId: 'supplier_1', approved: true });
  collections.reviews.push(
    { id: 'rev_bad', supplierId: 'sup_1', userId: 'customer_bad' },
    { id: 'rev_good', supplierId: 'sup_1', userId: 'customer_good' }
  );

  await expect(
    service._test.selectReviewEvidence('supplier_1', 'partner_user')
  ).resolves.toMatchObject({
    eligible: true,
    reviewId: 'rev_good',
    reviewerUserId: 'customer_good',
  });
});

test('uses a network-only review signal only when there is no fully clean candidate', async () => {
  collections.suppliers.push({ id: 'sup_1', ownerUserId: 'supplier_1', approved: true });
  collections.reviews.push({ id: 'rev_soft', supplierId: 'sup_1', userId: 'customer_1' });

  await expect(
    service._test.selectReviewEvidence('supplier_1', 'partner_user')
  ).resolves.toMatchObject({
    eligible: true,
    reviewId: 'rev_soft',
    softReason: 'REVIEW_RING_SHARED_IP',
  });
});

test('chooses a valid settled subscription invoice if an earlier payment was refunded', async () => {
  collections.invoices.push(
    {
      id: 'inv_bad',
      userId: 'supplier_1',
      status: 'paid',
      amount: 30,
      stripeInvoiceId: 'in_bad',
      paidAt: '2026-07-01T00:00:00.000Z',
    },
    {
      id: 'inv_good',
      userId: 'supplier_1',
      status: 'paid',
      amount: 30,
      stripeInvoiceId: 'in_good',
      paidAt: '2026-07-02T00:00:00.000Z',
    }
  );

  await expect(service._test.selectSubscriptionEvidence('supplier_1')).resolves.toMatchObject({
    eligible: true,
    invoiceId: 'inv_good',
    stripeDecision: expect.objectContaining({ eligible: true, invoiceId: 'inv_good' }),
  });
});

test('temporary Stripe evidence failure defers only when no other valid invoice exists', async () => {
  collections.invoices.push({
    id: 'inv_temp',
    userId: 'supplier_1',
    status: 'paid',
    amount: 30,
    stripeInvoiceId: 'in_temp',
    paidAt: '2026-07-01T00:00:00.000Z',
  });
  mockStripe.subscriptionRewardEvidence.mockResolvedValueOnce({
    eligible: false,
    reason: 'STRIPE_PAYMENT_EVIDENCE_UNAVAILABLE',
  });

  await expect(service._test.selectSubscriptionEvidence('supplier_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'STRIPE_PAYMENT_EVIDENCE_UNAVAILABLE',
  });
});

test('duplicate business identity blocks all milestone candidates before selection', async () => {
  mockBase.duplicateSupplierBusinessEvidence.mockResolvedValueOnce({
    duplicate: true,
    reason: 'companyNumber',
    otherSupplierUserId: 'supplier_2',
  });

  await expect(
    service.selectRewardEvidence({
      supplierUserId: 'supplier_1',
      partnerUserId: 'partner_user',
      methodName: 'awardPackageBonus',
    })
  ).resolves.toMatchObject({
    eligible: false,
    reason: 'DUPLICATE_SUPPLIER_BUSINESS_IDENTITY',
  });
  expect(mockBase.packageQuality).not.toHaveBeenCalled();
});
