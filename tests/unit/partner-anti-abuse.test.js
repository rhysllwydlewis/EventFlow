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

function mockMatches(item, query) {
  return Object.entries(query).every(([key, value]) => item[key] === value);
}

jest.mock('../../db-unified', () => ({
  read: jest.fn(async collection => mockCollections[collection] || []),
  find: jest.fn(async (collection, query) =>
    (mockCollections[collection] || []).filter(item => mockMatches(item, query))
  ),
  findOne: jest.fn(
    async (collection, query) =>
      (mockCollections[collection] || []).find(item => mockMatches(item, query)) || null
  ),
  insertOne: jest.fn(async (collection, record) => {
    mockCollections[collection].push(record);
    return record;
  }),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (mockCollections[collection] || []).find(candidate =>
      mockMatches(candidate, query)
    );
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  }),
}));

jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const antiAbuse = require('../../services/partnerAntiAbuseService');

function oldDate(days = 120) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function addReward(supplierUserId, type = 'REFERRAL_SIGNUP_BONUS', amount = 5, overrides = {}) {
  mockCollections.partner_credit_transactions.push({
    id: `ptx_${supplierUserId}_${type}`,
    partnerId: 'prt_1',
    supplierUserId,
    type,
    amount,
    createdAt: oldDate(30),
    ...overrides,
  });
}

function seedHealthyPartner({ withPackage = true, withReview = true } = {}) {
  const old = oldDate();
  mockCollections.partners.push({
    id: 'prt_1',
    userId: 'usr_partner',
    status: 'active',
    createdAt: old,
  });
  mockCollections.users.push(
    {
      id: 'usr_partner',
      role: 'partner',
      email: 'partner@example-agency.co.uk',
      company: 'Example Agency',
      verified: true,
      createdAt: old,
    },
    {
      id: 'usr_supplier',
      role: 'supplier',
      email: 'supplier@venue.co.uk',
      company: 'Venue Ltd',
      verified: true,
      createdAt: old,
    },
    {
      id: 'usr_customer',
      role: 'customer',
      email: 'customer@example.net',
      company: '',
      verified: true,
      createdAt: oldDate(30),
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
    supplierCreatedAt: old,
    createdAt: old,
  });
  if (withPackage) {
    mockCollections.packages.push({
      id: 'pkg_1',
      supplierId: 'sup_1',
      title: 'Wedding photography',
      price: '£900',
      primaryCategoryKey: 'photography',
      eventTypes: ['wedding'],
      approved: true,
      paused: false,
    });
  }
  if (withReview) {
    mockCollections.reviews.push({
      id: 'rev_1',
      supplierId: 'sup_1',
      userId: 'usr_customer',
      approved: true,
      flagged: false,
      emailVerified: true,
      verified: true,
      createdAt: oldDate(10),
    });
  }
}

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
});

describe('partner reward eligibility', () => {
  it('accepts an approved verified supplier with a separate identity', async () => {
    seedHealthyPartner();
    await expect(antiAbuse.supplierRewardEligibility('usr_supplier')).resolves.toMatchObject({
      eligible: true,
      supplier: { id: 'usr_supplier' },
      partner: { id: 'prt_1' },
    });
  });

  it.each([
    ['missing', 'SUPPLIER_ACCOUNT_MISSING'],
    ['unverified', 'SUPPLIER_EMAIL_UNVERIFIED'],
    ['company', 'SUPPLIER_COMPANY_MISSING'],
    ['referral', 'REFERRAL_RECORD_MISSING'],
    ['partner', 'PARTNER_NOT_ACTIVE'],
    ['profile', 'SUPPLIER_PROFILE_NOT_APPROVED'],
  ])('rejects %s supplier activity', async (scenario, reason) => {
    seedHealthyPartner();
    const supplier = mockCollections.users.find(user => user.id === 'usr_supplier');
    if (scenario === 'missing')
      mockCollections.users.splice(mockCollections.users.indexOf(supplier), 1);
    if (scenario === 'unverified') supplier.verified = false;
    if (scenario === 'company') supplier.company = '';
    if (scenario === 'referral') mockCollections.partner_referrals.splice(0, 1);
    if (scenario === 'partner') mockCollections.partners[0].status = 'disabled';
    if (scenario === 'profile') mockCollections.suppliers[0].approved = false;

    await expect(antiAbuse.supplierRewardEligibility('usr_supplier')).resolves.toMatchObject({
      eligible: false,
      reason,
    });
  });

  it('blocks matching company names and private email domains', async () => {
    seedHealthyPartner();
    const supplier = mockCollections.users.find(user => user.id === 'usr_supplier');
    supplier.company = 'Example Agency';
    supplier.email = 'supplier@example-agency.co.uk';
    await expect(antiAbuse.supplierRewardEligibility('usr_supplier')).resolves.toMatchObject({
      eligible: false,
      reason: 'POSSIBLE_SELF_REFERRAL',
    });
  });

  it('does not treat a shared public email provider as self-referral evidence by itself', async () => {
    seedHealthyPartner();
    mockCollections.users.find(user => user.id === 'usr_partner').email = 'partner@gmail.com';
    mockCollections.users.find(user => user.id === 'usr_supplier').email = 'supplier@gmail.com';
    await expect(antiAbuse.supplierRewardEligibility('usr_supplier')).resolves.toMatchObject({
      eligible: true,
    });
  });

  it('requires a complete approved package for the package reward', async () => {
    seedHealthyPartner({ withPackage: false });
    await expect(
      antiAbuse.supplierRewardEligibility('usr_supplier', 'awardPackageBonus')
    ).resolves.toMatchObject({ eligible: false, reason: 'QUALIFYING_PACKAGE_MISSING' });
  });

  it('requires an approved independently verified customer review', async () => {
    seedHealthyPartner();
    mockCollections.reviews[0].verified = false;
    await expect(
      antiAbuse.supplierRewardEligibility('usr_supplier', 'awardFirstReviewBonus')
    ).resolves.toMatchObject({
      eligible: false,
      reason: 'INDEPENDENT_VERIFIED_REVIEW_MISSING',
    });
  });
});

