/**
 * Photo uploads save reliably, and leave nothing behind when they cannot.
 *
 * Three things were wrong with how the upload routes saved photos to a gallery:
 *
 *  1. The plan's photo allowance was checked before the files were processed, which takes seconds,
 *     and the photos were then added with no further check. Two overlapping uploads to one supplier
 *     both passed the first check, so together they could go past the plan's limit.
 *  2. The result of the save was ignored. The database layer answers `false`, rather than
 *     throwing, when a write fails or matches nothing, so a photo that was not saved (the supplier
 *     was deleted while it uploaded, or the database failed) was still reported as uploaded, and
 *     the four images it had stored stayed in storage.
 *  3. A package's gallery was written back whole from a copy read earlier, so two uploads to one
 *     package at the same time could discard one another's photos.
 *
 * These tests run the real router against an in-memory database that applies its updates, with
 * photo processing held back so that two requests really do overlap.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');
const { createMongoStyleDb } = require('../helpers/mongo-style-db');

const mockWorld = { allowance: 2 };

jest.mock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
jest.mock('../../middleware/rateLimits', () => {
  const pass = (_req, _res, next) => next();
  return { uploadLimiter: pass, apiLimiter: pass };
});
jest.mock('../../middleware/features', () => ({
  getFeatureFlags: jest.fn(async () => ({ photoAutoApprove: true })),
}));
jest.mock('../../services/subscriptionService', () => ({
  getPhotoAllowance: jest.fn(async () => mockWorld.allowance),
}));

const router = require('../../routes/photos');
const suppliersRouter = require('../../routes/suppliers');

const pass = (_req, _res, next) => next();
const OWNER = { id: 'u1', role: 'supplier' };

/** The four addresses one processed file is stored under (see makePhotoUpload). */
const addressesOf = name => [
  `/api/photos/opt_${name}`,
  `/api/photos/thumb_${name}`,
  `/api/photos/large_${name}`,
  `/api/photos/orig_${name}`,
];

const deferred = () => {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
};

/** Wait until `condition()` holds, so a test can act once overlapping requests are both underway. */
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
    { id: 'S-null', name: 'Sup Null', ownerUserId: 'u1', photosGallery: null },
  ],
  packages: [
    { id: 'P1', supplierId: 'S1', gallery: [{ url: '/pg1' }], image: '/api/photos/cover' },
    { id: 'P-new', supplierId: 'S1', gallery: [], image: '' },
    { id: 'P-null', supplierId: 'S1', gallery: null, image: '' },
  ],
  photos: [],
});

/**
 * Mount the router. Files for a request are named in its `x-files` header, so overlapping requests
 * can upload different files. `hold` makes every file wait until the test lets processing finish.
 */
function setup({ data = baseData(), hold = false, failWrites = [], yieldInDb = false } = {}) {
  const db = createMongoStyleDb(data);
  const gate = deferred();
  const state = { processing: 0 };
  const yieldNow = () => (yieldInDb ? new Promise(resolve => setImmediate(resolve)) : undefined);

  const dbUnified = {
    findOne: jest.fn(async (...args) => {
      await yieldNow();
      return db.findOne(...args);
    }),
    find: jest.fn(db.find),
    updateOne: jest.fn(async (collection, ...rest) => {
      await yieldNow();
      if (failWrites.includes(collection)) {
        return false;
      }
      return db.updateOne(collection, ...rest);
    }),
    insertOne: jest.fn(async (_collection, doc) => doc),
  };
  const photoUpload = {
    upload: {
      fields: () => (req, _res, done) => {
        const names = String(req.headers['x-files'] || 'a.jpg').split(',');
        req.files = {
          files: names.map(name => ({
            originalname: name,
            buffer: Buffer.from(`data-${name}`),
            size: 100,
            mimetype: 'image/jpeg',
          })),
        };
        done();
      },
    },
    processAndSaveImage: jest.fn(async (_buffer, name) => {
      state.processing += 1;
      if (hold) {
        await gate.promise;
      }
      if (name.startsWith('bad')) {
        throw Object.assign(new Error('File too small'), { name: 'ValidationError' });
      }
      const [optimized, thumbnail, large, original] = addressesOf(name);
      return { optimized, thumbnail, large, original };
    }),
    getImageMetadata: jest.fn(async () => ({ width: 100, height: 80, format: 'jpeg' })),
    deleteImage: jest.fn(async () => undefined),
  };
  const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() };

  router.initializeDependencies({
    dbUnified,
    authRequired: (req, _res, next) => {
      req.user = OWNER;
      next();
    },
    roleRequired: () => pass,
    featureRequired: () => pass,
    csrfProtection: pass,
    photoUpload,
    logger,
  });
  const app = express();
  app.use('/api', router);

  const upload = (path, files) => request(app).post(`/api${path}`).set('x-files', files);
  return {
    db,
    dbUnified,
    photoUpload,
    state,
    release: gate.resolve,
    batch: (target, files) => upload(`/photos/upload/batch?${target}`, files),
    single: (target, file) => upload(`/photos/upload?${target}`, file),
    deletedAddresses: () => photoUpload.deleteImage.mock.calls.map(([address]) => address).sort(),
  };
}

