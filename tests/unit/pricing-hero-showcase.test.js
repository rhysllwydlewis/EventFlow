'use strict';

/**
 * The pricing hero's social-proof strip.
 *
 * The product decision behind these tests: five suppliers picked at random per
 * page view, from the same population the public listing shows, with no
 * filtering on category, completeness, photo, plan or attractiveness. They are
 * meant to be a genuine sample rather than a curated set, so a supplier with
 * no photo is included and falls back to initials in the client.
 */

const express = require('express');
const request = require('supertest');

const suppliersRouter = require('../../routes/suppliers');

// ── fixtures ────────────────────────────────────────────────────────────────

const USERS = [
  { id: 'usr-1', avatarUrl: '/uploads/owner-1.jpg' },
  { id: 'usr-2' },
  { id: 'usr-3' },
  { id: 'usr-4' },
  { id: 'usr-5' },
  { id: 'usr-6' },
];

const SUPPLIERS = [
  { id: 'sup-1', name: 'Ivy House Barn', approved: true, ownerUserId: 'usr-1' },
  {
    id: 'sup-2',
    name: 'DJ Marcus Lane',
    approved: true,
    ownerUserId: 'usr-2',
    profilePhotoUrl: '/uploads/dj.jpg',
  },
  // No photo anywhere, and no category: still eligible.
  { id: 'sup-3', name: 'Copper Catering', approved: true, ownerUserId: 'usr-3' },
  { id: 'sup-4', name: 'Ellen Hart Photography', approved: true, ownerUserId: 'usr-4' },
  { id: 'sup-5', name: 'Bloom & Vine', approved: true, ownerUserId: 'usr-5' },
  { id: 'sup-6', name: 'Northside Events', approved: true, ownerUserId: 'usr-6' },
  // Excluded: not approved, so not publicly visible anywhere on EventFlow.
  { id: 'sup-7', name: 'Pending Supplier', approved: false, ownerUserId: 'usr-6' },
  // Excluded: owner account deleted, so the profile is orphaned.
  { id: 'sup-8', name: 'Orphaned Supplier', approved: true, ownerUserId: 'usr-gone' },
];

function buildApp() {
  suppliersRouter.initializeDependencies({
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
      findOne: async () => null,
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
  app.use('/api', suppliersRouter);
  return app;
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('GET /api/suppliers/showcase', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  it('returns one page of suppliers by default', async () => {
    // The hero shows six at a time; the default matches so a caller that wants
    // a single row does not have to know the page size.
    const res = await request(app).get('/api/suppliers/showcase').expect(200);
    expect(res.body.items).toHaveLength(6);
  });

  it('never repeats a supplier within one sample', async () => {
    // Repeated because the selection is random: a shuffle that can collide
    // will usually do so within a handful of draws.
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const res = await request(app).get('/api/suppliers/showcase').expect(200);
      const ids = res.body.items.map(item => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('varies the sample between page views', async () => {
    const samples = new Set();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const res = await request(app).get('/api/suppliers/showcase').expect(200);
      samples.add(res.body.items.map(item => item.id).join(','));
    }
    // Six eligible suppliers taken five at a time: a fixed order would give
    // exactly one distinct sample.
    expect(samples.size).toBeGreaterThan(1);
  });

  it('only draws from suppliers the public can already see', async () => {
    const seen = new Set();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const res = await request(app).get('/api/suppliers/showcase').expect(200);
      res.body.items.forEach(item => seen.add(item.id));
    }
    expect(seen.has('sup-7')).toBe(false); // unapproved
    expect(seen.has('sup-8')).toBe(false); // orphaned owner
    expect(seen.size).toBe(6);
  });

  it('includes suppliers with no photo rather than skipping them', async () => {
    const byId = new Map();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const res = await request(app).get('/api/suppliers/showcase').expect(200);
      res.body.items.forEach(item => byId.set(item.id, item));
    }
    // Present, and honestly reported as having no image so the client can fall
    // back to initials.
    expect(byId.get('sup-3')).toBeDefined();
    expect(byId.get('sup-3').profilePhotoUrl).toBeNull();
    // The supplier's own field wins.
    expect(byId.get('sup-2').profilePhotoUrl).toBe('/uploads/dj.jpg');
    // Falls back to the owner account's avatar, as the public listing does.
    expect(byId.get('sup-1').profilePhotoUrl).toBe('/uploads/owner-1.jpg');
  });

  it('returns only what the strip renders', async () => {
    const res = await request(app).get('/api/suppliers/showcase').expect(200);
    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      'category',
      'id',
      'name',
      'profilePhotoUrl',
    ]);
  });

  it('reports the eligible total so the strip only claims more when there are', async () => {
    const res = await request(app).get('/api/suppliers/showcase').expect(200);
    expect(res.body.total).toBe(6);
  });

  it('clamps the requested size', async () => {
    const tooMany = await request(app).get('/api/suppliers/showcase?limit=500').expect(200);
    // Capped, then bounded again by how many suppliers actually exist.
    expect(tooMany.body.items).toHaveLength(6);

    const tooFew = await request(app).get('/api/suppliers/showcase?limit=0').expect(200);
    expect(tooFew.body.items).toHaveLength(1);

    const nonsense = await request(app).get('/api/suppliers/showcase?limit=abc').expect(200);
    expect(nonsense.body.items).toHaveLength(6);
  });

  it('serves several pages in one request but caps the ceiling', async () => {
    // The hero asks for four pages of six up front rather than refetching on
    // every rotation, so the cap has to clear 24 — and still stop somewhere,
    // since this is a hero decoration and not a listing endpoint.
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `bulk-${i}`,
      name: `Bulk Supplier ${i}`,
      approved: true,
    }));
    suppliersRouter.initializeDependencies({
      dbUnified: {
        read: async collection => (collection === 'suppliers' ? many : []),
        findOne: async () => null,
        getDatabaseType: () => 'local',
      },
      authRequired: (_req, _res, next) => next(),
      roleRequired: () => (_req, _res, next) => next(),
      supplierAnalytics: { trackEvent: async () => {} },
      getUserFromCookie: async () => null,
      supplierIsProActive: async () => false,
      logger: { info() {}, warn() {}, error() {} },
    });
    const bulkApp = express();
    bulkApp.use('/api', suppliersRouter);

    const fourPages = await request(bulkApp).get('/api/suppliers/showcase?limit=24').expect(200);
    expect(fourPages.body.items).toHaveLength(24);
    expect(new Set(fourPages.body.items.map(i => i.id)).size).toBe(24);

    const ceiling = await request(bulkApp).get('/api/suppliers/showcase?limit=999').expect(200);
    expect(ceiling.body.items).toHaveLength(36);

    // Restore the shared fixture for any test that runs after this one.
    app = buildApp();
  });

  it('hides the strip rather than breaking the page when the read fails', async () => {
    suppliersRouter.initializeDependencies({
      dbUnified: {
        read: async () => {
          throw new Error('database unavailable');
        },
        findOne: async () => null,
        getDatabaseType: () => 'local',
      },
      authRequired: (_req, _res, next) => next(),
      roleRequired: () => (_req, _res, next) => next(),
      supplierAnalytics: { trackEvent: async () => {} },
      getUserFromCookie: async () => null,
      supplierIsProActive: async () => false,
      logger: { info() {}, warn() {}, error() {} },
    });

    const failing = express();
    failing.use('/api', suppliersRouter);

    const res = await request(failing).get('/api/suppliers/showcase').expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});
