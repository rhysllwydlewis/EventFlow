/**
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/catalogCache', () => ({
  invalidate: jest.fn(() => Promise.resolve()),
}));

function createApp(existingSupplier) {
  jest.resetModules();
  const router = require('../../routes/suppliers-v2');
  const dbUnified = {
    read: jest.fn(async collection => (collection === 'suppliers' ? [existingSupplier] : [])),
    updateOne: jest.fn(async () => true),
  };
  const photoUpload = {
    deleteImage: jest.fn(async () => true),
    processAndSaveImage: jest.fn(),
  };
  const pass = (_req, _res, next) => next();
  const authRequired = (req, _res, next) => {
    req.user = { id: existingSupplier.ownerUserId, role: 'supplier' };
    next();
  };

  router.initializeDependencies({
    dbUnified,
    authRequired,
    requireVerifiedUser: pass,
    csrfProtection: pass,
    featureRequired: () => pass,
    photoUpload,
    writeLimiter: pass,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/me/suppliers', router);
  return { app, dbUnified, photoUpload };
}

describe('supplier gallery legacy URL identity compatibility', () => {
  test('deletes a photo addressed by an encoded stored URL', async () => {
    const legacyUrl = '/api/photos/optimized_legacy';
    const existingSupplier = {
      id: 'sup_1',
      ownerUserId: 'user_1',
      photosGallery: [
        { url: legacyUrl, thumbnail: '/api/photos/thumb_legacy' },
        { id: 'photo_keep', url: '/api/photos/keep' },
      ],
    };
    const { app, dbUnified, photoUpload } = createApp(existingSupplier);

    await request(app)
      .delete(`/api/me/suppliers/sup_1/photos/${encodeURIComponent(legacyUrl)}`)
      .expect(200);

    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      {
        $set: expect.objectContaining({
          photosGallery: [{ id: 'photo_keep', url: '/api/photos/keep' }],
          updatedAt: expect.any(String),
        }),
      }
    );
    expect(photoUpload.deleteImage).toHaveBeenCalledWith(legacyUrl);
  });

  test('reorders photos addressed by stored URLs', async () => {
    const firstUrl = '/api/photos/first';
    const secondUrl = '/api/photos/second';
    const existingSupplier = {
      id: 'sup_2',
      ownerUserId: 'user_2',
      photosGallery: [
        { url: firstUrl, thumbnail: '/api/photos/first-thumb' },
        { url: secondUrl, thumbnail: '/api/photos/second-thumb' },
      ],
    };
    const { app, dbUnified } = createApp(existingSupplier);

    const response = await request(app)
      .patch('/api/me/suppliers/sup_2/photos/order')
      .send({ photoIds: [secondUrl, firstUrl] })
      .expect(200);

    expect(response.body.photosGallery.map(photo => photo.url)).toEqual([secondUrl, firstUrl]);
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_2' },
      {
        $set: expect.objectContaining({
          photosGallery: [
            { url: secondUrl, thumbnail: '/api/photos/second-thumb' },
            { url: firstUrl, thumbnail: '/api/photos/first-thumb' },
          ],
          updatedAt: expect.any(String),
        }),
      }
    );
  });
});
