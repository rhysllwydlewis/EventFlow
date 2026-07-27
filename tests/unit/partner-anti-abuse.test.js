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

function seedHealthyPartner() {
  const old = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  mockCollections.partners.push({
    id: 'prt_1',
    userId: 'usr_partner',
    status: 'active',
    createdAt: old,
  });
  mockCollections.users.push(
    {
      id: 'usr_partner',
      email: 'partner@example-agency.co.uk',
      company: 'Example Agency',
      verified: true,
    },
    {
      id: 'usr_supplier',
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
    createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  });
}

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

  it('persists and updates one assessment per cashout request', async () => {
    seedHealthyPartner();
    const assessment = await antiAbuse.assessCashout({ partnerId: 'prt_1', requestId: 'pcr_4' });

    await antiAbuse.persistAssessment(assessment);
    await antiAbuse.persistAssessment({ ...assessment, score: 30 });

    expect(mockCollections.partner_fraud_assessments).toHaveLength(1);
    expect(mockCollections.partner_fraud_assessments[0].score).toBe(30);
  });
});
