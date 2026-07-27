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
  findOne: jest.fn(async (collection, query) =>
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
  deleteOne: jest.fn(async (collection, query) => {
    const items = mockCollections[collection] || [];
    const index = items.findIndex(item => matches(item, query));
    if (index < 0) return null;
    return items.splice(index, 1)[0];
  }),
};

const mockReleaseCashoutHold = jest.fn(async () => ({ id: 'ptx_release' }));
let mockCurrentAssessment;
const mockAssessCashout = jest.fn(async () => mockCurrentAssessment);
const mockPersistAssessment = jest.fn(async assessment => {
  const existingIndex = mockCollections.partner_fraud_assessments.findIndex(
    item => item.requestId === assessment.requestId
  );
  if (existingIndex >= 0) {
    mockCollections.partner_fraud_assessments[existingIndex] = {
      ...mockCollections.partner_fraud_assessments[existingIndex],
      ...assessment,
    };
  } else {
    mockCollections.partner_fraud_assessments.push({ ...assessment });
  }
  return assessment;
});

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../store', () => ({ uid: jest.fn(() => 'ptx_final') }));
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

function seedRequest(overrides = {}) {
  const cashout = {
    id: 'pcr_1',
    partnerId: 'prt_1',
    partnerUserId: 'usr_partner',
    status: 'submitted',
    pointsHeld: 1500,
    denominationGbp: 15,
    method: 'amazon_voucher',
    holdTxnId: 'ptx_hold',
    createdAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  };
  mockCollections.partner_cashout_requests.push(cashout);
  mockCollections.users.push({
    id: 'usr_partner',
    name: 'Partner Person',
    email: 'partner@example.com',
    company: 'Example Agency',
  });
  mockCollections.partners.push({ id: 'prt_1', refCode: 'PARTNER1' });
  return cashout;
}

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockCurrentAssessment = {
    id: 'assessment_1',
    partnerId: 'prt_1',
    requestId: 'pcr_1',
    score: 0,
    riskLevel: 'low',
    requiresManualReview: false,
    blockApproval: false,
    signals: [],
    metrics: { referralCount: 1 },
    assessedAt: '2026-07-02T12:00:00.000Z',
  };
  mockReleaseCashoutHold.mockResolvedValue({ id: 'ptx_release' });
  mockAssessCashout.mockImplementation(async () => mockCurrentAssessment);
  mockPersistAssessment.mockImplementation(async assessment => {
    const existingIndex = mockCollections.partner_fraud_assessments.findIndex(
      item => item.requestId === assessment.requestId
    );
    if (existingIndex >= 0) {
      mockCollections.partner_fraud_assessments[existingIndex] = {
        ...mockCollections.partner_fraud_assessments[existingIndex],
        ...assessment,
      };
    } else {
      mockCollections.partner_fraud_assessments.push({ ...assessment });
    }
    return assessment;
  });
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

test('lists cashouts with partner identity and fraud summary', async () => {
  seedRequest({
    fraudRiskLevel: 'review',
    fraudRiskScore: 30,
    fraudReviewRequired: true,
    fraudReviewedAt: '2026-07-02T12:00:00.000Z',
  });

  const response = await request(buildApp()).get('/api/admin/cashout-requests');

  expect(response.status).toBe(200);
  expect(response.body.items[0]).toMatchObject({
    partnerRefCode: 'PARTNER1',
    partnerUser: { name: 'Partner Person', email: 'partner@example.com' },
    fraudSummary: {
      riskLevel: 'review',
      riskScore: 30,
      reviewRequired: true,
      reviewedAt: '2026-07-02T12:00:00.000Z',
    },
  });
});

test('returns the persisted fraud assessment with cashout detail', async () => {
  seedRequest();
  mockCollections.partner_fraud_assessments.push({
    id: 'assessment_1',
    requestId: 'pcr_1',
    riskLevel: 'low',
  });

  const response = await request(buildApp()).get('/api/admin/cashout-requests/pcr_1');

  expect(response.status).toBe(200);
  expect(response.body.fraudAssessment).toMatchObject({
    id: 'assessment_1',
    requestId: 'pcr_1',
  });
});

test('requires a meaningful internal note when a cashout needs manual review', async () => {
  seedRequest();
  mockCurrentAssessment = {
    ...mockCurrentAssessment,
    score: 25,
    riskLevel: 'review',
    requiresManualReview: true,
    signals: [{ code: 'FIRST_CASHOUT' }],
  };

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_1')
    .send({ status: 'approved', adminInternalNotes: 'Checked' });

  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({
    code: 'PARTNER_CASHOUT_REVIEW_NOTE_REQUIRED',
    assessment: { score: 25, riskLevel: 'review' },
  });
  expect(mockPersistAssessment).toHaveBeenCalledWith(mockCurrentAssessment);
  expect(mockCollections.partner_cashout_requests[0]).toMatchObject({
    status: 'submitted',
    fraudRiskScore: 25,
    fraudReviewRequired: true,
  });
});

test('blocks high-risk approval even when an administrator supplies a review note', async () => {
  seedRequest();
  mockCurrentAssessment = {
    ...mockCurrentAssessment,
    score: 85,
    riskLevel: 'high',
    requiresManualReview: true,
    blockApproval: true,
    signals: [{ code: 'POSSIBLE_SELF_REFERRAL' }],
  };

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_1')
    .send({
      status: 'approved',
      adminInternalNotes: 'Reviewed the records but the identity overlap remains unresolved.',
    });

  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({
    code: 'PARTNER_CASHOUT_HIGH_RISK',
    assessment: { score: 85, riskLevel: 'high' },
  });
  expect(mockCollections.partner_cashout_requests[0].status).toBe('submitted');
});

