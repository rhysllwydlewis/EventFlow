'use strict';

const request = require('supertest');

const mockBaseAssessCashout = jest.fn(async input => ({
  id: 'assessment_1',
  partnerId: input.partnerId,
  requestId: input.requestId,
  score: 0,
  riskLevel: 'low',
  requiresManualReview: false,
  blockApproval: false,
  signals: [],
}));
const mockAntiAbuse = { assessCashout: mockBaseAssessCashout };
const mockOps = {
  submissionDecision: jest.fn(async () => ({
    allowed: true,
    limits: { requiresManualReview: false, reviewReasons: [] },
  })),
  approvalDecision: jest.fn(async () => ({
    allowed: true,
    reconciliation: { ok: true },
    limits: { requiresManualReview: false, reviewReasons: [] },
  })),
  identityDecision: jest.fn(async () => ({ eligible: true })),
  reconcileRequest: jest.fn(async () => ({
    ok: true,
    issues: [],
    recoveryState: 'none',
    reconciledAt: new Date().toISOString(),
  })),
  getControls: jest.fn(async () => ({ programmePaused: false, cashoutsPaused: false })),
  pauseDecision: jest.fn(() => ({ blocked: false })),
  recordOpsEvent: jest.fn(async input => ({ id: 'event_1', ...input })),
  setControls: jest.fn(async input => ({
    id: 'partner_cashout_controls',
    programmePaused: false,
    cashoutsPaused: Boolean(input.cashoutsPaused),
    reason: input.reason,
  })),
  setIdentityReview: jest.fn(async input => ({
    id: input.partnerId,
    cashoutIdentityStatus: input.status,
    cashoutIdentityReviewedAt: new Date().toISOString(),
  })),
  evaluateLimits: jest.fn(async () => ({
    allowed: true,
    requiresManualReview: false,
    reviewReasons: [],
    config: { highValueReviewGbp: 100 },
  })),
  getConfig: jest.fn(() => ({ maxSingleCashoutGbp: 500 })),
};

const partnerRecord = { id: 'partner_1', userId: 'user_1', status: 'active' };
const cashoutRequest = {
  id: 'cashout_1',
  partnerId: 'partner_1',
  partnerUserId: 'user_1',
  denominationGbp: 50,
  status: 'submitted',
};

const mockStrictStore = {
  findOne: jest.fn(async (collection, query) => {
    if (collection === 'partners' && query.userId === 'user_1') return partnerRecord;
    if (collection === 'partner_cashout_requests' && query.id === 'cashout_1')
      return cashoutRequest;
    return null;
  }),
  findWithOptions: jest.fn(async () => []),
  count: jest.fn(async () => 0),
  updateOne: jest.fn(async () => true),
};
const mockNotifyAdmins = jest.fn(async () => true);

jest.mock('../../services/partnerCashoutStrictStore', () => mockStrictStore);
jest.mock('../../services/partnerAntiAbuseService', () => mockAntiAbuse);
jest.mock('../../services/partnerCashoutOperationsService', () => mockOps);
jest.mock('../../services/notifyAdmins.service', () => ({ notifyAdmins: mockNotifyAdmins }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = req.user || { id: 'user_1', role: 'partner', email: 'partner@example.com' };
    next();
  },
  roleRequired: role => (req, _res, next) => {
    req.user = {
      id: role === 'admin' ? 'admin_1' : 'user_1',
      role,
      email: `${role}@example.com`,
    };
    next();
  },
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));

const mockLegacyPartnerPost = jest.fn((_req, res) =>
  res.status(201).json({ ok: true, legacy: true })
);
const mockLegacyAdminPatch = jest.fn((req, res) =>
  res.json({ ok: true, legacy: true, status: req.body.status })
);

jest.mock('../../routes/partner', () => {
  const express = require('express');
  const router = express.Router();
  router.post('/cashout-requests', mockLegacyPartnerPost);
  return router;
});

