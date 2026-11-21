/**
 * DELETE /api/admin/suppliers/:id deletes the supplier's stored photos too.
 *
 * Deleting a supplier removed the record and left every image it had uploaded (gallery, logo,
 * cover, banner) in storage, publicly readable by address and used by nothing. They are now deleted
 * with it, except any that something else still uses and any recorded as belonging to another user.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');
const { createMongoStyleDb } = require('../helpers/mongo-style-db');

const mockState = { db: null, owners: {}, failDelete: false };

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    next();
  },
  roleRequired: () => (_req, _res, next) => next(),
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
jest.mock('../../middleware/audit', () => ({
  auditLog: jest.fn(),
  auditMiddleware: () => (_req, _res, next) => next(),
  AUDIT_ACTIONS: {},
}));
jest.mock('../../middleware/rateLimits', () => ({
  writeLimiter: (_req, _res, next) => next(),
  apiLimiter: (_req, _res, next) => next(),
  uploadLimiter: (_req, _res, next) => next(),
}));
jest.mock('../../middleware/domain-admin', () => ({ isOwnerEmail: () => false }));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../photo-upload', () => ({
  upload: { single: () => (_req, _res, next) => next(), array: () => (_req, _res, next) => next() },
  deleteImage: jest.fn(async () => undefined),
  getImageOwners: jest.fn(async addresses =>
    Object.fromEntries(addresses.map(address => [address, mockState.owners[address] || null]))
  ),
}));
jest.mock('../../db-unified', () => ({
  read: jest.fn(async name => mockState.db.read(name)),
  find: jest.fn(async (name, filter) => mockState.db.find(name, filter)),
  findOne: jest.fn(async (name, filter) => mockState.db.findOne(name, filter)),
  write: jest.fn(),
  updateOne: jest.fn().mockResolvedValue(true),
  insertOne: jest.fn().mockResolvedValue(true),
  deleteOne: jest.fn(async (name, id) =>
    mockState.failDelete ? false : mockState.db.deleteOne(name, id)
  ),
}));

const dbUnified = require('../../db-unified');
const photoUpload = require('../../photo-upload');
const adminRoutes = require('../../routes/admin');

const photo = name => ({
  url: `/api/photos/opt_${name}`,
  thumbnail: `/api/photos/thumb_${name}`,
  large: `/api/photos/large_${name}`,
  original: `/api/photos/orig_${name}`,
});
const shown = photo('shown');
const SHOWN_ADDRESSES = [shown.url, shown.thumbnail, shown.large, shown.original];

const supplierData = () => ({
  suppliers: [
    {
      id: 'S1',
      ownerUserId: 'u1',
      name: 'Sup One',
      photosGallery: [shown],
      logo: '/api/photos/logo_one',
      bannerUrl: '/api/photos/banner_one',
    },
    { id: 'S2', ownerUserId: 'u2', name: 'Sup Two', photosGallery: [photo('two')] },
  ],
  users: [],
  packages: [],
});

function setup({ data = supplierData(), owners = {}, failDelete = false } = {}) {
  mockState.db = createMongoStyleDb(data);
  mockState.owners = owners;
  mockState.failDelete = failDelete;
  photoUpload.deleteImage.mockClear();
  photoUpload.getImageOwners.mockClear();
  dbUnified.find.mockClear();
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  return {
    remove: id => request(app).delete(`/api/admin/suppliers/${id}`),
    deleted: () => photoUpload.deleteImage.mock.calls.map(([address]) => address).sort(),
    supplierIds: () => mockState.db.collections.suppliers.map(s => s.id),
  };
}

describe('DELETE /api/admin/suppliers/:id', () => {
  test('deletes the supplier and every stored image it held', async () => {
    const ctx = setup();

    await ctx.remove('S1').expect(200);

    expect(ctx.supplierIds()).toEqual(['S2']);
    expect(ctx.deleted()).toEqual(
      [...SHOWN_ADDRESSES, '/api/photos/logo_one', '/api/photos/banner_one'].sort()
    );
  });

  test('keeps an image another record still uses', async () => {
    const data = supplierData();
    data.users.push({ id: 'u1', avatarUrl: '/api/photos/logo_one' });
    const ctx = setup({ data });

    await ctx.remove('S1').expect(200);

    expect(ctx.deleted()).not.toContain('/api/photos/logo_one');
    expect(ctx.deleted()).toContain(shown.url);
  });

  test("keeps an image recorded as another user's", async () => {
    const ctx = setup({ owners: { [shown.large]: 'customer_9' } });

    await ctx.remove('S1').expect(200);

    expect(ctx.deleted()).not.toContain(shown.large);
    expect(ctx.deleted()).toContain(shown.url);
  });

  test('keeps everything, and still deletes the supplier, when owners cannot be read', async () => {
    const ctx = setup();
    photoUpload.getImageOwners.mockRejectedValueOnce(new Error('database down'));

    await ctx.remove('S1').expect(200);

    expect(ctx.supplierIds()).toEqual(['S2']);
    expect(ctx.deleted()).toEqual([]);
  });

  test('a delete that did not delete the supplier keeps its images', async () => {
    const ctx = setup({ failDelete: true });

    await ctx.remove('S1');

    expect(ctx.supplierIds()).toEqual(['S1', 'S2']);
    expect(ctx.deleted()).toEqual([]);
    // Not even looked into: the supplier's own record would protect its images, but nothing here
    // should rely on that
    expect(dbUnified.find).not.toHaveBeenCalled();
    expect(photoUpload.getImageOwners).not.toHaveBeenCalled();
  });

  test('a supplier with no owner on record is left for the orphan sweep', async () => {
    const data = supplierData();
    delete data.suppliers[0].ownerUserId;
    const ctx = setup({ data });

    await ctx.remove('S1').expect(200);

    expect(ctx.supplierIds()).toEqual(['S2']);
    expect(ctx.deleted()).toEqual([]);
  });

  test("another supplier's photos are untouched", async () => {
    const ctx = setup();

    await ctx.remove('S1').expect(200);

    expect(ctx.deleted().filter(address => address.includes('two'))).toEqual([]);
  });

  test('an unknown supplier is a 404 and deletes nothing', async () => {
    const ctx = setup();

    await ctx.remove('nope').expect(404);

    expect(ctx.deleted()).toEqual([]);
  });
});
