'use strict';

/**
 * Admin Partners: the list is built from a handful of reads (not one per partner), a points
 * adjustment is capped and cannot leave a negative balance, and every status, payout and
 * credit change is written to the audit log.
 */

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    next();
  },
  roleRequired: () => (req, res, next) => next(),
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (req, res, next) => next() }));
jest.mock('../../middleware/audit', () => ({
  auditLog: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  find: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../../store', () => ({ uid: jest.fn(prefix => `${prefix}_new`) }));
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../services/partnerService', () => {
  const actual = jest.requireActual('../../services/partnerService');
  return {
    ...actual,
    listPartners: jest.fn(),
    getPartnerById: jest.fn(),
    getBalance: jest.fn(),
    setPartnerStatus: jest.fn().mockResolvedValue({}),
    applyAdminAdjustment: jest.fn(),
  };
});

const express = require('express');
const request = require('supertest');
const dbUnified = require('../../db-unified');
const { auditLog } = require('../../middleware/audit');
const partnerService = require('../../services/partnerService');
const { AUDIT_ACTIONS } = require('../../middleware/audit-actions');

const router = require('../../routes/admin-partner');

const app = express();
app.use(express.json());
app.use('/api/admin/partners', router);

const HOUR = 3600000;
const long = (hours = 24 * 60) => new Date(Date.now() - hours * HOUR).toISOString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/admin/partners', () => {
  const partners = [
    { id: 'p1', userId: 'u1', refCode: 'AAA', status: 'active', createdAt: long() },
    { id: 'p2', userId: 'u2', refCode: 'BBB', status: 'active', createdAt: long() },
    { id: 'p3', userId: 'gone', refCode: 'CCC', status: 'active', createdAt: long() },
    { id: 'p4', userId: 'u1', refCode: 'DDD', status: 'deleted', createdAt: long() },
  ];
  const users = [
    { id: 'u1', name: 'Ada', email: 'ada@example.com' },
    { id: 'u2', name: 'Bo', email: 'bo@example.com' },
  ];
  const transactions = [
    { partnerId: 'p1', type: 'PACKAGE_BONUS', amount: 100, createdAt: long() },
    { partnerId: 'p1', type: 'ADJUSTMENT', amount: -30, createdAt: long() },
    { partnerId: 'p2', type: 'SUBSCRIPTION_BONUS', amount: 50, createdAt: long() },
  ];
  const referrals = [
    { partnerId: 'p1', packageQualified: true },
    { partnerId: 'p1', packageQualified: false, subscriptionQualified: false },
    { partnerId: 'p2', subscriptionQualified: true },
  ];

  beforeEach(() => {
    partnerService.listPartners.mockResolvedValue(partners);
    dbUnified.read.mockImplementation(async collection => {
      const data = {
        users,
        partner_credit_transactions: transactions,
        partner_referrals: referrals,
      };
      return data[collection] || [];
    });
  });

  it('reads each collection once however many partners there are', async () => {
    await request(app).get('/api/admin/partners').expect(200);
    const collections = dbUnified.read.mock.calls.map(call => call[0]).sort();
    expect(collections).toEqual(['partner_credit_transactions', 'partner_referrals', 'users']);
    expect(dbUnified.find).not.toHaveBeenCalled();
    expect(partnerService.getBalance).not.toHaveBeenCalled();
  });

  it('gives each partner their own balance and referral counts', async () => {
    const res = await request(app).get('/api/admin/partners').expect(200);
    const byId = Object.fromEntries(res.body.items.map(item => [item.id, item]));
    expect(byId.p1.credits.balance).toBe(70);
    expect(byId.p1.credits.packageBonusTotal).toBe(100);
    expect(byId.p1.referralCount).toBe(2);
    expect(byId.p1.qualifiedCount).toBe(1);
    expect(byId.p2.credits.balance).toBe(50);
    expect(byId.p2.credits.subscriptionBonusTotal).toBe(50);
    expect(byId.p2.qualifiedCount).toBe(1);
  });

  it('leaves out deleted partners and partners whose user is gone', async () => {
    const res = await request(app).get('/api/admin/partners').expect(200);
    expect(res.body.items.map(item => item.id).sort()).toEqual(['p1', 'p2']);
  });

  it('searches by name or email', async () => {
    const res = await request(app).get('/api/admin/partners?search=bo@').expect(200);
    expect(res.body.items.map(item => item.id)).toEqual(['p2']);
  });
});