jest.mock('../../routes/admin-cashout-requests', () => {
  const express = require('express');
  const router = express.Router();
  router.use((req, _res, next) => {
    req.user = { id: 'admin_1', role: 'admin', email: 'admin@example.com' };
    next();
  });
  router.patch('/:id', mockLegacyAdminPatch);
  return router;
});

const partnerRouter = require('../../routes/partner');
const adminRouter = require('../../routes/admin-cashout-requests');
const runtime = require('../../services/partnerCashoutOperationsRuntime');

beforeAll(() => runtime.install());

beforeEach(() => {
  jest.clearAllMocks();
  cashoutRequest.status = 'submitted';
  cashoutRequest.denominationGbp = 50;
  mockBaseAssessCashout.mockResolvedValue({
    id: 'assessment_1',
    partnerId: 'partner_1',
    requestId: 'cashout_1',
    score: 0,
    riskLevel: 'low',
    requiresManualReview: false,
    blockApproval: false,
    signals: [],
  });
  mockOps.submissionDecision.mockResolvedValue({
    allowed: true,
    limits: { requiresManualReview: false, reviewReasons: [] },
  });
  mockOps.approvalDecision.mockResolvedValue({
    allowed: true,
    reconciliation: { ok: true },
    limits: { requiresManualReview: false, reviewReasons: [] },
  });
  mockOps.identityDecision.mockResolvedValue({ eligible: true });
  mockOps.reconcileRequest.mockResolvedValue({
    ok: true,
    issues: [],
    recoveryState: 'none',
    reconciledAt: new Date().toISOString(),
  });
  mockOps.getControls.mockResolvedValue({ programmePaused: false, cashoutsPaused: false });
  mockOps.pauseDecision.mockReturnValue({ blocked: false });
  mockOps.evaluateLimits.mockResolvedValue({
    allowed: true,
    requiresManualReview: false,
    reviewReasons: [],
    config: { highValueReviewGbp: 100 },
  });
  mockStrictStore.findOne.mockImplementation(async (collection, query) => {
    if (collection === 'partners' && query.userId === 'user_1') return partnerRecord;
    if (collection === 'partner_cashout_requests' && query.id === 'cashout_1')
      return cashoutRequest;
    return null;
  });
  mockStrictStore.findWithOptions.mockResolvedValue([]);
  mockStrictStore.count.mockResolvedValue(0);
  mockStrictStore.updateOne.mockResolvedValue(true);
});

function partnerApp() {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/partner', partnerRouter);
  return app;
}

function adminApp() {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/admin/cashout-requests', adminRouter);
  return app;
}

test('submission policy guard blocks before the legacy cashout handler runs', async () => {
  mockOps.submissionDecision.mockResolvedValueOnce({
    allowed: false,
    reason: 'PARTNER_CASHOUT_FIRST_LIMIT',
    message: 'First cashout exceeds the launch-safety limit.',
    limits: { violations: [{ code: 'PARTNER_CASHOUT_FIRST_LIMIT' }] },
  });

  const response = await request(partnerApp())
    .post('/api/partner/cashout-requests')
    .send({ denominationGbp: 500 });

  expect(response.status).toBe(409);
  expect(response.body.code).toBe('PARTNER_CASHOUT_FIRST_LIMIT');
  expect(mockLegacyPartnerPost).not.toHaveBeenCalled();
});

test('missing partner cannot bypass the policy layer into the legacy cashout handler', async () => {
  mockStrictStore.findOne.mockResolvedValueOnce(null);
  const response = await request(partnerApp())
    .post('/api/partner/cashout-requests')
    .send({ denominationGbp: 50 });

  expect(response.status).toBe(403);
  expect(response.body.code).toBe('PARTNER_NOT_FOUND');
  expect(mockLegacyPartnerPost).not.toHaveBeenCalled();
});

