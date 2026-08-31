/**
 * Regression coverage for a double-crediting race in partnerService.awardCredit().
 *
 * awardCredit() used to check for an existing transaction and then insert a
 * new one as two separate, unsynchronized steps. Two concurrent calls for
 * the same (partnerId, supplierUserId, type) — e.g. a Stripe webhook and a
 * dashboard balance reconciliation firing at the same time — could both
 * pass the duplicate check before either insert landed, awarding the same
 * bonus twice. This double-crediting is real, cashable-out money via the
 * partner cashout flow.
 */
'use strict';

const mockStore = {
  partners: [],
  partner_referrals: [],
  partner_credit_transactions: [],
};

function matches(item, filter) {
  return Object.entries(filter || {}).every(([key, value]) => item[key] === value);
}

// Every call to findOne('partner_credit_transactions', ...) — the duplicate
// check awardCredit relies on — blocks on this barrier until the test
// explicitly releases it. That forces any concurrent callers to genuinely
// be in-flight at the same instant, instead of hoping a timer-based delay
// happens to interleave them.
let creditCheckBarrier = null;

const mockDb = {
  read: jest.fn(collection => Promise.resolve([...(mockStore[collection] || [])])),
  find: jest.fn((collection, filter) =>
    Promise.resolve((mockStore[collection] || []).filter(item => matches(item, filter)))
  ),
  findOne: jest.fn((collection, filter) => {
    if (collection === 'partner_credit_transactions' && creditCheckBarrier) {
      return creditCheckBarrier.then(
        () => (mockStore[collection] || []).find(item => matches(item, filter)) || null
      );
    }
    return Promise.resolve(
      (mockStore[collection] || []).find(item => matches(item, filter)) || null
    );
  }),
  insertOne: jest.fn((collection, document) => {
    if (!mockStore[collection]) {
      mockStore[collection] = [];
    }
    mockStore[collection].push(document);
    return Promise.resolve(document);
  }),
  updateOne: jest.fn().mockResolvedValue(true),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
let mockId = 0;
jest.mock('../../store', () => ({ uid: prefix => `${prefix}_${++mockId}` }));

const partnerService = require('../../services/partnerService');

function resetStore() {
  mockStore.partners = [{ id: 'prt_001', userId: 'usr_partner_001', status: 'active' }];
  mockStore.partner_referrals = [
    {
      id: 'ref_001',
      partnerId: 'prt_001',
      supplierUserId: 'usr_supplier_001',
      supplierCreatedAt: '2025-01-01T00:00:00.000Z',
      packageQualified: false,
      subscriptionQualified: false,
    },
  ];
  mockStore.partner_credit_transactions = [];
  mockId = 0;
  creditCheckBarrier = null;
  jest.clearAllMocks();
}

describe('partnerService.awardCredit concurrency', () => {
  beforeEach(resetStore);

  it('only inserts one transaction when both calls reach the duplicate check at the same instant', async () => {
    let releaseBarrier;
    creditCheckBarrier = new Promise(resolve => {
      releaseBarrier = resolve;
    });

    const p1 = partnerService.awardReferralSignupBonus('usr_supplier_001');
    const p2 = partnerService.awardReferralSignupBonus('usr_supplier_001');

    // Let both calls run their (unblocked) prior steps far enough to reach
    // the barrier-gated duplicate check (or, if serialized by a fix, far
    // enough for the first call to be blocked on it) before releasing.
    await new Promise(resolve => setTimeout(resolve, 20));

    releaseBarrier();
    const [first, second] = await Promise.all([p1, p2]);

    const inserted = mockStore.partner_credit_transactions.filter(
      t =>
        t.partnerId === 'prt_001' &&
        t.supplierUserId === 'usr_supplier_001' &&
        t.type === 'REFERRAL_SIGNUP_BONUS'
    );
    expect(inserted).toHaveLength(1);

    const results = [first, second].filter(Boolean);
    expect(results).toHaveLength(1);
  });

  it('still awards the bonus once for sequential (non-concurrent) calls', async () => {
    const first = await partnerService.awardReferralSignupBonus('usr_supplier_001');
    const second = await partnerService.awardReferralSignupBonus('usr_supplier_001');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(
      mockStore.partner_credit_transactions.filter(t => t.type === 'REFERRAL_SIGNUP_BONUS')
    ).toHaveLength(1);
  });

  it('does not serialize awards for different suppliers behind the same lock', async () => {
    mockStore.partner_referrals.push({
      id: 'ref_002',
      partnerId: 'prt_001',
      supplierUserId: 'usr_supplier_002',
      supplierCreatedAt: '2025-01-01T00:00:00.000Z',
      packageQualified: false,
      subscriptionQualified: false,
    });

    const [a, b] = await Promise.all([
      partnerService.awardReferralSignupBonus('usr_supplier_001'),
      partnerService.awardReferralSignupBonus('usr_supplier_002'),
    ]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(mockStore.partner_credit_transactions).toHaveLength(2);
  });
});
