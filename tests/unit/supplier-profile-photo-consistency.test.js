'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const {
  findOwnerUserForSupplier,
  isUsableImageUrl,
  resolveSupplierProfilePhoto,
} = require('../../utils/supplierProfilePhoto');

const SUPPLIERS_INIT = path.join(__dirname, '../../public/assets/js/pages/suppliers-init.js');
const SUPPLIER_HTML = path.join(__dirname, '../../public/supplier.html');
const SUPPLIER_PROFILE_JS = path.join(__dirname, '../../public/assets/js/supplier-profile.js');
const PACKAGE_INIT = path.join(__dirname, '../../public/assets/js/pages/package-init.js');
const SUPPLIER_PROFILE_CSS = path.join(
  __dirname,
  '../../public/assets/css/supplier-profile-v2.css'
);

function buildSafeRouteApp({ suppliers, users, packages = [], currentUser = null }) {
  jest.resetModules();
  const supplierProfileSafeRouter = require('../../routes/supplier-profile-safe');
  const suppliersRouter = require('../../routes/suppliers');
  const dbUnified = {
    read: jest.fn(async collection => {
      if (collection === 'suppliers') {
        return suppliers;
      }
      if (collection === 'users') {
        return users;
      }
      if (collection === 'packages') {
        return packages;
      }
      if (collection === 'badges') {
        return [];
      }
      return [];
    }),
    findOne: jest.fn(async (collection, query) => {
      if (collection === 'suppliers') {
        return suppliers.find(supplier => supplier.id === query.id) || null;
      }
      if (collection === 'users') {
        return users.find(user => user.id === query.id) || null;
      }
      return null;
    }),
    find: jest.fn(async (collection, query = {}) => {
      if (collection === 'suppliers') {
        return suppliers.filter(supplier =>
          Object.entries(query).every(([key, value]) => supplier[key] === value)
        );
      }
      if (collection === 'packages') {
        return packages;
      }
      return [];
    }),
    updateOne: jest.fn(async () => undefined),
  };

  const deps = {
    dbUnified,
    authRequired: (req, _res, next) => {
      req.user = currentUser;
      next();
    },
    roleRequired: () => (_req, _res, next) => next(),
    supplierAnalytics: { trackProfileView: jest.fn().mockResolvedValue(undefined) },
    getUserFromCookie: () => currentUser,
    supplierIsProActive: jest.fn().mockResolvedValue(false),
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
  };
  supplierProfileSafeRouter.initializeDependencies(deps);
  suppliersRouter.initializeDependencies(deps);

  const app = express();
  app.use('/api', supplierProfileSafeRouter);
  app.use('/api', suppliersRouter);
  return { app, dbUnified };
}

function buildApp({ suppliers, users, packages = [], currentUser = null }) {
  jest.resetModules();
  jest.doMock('../../services/subscriptionService', () => ({
    getSubscriptionByUserId: jest.fn().mockResolvedValue(null),
    isLiveEntitlement: jest.fn().mockReturnValue(false),
  }));

  const suppliersRouter = require('../../routes/suppliers');
  const dbUnified = {
    read: jest.fn(async collection => {
      if (collection === 'suppliers') {
        return suppliers;
      }
      if (collection === 'users') {
        return users;
      }
      if (collection === 'packages') {
        return packages;
      }
      if (collection === 'badges') {
        return [];
      }
      return [];
    }),
    findOne: jest.fn(async (collection, query) => {
      if (collection === 'users') {
        return users.find(user => user.id === query.id) || null;
      }
      return null;
    }),
    find: jest.fn(async (collection, query = {}) => {
      if (collection === 'suppliers') {
        return suppliers.filter(supplier =>
          Object.entries(query).every(([key, value]) => supplier[key] === value)
        );
      }
      if (collection === 'packages') {
        return packages;
      }
      return [];
    }),
    updateOne: jest.fn(async () => undefined),
  };

  suppliersRouter.initializeDependencies({
    dbUnified,
    authRequired: (req, _res, next) => {
      req.user = currentUser;
      next();
    },
    roleRequired: () => (_req, _res, next) => next(),
    supplierAnalytics: { trackProfileView: jest.fn().mockResolvedValue(undefined) },
    getUserFromCookie: () => currentUser,
    supplierIsProActive: jest.fn().mockResolvedValue(false),
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
  });

  const app = express();
  app.use('/api', suppliersRouter);
  return { app, dbUnified };
}

