'use strict';

const request = require('supertest');

const mockPartner = { id: 'partner_1', userId: 'user_1', status: 'active' };
const mockCashout = {
  id: 'cashout_1',
  partnerId: 'partner_1',
  partnerUserId: 'user_1',
  denominationGbp: 50,
  status: 'submitted',
};

const mockStrictStore = {
  findOne: jest.fn(async (collection, query) => {
    if (collection === 'partners' && query.userId === 'user_1') return mockPartner;
    if (collection === 'partner_cashout_requests' && query.id === 'cashout_1') return mockCashout;
    return null;
  }),
  findWithOptions: jest.fn(async () => []),
  count: jest.fn(async () => 0),
  updateOne: jest.fn(async () => true),
};

const mockAcquire = jest.fn(async scope => ({
  id: `partner-cashout:${scope}`,
  ownerToken: 'owner_1',
  leaseMs: 180000,
}));
const mockRenew = jest.fn(async () => true);
const mockRelease = jest.fn(async () => true);

const mockOps = {
  submissionDecision: jest.fn(async () => ({ allowed: true, limits: {} })),
  approvalDecision: jest.fn(async () => ({
    allowed: true,
    identity: { eligible: true },
    limits: {},
    reconciliation: { ok: true },
  })),
  identityDecision: jest.fn(async () => ({ eligible: true })),
  reconcileRequest: jest.fn(async () => ({ ok: true, issues: [] })),
  getControls: jest.fn(async () => ({ programmePaused: false, cashoutsPaused: false })),
  pauseDecision: jest.fn(() => ({ blocked: false })),
  recordOpsEvent: jest.fn(async input => ({ id: 'event_1', ...input })),
  getConfig: jest.fn(() => ({ highValueReviewGbp: 100 })),
  setControls: jest.fn(),
  setIdentityReview: jest.fn(),
  evaluateLimits: jest.fn(async () => ({
    allowed: true,
    requiresManualReview: false,
    reviewReasons: [],
    config: { highValueReviewGbp: 100 },
  })),
};

const mockAntiAbuse = {
  assessCashout: jest.fn(async input => ({
    id: 'assessment_1',
    partnerId: input.partnerId,
    requestId: input.requestId,
    score: 0,
    riskLevel: 'low',
    requiresManualReview: false,
    blockApproval: false,
    signals: [],
  })),
};
const mockNotifyAdmins = jest.fn(async () => true);
const mockCsrf = jest.fn((_req, _res, next) => next());
const mockLegacyPartner = jest.fn((_req, res) => res.status(201).json({ ok: true }));
const mockLegacyAdmin = jest.fn((req, res) => res.json({ ok: true, status: req.body.status }));
const mockLegacyDelete = jest.fn((_req, res) => res.json({ ok: true }));

jest.mock('../../services/partnerCashoutStrictStore', () => mockStrictStore);
jest.mock('../../services/partnerCashoutOperationLockService', () => ({
  acquire: mockAcquire,
  renew: mockRenew,
  release: mockRelease,
}));
jest.mock('../../services/partnerCashoutOperationsService', () => mockOps);
jest.mock('../../services/partnerAntiAbuseService', () => mockAntiAbuse);
jest.mock('../../services/notifyAdmins.service', () => ({ notifyAdmins: mockNotifyAdmins }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: mockCsrf }));
jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = req.user || { id: 'user_1', role: 'partner', email: 'partner@example.com' };
    next();
  },
  roleRequired: role => (req, _res, next) => {
    if (role === 'partner') {
      req.user = { id: 'user_1', role: 'partner', email: 'partner@example.com' };
    }
    next();
  },
}));

jest.mock('../../routes/partner', () => {
  const express = require('express');
  const router = express.Router();
  router.post('/cashout-requests', mockLegacyPartner);
  return router;
});

jest.mock('../../routes/admin-cashout-requests', () => {
  const express = require('express');
  const router = express.Router();
  router.use((req, _res, next) => {
    req.user = { id: 'admin_1', role: 'admin', email: 'admin@example.com' };
    next();
  });
  router.patch('/:id', mockLegacyAdmin);
  router.delete('/:id', mockLegacyDelete);
  return router;
});

const partnerRouter = require('../../routes/partner');
const adminRouter = require('../../routes/admin-cashout-requests');
const operationsRuntime = require('../../services/partnerCashoutOperationsRuntime');
const lockRuntime = require('../../services/partnerCashoutLockRuntime');

