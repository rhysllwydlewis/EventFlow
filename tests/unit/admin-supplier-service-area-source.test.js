/**
 * Admin-assigned service areas must be tagged `source: 'admin'` so a
 * supplier's own self-service picker (routes/supplier-management.js) can
 * never remove or replace them. See PATCH /api/admin/suppliers/:id.
 */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = { id: 'admin-test', role: 'admin', email: 'admin@example.com' };
    next();
  },
  roleRequired: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../middleware/audit', () => ({
  auditLog: jest.fn(),
  auditMiddleware: () => (req, res, next) => next(),
  AUDIT_ACTIONS: { SUPPLIER_EDITED: 'supplier_edited' },
}));

describe('PUT /api/admin/suppliers/:id — service area source tagging', () => {
  let express;
  let request;
  let mockDb;
  let stored;
  let builtApp;

  beforeEach(() => {
    jest.resetModules();
    express = require('express');
    request = require('supertest');

    stored = {
      id: 'sup1',
      ownerUserId: 'u1',
      name: 'Test Supplier',
      approved: true,
      serviceAreas: [],
    };

    mockDb = {
      read: jest.fn(async collection => (collection === 'suppliers' ? [stored] : [])),
      find: jest.fn(async () => []),
      findOne: jest.fn(async (collection, filter) =>
        collection === 'suppliers' && filter.id === stored.id ? stored : null
      ),
      updateOne: jest.fn(async (_collection, _filter, update) => {
        Object.assign(stored, update.$set || {});
        return true;
      }),
    };
    jest.doMock('../../db-unified', () => mockDb);

    const routes = require('../../routes/admin-user-management');
    builtApp = express();
    builtApp.use(express.json());
    builtApp.use('/api/admin', routes);
  });

  function app() {
    return builtApp;
  }

  it('tags a city the admin assigns as source: admin', async () => {
    const res = await request(app())
      .put('/api/admin/suppliers/sup1')
      .send({ serviceAreas: [{ type: 'city', slug: 'cardiff' }] });

    expect(res.status).toBe(200);
    expect(stored.serviceAreas).toEqual([{ type: 'city', slug: 'cardiff', source: 'admin' }]);
  });

  it('does not trust a source the admin request body tries to set on a non-city area', async () => {
    const res = await request(app())
      .put('/api/admin/suppliers/sup1')
      .send({ serviceAreas: [{ type: 'radius', miles: 20 }] });

    expect(res.status).toBe(200);
    expect(stored.serviceAreas).toEqual([{ type: 'radius', miles: 20 }]);
  });

  it('drops unrecognised service area shapes rather than storing them raw', async () => {
    const res = await request(app())
      .put('/api/admin/suppliers/sup1')
      .send({ serviceAreas: [{ type: 'city', slug: 'not-a-real-city' }, { type: 'planet' }] });

    expect(res.status).toBe(200);
    expect(stored.serviceAreas).toEqual([]);
  });

  it('keeps an admin-assigned city alongside a nationwide claim set in the same request', async () => {
    // sanitiseServiceAreas() ordinarily drops a city pick once nationwide is
    // present, on the assumption it's a redundant self-service pick — an
    // admin assignment is not part of that pool and must survive.
    const res = await request(app())
      .put('/api/admin/suppliers/sup1')
      .send({ serviceAreas: [{ type: 'nationwide' }, { type: 'city', slug: 'cardiff' }] });

    expect(res.status).toBe(200);
    expect(stored.serviceAreas).toEqual(
      expect.arrayContaining([
        { type: 'nationwide' },
        { type: 'city', slug: 'cardiff', source: 'admin' },
      ])
    );
  });
});