const gallery = (ctx, id = 'S1') =>
  ctx.db.collections.suppliers.find(s => s.id === id).photosGallery;
const packageGallery = (ctx, id = 'P1') =>
  ctx.db.collections.packages.find(p => p.id === id).gallery;

beforeEach(() => {
  mockWorld.allowance = 2;
  suppliersRouter.invalidatePackageCaches.mockClear();
});

describe('the plan allowance is enforced when the photos are saved', () => {
  // S1 holds one photo and the plan allows two, so there is room for exactly one more. Two uploads
  // of one photo each both pass the check made before processing; only one may be saved.
  test.each([
    ['batch', (ctx, files) => ctx.batch('type=supplier&id=S1', files)],
    ['single', (ctx, file) => ctx.single('type=supplier&id=S1', file)],
  ])('two overlapping %s uploads that only have room for one', async (_name, send) => {
    const ctx = setup({ hold: true });

    const first = send(ctx, 'a.jpg').then(response => response);
    const second = send(ctx, 'b.jpg').then(response => response);
    await until(() => ctx.state.processing === 2);
    ctx.release();
    const responses = await Promise.all([first, second]);

    expect(responses.map(r => r.status).sort()).toEqual([200, 403]);
    const refused = responses.find(r => r.status === 403);
    expect(refused.body).toMatchObject({ code: 'PHOTO_LIMIT_REACHED', limit: 2 });

    // The gallery holds the old photo and one new one, not three
    expect(gallery(ctx)).toHaveLength(2);
    const savedUrl = gallery(ctx)[1].url;
    const lostName = savedUrl.endsWith('opt_a.jpg') ? 'b.jpg' : 'a.jpg';

    // The refused upload's four stored images are deleted, and only those
    expect(ctx.deletedAddresses()).toEqual(addressesOf(lostName).sort());
  });

  test('uploads one after the other each find the room that is left', async () => {
    const ctx = setup();
    mockWorld.allowance = 3;

    const one = await ctx.batch('type=supplier&id=S1', 'a.jpg');
    const two = await ctx.batch('type=supplier&id=S1', 'b.jpg');
    const three = await ctx.batch('type=supplier&id=S1', 'c.jpg');

    expect([one.status, two.status, three.status]).toEqual([200, 200, 403]);
    expect(gallery(ctx)).toHaveLength(3);
    expect(ctx.deletedAddresses()).toEqual([]); // the third was refused before anything was stored
  });

  test('a plan with no limit takes every upload', async () => {
    const ctx = setup({ hold: true });
    mockWorld.allowance = -1;

    const first = ctx.batch('type=supplier&id=S1', 'a.jpg').then(r => r);
    const second = ctx.batch('type=supplier&id=S1', 'b.jpg').then(r => r);
    await until(() => ctx.state.processing === 2);
    ctx.release();
    const responses = await Promise.all([first, second]);

    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(gallery(ctx)).toHaveLength(3);
  });

  test('the check at saving counts the photos that were saved, not the files that were sent', async () => {
    // Room for one more (one held, limit two). Two files are sent and one fails to process, so
    // one photo is saved; sending two files must not have refused it at the save.
    const ctx = setup();
    mockWorld.allowance = 3; // up front: 1 + 2 files = 3, allowed

    const response = await ctx.batch('type=supplier&id=S1', 'good.jpg,bad.jpg');

    expect(response.status).toBe(200);
    expect(response.body.uploaded).toBe(1);
    expect(gallery(ctx)).toHaveLength(2);
  });
});