test('authoritative partner lookup failure fails closed before the legacy cashout handler', async () => {
  mockStrictStore.findOne.mockRejectedValueOnce(
    Object.assign(new Error('Mongo read failed'), { code: 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE' })
  );
  const response = await request(partnerApp())
    .post('/api/partner/cashout-requests')
    .send({ denominationGbp: 50 });

  expect(response.status).toBe(503);
  expect(response.body.code).toBe('PARTNER_CASHOUT_STORAGE_UNAVAILABLE');
  expect(mockLegacyPartnerPost).not.toHaveBeenCalled();
});

test('allowed submission reaches the existing cashout implementation', async () => {
  const response = await request(partnerApp())
    .post('/api/partner/cashout-requests')
    .send({ denominationGbp: 50 });

  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ ok: true, legacy: true });
  expect(mockLegacyPartnerPost).toHaveBeenCalledTimes(1);
});

test('approval policy guard blocks before the legacy admin transition handler', async () => {
  mockOps.approvalDecision.mockResolvedValueOnce({
    allowed: false,
    reason: 'PARTNER_CASHOUT_IDENTITY_REVIEW_REQUIRED',
    identity: { eligible: false, reason: 'PARTNER_CASHOUT_IDENTITY_REVIEW_REQUIRED' },
    reconciliation: { ok: true },
  });

  const response = await request(adminApp())
    .patch('/api/admin/cashout-requests/cashout_1')
    .send({ status: 'approved', adminInternalNotes: 'Reviewed all relevant cashout records.' });

  expect(response.status).toBe(409);
  expect(response.body.code).toBe('PARTNER_CASHOUT_IDENTITY_REVIEW_REQUIRED');
  expect(mockLegacyAdminPatch).not.toHaveBeenCalled();
  expect(mockOps.recordOpsEvent).toHaveBeenCalledWith(
    expect.objectContaining({ phase: 'requested' })
  );
});

test('processing fails before ledger mutation when reconciliation is invalid', async () => {
  mockOps.reconcileRequest.mockResolvedValueOnce({
    ok: false,
    issues: [{ code: 'CASHOUT_HOLD_ALREADY_RELEASED' }],
  });
  const response = await request(adminApp())
    .patch('/api/admin/cashout-requests/cashout_1')
    .send({ status: 'processing' });

  expect(response.status).toBe(409);
  expect(response.body.code).toBe('PARTNER_CASHOUT_RECONCILIATION_FAILED');
  expect(mockOps.reconcileRequest).toHaveBeenCalledWith(cashoutRequest, {
    targetStatus: 'processing',
  });
  expect(mockLegacyAdminPatch).not.toHaveBeenCalled();
});

test('delivery passes target status into recovery-aware reconciliation', async () => {
  cashoutRequest.status = 'processing';
  const response = await request(adminApp())
    .patch('/api/admin/cashout-requests/cashout_1')
    .send({ status: 'delivered' });

  expect(response.status).toBe(200);
  expect(mockOps.reconcileRequest).toHaveBeenCalledWith(cashoutRequest, {
    targetStatus: 'delivered',
  });
  expect(mockLegacyAdminPatch).toHaveBeenCalledTimes(1);
});

test('rejection remains available while emergency cashout pause is active', async () => {
  mockOps.getControls.mockResolvedValueOnce({ programmePaused: false, cashoutsPaused: true });
  mockOps.pauseDecision.mockReturnValueOnce({
    blocked: true,
    code: 'PARTNER_CASHOUTS_PAUSED',
  });

  const response = await request(adminApp())
    .patch('/api/admin/cashout-requests/cashout_1')
    .send({ status: 'rejected', adminInternalNotes: 'Rejected after manual fraud review.' });

  expect(response.status).toBe(200);
  expect(response.body.status).toBe('rejected');
  expect(mockLegacyAdminPatch).toHaveBeenCalledTimes(1);
});

test('admin can pause cashouts through the operations control endpoint', async () => {
  const response = await request(adminApp())
    .patch('/api/admin/cashout-requests/ops/controls')
    .send({ cashoutsPaused: true, reason: 'Suspicious activity requires a reconciliation pause.' });

  expect(response.status).toBe(200);
  expect(mockOps.setControls).toHaveBeenCalledWith(
    expect.objectContaining({ cashoutsPaused: true, adminUserId: 'admin_1' })
  );
  expect(mockOps.recordOpsEvent).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'cashout_controls_change', phase: 'requested' })
  );
});

