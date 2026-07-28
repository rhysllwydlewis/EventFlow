'use strict';

const mockCollections = { invoices: [], subscriptions: [] };
function mockMatches(item, query) { return Object.entries(query || {}).every(([key, value]) => item[key] === value); }
const mockDb = {
  findOne: jest.fn(async (collection, query) => (mockCollections[collection] || []).find(item => mockMatches(item, query)) || null),
  read: jest.fn(async collection => mockCollections[collection] || []),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (mockCollections[collection] || []).find(candidate => mockMatches(candidate, query));
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  }),
};
const mockPaymentService = { getPaymentIntent: jest.fn() };
const mockBaseIntegrity = {
  getConfig: jest.fn(() => ({ minSubscriptionAmount: 1 })),
  _test: {
    hoursBetween: earlier => {
      const start = Date.parse(earlier);
      return Number.isFinite(start) ? (Date.now() - start) / 3600000 : null;
    },
  },
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/paymentService', () => mockPaymentService);
jest.mock('../../services/partnerRewardIntegrityService', () => mockBaseIntegrity);
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const service = require('../../services/partnerRewardStripeEvidenceService');

function seed({ supplierUserId = 'supplier_1', customerId = 'cus_1' } = {}) {
  mockCollections.subscriptions.push({
    id: 'sub_local_1',
    userId: supplierUserId,
    plan: 'pro',
    status: 'active',
    stripeCustomerId: customerId,
  });
  mockCollections.invoices.push({
    id: 'inv_1',
    userId: supplierUserId,
    subscriptionId: 'sub_local_1',
    stripeInvoiceId: 'in_1',
    stripePaymentIntentId: 'pi_1',
    status: 'paid',
    paidAt: new Date(Date.now() - 48 * 3600000).toISOString(),
    currency: 'gbp',
  });
}

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  delete process.env.PARTNER_REWARD_PAYMENT_INSTRUMENT_SUPPLIER_CAP;
  delete process.env.PARTNER_REWARD_SUBSCRIPTION_SETTLEMENT_HOURS;
  process.env.PARTNER_ABUSE_HASH_SECRET = 'test-secret-for-payment-evidence';
  mockBaseIntegrity.getConfig.mockReturnValue({ minSubscriptionAmount: 1 });
});

afterAll(() => { delete process.env.PARTNER_ABUSE_HASH_SECRET; });

test('requires a live succeeded PaymentIntent and stores only hashed instrument evidence', async () => {
  seed();
  mockPaymentService.getPaymentIntent.mockResolvedValue({
    id: 'pi_1',
    status: 'succeeded',
    livemode: true,
    customer: 'cus_1',
    amount_received: 2999,
    currency: 'gbp',
    payment_method: { id: 'pm_1', card: { fingerprint: 'raw-card-fingerprint' } },
  });

  const result = await service.subscriptionRewardEvidence('supplier_1', 'inv_1');

  expect(result).toMatchObject({ eligible: true, invoiceId: 'inv_1' });
  const stored = mockCollections.invoices[0].partnerRewardPaymentEvidence;
  expect(stored).toMatchObject({
    paymentIntentStatus: 'succeeded',
    livemode: true,
    stripeCustomerId: 'cus_1',
    amountReceived: 29.99,
    paymentInstrumentKind: 'stripe-fingerprint',
    paymentInstrumentConfidence: 'strong',
    paymentInstrumentHash: expect.any(String),
  });
  expect(JSON.stringify(stored)).not.toContain('raw-card-fingerprint');
  expect(JSON.stringify(stored)).not.toContain('pm_1');
});

test('rejects Stripe test-mode payments', async () => {
  seed();
  mockPaymentService.getPaymentIntent.mockResolvedValue({
    id: 'pi_1', status: 'succeeded', livemode: false, customer: 'cus_1', amount_received: 2999,
  });
  await expect(service.subscriptionRewardEvidence('supplier_1', 'inv_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'STRIPE_TEST_PAYMENT_NOT_ELIGIBLE',
  });
});

