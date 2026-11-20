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
        // The legacy record has no id, so it is pulled by its URL.
        $pull: { photosGallery: { url: legacyUrl } },
        $set: { updatedAt: expect.any(String) },
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

// The photos page (/gallery) lists a gallery, then deletes a photo using the id the list gave it.
// Photos uploaded through POST /api/photos/upload/batch are stored without an `id`, so for them the
// id in the list has to be something the delete and reorder routes accept, the stored URL. The list
// used to invent `photo_<position>`, which neither route recognises: the page showed the photo but
// answered "Photo not found" when it was deleted.
describe('an id the list route gives out is accepted by the delete and reorder routes', () => {
  const idLessGallery = () => [
    { url: '/api/photos/opt_first', thumbnail: '/api/photos/thumb_first', approved: true },
    { url: '/api/photos/opt_second', thumbnail: '/api/photos/thumb_second', approved: true },
    { id: 'photo_own', url: '/api/photos/opt_own', thumbnail: '/api/photos/thumb_own' },
  ];

  test('lists a photo that has no id under its stored URL, and keeps a real id as it is', async () => {
    const { app } = createApp({
      id: 'sup_3',
      ownerUserId: 'user_3',
      photosGallery: idLessGallery(),
    });

    const response = await request(app).get('/api/me/suppliers/sup_3/photos').expect(200);

    expect(response.body.photos.map(photo => photo.id)).toEqual([
      '/api/photos/opt_first',
      '/api/photos/opt_second',
      'photo_own',
    ]);
  });

  test('deletes an id-less photo using the id the list returned for it', async () => {
    const { app, dbUnified, photoUpload } = createApp({
      id: 'sup_3',
      ownerUserId: 'user_3',
      photosGallery: idLessGallery(),
    });

    const listed = await request(app).get('/api/me/suppliers/sup_3/photos').expect(200);
    const second = listed.body.photos[1];

    const response = await request(app)
      .delete(`/api/me/suppliers/sup_3/photos/${encodeURIComponent(second.id)}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_3' },
      expect.objectContaining({ $pull: { photosGallery: { url: '/api/photos/opt_second' } } })
    );
    expect(photoUpload.deleteImage).toHaveBeenCalledWith('/api/photos/opt_second');
  });

  test('reorders photos using the ids the list returned', async () => {
    const { app } = createApp({
      id: 'sup_3',
      ownerUserId: 'user_3',
      photosGallery: idLessGallery(),
    });

    const listed = await request(app).get('/api/me/suppliers/sup_3/photos').expect(200);
    const ids = listed.body.photos.map(photo => photo.id).reverse();

    const response = await request(app)
      .patch('/api/me/suppliers/sup_3/photos/order')
      .send({ photoIds: ids })
      .expect(200);

    expect(response.body.photosGallery.map(photo => photo.url)).toEqual([
      '/api/photos/opt_own',
      '/api/photos/opt_second',
      '/api/photos/opt_first',
    ]);
  });
});
