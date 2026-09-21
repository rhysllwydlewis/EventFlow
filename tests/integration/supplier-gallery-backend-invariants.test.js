/**
 * @jest-environment node
 *
 * Gallery identity and backend invariants (P0 item 4 of
 * docs/audits/SUPPLIER_PROFILE_EDITING_CORRECTNESS_HANDOFF.md):
 *
 * - every uploaded gallery photo gets a server-generated id;
 * - the gallery upload enforces the same plan-based allowance
 *   (utils/photoGalleryAllowance.checkPhotoAllowance) as routes/photos.js,
 *   not a hard-coded ceiling that would cap an unlimited plan at ten;
 * - every gallery mutation (upload, delete, reorder) stamps `updatedAt`
 *   and invalidates the public catalogue cache.
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/catalogCache', () => ({
  invalidate: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/subscriptionService', () => ({
  getPhotoAllowance: jest.fn(() => Promise.resolve(10)),
}));

function createApp(existingSupplier) {
  jest.resetModules();
  const router = require('../../routes/suppliers-v2');
  // Re-require after resetModules so assertions see the same mock instance
  // the router itself picked up from the fresh module registry.
  const catalogCache = require('../../services/catalogCache');
  const subscriptionService = require('../../services/subscriptionService');
  const dbUnified = {
    read: jest.fn(async collection => (collection === 'suppliers' ? [existingSupplier] : [])),
    updateOne: jest.fn(async () => true),
  };
  const photoUpload = {
    deleteImage: jest.fn(async () => true),
    processAndSaveImage: jest.fn(async (_buffer, filename) => ({
      optimized: `/api/photos/optimized_${filename}`,
      thumbnail: `/api/photos/thumb_${filename}`,
      large: `/api/photos/large_${filename}`,
      original: `/api/photos/original_${filename}`,
    })),
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
  app.use(express.json({ limit: '15mb' }));
  app.use('/api/me/suppliers', router);
  return { app, dbUnified, photoUpload, catalogCache, subscriptionService };
}

const TINY_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('supplier gallery backend invariants', () => {
  test('upload assigns a server-generated photo id, stamps updatedAt, and busts the catalogue cache', async () => {
    const existingSupplier = {
      id: 'sup_1',
      ownerUserId: 'user_1',
      photosGallery: [],
    };
    const { app, dbUnified, catalogCache } = createApp(existingSupplier);

    const res = await request(app)
      .post('/api/me/suppliers/sup_1/photos')
      .send({ image: TINY_PNG_BASE64 })
      .expect(200);

    expect(res.body.photo.id).toEqual(expect.stringMatching(/^photo_\d+_[0-9a-f]+$/));
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      {
        $set: expect.objectContaining({
          photosGallery: [expect.objectContaining({ id: res.body.photo.id })],
          updatedAt: expect.any(String),
        }),
      }
    );
    expect(catalogCache.invalidate).toHaveBeenCalledTimes(1);
  });

  test('rejects an eleventh photo on a 10-photo plan with 403 without touching storage', async () => {
    const tenPhotos = Array.from({ length: 10 }, (_, i) => ({
      id: `photo_${i}`,
      url: `/api/photos/existing_${i}`,
    }));
    const existingSupplier = {
      id: 'sup_2',
      ownerUserId: 'user_2',
      photosGallery: tenPhotos,
    };
    const { app, dbUnified, photoUpload, catalogCache } = createApp(existingSupplier);

    const res = await request(app)
      .post('/api/me/suppliers/sup_2/photos')
      .send({ image: TINY_PNG_BASE64 })
      .expect(403);

    expect(res.body.code).toBe('PHOTO_LIMIT_REACHED');
    expect(photoUpload.processAndSaveImage).not.toHaveBeenCalled();
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
    expect(catalogCache.invalidate).not.toHaveBeenCalled();
  });

  test('an unlimited plan can upload past ten photos', async () => {
    const elevenPhotos = Array.from({ length: 11 }, (_, i) => ({
      id: `photo_${i}`,
      url: `/api/photos/existing_${i}`,
    }));
    const existingSupplier = {
      id: 'sup_4',
      ownerUserId: 'user_4',
      photosGallery: elevenPhotos,
    };
    const { app, subscriptionService } = createApp(existingSupplier);
    subscriptionService.getPhotoAllowance.mockResolvedValueOnce(-1);

    const res = await request(app)
      .post('/api/me/suppliers/sup_4/photos')
      .send({ image: TINY_PNG_BASE64 })
      .expect(200);

    expect(res.body.photo.id).toEqual(expect.stringMatching(/^photo_\d+_[0-9a-f]+$/));
  });

  test('delete busts the catalogue cache', async () => {
    const existingSupplier = {
      id: 'sup_3',
      ownerUserId: 'user_3',
      photosGallery: [
        { id: 'photo_a', url: '/api/photos/a' },
        { id: 'photo_b', url: '/api/photos/b' },
      ],
    };
    const { app, catalogCache } = createApp(existingSupplier);

    await request(app).delete('/api/me/suppliers/sup_3/photos/photo_a').expect(200);

    expect(catalogCache.invalidate).toHaveBeenCalledTimes(1);
  });
});
