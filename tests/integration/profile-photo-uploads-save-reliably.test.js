/**
 * The two other places a photo is added to a gallery save reliably too.
 *
 *   - POST /api/me/suppliers/:id/photos   (the Edit profile "Photos" field; supplier gallery)
 *   - POST /api/me/packages/:id/photos    (the Edit package photo upload; package gallery)
 *
 * They had the same flaws as the batch routes in routes/photos.js (see
 * photo-upload-saves-reliably.test.js):
 *
 *  - the supplier route checked the plan's photo allowance only before the image was processed,
 *    and answered "ok" for a photo that was not saved, leaving its stored images behind;
 *  - the package route read the package BEFORE the image was processed, then wrote that copy of the
 *    gallery back, so an overlapping upload to the same package lost a photo, and a failed or
 *    unmatched write left the stored image behind.
 *
 * These tests run the real routers against an in-memory database that applies their updates, with
 * image processing held back so that two requests really do overlap.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');
const { createMongoStyleDb } = require('../helpers/mongo-style-db');

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const pass = (_req, _res, next) => next();
const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() };

const deferred = () => {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
};

async function until(condition) {
  for (let i = 0; i < 500 && !condition(); i += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  if (!condition()) {
    throw new Error('timed out waiting for the requests to overlap');
  }
}

const baseData = () => ({
  suppliers: [
    { id: 'S1', name: 'Sup One', ownerUserId: 'u1', photosGallery: [{ url: '/api/photos/old' }] },
  ],
  packages: [
    { id: 'P1', supplierId: 'S1', gallery: [{ url: '/pg1' }], image: '/api/photos/cover' },
    { id: 'P-new', supplierId: 'S1', gallery: [], image: '' },
  ],
});

/** The four addresses image number `n` is stored under. */
const addressesOf = n => [
  `/api/photos/opt_${n}`,
  `/api/photos/thumb_${n}`,
  `/api/photos/large_${n}`,
  `/api/photos/orig_${n}`,
];

/**
 * @param {Object} options
 * @param {number} [options.allowance] - The plan's photo limit
 * @param {boolean} [options.hold] - Make processing wait until `release()`
 * @param {string[]} [options.failWrites] - Collections whose writes answer false
 * @param {string[]} [options.throwWrites] - Collections whose writes throw
 */
function setup({ allowance = 2, hold = false, failWrites = [], throwWrites = [] } = {}) {
  jest.resetModules();
  jest.doMock('../../services/catalogCache', () => ({
    invalidate: jest.fn(() => Promise.resolve()),
  }));
  jest.doMock('../../services/subscriptionService', () => ({
    getPhotoAllowance: jest.fn(async () => allowance),
  }));
  const invalidatePackageCaches = jest.fn();
  jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches }));
  const catalogCache = require('../../services/catalogCache');

  const db = createMongoStyleDb(baseData());
  const gate = deferred();
  const state = { processing: 0, images: 0 };
  const dbUnified = {
    read: jest.fn(db.read),
    find: jest.fn(db.find),
    findOne: jest.fn(db.findOne),
    updateOne: jest.fn(async (collection, ...rest) => {
      if (throwWrites.includes(collection)) {
        throw new Error('db down');
      }
      if (failWrites.includes(collection)) {
        return false;
      }
      return db.updateOne(collection, ...rest);
    }),
  };
  const photoUpload = {
    processAndSaveImage: jest.fn(async () => {
      state.processing += 1;
      state.images += 1;
      const n = state.images;
      if (hold) {
        await gate.promise;
      }
      const [optimized, thumbnail, large, original] = addressesOf(n);
      return { optimized, thumbnail, large, original };
    }),
    deleteImage: jest.fn(async () => undefined),
  };
  const authRequired = (req, _res, next) => {
    req.user = { id: 'u1', role: 'supplier' };
    req.userId = 'u1';
    next();
  };

  const suppliers = require('../../routes/suppliers-v2');
  suppliers.initializeDependencies({
    dbUnified,
    authRequired,
    requireVerifiedUser: pass,
    csrfProtection: pass,
    featureRequired: () => pass,
    photoUpload,
    writeLimiter: pass,
  });
  const packages = require('../../routes/packages');
  packages.initializeDependencies({
    dbUnified,
    authRequired,
    roleRequired: () => pass,
    requireVerifiedUser: pass,
    requireApprovedSupplier: pass,
    csrfProtection: pass,
    featureRequired: () => pass,
    writeLimiter: pass,
    photoUpload,
    uploadValidation: {},
    logger,
    uid: prefix => `${prefix}_test`,
  });

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/me/suppliers', suppliers);
  app.use('/api', packages);

  return {
    db,
    state,
    catalogCache,
    invalidatePackageCaches,
    release: gate.resolve,
    supplierPhoto: () => request(app).post('/api/me/suppliers/S1/photos').send({ image: TINY_PNG }),
    packagePhoto: (id = 'P1') =>
      request(app).post(`/api/me/packages/${id}/photos`).send({ image: TINY_PNG }),
    deleted: () => photoUpload.deleteImage.mock.calls.map(([address]) => address).sort(),
  };
}

