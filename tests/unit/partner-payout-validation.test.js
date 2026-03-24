/**
 * Unit tests for partner payout and support-ticket endpoints.
 *
 * Payout request (`POST /api/partner/payout-request`):
 *   - Returns 503 "coming soon" for all authenticated partner requests
 *   - Still rejects unauthenticated (401) and non-partner role (403)
 *
 * Support ticket (`POST /api/partner/support-ticket`):
 *   - Returns 401 for unauthenticated, 403 for non-partner role
 *   - Returns 403 for disabled partner accounts
 *   - Returns 400 when subject or message is missing
 *   - Returns 201 for valid tickets
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

jest.mock('../../services/tremendousService', () => ({
  getTremendousService: jest.fn(() => ({
    listProducts: jest.fn().mockResolvedValue([]),
    createOrder: jest.fn().mockResolvedValue({ id: 'ord_001' }),
    getOrder: jest.fn().mockResolvedValue({ id: 'ord_001', status: 'EXECUTED', rewards: [] }),
    resendReward: jest.fn().mockResolvedValue({}),
  })),
}));

// ─── Payout request — Tremendous integration (replaces coming-soon stub) ─────

// NOTE: The old POST /api/partner/payout-request (503 coming-soon stub) has been
// replaced by the real Tremendous gift card integration. See
// tests/unit/partner-tremendous.test.js for the comprehensive Tremendous endpoint tests.

// ─── Support ticket ───────────────────────────────────────────────────────────

describe('POST /api/partner/support-ticket — validation', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    partnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
  });

  it('returns 401 when user is not authenticated', async () => {
    const res = await request(app)
      .post('/api/partner/support-ticket')
      .set('x-test-role', 'none')
      .send({ subject: 'Test', message: 'Hello' });

    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not a partner', async () => {
    const res = await request(app)
      .post('/api/partner/support-ticket')
      .set('x-test-role', 'customer')
      .send({ subject: 'Test', message: 'Hello' });

    expect(res.status).toBe(403);
  });

  it('returns 403 when partner account is disabled', async () => {
    partnerService.getPartnerByUserId.mockResolvedValue(DISABLED_PARTNER);

    const res = await request(app)
      .post('/api/partner/support-ticket')
      .send({ subject: 'Test', message: 'Hello' });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ disabled: true });
  });

  it('returns 400 when subject is missing', async () => {
    const res = await request(app)
      .post('/api/partner/support-ticket')
      .send({ message: 'Hello team' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/subject is required/i);
  });

  it('returns 400 when subject is empty string', async () => {
    const res = await request(app)
      .post('/api/partner/support-ticket')
      .send({ subject: '   ', message: 'Hello team' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/subject is required/i);
  });

  it('returns 400 when message is missing', async () => {
    const res = await request(app)
      .post('/api/partner/support-ticket')
      .send({ subject: 'Test subject' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message is required/i);
  });

  it('returns 400 when message is empty string', async () => {
    const res = await request(app)
      .post('/api/partner/support-ticket')
      .send({ subject: 'Test subject', message: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message is required/i);
  });

  it('returns 201 for a valid support ticket', async () => {
    const res = await request(app)
      .post('/api/partner/support-ticket')
      .send({ subject: 'Question about referrals', message: 'When do I get my bonus?' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.ticketId).toBeTruthy();
  });

  it('truncates subject to 150 chars and message to 2000 chars', async () => {
    const res = await request(app)
      .post('/api/partner/support-ticket')
      .send({ subject: 'A'.repeat(200), message: 'B'.repeat(3000) });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });
});