describe('POST /api/admin/partners/:id/credits', () => {
  const post = body => request(app).post('/api/admin/partners/p1/credits').send(body);

  beforeEach(() => {
    partnerService.getPartnerById.mockResolvedValue({ id: 'p1', refCode: 'AAA' });
    partnerService.getBalance.mockResolvedValue({ balance: 100 });
    partnerService.applyAdminAdjustment.mockResolvedValue({
      id: 'txn-1',
      notes: 'Goodwill',
    });
  });

  it('applies an adjustment and records who did it, with the balance before and after', async () => {
    const res = await post({ amount: 50, notes: ' Goodwill ' }).expect(200);
    expect(res.body.ok).toBe(true);
    expect(partnerService.applyAdminAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ partnerId: 'p1', amount: 50, adminUserId: 'admin-1' })
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-1',
        action: AUDIT_ACTIONS.PARTNER_CREDITS_ADJUSTED,
        targetType: 'partner',
        targetId: 'p1',
        details: expect.objectContaining({
          amount: 50,
          balanceBefore: 100,
          balanceAfter: 150,
          transactionId: 'txn-1',
        }),
      })
    );
  });

  it.each([10001, -10001])('refuses %i because it is over the limit', async amount => {
    const res = await post({ amount, notes: 'Typo' }).expect(400);
    expect(res.body.error).toMatch(/cannot be more than 10,000/);
    expect(partnerService.applyAdminAdjustment).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('accepts exactly the limit', async () => {
    await post({ amount: 10000, notes: 'Campaign prize' }).expect(200);
  });

  it('refuses a deduction that would take the balance below zero', async () => {
    const res = await post({ amount: -101, notes: 'Clawback' }).expect(400);
    expect(res.body.error).toMatch(/below zero \(current balance 100 points\)/);
    expect(partnerService.applyAdminAdjustment).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('allows a deduction that brings the balance to exactly zero', async () => {
    await post({ amount: -100, notes: 'Clawback' }).expect(200);
  });

  it.each([{ amount: 0, notes: 'None' }, { amount: 'abc', notes: 'None' }, { notes: 'None' }])(
    'refuses %j',
    async body => {
      await post(body).expect(400);
      expect(partnerService.applyAdminAdjustment).not.toHaveBeenCalled();
    }
  );

  it('requires a note', async () => {
    await post({ amount: 5, notes: ' x ' }).expect(400);
    expect(partnerService.applyAdminAdjustment).not.toHaveBeenCalled();
  });

  it('404s for a partner that does not exist, without changing anything', async () => {
    partnerService.getPartnerById.mockResolvedValue(null);
    await post({ amount: 5, notes: 'Hello' }).expect(404);
    expect(partnerService.applyAdminAdjustment).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/partners/:id/status', () => {
  const patch = body => request(app).patch('/api/admin/partners/p1/status').send(body);

  it('records disabling a partner in the audit log', async () => {
    partnerService.getPartnerById.mockResolvedValue({
      id: 'p1',
      refCode: 'AAA',
      status: 'active',
    });
    await patch({ status: 'disabled' }).expect(200);
    expect(partnerService.setPartnerStatus).toHaveBeenCalledWith('p1', 'disabled');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.PARTNER_STATUS_CHANGED,
        targetId: 'p1',
        details: { refCode: 'AAA', from: 'active', to: 'disabled' },
      })
    );
  });

  it('will not revive a deleted partner', async () => {
    partnerService.getPartnerById.mockResolvedValue({ id: 'p1', status: 'deleted' });
    await patch({ status: 'active' }).expect(400);
    expect(partnerService.setPartnerStatus).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('rejects a status that is not active or disabled', async () => {
    await patch({ status: 'banana' }).expect(400);
  });
});

describe('PATCH /api/admin/partners/payout-requests/:ticketId/status', () => {
  const patch = body =>
    request(app).patch('/api/admin/partners/payout-requests/t1/status').send(body);
  const ticket = {
    id: 't1',
    category: 'partner_payout',
    status: 'open',
    partnerId: 'p1',
    payoutPoints: 500,
    payoutValueGbp: '£5.00',
  };

  beforeEach(() => {
    dbUnified.read.mockResolvedValue([ticket]);
    dbUnified.updateOne.mockResolvedValue(true);
  });

  it('saves the status and records the change', async () => {
    const res = await patch({ status: 'resolved' }).expect(200);
    expect(res.body).toEqual({ ok: true, status: 'resolved' });
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'tickets',
      { id: 't1' },
      { $set: expect.objectContaining({ status: 'resolved' }) },
      { throwOnError: true }
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.PARTNER_PAYOUT_STATUS_CHANGED,
        targetId: 't1',
        details: expect.objectContaining({ from: 'open', to: 'resolved', partnerId: 'p1' }),
      })
    );
  });

  it('says so, and does not log a change, when the save did not happen', async () => {
    dbUnified.updateOne.mockResolvedValue(false);
    const res = await patch({ status: 'resolved' }).expect(500);
    expect(res.body.error).toMatch(/could not be saved/);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('404s for a ticket that is not a payout request', async () => {
    dbUnified.read.mockResolvedValue([{ ...ticket, category: 'support' }]);
    await patch({ status: 'closed' }).expect(404);
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });

  it('rejects an unknown status', async () => {
    await patch({ status: 'paid' }).expect(400);
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });
});

describe('summariseBalance', () => {
  it('matches what getBalance reports for the same transactions', async () => {
    const txns = [
      { type: 'PACKAGE_BONUS', amount: 100, createdAt: long() },
      { type: 'ADJUSTMENT', amount: -40, createdAt: long() },
    ];
    dbUnified.find.mockResolvedValue(txns);
    const actual = jest.requireActual('../../services/partnerService');
    const viaGetBalance = await actual.getBalance('p1');
    expect(actual.summariseBalance(txns)).toEqual(viaGetBalance);
    expect(viaGetBalance.balance).toBe(60);
  });
});

describe('Partners page script', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/pages/admin-partners-init.js'),
    'utf8'
  );

  it('calls AdminShared.api(url, method, body) for payout status, not an options object', () => {
    expect(source).toMatch(
      /payout-requests\/\$\{encodeURIComponent\(ticketId\)\}\/status`,\s*'PATCH',\s*\{ status: newStatus \}/
    );
    expect(source).not.toMatch(/payout-requests\/[^`]*`,\s*\{\s*method: 'PATCH'/);
  });

  it('asks before adjusting points and before ending a payout request', () => {
    expect(source).toMatch(/title: amount > 0 \? 'Add points\?' : 'Deduct points\?'/);
    expect(source).toMatch(/FINAL_PAYOUT_STATUSES = \['resolved', 'closed'\]/);
  });

  it('uses the same adjustment limit as the server', () => {
    expect(source).toMatch(/MAX_ADJUSTMENT_POINTS = 10000;/);
  });
});
