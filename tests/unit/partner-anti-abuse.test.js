'use strict';

const mockCollections = {
  partners: [],
  users: [],
  partner_referrals: [],
  partner_credit_transactions: [],
  partner_cashout_requests: [],
  partner_fraud_assessments: [],
};

jest.mock('../../db-unified', () => ({
  read: jest.fn(async collection => mockCollections[collection] || []),
  findOne: jest.fn(async (collection, query) =>
    (mockCollections[collection] || []).find(item =>
      Object.entries(query).every(([key, value]) => item[key] === value)
    ) || null
  ),
  insertOne: jest.fn(async (collection, record) => {
    mockCollections[collection].push(record);
    return record;
  }),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (mockCollections[collection] || []).find(candidate =>
      Object.entries(query).every(([key, value]) => candidate[key] === value)
    );
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  }),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const antiAbuse = require('../../services/partnerAntiAbuseService');

function oldDate(days = 120) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function seedHealthyPartner() {
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
    },
    {
      id: 'usr_supplier',
      role: 'supplier',
      email: 'supplier@venue.co.uk',
      company: 'Venue Ltd',
      verified: true,
    }
  );
  mockCollections.partner_referrals.push({
    id: 'ref_1',
    partnerId: 'prt_1',
    supplierUserId: 'usr_supplier',
    supplierCreatedAt: old,
    createdAt: old,
  });
  mockCollections.partner_credit_transactions.push({
    id: 'ptx_1',
    partnerId: 'prt_1',
    supplierUserId: 'usr_supplier',
    type: 'SUBSCRIPTION_BONUS',
    amount: 100,
    createdAt: oldDate(90),
  });
}

describe('partner reward eligibility', () => {
  beforeEach(() => {
    Object.values(mockCollections).forEach(items => items.splice(0, items.length));
    jest.clearAllMocks();
  });

  it('accepts a verified supplier with a genuine separate identity', async () => {
    seedHealthyPartner();

    await expect(antiAbuse.supplierRewardEligibility('usr_supplier')).resolves.toMatchObject({
      eligible: true,
      supplier: { id: 'usr_supplier' },
      partner: { id: 'prt_1' },
    });
  });

  it.each([
    ['missing supplier', 'missing', 'SUPPLIER_ACCOUNT_MISSING'],
    ['unverified supplier', 'unverified', 'SUPPLIER_EMAIL_UNVERIFIED'],
    ['missing company', 'company', 'SUPPLIER_COMPANY_MISSING'],
    ['missing referral', 'referral', 'REFERRAL_RECORD_MISSING'],
    ['inactive partner', 'partner', 'PARTNER_NOT_ACTIVE'],
  ])('rejects %s', async (_label, scenario, reason) => {
    seedHealthyPartner();
    const supplier = mockCollections.users.find(user => user.id === 'usr_supplier');
    if (scenario === 'missing') {
      mockCollections.users.splice(mockCollections.users.indexOf(supplier), 1);
    } else if (scenario === 'unverified') {
      supplier.verified = false;
    } else if (scenario === 'company') {
      supplier.company = '';
    } else if (scenario === 'referral') {
      mockCollections.partner_referrals.splice(0, 1);
    } else if (scenario === 'partner') {
      mockCollections.partners[0].status = 'disabled';
    }

    await expect(antiAbuse.supplierRewardEligibility('usr_supplier')).resolves.toMatchObject({
      eligible: false,
      reason,
    });
  });

  it('blocks matching company names and matching private email domains', async () => {
    seedHealthyPartner();
    const supplier = mockCollections.users.find(user => user.id === 'usr_supplier');
    supplier.company = 'Example Agency';
    supplier.email = 'supplier@example-agency.co.uk';

    await expect(antiAbuse.supplierRewardEligibility('usr_supplier')).resolves.toMatchObject({
      eligible: false,
      reason: 'POSSIBLE_SELF_REFERRAL',
      evidence: { samePrivateDomain: true, sameCompany: true },
    });
  });

  it('does not treat a shared public email provider as a self-referral by itself', async () => {
    seedHealthyPartner();
    const partner = mockCollections.users.find(user => user.id === 'usr_partner');
    const supplier = mockCollections.users.find(user => user.id === 'usr_supplier');
    partner.email = 'partner@gmail.com';
    supplier.email = 'supplier@gmail.com';

    await expect(antiAbuse.supplierRewardEligibility('usr_supplier')).resolves.toMatchObject({
      eligible: true,
    });
  });

  it('wraps reward methods and withholds ineligible activity', async () => {
    seedHealthyPartner();
    const service = {
      awardReferralSignupBonus: jest.fn(async () => 'signup'),
      awardPackageBonus: jest.fn(async () => 'package'),
      awardFirstReviewBonus: jest.fn(async () => 'review'),
      awardSubscriptionBonus: jest.fn(async () => 'subscription'),
    };

    antiAbuse.installRewardGuards(service);
    await expect(service.awardPackageBonus('usr_supplier')).resolves.toBe('package');

    mockCollections.users.find(user => user.id === 'usr_supplier').verified = false;
    await expect(service.awardFirstReviewBonus('usr_supplier')).resolves.toBeNull();
  });
});

