/**
 * Unit tests for partner payout request endpoint validation.
 *
 * Tests:
 *   - points must be a positive integer
 *   - points must not exceed available balance
 *   - giftCardType must be in allowed list (or absent)
 *   - giftCardType "Other" requires a message
 *   - disabled partners are rejected with 403
 *   - unauthenticated requests are rejected (401 from auth middleware)
 *   - non-partner role requests are rejected (403 from role middleware)
 *   - valid requests succeed
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

// Auth mock — default: authenticated partner; tests can override per-request via headers
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

// bcrypt / jwt used by register/login routes — stub them out
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

// partnerService mock — controls balance and partner record
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

// ─── App setup ────────────────────────────────────────────────────────────────

const partnerService = require('../../services/partnerService');
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

const DISABLED_PARTNER = {
  ...ACTIVE_PARTNER,
  status: 'disabled',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/partner/payout-request — validation', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    partnerService.getBalance.mockResolvedValue({ balance: 500, totalEarned: 500 });
  });

  // ── Auth checks ─────────────────────────────────────────────────────────────

  it('returns 401 when user is not authenticated', async () => {
    const res = await request(app)
      .post('/api/partner/payout-request')
      .set('x-test-role', 'none')
      .send({ points: 100 });

    expect(res.status).toBe(401);
  });

  it('returns 403 when user is authenticated but not a partner', async () => {
    const res = await request(app)
      .post('/api/partner/payout-request')
      .set('x-test-role', 'customer')
      .send({ points: 100 });

    expect(res.status).toBe(403);
  });

  it('returns 403 when user is authenticated as admin (not partner role)', async () => {
    const res = await request(app)
      .post('/api/partner/payout-request')
      .set('x-test-role', 'admin')
      .send({ points: 100 });

    expect(res.status).toBe(403);
  });

  // ── Disabled partner ─────────────────────────────────────────────────────────

  it('returns 403 when partner account is disabled', async () => {
    partnerService.getPartnerByUserId.mockResolvedValue(DISABLED_PARTNER);

    const res = await request(app).post('/api/partner/payout-request').send({ points: 100 });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ disabled: true });
  });

  // ── Points validation ─────────────────────────────────────────────────────────

  it('returns 400 when points is missing', async () => {
    const res = await request(app)
      .post('/api/partner/payout-request')
      .send({ giftCardType: 'Amazon' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/points must be a positive integer/i);
  });

  it('returns 400 when points is zero', async () => {
    const res = await request(app).post('/api/partner/payout-request').send({ points: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/points must be a positive integer/i);
  });

  it('returns 400 when points is negative', async () => {
    const res = await request(app).post('/api/partner/payout-request').send({ points: -50 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/points must be a positive integer/i);
  });

  it('returns 400 when points is a non-numeric string', async () => {
    const res = await request(app).post('/api/partner/payout-request').send({ points: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/points must be a positive integer/i);
  });

  it('returns 400 when points exceeds available balance', async () => {
    partnerService.getBalance.mockResolvedValue({ balance: 200, totalEarned: 500 });

    const res = await request(app).post('/api/partner/payout-request').send({ points: 300 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient points/i);
  });

  // ── giftCardType validation ───────────────────────────────────────────────────

  it('returns 400 when giftCardType is not in the allowed list', async () => {
    const res = await request(app)
      .post('/api/partner/payout-request')
      .send({ points: 100, giftCardType: 'InvalidCard' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/giftCardType must be one of/i);
  });

  it('returns 400 when giftCardType is "Other" but message is missing', async () => {
    const res = await request(app)
      .post('/api/partner/payout-request')
      .send({ points: 100, giftCardType: 'Other' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message is required when gift card type is "Other"/i);
  });

  it('returns 400 when giftCardType is "Other" but message is empty string', async () => {
    const res = await request(app)
      .post('/api/partner/payout-request')
      .send({ points: 100, giftCardType: 'Other', message: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message is required when gift card type is "Other"/i);
  });

  // ── Valid requests ────────────────────────────────────────────────────────────

  it('returns 201 for a valid payout request without gift card type', async () => {
    const res = await request(app).post('/api/partner/payout-request').send({ points: 100 });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.ticketId).toBeTruthy();
  });

  it('returns 201 for a valid payout with an allowed gift card type', async () => {
    const res = await request(app)
      .post('/api/partner/payout-request')
      .send({ points: 100, giftCardType: 'Amazon' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it('returns 201 for "Other" gift card type when message is provided', async () => {
    const res = await request(app)
      .post('/api/partner/payout-request')
      .send({ points: 100, giftCardType: 'Other', message: 'Please send a Starbucks card' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it('accepts points equal to the full available balance', async () => {
    partnerService.getBalance.mockResolvedValue({ balance: 100, totalEarned: 100 });

    const res = await request(app).post('/api/partner/payout-request').send({ points: 100 });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it('accepts all valid gift card types', async () => {
    const VALID_TYPES = ['Amazon', 'John Lewis', 'ASOS', 'Marks & Spencer', 'Other'];

    for (const type of VALID_TYPES) {
      const body = { points: 100, giftCardType: type };
      if (type === 'Other') {
        body.message = 'Some message';
      }
      partnerService.getBalance.mockResolvedValue({ balance: 500, totalEarned: 500 });
      const res = await request(app).post('/api/partner/payout-request').send(body);
      expect(res.status).toBe(201);
    }
  });
});