test('rejects a PaymentIntent whose Stripe customer does not match the supplier subscription', async () => {
  seed();
  mockPaymentService.getPaymentIntent.mockResolvedValue({
    id: 'pi_1', status: 'succeeded', livemode: true, customer: 'cus_other', amount_received: 2999,
  });
  await expect(service.subscriptionRewardEvidence('supplier_1', 'inv_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'STRIPE_CUSTOMER_OWNERSHIP_MISMATCH',
  });
});

test('rejects zero or below-minimum amount actually received', async () => {
  seed();
  mockPaymentService.getPaymentIntent.mockResolvedValue({
    id: 'pi_1', status: 'succeeded', livemode: true, customer: 'cus_1', amount_received: 0,
  });
  await expect(service.subscriptionRewardEvidence('supplier_1', 'inv_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'SUBSCRIPTION_PAYMENT_AMOUNT_TOO_LOW',
  });
});

test('defers a reward when Stripe evidence cannot be retrieved and no stored proof exists', async () => {
  seed();
  mockPaymentService.getPaymentIntent.mockRejectedValue(new Error('Stripe temporarily unavailable'));
  await expect(service.subscriptionRewardEvidence('supplier_1', 'inv_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'STRIPE_PAYMENT_EVIDENCE_UNAVAILABLE',
  });
});

test('uses previously stored succeeded evidence during a temporary Stripe outage', async () => {
  seed();
  mockCollections.invoices[0].partnerRewardPaymentEvidence = {
    paymentIntentId: 'pi_1',
    paymentIntentStatus: 'succeeded',
    livemode: true,
    stripeCustomerId: 'cus_1',
    amountReceived: 29.99,
    paymentInstrumentHash: 'stored_hash',
    paymentInstrumentConfidence: 'strong',
    capturedAt: new Date().toISOString(),
  };
  mockPaymentService.getPaymentIntent.mockRejectedValue(new Error('Stripe temporarily unavailable'));
  await expect(service.subscriptionRewardEvidence('supplier_1', 'inv_1')).resolves.toMatchObject({
    eligible: true,
    paymentEvidence: expect.objectContaining({ paymentInstrumentHash: 'stored_hash' }),
  });
});

test('blocks excessive reuse of the same hashed payment instrument across supplier users', async () => {
  process.env.PARTNER_REWARD_PAYMENT_INSTRUMENT_SUPPLIER_CAP = '2';
  seed();
  const sharedHash = service._test.hashPaymentReference('stripe-fingerprint', 'same-card');
  mockCollections.invoices.push(
    {
      id: 'inv_2', userId: 'supplier_2', status: 'paid',
      partnerRewardPaymentEvidence: { paymentInstrumentHash: sharedHash },
    },
    {
      id: 'inv_3', userId: 'supplier_3', status: 'paid',
      partnerRewardPaymentEvidence: { paymentInstrumentHash: sharedHash },
    }
  );
  mockPaymentService.getPaymentIntent.mockResolvedValue({
    id: 'pi_1', status: 'succeeded', livemode: true, customer: 'cus_1', amount_received: 2999,
    payment_method: { id: 'pm_1', card: { fingerprint: 'same-card' } },
  });
  await expect(service.subscriptionRewardEvidence('supplier_1', 'inv_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'PAYMENT_INSTRUMENT_REUSED_ACROSS_SUPPLIERS',
  });
});

test('extracts a strong fingerprint from expanded charge details when available', () => {
  const result = service._test.paymentInstrumentEvidence({
    latest_charge: { payment_method_details: { card: { fingerprint: 'charge-fingerprint' } } },
  });
  expect(result).toMatchObject({ kind: 'stripe-fingerprint', confidence: 'strong', hash: expect.any(String) });
});
