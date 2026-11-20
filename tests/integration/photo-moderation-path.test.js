/**
 * The moderation path: photos held for an admin when `photoAutoApprove` is off.
 *
 * It had four problems:
 *
 *  - when saving a held photo's record failed, the images the upload had stored were left behind;
 *  - a held photo's images were protected by nothing, so deleting another gallery photo that named
 *    one of them deleted it;
 *  - approving marked the photo approved BEFORE adding it to the gallery, never checked the plan's
 *    allowance (so approvals could take a gallery past its limit), added only the optimised address
 *    (so the other three stored copies could never be deleted with it), and could leave a photo
 *    "approved" but in no gallery;
 *  - rejecting a held photo deleted nothing, so its four images stayed in storage, publicly readable.
 *
 * These tests run the real router against an in-memory database that applies its updates.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');
const { createMongoStyleDb } = require('../helpers/mongo-style-db');

const mockWorld = { autoApprove: false, allowance: 10 };

jest.mock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
jest.mock('../../middleware/rateLimits', () => {
  const pass = (_req, _res, next) => next();
  return { uploadLimiter: pass, apiLimiter: pass };
});
jest.mock('../../middleware/features', () => ({
  getFeatureFlags: jest.fn(async () => ({ photoAutoApprove: mockWorld.autoApprove })),
}));
jest.mock('../../services/subscriptionService', () => ({
  getPhotoAllowance: jest.fn(async () => mockWorld.allowance),
}));

const router = require('../../routes/photos');

const pass = (_req, _res, next) => next();

/** The four addresses one stored photo is held under. */
const addressesOf = name => [
  `/api/photos/opt_${name}`,
  `/api/photos/thumb_${name}`,
  `/api/photos/large_${name}`,
  `/api/photos/orig_${name}`,
];

const heldPhoto = (name, extra = {}) => {
  const [url, thumbnail, large, original] = addressesOf(name);
  return {
    id: `photo_${name}`,
    supplierId: 'S1',
    url,
    thumbnail,
    large,
    original,
    status: 'pending',
    approved: false,
    uploadedAt: '2026-11-20T10:00:00.000Z',
    ...extra,
  };
};

const baseData = () => ({
  suppliers: [
    { id: 'S1', name: 'Sup One', ownerUserId: 'u1', photosGallery: [{ url: '/api/photos/old' }] },
  ],
  photos: [],
});

/**
 * @param {Object} options
 * @param {Object} [options.data] - Starting records
 * @param {function(Object): boolean} [options.failInsert] - Decides which `photos` inserts fail
 * @param {function(string, Object): boolean} [options.failUpdate] - Decides which updates answer false
 */
function setup({ data = baseData(), failInsert = () => false, failUpdate = () => false } = {}) {
  const db = createMongoStyleDb(data);
  const dbUnified = {
    findOne: jest.fn(db.findOne),
    find: jest.fn(db.find),
    insertOne: jest.fn(async (collection, document) =>
      failInsert(document) ? null : db.insertOne(collection, document)
    ),
    updateOne: jest.fn(async (collection, filter, update) =>
      failUpdate(collection, update) ? false : db.updateOne(collection, filter, update)
    ),
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
      req.user = { id: 'u1', role: req.headers['x-role'] || 'supplier' };
      next();
    },
    roleRequired: () => pass,
    featureRequired: () => pass,
    csrfProtection: pass,
    photoUpload,
    logger,
  });
  const app = express();
  app.use(express.json());
  app.use('/api', router);

  return {
    db,
    dbUnified,
    photoUpload,
    upload: files =>
      request(app).post('/api/photos/upload/batch?type=supplier&id=S1').set('x-files', files),
    single: () =>
      request(app).post('/api/photos/upload?type=supplier&id=S1').set('x-files', 'a.jpg'),
    approve: id => request(app).post(`/api/admin/photos/${id}/approve`).set('x-role', 'admin'),
    reject: (id, reason) =>
      request(app).post(`/api/admin/photos/${id}/reject`).set('x-role', 'admin').send({ reason }),
    deleteFromGallery: url =>
      request(app)
        .delete('/api/photos/delete')
        .query({ type: 'supplier', id: 'S1', photoUrl: url }),
    deleted: () => photoUpload.deleteImage.mock.calls.map(([address]) => address).sort(),
  };
}

const gallery = ctx => ctx.db.collections.suppliers.find(s => s.id === 'S1').photosGallery;
const stored = (ctx, id) => ctx.db.collections.photos.find(p => p.id === id);

beforeEach(() => {
  mockWorld.autoApprove = false;
  mockWorld.allowance = 10;
});

