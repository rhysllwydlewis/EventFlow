/**
 * Partner support validation and restricted-access tests.
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
      name: 'Test Partner',
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
  POINTS_PER_GBP: 100,
  CREDIT_MATURITY_DAYS: 30,
  ATTRIBUTION_DAYS: 30,
  getBalance: jest.fn(),
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
  findOne: jest.fn().mockResolvedValue({
    id: 'usr_partner_001',
    name: 'Test Partner',
    email: 'partner@example.com',
  }),
  insertOne: jest.fn().mockResolvedValue({ id: 'persisted' }),
  updateOne: jest.fn().mockResolvedValue({ modified: 1 }),
};
jest.mock('../../db-unified', () => mockDb);

let mockId = 0;
jest.mock('../../store', () => ({
  uid: prefix => `${prefix}_${++mockId}`,
  DATA_DIR: '/tmp/test-data',
}));

const router = require('../../routes/partner');
function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/partner', router);
  return instance;
}

const ACTIVE = { id: 'prt_001', userId: 'usr_partner_001', refCode: 'p_TEST', status: 'active' };
const DISABLED = { ...ACTIVE, status: 'disabled' };

describe('POST /api/partner/support-ticket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPartnerService.getPartnerByUserId.mockResolvedValue(ACTIVE);
    mockDb.findOne.mockResolvedValue({
      id: 'usr_partner_001',
      name: 'Test Partner',
      email: 'partner@example.com',
    });
    mockDb.insertOne.mockResolvedValue({ id: 'persisted' });
  });

  it('requires authentication and the partner role', async () => {
    expect(
      (
        await request(app())
          .post('/api/partner/support-ticket')
          .set('x-test-role', 'none')
          .send({ subject: 'Test', message: 'Hello' })
      ).status
    ).toBe(401);
    expect(
      (
        await request(app())
          .post('/api/partner/support-ticket')
          .set('x-test-role', 'customer')
          .send({ subject: 'Test', message: 'Hello' })
      ).status
    ).toBe(403);
  });

  it.each([
    [{ message: 'Hello' }, /subject/i],
    [{ subject: 'Question' }, /message/i],
    [{ subject: '   ', message: 'Hello' }, /subject/i],
    [{ subject: 'Question', message: '   ' }, /message/i],
  ])('validates required fields', async (payload, pattern) => {
    const response = await request(app()).post('/api/partner/support-ticket').send(payload);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(pattern);
  });

  it('creates a normal partner-support ticket for active accounts', async () => {
    const response = await request(app())
      .post('/api/partner/support-ticket')
      .send({ subject: 'Question about referrals', message: 'When do points mature?' });
    expect(response.status).toBe(201);
    expect(mockDb.insertOne).toHaveBeenCalledWith(
      'tickets',
      expect.objectContaining({ category: 'partner_support', priority: 'normal' })
    );
  });

  it('creates a restricted account-access ticket for disabled accounts', async () => {
    mockPartnerService.getPartnerByUserId.mockResolvedValue(DISABLED);
    const response = await request(app())
      .post('/api/partner/support-ticket')
      .send({ subject: 'Account access', message: 'Please review the restriction.' });
    expect(response.status).toBe(201);
    expect(mockDb.insertOne).toHaveBeenCalledWith(
      'tickets',
      expect.objectContaining({ category: 'partner_account_access', priority: 'high' })
    );
  });

  it('limits the stored subject and message lengths', async () => {
    const response = await request(app())
      .post('/api/partner/support-ticket')
      .send({ subject: 'A'.repeat(200), message: 'B'.repeat(3000) });
    expect(response.status).toBe(201);
    const ticket = mockDb.insertOne.mock.calls[0][1];
    expect(ticket.subject).toHaveLength(150);
    expect(ticket.message).toHaveLength(2000);
  });
});
