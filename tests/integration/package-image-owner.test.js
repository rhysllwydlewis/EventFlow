/**
 * A package photo uploaded as a base64 image (the package form) records whose it is.
 *
 * Creating a package and editing one both turn an uploaded `data:` image into stored images, and
 * both now tell the image store whose they are: `ownerUserId` is the supplier's owner and
 * `uploadedBy` is who uploaded. That is what later lets deleting a gallery photo keep an image that
 * belongs to somebody else.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

const DATA_IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
const pass = (_req, _res, next) => next();

function setup({ processAndSaveImage, supplierOwner = 'user_1' } = {}) {
  jest.resetModules();
  jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
  jest.doMock('../../services/subscriptionService', () => ({
    getUserFeatures: jest.fn(async () => ({ name: 'Pro', features: { maxPackages: -1 } })),
  }));
  jest.doMock('../../services/partnerService', () => ({ awardPackageBonus: jest.fn() }));
  const router = require('../../routes/packages');

  const supplier = { id: 'sup_1', ownerUserId: supplierOwner, approved: true };
  const existing = { id: 'pkg_1', supplierId: 'sup_1', title: 'Mine', image: '', gallery: [] };
  const dbUnified = {
    find: jest.fn(async collection => (collection === 'suppliers' ? [supplier] : [])),
    findOne: jest.fn(async collection => {
      if (collection === 'packages') {
        return existing;
      }
      return collection === 'suppliers' ? supplier : null;
    }),
    read: jest.fn(async () => ({})),
    updateOne: jest.fn(async () => true),
    insertOne: jest.fn(async doc => doc),
  };
  const photoUpload = {
    deleteImage: jest.fn(),
    processAndSaveImage: jest.fn(
      processAndSaveImage || (async () => ({ original: '/api/photos/orig_1' }))
    ),
  };
  router.initializeDependencies({
    dbUnified,
    authRequired: (req, _res, next) => {
      req.user = { id: 'user_1', role: 'supplier' };
      req.userId = 'user_1';
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
  return { app, dbUnified, photoUpload };
}

const newPackage = image => ({
  title: 'Garden party',
  price: '£500',
  primaryCategoryKey: 'venues',
  eventTypes: ['wedding'],
  supplierId: 'sup_1',
  image,
});

describe('creating a package with an uploaded image', () => {
  test('stores the image as the supplier owner, uploaded by the signed-in user', async () => {
    const { app, dbUnified, photoUpload } = setup({ supplierOwner: 'owner_7' });

    const res = await request(app)
      .post('/api/me/packages')
      .send(newPackage(DATA_IMAGE))
      .expect(200);

    expect(photoUpload.processAndSaveImage).toHaveBeenCalledTimes(1);
    const [buffer, filename, context, owner] = photoUpload.processAndSaveImage.mock.calls[0];
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(filename).toMatch(/^package_pkg_test_\d+_[a-z0-9]+\.png$/);
    expect(context).toBe('supplier');
    expect(owner).toEqual({ ownerUserId: 'owner_7', uploadedBy: 'user_1' });
    expect(res.body.package.image).toBe('/api/photos/orig_1');
    expect(res.body.package.gallery.map(item => item.url)).toEqual(['/api/photos/orig_1']);
    expect(dbUnified.insertOne).toHaveBeenCalledTimes(1);
  });

  test('a photo that cannot be processed still saves the package, and says so', async () => {
    const { app, dbUnified } = setup({
      processAndSaveImage: async () => {
        throw new Error('sharp failed');
      },
    });

    const res = await request(app)
      .post('/api/me/packages')
      .send(newPackage(DATA_IMAGE))
      .expect(200);

    expect(res.body.package.image).toBe('');
    expect(res.body.package.gallery).toEqual([]);
    expect(res.body.imageProcessingError).toMatch(/could not be processed/);
    expect(dbUnified.insertOne).toHaveBeenCalledTimes(1);
  });
});

describe('editing a package with an uploaded image', () => {
  test('stores the image as the signed-in owner, and points the package at it', async () => {
    const { app, dbUnified, photoUpload } = setup();

    await request(app).put('/api/me/packages/pkg_1').send({ image: DATA_IMAGE }).expect(200);

    expect(photoUpload.processAndSaveImage).toHaveBeenCalledTimes(1);
    const [, filename, context, owner] = photoUpload.processAndSaveImage.mock.calls[0];
    expect(filename).toMatch(/^package_pkg_1_\d+\.png$/);
    expect(context).toBe('supplier');
    expect(owner).toEqual({ ownerUserId: 'user_1', uploadedBy: 'user_1' });
    const set = dbUnified.updateOne.mock.calls[0][2].$set;
    expect(set.image).toBe('/api/photos/orig_1');
    expect(set.gallery.map(item => item.url)).toContain('/api/photos/orig_1');
  });

  test('a photo that cannot be processed keeps the previous one, and says so', async () => {
    const { app, dbUnified } = setup({
      processAndSaveImage: async () => {
        throw new Error('sharp failed');
      },
    });

    const res = await request(app)
      .put('/api/me/packages/pkg_1')
      .send({ image: DATA_IMAGE })
      .expect(200);

    expect(res.body.imageProcessingError).toMatch(/previous photo was kept/);
    expect(dbUnified.updateOne.mock.calls[0][2].$set).not.toHaveProperty('image');
  });
});