describe('utils/supplierProfilePhoto', () => {
  test('uses supplier/dashboard profile photo first and falls back through owner avatar and logo', () => {
    expect(
      resolveSupplierProfilePhoto(
        {
          profilePhotoUrl: '/supplier-profile.jpg',
          avatarUrl: '/supplier-avatar.jpg',
          logo: '/logo.jpg',
        },
        { avatarUrl: '/user-avatar.jpg' }
      )
    ).toBe('/supplier-profile.jpg');

    expect(resolveSupplierProfilePhoto({ profilePhotoUrl: '/profile.jpg' }, {})).toBe(
      '/profile.jpg'
    );
    expect(resolveSupplierProfilePhoto({ avatarUrl: '/avatar.jpg' }, {})).toBe('/avatar.jpg');
    expect(resolveSupplierProfilePhoto({ photoUrl: '/dashboard-photo.jpg' }, {})).toBe(
      '/dashboard-photo.jpg'
    );
    expect(resolveSupplierProfilePhoto({ image: '/dashboard-image.jpg' }, {})).toBe(
      '/dashboard-image.jpg'
    );
    expect(resolveSupplierProfilePhoto({ logo: '/logo.jpg' }, {})).toBe('/logo.jpg');
    expect(resolveSupplierProfilePhoto({}, { avatarUrl: '  /user-avatar.jpg  ' })).toBe(
      '/user-avatar.jpg'
    );
  });

  test('only accepts http(s) and rooted relative image URLs', () => {
    expect(isUsableImageUrl('https://cdn.example/avatar.jpg')).toBe(true);
    expect(isUsableImageUrl('http://cdn.example/avatar.jpg')).toBe(true);
    expect(isUsableImageUrl('/uploads/avatar.jpg')).toBe(true);
    expect(isUsableImageUrl('/api/photos/photo_test')).toBe(true);
    expect(isUsableImageUrl('javascript:alert(1)')).toBe(false);
    expect(isUsableImageUrl('data:image/png;base64,aaaa')).toBe(false);
    expect(isUsableImageUrl('uploads/avatar.jpg')).toBe(false);
    expect(isUsableImageUrl('//evil.example/avatar.jpg')).toBe(false);
    expect(isUsableImageUrl('/bad:scheme')).toBe(false);
  });

  test('findOwnerUserForSupplier supports legacy owner id and email fields without exposing data', () => {
    const users = [
      { id: 'user_created', email: 'created@example.com' },
      { id: 'user_email', email: 'Owner@Example.com', avatarUrl: '/api/photos/photo_test' },
    ];
    expect(findOwnerUserForSupplier({ createdByUserId: 'user_created' }, users).id).toBe(
      'user_created'
    );
    expect(findOwnerUserForSupplier({ contactEmail: ' owner@example.com ' }, users).id).toBe(
      'user_email'
    );
  });
});

test('public profile renderer considers dashboard photo aliases before initials fallback', () => {
  const supplierProfileJs = fs.readFileSync(SUPPLIER_PROFILE_JS, 'utf8');
  expect(supplierProfileJs).toContain('supplier?.profilePhotoUrl');
  expect(supplierProfileJs).toContain('supplier?.photoUrl');
  expect(supplierProfileJs).toContain('supplier?.image');
  // Gallery photos are intentionally excluded from the avatar resolution to prevent
  // unrelated or broken gallery URLs from ghosting the avatar (hiding it via
  // data-fallback-hide without showing any image). Only dedicated profile-photo
  // fields are used; gallery photos continue to render in the gallery section.
  expect(supplierProfileJs).not.toContain('galleryProfileImage');
});

