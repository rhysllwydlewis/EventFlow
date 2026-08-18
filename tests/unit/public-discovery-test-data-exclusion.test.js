'use strict';

/**
 * Public discovery endpoints must never surface `isTest` suppliers/packages
 * (EF-QA-009). Exercises the isTest exclusion added to each endpoint in
 * routes/suppliers.js directly, since several of these paths are shadowed by
 * routes/supplier-profile-safe.js when mounted through the full app (see
 * tests/integration/suppliers-route-mount-order.test.js).
 */

const express = require('express');
const request = require('supertest');

const suppliersRouter = require('../../routes/suppliers');

const USERS = [{ id: 'usr-real' }, { id: 'usr-test' }];

const SUPPLIERS = [
  { id: 'sup-real', name: 'Real Supplier', approved: true, ownerUserId: 'usr-real' },
  {
    id: 'sup-test',
    name: 'Tester 2026',
    approved: true,
    isTest: true,
    ownerUserId: 'usr-test',
  },
];

const PACKAGES = [
  { id: 'pkg-real', supplierId: 'sup-real', title: 'Real Package', approved: true },
  // Test package under an otherwise-real supplier: package-level isTest must
  // exclude it on its own, independent of the supplier's own flag.
  {
    id: 'pkg-real-supplier-test-pkg',
    supplierId: 'sup-real',
    title: 'RSZ Test Package',
    approved: true,
    isTest: true,
  },
  // Package under a test supplier: excluded because the supplier is excluded.
  { id: 'pkg-test', supplierId: 'sup-test', title: 'Test No2', approved: true },
];

function matchesMockFilter(item, filter) {
  return Object.keys(filter).every(key => {
    const expected = filter[key];
    if (expected && typeof expected === 'object' && '$ne' in expected) {
      return item[key] !== expected.$ne;
    }
    return item[key] === expected;
  });
}

function buildApp() {
  suppliersRouter.initializeDependencies({
    dbUnified: {
      read: async collection => {
        if (collection === 'users') {
          return USERS.map(u => ({ ...u }));
        }
        if (collection === 'suppliers') {
          return SUPPLIERS.map(s => ({ ...s }));
        }
        if (collection === 'packages') {
          return PACKAGES.map(p => ({ ...p }));
        }
        return [];
      },
      find: async (collection, filter = {}) => {
        const source = collection === 'suppliers' ? SUPPLIERS : PACKAGES;
        return source.filter(item => matchesMockFilter(item, filter)).map(item => ({ ...item }));
      },
      findOne: async (collection, filter = {}) => {
        const source = collection === 'suppliers' ? SUPPLIERS : PACKAGES;
        const found = source.find(item => matchesMockFilter(item, filter));
        return found ? { ...found } : null;
      },
      findWithOptions: async () => [],
      getDatabaseType: () => 'local',
    },
    authRequired: (_req, _res, next) => next(),
    roleRequired: () => (_req, _res, next) => next(),
    supplierAnalytics: { trackEvent: async () => {} },
    getUserFromCookie: async () => null,
    supplierIsProActive: async () => false,
    logger: { info() {}, warn() {}, error() {} },
  });

  const app = express();
  app.use(express.json());
  app.use('/api', suppliersRouter);
  return app;
}

describe('public discovery endpoints exclude isTest suppliers/packages', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  it('GET /api/suppliers/:id/packages only returns non-test approved packages', async () => {
    const res = await request(app).get('/api/suppliers/sup-real/packages').expect(200);
    const ids = res.body.items.map(item => item.id);
    expect(ids).toContain('pkg-real');
    expect(ids).not.toContain('pkg-real-supplier-test-pkg');
  });

  it('GET /api/suppliers/:id/packages 404s for a test supplier', async () => {
    await request(app).get('/api/suppliers/sup-test/packages').expect(404);
  });

  it('GET /api/packages/featured excludes test suppliers and packages', async () => {
    const res = await request(app).get('/api/packages/featured').expect(200);
    const ids = res.body.items.map(item => item.id);
    expect(ids).not.toContain('pkg-real-supplier-test-pkg');
    expect(ids).not.toContain('pkg-test');
  });

  it('GET /api/packages/spotlight excludes test suppliers and packages', async () => {
    const res = await request(app).get('/api/packages/spotlight').expect(200);
    const ids = res.body.items.map(item => item.id);
    expect(ids).toContain('pkg-real');
    expect(ids).not.toContain('pkg-real-supplier-test-pkg');
    expect(ids).not.toContain('pkg-test');
  });

  it('GET /api/packages/search excludes test suppliers and packages', async () => {
    const res = await request(app).get('/api/packages/search').expect(200);
    const ids = res.body.items.map(item => item.id);
    expect(ids).toContain('pkg-real');
    expect(ids).not.toContain('pkg-real-supplier-test-pkg');
    expect(ids).not.toContain('pkg-test');
  });

  it('POST /api/packages/bulk excludes test suppliers and packages', async () => {
    const res = await request(app)
      .post('/api/packages/bulk')
      .send({ ids: ['pkg-real', 'pkg-real-supplier-test-pkg', 'pkg-test'] })
      .expect(200);
    const ids = res.body.packages.map(item => item.id);
    expect(ids).toEqual(['pkg-real']);
  });
});
