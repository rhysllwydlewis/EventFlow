/**
 * Partner cashout integrity tests.
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../utils/postmark', () => ({ sendMail: jest.fn(), FROM_HELLO: 'hello@example.com' }));
jest.mock('../../services/notifyAdmins.service', () => ({
  notifyAdmins: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
jest.mock('../../middleware/rateLimits', () => ({ authLimiter: (_req, _res, next) => next() }));
jest.mock('../../middleware/validation', () => ({ passwordOk: jest.fn().mockReturnValue(true) }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn() }));
jest.mock('jsonwebtoken', () => ({ sign: jest.fn().mockReturnValue('token') }));
jest.mock('validator', () => ({ isEmail: jest.fn().mockReturnValue(true) }));

jest.mock('../../middleware/auth', () => ({
  JWT_SECRET: 'test-secret',
  setAuthCookie: jest.fn(),
  authRequired(req, res, next) {
    if (req.headers['x-test-role'] === 'none')
      return res.status(401).json({ error: 'Unauthorized' });
    req.user = {
      id: 'usr_partner_001',
      role: req.headers['x-test-role'] || 'partner',
      email: 'partner@example.com',
    };
    next();
  },
  roleRequired(role) {
    return (req, res, next) =>
      req.user?.role === role ? next() : res.status(403).json({ error: 'Forbidden' });
  },
}));

const mockPartnerService = {
  getPartnerByUserId: jest.fn(),
  getBalance: jest.fn(),
  createCashoutHold: jest.fn(),
  releaseCashoutHold: jest.fn(),
  POINTS_PER_GBP: 100,
  CREDIT_MATURITY_DAYS: 30,
  ATTRIBUTION_DAYS: 30,
  CREDIT_TYPES: {
    ADJUSTMENT: 'ADJUSTMENT',
    CASHOUT_RELEASE: 'CASHOUT_RELEASE',
  },
  getPendingPoints: jest.fn(),
  listReferralsByPartnerId: jest.fn(),
  getReviewQualifications: jest.fn(),
  maskReferralName: jest.fn(),
  getCodeHistory: jest.fn(),
  regenerateCode: jest.fn(),
  createPartner: jest.fn(),
};
jest.mock('../../services/partnerService', () => mockPartnerService);

const mockDb = {
  read: jest.fn().mockResolvedValue([]),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({ id: 'persisted' }),
  updateOne: jest.fn().mockResolvedValue({ modified: 1 }),
};
jest.mock('../../db-unified', () => mockDb);

let mockIdCounter = 0;
jest.mock('../../store', () => ({
  uid: prefix => `${prefix}_test_${++mockIdCounter}`,
  DATA_DIR: '/tmp/test-data',
}));

const router = require('../../routes/partner');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/partner', router);
  return app;
}

const ACTIVE_PARTNER = {
  id: 'prt_001',
  userId: 'usr_partner_001',
  refCode: 'p_TEST',
  status: 'active',
};
const DISABLED_PARTNER = { ...ACTIVE_PARTNER, status: 'disabled' };

function postCashout(app, key = 'cashout_test_key_001', amount = 15) {
  return request(app)
    .post('/api/partner/cashout-requests')
    .set('Idempotency-Key', key)
    .send({ method: 'amazon_voucher', denominationGbp: amount });
}

describe('POST /api/partner/cashout-requests', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    mockIdCounter = 0;
    mockPartnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    mockPartnerService.getBalance.mockResolvedValue({ availableBalance: 5000, transactions: [] });
    mockPartnerService.createCashoutHold.mockResolvedValue({ id: 'ptx_hold_001' });
    mockPartnerService.releaseCashoutHold.mockResolvedValue({ id: 'ptx_release_001' });
    mockDb.findOne.mockResolvedValue(null);
    mockDb.insertOne.mockResolvedValue({ id: 'persisted' });
  });

  it('requires authentication and the partner role', async () => {
    expect((await postCashout(app).set('x-test-role', 'none')).status).toBe(401);
    expect((await postCashout(app).set('x-test-role', 'customer')).status).toBe(403);
  });

  it('blocks disabled partners from financial data and actions', async () => {
    mockPartnerService.getPartnerByUserId.mockResolvedValue(DISABLED_PARTNER);
    const response = await postCashout(app);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ disabled: true, supportAvailable: true });
  });

  it('uses the current £15 default rather than stale £50 assumptions', async () => {
    const response = await postCashout(app, 'cashout_minimum_001', 15);
    expect(response.status).toBe(201);
    expect(mockPartnerService.createCashoutHold).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1500 })
    );
  });

  it('requires an idempotency key', async () => {
    const response = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 15 });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/idempotency/i);
  });

  it('does not create a request when the hold write fails', async () => {
    mockPartnerService.createCashoutHold.mockRejectedValue(new Error('ledger unavailable'));
    const response = await postCashout(app);
    expect(response.status).toBe(500);
    expect(mockDb.insertOne).not.toHaveBeenCalledWith(
      'partner_cashout_requests',
      expect.anything()
    );
  });

  it('releases a persisted hold when request insertion fails', async () => {
    mockDb.insertOne.mockResolvedValueOnce(null);
    const response = await postCashout(app);
    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/restored/i);
    expect(mockPartnerService.releaseCashoutHold).toHaveBeenCalledWith('ptx_hold_001', 'prt_001');
  });

  it('flags manual reconciliation when both request insertion and rollback fail', async () => {
    mockDb.insertOne.mockResolvedValueOnce(null);
    mockPartnerService.releaseCashoutHold.mockRejectedValue(new Error('rollback unavailable'));
    const response = await postCashout(app);
    expect(response.status).toBe(500);
    expect(response.body.reconciliationRequired).toBe(true);
    expect(response.body.reference).toMatch(/^pcr_/);
  });

  it('replays an existing request without creating another hold', async () => {
    mockDb.findOne.mockResolvedValue({
      id: 'pcr_existing',
      partnerId: 'prt_001',
      idempotencyKey: 'cashout_test_key_001',
      status: 'submitted',
    });
    const response = await postCashout(app);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      idempotentReplay: true,
      cashoutRequestId: 'pcr_existing',
    });
    expect(mockPartnerService.createCashoutHold).not.toHaveBeenCalled();
  });

  it('does not use maturing or already-held points', async () => {
    mockPartnerService.getBalance.mockResolvedValue({
      balance: 20000,
      availableBalance: 1000,
      maturingBalance: 19000,
      transactions: [],
    });
    const response = await postCashout(app);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/insufficient/i);
    expect(mockPartnerService.createCashoutHold).not.toHaveBeenCalled();
  });

  it('serialises concurrent requests for the same partner', async () => {
    let available = 2000;
    mockPartnerService.getBalance.mockImplementation(async () => ({
      availableBalance: available,
      transactions: [],
    }));
    mockPartnerService.createCashoutHold.mockImplementation(async ({ amount }) => {
      await new Promise(resolve => setTimeout(resolve, 10));
      available -= amount;
      return { id: `hold_${amount}` };
    });

    const [first, second] = await Promise.all([
      postCashout(app, 'cashout_concurrent_001', 15),
      postCashout(app, 'cashout_concurrent_002', 15),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 400]);
    expect(mockPartnerService.createCashoutHold).toHaveBeenCalledTimes(1);
  });
});
