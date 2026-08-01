'use strict';

const collections = {
  users: [],
  suppliers: [],
  packages: [],
  reviews: [],
  invoices: [],
  subscriptions: [],
  partners: [],
  partner_referrals: [],
  partner_credit_transactions: [],
  partner_abuse_events: [],
};

function matches(item, query) {
  return Object.entries(query || {}).every(([key, value]) => item[key] === value);
}

const mockDb = {
  read: jest.fn(async collection => collections[collection] || []),
  find: jest.fn(async (collection, query) =>
    (collections[collection] || []).filter(item => matches(item, query))
  ),
  findOne: jest.fn(
    async (collection, query) =>
      (collections[collection] || []).find(item => matches(item, query)) || null
  ),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerRewardIntegrityService', () => ({
  getConfig: jest.fn(() => ({ reviewMinAgeHours: 24 })),
  _test: {
    hoursBetween: (earlier, later = new Date().toISOString()) => {
      const start = Date.parse(earlier);
      const end = Date.parse(later);
      return Number.isFinite(start) && Number.isFinite(end) && end >= start
        ? (end - start) / 3600000
        : null;
    },
  },
}));

const service = require('../../services/partnerRewardIntegrityAdvancedService');

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

beforeEach(() => {
  Object.values(collections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('PARTNER_REWARD_')) delete process.env[key];
  }
});

test('blocks a near-duplicate package copied by another supplier', async () => {
  collections.suppliers.push(
    { id: 'sup_a', ownerUserId: 'usr_a', approved: true },
    { id: 'sup_b', ownerUserId: 'usr_b', approved: true }
  );
  collections.packages.push(
    {
      id: 'pkg_a',
      supplierId: 'sup_a',
      approved: true,
      title: 'Luxury Wedding Photography',
      description:
        'Full day wedding photography with planning, edited digital images and an online gallery.',
      price: '£900',
    },
    {
      id: 'pkg_b',
      supplierId: 'sup_b',
      approved: true,
      title: 'Luxury Wedding Photography',
      description:
        'Full day wedding photography including planning, edited digital images and an online gallery.',
      price: '£900',
    }
  );
  await expect(service.packageCopyEvidence('usr_a', 'pkg_a')).resolves.toMatchObject({
    eligible: false,
    reason: 'NEAR_DUPLICATE_PACKAGE_CONTENT',
  });
});

test('blocks a reviewer that also owns a supplier profile', async () => {
  collections.suppliers.push(
    { id: 'sup_target', ownerUserId: 'supplier_1', approved: true },
    { id: 'sup_reviewer', ownerUserId: 'customer_1', approved: true }
  );
  collections.reviews.push({
    id: 'rev_1',
    supplierId: 'sup_target',
    userId: 'customer_1',
    approved: true,
    createdAt: isoHoursAgo(72),
    approvedAt: isoHoursAgo(48),
  });
  await expect(
    service.reviewNetworkEvidence('supplier_1', 'partner_user', 'rev_1')
  ).resolves.toMatchObject({ eligible: false, reason: 'REVIEWER_OWNS_SUPPLIER_PROFILE' });
});

test('detects a review ring sharing the same network and browser signature', async () => {
  collections.suppliers.push({ id: 'sup_target', ownerUserId: 'supplier_1', approved: true });
  const distinctComments = [
    'The supplier communicated clearly, arrived early and delivered the finished gallery promptly.',
    'Our guests enjoyed the relaxed service and the team handled every venue change professionally.',
    'Booking was straightforward, pricing was transparent and the final photographs exceeded expectations.',
  ];
  for (let index = 1; index <= 3; index += 1) {
    collections.reviews.push({
      id: `rev_${index}`,
      supplierId: 'sup_target',
      userId: `customer_${index}`,
      approved: true,
      createdAt: isoHoursAgo(48 + index),
      approvedAt: isoHoursAgo(40),
      ipAddress: 'same-ip-hash',
      userAgent: 'Mozilla/5.0 Same Browser',
      title: `Review ${index}`,
      comment: distinctComments[index - 1],
    });
  }
  await expect(
    service.reviewNetworkEvidence('supplier_1', 'partner_user', 'rev_1')
  ).resolves.toMatchObject({
    eligible: false,
    reason: 'REVIEW_RING_SHARED_DEVICE_NETWORK',
  });
});

