/**
 * Deleting a package deletes its stored photos too.
 *
 * Deleting a package (a supplier deleting their own, or an admin deleting one) removed the record
 * and left every image it had uploaded in storage, publicly readable by address and used by
 * nothing. The photos are now deleted with the package, except any that something else still uses
 * and any recorded as belonging to another user.
 *
 * These run the real routers against an in-memory database that applies their updates.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');
const { createMongoStyleDb } = require('../helpers/mongo-style-db');

jest.mock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));

const pass = (_req, _res, next) => next();

const photo = name => ({
  url: `/api/photos/opt_${name}`,
  thumbnail: `/api/photos/thumb_${name}`,
  large: `/api/photos/large_${name}`,
  original: `/api/photos/orig_${name}`,
  approved: true,
});
const gone = photo('gone');
const GONE_ADDRESSES = [gone.url, gone.thumbnail, gone.large, gone.original];

const baseData = () => ({
  suppliers: [
    { id: 'S1', ownerUserId: 'u1', name: 'Sup One', approved: true },
    { id: 'S-other', ownerUserId: 'u2', name: 'Other', approved: true },
  ],
  packages: [
    { id: 'P1', supplierId: 'S1', gallery: [gone], image: gone.url },
    { id: 'P-stay', supplierId: 'S1', gallery: [photo('stay')], image: photo('stay').url },
  ],
});

/**
 * @param {Object} [options]
 * @param {Object} [options.data] - Starting records
 * @param {Object} [options.owners] - Whose each address is, or an Error to make the lookup fail
 * @param {'throw'|'false'} [options.failDelete] - Make deleting the package fail: the way
 *   `dbUnified.deleteOne` really fails is to answer false, and it throws only when asked to
 */
function setup({ data = baseData(), owners = {}, failDelete = false } = {}) {
  jest.resetModules();
  jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
  const router = require('../../routes/packages');
  const db = createMongoStyleDb(data);
  const dbUnified = {
    findOne: jest.fn(db.findOne),
    find: jest.fn(db.find),
    deleteOne: jest.fn(async (...args) => {
      if (failDelete === 'throw') {
        throw new Error('db down');
      }
      return failDelete === 'false' ? false : db.deleteOne(...args);
    }),
  };
  const photoUpload = {
    deleteImage: jest.fn(async () => undefined),
    processAndSaveImage: jest.fn(),
    getImageOwners: jest.fn(async addresses => {
      if (owners instanceof Error) {
        throw owners;
      }
      return Object.fromEntries(addresses.map(address => [address, owners[address] || null]));
    }),
  };
  router.initializeDependencies({
    dbUnified,
    authRequired: (req, _res, next) => {
      const admin = req.headers['x-admin'];
      req.user = admin ? { id: 'admin_9', role: 'admin' } : { id: 'u1', role: 'supplier' };
      req.userId = req.user.id;
      next();
    },
    roleRequired: () => pass,
    requireVerifiedUser: pass,
    requireApprovedSupplier: pass,
    csrfProtection: pass,
    featureRequired: () => pass,
    writeLimiter: pass,
    photoUpload,
    uploadValidation: {},
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
    uid: prefix => `${prefix}_test`,
  });
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  return {
    db,
    dbUnified,
    photoUpload,
    ownDelete: id => request(app).delete(`/api/me/packages/${id}`),
    adminDelete: id => request(app).delete(`/api/admin/packages/${id}`).set('x-admin', '1'),
    deleted: () => photoUpload.deleteImage.mock.calls.map(([address]) => address).sort(),
  };
}

const packageIds = ctx => ctx.db.collections.packages.map(p => p.id);

