/**
 * Deleting a photo from a gallery deletes the stored images behind it.
 *
 * One upload stores four images (original, thumbnail, optimised, large). Every route that removes
 * a photo from a gallery used to delete at most the optimised one, so the others stayed in storage
 * and stayed publicly readable by their address. These tests run the real routers against an
 * in-memory database that applies their updates and matches filters as MongoDB does, for the four
 * places a photo can be deleted from:
 *
 *   - DELETE /api/me/suppliers/:id/photos/:photoId   (the photos page, supplier profile)
 *   - DELETE /api/me/packages/:id/photos             (the photos page, package)
 *   - DELETE /api/photos/delete?type=supplier        (older endpoint)
 *   - DELETE /api/photos/delete?type=package         (older endpoint)
 *
 * What must NOT be deleted matters as much: an image another record still uses, anything when it
 * cannot be checked, and anything the request names but the gallery did not hold.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');
const { createMongoStyleDb } = require('../helpers/mongo-style-db');

jest.mock('../../services/catalogCache', () => ({ invalidate: jest.fn(() => Promise.resolve()) }));

const photo = name => ({
  url: `/api/photos/photo_${name}_opt`,
  thumbnail: `/api/photos/photo_${name}_thumb`,
  large: `/api/photos/photo_${name}_large`,
  original: `/api/photos/photo_${name}_orig`,
  approved: true,
  uploadedAt: '2026-11-20T19:30:00.000Z',
});
const gone = photo('gone');
const stay = photo('stay');
const victim = photo('victim');
const GONE_ADDRESSES = [gone.url, gone.thumbnail, gone.large, gone.original];

const OWNER = { id: 'user_1', role: 'supplier' };
const pass = (_req, _res, next) => next();

/**
 * Photo storage. By default it says no image has a recorded owner, as for every image stored before
 * owners were recorded (so the reference check alone decides). `owners` says whose an address is, or
 * is an Error to make the lookup fail.
 */
const storage = (deleteImage, owners = {}) => ({
  deleteImage,
  processAndSaveImage: jest.fn(),
  getImageOwners: async addresses => {
    if (owners instanceof Error) {
      throw owners;
    }
    return Object.fromEntries(addresses.map(address => [address, owners[address] || null]));
  },
});

/** Build the dependencies every router in this file shares. */
function dependencies(db, user) {
  const deleteImage = jest.fn(async () => undefined);
  const dbUnified = {
    read: jest.fn(db.read),
    find: jest.fn(db.find),
    findOne: jest.fn(db.findOne),
    updateOne: jest.fn(db.updateOne),
  };
  const authRequired = (req, _res, next) => {
    req.user = user;
    req.userId = user.id;
    next();
  };
  return { dbUnified, deleteImage, authRequired };
}

const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() };

function mount(prefix, router) {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  return app;
}

/** The four routes. Each returns the app, and how to delete `photo` through it. */
const ROUTES = [
  {
    name: 'DELETE /api/me/suppliers/:id/photos/:photoId',
    kind: 'supplier',
    build(db, user, owners) {
      jest.resetModules();
      const router = require('../../routes/suppliers-v2');
      const { dbUnified, deleteImage, authRequired } = dependencies(db, user);
      router.initializeDependencies({
        dbUnified,
        authRequired,
        requireVerifiedUser: pass,
        csrfProtection: pass,
        featureRequired: () => pass,
        photoUpload: storage(deleteImage, owners),
        writeLimiter: pass,
      });
      return {
        app: mount('/api/me/suppliers', router),
        dbUnified,
        deleteImage,
        remove: (app, target) =>
          request(app).delete(`/api/me/suppliers/sup_1/photos/${encodeURIComponent(target.url)}`),
      };
    },
  },
  {
    name: 'DELETE /api/me/packages/:id/photos',
    kind: 'package',
    build(db, user, owners) {
      jest.resetModules();
      jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
      const router = require('../../routes/packages');
      const { dbUnified, deleteImage, authRequired } = dependencies(db, user);
      router.initializeDependencies({
        dbUnified,
        authRequired,
        roleRequired: () => pass,
        requireVerifiedUser: pass,
        requireApprovedSupplier: pass,
        csrfProtection: pass,
        featureRequired: () => pass,
        writeLimiter: pass,
        photoUpload: storage(deleteImage, owners),
        uploadValidation: {},
        logger,
        uid: prefix => `${prefix}_test`,
      });
      return {
        app: mount('/api', router),
        dbUnified,
        deleteImage,
        remove: (app, target) =>
          request(app).delete('/api/me/packages/pkg_1/photos').send({ url: target.url }),
      };
    },
  },
  ...['supplier', 'package'].map(kind => ({
    name: `DELETE /api/photos/delete?type=${kind}`,
    kind,
    build(db, user, owners) {
      jest.resetModules();
      jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
      const router = require('../../routes/photos');
      const { dbUnified, deleteImage, authRequired } = dependencies(db, user);
      router.initializeDependencies({
        dbUnified,
        authRequired,
        roleRequired: () => pass,
        featureRequired: () => pass,
        csrfProtection: pass,
        photoUpload: storage(deleteImage, owners),
        logger,
      });
      return {
        app: mount('/api', router),
        dbUnified,
        deleteImage,
        remove: (app, target) =>
          request(app)
            .delete('/api/photos/delete')
            .query({
              type: kind,
              id: kind === 'supplier' ? 'sup_1' : 'pkg_1',
              photoUrl: target.url,
            }),
      };
    },
  })),
];

