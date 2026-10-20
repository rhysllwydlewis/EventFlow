'use strict';

/**
 * POST /api/v1/supplier/request-review sends a real email from the platform to
 * an address the supplier typed in. It must therefore be gated exactly like the
 * sibling supplier write routes (packages, messaging): the account's email has
 * to be verified and the supplier profile approved. These tests use the real
 * requireVerifiedUser / requireApprovedSupplier middleware over an in-memory
 * database; only authentication, CSRF and rate limiting are stubbed.
 */

const mockStore = { users: [], suppliers: [], reviewRequests: [] };

/**
 * Minimal in-memory db-unified stand-in (equality filters only).
 *
 * @param {string} name - Collection name
 * @returns {Object[]} Rows of that collection
 */
function mockRows(name) {
  return mockStore[name];
}

/**
 * Whether a row matches every equality condition in a filter.
 *
 * @param {Object} row - Stored row
 * @param {Object} filter - Equality conditions
 * @returns {boolean} True when every condition holds
 */
function mockMatches(row, filter) {
  return Object.entries(filter).every(([key, value]) => row[key] === value);
}

jest.mock('../../db-unified', () => ({
  find: jest.fn(async (name, filter) => mockRows(name).filter(row => mockMatches(row, filter))),
  findOne: jest.fn(
    async (name, filter) => mockRows(name).find(row => mockMatches(row, filter)) || null
  ),
  insertOne: jest.fn(async (name, document) => {
    mockRows(name).push({ ...document });
    return document;
  }),
  updateOne: jest.fn(async (name, filter, update) => {
    const row = mockRows(name).find(item => mockMatches(item, filter));
    if (row && update.$set) {
      Object.assign(row, update.$set);
    }
    return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
  }),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { createReviewRequestRouter } = require('../../routes/review-requests');

/**
 * No-op Express middleware.
 *
 * @param {Object} req - Request
 * @param {Object} res - Response
 * @param {Function} next - Next callback
 * @returns {void}
 */
function passThrough(req, res, next) {
  next();
}

/**
 * Build an app whose only stubs are authentication, CSRF and rate limiting.
 *
 * @param {Object} user - The authenticated user
 * @param {Function} sendMail - Email sender spy
 * @returns {Object} Express app
 */
function buildApp(user, sendMail) {
  const app = express();
  app.use(express.json());
  app.use(
    createReviewRequestRouter({
      db: require('../../db-unified'),
      sendMail,
      authRequired(req, res, next) {
        req.user = user;
        next();
      },
      csrfProtection: passThrough,
      writeLimiter: passThrough,
      getBaseUrl: () => 'https://event-flow.co.uk',
      fromAddress: 'hello@event-flow.co.uk',
    })
  );
  return app;
}

const SUPPLIER_USER = { id: 'user-1', role: 'supplier' };
const PATHS = ['/api/v1/supplier/request-review', '/api/supplier/request-review'];

describe('request-review requires a verified email and an approved supplier', () => {
  let sendMail;

  beforeEach(() => {
    sendMail = jest
      .fn()
      .mockResolvedValue({ provider: 'postmark', sentAt: '2026-07-16T09:00:00Z' });
    mockStore.users = [{ id: 'user-1', verified: true }];
    mockStore.suppliers = [
      { id: 'sup-1', ownerUserId: 'user-1', name: 'Moor Audio', approved: true },
    ];
    mockStore.reviewRequests = [];
  });

  test.each(PATHS)('sends the email for a verified, approved supplier (%s)', async path => {
    const res = await request(buildApp(SUPPLIER_USER, sendMail))
      .post(path)
      .send({ customerEmail: 'customer@example.com' });

    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  test.each(PATHS)('refuses an unverified email with EMAIL_NOT_VERIFIED (%s)', async path => {
    mockStore.users = [{ id: 'user-1', verified: false }];

    const res = await request(buildApp(SUPPLIER_USER, sendMail))
      .post(path)
      .send({ customerEmail: 'customer@example.com' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(res.body.error).toBeTruthy();
    expect(sendMail).not.toHaveBeenCalled();
    expect(mockStore.reviewRequests).toHaveLength(0);
  });

  test.each(PATHS)('refuses an unapproved supplier with SUPPLIER_NOT_APPROVED (%s)', async path => {
    mockStore.suppliers = [
      { id: 'sup-1', ownerUserId: 'user-1', name: 'Moor Audio', approved: false },
    ];

    const res = await request(buildApp(SUPPLIER_USER, sendMail))
      .post(path)
      .send({ customerEmail: 'customer@example.com' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUPPLIER_NOT_APPROVED');
    expect(sendMail).not.toHaveBeenCalled();
    expect(mockStore.reviewRequests).toHaveLength(0);
  });

  test('treats a supplier with no approval flag as unapproved', async () => {
    mockStore.suppliers = [{ id: 'sup-1', ownerUserId: 'user-1', name: 'Moor Audio' }];

    const res = await request(buildApp(SUPPLIER_USER, sendMail))
      .post(PATHS[0])
      .send({ customerEmail: 'customer@example.com' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUPPLIER_NOT_APPROVED');
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('a verified supplier-verification state alone does not stand in for approval', async () => {
    mockStore.suppliers = [
      {
        id: 'sup-1',
        ownerUserId: 'user-1',
        name: 'Moor Audio',
        approved: false,
        verified: true,
        verificationStatus: 'approved',
      },
    ];

    const res = await request(buildApp(SUPPLIER_USER, sendMail))
      .post(PATHS[0])
      .send({ customerEmail: 'customer@example.com' });

    expect(res.status).toBe(403);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('checks the email gate before the approval gate', async () => {
    mockStore.users = [{ id: 'user-1', verified: false }];
    mockStore.suppliers = [
      { id: 'sup-1', ownerUserId: 'user-1', name: 'Moor Audio', approved: false },
    ];

    const res = await request(buildApp(SUPPLIER_USER, sendMail))
      .post(PATHS[0])
      .send({ customerEmail: 'customer@example.com' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  test('a signed-in non-supplier is still turned away', async () => {
    mockStore.users = [{ id: 'user-9', verified: true }];

    const res = await request(buildApp({ id: 'user-9', role: 'customer' }, sendMail))
      .post(PATHS[0])
      .send({ customerEmail: 'customer@example.com' });

    expect(res.status).toBe(403);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('the read-only history route is not gated, so an unapproved supplier can still see it', async () => {
    mockStore.suppliers = [
      { id: 'sup-1', ownerUserId: 'user-1', name: 'Moor Audio', approved: false },
    ];

    const res = await request(buildApp(SUPPLIER_USER, sendMail)).get(
      '/api/v1/supplier/review-requests'
    );

    expect(res.status).toBe(200);
  });
});