describe.each([
  ['a supplier deleting their own package', ctx => ctx.ownDelete('P1')],
  ['an admin deleting a package', ctx => ctx.adminDelete('P1')],
])('%s', (_name, remove) => {
  test('deletes the package and all four stored images of its photo', async () => {
    const ctx = setup();

    const response = await remove(ctx).expect(200);

    expect(response.body.ok).toBe(true);
    expect(packageIds(ctx)).toEqual(['P-stay']);
    expect(ctx.deleted()).toEqual([...GONE_ADDRESSES].sort());
  });

  test('keeps an image another record still uses', async () => {
    const data = baseData();
    data.suppliers.push({ id: 'S-three', logo: gone.large });
    const ctx = setup({ data });

    await remove(ctx).expect(200);

    expect(ctx.deleted()).toEqual(GONE_ADDRESSES.filter(a => a !== gone.large).sort());
  });

  test("keeps an image recorded as another user's, such as a customer's review photo", async () => {
    const ctx = setup({ owners: { [gone.thumbnail]: 'customer_9' } });

    await remove(ctx).expect(200);

    expect(ctx.deleted()).toEqual(GONE_ADDRESSES.filter(a => a !== gone.thumbnail).sort());
  });

  test("deletes images recorded as the supplier's owner's, whoever is deleting", async () => {
    const owners = Object.fromEntries(GONE_ADDRESSES.map(address => [address, 'u1']));
    const ctx = setup({ owners });

    await remove(ctx).expect(200);

    expect(ctx.deleted()).toEqual([...GONE_ADDRESSES].sort());
  });

  test('keeps everything, and still deletes the package, when whose the images are cannot be read', async () => {
    const ctx = setup({ owners: new Error('database down') });

    await remove(ctx).expect(200);

    expect(packageIds(ctx)).toEqual(['P-stay']);
    expect(ctx.deleted()).toEqual([]);
  });

  test('a storage failure does not fail the delete', async () => {
    const ctx = setup();
    ctx.photoUpload.deleteImage.mockRejectedValue(new Error('storage down'));

    await remove(ctx).expect(200);

    expect(packageIds(ctx)).toEqual(['P-stay']);
  });

  test('the package does not protect its own images', async () => {
    // Its record is gone before the check, so what it referenced counts as unused
    const ctx = setup();

    await remove(ctx).expect(200);

    expect(ctx.db.collections.packages.some(p => p.id === 'P1')).toBe(false);
    expect(ctx.deleted()).toHaveLength(4);
  });

  test('a delete that did not delete the package (the database failed) keeps its images', async () => {
    // dbUnified.deleteOne answers false rather than throwing. The package still exists, so its
    // images are still in use.
    const ctx = setup({ failDelete: 'false' });

    await remove(ctx);

    expect(packageIds(ctx)).toEqual(['P1', 'P-stay']);
    expect(ctx.deleted()).toEqual([]);
    // Not even looked into: the package's own record would protect its images, but nothing here
    // should rely on that
    expect(ctx.dbUnified.find).not.toHaveBeenCalled();
    expect(ctx.photoUpload.getImageOwners).not.toHaveBeenCalled();
  });

  test("another package's photos are untouched", async () => {
    const ctx = setup();

    await remove(ctx).expect(200);

    expect(ctx.deleted().filter(a => a.includes('stay'))).toEqual([]);
  });
});

describe('a supplier deleting their own package when the database throws', () => {
  test('answers 500 and keeps the package and its images', async () => {
    const ctx = setup({ failDelete: 'throw' });

    await ctx.ownDelete('P1').expect(500);

    expect(packageIds(ctx)).toEqual(['P1', 'P-stay']);
    expect(ctx.deleted()).toEqual([]);
  });
});

describe('a package whose gallery holds plain addresses (the edit-package upload)', () => {
  test('deletes the one image the gallery and cover name', async () => {
    const data = baseData();
    data.packages[0] = {
      id: 'P1',
      supplierId: 'S1',
      gallery: [{ url: '/api/photos/orig_only', approved: true }],
      image: '/api/photos/orig_only',
    };
    const ctx = setup({ data });

    await ctx.ownDelete('P1').expect(200);

    expect(ctx.deleted()).toEqual(['/api/photos/orig_only']);
  });

  test('ignores addresses that are not stored images', async () => {
    const data = baseData();
    data.packages[0] = {
      id: 'P1',
      supplierId: 'S1',
      gallery: ['/uploads/legacy.jpg', 'https://example.com/a.jpg', '/assets/placeholder.webp'],
      image: '/assets/placeholder.webp',
    };
    const ctx = setup({ data });

    await ctx.ownDelete('P1').expect(200);

    expect(ctx.deleted()).toEqual([]);
  });
});

describe('an admin deleting a package whose supplier no longer exists', () => {
  test('leaves its images for the orphan sweep: there is nobody to compare ownership with', async () => {
    const data = baseData();
    data.packages[0].supplierId = 'S-gone';
    const ctx = setup({ data });

    await ctx.adminDelete('P1').expect(200);

    expect(packageIds(ctx)).toEqual(['P-stay']);
    expect(ctx.deleted()).toEqual([]);
  });
});

describe("a supplier cannot delete another supplier's package or its photos", () => {
  test('a 403 deletes nothing', async () => {
    const data = baseData();
    data.packages[0].supplierId = 'S-other';
    const ctx = setup({ data });

    await ctx.ownDelete('P1').expect(403);

    expect(packageIds(ctx)).toEqual(['P1', 'P-stay']);
    expect(ctx.deleted()).toEqual([]);
  });
});
