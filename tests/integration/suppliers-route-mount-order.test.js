'use strict';

/**
 * Route reachability under the real mount order.
 *
 * `tests/unit/pricing-hero-showcase.test.js` mounts routes/suppliers.js on a
 * bare app, which proves the handler works but not that a request can reach
 * it. It cannot: routes/index.js mounts routes/supplier-profile-safe.js at
 * `/api` *before* routes/suppliers.js, and that router owns `/suppliers/:id`.
 * It used to answer 404 for any id it could not find, which swallowed
 * `/api/suppliers/showcase` — the pricing hero's supplier strip silently
 * disappeared in production while every unit test passed.
 *
 * These tests mount the two routers in the same order routes/index.js does,
 * so a sibling path under `/api/suppliers` cannot be shadowed again.
 */

const express = require('express');
const request = require('supertest');

const supplierProfileSafeRoutes = require('../../routes/supplier-profile-safe');
const suppliersRoutes = require('../../routes/suppliers');

const USERS = [{ id: 'usr-1' }, { id: 'usr-2' }];

const SUPPLIERS = [
  { id: 'sup-1', name: 'Ivy House Barn', approved: true, ownerUserId: 'usr-1' },
  { id: 'sup-2', name: 'DJ Marcus Lane', approved: true, ownerUserId: 'usr-2' },
];

/**
 * Build an app with the same router order as routes/index.js.
 * @returns {import('express').Express} Configured app.
 */
function buildApp() {
  const deps = {
    dbUnified: {
      read: async collection => {
        if (collection === 'users') {
          return [...USERS];
        }
        if (collection === 'suppliers') {
          return SUPPLIERS.map(s => ({ ...s }));
        }
        return [];
      },
      find: async () => [],
      findOne: async (collection, filter) => {
        if (collection !== 'suppliers') {
          return null;
        }
        const supplier = SUPPLIERS.find(s => s.id === filter.id) || null;
        // routes/suppliers.js asks for `{ id, approved: true }`; honour the
        // filter so the fallthrough behaves as it does in the real app.
        if (supplier && filter.approved === true && !supplier.approved) {
          return null;
        }
        return supplier;
      },
      getDatabaseType: () => 'local',
    },
    authRequired: (_req, _res, next) => next(),
    roleRequired: () => (_req, _res, next) => next(),
    supplierAnalytics: { trackEvent: async () => {} },
    getUserFromCookie: () => null,
    supplierIsProActive: async () => false,
    logger: { info() {}, warn() {}, error() {} },
  };

  supplierProfileSafeRoutes.initializeDependencies(deps);
  suppliersRoutes.initializeDependencies(deps);

  const app = express();
  // The order routes/index.js uses. Reversing it would hide the bug.
  app.use('/api', supplierProfileSafeRoutes);
  app.use('/api', suppliersRoutes);
  return app;
}

describe('routers mounted under /api in routes/index.js order', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  it('lets /api/suppliers/showcase reach its own handler', async () => {
    const res = await request(app).get('/api/suppliers/showcase?limit=6').expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  it('still serves a real supplier profile from the safe router', async () => {
    // The fallthrough must not cost the safe router its own traffic.
    const res = await request(app).get('/api/suppliers/sup-1').expect(200);
    expect(res.body.id).toBe('sup-1');
  });

  it('still answers 404 for an id no supplier carries', async () => {
    // Falling through means a later router answers, but the caller sees the
    // same status and body as before.
    const res = await request(app).get('/api/suppliers/no-such-supplier').expect(404);
    expect(res.body.error).toBe('Supplier not found');
  });

  it('serves a real supplier the packages sub-path', async () => {
    const res = await request(app).get('/api/suppliers/sup-1/packages').expect(200);
    expect(res.body).toBeDefined();
  });

  it('falls through the packages sub-path for an id no supplier carries', async () => {
    // The same guard, on the sub-path. Without it a future
    // `/api/suppliers/<word>/packages` endpoint would be shadowed the same way.
    const res = await request(app).get('/api/suppliers/no-such-supplier/packages').expect(404);
    expect(res.body.error).toBe('Supplier not found');
  });

  it('does not let the profile router answer a sibling collection path', async () => {
    // The general form of the bug: any future /api/suppliers/<word> endpoint
    // has to be reachable, not read as an id.
    const res = await request(app).get('/api/suppliers/showcase').expect(200);
    expect(res.body.error).toBeUndefined();
  });
});
