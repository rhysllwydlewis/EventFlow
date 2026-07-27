/**
 * Partner ledger persistence and review qualification tests.
 */
'use strict';

const mockStore = {
  partners: [],
  partner_referrals: [],
  partner_credit_transactions: [],
};

const mockDb = {
  read: jest.fn(collection => Promise.resolve([...(mockStore[collection] || [])])),
  find: jest.fn((collection, filter) =>
    Promise.resolve(
      (mockStore[collection] || []).filter(item =>
        Object.entries(filter || {}).every(([key, value]) => item[key] === value)
      )
    )
  ),
  findOne: jest.fn((collection, filter) =>
    Promise.resolve(
      (mockStore[collection] || []).find(item =>
        Object.entries(filter || {}).every(([key, value]) => item[key] === value)
      ) || null
    )
  ),
  insertOne: jest.fn((collection, document) => {
    if (!mockStore[collection]) mockStore[collection] = [];
    mockStore[collection].push(document);
    return Promise.resolve(document);
  }),
  updateOne: jest.fn().mockResolvedValue({ modified: 1 }),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
let mockId = 0;
jest.mock('../../store', () => ({ uid: prefix => `${prefix}_${++mockId}` }));

const partnerService = require('../../services/partnerService');

function resetStore() {
  mockStore.partners = [];
  mockStore.partner_referrals = [];
  mockStore.partner_credit_transactions = [];
  mockId = 0;
  jest.clearAllMocks();
  mockDb.read.mockImplementation(collection => Promise.resolve([...(mockStore[collection] || [])]));
  mockDb.find.mockImplementation((collection, filter) =>
    Promise.resolve(
      (mockStore[collection] || []).filter(item =>
        Object.entries(filter || {}).every(([key, value]) => item[key] === value)
      )
    )
  );
  mockDb.findOne.mockImplementation((collection, filter) =>
    Promise.resolve(
      (mockStore[collection] || []).find(item =>
        Object.entries(filter || {}).every(([key, value]) => item[key] === value)
      ) || null
    )
  );
  mockDb.insertOne.mockImplementation((collection, document) => {
    if (!mockStore[collection]) mockStore[collection] = [];
    mockStore[collection].push(document);
    return Promise.resolve(document);
  });
}

describe('partner ledger integrity', () => {
  beforeEach(resetStore);

  it('throws when a cashout hold does not persist', async () => {
    mockDb.insertOne.mockResolvedValueOnce(null);
    await expect(
      partnerService.createCashoutHold({
        partnerId: 'prt_001',
        amount: 1500,
        cashoutId: 'pcr_001',
      })
    ).rejects.toMatchObject({ code: 'PARTNER_LEDGER_WRITE_FAILED' });
  });

  it('returns the original hold when the same cashout reference is retried', async () => {
    const first = await partnerService.createCashoutHold({
      partnerId: 'prt_001',
      amount: 1500,
      cashoutId: 'pcr_001',
    });
    const second = await partnerService.createCashoutHold({
      partnerId: 'prt_001',
      amount: 1500,
      cashoutId: 'pcr_001',
    });
    expect(second.id).toBe(first.id);
    expect(
      mockStore.partner_credit_transactions.filter(item => item.type === 'CASHOUT_HOLD')
    ).toHaveLength(1);
  });

  it('creates only one release for a held transaction', async () => {
    const hold = await partnerService.createCashoutHold({
      partnerId: 'prt_001',
      amount: 1500,
      cashoutId: 'pcr_001',
    });
    const first = await partnerService.releaseCashoutHold(hold.id, 'prt_001');
    const second = await partnerService.releaseCashoutHold(hold.id, 'prt_001');
    expect(second.id).toBe(first.id);
    expect(
      mockStore.partner_credit_transactions.filter(item => item.type === 'CASHOUT_RELEASE')
    ).toHaveLength(1);
  });

  it('derives review qualification timestamps from existing ledger entries', async () => {
    mockStore.partner_credit_transactions.push({
      id: 'ptx_review_001',
      partnerId: 'prt_001',
      supplierUserId: 'usr_supplier_001',
      type: 'FIRST_REVIEW_BONUS',
      amount: 15,
      createdAt: '2026-07-12T10:00:00.000Z',
    });
    const qualifications = await partnerService.getReviewQualifications('prt_001');
    expect(qualifications.get('usr_supplier_001')).toBe('2026-07-12T10:00:00.000Z');
  });

  it('includes the review reward in potential points without applying the attribution expiry', async () => {
    mockStore.partner_referrals.push({
      id: 'ref_001',
      partnerId: 'prt_001',
      supplierUserId: 'usr_supplier_001',
      supplierCreatedAt: '2025-01-01T00:00:00.000Z',
      packageQualified: false,
      subscriptionQualified: false,
    });
    const pending = await partnerService.getPendingPoints('prt_001');
    expect(pending).toMatchObject({
      pendingPackage: 0,
      pendingSubscription: 0,
      pendingReview: 15,
      totalPending: 15,
    });
  });
});