describe('uploading while photos are held for moderation', () => {
  test('a held photo is saved as pending, and nothing is deleted', async () => {
    const ctx = setup();

    const response = await ctx.single().expect(200);

    expect(response.body.pending).toBe(true);
    expect(ctx.db.collections.photos).toHaveLength(1);
    expect(ctx.db.collections.photos[0].status).toBe('pending');
    expect(ctx.deleted()).toEqual([]);
    expect(gallery(ctx)).toHaveLength(1);
  });

  test('single upload: a record that cannot be saved leaves no images behind', async () => {
    const ctx = setup({ failInsert: () => true });

    const response = await ctx.single();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to save photo record. Please try again.' });
    expect(ctx.db.collections.photos).toHaveLength(0);
    expect(ctx.deleted()).toEqual(addressesOf('a.jpg').sort());
  });

  test('batch: only the records that could not be saved lose their images', async () => {
    // The second of three records fails to save
    let inserts = 0;
    const ctx = setup({
      failInsert: () => {
        inserts += 1;
        return inserts === 2;
      },
    });

    const response = await ctx.upload('a.jpg,b.jpg,c.jpg').expect(200);

    expect(response.body.uploaded).toBe(2);
    expect(ctx.db.collections.photos).toHaveLength(2);
    expect(ctx.deleted()).toEqual(addressesOf('b.jpg').sort());
  });

  test('a batch where every record is saved deletes nothing', async () => {
    const ctx = setup();

    await ctx.upload('a.jpg,b.jpg').expect(200);

    expect(ctx.deleted()).toEqual([]);
  });
});

describe('a held photo protects its images', () => {
  const galleryPhotoNaming = held => ({
    url: '/api/photos/gallery_opt',
    // A gallery record can name any address: this one claims the held photo's thumbnail
    thumbnail: held.thumbnail,
  });

  test("deleting a gallery photo that names a pending photo's image does not delete it", async () => {
    const held = heldPhoto('held');
    const data = baseData();
    data.suppliers[0].photosGallery = [galleryPhotoNaming(held)];
    data.photos = [held];
    const ctx = setup({ data });

    await ctx.deleteFromGallery('/api/photos/gallery_opt').expect(200);

    expect(ctx.deleted()).toEqual(['/api/photos/gallery_opt']);
    expect(ctx.deleted()).not.toContain(held.thumbnail);
  });

  test.each(['approved', 'rejected'])(
    'a %s photo record does not keep an image alive',
    async status => {
      const held = heldPhoto('held', { status });
      const data = baseData();
      data.suppliers[0].photosGallery = [galleryPhotoNaming(held)];
      data.photos = [held];
      const ctx = setup({ data });

      await ctx.deleteFromGallery('/api/photos/gallery_opt').expect(200);

      expect(ctx.deleted()).toEqual([held.thumbnail, '/api/photos/gallery_opt'].sort());
    }
  );
});

