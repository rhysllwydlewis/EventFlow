/**
 * DELETE /api/photos/delete must only remove a photo that is in the caller's own gallery.
 * It used to delete the stored file by address alone once the caller owned the supplier or package
 * named in the query, so any supplier could delete another supplier's photos.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

function createApp({ suppliers, packages, user }) {
  jest.resetModules();
  jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }), {
    virtual: false,
  });
  const router = require('../../routes/photos');
  const deleteImage = jest.fn(async () => true);
  const dbUnified = {
    findOne: jest.fn(async (collection, query) => {
      const list = collection === 'suppliers' ? suppliers : packages;
      return list.find(item => item.id === query.id) || null;
    }),
    updateOne: jest.fn(async () => true),
    find: jest.fn(async (collection, query) => {
      if (collection === 'suppliers') {
        return suppliers.filter(item =>
          (item.photosGallery || []).some(p => p.url === query['photosGallery.url'])
        );
      }
      const asUrl = p => (typeof p === 'string' ? p : p.url);
      return packages.filter(item => {
        if (query['gallery.url']) {
          return (item.gallery || []).some(
            p => typeof p !== 'string' && p.url === query['gallery.url']
          );
        }
        if (query.gallery) {
          return (item.gallery || []).some(
            p => typeof p === 'string' && asUrl(p) === query.gallery
          );
        }
        return item.image === query.image;
      });
    }),
    insertOne: jest.fn(async doc => doc),
  };
  const pass = (_req, _res, next) => next();
  router.initializeDependencies({
    dbUnified,
    authRequired: (req, _res, next) => {
      req.user = user;
      next();
    },
    roleRequired: () => pass,
    featureRequired: () => pass,
    csrfProtection: pass,
    photoUpload: { deleteImage },
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
  });
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  return { app, dbUnified, deleteImage };
}

const mine = '/api/photos/mine_photo';
const theirs = '/api/photos/their_photo';
const pkgPhoto = '/api/photos/pkg_photo';
const suppliers = [
  { id: 'sup_me', ownerUserId: 'user_me', photosGallery: [{ url: mine }] },
  { id: 'sup_other', ownerUserId: 'user_other', photosGallery: [{ url: theirs }] },
];
const packages = [
  {
    id: 'pkg_me',
    supplierId: 'sup_me',
    gallery: [{ url: pkgPhoto }, pkgPhoto + '_2'],
    image: pkgPhoto,
  },
];
const user = { id: 'user_me', role: 'supplier' };

function del(app, query) {
  return request(app).delete('/api/photos/delete').query(query).send();
}

describe('DELETE /api/photos/delete', () => {
  test('removes a photo from the caller’s own supplier gallery and deletes the file', async () => {
    const { app, dbUnified, deleteImage } = createApp({ suppliers, packages, user });
    await del(app, { type: 'supplier', id: 'sup_me', photoUrl: mine }).expect(200);
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_me' },
      { $set: { photosGallery: [] } }
    );
    expect(deleteImage).toHaveBeenCalledWith(mine);
  });

  test('does not delete another supplier’s photo through the caller’s own supplier id', async () => {
    const { app, dbUnified, deleteImage } = createApp({ suppliers, packages, user });
    await del(app, { type: 'supplier', id: 'sup_me', photoUrl: theirs }).expect(404);
    expect(deleteImage).not.toHaveBeenCalled();
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });

  test('does not delete another supplier’s photo through the caller’s own package', async () => {
    const { app, dbUnified, deleteImage } = createApp({ suppliers, packages, user });
    await del(app, { type: 'package', id: 'pkg_me', photoUrl: theirs }).expect(404);
    expect(deleteImage).not.toHaveBeenCalled();
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });

  test('removes a photo from the caller’s own package and keeps the cover in step', async () => {
    const { app, dbUnified, deleteImage } = createApp({ suppliers, packages, user });
    await del(app, { type: 'package', id: 'pkg_me', photoUrl: pkgPhoto }).expect(200);
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'packages',
      { id: 'pkg_me' },
      { $set: { gallery: [pkgPhoto + '_2'], image: pkgPhoto + '_2' } }
    );
    expect(deleteImage).toHaveBeenCalledWith(pkgPhoto);
  });

  test('keeps the stored file when the caller’s own package still shows it', async () => {
    const shared = [
      { id: 'sup_me', ownerUserId: 'user_me', photosGallery: [{ url: pkgPhoto }] },
      suppliers[1],
    ];
    const { app, deleteImage } = createApp({ suppliers: shared, packages, user });
    await del(app, { type: 'supplier', id: 'sup_me', photoUrl: pkgPhoto }).expect(200);
    expect(deleteImage).not.toHaveBeenCalled();
  });

  test('keeps the stored file when another supplier’s gallery still shows it', async () => {
    // A package gallery accepts any address, so the caller can list another supplier's photo in it.
    const copied = [
      ...packages,
      { id: 'pkg_copy', supplierId: 'sup_me', gallery: [{ url: theirs }], image: theirs },
    ];
    const { app, deleteImage } = createApp({ suppliers, packages: copied, user });
    await del(app, { type: 'package', id: 'pkg_copy', photoUrl: theirs }).expect(200);
    expect(deleteImage).not.toHaveBeenCalled();
  });

  test('refuses to touch a supplier the caller does not own', async () => {
    const { app, deleteImage } = createApp({ suppliers, packages, user });
    await del(app, { type: 'supplier', id: 'sup_other', photoUrl: theirs }).expect(403);
    expect(deleteImage).not.toHaveBeenCalled();
  });
});