/**
 * The records for one kind of delete. `gone` is in exactly one gallery, so removing it leaves
 * nothing else pointing at it unless a test adds a reference.
 */
function records(kind, extra = {}) {
  const supplier = { id: 'sup_1', ownerUserId: 'user_1', photosGallery: [stay], ...extra.supplier };
  const pkg = { id: 'pkg_1', supplierId: 'sup_1', gallery: [stay], image: stay.url, ...extra.pkg };
  if (kind === 'supplier') {
    supplier.photosGallery = [gone, stay];
  } else {
    pkg.gallery = [gone, stay];
  }
  return {
    suppliers: [
      supplier,
      { id: 'sup_2', ownerUserId: 'user_2', photosGallery: [victim], ...extra.other },
    ],
    packages: [pkg, ...(extra.morePackages || [])],
    users: [],
    marketplace_listings: [],
    reviews: extra.reviews || [],
  };
}

const addressesDeleted = deleteImage => deleteImage.mock.calls.map(([address]) => address);

describe.each(ROUTES)('$name', route => {
  test('deletes all four stored images, and removes the reference', async () => {
    const db = createMongoStyleDb(records(route.kind));
    const { app, remove, deleteImage } = route.build(db, OWNER);

    await remove(app, gone).expect(200);

    expect(addressesDeleted(deleteImage)).toEqual(GONE_ADDRESSES);
    const gallery =
      route.kind === 'supplier'
        ? db.collections.suppliers[0].photosGallery
        : db.collections.packages[0].gallery;
    expect(gallery.map(item => item.url)).toEqual([stay.url]);
  });

  test('keeps an image another record still uses, and deletes the rest', async () => {
    // The supplier is using one of the photo's copies as their logo
    const db = createMongoStyleDb(records(route.kind, { supplier: { logo: gone.thumbnail } }));
    const { app, remove, deleteImage } = route.build(db, OWNER);

    await remove(app, gone).expect(200);

    expect(addressesDeleted(deleteImage)).toEqual([gone.url, gone.large, gone.original]);
  });

  test('keeps an image a package of another supplier still shows', async () => {
    const db = createMongoStyleDb(
      records(route.kind, {
        morePackages: [{ id: 'pkg_other', supplierId: 'sup_2', image: gone.url, gallery: [] }],
      })
    );
    const { app, remove, deleteImage } = route.build(db, OWNER);

    await remove(app, gone).expect(200);

    expect(addressesDeleted(deleteImage)).toEqual([gone.thumbnail, gone.large, gone.original]);
  });

  test("keeps a customer's review photo that was copied into the gallery, and deletes the rest", async () => {
    // Stored images have no owner, so a supplier can put a review photo's address in their own
    // gallery. Removing it from there must not destroy the customer's photo.
    const db = createMongoStyleDb(
      records(route.kind, { reviews: [{ id: 'rev_1', userId: 'customer', photos: [gone.large] }] })
    );
    const { app, remove, deleteImage } = route.build(db, OWNER);

    await remove(app, gone).expect(200);

    expect(addressesDeleted(deleteImage)).toEqual([gone.url, gone.thumbnail, gone.original]);
  });

  test("keeps an image recorded as another user's, even when nothing refers to it", async () => {
    // A supplier names a customer's image (here the large copy) in their own gallery record. No
    // field lists it anywhere, but the image itself records whose it is
    const owners = { [gone.large]: 'customer_9' };
    const db = createMongoStyleDb(records(route.kind));
    const { app, remove, deleteImage } = route.build(db, OWNER, owners);

    await remove(app, gone).expect(200);

    expect(addressesDeleted(deleteImage)).toEqual([gone.url, gone.thumbnail, gone.original]);
  });

  test("deletes every image recorded as the gallery owner's", async () => {
    const owners = Object.fromEntries(GONE_ADDRESSES.map(address => [address, OWNER.id]));
    const db = createMongoStyleDb(records(route.kind));
    const { app, remove, deleteImage } = route.build(db, OWNER, owners);

    await remove(app, gone).expect(200);

    expect(addressesDeleted(deleteImage)).toEqual(GONE_ADDRESSES);
  });

  test('keeps everything, and still answers success, when it cannot read whose the images are', async () => {
    const db = createMongoStyleDb(records(route.kind));
    const { app, remove, deleteImage } = route.build(db, OWNER, new Error('database down'));

    await remove(app, gone).expect(200);

    expect(deleteImage).not.toHaveBeenCalled();
  });

  test('keeps everything, and still answers success, when it cannot check what uses the images', async () => {
    const db = createMongoStyleDb(records(route.kind));
    const { app, remove, deleteImage, dbUnified } = route.build(db, OWNER);
    dbUnified.find.mockRejectedValue(new Error('database down'));

    await remove(app, gone).expect(200);

    expect(deleteImage).not.toHaveBeenCalled();
  });

  test('still answers success when storage fails to delete an image', async () => {
    const db = createMongoStyleDb(records(route.kind));
    const { app, remove, deleteImage } = route.build(db, OWNER);
    deleteImage.mockRejectedValue(new Error('storage error'));

    await remove(app, gone).expect(200);

    expect(deleteImage).toHaveBeenCalledTimes(4);
  });

  test('deletes nothing for a photo that was not in the gallery, even if it exists elsewhere', async () => {
    // Asking to delete another supplier's photo must neither remove it nor delete its images
    const db = createMongoStyleDb(records(route.kind));
    const { app, remove, deleteImage } = route.build(db, OWNER);

    await remove(app, victim);

    expect(deleteImage).not.toHaveBeenCalled();
    expect(db.collections.suppliers[1].photosGallery.map(item => item.url)).toEqual([victim.url]);
  });
});

