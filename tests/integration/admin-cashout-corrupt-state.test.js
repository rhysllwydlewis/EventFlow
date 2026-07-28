'use strict';

const express = require('express');
const request = require('supertest');

const mockCollections = {
  partner_cashout_requests: [],
  users: [],
  partners: [],
  partner_credit_transactions: [],
  partner_fraud_assessments: [],
};

function matches(item, query) {
  return Object.entries(query).every(([key, value]) => item[key] === value);
}

const mockDb = {
  read: jest.fn(async collection => mockCollections[collection] || []),
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
  deleteOne: jest.fn(async () => null),
};
const mockReleaseCashoutHold = jest.fn(async () => ({ id: 'ptx_release' }));
let mockAssessment;
const mockAssessCashout = jest.fn(async () => mockAssessment);
const mockPersistAssessment = jest.fn(async assessment => assessment);

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../store', () => ({ uid: jest.fn(() => 'ptx_recovered') }));
jest.mock('../../services/partnerService', () => ({
  CREDIT_TYPES: { REDEEM: 'REDEEM' },
  releaseCashoutHold: mockReleaseCashoutHold,
}));
jest.mock('../../services/partnerAntiAbuseService', () => ({
  assessCashout: mockAssessCashout,
  persistAssessment: mockPersistAssessment,
}));
jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = { id: 'admin_1', role: 'admin' };
    next();
  },
  roleRequired: jest.fn(() => (_req, _res, next) => next()),
}));
jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const router = require('../../routes/admin-cashout-requests');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/cashout-requests', router);
  return app;
}

function seedCashout(overrides = {}) {
  const item = {
    id: 'pcr_corrupt',
    partnerId: 'prt_1',
    partnerUserId: 'usr_partner',
    status: 'processing',
    pointsHeld: 1500,
    denominationGbp: 15,
    method: 'amazon_voucher',
    holdTxnId: 'ptx_hold',
    createdAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  };
  mockCollections.partner_cashout_requests.push(item);
  return item;
}

function seedInterruptedRedeem(overrides = {}) {
  const item = {
    id: 'ptx_partial',
    partnerId: 'prt_1',
    supplierUserId: null,
    type: 'REDEEM',
    amount: -1500,
    externalRef: 'pcr_corrupt',
    createdAt: '2026-07-02T12:00:00.000Z',
    ...overrides,
  };
  mockCollections.partner_credit_transactions.push(item);
  return item;
}

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockAssessment = {
    id: 'assessment_1',
    partnerId: 'prt_1',
    requestId: 'pcr_corrupt',
    score: 0,
    riskLevel: 'low',
    requiresManualReview: false,
    blockApproval: false,
    signals: [],
    assessedAt: '2026-07-02T12:00:00.000Z',
  };
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
  mockReleaseCashoutHold.mockResolvedValue({ id: 'ptx_release' });
  mockAssessCashout.mockImplementation(async () => mockAssessment);
});

test('does not deliver a request whose points hold is missing', async () => {
  seedCashout({ holdTxnId: null });

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_corrupt')
    .send({ status: 'delivered', deliveryDetails: { reference: 'voucher-1' } });

  expect(response.status).toBe(409);
  expect(response.body.code).toBe('CASHOUT_HOLD_MISSING');
  expect(mockDb.insertOne).not.toHaveBeenCalled();
  expect(mockReleaseCashoutHold).not.toHaveBeenCalled();
});

test.each([0, -10, 'not-a-number', null])(
  'does not deliver a request with invalid held points: %p',
  async pointsHeld => {
    seedCashout({ pointsHeld });

    const response = await request(buildApp())
      .patch('/api/admin/cashout-requests/pcr_corrupt')
      .send({ status: 'delivered', deliveryDetails: { reference: 'voucher-2' } });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CASHOUT_POINTS_INVALID');
    expect(mockDb.insertOne).not.toHaveBeenCalled();
    expect(mockReleaseCashoutHold).not.toHaveBeenCalled();
  }
);

test('repairs a stale finalRedeemTxnId by creating a verified replacement debit', async () => {
  seedCashout({ finalRedeemTxnId: 'ptx_missing' });

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_corrupt')
    .send({ status: 'delivered', deliveryDetails: { reference: 'voucher-3' } });

  expect(response.status).toBe(200);
  expect(mockDb.insertOne).toHaveBeenCalledWith(
    'partner_credit_transactions',
    expect.objectContaining({
      id: 'ptx_recovered',
      type: 'REDEEM',
      externalRef: 'pcr_corrupt',
      amount: -1500,
    })
  );
  expect(response.body.request.finalRedeemTxnId).toBe('ptx_recovered');
  expect(mockReleaseCashoutHold).toHaveBeenCalledWith('ptx_hold', 'prt_1');
});

