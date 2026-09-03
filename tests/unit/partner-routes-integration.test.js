'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  authLimiter: (_req, _res, next) => next(),
}));

const mockSetAuthCookie = jest.fn();
jest.mock('../../middleware/auth', () => ({
  JWT_SECRET: 'partner-route-test-secret-minimum-32-characters',
  setAuthCookie: mockSetAuthCookie,
  authRequired(req, res, next) {
    const role = req.headers['x-test-role'] || 'partner';
    if (role === 'none') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = {
      id: req.headers['x-test-user-id'] || 'usr_partner_001',
      role,
      email: 'partner@example.com',
      name: 'Test Partner',
    };
    return next();
  },
  roleRequired(requiredRole) {
    return (req, res, next) => {
      if (req.user?.role !== requiredRole) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return next();
    };
  },
}));

const mockPasswordOk = jest.fn(() => true);
jest.mock('../../middleware/validation', () => ({ passwordOk: mockPasswordOk }));

const mockBcrypt = {
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
};
jest.mock('bcryptjs', () => mockBcrypt);

const mockJwtSign = jest.fn(() => 'signed-partner-token');
jest.mock('jsonwebtoken', () => ({ sign: mockJwtSign }));

const mockIsEmail = jest.fn(() => true);
jest.mock('validator', () => ({ isEmail: mockIsEmail }));

const mockPostmark = {
  FROM_HELLO: 'hello@event-flow.co.uk',
  sendMail: jest.fn().mockResolvedValue({ MessageID: 'welcome-message' }),
};
jest.mock('../../utils/postmark', () => mockPostmark);

const mockNotifyAdmins = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/notifyAdmins.service', () => ({ notifyAdmins: mockNotifyAdmins }));

let mockUidCounter = 0;
jest.mock('../../store', () => ({
  uid: prefix => `${prefix}_route_${++mockUidCounter}`,
}));

