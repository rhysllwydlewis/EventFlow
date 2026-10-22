'use strict';

const express = require('express');
const request = require('supertest');

function buildApp({ user, suppliers, hasUpload = true }) {
  jest.resetModules();
  const clearSearchCache = jest.fn().mockResolvedValue(undefined);
  const invalidate = jest.fn().mockResolvedValue(undefined);
  const processAndSaveImage = jest.fn().mockResolvedValue({ optimized: '/api/photos/photo_new' });
  const deleteImage = jest.fn().mockResolvedValue(undefined);
  const updateOne = jest.fn().mockResolvedValue(true);

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
          publicProfileAvatarUrl: '/api/photos/photo_new',
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
        $unset: {
          profilePhotoUrl: '',
          avatarUrl: '',
          displayAvatarUrl: '',
          publicProfileAvatarUrl: '',
          profileImage: '',
          profilePhoto: '',
          photoUrl: '',
          image: '',
        },
      })
    );
    expect(JSON.stringify(updateOne.mock.calls)).not.toContain('logo');
    expect(clearSearchCache).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });

  test.each([
    'profilePhotoUrl',
    'displayAvatarUrl',
    'avatarUrl',
    'publicProfileAvatarUrl',
    'profileImage',
    'profilePhoto',
    'photoUrl',
    'image',
  ])('removes a supplier-only %s when the user has no avatar', async field => {
    const { app, updateOne, deleteImage, invalidate } = buildApp({
      user: { id: 'user_1', email: 'owner@example.com', role: 'supplier' },
      suppliers: [{ id: 'sup_1', ownerUserId: 'user_1', [field]: '/uploads/legacy.webp' }],
    });

    await request(app).delete('/api/profile/avatar').expect(200, { ok: true });

    expect(updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      expect.objectContaining({ $unset: expect.objectContaining({ [field]: '' }) })
    );
    // The supplier URL may also be a gallery image; removing its avatar reference
    // must not delete shared image storage.
    expect(deleteImage).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });

  test('removes a legacy email-owned photo without touching another explicit owner', async () => {
    const { app, updateOne } = buildApp({
      user: { id: 'user_1', email: 'owner@example.com', role: 'supplier' },
      suppliers: [
        { id: 'legacy', contactEmail: 'OWNER@example.com', profileImage: '/uploads/old.webp' },
        {
          id: 'other',
          ownerUserId: 'user_2',
          email: 'owner@example.com',
          avatarUrl: '/api/photos/other',
        },
      ],
    });

    await request(app).delete('/api/profile/avatar').expect(200);

    expect(updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'legacy' },
      expect.objectContaining({ $set: expect.objectContaining({ ownerUserId: 'user_1' }) })
    );
    expect(updateOne.mock.calls.filter(([collection]) => collection === 'suppliers')).toHaveLength(
      1
    );
  });

  test('rejects removal when the only photo belongs to another explicit owner', async () => {
    const { app, updateOne, deleteImage } = buildApp({
      user: { id: 'user_1', email: 'owner@example.com', role: 'supplier' },
      suppliers: [
        {
          id: 'other',
          ownerUserId: 'user_2',
          email: 'owner@example.com',
          profilePhotoUrl: '/api/photos/other',
        },
      ],
    });

    await request(app).delete('/api/profile/avatar').expect(404, { error: 'No avatar to delete' });

    expect(updateOne).not.toHaveBeenCalled();
    expect(deleteImage).not.toHaveBeenCalled();
  });

  test('keeps a business logo and its file when it is also the account avatar', async () => {
    const { app, updateOne, deleteImage } = buildApp({
      user: {
        id: 'user_1',
        email: 'owner@example.com',
        role: 'supplier',
        avatarUrl: '/api/photos/brand',
      },
      suppliers: [
        {
          id: 'sup_1',
          ownerUserId: 'user_1',
          logo: '/api/photos/brand',
          avatarUrl: '/api/photos/brand',
        },
      ],
    });

    await request(app).delete('/api/profile/avatar').expect(200);

    expect(deleteImage).not.toHaveBeenCalled();
    expect(JSON.stringify(updateOne.mock.calls)).not.toContain('logo');
  });

  test('returns no-avatar for a logo-only record without changing its branding', async () => {
    const { app, updateOne } = buildApp({
      user: { id: 'user_1', email: 'owner@example.com', role: 'supplier' },
      suppliers: [{ id: 'sup_1', ownerUserId: 'user_1', logo: '/uploads/brand.webp' }],
    });

    await request(app).delete('/api/profile/avatar').expect(404);
    expect(updateOne).not.toHaveBeenCalled();
  });

  test.each(['users', 'suppliers'])(
    'a failed %s write cannot report successful removal or destroy the stored image',
    async failingCollection => {
      const { app, updateOne, deleteImage } = buildApp({
        user: {
          id: 'user_1',
          email: 'owner@example.com',
          role: 'supplier',
          avatarUrl: '/api/photos/old',
        },
        suppliers: [{ id: 'sup_1', ownerUserId: 'user_1', profilePhotoUrl: '/api/photos/old' }],
      });
      updateOne.mockImplementation(async collection => collection !== failingCollection);

      await request(app).delete('/api/profile/avatar').expect(500);
      expect(deleteImage).not.toHaveBeenCalled();
    }
  );

  test.each(['users', 'suppliers'])(
    'a failed %s write cannot report a successful avatar upload',
    async failingCollection => {
      const { app, updateOne } = buildApp({
        user: { id: 'user_1', email: 'owner@example.com', role: 'supplier' },
        suppliers: [{ id: 'sup_1', ownerUserId: 'user_1' }],
      });
      updateOne.mockImplementation(async collection => collection !== failingCollection);

      await request(app).post('/api/profile/avatar').expect(500);
    }
  );
});
