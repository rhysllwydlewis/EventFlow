'use strict';

const mockCollections = {
  partners: [],
  users: [],
  suppliers: [],
  packages: [],
  reviews: [],
  partner_referrals: [],
  partner_credit_transactions: [],
  partner_cashout_requests: [],
  partner_fraud_assessments: [],
};

function matches(item, query) {
  return Object.entries(query).every(([key, value]) => item[key] === value);
}

const mockDb = {
  read: jest.fn(async collection => mockCollections[collection] || []),
  find: jest.fn(async (collection, query) =>
    (mockCollections[collection] || []).filter(item => matches(item, query))
  ),
  findOne: jest.fn(
    async (collection, query) =>
      (mockCollections[collection] || []).find(item => matches(item, query)) || null
  ),
  insertOne: jest.fn(async (collection, record) => {
    mockCollections[collection].push(record);
    return record;
  }),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (mockCollections[collection] || []).find(candidate => matches(candidate, query));
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  }),
};

const mockPartnerService = {
  awardReferralSignupBonus: jest.fn(async supplierUserId => ({ supplierUserId })),
  awardPackageBonus: jest.fn(async supplierUserId => ({ supplierUserId })),
  awardFirstReviewBonus: jest.fn(async supplierUserId => ({ supplierUserId })),
  awardSubscriptionBonus: jest.fn(async supplierUserId => ({ supplierUserId })),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerService', () => mockPartnerService);
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const antiAbuse = require('../../services/partnerAntiAbuseService');

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

function addReward(supplierUserId, type = 'REFERRAL_SIGNUP_BONUS', amount = 5) {
  mockCollections.partner_credit_transactions.push({
    id: `ptx_${supplierUserId}_${type}`,
    partnerId: 'prt_1',
    supplierUserId,
    type,
    amount,
    createdAt: hoursAgo(48),
  });
}

function seedEligibleSupplier() {
  mockCollections.partners.push({
    id: 'prt_1',
    userId: 'usr_partner',
    status: 'active',
    createdAt: hoursAgo(24 * 90),
  });
  mockCollections.users.push(
    {
      id: 'usr_partner',
      role: 'partner',
      email: 'partner@agency.co.uk',
      company: 'Example Agency',
      verified: true,
      createdAt: hoursAgo(24 * 90),
    },
    {
      id: 'usr_supplier',
      role: 'supplier',
      email: 'supplier@venue.co.uk',
      company: 'Example Venue',
      verified: true,
      createdAt: hoursAgo(24 * 60),
    },
    {
      id: 'usr_customer',
      role: 'customer',
      email: 'customer@gmail.com',
      verified: true,
      createdAt: hoursAgo(120),
    }
  );
  mockCollections.suppliers.push({
    id: 'sup_1',
    ownerUserId: 'usr_supplier',
    approved: true,
  });
  mockCollections.partner_referrals.push({
    id: 'ref_1',
    partnerId: 'prt_1',
    supplierUserId: 'usr_supplier',
    supplierCreatedAt: hoursAgo(24 * 60),
    createdAt: hoursAgo(24 * 60),
  });
}

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockDb.insertOne.mockImplementation(async (collection, record) => {
    mockCollections[collection].push(record);
    return record;
  });
  mockDb.updateOne.mockImplementation(async (collection, query, update) => {
    const item = (mockCollections[collection] || []).find(candidate => matches(candidate, query));
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  });
});

test('recognises only complete approved active packages as reward evidence', async () => {
  seedEligibleSupplier();
  mockCollections.packages.push({
    id: 'pkg_incomplete',
    supplierId: 'sup_1',
    title: 'X',
    price: '',
    approved: true,
    paused: false,
  });

  await expect(antiAbuse.packageRewardEvidence('usr_supplier')).resolves.toMatchObject({
    eligible: false,
    reason: 'QUALIFYING_PACKAGE_MISSING',
  });

  mockCollections.packages.push({
    id: 'pkg_valid',
    supplierId: 'sup_1',
    title: 'Corporate event package',
    price: '£1,200',
    primaryCategoryKey: 'venues',
    eventTypes: ['corporate'],
    approved: true,
    paused: false,
  });

  await expect(antiAbuse.packageRewardEvidence('usr_supplier')).resolves.toEqual({
    eligible: true,
    qualifyingPackageId: 'pkg_valid',
  });
});

test('requires an established independent verified customer for review evidence', async () => {
  seedEligibleSupplier();
  mockCollections.reviews.push({
    id: 'rev_1',
    supplierId: 'sup_1',
    userId: 'usr_customer',
    approved: true,
    flagged: false,
    emailVerified: true,
    verified: true,
    createdAt: hoursAgo(60),
  });

  await expect(antiAbuse.reviewRewardEvidence('usr_supplier', 'usr_partner')).resolves.toEqual({
    eligible: true,
    qualifyingReviewId: 'rev_1',
  });

  mockCollections.users.find(user => user.id === 'usr_customer').createdAt = hoursAgo(61);
  mockCollections.reviews[0].createdAt = hoursAgo(60);
  await expect(
    antiAbuse.reviewRewardEvidence('usr_supplier', 'usr_partner')
  ).resolves.toMatchObject({
    eligible: false,
    reason: 'INDEPENDENT_VERIFIED_REVIEW_MISSING',
  });

  mockCollections.users.find(user => user.id === 'usr_customer').createdAt = null;
  await expect(
    antiAbuse.reviewRewardEvidence('usr_supplier', 'usr_partner')
  ).resolves.toMatchObject({
    eligible: false,
  });

  mockCollections.users.find(user => user.id === 'usr_customer').createdAt = hoursAgo(120);
  mockCollections.reviews[0].flagged = true;
  await expect(
    antiAbuse.reviewRewardEvidence('usr_supplier', 'usr_partner')
  ).resolves.toMatchObject({
    eligible: false,
  });
});

