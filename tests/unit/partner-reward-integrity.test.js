'use strict';

const collections = {
  users: [],
  suppliers: [],
  packages: [],
  reviews: [],
  threads: [],
  messages: [],
  invoices: [],
  subscriptions: [],
  partner_credit_transactions: [],
  partner_referrals: [],
  partner_reward_integrity_events: [],
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
  insertOne: jest.fn(async (collection, record) => {
    collections[collection].push(record);
    return record;
  }),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (collections[collection] || []).find(candidate => matches(candidate, query));
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  }),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const service = require('../../services/partnerRewardIntegrityService');

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

beforeEach(() => {
  Object.values(collections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  delete process.env.PARTNER_REWARD_SIGNUP_MIN_AGE_HOURS;
  delete process.env.PARTNER_REWARD_PACKAGE_MIN_LIVE_HOURS;
  delete process.env.PARTNER_REWARD_REVIEW_MIN_AGE_HOURS;
  delete process.env.PARTNER_REWARD_REVIEWER_MIN_ACCOUNT_HOURS;
  delete process.env.PARTNER_REWARD_DAILY_POINTS_CAP;
  delete process.env.PARTNER_REWARD_WEEKLY_POINTS_CAP;
  delete process.env.PARTNER_REWARD_MONTHLY_POINTS_CAP;
});

test('requires a meaningful approved package that has remained live for the configured period', () => {
  const tooNew = service.packageQuality({
    id: 'pkg_1',
    approved: true,
    paused: false,
    title: 'Wedding photography',
    description: 'A complete wedding photography package with planning and edited digital images.',
    price: '£750',
    primaryCategoryKey: 'photography',
    eventTypes: ['wedding'],
    createdAt: isoHoursAgo(2),
  });
  expect(tooNew).toMatchObject({
    eligible: false,
    reason: 'PACKAGE_MIN_LIVE_PERIOD_NOT_MET',
  });

  const placeholder = service.packageQuality({
    id: 'pkg_2',
    approved: true,
    title: 'Test',
    description: 'A complete description that is otherwise long enough for the package rule.',
    price: '£500',
    primaryCategoryKey: 'photography',
    eventTypes: ['wedding'],
    createdAt: isoHoursAgo(48),
  });
  expect(placeholder.reason).toBe('PACKAGE_TITLE_NOT_MEANINGFUL');

  const valid = service.packageQuality({
    id: 'pkg_3',
    approved: true,
    paused: false,
    title: 'Wedding photography',
    description: 'A complete wedding photography package with planning and edited digital images.',
    price: 'From £750',
    primaryCategoryKey: 'photography',
    eventTypes: ['wedding'],
    createdAt: isoHoursAgo(48),
  });
  expect(valid).toMatchObject({ eligible: true, packageId: 'pkg_3' });
});

test('detects a duplicate supplier business using strong registered identity evidence', async () => {
  collections.users.push(
    { id: 'supplier_a', role: 'supplier' },
    { id: 'supplier_b', role: 'supplier' }
  );
  collections.suppliers.push(
    {
      id: 'sup_a',
      ownerUserId: 'supplier_a',
      approved: true,
      companyNumber: '12345678',
      businessName: 'Example Events Ltd',
    },
    {
      id: 'sup_b',
      ownerUserId: 'supplier_b',
      approved: true,
      companyNumber: '12345678',
      businessName: 'Example Events Limited',
    }
  );

  await expect(service.duplicateSupplierBusinessEvidence('supplier_a')).resolves.toMatchObject({
    duplicate: true,
    matchType: 'COMPANY_NUMBER',
    otherSupplierUserId: 'supplier_b',
  });
});

test('requires review reward evidence to include a mature verified reviewer and two-way interaction', async () => {
  collections.users.push(
    { id: 'supplier_1', role: 'supplier', verified: true, createdAt: isoHoursAgo(500) },
    { id: 'customer_1', role: 'customer', verified: true, createdAt: isoHoursAgo(200) }
  );
  collections.suppliers.push({
    id: 'sup_1',
    ownerUserId: 'supplier_1',
    approved: true,
  });
  collections.reviews.push({
    id: 'rev_1',
    supplierId: 'sup_1',
    userId: 'customer_1',
    approved: true,
    flagged: false,
    verified: true,
    emailVerified: true,
    title: 'Excellent service',
    comment:
      'The supplier communicated clearly and delivered exactly what we agreed for our event.',
    createdAt: isoHoursAgo(48),
  });
  collections.threads.push({ id: 'thd_1', customerId: 'customer_1', supplierId: 'sup_1' });
  collections.messages.push(
    { id: 'msg_1', threadId: 'thd_1', senderId: 'customer_1', isDraft: false },
    { id: 'msg_2', threadId: 'thd_1', senderId: 'supplier_1', isDraft: false }
  );

  await expect(service.reviewRewardEvidence('supplier_1', 'partner_user')).resolves.toMatchObject({
    eligible: true,
    reviewId: 'rev_1',
  });

  collections.messages.splice(1, 1);
  await expect(service.reviewRewardEvidence('supplier_1', 'partner_user')).resolves.toMatchObject({
    eligible: false,
    reason: 'INDEPENDENT_CUSTOMER_INTERACTION_MISSING',
  });
});

test('rejects copied review content from a different reviewer', async () => {
  collections.users.push(
    { id: 'supplier_1', role: 'supplier', verified: true, createdAt: isoHoursAgo(500) },
    { id: 'customer_1', role: 'customer', verified: true, createdAt: isoHoursAgo(200) },
    { id: 'customer_2', role: 'customer', verified: true, createdAt: isoHoursAgo(200) }
  );
  collections.suppliers.push({ id: 'sup_1', ownerUserId: 'supplier_1', approved: true });
  const comment =
    'The supplier communicated clearly and delivered exactly what we agreed for our event.';
  collections.reviews.push(
    {
      id: 'rev_1',
      supplierId: 'sup_1',
      userId: 'customer_1',
      approved: true,
      flagged: false,
      verified: true,
      emailVerified: true,
      title: 'Excellent service',
      comment,
      createdAt: isoHoursAgo(48),
    },
    {
      id: 'rev_2',
      supplierId: 'sup_elsewhere',
      userId: 'customer_2',
      approved: true,
      title: 'Excellent service',
      comment,
      createdAt: isoHoursAgo(50),
    }
  );
  collections.threads.push({ id: 'thd_1', customerId: 'customer_1', supplierId: 'sup_1' });
  collections.messages.push(
    { threadId: 'thd_1', senderId: 'customer_1' },
    { threadId: 'thd_1', senderId: 'supplier_1' }
  );

  await expect(service.reviewRewardEvidence('supplier_1', 'partner_user')).resolves.toMatchObject({
    eligible: false,
    reason: 'DUPLICATE_REVIEW_CONTENT',
  });
});

test('requires a persisted paid non-free subscription invoice', async () => {
  collections.subscriptions.push({
    id: 'sub_1',
    userId: 'supplier_1',
    plan: 'pro',
    status: 'active',
  });
  collections.invoices.push({
    id: 'inv_1',
    userId: 'supplier_1',
    subscriptionId: 'sub_1',
    stripeInvoiceId: 'in_123',
    amount: 29,
    currency: 'gbp',
    status: 'paid',
    paidAt: isoHoursAgo(2),
  });

  await expect(service.subscriptionRewardEvidence('supplier_1')).resolves.toMatchObject({
    eligible: true,
    invoiceId: 'inv_1',
    amount: 29,
  });

  collections.invoices[0].status = 'open';
  await expect(service.subscriptionRewardEvidence('supplier_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'QUALIFYING_PAID_SUBSCRIPTION_INVOICE_MISSING',
  });
});

test('rolling partner point caps withhold only the reward that would exceed the configured limit', async () => {
  process.env.PARTNER_REWARD_DAILY_POINTS_CAP = '130';
  process.env.PARTNER_REWARD_WEEKLY_POINTS_CAP = '1000';
  process.env.PARTNER_REWARD_MONTHLY_POINTS_CAP = '2000';
  collections.partner_credit_transactions.push({
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    type: 'SUBSCRIPTION_BONUS',
    amount: 100,
    createdAt: isoHoursAgo(1),
  });

  await expect(
    service.canAwardCredit({
      partnerId: 'partner_1',
      supplierUserId: 'supplier_2',
      type: 'FIRST_REVIEW_BONUS',
      amount: 15,
    })
  ).resolves.toMatchObject({ eligible: true });

  await expect(
    service.canAwardCredit({
      partnerId: 'partner_1',
      supplierUserId: 'supplier_2',
      type: 'SUBSCRIPTION_BONUS',
      amount: 100,
    })
  ).resolves.toMatchObject({ eligible: false, reason: 'DAILY_REWARD_CAP_REACHED' });
});

test('integrity event persistence is deduplicated and increments occurrence count', async () => {
  await service.recordIntegrityEvent({
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    rewardType: 'PACKAGE_BONUS',
    reason: 'PACKAGE_MIN_LIVE_PERIOD_NOT_MET',
  });
  await service.recordIntegrityEvent({
    partnerId: 'partner_1',
    supplierUserId: 'supplier_1',
    rewardType: 'PACKAGE_BONUS',
    reason: 'PACKAGE_MIN_LIVE_PERIOD_NOT_MET',
  });

  expect(collections.partner_reward_integrity_events).toHaveLength(1);
  expect(collections.partner_reward_integrity_events[0].occurrenceCount).toBe(2);
});