describe('public supplier API profile-photo enrichment', () => {
  test('mounted safe supplier route resolves owner avatar before fallback suppliers route', async () => {
    const { app } = buildSafeRouteApp({
      users: [
        {
          id: 'user_1',
          email: 'owner@example.com',
          phone: 'secret',
          passwordHash: 'hash',
          tokens: ['token'],
          avatarUrl: '/api/photos/photo_test',
        },
      ],
      suppliers: [
        {
          id: 'sup_safe',
          ownerUserId: 'user_1',
          approved: true,
          name: 'Safe Route Supplier',
          email: 'supplier-private@example.com',
          phone: 'supplier-phone',
          logo: '/legacy-logo.webp',
        },
      ],
    });

    const res = await request(app).get('/api/suppliers/sup_safe').expect(200);
    expect(res.body).toMatchObject({
      id: 'sup_safe',
      profilePhotoUrl: '/api/photos/photo_test',
      avatarUrl: '/api/photos/photo_test',
      displayAvatarUrl: '/api/photos/photo_test',
      logo: '/legacy-logo.webp',
    });
    expect(res.body.email).toBeUndefined();
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.tokens).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('owner@example.com');
  });

  test('/api/suppliers includes resolved profile photo fields from owner user avatar without leaking private fields', async () => {
    const { app } = buildApp({
      users: [
        {
          id: 'user_1',
          email: 'owner@example.com',
          phone: 'secret',
          passwordHash: 'hash',
          avatarUrl: '/uploads/user-avatar.webp',
        },
      ],
      suppliers: [
        {
          id: 'sup_1',
          ownerUserId: 'user_1',
          approved: true,
          name: 'Rhys Test',
          email: 'supplier-private@example.com',
          logo: '/legacy-logo.webp',
        },
      ],
    });

    const res = await request(app).get('/api/suppliers').expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: 'sup_1',
      profilePhotoUrl: '/uploads/user-avatar.webp',
      avatarUrl: '/uploads/user-avatar.webp',
      displayAvatarUrl: '/uploads/user-avatar.webp',
      logo: '/legacy-logo.webp',
    });
    expect(res.body.items[0].email).toBeUndefined();
    expect(res.body.items[0].ownerEmail).toBeUndefined();
    expect(res.body.items[0].passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body.items[0])).not.toContain('owner@example.com');
  });

  test('/api/suppliers/:id includes resolved profile photo fields from owner user avatar without leaking private fields', async () => {
    const { app } = buildApp({
      users: [{ id: 'user_1', email: 'owner@example.com', avatarUrl: '/uploads/user-avatar.webp' }],
      suppliers: [
        {
          id: 'sup_1',
          ownerUserId: 'user_1',
          approved: true,
          name: 'Rhys Test',
          email: 'supplier-private@example.com',
          logo: '/legacy-logo.webp',
        },
      ],
    });

    const res = await request(app).get('/api/suppliers/sup_1').expect(200);
    expect(res.body).toMatchObject({
      id: 'sup_1',
      profilePhotoUrl: '/uploads/user-avatar.webp',
      avatarUrl: '/uploads/user-avatar.webp',
      displayAvatarUrl: '/uploads/user-avatar.webp',
      logo: '/legacy-logo.webp',
    });
    expect(res.body.email).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('owner@example.com');
  });

  test('falls back to supplier profile fields when owner user avatarUrl is missing', async () => {
    const { app } = buildApp({
      users: [{ id: 'user_1', email: 'owner@example.com' }],
      suppliers: [
        {
          id: 'sup_1',
          ownerUserId: 'user_1',
          approved: true,
          name: 'Fallback Supplier',
          profilePhotoUrl: '/supplier-profile.webp',
          avatarUrl: '/supplier-avatar.webp',
          logo: '/supplier-logo.webp',
        },
        {
          id: 'sup_2',
          ownerUserId: 'user_1',
          approved: true,
          name: 'Logo Fallback Supplier',
          logo: '/supplier-logo-only.webp',
        },
      ],
    });

    const list = await request(app).get('/api/suppliers').expect(200);
    expect(list.body.items.find(s => s.id === 'sup_1').displayAvatarUrl).toBe(
      '/supplier-profile.webp'
    );
    expect(list.body.items.find(s => s.id === 'sup_2').displayAvatarUrl).toBe(
      '/supplier-logo-only.webp'
    );
  });

  test('keeps orphan and approval visibility protections in public supplier endpoints', async () => {
    const { app } = buildApp({
      users: [{ id: 'user_1', avatarUrl: '/uploads/user-avatar.webp' }],
      suppliers: [
        { id: 'approved', ownerUserId: 'user_1', approved: true, name: 'Approved Supplier' },
        { id: 'orphan', ownerUserId: 'missing_user', approved: true, name: 'Orphan Supplier' },
        { id: 'pending', ownerUserId: 'user_1', approved: false, name: 'Pending Supplier' },
      ],
    });

    const list = await request(app).get('/api/suppliers').expect(200);
    expect(list.body.items.map(s => s.id)).toEqual(['approved']);

    await request(app).get('/api/suppliers/orphan').expect(404);
    await request(app).get('/api/suppliers/pending').expect(404);
  });
});

test('/api/me/suppliers returns dashboard profile photo fields from supplier record before owner avatar', async () => {
  const { app, dbUnified } = buildApp({
    currentUser: { id: 'user_1', role: 'supplier' },
    users: [{ id: 'user_1', email: 'owner@example.com', avatarUrl: '/api/photos/account_avatar' }],
    suppliers: [
      {
        id: 'sup_1',
        email: 'OWNER@example.com',
        approved: true,
        name: 'Dashboard Photo Supplier',
        profilePhotoUrl: '/api/photos/dashboard_avatar',
        logo: '/uploads/logo.webp',
      },
    ],
  });

  const res = await request(app).get('/api/me/suppliers').expect(200);
  expect(res.body.items[0]).toMatchObject({
    profilePhotoUrl: '/api/photos/dashboard_avatar',
    avatarUrl: '/api/photos/dashboard_avatar',
    displayAvatarUrl: '/api/photos/dashboard_avatar',
    ownerUserId: 'user_1',
    logo: '/uploads/logo.webp',
  });
  expect(dbUnified.updateOne).toHaveBeenCalledWith(
    'suppliers',
    { id: 'sup_1' },
    { $set: { ownerUserId: 'user_1' } }
  );
});