describe("an admin deleting on a supplier's behalf", () => {
  // The images belong to the supplier's owner, not to the admin who is acting
  const ADMIN = { id: 'admin_9', role: 'admin' };

  test.each(ROUTES.filter(route => route.name !== 'DELETE /api/me/packages/:id/photos'))(
    '$name compares with the gallery owner, not the admin',
    async route => {
      const owners = Object.fromEntries(GONE_ADDRESSES.map(address => [address, 'user_1']));
      const db = createMongoStyleDb(records(route.kind));
      const { app, remove, deleteImage } = route.build(db, ADMIN, owners);

      await remove(app, gone).expect(200);

      expect(addressesDeleted(deleteImage)).toEqual(GONE_ADDRESSES);
    }
  );
});

describe('a gallery record that names another image in one of its own fields', () => {
  // A package gallery accepts any address, so a record can claim another supplier's image as its
  // own thumbnail. Deleting the record must not delete theirs.
  test.each(ROUTES.filter(route => route.kind === 'package'))('$name', async route => {
    const crafted = {
      url: gone.url,
      thumbnail: victim.url,
      large: gone.large,
      original: gone.original,
    };
    const base = records('package');
    base.packages[0].gallery = [crafted, stay];
    const db = createMongoStyleDb(base);
    const { app, remove, deleteImage } = route.build(db, OWNER);

    await remove(app, crafted).expect(200);

    expect(addressesDeleted(deleteImage)).not.toContain(victim.url);
    expect(addressesDeleted(deleteImage)).toEqual([gone.url, gone.large, gone.original]);
  });
});

describe('a photo that has an id of its own (supplier profile)', () => {
  test('deletes its four images when deleted by that id', async () => {
    const route = ROUTES[0];
    const base = records('supplier');
    base.suppliers[0].photosGallery = [{ ...gone, id: 'photo_with_id' }, stay];
    const db = createMongoStyleDb(base);
    const { app, deleteImage } = route.build(db, OWNER);

    await request(app).delete('/api/me/suppliers/sup_1/photos/photo_with_id').expect(200);

    expect(addressesDeleted(deleteImage)).toEqual(GONE_ADDRESSES);
  });
});