const supplierGallery = ctx => ctx.db.collections.suppliers.find(s => s.id === 'S1').photosGallery;
const packageGallery = (ctx, id = 'P1') =>
  ctx.db.collections.packages.find(p => p.id === id).gallery;

beforeEach(() => {
  logger.error.mockClear();
});

describe('POST /api/me/suppliers/:id/photos', () => {
  test('saves the photo, stamps updatedAt and busts the catalogue cache', async () => {
    const ctx = setup();

    const response = await ctx.supplierPhoto().expect(200);

    expect(response.body.ok).toBe(true);
    expect(supplierGallery(ctx).map(p => p.url)).toEqual(['/api/photos/old', '/api/photos/opt_1']);
    expect(ctx.db.collections.suppliers[0].updatedAt).toEqual(expect.any(String));
    expect(ctx.catalogCache.invalidate).toHaveBeenCalledTimes(1);
    expect(ctx.deleted()).toEqual([]);
  });

  test('two overlapping uploads that only have room for one: one is saved, one refused', async () => {
    const ctx = setup({ hold: true });

    const first = ctx.supplierPhoto().then(r => r);
    const second = ctx.supplierPhoto().then(r => r);
    await until(() => ctx.state.processing === 2);
    ctx.release();
    const responses = await Promise.all([first, second]);

    expect(responses.map(r => r.status).sort()).toEqual([200, 403]);
    expect(responses.find(r => r.status === 403).body).toMatchObject({
      code: 'PHOTO_LIMIT_REACHED',
    });
    expect(supplierGallery(ctx)).toHaveLength(2);
    // The refused upload's four stored images are deleted, and only those
    const savedNumber = Number(supplierGallery(ctx)[1].url.split('_').pop());
    const lostNumber = savedNumber === 1 ? 2 : 1;
    expect(ctx.deleted()).toEqual(addressesOf(lostNumber).sort());
    expect(ctx.catalogCache.invalidate).toHaveBeenCalledTimes(1);
  });

  test('the database refuses the write: not "ok", the images are deleted, the cache is left alone', async () => {
    const ctx = setup({ failWrites: ['suppliers'] });

    const response = await ctx.supplierPhoto();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to save photos. Please try again.' });
    expect(response.body.ok).toBeUndefined();
    expect(supplierGallery(ctx)).toHaveLength(1);
    expect(ctx.deleted()).toEqual(addressesOf(1).sort());
    expect(ctx.catalogCache.invalidate).not.toHaveBeenCalled();
  });

  test('the supplier was deleted while the image was processed', async () => {
    const ctx = setup({ hold: true });

    const pending = ctx.supplierPhoto().then(r => r);
    await until(() => ctx.state.processing === 1);
    ctx.db.collections.suppliers = [];
    ctx.release();
    const response = await pending;

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Supplier not found' });
    expect(ctx.deleted()).toEqual(addressesOf(1).sort());
  });

  test('a write that throws is answered as a failed save, and the images are deleted', async () => {
    const ctx = setup({ throwWrites: ['suppliers'] });

    const response = await ctx.supplierPhoto();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to save photos. Please try again.' });
    expect(ctx.deleted()).toEqual(addressesOf(1).sort());
  });
});

