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

function seedRewardedSupplier(overrides = {}) {
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
      email: 'partner@agency.co.uk',
      company: 'North Wales Events Agency Ltd',
      website: 'https://agency.co.uk',
      verified: true,
      createdAt: old,
    },
    {
      id: 'usr_supplier',
      role: 'supplier',
      email: 'supplier@venue.co.uk',
      company: 'Independent Venue Ltd',
      verified: true,
      createdAt: old,
      ...overrides,
    }
  );
  mockCollections.suppliers.push({
    id: 'sup_1',
    ownerUserId: 'usr_supplier',
    approved: true,
    businessName: 'Independent Venue Ltd',
  });
  mockCollections.partner_referrals.push({
    id: 'ref_1',
    partnerId: 'prt_1',
    supplierUserId: 'usr_supplier',
    supplierCreatedAt: old,
    createdAt: old,
  });
  mockCollections.partner_credit_transactions.push({
    id: 'ptx_signup',
    partnerId: 'prt_1',
    supplierUserId: 'usr_supplier',
    type: 'REFERRAL_SIGNUP_BONUS',
    amount: 5,
    createdAt: oldDate(60),
  });
}

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
});

test('identity matcher recognises exact shared phone, website, company number and VAT evidence', () => {
  const left = {
    company: 'Alpha Events Ltd',
    phone: '+44 7700 900123',
    website: 'https://www.alpha-events.co.uk/about',
    companyNumber: '12345678',
    vatNumber: 'GB123456789',
  };
  expect(
    antiAbuse.identityOverlap(left, {
      company: 'Completely Different Name',
      phoneNumber: '07700 900123',
    })
  ).toMatchObject({ strongMatch: true, samePhone: true });
  expect(
    antiAbuse.identityOverlap(left, { websiteUrl: 'alpha-events.co.uk/contact' })
  ).toMatchObject({ strongMatch: true, sameWebsite: true });
  expect(antiAbuse.identityOverlap(left, { companiesHouseNumber: '12345678' })).toMatchObject({
    strongMatch: true,
    sameCompanyNumber: true,
  });
  expect(antiAbuse.identityOverlap(left, { vatRegistrationNumber: 'GB123456789' })).toMatchObject({
    strongMatch: true,
    sameVatNumber: true,
  });
});

test('fuzzy company similarity requires corroborating postcode evidence before becoming a strong match', () => {
  const fuzzyOnly = antiAbuse.identityOverlap(
    { company: 'North Wales Events Agency Limited', postcode: 'LL11 1AA' },
    { company: 'North Wales Events Agency Ltd', postcode: 'CF10 1AA' }
  );
  expect(fuzzyOnly.fuzzyCompany).toBe(true);
  expect(fuzzyOnly.strongMatch).toBe(false);

  const corroborated = antiAbuse.identityOverlap(
    { company: 'North Wales Events Agency Limited', postcode: 'LL11 1AA' },
    { company: 'North Wales Events Agency Ltd', postcode: 'LL11 1AA' }
  );
  expect(corroborated).toMatchObject({ fuzzyCompany: true, samePostcode: true, strongMatch: true });
});

test('unrelated businesses do not become an identity match', () => {
  expect(
    antiAbuse.identityOverlap(
      { company: 'Agency One', website: 'agency-one.co.uk', phone: '07700900111' },
      { company: 'Venue Two', website: 'venue-two.co.uk', phone: '07700900222' }
    )
  ).toMatchObject({ strongMatch: false });
});

test('approved supplier profile identity fields can block a self-referral before reward award', async () => {
  seedRewardedSupplier();
  mockCollections.suppliers[0].website = 'https://agency.co.uk/venue-page';

  await expect(antiAbuse.supplierRewardEligibility('usr_supplier')).resolves.toMatchObject({
    eligible: false,
    reason: 'POSSIBLE_SELF_REFERRAL',
    evidence: { sameWebsite: true },
  });
});

test('cashout assessment incorporates unresolved partner and supplier registration risk', async () => {
  seedRewardedSupplier({
    registrationRiskLevel: 'review',
    registrationRiskSignalCodes: ['DEVICE_NETWORK_MULTI_ACCOUNT'],
    phone: '07700900333',
    phoneVerified: false,
  });
  const partner = mockCollections.users.find(user => user.id === 'usr_partner');
  partner.registrationRiskLevel = 'high';
  partner.registrationRiskSignalCodes = ['BROWSER_MULTI_ACCOUNT'];

  const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_identity' });
  const codes = result.signals.map(signal => signal.code);
  expect(codes).toEqual(
    expect.arrayContaining([
      'PARTNER_REGISTRATION_RISK',
      'RISKY_SUPPLIER_REGISTRATION_HISTORY',
      'RISKY_SUPPLIER_PHONE_UNVERIFIED',
    ])
  );
  expect(result.metrics).toMatchObject({
    riskyRegistrationSupplierCount: 1,
    riskyUnverifiedPhoneCount: 1,
  });
});

test('cross-role device overlap recorded at registration feeds self-referral review', async () => {
  seedRewardedSupplier({
    registrationRiskSignalCodes: ['PARTNER_SUPPLIER_DEVICE_OVERLAP'],
  });
  const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_device' });
  expect(result.signals.map(signal => signal.code)).toContain('POSSIBLE_SELF_REFERRAL');
});
