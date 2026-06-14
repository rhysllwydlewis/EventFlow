'use strict';

const express = require('express');
const request = require('supertest');

describe('supplier profile photos on active public search route', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../cache', () => ({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delPattern: jest.fn().mockResolvedValue(undefined),
      getStats: jest.fn(() => ({ hits: 0, misses: 0, sets: 0, deletes: 0, errors: 0 })),
    }));
    jest.doMock('../../services/catalogCache', () => ({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('../../utils/searchAnalytics', () => ({
      trackSearch: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('../../middleware/auth', () => ({
      authRequired: (_req, _res, next) => next(),
      roleRequired: () => (_req, _res, next) => next(),
      getUserFromCookie: jest.fn().mockResolvedValue(null),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('/api/v2/search/suppliers includes owner avatar fields for ownerUserId and legacy email matches', async () => {
    const dbUnified = require('../../db-unified');
    jest.spyOn(dbUnified, 'read').mockImplementation(async collection => {
      if (collection === 'suppliers') {
        return [
          {
            id: 'sup_owner',
            ownerUserId: 'user_owner',
            name: 'Owner Matched Supplier',
            category: 'Venues',
            approved: true,
            email: 'private-owner@example.com',
            phone: 'secret-phone',
            passwordHash: 'hash',
            logo: '/uploads/logo-owner.webp',
          },
          {
            id: 'sup_legacy',
            name: 'Legacy Email Supplier',
            category: 'Venues',
            approved: true,
            contactEmail: 'LEGACY@example.com',
            logo: '/uploads/logo-legacy.webp',
          },
        ];
      }
      if (collection === 'users') {
        return [
          { id: 'user_owner', email: 'owner@example.com', avatarUrl: '/api/photos/photo_owner' },
          { id: 'user_legacy', email: 'legacy@example.com', avatarUrl: '/api/photos/photo_legacy' },
        ];
      }
      if (collection === 'packages') {
        return [
          {
            id: 'pkg_1',
            supplierId: 'sup_owner',
            title: 'Owner Package',
            approved: true,
            image: '/uploads/package-owner.webp',
          },
        ];
      }
      return [];
    });

    const searchRoutes = require('../../routes/search-v2');
    const app = express();
    app.use('/api/v2/search', searchRoutes);

    const res = await request(app).get('/api/v2/search/suppliers?limit=10').expect(200);
    const results = res.body.data.results;
    const owner = results.find(supplier => supplier.id === 'sup_owner');
    const legacy = results.find(supplier => supplier.id === 'sup_legacy');

    expect(owner).toMatchObject({
      profilePhotoUrl: '/api/photos/photo_owner',
      avatarUrl: '/api/photos/photo_owner',
      displayAvatarUrl: '/api/photos/photo_owner',
      logo: '/uploads/logo-owner.webp',
    });
    expect(legacy).toMatchObject({
      profilePhotoUrl: '/api/photos/photo_legacy',
      avatarUrl: '/api/photos/photo_legacy',
      displayAvatarUrl: '/api/photos/photo_legacy',
      logo: '/uploads/logo-legacy.webp',
    });
    expect(owner.email).toBeUndefined();
    expect(owner.phone).toBeUndefined();
    expect(owner.passwordHash).toBeUndefined();
    expect(JSON.stringify(results)).not.toContain('legacy@example.com');
    expect(owner.topPackages).toEqual([
      expect.objectContaining({ image: '/uploads/package-owner.webp' }),
    ]);
  });

  test('/api/packages/:slug includes resolved supplier profile photo fields for package sidebar', async () => {
    const dbUnified = require('../../db-unified');
    jest.spyOn(dbUnified, 'read').mockImplementation(async collection => {
      if (collection === 'packages') {
        return [
          {
            id: 'pkg_1',
            slug: 'owner-package',
            supplierId: 'sup_owner',
            title: 'Owner Package',
            approved: true,
            image: '/uploads/package-owner.webp',
          },
        ];
      }
      if (collection === 'suppliers') {
        return [
          {
            id: 'sup_owner',
            ownerUserId: 'user_owner',
            name: 'Owner Matched Supplier',
            approved: true,
            logo: '/uploads/logo-owner.webp',
          },
        ];
      }
      if (collection === 'users') {
        return [
          { id: 'user_owner', email: 'owner@example.com', avatarUrl: '/api/photos/photo_owner' },
        ];
      }
      if (collection === 'categories') {
        return [];
      }
      return [];
    });
    jest.spyOn(dbUnified, 'find').mockResolvedValue([]);

    const suppliersRouter = require('../../routes/suppliers');
    suppliersRouter.initializeDependencies({
      dbUnified,
      authRequired: (_req, _res, next) => next(),
      roleRequired: () => (_req, _res, next) => next(),
      getUserFromCookie: () => null,
      supplierAnalytics: { trackProfileView: jest.fn().mockResolvedValue(undefined) },
      supplierIsProActive: jest.fn().mockResolvedValue(false),
      logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
    });
    const app = express();
    app.use('/api', suppliersRouter);

    const res = await request(app).get('/api/packages/owner-package').expect(200);
    expect(res.body.supplier).toMatchObject({
      profilePhotoUrl: '/api/photos/photo_owner',
      avatarUrl: '/api/photos/photo_owner',
      displayAvatarUrl: '/api/photos/photo_owner',
      logo: '/uploads/logo-owner.webp',
    });
    expect(res.body.package.image).toBe('/uploads/package-owner.webp');
  });

  test('projectPublicSupplierFields exposes profile-photo fields but not private fields', () => {
    const { projectPublicSupplierFields } = require('../../services/searchService');
    const payload = projectPublicSupplierFields({
      id: 'sup_1',
      name: 'Projected Supplier',
      email: 'private@example.com',
      phone: 'secret',
      passwordHash: 'hash',
      profilePhotoUrl: '/api/photos/photo_test',
      avatarUrl: '/api/photos/photo_test',
      displayAvatarUrl: '/api/photos/photo_test',
    });

    expect(payload).toMatchObject({
      profilePhotoUrl: '/api/photos/photo_test',
      avatarUrl: '/api/photos/photo_test',
      displayAvatarUrl: '/api/photos/photo_test',
    });
    expect(payload.email).toBeUndefined();
    expect(payload.phone).toBeUndefined();
    expect(payload.passwordHash).toBeUndefined();
  });
});