describe('a photo that could not be saved is not reported as uploaded', () => {
  test.each([
    ['batch', (ctx, files) => ctx.batch('type=supplier&id=S1', files), 'a.jpg,b.jpg'],
    ['single', (ctx, file) => ctx.single('type=supplier&id=S1', file), 'a.jpg'],
  ])('%s: the database refuses the write', async (_name, send, files) => {
    mockWorld.allowance = 10; // room for the files, so the write is what fails
    const ctx = setup({ failWrites: ['suppliers'] });

    const response = await send(ctx, files);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to save photos. Please try again.' });
    expect(gallery(ctx)).toHaveLength(1);
    // Every stored image of every photo is deleted
    expect(ctx.deletedAddresses()).toEqual(
      files
        .split(',')
        .flatMap(name => addressesOf(name))
        .sort()
    );
  });

  test.each([
    ['batch', (ctx, ...a) => ctx.batch('type=supplier&id=S1', ...a)],
    ['single', (ctx, ...a) => ctx.single('type=supplier&id=S1', ...a)],
  ])('%s: the supplier was deleted while the photo was processed', async (_name, send) => {
    const ctx = setup({ hold: true });

    const pending = send(ctx, 'a.jpg').then(r => r);
    await until(() => ctx.state.processing === 1);
    ctx.db.collections.suppliers = ctx.db.collections.suppliers.filter(s => s.id !== 'S1');
    ctx.release();
    const response = await pending;

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Supplier not found' });
    expect(ctx.deletedAddresses()).toEqual(addressesOf('a.jpg').sort());
  });

  test('a batch where every file fails writes nothing, and is not a failed save', async () => {
    mockWorld.allowance = 10;
    const ctx = setup({ failWrites: ['suppliers'] });

    const response = await ctx.batch('type=supplier&id=S1', 'bad1.jpg,bad2.jpg');

    expect(response.status).toBe(200);
    expect(response.body.uploaded).toBe(0);
    expect(response.body.errors).toHaveLength(2);
    expect(ctx.dbUnified.updateOne).not.toHaveBeenCalled();
    expect(ctx.deletedAddresses()).toEqual([]);
  });

  test('an image another record already uses is not deleted with the rest', async () => {
    // The check that cleans up is the one used for deletes: it keeps what is still referenced
    const data = baseData();
    data.packages.push({ id: 'P-other', supplierId: 'S1', image: '/api/photos/thumb_a.jpg' });
    const ctx = setup({ data, failWrites: ['suppliers'] });

    const response = await ctx.batch('type=supplier&id=S1', 'a.jpg');

    expect(response.status).toBe(500);
    expect(ctx.deletedAddresses()).toEqual(
      addressesOf('a.jpg')
        .filter(address => address !== '/api/photos/thumb_a.jpg')
        .sort()
    );
  });

  test.each([
    [
      'the database throws on the write',
      ctx => ctx.dbUnified.updateOne.mockRejectedValue(new Error('db down')),
    ],
    [
      'the plan lookup throws',
      () =>
        require('../../services/subscriptionService').getPhotoAllowance.mockRejectedValueOnce(
          new Error('subscriptions down')
        ),
    ],
  ])('%s: answered as a failed save, and the images are deleted', async (_name, breakIt) => {
    const ctx = setup({ hold: true });
    mockWorld.allowance = 10;
    const pending = ctx.batch('type=supplier&id=S1', 'a.jpg').then(r => r);
    await until(() => ctx.state.processing === 1);
    // Break things after the up-front checks, when the save happens
    breakIt(ctx);
    ctx.release();
    const response = await pending;

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to save photos. Please try again.' });
    expect(gallery(ctx)).toHaveLength(1);
    expect(ctx.deletedAddresses()).toEqual(addressesOf('a.jpg').sort());
  });

  test('a database failure reading the supplier at save time is a 500, not "Supplier not found"', async () => {
    const ctx = setup({ hold: true });
    mockWorld.allowance = 10;

    const pending = ctx.batch('type=supplier&id=S1', 'a.jpg').then(r => r);
    await until(() => ctx.state.processing === 1);
    ctx.dbUnified.findOne.mockImplementation(async (_collection, _filter, options) => {
      if (options && options.throwOnError) {
        throw new Error('db down');
      }
      return null; // what the real database layer answers for a failed read without throwOnError
    });
    ctx.release();
    const response = await pending;

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to save photos. Please try again.' });
    expect(ctx.deletedAddresses()).toEqual(addressesOf('a.jpg').sort());
  });

  test('a package write that throws is answered as a failed save, and the images are deleted', async () => {
    const ctx = setup({ hold: true });
    const pending = ctx.batch('type=package&id=P1', 'a.jpg').then(r => r);
    await until(() => ctx.state.processing === 1);
    ctx.dbUnified.updateOne.mockRejectedValue(new Error('db down'));
    ctx.release();
    const response = await pending;

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to save photos. Please try again.' });
    expect(suppliersRouter.invalidatePackageCaches).not.toHaveBeenCalled();
    expect(ctx.deletedAddresses()).toEqual(addressesOf('a.jpg').sort());
  });

  test('a failed cleanup does not change the answer', async () => {
    const ctx = setup({ failWrites: ['suppliers'] });
    ctx.photoUpload.deleteImage.mockRejectedValue(new Error('storage down'));

    const response = await ctx.batch('type=supplier&id=S1', 'a.jpg');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to save photos. Please try again.' });
  });

  test.each([
    ['batch', (ctx, files) => ctx.batch('type=package&id=P1', files), 'a.jpg,b.jpg'],
    ['single', (ctx, file) => ctx.single('type=package&id=P1', file), 'a.jpg'],
  ])('package %s: the database refuses the write', async (_name, send, files) => {
    const ctx = setup({ failWrites: ['packages'] });

    const response = await send(ctx, files);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to save photos. Please try again.' });
    expect(packageGallery(ctx)).toEqual([{ url: '/pg1' }]);
    expect(suppliersRouter.invalidatePackageCaches).not.toHaveBeenCalled();
    expect(ctx.deletedAddresses()).toEqual(
      files
        .split(',')
        .flatMap(name => addressesOf(name))
        .sort()
    );
  });
});

