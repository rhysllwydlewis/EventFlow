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
  getBalance: jest.fn(),
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
