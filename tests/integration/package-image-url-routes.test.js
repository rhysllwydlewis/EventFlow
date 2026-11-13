/**
 * Package routes refuse an image that is not a real image address (and never store it).
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

const BAD_IMAGE = 'https://example.com/a.jpg" onerror="alert(1)';

function createApp({ storedImage = '' } = {}) {
  jest.resetModules();
  const router = require('../../routes/packages');
  const pkg = { id: 'pkg_1', supplierId: 'sup_1', title: 'Mine', image: storedImage, gallery: [] };
  const dbUnified = {
    find: jest.fn(async () => []),
    findOne: jest.fn(async collection => {
      if (collection === 'packages') {
        return pkg;
      }
      if (collection === 'suppliers') {
        return { id: 'sup_1', ownerUserId: 'user_1', approved: true };
      }
      return null;
    }),
    read: jest.fn(async () => ({})),
    updateOne: jest.fn(async () => true),
    insertOne: jest.fn(async doc => doc),
  };
  const pass = (_req, _res, next) => next();
  router.initializeDependencies({
    dbUnified,
    authRequired: (req, _res, next) => {
      req.user = { id: 'user_1', role: 'admin' };
      next();
    },
    roleRequired: () => pass,
    requireVerifiedUser: pass,
    requireApprovedSupplier: pass,
    csrfProtection: pass,
    featureRequired: () => pass,
    writeLimiter: pass,
    photoUpload: { deleteImage: jest.fn(), processAndSaveImage: jest.fn() },
    uploadValidation: {},
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    uid: prefix => `${prefix}_test`,
  });
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  return { app, dbUnified };
}

describe('POST /api/me/packages image validation', () => {
  const body = {
    title: 'T',
    price: '100',
    primaryCategoryKey: 'venues',
    eventTypes: ['wedding'],
  };

  test.each([BAD_IMAGE, 'javascript:alert(1)', '//evil.example/a.jpg', { url: 'x' }])(
    'rejects %p with 400 and stores nothing',
    async image => {
      const { app, dbUnified } = createApp();
      const res = await request(app)
        .post('/api/me/packages')
        .send({ ...body, image })
        .expect(400);
      expect(res.body.error).toBe('Invalid image');
      expect(dbUnified.insertOne).not.toHaveBeenCalled();
    }
  );
});

describe('PUT /api/me/packages/:id image validation', () => {
  test.each([BAD_IMAGE, 'javascript:alert(1)', 'data-not-image', 42, { url: 'x' }])(
    'rejects %p with 400 and writes nothing',
    async image => {
      const { app, dbUnified } = createApp();
      const res = await request(app).put('/api/me/packages/pkg_1').send({ image }).expect(400);
      expect(res.body.error).toBe('Invalid image');
      expect(dbUnified.updateOne).not.toHaveBeenCalled();
    }
  );

  test.each(['/api/photos/abc123?w=640', 'https://example.com/a.jpg'])(
    'stores the valid URL %s',
    async image => {
      const { app, dbUnified } = createApp();
      const res = await request(app).put('/api/me/packages/pkg_1').send({ image }).expect(200);
      expect(res.body.package.image).toBe(image);
      const set = dbUnified.updateOne.mock.calls[0][2].$set;
      expect(set.image).toBe(image);
      expect(set.gallery[0].url).toBe(image);
    }
  );

  test('an empty image still clears the photo', async () => {
    const { app, dbUnified } = createApp();
    await request(app).put('/api/me/packages/pkg_1').send({ image: '' }).expect(200);
    expect(dbUnified.updateOne.mock.calls[0][2].$set.image).toBe('');
  });
});

describe('PUT /api/admin/packages/:id image validation', () => {
  test('rejects an attribute-breakout image with 400 and writes nothing', async () => {
    const { app, dbUnified } = createApp();
    const res = await request(app)
      .put('/api/admin/packages/pkg_1')
      .send({ image: BAD_IMAGE })
      .expect(400);
    expect(res.body.error).toBe('Invalid image');
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });
});

// The edit forms send the stored image back on every save. A legacy value that would not pass
// validation today must not block an unrelated edit; only a changed value is refused.
describe('an unchanged stored image does not block an edit', () => {
  const LEGACY = 'uploads/my photo.jpg';

  test('PUT /api/me/packages/:id saves a new title and leaves the legacy image alone', async () => {
    const { app, dbUnified } = createApp({ storedImage: LEGACY });
    await request(app)
      .put('/api/me/packages/pkg_1')
      .send({ title: 'New title', image: LEGACY })
      .expect(200);
    const set = dbUnified.updateOne.mock.calls[0][2].$set;
    expect(set.title).toBe('New title');
    expect(set).not.toHaveProperty('image');
  });

  test('PUT /api/me/packages/:id still refuses changing it to another invalid value', async () => {
    const { app, dbUnified } = createApp({ storedImage: LEGACY });
    await request(app)
      .put('/api/me/packages/pkg_1')
      .send({ title: 'New title', image: BAD_IMAGE })
      .expect(400);
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });

  test('PUT /api/admin/packages/:id saves a new title and leaves the legacy image alone', async () => {
    const { app, dbUnified } = createApp({ storedImage: LEGACY });
    await request(app)
      .put('/api/admin/packages/pkg_1')
      .send({ title: 'New title', image: LEGACY })
      .expect(200);
    const set = dbUnified.updateOne.mock.calls[0][2].$set;
    expect(set.title).toBe('New title');
    expect(set).not.toHaveProperty('image');
  });

  test('PUT /api/admin/packages/:id still refuses changing it to another invalid value', async () => {
    const { app, dbUnified } = createApp({ storedImage: LEGACY });
    await request(app)
      .put('/api/admin/packages/pkg_1')
      .send({ title: 'New title', image: BAD_IMAGE })
      .expect(400);
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });
});