beforeAll(() => {
  // This is the production bootstrap order. Because both runtimes splice before the
  // first matching route, installing policy first makes the later lock insertion the
  // outermost guard: lock -> policy -> legacy handler.
  operationsRuntime.install();
  lockRuntime.install();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockStrictStore.findOne.mockImplementation(async (collection, query) => {
    if (collection === 'partners' && query.userId === 'user_1') return mockPartner;
    if (collection === 'partner_cashout_requests' && query.id === 'cashout_1') return mockCashout;
    return null;
  });
  mockAcquire.mockImplementation(async scope => ({
    id: `partner-cashout:${scope}`,
    ownerToken: 'owner_1',
    leaseMs: 180000,
  }));
  mockRenew.mockResolvedValue(true);
  mockRelease.mockResolvedValue(true);
  mockOps.submissionDecision.mockResolvedValue({ allowed: true, limits: {} });
  mockOps.getControls.mockResolvedValue({ programmePaused: false, cashoutsPaused: false });
  mockOps.pauseDecision.mockReturnValue({ blocked: false });
  mockOps.approvalDecision.mockResolvedValue({
    allowed: true,
    identity: { eligible: true },
    limits: {},
    reconciliation: { ok: true },
  });
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

test('partner submission executes CSRF then distributed lock then PR3 policy then legacy handler', async () => {
  const response = await request(partnerApp())
    .post('/api/partner/cashout-requests')
    .send({ denominationGbp: 50 });

  expect(response.status).toBe(201);
  expect(mockCsrf).toHaveBeenCalled();
  expect(mockAcquire).toHaveBeenCalledWith('partner:partner_1', 180000);
  expect(mockOps.submissionDecision).toHaveBeenCalled();
  expect(mockLegacyPartner).toHaveBeenCalled();

  expect(mockCsrf.mock.invocationCallOrder[0]).toBeLessThan(
    mockAcquire.mock.invocationCallOrder[0]
  );
  expect(mockAcquire.mock.invocationCallOrder[0]).toBeLessThan(
    mockOps.submissionDecision.mock.invocationCallOrder[0]
  );
  expect(mockOps.submissionDecision.mock.invocationCallOrder[0]).toBeLessThan(
    mockLegacyPartner.mock.invocationCallOrder[0]
  );
});

test('admin approval executes CSRF then request lock then PR3 approval policy then legacy handler', async () => {
  const response = await request(adminApp())
    .patch('/api/admin/cashout-requests/cashout_1')
    .send({ status: 'approved', adminInternalNotes: 'Reviewed cashout evidence and identity.' });

  expect(response.status).toBe(200);
  expect(mockAcquire).toHaveBeenCalledWith('request:cashout_1', 180000);
  expect(mockOps.approvalDecision).toHaveBeenCalledWith(mockCashout);
  expect(mockLegacyAdmin).toHaveBeenCalled();

  expect(mockCsrf.mock.invocationCallOrder[0]).toBeLessThan(
    mockAcquire.mock.invocationCallOrder[0]
  );
  expect(mockAcquire.mock.invocationCallOrder[0]).toBeLessThan(
    mockOps.approvalDecision.mock.invocationCallOrder[0]
  );
  expect(mockOps.approvalDecision.mock.invocationCallOrder[0]).toBeLessThan(
    mockLegacyAdmin.mock.invocationCallOrder[0]
  );
});

test('a busy distributed lock prevents the policy and legacy submission handlers from running', async () => {
  mockAcquire.mockResolvedValueOnce(null);

  const response = await request(partnerApp())
    .post('/api/partner/cashout-requests')
    .send({ denominationGbp: 50 });

  expect(response.status).toBe(409);
  expect(response.body.code).toBe('PARTNER_CASHOUT_OPERATION_BUSY');
  expect(mockOps.submissionDecision).not.toHaveBeenCalled();
  expect(mockLegacyPartner).not.toHaveBeenCalled();
});

test('audit retention guard prevents the legacy delete handler from physically removing a cashout', async () => {
  const response = await request(adminApp()).delete('/api/admin/cashout-requests/cashout_1');

  expect(response.status).toBe(409);
  expect(response.body.code).toBe('PARTNER_CASHOUT_AUDIT_RETENTION_REQUIRED');
  expect(mockLegacyDelete).not.toHaveBeenCalled();
});
