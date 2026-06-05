/**
 * Integration tests for new partner endpoints:
 *
 * 1. GET /api/partner/support-tickets  — list partner's own tickets
 * 2. GET /api/partner/me               — pointsPerGbp in response
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
  sendMail: jest.fn().mockResolvedValue({ MessageID: 'mock-id' }),
  FROM_DEFAULT: 'hello@eventflow.app',
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  authLimiter: (_req, _res, next) => next(),
  writeLimiter: (_req, _res, next) => next(),
}));

jest.mock('../../middleware/auth', () => {
  function authRequired(req, res, next) {
    const role = req.headers['x-test-role'];
    if (role === 'none') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
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

  return { JWT_SECRET: 'test-secret', authRequired, roleRequired, setAuthCookie: jest.fn() };
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

const ACTIVE_PARTNER = {
  id: 'prt_001',
  userId: 'usr_partner_001',
  refCode: 'p_TEST01',
  status: 'active',
};

jest.mock('../../services/partnerService', () => ({
  getPartnerByUserId: jest.fn(),
  getBalance: jest.fn(),
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
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({ id: 'tkt_001' }),
  updateOne: jest.fn().mockResolvedValue({ modified: 1 }),
  deleteOne: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../store', () => ({
  uid: (prefix = 'id') => `${prefix}_test_${Date.now()}`,
  DATA_DIR: '/tmp/test-data',
}));

// ─── App setup ────────────────────────────────────────────────────────────────

const partnerService = require('../../services/partnerService');
const dbUnified = require('../../db-unified');
const partnerRouter = require('../../routes/partner');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/partner', partnerRouter);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/partner/support-tickets
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/partner/support-tickets', () => {
  let app;

  const SAMPLE_TICKETS = [
    {
      id: 'tkt_001',
      senderId: 'usr_partner_001',
      senderType: 'partner',
      subject: 'My first ticket',
      status: 'open',
      priority: 'normal',
      category: 'partner_support',
      createdAt: '2026-03-10T10:00:00Z',
      updatedAt: '2026-03-10T10:00:00Z',
      lastReplyAt: '2026-03-10T10:00:00Z',
      lastReplyBy: 'partner',
      responses: [],
    },
    {
      id: 'tkt_002',
      senderId: 'usr_partner_001',
      senderType: 'partner',
      subject: 'Second ticket',
      status: 'resolved',
      priority: 'normal',
      category: 'partner_support',
      createdAt: '2026-03-11T10:00:00Z',
      updatedAt: '2026-03-12T10:00:00Z',
      lastReplyAt: '2026-03-12T10:00:00Z',
      lastReplyBy: 'admin',
      responses: [{ id: 'r_001', message: 'We fixed it' }],
    },
    {
      // Different user — should not appear
      id: 'tkt_003',
      senderId: 'usr_other',
      senderType: 'partner',
      subject: 'Other partner ticket',
      status: 'open',
      priority: 'normal',
      category: 'partner_support',
      createdAt: '2026-03-11T10:00:00Z',
      updatedAt: '2026-03-11T10:00:00Z',
      lastReplyAt: '2026-03-11T10:00:00Z',
      lastReplyBy: 'partner',
      responses: [],
    },
  ];

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'tickets') {
        return Promise.resolve(SAMPLE_TICKETS);
      }
      return Promise.resolve([]);
    });
    // Code now uses find({ senderId, senderType: 'partner' }) — return filtered results
    dbUnified.find.mockImplementation(async (collection, filter) => {
      if (collection === 'tickets') {
        return SAMPLE_TICKETS.filter(t => Object.keys(filter).every(k => t[k] === filter[k]));
      }
      return [];
    });
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/partner/support-tickets').set('x-test-role', 'none');
    expect(res.status).toBe(401);
  });

  it('returns 403 for supplier role', async () => {
    const res = await request(app)
      .get('/api/partner/support-tickets')
      .set('x-test-role', 'supplier');
    expect(res.status).toBe(403);
  });

  it('returns 403 for admin role', async () => {
    const res = await request(app).get('/api/partner/support-tickets').set('x-test-role', 'admin');
    expect(res.status).toBe(403);
  });

  it("returns 200 with only the current partner's tickets", async () => {
    const res = await request(app).get('/api/partner/support-tickets');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(2);
    // Should not include tkt_003 which belongs to a different user
    const ids = res.body.items.map(t => t.id);
    expect(ids).toContain('tkt_001');
    expect(ids).toContain('tkt_002');
    expect(ids).not.toContain('tkt_003');
  });

  it('returns tickets sorted newest first', async () => {
    const res = await request(app).get('/api/partner/support-tickets');
    expect(res.status).toBe(200);
    const createdAts = res.body.items.map(t => t.createdAt);
    expect(new Date(createdAts[0]) >= new Date(createdAts[1])).toBe(true);
  });

  it('includes responseCount field', async () => {
    const res = await request(app).get('/api/partner/support-tickets');
    const resolved = res.body.items.find(t => t.id === 'tkt_002');
    expect(resolved).toBeDefined();
    expect(resolved.responseCount).toBe(1);
  });

  it('returns 200 with empty list when no tickets exist', async () => {
    dbUnified.find.mockResolvedValue([]); // find({ senderId, senderType }) returns empty
    const res = await request(app).get('/api/partner/support-tickets');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('returns 403 for disabled partner', async () => {
    partnerService.getPartnerByUserId.mockResolvedValue({ ...ACTIVE_PARTNER, status: 'disabled' });
    const res = await request(app).get('/api/partner/support-tickets');
    expect(res.status).toBe(403);
    expect(res.body.disabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/partner/me — pointsPerGbp in response
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/partner/me — pointsPerGbp', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    partnerService.getBalance.mockResolvedValue({
      balance: 1000,
      availableBalance: 500,
      maturingBalance: 500,
      totalEarned: 1000,
      packageBonusTotal: 100,
      subscriptionBonusTotal: 900,
      adjustmentTotal: 0,
      redeemed: 0,
      transactions: [],
    });
    partnerService.getPendingPoints.mockResolvedValue({
      totalPending: 0,
      pendingPackage: 0,
      pendingSubscription: 0,
    });
  });

  it('includes pointsPerGbp in the response', async () => {
    const res = await request(app).get('/api/partner/me').set('x-test-role', 'partner');
    expect(res.status).toBe(200);
    expect(res.body.pointsPerGbp).toBeDefined();
    expect(typeof res.body.pointsPerGbp).toBe('number');
    expect(res.body.pointsPerGbp).toBeGreaterThan(0);
  });

  it('pointsPerGbp matches the POINTS_PER_GBP service export', async () => {
    const res = await request(app).get('/api/partner/me').set('x-test-role', 'partner');
    expect(res.status).toBe(200);
    expect(res.body.pointsPerGbp).toBe(partnerService.POINTS_PER_GBP);
  });

  it('returns partner profile and credits together with pointsPerGbp', async () => {
    const res = await request(app).get('/api/partner/me').set('x-test-role', 'partner');
    expect(res.status).toBe(200);
    expect(res.body.partner).toBeDefined();
    expect(res.body.credits).toBeDefined();
    expect(res.body.pointsPerGbp).toBeDefined();
  });
});