describe('a package gallery keeps every photo added at the same time', () => {
  test.each([
    ['batch', (ctx, file) => ctx.batch('type=package&id=P1', file)],
    ['single', (ctx, file) => ctx.single('type=package&id=P1', file)],
  ])('two overlapping %s uploads both land', async (_name, send) => {
    // Every database call yields, so the two requests' reads and writes interleave
    const ctx = setup({ hold: true, yieldInDb: true });

    const first = send(ctx, 'a.jpg').then(r => r);
    const second = send(ctx, 'b.jpg').then(r => r);
    await until(() => ctx.state.processing === 2);
    ctx.release();
    const responses = await Promise.all([first, second]);

    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(
      packageGallery(ctx)
        .map(p => p.url)
        .sort()
    ).toEqual(['/api/photos/opt_a.jpg', '/api/photos/opt_b.jpg', '/pg1']);
    expect(ctx.deletedAddresses()).toEqual([]);
  });

  test('a package with no real cover takes the first new photo as its cover', async () => {
    const ctx = setup();

    await ctx.batch('type=package&id=P-new', 'a.jpg,b.jpg').expect(200);

    const pkg = ctx.db.collections.packages.find(p => p.id === 'P-new');
    expect(pkg.image).toBe('/api/photos/opt_a.jpg');
    expect(pkg.gallery.map(p => p.url)).toEqual(['/api/photos/opt_a.jpg', '/api/photos/opt_b.jpg']);
  });

  test('a package that already has a cover keeps it', async () => {
    const ctx = setup();

    await ctx.batch('type=package&id=P1', 'a.jpg').expect(200);

    expect(ctx.db.collections.packages.find(p => p.id === 'P1').image).toBe('/api/photos/cover');
  });

  test('a package whose gallery is null (legacy) gets the new photos as its gallery', async () => {
    const ctx = setup();

    await ctx.batch('type=package&id=P-null', 'a.jpg').expect(200);

    const pkg = ctx.db.collections.packages.find(p => p.id === 'P-null');
    expect(pkg.gallery.map(p => p.url)).toEqual(['/api/photos/opt_a.jpg']);
    expect(pkg.image).toBe('/api/photos/opt_a.jpg');
  });

  test('a supplier whose gallery is null (legacy) gets the new photos as its gallery', async () => {
    const ctx = setup();

    await ctx.batch('type=supplier&id=S-null', 'a.jpg').expect(200);

    expect(gallery(ctx, 'S-null').map(p => p.url)).toEqual(['/api/photos/opt_a.jpg']);
  });

  test('a saved upload invalidates the package caches once', async () => {
    const ctx = setup();

    await ctx.batch('type=package&id=P1', 'a.jpg,b.jpg').expect(200);

    expect(suppliersRouter.invalidatePackageCaches).toHaveBeenCalledTimes(1);
  });
});