test('approves a reviewed cashout and stores its fraud evidence', async () => {
  seedRequest();
  mockCurrentAssessment = {
    ...mockCurrentAssessment,
    score: 25,
    riskLevel: 'review',
    requiresManualReview: true,
    signals: [{ code: 'FIRST_CASHOUT' }],
  };

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_1')
    .send({
      status: 'approved',
      adminInternalNotes: 'Checked supplier identity, package evidence and the Stripe payment.',
    });

  expect(response.status).toBe(200);
  expect(response.body.request).toMatchObject({
    status: 'approved',
    fraudRiskScore: 25,
    fraudRiskLevel: 'review',
    fraudReviewRequired: true,
    fraudReviewedAt: expect.any(String),
  });
  expect(mockCollections.partner_cashout_requests[0]).toMatchObject({
    status: 'approved',
    fraudRiskScore: 25,
    adminInternalNotes: 'Checked supplier identity, package evidence and the Stripe payment.',
  });
});

test('rejects delivery without voucher or payment evidence', async () => {
  seedRequest({ status: 'processing' });

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_1')
    .send({ status: 'delivered', deliveryDetails: {} });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('CASHOUT_DELIVERY_EVIDENCE_REQUIRED');
  expect(mockDb.insertOne).not.toHaveBeenCalled();
  expect(mockReleaseCashoutHold).not.toHaveBeenCalled();
});

test('persists the permanent redemption before releasing the temporary hold', async () => {
  seedRequest({ status: 'processing' });

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_1')
    .send({ status: 'delivered', deliveryDetails: { reference: 'amazon-123' } });

  expect(response.status).toBe(200);
  expect(mockDb.insertOne).toHaveBeenCalledWith(
    'partner_credit_transactions',
    expect.objectContaining({
      id: 'ptx_final',
      type: 'REDEEM',
      amount: -1500,
      externalRef: 'pcr_1',
    })
  );
  expect(mockReleaseCashoutHold).toHaveBeenCalledWith('ptx_hold', 'prt_1');
  expect(mockDb.insertOne.mock.invocationCallOrder[0]).toBeLessThan(
    mockReleaseCashoutHold.mock.invocationCallOrder[0]
  );
  expect(mockCollections.partner_cashout_requests[0]).toMatchObject({
    status: 'delivered',
    finalRedeemTxnId: 'ptx_final',
  });
});

test('recovers an existing permanent redemption without duplicating it', async () => {
  seedRequest({ status: 'processing' });
  mockCollections.partner_credit_transactions.push({
    id: 'ptx_existing',
    partnerId: 'prt_1',
    type: 'REDEEM',
    externalRef: 'pcr_1',
  });

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_1')
    .send({ status: 'delivered', deliveryDetails: { last4: '1234' } });

  expect(response.status).toBe(200);
  expect(mockDb.insertOne).not.toHaveBeenCalled();
  expect(response.body.request.finalRedeemTxnId).toBe('ptx_existing');
});

test('fails closed when the permanent redemption cannot be stored', async () => {
  seedRequest({ status: 'processing' });
  mockDb.insertOne.mockResolvedValueOnce(null);

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_1')
    .send({ status: 'delivered', deliveryDetails: { code: 'voucher-code' } });

  expect(response.status).toBe(500);
  expect(response.body.code).toBe('CASHOUT_REDEEM_WRITE_FAILED');
  expect(mockReleaseCashoutHold).not.toHaveBeenCalled();
  expect(mockCollections.partner_cashout_requests[0].status).toBe('processing');
});

test('fails closed when the hold cannot be released after redemption', async () => {
  seedRequest({ status: 'processing' });
  mockReleaseCashoutHold.mockResolvedValueOnce(null);

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_1')
    .send({ status: 'delivered', deliveryDetails: { reference: 'amazon-456' } });

  expect(response.status).toBe(500);
  expect(response.body.code).toBe('CASHOUT_HOLD_RELEASE_FAILED');
  expect(mockCollections.partner_cashout_requests[0].status).toBe('processing');
});

test('releases held points when an administrator rejects a request', async () => {
  seedRequest();

  const response = await request(buildApp())
    .patch('/api/admin/cashout-requests/pcr_1')
    .send({ status: 'rejected', adminInternalNotes: 'Supplier activity was not genuine.' });

  expect(response.status).toBe(200);
  expect(mockReleaseCashoutHold).toHaveBeenCalledWith('ptx_hold', 'prt_1');
  expect(mockCollections.partner_cashout_requests[0].status).toBe('rejected');
});

test('only deletes terminal requests', async () => {
  seedRequest();
  const blocked = await request(buildApp()).delete('/api/admin/cashout-requests/pcr_1');
  expect(blocked.status).toBe(409);

  mockCollections.partner_cashout_requests[0].status = 'rejected';
  const deleted = await request(buildApp()).delete('/api/admin/cashout-requests/pcr_1');
  expect(deleted.status).toBe(200);
  expect(mockCollections.partner_cashout_requests).toHaveLength(0);
});
