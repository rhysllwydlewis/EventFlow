/**
 * POST /api/admin/photos/:id/approve adds the approved photo to the supplier's gallery, but only
 * when the URL is not already there, and decides that in the database write itself so two admins
 * approving the same photo at once cannot insert it twice.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

function createApp({ photo, supplier }) {
  jest.resetModules();
  jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
  const router = require('../../routes/photos');
  const dbUnified = {
    findOne: jest.fn(async (collection, query) => {
      if (collection === 'photos') {
        return query.id === photo.id ? { ...photo } : null;
      }
      return supplier && query.id === supplier.id ? supplier : null;
    }),
    updateOne: jest.fn(async () => true),
  };
  const pass = (_req, _res, next) => next();
  router.initializeDependencies({
    dbUnified,
    authRequired: (req, _res, next) => {
      req.user = { id: 'admin_1', role: 'admin' };
      next();
    },
    roleRequired: () => pass,
    featureRequired: () => pass,
    csrfProtection: pass,
    photoUpload: {},
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
  });
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  return { app, dbUnified };
}

const pendingPhoto = {
  id: 'photo_pending',
  supplierId: 'sup_1',
  url: '/api/photos/new_photo',
  uploadedAt: '2026-11-01T10:00:00.000Z',
  status: 'pending',
};

describe('admin photo approval and the supplier gallery', () => {
  test('appends the photo with a write that only matches while its URL is absent', async () => {
    const supplier = { id: 'sup_1', photosGallery: [{ url: '/api/photos/older' }] };
    const { app, dbUnified } = createApp({ photo: pendingPhoto, supplier });

    await request(app).post('/api/admin/photos/photo_pending/approve').expect(200);

    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1', 'photosGallery.url': { $ne: '/api/photos/new_photo' } },
      {
        $push: {
          photosGallery: {
            $each: [
              { url: '/api/photos/new_photo', approved: true, uploadedAt: pendingPhoto.uploadedAt },
            ],
          },
        },
      }
    );
  });

  test('falls back to replacing a legacy null gallery instead of failing the $push', async () => {
    const supplier = { id: 'sup_1', photosGallery: null };
    const { app, dbUnified } = createApp({ photo: pendingPhoto, supplier });

    await request(app).post('/api/admin/photos/photo_pending/approve').expect(200);

    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1', 'photosGallery.url': { $ne: '/api/photos/new_photo' } },
      {
        $set: {
          photosGallery: [
            { url: '/api/photos/new_photo', approved: true, uploadedAt: pendingPhoto.uploadedAt },
          ],
        },
      }
    );
  });

  test('does not append a photo the gallery already has', async () => {
    const supplier = { id: 'sup_1', photosGallery: [{ url: '/api/photos/new_photo' }] };
    const { app, dbUnified } = createApp({ photo: pendingPhoto, supplier });

    await request(app).post('/api/admin/photos/photo_pending/approve').expect(200);

    const supplierWrites = dbUnified.updateOne.mock.calls.filter(([c]) => c === 'suppliers');
    expect(supplierWrites).toHaveLength(0);
  });

  test('still approves the photo when its supplier no longer exists', async () => {
    const { app, dbUnified } = createApp({ photo: pendingPhoto, supplier: null });

    const res = await request(app).post('/api/admin/photos/photo_pending/approve').expect(200);

    expect(res.body.success).toBe(true);
    expect(dbUnified.updateOne).toHaveBeenCalledTimes(1);
    expect(dbUnified.updateOne.mock.calls[0][0]).toBe('photos');
  });

  test('404s an unknown photo without writing anything', async () => {
    const { app, dbUnified } = createApp({ photo: pendingPhoto, supplier: null });

    await request(app).post('/api/admin/photos/nope/approve').expect(404);

    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });
});
