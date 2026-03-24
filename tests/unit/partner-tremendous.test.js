/**
 * Unit tests for the partner Tremendous gift card endpoints.
 *
 * Covers:
 *   GET  /api/partner/tremendous/products
 *   POST /api/partner/tremendous/orders
 *   GET  /api/partner/tremendous/orders/:id
 *   POST /api/partner/tremendous/orders/:id/resend
 *
 * For each endpoint verifies:
 *   - 401 when unauthenticated
 *   - 403 when authenticated as supplier, customer, or admin
 *   - 200/201 when authenticated as partner (happy path)
 *   - Tremendous client error mapping (502 on upstream failure)
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
    if (role === 'none') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = {
      id: req.headers['x-test-user-id'] || 'usr_partner_001',
      role: role || 'partner',
      email: req.headers['x-test-email'] || 'partner@example.com',
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

jest.mock('../../services/partnerService', () => ({
  getPartnerByUserId: jest.fn(),
  getBalance: jest.fn().mockResolvedValue({
    balance: 10000,
    availableBalance: 10000,
    maturingBalance: 0,
    totalEarned: 10000,
    packageBonusTotal: 0,
    subscriptionBonusTotal: 10000,
    adjustmentTotal: 0,
    redeemed: 0,
    transactions: [],
  }),
  debitPoints: jest.fn().mockResolvedValue({ id: 'ptx_debit_001' }),
  reverseDebit: jest.fn().mockResolvedValue({ id: 'ptx_reversal_001' }),
  POINTS_PER_GBP: 100,
  listReferralsByPartnerId: jest.fn().mockResolvedValue([]),
  maskReferralName: jest.fn(name => (name ? `${name[0]}***` : 'S***r')),
  getCodeHistory: jest.fn().mockResolvedValue([]),
  getPendingPoints: jest.fn().mockResolvedValue({ totalPending: 0 }),
  getPartnerByAnyRefCode: jest.fn().mockResolvedValue(null),
  regenerateCode: jest.fn(),
  createPartner: jest.fn(),
}));

jest.mock('../../db-unified', () => ({
  read: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({ id: 'tkt_001' }),
  updateOne: jest.fn().mockResolvedValue({ modified: 1 }),
}));

jest.mock('../../store', () => ({
  uid: (prefix = 'id') => `${prefix}_test_${Date.now()}`,
  DATA_DIR: '/tmp/test-data',
}));

// Mock the Tremendous service
jest.mock('../../services/tremendousService', () => ({
  getTremendousService: jest.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ACTIVE_PARTNER = {
  id: 'prt_001',
  userId: 'usr_partner_001',
  refCode: 'p_TEST01',
  status: 'active',
};

const DISABLED_PARTNER = {
  ...ACTIVE_PARTNER,
  status: 'disabled',
};

const MOCK_PRODUCTS = [
  { id: 'prod_amazon', name: 'Amazon Gift Card', category: 'GIFT_CARD' },
  { id: 'prod_paypal', name: 'PayPal Gift Card', category: 'GIFT_CARD' },
];

const MOCK_ORDER = {
  id: 'ord_abc123',
  status: 'EXECUTED',
  rewards: [{ id: 'rwd_xyz', delivery_status: 'DELIVERED', status: 'DELIVERED' }],
};

// ─── App setup ────────────────────────────────────────────────────────────────

const partnerService = require('../../services/partnerService');
const { getTremendousService } = require('../../services/tremendousService');
const dbUnified = require('../../db-unified');
const partnerRouter = require('../../routes/partner');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/partner', partnerRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/partner/tremendous/products', () => {
  let app;
  let mockTremendous;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);

    mockTremendous = {
      listProducts: jest.fn().mockResolvedValue(MOCK_PRODUCTS),
      createOrder: jest.fn(),
      getOrder: jest.fn(),
      resendReward: jest.fn(),
    };
    getTremendousService.mockReturnValue(mockTremendous);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .get('/api/partner/tremendous/products')
      .set('x-test-role', 'none');
    expect(res.status).toBe(401);
  });

  it('returns 403 for supplier role', async () => {
    const res = await request(app)
      .get('/api/partner/tremendous/products')
      .set('x-test-role', 'supplier');
    expect(res.status).toBe(403);
  });

  it('returns 403 for customer role', async () => {
    const res = await request(app)
      .get('/api/partner/tremendous/products')
      .set('x-test-role', 'customer');
    expect(res.status).toBe(403);
  });

  it('returns 403 for admin role', async () => {
    const res = await request(app)
      .get('/api/partner/tremendous/products')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(403);
  });

  it('returns 200 with products for partner role', async () => {
    const res = await request(app).get('/api/partner/tremendous/products');
    expect(res.status).toBe(200);
    expect(res.body.products).toEqual(MOCK_PRODUCTS);
  });

  it('maps Tremendous client errors to 502', async () => {
    mockTremendous.listProducts.mockRejectedValue(new Error('Upstream API failure'));
    const res = await request(app).get('/api/partner/tremendous/products');
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/upstream api failure/i);
  });

  it('preserves statusCode from Tremendous error', async () => {
    const err = new Error('Service unavailable');
    err.statusCode = 503;
    mockTremendous.listProducts.mockRejectedValue(err);
    const res = await request(app).get('/api/partner/tremendous/products');
    expect(res.status).toBe(503);
  });
});

describe('POST /api/partner/tremendous/orders', () => {
  let app;
  let mockTremendous;

  const VALID_BODY = {
    productId: 'prod_amazon',
    value: 10,
    currency: 'GBP',
    recipientName: 'Jane Doe',
    recipientEmail: 'jane@example.com',
  };

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    partnerService.getBalance.mockResolvedValue({
      balance: 10000,
      availableBalance: 10000,
      maturingBalance: 0,
      totalEarned: 10000,
      packageBonusTotal: 0,
      subscriptionBonusTotal: 10000,
      adjustmentTotal: 0,
      redeemed: 0,
      transactions: [],
    });
    partnerService.debitPoints.mockResolvedValue({ id: 'ptx_debit_001' });
    partnerService.reverseDebit.mockResolvedValue({ id: 'ptx_reversal_001' });

    mockTremendous = {
      listProducts: jest.fn(),
      createOrder: jest.fn().mockResolvedValue(MOCK_ORDER),
      getOrder: jest.fn(),
      resendReward: jest.fn(),
    };
    getTremendousService.mockReturnValue(mockTremendous);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/orders')
      .set('x-test-role', 'none')
      .send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it('returns 403 for supplier role', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/orders')
      .set('x-test-role', 'supplier')
      .send(VALID_BODY);
    expect(res.status).toBe(403);
  });

  it('returns 403 for customer role', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/orders')
      .set('x-test-role', 'customer')
      .send(VALID_BODY);
    expect(res.status).toBe(403);
  });

  it('returns 403 for admin role', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/orders')
      .set('x-test-role', 'admin')
      .send(VALID_BODY);
    expect(res.status).toBe(403);
  });

  it('returns 201 with order for authenticated partner', async () => {
    const res = await request(app).post('/api/partner/tremendous/orders').send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.order).toEqual(MOCK_ORDER);
  });

  it('returns 400 when productId is missing', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/orders')
      .send({ ...VALID_BODY, productId: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/productId/i);
  });

  it('returns 400 when value is not a positive number', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/orders')
      .send({ ...VALID_BODY, value: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/value/i);
  });

  it('returns 400 when value is zero', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/orders')
      .send({ ...VALID_BODY, value: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when recipientName is missing', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/orders')
      .send({ ...VALID_BODY, recipientName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recipientName/i);
  });

  it('returns 400 when recipientEmail is missing', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/orders')
      .send({ ...VALID_BODY, recipientEmail: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recipientEmail/i);
  });

  it('returns 403 for disabled partner', async () => {
    partnerService.getPartnerByUserId.mockResolvedValue(DISABLED_PARTNER);
    const res = await request(app).post('/api/partner/tremendous/orders').send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(res.body.disabled).toBe(true);
  });

  it('maps Tremendous client errors to 502', async () => {
    mockTremendous.createOrder.mockRejectedValue(new Error('Bad gateway'));
    const res = await request(app).post('/api/partner/tremendous/orders').send(VALID_BODY);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/bad gateway/i);
  });
});

describe('GET /api/partner/tremendous/orders/:id', () => {
  let app;
  let mockTremendous;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);

    mockTremendous = {
      listProducts: jest.fn(),
      createOrder: jest.fn(),
      getOrder: jest.fn().mockResolvedValue(MOCK_ORDER),
      resendReward: jest.fn(),
    };
    getTremendousService.mockReturnValue(mockTremendous);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .get('/api/partner/tremendous/orders/ord_abc123')
      .set('x-test-role', 'none');
    expect(res.status).toBe(401);
  });

  it('returns 403 for supplier role', async () => {
    const res = await request(app)
      .get('/api/partner/tremendous/orders/ord_abc123')
      .set('x-test-role', 'supplier');
    expect(res.status).toBe(403);
  });

  it('returns 403 for customer role', async () => {
    const res = await request(app)
      .get('/api/partner/tremendous/orders/ord_abc123')
      .set('x-test-role', 'customer');
    expect(res.status).toBe(403);
  });

  it('returns 403 for admin role', async () => {
    const res = await request(app)
      .get('/api/partner/tremendous/orders/ord_abc123')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(403);
  });

  it('returns 200 with order for authenticated partner', async () => {
    const res = await request(app).get('/api/partner/tremendous/orders/ord_abc123');
    expect(res.status).toBe(200);
    expect(res.body.order).toEqual(MOCK_ORDER);
  });

  it('returns 404 when order does not exist', async () => {
    const err = new Error('Order not found');
    err.statusCode = 404;
    mockTremendous.getOrder.mockRejectedValue(err);
    const res = await request(app).get('/api/partner/tremendous/orders/ord_nonexistent');
    expect(res.status).toBe(404);
  });

  it('maps Tremendous client errors to 502', async () => {
    mockTremendous.getOrder.mockRejectedValue(new Error('Upstream error'));
    const res = await request(app).get('/api/partner/tremendous/orders/ord_abc123');
    expect(res.status).toBe(502);
  });
});

describe('POST /api/partner/tremendous/orders/:id/resend', () => {
  let app;
  let mockTremendous;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);

    mockTremendous = {
      listProducts: jest.fn(),
      createOrder: jest.fn(),
      getOrder: jest.fn().mockResolvedValue(MOCK_ORDER),
      resendReward: jest.fn().mockResolvedValue({}),
    };
    getTremendousService.mockReturnValue(mockTremendous);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/orders/ord_abc123/resend')
      .set('x-test-role', 'none');
    expect(res.status).toBe(401);
  });

  it('returns 403 for supplier role', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/orders/ord_abc123/resend')
      .set('x-test-role', 'supplier');
    expect(res.status).toBe(403);
  });

  it('returns 403 for customer role', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/orders/ord_abc123/resend')
      .set('x-test-role', 'customer');
    expect(res.status).toBe(403);
  });

  it('returns 403 for admin role', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/orders/ord_abc123/resend')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(403);
  });

  it('returns 200 when resend succeeds for partner', async () => {
    const res = await request(app).post('/api/partner/tremendous/orders/ord_abc123/resend');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 404 when order has no rewards', async () => {
    mockTremendous.getOrder.mockResolvedValue({ id: 'ord_empty', rewards: [] });
    const res = await request(app).post('/api/partner/tremendous/orders/ord_empty/resend');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no rewards/i);
  });

  it('maps Tremendous client errors to 502', async () => {
    mockTremendous.resendReward.mockRejectedValue(new Error('Resend failed'));
    const res = await request(app).post('/api/partner/tremendous/orders/ord_abc123/resend');
    expect(res.status).toBe(502);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/partner/tremendous/orders  (list cashout orders from DB)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/partner/tremendous/orders', () => {
  let app;

  const CASHOUT_RECORDS = [
    {
      id: 'pco_001',
      partnerId: 'prt_001',
      partnerUserId: 'usr_partner_001',
      tremendousOrderId: 'ord_001',
      tremendousRewardId: 'rwd_001',
      valueGbp: 10,
      pointsDebited: 1000,
      recipientName: 'Jane',
      recipientEmail: 'jane@example.com',
      productId: 'prod_amazon',
      status: 'created',
      createdAt: '2026-03-01T10:00:00Z',
    },
  ];

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    dbUnified.read.mockImplementation(col => {
      if (col === 'partner_cashout_orders') {
        return Promise.resolve(CASHOUT_RECORDS);
      }
      return Promise.resolve([]);
    });
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/partner/tremendous/orders').set('x-test-role', 'none');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-partner role', async () => {
    const res = await request(app)
      .get('/api/partner/tremendous/orders')
      .set('x-test-role', 'supplier');
    expect(res.status).toBe(403);
  });

  it('returns 200 with partner cashout orders', async () => {
    const res = await request(app).get('/api/partner/tremendous/orders');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe('pco_001');
  });

  it('returns empty list when no orders exist', async () => {
    dbUnified.read.mockResolvedValue([]);
    const res = await request(app).get('/api/partner/tremendous/orders');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/partner/tremendous/rewards/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/partner/tremendous/rewards/:id', () => {
  let app;
  let mockTremendous;
  const MOCK_REWARD = { id: 'rwd_abc', status: 'DELIVERED', delivery_status: 'DELIVERED' };

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    mockTremendous = {
      listProducts: jest.fn(),
      createOrder: jest.fn(),
      getOrder: jest.fn(),
      resendReward: jest.fn(),
      getReward: jest.fn().mockResolvedValue(MOCK_REWARD),
      cancelReward: jest.fn(),
      generateRewardLink: jest.fn(),
      listFundingSources: jest.fn(),
      listOrders: jest.fn(),
      listRewards: jest.fn(),
    };
    getTremendousService.mockReturnValue(mockTremendous);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .get('/api/partner/tremendous/rewards/rwd_abc')
      .set('x-test-role', 'none');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-partner roles', async () => {
    const res = await request(app)
      .get('/api/partner/tremendous/rewards/rwd_abc')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(403);
  });

  it('returns 200 with reward for partner', async () => {
    const res = await request(app).get('/api/partner/tremendous/rewards/rwd_abc');
    expect(res.status).toBe(200);
    expect(res.body.reward).toEqual(MOCK_REWARD);
  });

  it('returns 404 when reward not found', async () => {
    const err = new Error('Reward not found');
    err.statusCode = 404;
    mockTremendous.getReward.mockRejectedValue(err);
    const res = await request(app).get('/api/partner/tremendous/rewards/rwd_missing');
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/partner/tremendous/rewards/:id/resend
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/partner/tremendous/rewards/:id/resend', () => {
  let app;
  let mockTremendous;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    mockTremendous = {
      listProducts: jest.fn(),
      createOrder: jest.fn(),
      getOrder: jest.fn(),
      resendReward: jest.fn().mockResolvedValue({}),
      getReward: jest.fn(),
      cancelReward: jest.fn(),
      generateRewardLink: jest.fn(),
      listFundingSources: jest.fn(),
      listOrders: jest.fn(),
      listRewards: jest.fn(),
    };
    getTremendousService.mockReturnValue(mockTremendous);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/rewards/rwd_abc/resend')
      .set('x-test-role', 'none');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-partner roles', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/rewards/rwd_abc/resend')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(403);
  });

  it('returns 200 on success for partner', async () => {
    const res = await request(app).post('/api/partner/tremendous/rewards/rwd_abc/resend');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockTremendous.resendReward).toHaveBeenCalledWith('rwd_abc');
  });

  it('maps errors to 502', async () => {
    mockTremendous.resendReward.mockRejectedValue(new Error('Resend failed'));
    const res = await request(app).post('/api/partner/tremendous/rewards/rwd_abc/resend');
    expect(res.status).toBe(502);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/partner/tremendous/rewards/:id/cancel
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/partner/tremendous/rewards/:id/cancel', () => {
  let app;
  let mockTremendous;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    mockTremendous = {
      listProducts: jest.fn(),
      createOrder: jest.fn(),
      getOrder: jest.fn(),
      resendReward: jest.fn(),
      getReward: jest.fn(),
      cancelReward: jest.fn().mockResolvedValue({ id: 'rwd_abc', status: 'CANCELLED' }),
      generateRewardLink: jest.fn(),
      listFundingSources: jest.fn(),
      listOrders: jest.fn(),
      listRewards: jest.fn(),
    };
    getTremendousService.mockReturnValue(mockTremendous);
    dbUnified.read.mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/rewards/rwd_abc/cancel')
      .set('x-test-role', 'none');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-partner roles', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/rewards/rwd_abc/cancel')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(403);
  });

  it('returns 200 with cancelled reward', async () => {
    const res = await request(app).post('/api/partner/tremendous/rewards/rwd_abc/cancel');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockTremendous.cancelReward).toHaveBeenCalledWith('rwd_abc');
  });

  it('returns 404 when reward not found', async () => {
    const err = new Error('Reward not found');
    err.statusCode = 404;
    mockTremendous.cancelReward.mockRejectedValue(err);
    const res = await request(app).post('/api/partner/tremendous/rewards/rwd_missing/cancel');
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/partner/tremendous/rewards/:id/generate-link
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/partner/tremendous/rewards/:id/generate-link', () => {
  let app;
  let mockTremendous;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    mockTremendous = {
      listProducts: jest.fn(),
      createOrder: jest.fn(),
      getOrder: jest.fn(),
      resendReward: jest.fn(),
      getReward: jest.fn(),
      cancelReward: jest.fn(),
      generateRewardLink: jest
        .fn()
        .mockResolvedValue({ link: 'https://example.com/claim/abc', reward: { id: 'rwd_abc' } }),
      listFundingSources: jest.fn(),
      listOrders: jest.fn(),
      listRewards: jest.fn(),
    };
    getTremendousService.mockReturnValue(mockTremendous);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/rewards/rwd_abc/generate-link')
      .set('x-test-role', 'none');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-partner roles', async () => {
    const res = await request(app)
      .post('/api/partner/tremendous/rewards/rwd_abc/generate-link')
      .set('x-test-role', 'supplier');
    expect(res.status).toBe(403);
  });

  it('returns 200 with link for partner', async () => {
    const res = await request(app).post('/api/partner/tremendous/rewards/rwd_abc/generate-link');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.link).toBe('https://example.com/claim/abc');
  });

  it('maps errors to 502', async () => {
    mockTremendous.generateRewardLink.mockRejectedValue(new Error('Not supported'));
    const res = await request(app).post('/api/partner/tremendous/rewards/rwd_abc/generate-link');
    expect(res.status).toBe(502);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/partner/tremendous/funding-sources
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/partner/tremendous/funding-sources', () => {
  let app;
  let mockTremendous;

  const MOCK_FUNDING = [{ id: 'fs_001', type: 'BALANCE', label: 'Main Balance', amount: 500 }];

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    mockTremendous = {
      listProducts: jest.fn(),
      createOrder: jest.fn(),
      getOrder: jest.fn(),
      resendReward: jest.fn(),
      getReward: jest.fn(),
      cancelReward: jest.fn(),
      generateRewardLink: jest.fn(),
      listFundingSources: jest.fn().mockResolvedValue(MOCK_FUNDING),
      listOrders: jest.fn(),
      listRewards: jest.fn(),
    };
    getTremendousService.mockReturnValue(mockTremendous);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .get('/api/partner/tremendous/funding-sources')
      .set('x-test-role', 'none');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-partner roles', async () => {
    const res = await request(app)
      .get('/api/partner/tremendous/funding-sources')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(403);
  });

  it('returns 200 with funding sources for partner', async () => {
    const res = await request(app).get('/api/partner/tremendous/funding-sources');
    expect(res.status).toBe(200);
    expect(res.body.funding_sources).toEqual(MOCK_FUNDING);
  });

  it('maps Tremendous errors to 502', async () => {
    mockTremendous.listFundingSources.mockRejectedValue(new Error('API error'));
    const res = await request(app).get('/api/partner/tremendous/funding-sources');
    expect(res.status).toBe(502);
  });
});