describe('public supplier profile-photo rendering contracts', () => {
  let suppliersInit;
  let supplierHtml;
  let supplierProfileJs;
  let supplierProfileCss;
  let packageInit;

  beforeAll(() => {
    suppliersInit = fs.readFileSync(SUPPLIERS_INIT, 'utf8');
    supplierHtml = fs.readFileSync(SUPPLIER_HTML, 'utf8');
    supplierProfileJs = fs.readFileSync(SUPPLIER_PROFILE_JS, 'utf8');
    supplierProfileCss = fs.readFileSync(SUPPLIER_PROFILE_CSS, 'utf8');
    packageInit = fs.readFileSync(PACKAGE_INIT, 'utf8');
  });

  test('supplier cards resolve profile images instead of using supplier.logo as the only avatar source', () => {
    expect(suppliersInit).toContain('function getSupplierProfileImage(supplier)');
    expect(suppliersInit).toContain('supplier?.profilePhotoUrl');
    expect(suppliersInit).toContain('supplier?.displayAvatarUrl');
    expect(suppliersInit).toContain('supplier?.avatarUrl');
    expect(suppliersInit).toContain('supplier?.logo');
    expect(suppliersInit).toContain(
      'const supplierProfileImage = getSupplierProfileImage(supplier)'
    );
    expect(suppliersInit).not.toContain('const avatarHtml = supplier.logo');
  });

  test('supplier card payloads use the same resolved supplier image for shortlist and messaging context', () => {
    expect(suppliersInit).toContain('data-supplier-image="${escapeHtml(supplierProfileImage)}"');
    expect(suppliersInit).toContain('data-context-image="${escapeHtml(supplierProfileImage)}"');
  });

  test('package mini-card image logic remains package based', () => {
    const packageBlockStart = suppliersInit.indexOf('const miniCards = packages');
    const packageBlockEnd = suppliersInit.indexOf(
      'const total = Math.min(packages.length, 4)',
      packageBlockStart
    );
    const packageBlock = suppliersInit.slice(packageBlockStart, packageBlockEnd);
    expect(packageBlock).toContain('resolvePackageImage(pkg)');
    expect(packageBlock).toContain('pkg.image');
    expect(packageBlock).toContain('pkg.gallery');
    expect(packageBlock).not.toContain('supplierProfileImage');
    expect(packageBlock).not.toContain('getSupplierProfileImage');
  });

  test('public supplier hero markup includes an image with initials fallback', () => {
    expect(supplierHtml).toContain('id="hero-avatar-img"');
    expect(supplierHtml).toContain('class="hero-avatar-img"');
    expect(supplierHtml).toContain('data-fallback-hide');
    expect(supplierHtml).toContain('data-fallback-show-next');
    expect(supplierHtml).toContain('id="hero-avatar-initials"');
  });

  test('public supplier profile JS resolves and renders profile images while keeping initials fallback', () => {
    expect(supplierProfileJs).toContain('function getSupplierProfileImage(supplier)');
    expect(supplierProfileJs).toContain("document.getElementById('hero-avatar-img')");
    expect(supplierProfileJs).toContain('avatarImgEl.src = profileImage');
    expect(supplierProfileJs).toContain('delete avatarImgEl.dataset.fallbackApplied');
    expect(supplierProfileJs).toContain('avatarImgEl.hidden = false');
    expect(supplierProfileJs).toContain('avatarImgEl.hidden = true');
    expect(supplierProfileJs).toContain(
      'avatarInitialsEl.textContent = _getInitials(supplier.name)'
    );
  });

  test('package sidebar uses resolved supplier profile images for avatar, shortlist, and messaging', () => {
    expect(packageInit).toContain('function getSupplierProfileImage(supplier)');
    expect(packageInit).toContain('supplier?.profilePhotoUrl');
    expect(packageInit).toContain('supplier?.displayAvatarUrl');
    expect(packageInit).toContain('supplier?.avatarUrl');
    expect(packageInit).toContain('const supplierProfileImage = getSupplierProfileImage(supplier)');
    expect(packageInit).toContain('saveBtn.dataset.supplierImage = supplierProfileImage');
    expect(packageInit).toContain('imageUrl: supplierProfileImage');
    expect(packageInit).toContain('msgBtn.dataset.contextImage = supplierProfileImage');
  });

  test('public supplier profile CSS sizes image in the circular avatar without removing fallback', () => {
    expect(supplierProfileCss).toContain('.hero-avatar-img');
    expect(supplierProfileCss).toContain('object-fit: cover');
    expect(supplierProfileCss).toContain('.hero-avatar-img[hidden]');
    expect(supplierProfileCss).toContain('.hero-avatar-img:not([hidden]) + #hero-avatar-initials');
  });
});
