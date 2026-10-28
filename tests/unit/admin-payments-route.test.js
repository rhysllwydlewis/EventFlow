'use strict';

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    next();
  },
  roleRequired: () => (req, res, next) => next(),
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (req, res, next) => next() }));
jest.mock('../../middleware/audit', () => {
  const actual = jest.requireActual('../../middleware/audit');
  return { ...actual, auditLog: jest.fn().mockResolvedValue({}) };
});

const mockStore = {};
jest.mock('../../db-unified', () => ({
  read: jest.fn(async name => {
    if (mockStore.failOn === name) {
      throw new Error('boom');
    }
    return mockStore[name] || [];
  }),
  findOne: jest.fn(),
  find: jest.fn(),
  updateOne: jest.fn(),
  uid: jest.fn(prefix => `${prefix}_1`),
}));
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

const app = () => {
  const server = express();
  server.use(express.json());
  server.use('/api/admin', require('../../routes/admin'));
  return server;
};

beforeEach(() => {
  Object.keys(mockStore).forEach(key => delete mockStore[key]);
  mockStore.users = [{ id: 'u1', name: 'Ada', email: 'ada@example.test' }];
  mockStore.payments = [
    {
      id: 'pay_1',
      userId: 'u1',
      stripePaymentId: 'cs_1',
      amount: 0,
      status: 'succeeded',
      metadata: { planId: 'pro', billingInterval: 'month' },
      createdAt: new Date().toISOString(),
    },
  ];
  mockStore.invoices = [
    { status: 'paid', amount: 15, stripePaymentIntentId: 'cs_1', paidAt: new Date().toISOString() },
  ];
  mockStore.subscriptions = [{ status: 'active', plan: 'pro', billingInterval: 'month' }];
});

describe('GET /api/admin/payments', () => {
  it('returns rows mapped from real records, with the headline numbers', async () => {
    const response = await request(app()).get('/api/admin/payments');
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      customerName: 'Ada',
      planId: 'pro_monthly',
      amount: 15,
      statusGroup: 'paid',
    });
    expect(response.body.summary).toMatchObject({
      totalRevenue: 15,
      activeSubscriptions: 1,
      totalTransactions: 1,
    });
  });

  it('answers with empty, valid data when nothing has been recorded', async () => {
    Object.keys(mockStore).forEach(key => delete mockStore[key]);
    const response = await request(app()).get('/api/admin/payments');
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
    expect(response.body.summary.totalRevenue).toBe(0);
  });

  it('says so when a collection cannot be read, instead of showing zeros', async () => {
    mockStore.failOn = 'invoices';
    const response = await request(app()).get('/api/admin/payments');
    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Failed to load payments');
  });
});

describe('financial reads are strict', () => {
  it('asks the database to fail loudly rather than fall back to a local copy', async () => {
    const dbUnified = require('../../db-unified');
    dbUnified.read.mockClear();
    await request(app()).get('/api/admin/payments').expect(200);
    const strictReads = dbUnified.read.mock.calls.filter(
      ([name, options]) =>
        ['payments', 'users', 'invoices', 'subscriptions'].includes(name) &&
        options &&
        options.throwOnError === true
    );
    expect(strictReads.map(([name]) => name).sort()).toEqual([
      'invoices',
      'payments',
      'subscriptions',
      'users',
    ]);
  });
});