test('rejects a referral when the partner identity is missing or unverified', async () => {
  seedEligibleSupplier();
  mockCollections.users.find(user => user.id === 'usr_partner').verified = false;

  await expect(antiAbuse.supplierRewardEligibility('usr_supplier')).resolves.toMatchObject({
    eligible: false,
    reason: 'PARTNER_IDENTITY_INVALID',
  });

  mockCollections.users.splice(
    mockCollections.users.findIndex(user => user.id === 'usr_partner'),
    1
  );
  await expect(antiAbuse.supplierRewardEligibility('usr_supplier')).resolves.toMatchObject({
    eligible: false,
    reason: 'PARTNER_IDENTITY_INVALID',
  });
});

test('wraps reward methods and withholds ineligible activity', async () => {
  seedEligibleSupplier();
  antiAbuse.installRewardGuards(mockPartnerService);

  await expect(mockPartnerService.awardReferralSignupBonus('usr_supplier')).resolves.toEqual({
    supplierUserId: 'usr_supplier',
  });

  mockCollections.users.find(user => user.id === 'usr_supplier').verified = false;
  await expect(mockPartnerService.awardPackageBonus('usr_supplier')).resolves.toBeNull();
});

test('blocks cashouts with missing identity, no referrals and orphan reward records', async () => {
  mockCollections.partner_credit_transactions.push({
    id: 'ptx_orphan',
    partnerId: 'missing_partner',
    supplierUserId: 'usr_unknown',
    type: 'PACKAGE_BONUS',
    amount: 10,
    createdAt: new Date().toISOString(),
  });

  const result = await antiAbuse.assessCashout({
    partnerId: 'missing_partner',
    requestId: 'pcr_missing',
  });

  expect(result.blockApproval).toBe(true);
  expect(result.signals.map(signal => signal.code)).toEqual(
    expect.arrayContaining([
      'MISSING_PARTNER_IDENTITY',
      'NO_REFERRAL_RECORDS',
      'ORPHAN_REWARD_TRANSACTIONS',
    ])
  );
});

test('flags rapid partner cashouts and rapid non-signup milestones', async () => {
  seedEligibleSupplier();
  mockCollections.partners[0].createdAt = hoursAgo(2);
  mockCollections.partner_referrals[0].supplierCreatedAt = hoursAgo(1);
  mockCollections.packages.push({
    id: 'pkg_1',
    supplierId: 'sup_1',
    title: 'Wedding package',
    price: '£500',
    primaryCategoryKey: 'venues',
    eventTypes: ['wedding'],
    approved: true,
    paused: false,
  });
  mockCollections.partner_credit_transactions.push({
    id: 'ptx_package',
    partnerId: 'prt_1',
    supplierUserId: 'usr_supplier',
    type: 'PACKAGE_BONUS',
    amount: 10,
    createdAt: new Date().toISOString(),
  });

  const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_fast' });

  expect(result.signals.map(signal => signal.code)).toEqual(
    expect.arrayContaining(['RAPID_FIRST_CASHOUT', 'RAPID_MILESTONE_COMPLETION'])
  );
});

test('does not treat repeated public email providers as concentrated business identity', async () => {
  seedEligibleSupplier();
  mockCollections.users.find(user => user.id === 'usr_supplier').email = 'supplier@gmail.com';
  addReward('usr_supplier');

  for (let index = 2; index <= 3; index += 1) {
    mockCollections.users.push({
      id: `usr_supplier_${index}`,
      role: 'supplier',
      email: `supplier${index}@gmail.com`,
      company: `Supplier ${index}`,
      verified: true,
    });
    mockCollections.suppliers.push({
      id: `sup_${index}`,
      ownerUserId: `usr_supplier_${index}`,
      approved: true,
    });
    mockCollections.partner_referrals.push({
      id: `ref_${index}`,
      partnerId: 'prt_1',
      supplierUserId: `usr_supplier_${index}`,
      supplierCreatedAt: hoursAgo(72),
      createdAt: hoursAgo(72),
    });
    addReward(`usr_supplier_${index}`);
  }

  const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_public' });
  expect(result.signals.map(signal => signal.code)).not.toContain(
    'CONCENTRATED_PRIVATE_EMAIL_DOMAINS'
  );
});

test('fails closed when a new fraud assessment cannot be persisted', async () => {
  mockDb.insertOne.mockResolvedValueOnce(null);

  await expect(
    antiAbuse.persistAssessment({
      id: 'assessment_1',
      partnerId: 'prt_1',
      requestId: 'pcr_1',
      score: 50,
    })
  ).rejects.toThrow('Fraud assessment did not persist');
});

test('fails closed when an existing fraud assessment cannot be updated', async () => {
  mockCollections.partner_fraud_assessments.push({
    id: 'assessment_1',
    partnerId: 'prt_1',
    requestId: 'pcr_1',
    score: 20,
  });
  mockDb.updateOne.mockResolvedValueOnce(null);

  await expect(
    antiAbuse.persistAssessment({
      id: 'assessment_new',
      partnerId: 'prt_1',
      requestId: 'pcr_1',
      score: 50,
    })
  ).rejects.toThrow('Fraud assessment update did not persist');
});