describe('partner anti-abuse assessment', () => {
  beforeEach(() => {
    Object.values(mockCollections).forEach(items => items.splice(0, items.length));
    jest.clearAllMocks();
  });

  it('requires manual review for a first cashout without blocking a healthy partner', async () => {
    seedHealthyPartner();

    const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_1' });

    expect(result.requiresManualReview).toBe(true);
    expect(result.blockApproval).toBe(false);
    expect(result.signals.map(signal => signal.code)).toContain('FIRST_CASHOUT');
  });

  it('blocks likely self-referrals and unverified suppliers', async () => {
    seedHealthyPartner();
    const supplier = mockCollections.users.find(user => user.id === 'usr_supplier');
    supplier.email = 'supplier@example-agency.co.uk';
    supplier.company = 'Example Agency';
    supplier.verified = false;

    const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_2' });

    expect(result.blockApproval).toBe(true);
    expect(result.riskLevel).toBe('high');
    expect(result.signals.map(signal => signal.code)).toEqual(
      expect.arrayContaining(['POSSIBLE_SELF_REFERRAL', 'UNVERIFIED_REFERRED_SUPPLIERS'])
    );
  });

  it('flags missing identities, inactive accounts and unsupported cashouts', async () => {
    const missing = await antiAbuse.assessCashout({ partnerId: 'missing', requestId: 'pcr_x' });
    expect(missing.blockApproval).toBe(true);
    expect(missing.signals.map(signal => signal.code)).toEqual(
      expect.arrayContaining(['MISSING_PARTNER_IDENTITY', 'NO_REFERRAL_RECORDS'])
    );

    seedHealthyPartner();
    mockCollections.partners[0].status = 'disabled';
    const disabled = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_y' });
    expect(disabled.signals.map(signal => signal.code)).toContain('PARTNER_NOT_ACTIVE');
  });

  it('flags rapid cashouts and rapid milestone completion', async () => {
    seedHealthyPartner();
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    mockCollections.partners[0].createdAt = recent;
    mockCollections.partner_referrals[0].supplierCreatedAt = recent;
    mockCollections.partner_credit_transactions[0].createdAt = new Date().toISOString();

    const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_fast' });

    expect(result.signals.map(signal => signal.code)).toEqual(
      expect.arrayContaining(['RAPID_FIRST_CASHOUT', 'RAPID_MILESTONE_COMPLETION'])
    );
  });

  it('flags concentrated supplier email domains', async () => {
    seedHealthyPartner();
    for (let index = 2; index <= 3; index += 1) {
      mockCollections.users.push({
        id: `usr_supplier_${index}`,
        role: 'supplier',
        email: `supplier${index}@venue.co.uk`,
        company: `Venue ${index}`,
        verified: true,
      });
      mockCollections.partner_referrals.push({
        id: `ref_${index}`,
        partnerId: 'prt_1',
        supplierUserId: `usr_supplier_${index}`,
        supplierCreatedAt: oldDate(),
        createdAt: oldDate(),
      });
    }

    const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_domains' });

    expect(result.signals.map(signal => signal.code)).toContain('CONCENTRATED_EMAIL_DOMAINS');
  });

  it('flags reward transactions that do not have a referral record', async () => {
    seedHealthyPartner();
    mockCollections.partner_credit_transactions.push({
      id: 'ptx_orphan',
      partnerId: 'prt_1',
      supplierUserId: 'usr_unknown',
      type: 'PACKAGE_BONUS',
      amount: 10,
      createdAt: new Date().toISOString(),
    });

    const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_3' });

    expect(result.blockApproval).toBe(true);
    expect(result.signals.map(signal => signal.code)).toContain('ORPHAN_REWARD_TRANSACTIONS');
  });

  it('does not treat a historical cashout as a first cashout', async () => {
    seedHealthyPartner();
    mockCollections.partner_cashout_requests.push({ id: 'pcr_old', partnerId: 'prt_1' });

    const result = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_new' });

    expect(result.signals.map(signal => signal.code)).not.toContain('FIRST_CASHOUT');
    expect(result.metrics.priorCashoutCount).toBe(1);
  });

  it('persists and updates one assessment per cashout request', async () => {
    seedHealthyPartner();
    const assessment = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_4' });

    await antiAbuse.persistAssessment(assessment);
    await antiAbuse.persistAssessment({ ...assessment, score: 30 });

    expect(mockCollections.partner_fraud_assessments).toHaveLength(1);
    expect(mockCollections.partner_fraud_assessments[0].score).toBe(30);
  });

  it('fails when an assessment cannot be persisted', async () => {
    const dbUnified = require('../../db-unified');
    dbUnified.insertOne.mockResolvedValueOnce(null);

    await expect(
      antiAbuse.persistAssessment({
        id: 'assessment_fail',
        partnerId: 'prt_1',
        requestId: 'pcr_fail',
      })
    ).rejects.toThrow('Fraud assessment did not persist');
  });
});
