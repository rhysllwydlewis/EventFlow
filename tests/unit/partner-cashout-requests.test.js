/**
 * Unit tests for partner cashout request endpoints.
 *
 * Tests:
 *   POST /api/partner/cashout-requests
 *     - Auth / role enforcement
 *     - Disabled partner blocked
 *     - Invalid method rejected
 *     - Invalid / disallowed denomination rejected
 *     - Insufficient availableBalance rejected
 *     - Valid request creates hold txn and persists record
 *     - Returns 201 with cashoutRequestId
 *
 *   GET /api/partner/cashout-requests
 *     - Auth / role enforcement
 *     - Returns own requests only
 *     - Disabled partner blocked
 *
 *   GET /api/partner/cashout-requests/:id
 *     - Returns 404 when not found or belongs to another partner
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../utils/postmark', () => ({
  sendEmail: jest.fn().mockResolvedValue({ MessageID: 'mock-id' }),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  authLimiter: (_req, _res, next) => next(),
  writeLimiter: (_req, _res, next) => next(),
}));

jest.mock('../../middleware/auth', () => {
  const JWT_SECRET = 'test-secret';
  function authRequired(req, res, next) {
    const role = req.headers['x-test-role'];
    if (role === 'none') return res.status(401).json({ error: 'Unauthorized' });
    req.user = {
      id: req.headers['x-test-user-id'] || 'usr_partner_001',
      role: role || 'partner',
      email: 'partner@example.com',
      name: 'Test Partner',
    };
    next();
  }
  function roleRequired(requiredRole) {
    return (req, res, next) => {
      if (!req.user || req.user.role !== requiredRole) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    };
  }
  return { JWT_SECRET, authRequired, roleRequired, setAuthCookie: jest.fn() };
});

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('token'),
  verify: jest
    .fn()
    .mockImplementation((token, secret, cb) =>
      cb(null, { id: 'usr_partner_001', role: 'partner' })
    ),
}));
jest.mock('validator', () => ({
  isEmail: jest.fn().mockReturnValue(true),
  normalizeEmail: jest.fn(e => e),
  escape: jest.fn(s => s),
  isLength: jest.fn().mockReturnValue(true),
  trim: jest.fn(s => s),
  default: { isEmail: jest.fn().mockReturnValue(true) },
}));
jest.mock('../../middleware/validation', () => ({
  passwordOk: jest.fn().mockReturnValue(true),
}));

jest.mock('../../services/tremendousService', () => ({
  getTremendousService: jest.fn(() => ({
    listProducts: jest.fn().mockResolvedValue([]),
    createOrder: jest.fn().mockResolvedValue({ id: 'ord_001' }),
    getOrder: jest.fn().mockResolvedValue({ id: 'ord_001', status: 'EXECUTED', rewards: [] }),
    resendReward: jest.fn().mockResolvedValue({}),
  })),
}));

const mockPartnerService = {
  getPartnerByUserId: jest.fn(),
  getBalance: jest.fn(),
  createCashoutHold: jest.fn(),
  releaseCashoutHold: jest.fn(),
  debitPoints: jest.fn(),
  reverseDebit: jest.fn(),
  POINTS_PER_GBP: 100,
  CREDIT_TYPES: {
    PACKAGE_BONUS: 'PACKAGE_BONUS',
    SUBSCRIPTION_BONUS: 'SUBSCRIPTION_BONUS',
    REFERRAL_SIGNUP_BONUS: 'REFERRAL_SIGNUP_BONUS',
    FIRST_REVIEW_BONUS: 'FIRST_REVIEW_BONUS',
    PROFILE_APPROVED_BONUS: 'PROFILE_APPROVED_BONUS',
    ADJUSTMENT: 'ADJUSTMENT',
    REDEEM: 'REDEEM',
    CASHOUT_HOLD: 'CASHOUT_HOLD',
    CASHOUT_RELEASE: 'CASHOUT_RELEASE',
  },
  listReferralsByPartnerId: jest.fn().mockResolvedValue([]),
  maskReferralName: jest.fn(name => (name ? `${name[0]}***` : 'S***r')),
  getCodeHistory: jest.fn().mockResolvedValue([]),
  getPendingPoints: jest.fn().mockResolvedValue({ totalPending: 0 }),
  getPartnerByAnyRefCode: jest.fn().mockResolvedValue(null),
  regenerateCode: jest.fn(),
  createPartner: jest.fn(),
};

jest.mock('../../services/partnerService', () => mockPartnerService);

const mockDb = {
  read: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({ id: 'pcr_test_001' }),
  updateOne: jest.fn().mockResolvedValue({ modified: 1 }),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../store', () => ({
  uid: (prefix = 'id') => `${prefix}_test_${Date.now()}`,
  DATA_DIR: '/tmp/test-data',
}));

// ─── App setup ────────────────────────────────────────────────────────────────

const partnerRouter = require('../../routes/partner');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/partner', partnerRouter);
  return app;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ACTIVE_PARTNER = {
  id: 'prt_001',
  userId: 'usr_partner_001',
  refCode: 'p_TEST01',
  status: 'active',
};

const DISABLED_PARTNER = { ...ACTIVE_PARTNER, status: 'disabled' };

const VALID_BALANCE = {
  balance: 10000,
  availableBalance: 10000,
  maturingBalance: 0,
  totalEarned: 10000,
  redeemed: 0,
};

const INSUFFICIENT_BALANCE = {
  balance: 2000,
  availableBalance: 2000, // = £20, below £50 minimum
  maturingBalance: 0,
  totalEarned: 2000,
  redeemed: 0,
};

// ─── POST /api/partner/cashout-requests ──────────────────────────────────────

describe('POST /api/partner/cashout-requests — auth & role', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    mockPartnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    mockPartnerService.getBalance.mockResolvedValue(VALID_BALANCE);
    mockPartnerService.createCashoutHold.mockResolvedValue({ id: 'ptx_hold_001' });
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .set('x-test-role', 'none')
      .send({ method: 'amazon_voucher', denominationGbp: 50 });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-partner role', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .set('x-test-role', 'customer')
      .send({ method: 'amazon_voucher', denominationGbp: 50 });
    expect(res.status).toBe(403);
  });

  it('returns 403 for disabled partner', async () => {
    mockPartnerService.getPartnerByUserId.mockResolvedValue(DISABLED_PARTNER);
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 50 });
    expect(res.status).toBe(403);
    expect(res.body.disabled).toBe(true);
  });
});

describe('POST /api/partner/cashout-requests — method validation', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    mockPartnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    mockPartnerService.getBalance.mockResolvedValue(VALID_BALANCE);
    mockPartnerService.createCashoutHold.mockResolvedValue({ id: 'ptx_hold_001' });
  });

  it('returns 400 when method is missing', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ denominationGbp: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/method/i);
  });

  it('returns 400 when method is invalid', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'bitcoin', denominationGbp: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/method/i);
  });

  it('accepts amazon_voucher as a valid method', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 50 });
    expect(res.status).toBe(201);
  });

  it('accepts prepaid_debit_card as a valid method', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'prepaid_debit_card', denominationGbp: 50 });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/partner/cashout-requests — denomination validation', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    mockPartnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    mockPartnerService.getBalance.mockResolvedValue(VALID_BALANCE);
    mockPartnerService.createCashoutHold.mockResolvedValue({ id: 'ptx_hold_001' });
  });

  it('returns 400 when denominationGbp is missing', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/denomination/i);
  });

  it('returns 400 when denominationGbp is not an integer', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 52.5 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for denomination below minimum (£49)', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 49 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for denomination not in £5 increment (£51)', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 51 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for denomination not in £5 increment (£53)', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 53 });
    expect(res.status).toBe(400);
  });

  it('returns 201 for exactly £50', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 50 });
    expect(res.status).toBe(201);
  });

  it('returns 201 for £55 (£5 increment)', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 55 });
    expect(res.status).toBe(201);
  });

  it('returns 201 for £100', async () => {
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'prepaid_debit_card', denominationGbp: 100 });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/partner/cashout-requests — balance enforcement', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    mockPartnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    mockPartnerService.createCashoutHold.mockResolvedValue({ id: 'ptx_hold_001' });
  });

  it('returns 400 when availableBalance < required points', async () => {
    // £50 requires 5000 points but partner has only 2000 available
    mockPartnerService.getBalance.mockResolvedValue(INSUFFICIENT_BALANCE);
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient/i);
    expect(res.body.requiredPoints).toBe(5000);
    expect(res.body.availablePoints).toBe(2000);
  });

  it('does NOT create a hold when balance is insufficient', async () => {
    mockPartnerService.getBalance.mockResolvedValue(INSUFFICIENT_BALANCE);
    await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 50 });
    expect(mockPartnerService.createCashoutHold).not.toHaveBeenCalled();
  });

  it('creates a CASHOUT_HOLD when balance is sufficient', async () => {
    mockPartnerService.getBalance.mockResolvedValue(VALID_BALANCE);
    await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 50 });
    expect(mockPartnerService.createCashoutHold).toHaveBeenCalledWith(
      expect.objectContaining({ partnerId: ACTIVE_PARTNER.id, amount: 5000 })
    );
  });

  it('persists cashout request to DB on success', async () => {
    mockPartnerService.getBalance.mockResolvedValue(VALID_BALANCE);
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 50 });
    expect(res.status).toBe(201);
    expect(mockDb.insertOne).toHaveBeenCalledWith(
      'partner_cashout_requests',
      expect.objectContaining({
        method: 'amazon_voucher',
        denominationGbp: 50,
        pointsHeld: 5000,
        status: 'submitted',
        holdTxnId: 'ptx_hold_001',
      })
    );
  });

  it('returns cashoutRequestId in response', async () => {
    mockPartnerService.getBalance.mockResolvedValue(VALID_BALANCE);
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 50 });
    expect(res.status).toBe(201);
    expect(typeof res.body.cashoutRequestId).toBe('string');
    expect(res.body.ok).toBe(true);
  });

  it('includes 3-5 working days message in response', async () => {
    mockPartnerService.getBalance.mockResolvedValue(VALID_BALANCE);
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 50 });
    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/3.{1,5}5 working days/i);
  });

  it('uses availableBalance (not total balance) for enforcement', async () => {
    // total balance 20000 but availableBalance only 2000 (rest is maturing)
    mockPartnerService.getBalance.mockResolvedValue({
      ...INSUFFICIENT_BALANCE,
      balance: 20000,
      availableBalance: 2000,
    });
    const res = await request(app)
      .post('/api/partner/cashout-requests')
      .send({ method: 'amazon_voucher', denominationGbp: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient/i);
  });
});

// ─── GET /api/partner/cashout-requests ───────────────────────────────────────

describe('GET /api/partner/cashout-requests', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    mockPartnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .get('/api/partner/cashout-requests')
      .set('x-test-role', 'none');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-partner role', async () => {
    const res = await request(app)
      .get('/api/partner/cashout-requests')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(403);
  });

  it('returns 403 for disabled partner', async () => {
    mockPartnerService.getPartnerByUserId.mockResolvedValue(DISABLED_PARTNER);
    const res = await request(app).get('/api/partner/cashout-requests');
    expect(res.status).toBe(403);
    expect(res.body.disabled).toBe(true);
  });

  it("returns only the current partner's requests", async () => {
    mockDb.read.mockResolvedValue([
      { id: 'pcr_001', partnerId: 'prt_001', status: 'submitted', createdAt: new Date().toISOString() },
      { id: 'pcr_002', partnerId: 'prt_OTHER', status: 'submitted', createdAt: new Date().toISOString() },
    ]);
    const res = await request(app).get('/api/partner/cashout-requests');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe('pcr_001');
  });

  it('returns 200 with empty list when no requests exist', async () => {
    mockDb.read.mockResolvedValue([]);
    const res = await request(app).get('/api/partner/cashout-requests');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});

// ─── GET /api/partner/cashout-requests/:id ───────────────────────────────────

describe('GET /api/partner/cashout-requests/:id', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    mockPartnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
  });

  it('returns 404 when request does not exist', async () => {
    mockDb.read.mockResolvedValue([]);
    const res = await request(app).get('/api/partner/cashout-requests/pcr_nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 404 when request belongs to another partner', async () => {
    mockDb.read.mockResolvedValue([
      { id: 'pcr_other', partnerId: 'prt_OTHER', status: 'submitted', createdAt: new Date().toISOString() },
    ]);
    const res = await request(app).get('/api/partner/cashout-requests/pcr_other');
    expect(res.status).toBe(404);
  });

  it('returns 200 with request when it belongs to the current partner', async () => {
    const mockRequest = { id: 'pcr_mine', partnerId: 'prt_001', status: 'submitted', createdAt: new Date().toISOString() };
    mockDb.read.mockResolvedValue([mockRequest]);
    const res = await request(app).get('/api/partner/cashout-requests/pcr_mine');
    expect(res.status).toBe(200);
    expect(res.body.request.id).toBe('pcr_mine');
  });
});
