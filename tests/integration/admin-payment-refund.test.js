/**
 * POST /api/admin/payments/:id/refund — real endpoint test.
 *
 * services/paymentService.js processRefund was fully implemented but never
 * called from any route (confirmed by repo-wide grep before adding this).
 * This wires it up behind an admin-only endpoint and verifies the payment
 * record + audit log are updated to match.
 */
'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    next();
  },
  roleRequired: () => (_req, _res, next) => next(),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../middleware/audit', () => ({
  auditLog: mockAuditLog,
  auditMiddleware: () => (_req, _res, next) => next(),
  AUDIT_ACTIONS: {},
}));

let mockPayments = [];
const mockUpdateOne = jest.fn(async (collection, filter, update) => {
  if (collection === 'payments') {
    const payment = mockPayments.find(p => p.id === filter.id);
    if (payment) {
      Object.assign(payment, update.$set);
    }
  }
  return true;
});

jest.mock('../../db-unified', () => ({
  count: jest.fn(async () => 0),
  read: jest.fn(async () => []),
  write: jest.fn(async () => undefined),
  findWithOptions: jest.fn(async () => []),
  getDatabaseType: jest.fn(() => 'local'),
  findOne: jest.fn(async (collection, filter) => {
    if (collection === 'payments') {
      return mockPayments.find(p => p.id === filter.id) || null;
    }
    return null;
  }),
  updateOne: mockUpdateOne,
}));

const mockProcessRefund = jest.fn();
jest.mock('../../services/paymentService', () => ({
  processRefund: mockProcessRefund,
}));

process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
jest.mock('stripe', () => jest.fn(() => ({})));

const adminRoutes = require('../../routes/admin');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  return app;
}

describe('POST /api/admin/payments/:id/refund', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    mockPayments = [
      {
        id: 'pay_1',
        userId: 'user_1',
        stripePaymentId: 'pi_1',
        amount: 19,
        currency: 'gbp',
        status: 'succeeded',
        metadata: {},
      },
    ];
    mockProcessRefund.mockReset();
    mockAuditLog.mockClear();
    mockUpdateOne.mockClear();
  });

  it('issues a full refund and marks the payment refunded', async () => {
    mockProcessRefund.mockResolvedValue({
      id: 're_1',
      amount: 1900,
      currency: 'gbp',
      status: 'succeeded',
    });

    const res = await request(app)
      .post('/api/admin/payments/pay_1/refund')
      .send({ reason: 'requested_by_customer' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.refund).toMatchObject({ id: 're_1', amount: 19, currency: 'gbp' });
    expect(mockProcessRefund).toHaveBeenCalledWith('pi_1', null, 'requested_by_customer');
    expect(mockPayments[0].status).toBe('refunded');
    expect(mockPayments[0].metadata.refundId).toBe('re_1');
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment_refunded', targetId: 'pay_1' })
    );
  });

  it('passes a partial amount through to processRefund', async () => {
    mockProcessRefund.mockResolvedValue({
      id: 're_2',
      amount: 500,
      currency: 'gbp',
      status: 'succeeded',
    });

    await request(app).post('/api/admin/payments/pay_1/refund').send({ amount: 5 }).expect(200);

    expect(mockProcessRefund).toHaveBeenCalledWith('pi_1', 5, 'requested_by_customer');
  });

  it('returns 404 for an unknown payment', async () => {
    await request(app).post('/api/admin/payments/does-not-exist/refund').send({}).expect(404);
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });

  it('returns 400 for a payment with no Stripe payment intent', async () => {
    mockPayments[0].stripePaymentId = null;
    await request(app).post('/api/admin/payments/pay_1/refund').send({}).expect(400);
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });

  it('returns 400 for a payment that is already refunded', async () => {
    mockPayments[0].status = 'refunded';
    await request(app).post('/api/admin/payments/pay_1/refund').send({}).expect(400);
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });

  it('returns 500 with the Stripe error message when the refund fails', async () => {
    mockProcessRefund.mockRejectedValue(new Error('charge already refunded'));

    const res = await request(app).post('/api/admin/payments/pay_1/refund').send({}).expect(500);

    expect(res.body.message).toBe('charge already refunded');
    expect(mockPayments[0].status).toBe('succeeded');
  });
});
