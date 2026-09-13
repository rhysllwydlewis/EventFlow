/**
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

function createApp({ pkg, supplier, ownerId = 'user_1' }) {
  jest.resetModules();
  const router = require('../../routes/packages');
  const dbUnified = {
    findOne: jest.fn(async (collection, query) => {
      if (collection === 'packages') {
        return pkg && pkg.id === query.id ? pkg : null;
      }
      if (collection === 'suppliers') {
        return supplier &&
          supplier.id === query.id &&
          (!query.ownerUserId || supplier.ownerUserId === query.ownerUserId)
          ? supplier
          : null;
      }
      return null;
    }),
    find: jest.fn(async () => []),
    updateOne: jest.fn(async () => true),
    insertOne: jest.fn(async doc => doc),
  };
  const pass = (_req, _res, next) => next();
  const authRequired = (req, _res, next) => {
    req.user = { id: ownerId, role: 'supplier' };
    req.userId = ownerId;
    next();
  };
  const roleRequired = () => pass;

  router.initializeDependencies({
    dbUnified,
    authRequired,
    roleRequired,
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
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', router);
  return { app, dbUnified };
}

describe('GET /api/me/packages/:id/photos', () => {
  const supplier = { id: 'sup_1', ownerUserId: 'user_1' };

  test('returns the package gallery, excluding placeholders', async () => {
    const pkg = {
      id: 'pkg_1',
      supplierId: 'sup_1',
      createdAt: '2026-01-01T00:00:00.000Z',
      gallery: [
        { url: '/api/photos/real_one', approved: true, uploadedAt: 111 },
        { url: '/assets/images/package-placeholder.webp' },
        'https://cdn.example.com/real_two.jpg',
      ],
    };
    const { app } = createApp({ pkg, supplier });

    const res = await request(app).get('/api/me/packages/pkg_1/photos').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.photos.map(p => p.url)).toEqual([
      '/api/photos/real_one',
      'https://cdn.example.com/real_two.jpg',
    ]);
    expect(res.body.photos[0]).toMatchObject({ id: 'photo_0', approved: true, uploadedAt: 111 });
  });

  test('returns an empty list for a package with no real photos', async () => {
    const pkg = { id: 'pkg_2', supplierId: 'sup_1', gallery: [] };
    const { app } = createApp({ pkg, supplier });

    const res = await request(app).get('/api/me/packages/pkg_2/photos').expect(200);

    expect(res.body).toMatchObject({ success: true, count: 0, photos: [] });
  });

  test('404s when the package does not exist', async () => {
    const { app } = createApp({ pkg: null, supplier });

    await request(app).get('/api/me/packages/missing/photos').expect(404);
  });

  test("403s when the caller does not own the package's supplier", async () => {
    const pkg = { id: 'pkg_3', supplierId: 'sup_1', gallery: [] };
    const { app } = createApp({ pkg, supplier, ownerId: 'someone_else' });

    await request(app).get('/api/me/packages/pkg_3/photos').expect(403);
  });
});
