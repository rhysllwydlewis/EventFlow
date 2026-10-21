'use strict';

/**
 * PUT /api/v2/admin/packages/:id applies only the content fields it lists. Ownership, approval,
 * featuring, ids and timestamps cannot be set through it. These run the real route.
 */

const request = require('supertest');
const express = require('express');

const mockPackages = [];
const mockUpdateOne = jest.fn(async () => true);

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
jest.mock('../../middleware/permissions', () => {
  const actual = jest.requireActual('../../middleware/permissions');
  return { ...actual, requirePermission: () => (_req, _res, next) => next() };
});
jest.mock('../../utils/auditTrail', () => ({
  createAuditLog: jest.fn(async () => undefined),
  queryAuditLogs: jest.fn(async () => []),
  getAuditLogById: jest.fn(async () => null),
  getUserAuditLogs: jest.fn(async () => []),
  getAuditStatistics: jest.fn(async () => ({})),
}));
jest.mock('../../db-unified', () => ({
  read: jest.fn(async collection => (collection === 'packages' ? mockPackages : [])),
  updateOne: (...args) => mockUpdateOne(...args),
}));

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/admin-v2');
  const app = express();
  app.use(express.json());
  app.use('/api/v2/admin', router);
  return app;
}

describe('PUT /api/v2/admin/packages/:id', () => {
  beforeEach(() => {
    mockUpdateOne.mockClear();
    mockPackages.length = 0;
    mockPackages.push({
      id: 'pkg-1',
      supplierId: 'sup-1',
      title: 'Old title',
      price: '£100',
      price_display: '£100',
      approved: false,
      featured: false,
    });
  });

  it('saves allowed content fields and keeps both price fields together', async () => {
    const res = await request(buildApp())
      .put('/api/v2/admin/packages/pkg-1')
      .send({ title: 'New title', price_display: '£250' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      title: 'New title',
      price: '£250',
      price_display: '£250',
    });
    expect(mockUpdateOne).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ supplierId: 'someone-else' }, 'supplierId'],
    [{ approved: true }, 'approved'],
    [{ featured: true }, 'featured'],
    [{ id: 'other' }, 'id'],
    [{ _id: 'x' }, '_id'],
    [{ createdAt: '2000-01-01' }, 'createdAt'],
    [{ title: 'ok', isAdmin: true }, 'isAdmin'],
  ])('refuses %j and writes nothing', async (body, field) => {
    const res = await request(buildApp()).put('/api/v2/admin/packages/pkg-1').send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FIELD_NOT_ALLOWED');
    expect(res.body.error).toContain(field);
    expect(mockUpdateOne).not.toHaveBeenCalled();
    expect(mockPackages[0].supplierId).toBe('sup-1');
    expect(mockPackages[0].approved).toBe(false);
  });

  it('answers 404 for a package that does not exist', async () => {
    const res = await request(buildApp()).put('/api/v2/admin/packages/nope').send({ title: 'x' });
    expect(res.status).toBe(404);
  });
});
