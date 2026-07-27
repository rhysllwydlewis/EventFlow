/**
 * Partner dashboard endpoint consistency tests.
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../utils/postmark', () => ({ sendMail: jest.fn(), FROM_HELLO: 'hello@example.com' }));
const mockNotifyAdmins = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/notifyAdmins.service', () => ({ notifyAdmins: mockNotifyAdmins }));
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
      id: req.headers['x-test-user-id'] || 'usr_partner_001',
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
  POINTS_PER_GBP: 100,
  CREDIT_MATURITY_DAYS: 30,
  ATTRIBUTION_DAYS: 30,
  PACKAGE_BONUS: 10,
  FIRST_REVIEW_BONUS: 15,
  SUBSCRIPTION_BONUS: 100,
  CREDIT_TYPES: {
    ADJUSTMENT: 'ADJUSTMENT',
    CASHOUT_RELEASE: 'CASHOUT_RELEASE',
    CASHOUT_HOLD: 'CASHOUT_HOLD',
    REDEEM: 'REDEEM',
  },
  getPartnerByUserId: jest.fn(),
  getBalance: jest.fn(),
  getPendingPoints: jest.fn(),
  listReferralsByPartnerId: jest.fn(),
  getReviewQualifications: jest.fn(),
  isWithinAttributionWindow: jest.fn(),
  maskReferralName: jest.fn(name => (name ? `${name[0]}***${name.slice(-1)}` : 'S***r')),
  getCodeHistory: jest.fn(),
  regenerateCode: jest.fn(),
  createPartner: jest.fn(),
  createCashoutHold: jest.fn(),
  releaseCashoutHold: jest.fn(),
};
jest.mock('../../services/partnerService', () => mockPartnerService);

const mockDb = {
  read: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
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
  refCode: 'p_TEST01',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const DISABLED_PARTNER = { ...ACTIVE_PARTNER, status: 'disabled' };

beforeEach(() => {
  jest.clearAllMocks();
  mockIdCounter = 0;
  mockPartnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
  mockPartnerService.getBalance.mockResolvedValue({
    balance: 500,
    availableBalance: 250,
    maturingBalance: 250,
    totalEarned: 500,
    signupBonusTotal: 5,
    packageBonusTotal: 10,
    reviewBonusTotal: 15,
    subscriptionBonusTotal: 100,
    adjustmentTotal: 0,
    transactions: [],
  });
  mockPartnerService.getPendingPoints.mockResolvedValue({
    totalPending: 125,
    pendingPackage: 10,
    pendingReview: 15,
    pendingSubscription: 100,
  });
  mockPartnerService.listReferralsByPartnerId.mockResolvedValue([]);
  mockPartnerService.getReviewQualifications.mockResolvedValue(new Map());
  mockPartnerService.isWithinAttributionWindow.mockReturnValue(true);
  mockPartnerService.getCodeHistory.mockResolvedValue([]);
  mockDb.read.mockResolvedValue([]);
  mockDb.find.mockResolvedValue([]);
  mockDb.findOne.mockResolvedValue({
    id: 'usr_partner_001',
    name: 'Test Partner',
    firstName: 'Test',
    lastName: 'Partner',
    email: 'partner@example.com',
  });
  mockDb.insertOne.mockResolvedValue({ id: 'persisted' });
  mockDb.updateOne.mockResolvedValue({ modified: 1 });
});

describe('GET /api/partner/me', () => {
  it('returns one authoritative programme configuration object', async () => {
    const response = await request(buildApp()).get('/api/partner/me');
    expect(response.status).toBe(200);
    expect(response.body.config).toMatchObject({
      pointsPerGbp: 100,
      maturityDays: 30,
      attributionDays: 30,
      minimumCashoutGbp: 15,
      cashoutMethods: ['amazon_voucher', 'prepaid_debit_card'],
    });
    expect(response.body.config.cashoutDenominations).toContain(15);
    expect(response.body.credits.pendingReview).toBe(15);
  });

  it('continues to block financial data for disabled partners while advertising support', async () => {
    mockPartnerService.getPartnerByUserId.mockResolvedValue(DISABLED_PARTNER);
    const response = await request(buildApp()).get('/api/partner/me');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ disabled: true, supportAvailable: true });
  });
});

describe('GET /api/partner/referrals', () => {
  it('derives review qualification from FIRST_REVIEW_BONUS ledger activity', async () => {
    mockPartnerService.listReferralsByPartnerId.mockResolvedValue([
      {
        id: 'ref_001',
        partnerId: 'prt_001',
        supplierUserId: 'usr_supplier_001',
        supplierCreatedAt: '2026-07-01T00:00:00.000Z',
        attributionExpiresAt: '2026-07-31T00:00:00.000Z',
        packageQualified: true,
        subscriptionQualified: false,
      },
    ]);
    mockPartnerService.getReviewQualifications.mockResolvedValue(
      new Map([['usr_supplier_001', '2026-07-12T00:00:00.000Z']])
    );
    mockPartnerService.getBalance.mockResolvedValue({
      transactions: [
        {
          supplierUserId: 'usr_supplier_001',
          type: 'FIRST_REVIEW_BONUS',
          amount: 15,
          createdAt: '2026-07-12T00:00:00.000Z',
        },
      ],
    });
    mockDb.read.mockResolvedValue([
      { id: 'usr_supplier_001', name: 'Supplier Person', email: 'supplier@example.com' },
    ]);

    const response = await request(buildApp()).get('/api/partner/referrals');
    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({
      reviewQualified: true,
      reviewQualifiedAt: '2026-07-12T00:00:00.000Z',
      pointsEarned: 15,
    });
    expect(response.body.items[0].supplierName).not.toContain('Supplier Person');
  });

  it('does not expire the review milestone when the package/subscription window closes', async () => {
    mockPartnerService.listReferralsByPartnerId.mockResolvedValue([
      {
        id: 'ref_old',
        partnerId: 'prt_001',
        supplierUserId: 'usr_supplier_old',
        supplierCreatedAt: '2025-01-01T00:00:00.000Z',
        attributionExpiresAt: '2025-01-31T00:00:00.000Z',
        packageQualified: false,
        subscriptionQualified: false,
      },
    ]);
    mockPartnerService.isWithinAttributionWindow.mockReturnValue(false);
    mockPartnerService.getBalance.mockResolvedValue({ transactions: [] });
    const response = await request(buildApp()).get('/api/partner/referrals');
    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({
      withinWindow: false,
      reviewQualified: false,
      potentialPoints: 15,
      state: 'expired',
    });
  });
});

describe('restricted support for disabled partners', () => {
  it('allows a disabled partner to create an account-access ticket', async () => {
    mockPartnerService.getPartnerByUserId.mockResolvedValue(DISABLED_PARTNER);
    const response = await request(buildApp())
      .post('/api/partner/support-ticket')
      .send({ subject: 'Please review my account', message: 'I need help restoring access.' });
    expect(response.status).toBe(201);
    expect(mockDb.insertOne).toHaveBeenCalledWith(
      'tickets',
      expect.objectContaining({
        category: 'partner_account_access',
        priority: 'high',
        partnerId: 'prt_001',
      })
    );
  });

  it('allows a disabled partner to list existing support tickets', async () => {
    mockPartnerService.getPartnerByUserId.mockResolvedValue(DISABLED_PARTNER);
    mockDb.find.mockResolvedValue([
      {
        id: 'tkt_001',
        senderId: 'usr_partner_001',
        senderType: 'partner',
        subject: 'Account access',
        status: 'open',
        responses: [],
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ]);
    const response = await request(buildApp()).get('/api/partner/support-tickets');
    expect(response.status).toBe(200);
    expect(response.body.disabled).toBe(true);
    expect(response.body.items).toHaveLength(1);
  });
});