test('blocks test-mode subscriptions and reused Stripe customers', async () => {
  collections.subscriptions.push(
    {
      id: 'sub_1',
      userId: 'supplier_1',
      plan: 'pro',
      status: 'active',
      stripeCustomerId: 'cus_shared',
      stripeSubscriptionId: 'sub_stripe_1',
    },
    {
      id: 'sub_2',
      userId: 'supplier_2',
      plan: 'pro',
      status: 'active',
      stripeCustomerId: 'cus_shared',
      stripeSubscriptionId: 'sub_stripe_2',
    }
  );
  collections.invoices.push({
    id: 'inv_1',
    userId: 'supplier_1',
    subscriptionId: 'sub_1',
    status: 'paid',
    paidAt: isoHoursAgo(48),
    livemode: false,
    stripeCustomerId: 'cus_shared',
    stripeSubscriptionId: 'sub_stripe_1',
  });
  await expect(service.subscriptionPaymentEvidence('supplier_1', 'inv_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'STRIPE_TEST_PAYMENT_NOT_ELIGIBLE',
  });

  collections.invoices[0].livemode = true;
  await expect(service.subscriptionPaymentEvidence('supplier_1', 'inv_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'STRIPE_CUSTOMER_REUSED_ACROSS_SUPPLIERS',
  });
});

test('holds a subscription reward until the settlement window has elapsed', async () => {
  collections.subscriptions.push({
    id: 'sub_1',
    userId: 'supplier_1',
    plan: 'pro',
    status: 'active',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_stripe_1',
  });
  collections.invoices.push({
    id: 'inv_1',
    userId: 'supplier_1',
    subscriptionId: 'sub_1',
    status: 'paid',
    paidAt: isoHoursAgo(2),
    livemode: true,
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_stripe_1',
  });
  await expect(service.subscriptionPaymentEvidence('supplier_1', 'inv_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'SUBSCRIPTION_SETTLEMENT_WINDOW_NOT_MET',
  });
});

test('detects a reciprocal or multi-hop referral loop', async () => {
  collections.partners.push(
    { id: 'partner_a', userId: 'user_a' },
    { id: 'partner_b', userId: 'user_b' },
    { id: 'partner_c', userId: 'user_c' }
  );
  collections.partner_referrals.push(
    { partnerId: 'partner_b', supplierUserId: 'user_c' },
    { partnerId: 'partner_c', supplierUserId: 'user_a' }
  );
  await expect(service.referralLoopEvidence('partner_a', 'user_b')).resolves.toMatchObject({
    eligible: false,
    reason: 'REFERRAL_LOOP_DETECTED',
  });
});

test('blocks explicitly incentivised campaign metadata', async () => {
  collections.partner_referrals.push({
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    campaign: 'summer paid-signup push',
  });
  await expect(service.campaignPolicyEvidence('supplier_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'PROHIBITED_INCENTIVISED_CAMPAIGN',
  });
});

test('caps total reward exposure per referred supplier', async () => {
  collections.partners.push({
    id: 'partner_1',
    userId: 'partner_user',
    createdAt: isoHoursAgo(1000),
  });
  collections.partner_credit_transactions.push({
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    type: 'SUBSCRIPTION_BONUS',
    amount: 100,
    createdAt: isoHoursAgo(100),
  });
  await expect(
    service.exposureDecision({ partnerId: 'partner_1', supplierUserId: 'supplier_1', amount: 100 })
  ).resolves.toMatchObject({ eligible: false, reason: 'PER_SUPPLIER_REWARD_CAP_REACHED' });
});

test('applies lower early-life exposure limits to new partners', async () => {
  process.env.PARTNER_REWARD_NEW_PARTNER_POINTS_CAP = '130';
  collections.partners.push({
    id: 'partner_1',
    userId: 'partner_user',
    createdAt: isoHoursAgo(24),
  });
  collections.partner_credit_transactions.push({
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    type: 'SUBSCRIPTION_BONUS',
    amount: 100,
    createdAt: isoHoursAgo(1),
  });
  await expect(
    service.exposureDecision({ partnerId: 'partner_1', supplierUserId: 'supplier_2', amount: 100 })
  ).resolves.toMatchObject({ eligible: false, reason: 'NEW_PARTNER_REWARD_CAP_REACHED' });
});

test('extends reward maturity when registration risk still requires review', async () => {
  collections.partners.push({ id: 'partner_1', userId: 'partner_user' });
  collections.users.push(
    { id: 'partner_user', registrationRiskLevel: 'low' },
    { id: 'supplier_1', registrationRiskLevel: 'review' }
  );
  await expect(
    service.maturityExtensionDays({ partnerId: 'partner_1', supplierUserId: 'supplier_1' })
  ).resolves.toBe(30);
});

test('normalises common company suffixes before fuzzy duplicate comparison', async () => {
  collections.users.push({ id: 'supplier_a' }, { id: 'supplier_b' });
  collections.suppliers.push(
    {
      id: 'sup_a',
      ownerUserId: 'supplier_a',
      approved: true,
      businessName: 'Example Events Ltd',
      postcode: 'CF1 1AA',
    },
    {
      id: 'sup_b',
      ownerUserId: 'supplier_b',
      approved: true,
      businessName: 'Example Events Limited',
      postcode: 'CF1 1AA',
    }
  );
  await expect(service.fuzzyDuplicateBusinessEvidence('supplier_a')).resolves.toMatchObject({
    eligible: false,
    reason: 'FUZZY_DUPLICATE_SUPPLIER_BUSINESS',
  });
});