test('fails closed when blocked-risk fields cannot be stored', async () => {
  seedCashout({ status: 'submitted' });
  mockAssessment = {
    ...mockAssessment,
    score: 80,
    riskLevel: 'high',
    requiresManualReview: true,
    blockApproval: true,
    signals: [{ code: 'POSSIBLE_SELF_REFERRAL' }],
  };
  mockDb.updateOne.mockResolvedValueOnce(null);

  const response = await request(buildApp()).patch('/api/admin/cashout-requests/pcr_corrupt').send({
    status: 'approved',
    adminInternalNotes: 'The identity evidence remains unresolved after manual review.',
  });

  expect(response.status).toBe(500);
  expect(response.body.code).toBe('PARTNER_CASHOUT_RISK_WRITE_FAILED');
  expect(mockCollections.partner_cashout_requests[0].status).toBe('submitted');
});

test('reverses an interrupted redemption before releasing the hold on rejection', async () => {
  seedCashout({ finalRedeemTxnId: 'ptx_partial' });
  seedInterruptedRedeem();

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_corrupt')
    .send({ status: 'rejected', adminInternalNotes: 'Delivery failed before completion.' });

  expect(response.status).toBe(200);
  expect(mockDb.insertOne).toHaveBeenCalledWith(
    'partner_credit_transactions',
    expect.objectContaining({
      id: 'ptx_recovered',
      type: 'ADJUSTMENT',
      subtype: 'CASHOUT_REDEEM_REVERSAL',
      amount: 1500,
      externalRef: 'ptx_partial',
    })
  );
  expect(mockDb.insertOne.mock.invocationCallOrder[0]).toBeLessThan(
    mockReleaseCashoutHold.mock.invocationCallOrder[0]
  );
  expect(response.body.request).toMatchObject({
    status: 'rejected',
    finalRedeemReversalTxnId: 'ptx_recovered',
  });
});

test('reuses an existing redemption reversal during a rejection retry', async () => {
  seedCashout({ finalRedeemTxnId: 'ptx_partial' });
  seedInterruptedRedeem();
  mockCollections.partner_credit_transactions.push({
    id: 'ptx_existing_reversal',
    partnerId: 'prt_1',
    supplierUserId: null,
    type: 'ADJUSTMENT',
    subtype: 'CASHOUT_REDEEM_REVERSAL',
    amount: 1500,
    externalRef: 'ptx_partial',
  });

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_corrupt')
    .send({ status: 'rejected' });

  expect(response.status).toBe(200);
  expect(mockDb.insertOne).not.toHaveBeenCalled();
  expect(response.body.request.finalRedeemReversalTxnId).toBe('ptx_existing_reversal');
  expect(mockReleaseCashoutHold).toHaveBeenCalledWith('ptx_hold', 'prt_1');
});

test('fails closed when an interrupted redemption reversal cannot be stored', async () => {
  seedCashout({ finalRedeemTxnId: 'ptx_partial' });
  seedInterruptedRedeem();
  mockDb.insertOne.mockResolvedValueOnce(null);

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_corrupt')
    .send({ status: 'rejected' });

  expect(response.status).toBe(500);
  expect(response.body.code).toBe('CASHOUT_REDEEM_REVERSAL_WRITE_FAILED');
  expect(mockReleaseCashoutHold).not.toHaveBeenCalled();
  expect(mockCollections.partner_cashout_requests[0].status).toBe('processing');
});

test('keeps the request recoverable when rejection hold release fails after reversal', async () => {
  seedCashout({ finalRedeemTxnId: 'ptx_partial' });
  seedInterruptedRedeem();
  mockReleaseCashoutHold.mockResolvedValueOnce(null);

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_corrupt')
    .send({ status: 'rejected' });

  expect(response.status).toBe(500);
  expect(response.body.code).toBe('CASHOUT_HOLD_RELEASE_FAILED');
  expect(mockCollections.partner_cashout_requests[0].status).toBe('processing');
  expect(mockCollections.partner_credit_transactions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        subtype: 'CASHOUT_REDEEM_REVERSAL',
        externalRef: 'ptx_partial',
      }),
    ])
  );
});
