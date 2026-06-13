'use strict';

const express = require('express');
const request = require('supertest');

function buildApp({ user, suppliers, hasUpload = true }) {
  jest.resetModules();
  const clearSearchCache = jest.fn().mockResolvedValue(undefined);
  const invalidate = jest.fn().mockResolvedValue(undefined);
  const processAndSaveImage = jest.fn().mockResolvedValue({ optimized: '/api/photos/photo_new' });
  const deleteImage = jest.fn().mockResolvedValue(undefined);
  const updateOne = jest.fn().mockResolvedValue(undefined);

  jest.doMock('../../middleware/auth', () => ({
    authRequired: (req, _res, next) => {
      req.user = { id: user.id, email: user.email, role: user.role };
      next();
    },
  }));
  jest.doMock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
  jest.doMock('../../middleware/rateLimits', () => ({
    writeLimiter: (_req, _res, next) => next(),
    uploadLimiter: (_req, _res, next) => next(),
    apiLimiter: (_req, _res, next) => next(),
  }));
  jest.doMock('../../photo-upload', () => ({
    MAX_FILE_SIZE_AVATAR: 5 * 1024 * 1024,
    upload: {
      single: () => (req, _res, cb) => {
        if (hasUpload) {
          req.file = { buffer: Buffer.from('image') };
        }
        cb();
      },
    },
    processAndSaveImage,
    deleteImage,
  }));
  jest.doMock('../../middleware/searchCache', () => ({ clearSearchCache }));
  jest.doMock('../../services/catalogCache', () => ({ invalidate }));

  const dbUnified = require('../../db-unified');
  jest.spyOn(dbUnified, 'findOne').mockImplementation(async (collection, query) => {
    if (collection === 'users' && query.id === user.id) {
      return user;
    }
    return null;
  });
  jest.spyOn(dbUnified, 'read').mockImplementation(async collection => {
    if (collection === 'suppliers') {
      return suppliers;
    }
    return [];
  });
  jest.spyOn(dbUnified, 'updateOne').mockImplementation(updateOne);

  const profileRoutes = require('../../routes/profile');
  const app = express();
  app.use(express.json());
  app.use('/api/profile', profileRoutes);
  return { app, clearSearchCache, invalidate, updateOne, processAndSaveImage, deleteImage };
}

describe('profile avatar cache invalidation', () => {
  test('POST /api/profile/avatar syncs supplier avatar fields, backfills ownerUserId, and clears caches without overwriting logo', async () => {
    const { app, clearSearchCache, invalidate, updateOne } = buildApp({
      user: { id: 'user_1', email: 'owner@example.com', role: 'supplier' },
      suppliers: [
        {
          id: 'sup_1',
          email: 'OWNER@example.com',
          logo: '/uploads/logo.webp',
        },
      ],
    });

    await request(app).post('/api/profile/avatar').expect(200);

    expect(updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          ownerUserId: 'user_1',
          profilePhotoUrl: '/api/photos/photo_new',
          avatarUrl: '/api/photos/photo_new',
          displayAvatarUrl: '/api/photos/photo_new',
        }),
      })
    );
    expect(JSON.stringify(updateOne.mock.calls)).not.toContain('logo');
    expect(clearSearchCache).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });

  test('DELETE /api/profile/avatar unsets only supplier avatar fields and clears caches', async () => {
    const { app, clearSearchCache, invalidate, updateOne } = buildApp({
      user: {
        id: 'user_1',
        email: 'owner@example.com',
        role: 'supplier',
        avatarUrl: '/api/photos/photo_old',
      },
      suppliers: [
        {
          id: 'sup_1',
          ownerUserId: 'user_1',
          logo: '/uploads/logo.webp',
          profilePhotoUrl: '/api/photos/photo_old',
        },
      ],
    });

    await request(app).delete('/api/profile/avatar').expect(200);

    expect(updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      expect.objectContaining({
        $unset: { profilePhotoUrl: '', avatarUrl: '', displayAvatarUrl: '' },
      })
    );
    expect(JSON.stringify(updateOne.mock.calls)).not.toContain('logo');
    expect(clearSearchCache).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });
});