const mockPartnerService = {
  POINTS_PER_GBP: 100,
  CREDIT_MATURITY_DAYS: 30,
  ATTRIBUTION_DAYS: 30,
  PACKAGE_BONUS: 10,
  FIRST_REVIEW_BONUS: 15,
  SUBSCRIPTION_BONUS: 100,
  CREDIT_TYPES: {
    PACKAGE_BONUS: 'PACKAGE_BONUS',
    SUBSCRIPTION_BONUS: 'SUBSCRIPTION_BONUS',
    REFERRAL_SIGNUP_BONUS: 'REFERRAL_SIGNUP_BONUS',
    FIRST_REVIEW_BONUS: 'FIRST_REVIEW_BONUS',
    ADJUSTMENT: 'ADJUSTMENT',
    REDEEM: 'REDEEM',
    CASHOUT_HOLD: 'CASHOUT_HOLD',
    CASHOUT_RELEASE: 'CASHOUT_RELEASE',
  },
  createPartner: jest.fn(),
  getPartnerByUserId: jest.fn(),
  getBalance: jest.fn(),
  getPendingPoints: jest.fn(),
  listReferralsByPartnerId: jest.fn(),
  getReviewQualifications: jest.fn(),
  isWithinAttributionWindow: jest.fn(),
  maskReferralName: jest.fn((name, company, email) => {
    const source = name || company || email;
    return source ? `${source[0]}***` : 'S***r';
  }),
  regenerateCode: jest.fn(),
  getCodeHistory: jest.fn(),
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

const partnerRouter = require('../../routes/partner');

const ACTIVE_PARTNER = {
  id: 'prt_001',
  userId: 'usr_partner_001',
  refCode: 'p_ROUTE01',
  status: 'active',
  createdAt: '2026-06-01T12:00:00.000Z',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/partner', partnerRouter);
  return app;
}

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

describe('partner route integration coverage', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    mockUidCounter = 0;
    delete process.env.CASHOUT_DENOMINATIONS;
    delete process.env.BASE_URL;
    delete process.env.APP_BASE_URL;

    mockPasswordOk.mockReturnValue(true);
    mockIsEmail.mockReturnValue(true);
    mockBcrypt.hash.mockResolvedValue('hashed-password');
    mockBcrypt.compare.mockResolvedValue(true);
    mockPostmark.sendMail.mockResolvedValue({ MessageID: 'welcome-message' });
    mockNotifyAdmins.mockResolvedValue(undefined);
    mockPartnerService.getPartnerByUserId.mockResolvedValue(ACTIVE_PARTNER);
    mockPartnerService.getBalance.mockResolvedValue({
      availableBalance: 2500,
      maturingBalance: 0,
      totalEarned: 2500,
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
    mockPartnerService.isWithinAttributionWindow.mockImplementation(
      createdAt => Date.now() - new Date(createdAt).getTime() <= 30 * 86400000
    );
    mockPartnerService.getCodeHistory.mockResolvedValue([]);
    mockDb.read.mockResolvedValue([]);
    mockDb.find.mockResolvedValue([]);
    mockDb.findOne.mockResolvedValue(null);
    mockDb.insertOne.mockResolvedValue({ id: 'persisted' });
    mockDb.updateOne.mockResolvedValue({ modified: 1 });
  });

  afterEach(() => {
    delete process.env.CASHOUT_DENOMINATIONS;
    delete process.env.BASE_URL;
    delete process.env.APP_BASE_URL;
  });

  it('registers a partner and returns the generated referral identity', async () => {
    process.env.BASE_URL = 'https://event-flow.co.uk';
    mockPartnerService.createPartner.mockResolvedValue({
      id: 'prt_created',
      refCode: 'p_CREATED',
    });

    const response = await request(app).post('/api/partner/register').send({
      firstName: '  Jane  ',
      lastName: '  Smith  ',
      email: 'JANE@EXAMPLE.COM',
      password: 'Password123',
      location: ' Cardiff ',
      company: ' Event Community ',
    });

    expect(response.status).toBe(201);
    expect(response.body.partner.refCode).toBe('p_CREATED');
    expect(mockDb.insertOne).toHaveBeenCalledWith(
      'users',
      expect.objectContaining({
        name: 'Jane Smith',
        email: 'jane@example.com',
        location: 'Cardiff',
        company: 'Event Community',
        role: 'partner',
      })
    );
    expect(mockPostmark.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@example.com',
        templateData: expect.objectContaining({
          refLink: 'https://event-flow.co.uk/auth?ref=p_CREATED&role=supplier',
        }),
      })
    );
    expect(mockNotifyAdmins).toHaveBeenCalled();
    expect(mockJwtSign).toHaveBeenCalled();
    expect(mockSetAuthCookie).toHaveBeenCalledWith(expect.anything(), 'signed-partner-token', {
      remember: true,
    });
  });

  it('validates registration inputs and duplicate accounts', async () => {
    expect((await request(app).post('/api/partner/register').send({})).status).toBe(400);

    mockIsEmail.mockReturnValueOnce(false);
    expect(
      (
        await request(app).post('/api/partner/register').send({
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'not-an-email',
        })
      ).status
    ).toBe(400);

    mockPasswordOk.mockReturnValueOnce(false);
    expect(
      (
        await request(app).post('/api/partner/register').send({
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
          password: 'weak',
        })
      ).status
    ).toBe(400);

    mockDb.findOne.mockResolvedValueOnce({ id: 'usr_existing' });
    expect(
      (
        await request(app).post('/api/partner/register').send({
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
          password: 'Password123',
          location: 'Cardiff',
        })
      ).status
    ).toBe(409);
  });

  it('returns the live programme configuration and profile summary', async () => {
    process.env.CASHOUT_DENOMINATIONS = '20,15,20,bad';
    mockDb.findOne.mockResolvedValueOnce({
      id: 'usr_partner_001',
      firstName: 'Jane',
      lastName: 'Smith',
      name: 'Jane Smith',
      company: 'Event Community',
      email: 'jane@example.com',
    });

    const response = await request(app).get('/api/partner/me');

    expect(response.status).toBe(200);
    expect(response.body.config).toEqual({
      pointsPerGbp: 100,
      maturityDays: 30,
      attributionDays: 30,
      minimumCashoutGbp: 15,
      cashoutDenominations: [15, 20],
      cashoutMethods: ['amazon_voucher', 'prepaid_debit_card'],
    });
    expect(response.body.credits).toEqual(
      expect.objectContaining({
        pendingPoints: 125,
        pendingReview: 15,
      })
    );
    expect(response.body.partner.refLink).toContain('ref=p_ROUTE01');
  });

  it('projects complete and expired referrals with masked identities and potential points', async () => {
    const activeDate = daysAgo(2);
    const expiredDate = daysAgo(45);
    const activeExpiry = new Date(new Date(activeDate).getTime() + 30 * 86400000).toISOString();

    mockPartnerService.listReferralsByPartnerId.mockResolvedValue([
      {
        id: 'ref_active',
        supplierUserId: 'usr_supplier_active',
        supplierCreatedAt: activeDate,
        attributionExpiresAt: activeExpiry,
        packageQualified: true,
        packageQualifiedAt: daysAgo(1),
        subscriptionQualified: true,
        subscriptionQualifiedAt: daysAgo(1),
        source: 'facebook',
        medium: 'social',
        campaign: 'launch',
      },
      {
        id: 'ref_expired',
        supplierUserId: 'usr_supplier_expired',
        supplierCreatedAt: expiredDate,
        packageQualified: false,
        subscriptionQualified: false,
      },
    ]);
    mockPartnerService.getReviewQualifications.mockResolvedValue(
      new Map([['usr_supplier_active', daysAgo(1)]])
    );
    mockDb.read.mockResolvedValue([
      { id: 'usr_supplier_active', name: 'Active Supplier' },
      { id: 'usr_supplier_expired', company: 'Expired Events' },
    ]);
    mockPartnerService.getBalance.mockResolvedValue({
      availableBalance: 130,
      transactions: [
        {
          supplierUserId: 'usr_supplier_active',
          type: 'REFERRAL_SIGNUP_BONUS',
          amount: 5,
        },
        { supplierUserId: 'usr_supplier_active', type: 'PACKAGE_BONUS', amount: 10 },
        { supplierUserId: 'usr_supplier_active', type: 'FIRST_REVIEW_BONUS', amount: 15 },
        { supplierUserId: 'usr_supplier_active', type: 'SUBSCRIPTION_BONUS', amount: 100 },
        {
          supplierUserId: 'usr_supplier_active',
          type: 'CASHOUT_HOLD',
          amount: -100,
        },
        {
          supplierUserId: 'usr_supplier_expired',
          type: 'REFERRAL_SIGNUP_BONUS',
          amount: 5,
        },
      ],
    });

    const response = await request(app).get('/api/partner/referrals');

    expect(response.status).toBe(200);
    const active = response.body.items.find(item => item.id === 'ref_active');
    const expired = response.body.items.find(item => item.id === 'ref_expired');
    expect(active).toEqual(
      expect.objectContaining({
        supplierName: 'A***',
        state: 'completed',
        reviewQualified: true,
        pointsEarned: 130,
        potentialPoints: 0,
        source: 'facebook',
      })
    );
    expect(active.daysRemaining).toBeGreaterThan(0);
    expect(expired).toEqual(
      expect.objectContaining({
        supplierName: 'E***',
        state: 'expired',
        reviewQualified: false,
        pointsEarned: 5,
        potentialPoints: 15,
        daysRemaining: 0,
      })
    );
  });

  it('enriches transactions with maturity, supplier and redemption states', async () => {
    mockDb.read.mockResolvedValue([{ id: 'usr_supplier', name: 'Supplier One' }]);
    mockPartnerService.getBalance.mockResolvedValue({
      transactions: [
        {
          id: 'txn_reward',
          supplierUserId: 'usr_supplier',
          type: 'PACKAGE_BONUS',
          amount: 10,
          createdAt: daysAgo(1),
        },
        {
          id: 'txn_adjustment',
          supplierUserId: null,
          type: 'ADJUSTMENT',
          amount: 20,
          createdAt: daysAgo(1),
        },
        {
          id: 'txn_hold',
          type: 'CASHOUT_HOLD',
          amount: -1500,
          createdAt: daysAgo(1),
        },
        {
          id: 'txn_release',
          type: 'CASHOUT_RELEASE',
          amount: 1500,
          createdAt: daysAgo(1),
        },
        {
          id: 'txn_redeem',
          type: 'REDEEM',
          amount: -1500,
          createdAt: daysAgo(1),
        },
      ],
    });

    const response = await request(app).get('/api/partner/transactions');

    expect(response.status).toBe(200);
    expect(response.body.items.find(item => item.id === 'txn_reward')).toEqual(
      expect.objectContaining({
        supplierName: 'S***',
        availability: 'maturing',
        maturesAt: expect.any(String),
      })
    );
    expect(response.body.items.find(item => item.id === 'txn_adjustment').maturesAt).toBeNull();
    expect(response.body.items.find(item => item.id === 'txn_hold').availability).toBe('held');
    expect(response.body.items.find(item => item.id === 'txn_release').availability).toBe(
      'released'
    );
    expect(response.body.items.find(item => item.id === 'txn_redeem').availability).toBe(
      'redeemed'
    );
  });

  it('calculates partner performance and reward progress', async () => {
    const activeDate = daysAgo(2);
    const expiredDate = daysAgo(45);
    mockPartnerService.getBalance.mockResolvedValue({
      availableBalance: 750,
      signupBonusTotal: 15,
      packageBonusTotal: 20,
      reviewBonusTotal: 15,
      subscriptionBonusTotal: 100,
      adjustmentTotal: 5,
      transactions: [],
    });
    mockPartnerService.listReferralsByPartnerId.mockResolvedValue([
      {
        supplierUserId: 'usr_complete',
        supplierCreatedAt: activeDate,
        packageQualified: true,
        subscriptionQualified: true,
      },
      {
        supplierUserId: 'usr_partial',
        supplierCreatedAt: activeDate,
        packageQualified: true,
        subscriptionQualified: false,
      },
      {
        supplierUserId: 'usr_expired',
        supplierCreatedAt: expiredDate,
        packageQualified: false,
        subscriptionQualified: false,
      },
    ]);
    mockPartnerService.getReviewQualifications.mockResolvedValue(
      new Map([['usr_complete', daysAgo(1)]])
    );

    const response = await request(app).get('/api/partner/stats');

    expect(response.status).toBe(200);
    expect(response.body.cashoutProgress).toEqual(
      expect.objectContaining({
        availablePoints: 750,
        minCashoutPoints: 1500,
        pointsToNextCashout: 750,
        percentToNextCashout: 50,
      })
    );
    expect(response.body.referralActivity).toEqual({
      total: 3,
      active: 2,
      qualified: 2,
      completed: 1,
      paidConversions: 1,
    });
    expect(response.body.breakdown.review).toBe(15);
  });

  it('regenerates referral codes and returns code history', async () => {
    process.env.APP_BASE_URL = 'https://preview.event-flow.co.uk';
    mockPartnerService.regenerateCode.mockResolvedValue({
      oldCode: 'p_ROUTE01',
      newCode: 'p_ROUTE02',
    });
    mockPartnerService.getCodeHistory.mockResolvedValue([
      { refCode: 'p_ROUTE01', archivedAt: '2026-07-01T00:00:00.000Z' },
    ]);

    const regenerated = await request(app).post('/api/partner/regenerate-code').send({});
    const history = await request(app).get('/api/partner/code-history');

    expect(regenerated.status).toBe(200);
    expect(regenerated.body.refLink).toBe(
      'https://preview.event-flow.co.uk/auth?ref=p_ROUTE02&role=supplier'
    );
    expect(history.status).toBe(200);
    expect(history.body.items).toHaveLength(1);
  });

  it('allows disabled partners to create and continue restricted account-access support', async () => {
    const disabledPartner = { ...ACTIVE_PARTNER, status: 'disabled' };
    mockPartnerService.getPartnerByUserId.mockResolvedValue(disabledPartner);
    const ticket = {
      id: 'tkt_access',
      senderId: 'usr_partner_001',
      senderType: 'partner',
      senderName: 'Test Partner',
      senderEmail: 'partner@example.com',
      subject: 'Account access',
      message: 'Please review the restriction.',
      status: 'resolved',
      priority: 'high',
      category: 'partner_account_access',
      responses: [],
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    };
    mockDb.findOne.mockImplementation(async (collection, filter) => {
      if (collection === 'users') {
        return { name: 'Test Partner', email: 'partner@example.com' };
      }
      if (collection === 'tickets' && filter.id === ticket.id) {
        return ticket;
      }
      return null;
    });
    mockDb.find.mockResolvedValue([ticket]);

    const created = await request(app).post('/api/partner/support-ticket').send({
      subject: 'Account access',
      message: 'Please review the restriction.',
    });
    const listed = await request(app).get('/api/partner/support-tickets');
    const detail = await request(app).get(`/api/partner/support-tickets/${ticket.id}`);
    const replied = await request(app)
      .post(`/api/partner/support-tickets/${ticket.id}/reply`)
      .send({ message: 'Here is the additional information.' });

    expect(created.status).toBe(201);
    expect(mockDb.insertOne).toHaveBeenCalledWith(
      'tickets',
      expect.objectContaining({
        priority: 'high',
        category: 'partner_account_access',
      })
    );
    expect(listed.status).toBe(200);
    expect(listed.body.disabled).toBe(true);
    expect(listed.body.items[0].responseCount).toBe(0);
    expect(detail.status).toBe(200);
    expect(replied.status).toBe(201);
    expect(mockDb.updateOne).toHaveBeenCalledWith(
      'tickets',
      { id: ticket.id },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'open',
          lastReplyBy: 'partner',
          responses: [expect.objectContaining({ authorRole: 'partner', isStaff: false })],
        }),
      })
    );
  });

  it('updates profile identity and changes a valid password', async () => {
    mockDb.findOne.mockResolvedValue({
      id: 'usr_partner_001',
      firstName: 'Jane',
      lastName: 'Smith',
      passwordHash: 'existing-hash',
    });

    const profile = await request(app).patch('/api/partner/me').send({
      firstName: 'Janet',
      lastName: 'Jones',
      company: 'New Community',
    });
    const password = await request(app).post('/api/partner/change-password').send({
      currentPassword: 'Password123',
      newPassword: 'NewPassword456',
    });

    expect(profile.status).toBe(200);
    expect(profile.body.userProfile).toEqual(
      expect.objectContaining({
        firstName: 'Janet',
        lastName: 'Jones',
        name: 'Janet Jones',
        company: 'New Community',
      })
    );
    expect(password.status).toBe(200);
    expect(mockBcrypt.compare).toHaveBeenCalledWith('Password123', 'existing-hash');
    expect(mockDb.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'usr_partner_001' },
      expect.objectContaining({ passwordHash: 'hashed-password' })
    );
  });

  it('returns 404 from every partner-scoped read/write endpoint when the user has no partner record', async () => {
    mockPartnerService.getPartnerByUserId.mockResolvedValue(null);

    const endpoints = [
      () => request(app).get('/api/partner/me'),
      () => request(app).get('/api/partner/referrals'),
      () => request(app).get('/api/partner/transactions'),
      () => request(app).get('/api/partner/stats'),
      () => request(app).post('/api/partner/regenerate-code'),
      () => request(app).get('/api/partner/code-history'),
      () => request(app).post('/api/partner/support-ticket').send({ subject: 'x', message: 'y' }),
      () => request(app).get('/api/partner/support-tickets'),
      () => request(app).get('/api/partner/support-tickets/tkt_1'),
      () => request(app).post('/api/partner/support-tickets/tkt_1/reply').send({ message: 'hi' }),
      () => request(app).post('/api/partner/cashout-requests').send({ amount: 1000 }),
    ];

    for (const call of endpoints) {
      const response = await call();
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Partner account not found');
    }
  });

  it('returns the disabled response from every status-gated endpoint for a disabled partner', async () => {
    mockPartnerService.getPartnerByUserId.mockResolvedValue({
      ...ACTIVE_PARTNER,
      status: 'disabled',
    });

    const endpoints = [
      () => request(app).get('/api/partner/me'),
      () => request(app).get('/api/partner/referrals'),
      () => request(app).get('/api/partner/transactions'),
      () => request(app).get('/api/partner/stats'),
      () => request(app).post('/api/partner/regenerate-code'),
      () => request(app).get('/api/partner/code-history'),
      () => request(app).post('/api/partner/cashout-requests').send({ amount: 1000 }),
    ];

    for (const call of endpoints) {
      const response = await call();
      expect(response.status).toBe(403);
    }
  });

  it('rejects registration missing a location', async () => {
    const response = await request(app).post('/api/partner/register').send({
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
      password: 'Password123',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Location is required');
  });

  it('returns 404 when a support ticket does not exist', async () => {
    mockDb.findOne.mockResolvedValue(null);

    const getResponse = await request(app).get('/api/partner/support-tickets/tkt_missing');
    expect(getResponse.status).toBe(404);
    expect(getResponse.body.error).toBe('Support ticket not found');

    const replyResponse = await request(app)
      .post('/api/partner/support-tickets/tkt_missing/reply')
      .send({ message: 'hello' });
    expect(replyResponse.status).toBe(404);
    expect(replyResponse.body.error).toBe('Support ticket not found');
  });

  it('rejects an empty support ticket reply message', async () => {
    mockDb.findOne.mockResolvedValue({
      id: 'tkt_1',
      senderId: 'usr_partner_001',
      senderType: 'partner',
      status: 'open',
    });

    const response = await request(app)
      .post('/api/partner/support-tickets/tkt_1/reply')
      .send({ message: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Reply message is required');
  });
});