describe('approving a held photo', () => {
  test('adds all four images to the gallery, then marks the photo approved', async () => {
    const held = heldPhoto('held');
    const ctx = setup({ data: { ...baseData(), photos: [held] } });

    const response = await ctx.approve('photo_held').expect(200);

    expect(response.body.success).toBe(true);
    expect(gallery(ctx)).toHaveLength(2);
    expect(gallery(ctx)[1]).toEqual({
      url: held.url,
      thumbnail: held.thumbnail,
      large: held.large,
      original: held.original,
      approved: true,
      uploadedAt: held.uploadedAt,
    });
    expect(stored(ctx, 'photo_held').status).toBe('approved');
  });

  test('a photo the gallery cannot take stays pending: the gallery is not marked first', async () => {
    const held = heldPhoto('held');
    const ctx = setup({
      data: { ...baseData(), photos: [held] },
      failUpdate: collection => collection === 'suppliers',
    });

    const response = await ctx.approve('photo_held');

    expect(response.status).toBe(500);
    expect(stored(ctx, 'photo_held').status).toBe('pending');
    expect(gallery(ctx)).toHaveLength(1);
  });

  test('a gallery already at the plan limit refuses the approval and the photo stays pending', async () => {
    mockWorld.allowance = 1; // the gallery already holds one photo
    const held = heldPhoto('held');
    const ctx = setup({ data: { ...baseData(), photos: [held] } });

    const response = await ctx.approve('photo_held');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'PHOTO_LIMIT_REACHED', limit: 1 });
    expect(stored(ctx, 'photo_held').status).toBe('pending');
    expect(gallery(ctx)).toHaveLength(1);
  });

  test('a plan with room approves up to its limit and no further', async () => {
    mockWorld.allowance = 3; // one photo held already, two places left
    const data = baseData();
    data.photos = [heldPhoto('a'), heldPhoto('b'), heldPhoto('c')];
    const ctx = setup({ data });

    const statuses = [];
    for (const id of ['photo_a', 'photo_b', 'photo_c']) {
      statuses.push((await ctx.approve(id)).status);
    }

    expect(statuses).toEqual([200, 200, 403]);
    expect(gallery(ctx)).toHaveLength(3);
    expect(stored(ctx, 'photo_c').status).toBe('pending');
  });

  test('approving twice adds it once and answers success both times', async () => {
    const held = heldPhoto('held');
    const ctx = setup({ data: { ...baseData(), photos: [held] } });

    await ctx.approve('photo_held').expect(200);
    await ctx.approve('photo_held').expect(200);

    expect(gallery(ctx).filter(p => p.url === held.url)).toHaveLength(1);
  });

  test('two overlapping approvals of one photo add it once', async () => {
    const held = heldPhoto('held');
    const ctx = setup({ data: { ...baseData(), photos: [held] } });

    const responses = await Promise.all([
      ctx.approve('photo_held').then(r => r),
      ctx.approve('photo_held').then(r => r),
    ]);

    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(gallery(ctx).filter(p => p.url === held.url)).toHaveLength(1);
  });

  test('if only the status update fails, approving again finishes the job without a duplicate', async () => {
    const held = heldPhoto('held');
    let failStatus = true;
    const ctx = setup({
      data: { ...baseData(), photos: [held] },
      failUpdate: collection => collection === 'photos' && failStatus,
    });

    const first = await ctx.approve('photo_held');
    expect(first.status).toBe(500);
    expect(first.body.error).toMatch(/in the gallery but could not be marked approved/);
    expect(gallery(ctx).filter(p => p.url === held.url)).toHaveLength(1);
    expect(stored(ctx, 'photo_held').status).toBe('pending');

    failStatus = false;
    await ctx.approve('photo_held').expect(200);

    expect(gallery(ctx).filter(p => p.url === held.url)).toHaveLength(1);
    expect(stored(ctx, 'photo_held').status).toBe('approved');
  });

  test('retrying an approval at the plan limit succeeds: the photo is already in the gallery', async () => {
    // The gallery holds the old photo and this one (two of two places), because an earlier
    // approval added it and then failed to mark it approved. The retry must not be refused for
    // "no room" by the photo's own earlier addition.
    mockWorld.allowance = 2;
    const held = heldPhoto('held');
    const data = baseData();
    data.photos = [held];
    data.suppliers[0].photosGallery.push({ url: held.url });
    const ctx = setup({ data });

    await ctx.approve('photo_held').expect(200);

    expect(stored(ctx, 'photo_held').status).toBe('approved');
    expect(gallery(ctx)).toHaveLength(2);
  });

  test('a supplier that no longer exists: the photo is marked approved, as before', async () => {
    const held = heldPhoto('held', { supplierId: 'S-gone' });
    const ctx = setup({ data: { ...baseData(), photos: [held] } });

    await ctx.approve('photo_held').expect(200);

    expect(stored(ctx, 'photo_held').status).toBe('approved');
  });

  test('a rejected photo cannot be approved, because its images were deleted', async () => {
    const held = heldPhoto('held', { status: 'rejected' });
    const ctx = setup({ data: { ...baseData(), photos: [held] } });

    const response = await ctx.approve('photo_held');

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/rejected and its images were deleted/);
    expect(gallery(ctx)).toHaveLength(1);
    expect(stored(ctx, 'photo_held').status).toBe('rejected');
  });

  test('an unknown photo is a 404', async () => {
    const ctx = setup();

    await ctx.approve('nope').expect(404);
  });
});

describe('rejecting a held photo', () => {
  test('marks it rejected and deletes all four of its images', async () => {
    const held = heldPhoto('held');
    const ctx = setup({ data: { ...baseData(), photos: [held] } });

    const response = await ctx.reject('photo_held', 'blurry').expect(200);

    expect(response.body.success).toBe(true);
    expect(stored(ctx, 'photo_held')).toMatchObject({
      status: 'rejected',
      rejectionReason: 'blurry',
    });
    expect(ctx.deleted()).toEqual(addressesOf('held').sort());
  });

  test('an image something else still uses is kept', async () => {
    const held = heldPhoto('held');
    const data = baseData();
    data.photos = [held];
    data.suppliers.push({ id: 'S-other', logo: held.large });
    const ctx = setup({ data });

    await ctx.reject('photo_held').expect(200);

    expect(ctx.deleted()).toEqual(
      addressesOf('held')
        .filter(a => a !== held.large)
        .sort()
    );
  });

  test('a photo that was already approved keeps its images: it is in a gallery', async () => {
    const held = heldPhoto('held', { status: 'approved' });
    const data = baseData();
    data.photos = [held];
    data.suppliers[0].photosGallery.push({ url: held.url });
    const ctx = setup({ data });

    await ctx.reject('photo_held').expect(200);

    expect(stored(ctx, 'photo_held').status).toBe('rejected');
    expect(ctx.deleted()).toEqual([]);
  });

  test('if the status cannot be updated nothing is deleted', async () => {
    const held = heldPhoto('held');
    const ctx = setup({
      data: { ...baseData(), photos: [held] },
      failUpdate: collection => collection === 'photos',
    });

    const response = await ctx.reject('photo_held');

    expect(response.status).toBe(500);
    expect(stored(ctx, 'photo_held').status).toBe('pending');
    expect(ctx.deleted()).toEqual([]);
  });

  test('a failing storage delete does not fail the rejection', async () => {
    const held = heldPhoto('held');
    const ctx = setup({ data: { ...baseData(), photos: [held] } });
    ctx.photoUpload.deleteImage.mockRejectedValue(new Error('storage down'));

    await ctx.reject('photo_held').expect(200);

    expect(stored(ctx, 'photo_held').status).toBe('rejected');
  });
});