describe('POST /api/me/packages/:id/photos', () => {
  test('saves the photo and invalidates the package caches', async () => {
    const ctx = setup();

    const response = await ctx.packagePhoto().expect(200);

    expect(response.body).toEqual({ ok: true, url: '/api/photos/orig_1' });
    expect(packageGallery(ctx).map(p => p.url)).toEqual(['/pg1', '/api/photos/orig_1']);
    expect(ctx.invalidatePackageCaches).toHaveBeenCalledTimes(1);
    expect(ctx.deleted()).toEqual([]);
  });

  test('two overlapping uploads both land', async () => {
    // The package is read before the image is processed, so both start from the same gallery
    const ctx = setup({ hold: true });

    const first = ctx.packagePhoto().then(r => r);
    const second = ctx.packagePhoto().then(r => r);
    await until(() => ctx.state.processing === 2);
    ctx.release();
    const responses = await Promise.all([first, second]);

    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(
      packageGallery(ctx)
        .map(p => p.url)
        .sort()
    ).toEqual(['/api/photos/orig_1', '/api/photos/orig_2', '/pg1']);
    expect(ctx.deleted()).toEqual([]);
  });

  test('a package with no real cover takes the new photo as its cover; one with a cover keeps it', async () => {
    const ctx = setup();

    await ctx.packagePhoto('P-new').expect(200);
    await ctx.packagePhoto('P1').expect(200);

    const covers = Object.fromEntries(ctx.db.collections.packages.map(p => [p.id, p.image]));
    expect(covers).toEqual({ 'P-new': '/api/photos/orig_1', P1: '/api/photos/cover' });
  });

  test('the database refuses the write: a 500, not "ok", and the stored image is deleted', async () => {
    const ctx = setup({ failWrites: ['packages'] });

    const response = await ctx.packagePhoto();

    expect(response.status).toBe(500);
    expect(response.body.ok).toBeUndefined();
    expect(packageGallery(ctx)).toEqual([{ url: '/pg1' }]);
    expect(ctx.deleted()).toEqual(['/api/photos/orig_1']);
    expect(ctx.invalidatePackageCaches).not.toHaveBeenCalled();
  });

  test('the package was deleted while the image was processed: a 500, and the image is deleted', async () => {
    const ctx = setup({ hold: true });

    const pending = ctx.packagePhoto().then(r => r);
    await until(() => ctx.state.processing === 1);
    ctx.db.collections.packages = ctx.db.collections.packages.filter(p => p.id !== 'P1');
    ctx.release();
    const response = await pending;

    expect(response.status).toBe(500);
    expect(response.body.ok).toBeUndefined();
    expect(ctx.deleted()).toEqual(['/api/photos/orig_1']);
    expect(ctx.invalidatePackageCaches).not.toHaveBeenCalled();
  });

  test('a write that throws is a 500, and the stored image is deleted', async () => {
    const ctx = setup({ throwWrites: ['packages'] });

    const response = await ctx.packagePhoto();

    expect(response.status).toBe(500);
    expect(ctx.deleted()).toEqual(['/api/photos/orig_1']);
  });

  test('an image another record already uses is not deleted when the save fails', async () => {
    const ctx = setup({ failWrites: ['packages'] });
    ctx.db.collections.suppliers.push({ id: 'S-other', logo: '/api/photos/orig_1' });

    await ctx.packagePhoto();

    expect(ctx.deleted()).toEqual([]);
  });
});