test('admin identity review endpoint records a reasoned verification decision', async () => {
  const response = await request(adminApp())
    .patch('/api/admin/cashout-requests/ops/identity/partner_1')
    .send({
      status: 'verified',
      reason: 'Partner identity and business records manually checked.',
    });

  expect(response.status).toBe(200);
  expect(mockOps.setIdentityReview).toHaveBeenCalledWith(
    expect.objectContaining({
      partnerId: 'partner_1',
      status: 'verified',
      adminUserId: 'admin_1',
    })
  );
});

test('manual reconciliation endpoint persists the current ledger result and target state', async () => {
  const response = await request(adminApp())
    .post('/api/admin/cashout-requests/ops/reconcile/cashout_1')
    .send({ reason: 'Manual reconciliation before delivery.', targetStatus: 'delivered' });

  expect(response.status).toBe(200);
  expect(mockOps.reconcileRequest).toHaveBeenCalledWith(cashoutRequest, {
    targetStatus: 'delivered',
  });
  expect(mockStrictStore.updateOne).toHaveBeenCalledWith(
    'partner_cashout_requests',
    { id: 'cashout_1' },
    expect.objectContaining({
      $set: expect.objectContaining({
        reconciliationStatus: 'ok',
        reconciliationRecoveryState: 'none',
      }),
    })
  );
});

test('operations event listing uses bounded authoritative pagination instead of reading the entire collection', async () => {
  mockStrictStore.findWithOptions.mockResolvedValueOnce([
    { id: 'event_1', partnerId: 'partner_1' },
  ]);
  mockStrictStore.count.mockResolvedValueOnce(1);

  const response = await request(adminApp()).get(
    '/api/admin/cashout-requests/ops/events?partnerId=partner_1&limit=25&page=1'
  );

  expect(response.status).toBe(200);
  expect(mockStrictStore.findWithOptions).toHaveBeenCalledWith(
    'partner_cashout_ops_events',
    { partnerId: 'partner_1' },
    { limit: 25, skip: 0, sort: { createdAt: -1 } }
  );
  expect(mockStrictStore.count).toHaveBeenCalledWith('partner_cashout_ops_events', {
    partnerId: 'partner_1',
  });
});

test('high-value cashout augments the existing fraud assessment with manual-review evidence', async () => {
  mockOps.evaluateLimits.mockResolvedValueOnce({
    allowed: true,
    requiresManualReview: true,
    reviewReasons: ['HIGH_VALUE_CASHOUT'],
    config: { highValueReviewGbp: 100 },
  });
  cashoutRequest.denominationGbp = 150;

  const assessment = await mockAntiAbuse.assessCashout({
    partnerId: 'partner_1',
    requestId: 'cashout_1',
  });

  expect(assessment.requiresManualReview).toBe(true);
  expect(assessment.signals.map(signal => signal.code)).toContain('HIGH_VALUE_CASHOUT');
});

test('repeated high-risk assessment does not spam administrators once persisted high risk exists', async () => {
  mockBaseAssessCashout.mockResolvedValueOnce({
    id: 'assessment_1',
    partnerId: 'partner_1',
    requestId: 'cashout_1',
    score: 90,
    riskLevel: 'high',
    requiresManualReview: true,
    blockApproval: true,
    signals: [],
  });
  mockStrictStore.findOne.mockImplementation(async (collection, query) => {
    if (collection === 'partners' && query.userId === 'user_1') return partnerRecord;
    if (collection === 'partner_cashout_requests' && query.id === 'cashout_1')
      return cashoutRequest;
    if (collection === 'partner_fraud_assessments' && query.requestId === 'cashout_1') {
      return { requestId: 'cashout_1', riskLevel: 'high', blockApproval: true };
    }
    return null;
  });

  await mockAntiAbuse.assessCashout({ partnerId: 'partner_1', requestId: 'cashout_1' });
  expect(mockNotifyAdmins).not.toHaveBeenCalled();
});