describe('partner cashout assessment', () => {
  it('requires manual review for a healthy first delivered cashout without classifying it high risk', async () => {
    seedHealthyPartner();
    addReward('usr_supplier', 'SUBSCRIPTION_BONUS', 100, { createdAt: oldDate(90) });

    const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_1' });

    expect(result.requiresManualReview).toBe(true);
    expect(result.blockApproval).toBe(false);
    expect(result.signals.map(signal => signal.code)).toContain('FIRST_CASHOUT');
    expect(result.metrics.rewardedReferralCount).toBe(1);
  });

  it('keeps first-cashout review after a rejected request and clears it after delivery', async () => {
    seedHealthyPartner();
    addReward('usr_supplier');
    mockCollections.partner_cashout_requests.push({
      id: 'pcr_rejected',
      partnerId: 'prt_1',
      status: 'rejected',
    });

    const afterRejection = await antiAbuse.assessCashout({
      partnerId: 'prt_1',
      requestId: 'pcr_next',
    });
    expect(afterRejection.signals.map(signal => signal.code)).toContain('FIRST_CASHOUT');
    expect(afterRejection.metrics.priorCashoutCount).toBe(1);
    expect(afterRejection.metrics.priorDeliveredCashoutCount).toBe(0);

    mockCollections.partner_cashout_requests.push({
      id: 'pcr_delivered',
      partnerId: 'prt_1',
      status: 'delivered',
    });
    const afterDelivery = await antiAbuse.assessCashout({
      partnerId: 'prt_1',
      requestId: 'pcr_later',
    });
    expect(afterDelivery.signals.map(signal => signal.code)).not.toContain('FIRST_CASHOUT');
    expect(afterDelivery.metrics.priorDeliveredCashoutCount).toBe(1);
  });

  it('blocks self-referrals, unverified suppliers and unapproved profiles when they earned points', async () => {
    seedHealthyPartner();
    addReward('usr_supplier');
    const supplier = mockCollections.users.find(user => user.id === 'usr_supplier');
    supplier.email = 'supplier@example-agency.co.uk';
    supplier.company = 'Example Agency';
    supplier.verified = false;
    mockCollections.suppliers[0].approved = false;

    const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_2' });

    expect(result.blockApproval).toBe(true);
    expect(result.signals.map(signal => signal.code)).toEqual(
      expect.arrayContaining([
        'POSSIBLE_SELF_REFERRAL',
        'UNVERIFIED_REFERRED_SUPPLIERS',
        'UNAPPROVED_SUPPLIER_PROFILES',
      ])
    );
  });

  it('does not score weak referrals that never contributed reward points', async () => {
    seedHealthyPartner();
    mockCollections.users.find(user => user.id === 'usr_supplier').verified = false;
    mockCollections.suppliers[0].approved = false;

    const result = await antiAbuse.assessCashout({
      partnerId: 'prt_1',
      requestId: 'pcr_adjustment',
    });

    expect(result.signals.map(signal => signal.code)).not.toEqual(
      expect.arrayContaining(['UNVERIFIED_REFERRED_SUPPLIERS', 'UNAPPROVED_SUPPLIER_PROFILES'])
    );
    expect(result.metrics.rewardedReferralCount).toBe(0);
  });

  it('blocks historical package and review rewards lacking current supporting evidence', async () => {
    seedHealthyPartner({ withPackage: false, withReview: false });
    addReward('usr_supplier', 'PACKAGE_BONUS', 10);
    addReward('usr_supplier', 'FIRST_REVIEW_BONUS', 15);

    const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_3' });

    expect(result.blockApproval).toBe(true);
    expect(result.signals.map(signal => signal.code)).toEqual(
      expect.arrayContaining([
        'PACKAGE_REWARD_WITHOUT_QUALIFYING_PACKAGE',
        'REVIEW_REWARD_WITHOUT_VERIFIED_REVIEW',
      ])
    );
  });

  it('flags concentrated private domains only across suppliers who earned points', async () => {
    seedHealthyPartner();
    addReward('usr_supplier');
    for (let index = 2; index <= 3; index += 1) {
      mockCollections.users.push({
        id: `usr_supplier_${index}`,
        role: 'supplier',
        email: `supplier${index}@venue.co.uk`,
        company: `Venue ${index}`,
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
        supplierCreatedAt: oldDate(),
      });
      addReward(`usr_supplier_${index}`);
    }

    const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_domains' });

    expect(result.signals.map(signal => signal.code)).toContain(
      'CONCENTRATED_PRIVATE_EMAIL_DOMAINS'
    );
  });

  it('persists one assessment per cashout request', async () => {
    seedHealthyPartner();
    const assessment = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_4' });
    await antiAbuse.persistAssessment(assessment);
    await antiAbuse.persistAssessment({ ...assessment, score: 30 });
    expect(mockCollections.partner_fraud_assessments).toHaveLength(1);
    expect(mockCollections.partner_fraud_assessments[0].score).toBe(30);
  });
});
