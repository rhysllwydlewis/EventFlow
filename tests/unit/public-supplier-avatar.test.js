'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const request = require('supertest');
const service = require('../../services/publicSupplierAvatar.service');

function db({ suppliers = [], users = [] } = {}) {
  return {
    read: jest.fn(async collection =>
      collection === 'suppliers' ? suppliers : collection === 'users' ? users : []
    ),
    findOne: jest.fn(async (collection, query) => {
      if (collection === 'suppliers') {
        return suppliers.find(s => s.id === query.id) || null;
      }
      if (collection === 'users') {
        return users.find(u => u.id === query.id) || null;
      }
      return null;
    }),
    updateOne: jest.fn(async (collection, query, update) => {
      if (collection === 'suppliers') {
        const supplier = suppliers.find(s => s.id === query.id);
        if (supplier && update && update.$set) {
          Object.assign(supplier, update.$set);
        }
        if (supplier && update && update.$unset) {
          for (const key of Object.keys(update.$unset)) {
            delete supplier[key];
          }
        }
      }
      return { matched: 1, modified: 1 };
    }),
  };
}

function routeApp(data) {
  jest.resetModules();
  const router = require('../../routes/public-supplier-avatar');
  const mockDb = db(data);
  router.initializeDependencies({ dbUnified: mockDb, logger: { error: jest.fn() } });
  const app = express();
  app.use('/api', router);
  return { app, mockDb };
}

describe('public supplier avatar canonical service and endpoint', () => {
  test('endpoint returns only public avatar fields when approved supplier has photo', async () => {
    const { app } = routeApp({
      suppliers: [
        {
          id: 'sup_1',
          name: 'Romeo Test',
          approved: true,
          publicProfileAvatarUrl: '/api/photos/rt',
          email: 'private@example.com',
          ownerUserId: 'user_1',
          passwordHash: 'x',
        },
      ],
    });

    const res = await request(app).get('/api/public/suppliers/sup_1/avatar').expect(200);
    expect(res.body).toEqual({
      supplierId: 'sup_1',
      hasPhoto: true,
      avatarUrl: '/api/photos/rt',
      initials: 'RT',
    });
    for (const key of [
      'email',
      'ownerEmail',
      'contactEmail',
      'phone',
      'ownerUserId',
      'userId',
      'passwordHash',
      'tokens',
      'adminNotes',
    ]) {
      expect(res.body[key]).toBeUndefined();
    }
    expect(res.headers['cache-control']).toContain('no-store');
  });

  test('endpoint returns hasPhoto true using logo when canonical avatar is missing', async () => {
    const { app, mockDb } = routeApp({
      suppliers: [
        { id: 'sup_logo', name: 'Logo Supplier', approved: true, logo: '/uploads/logo.png' },
      ],
    });
    const res = await request(app).get('/api/public/suppliers/sup_logo/avatar').expect(200);
    expect(res.body).toEqual({
      supplierId: 'sup_logo',
      hasPhoto: true,
      avatarUrl: '/uploads/logo.png',
      initials: 'LS',
    });
    expect(mockDb.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_logo' },
      expect.objectContaining({
        $set: expect.objectContaining({ publicProfileAvatarUrl: '/uploads/logo.png' }),
      })
    );
  });

  test('endpoint uses highest priority safe fallback when canonical avatar is missing', async () => {
    const cases = [
      {
        id: 'sup_profile',
        fields: {
          profilePhotoUrl: '/uploads/profile-photo.png',
          displayAvatarUrl: '/uploads/display-avatar.png',
          avatarUrl: '/uploads/avatar.png',
          logo: '/uploads/logo.png',
        },
        expected: '/uploads/profile-photo.png',
      },
      {
        id: 'sup_display',
        fields: {
          displayAvatarUrl: '/uploads/display-avatar.png',
          avatarUrl: '/uploads/avatar.png',
          logo: '/uploads/logo.png',
        },
        expected: '/uploads/display-avatar.png',
      },
      {
        id: 'sup_avatar',
        fields: { avatarUrl: '/uploads/avatar.png', logo: '/uploads/logo.png' },
        expected: '/uploads/avatar.png',
      },
    ];

    for (const testCase of cases) {
      const { app } = routeApp({
        suppliers: [
          {
            id: testCase.id,
            name: 'Priority Supplier',
            approved: true,
            ...testCase.fields,
          },
        ],
      });
      const res = await request(app).get(`/api/public/suppliers/${testCase.id}/avatar`).expect(200);
      expect(res.body.avatarUrl).toBe(testCase.expected);
      expect(res.body.hasPhoto).toBe(true);
    }
  });

  test('write-through failure still returns safe fallback avatar', async () => {
    const warn = jest.fn();
    const { app, mockDb } = routeApp({
      suppliers: [
        { id: 'sup_fail', name: 'Fail Write', approved: true, logo: '/uploads/logo.png' },
      ],
    });
    mockDb.updateOne.mockRejectedValueOnce(new Error('disk full'));
    const router = require('../../routes/public-supplier-avatar');
    router.initializeDependencies({ dbUnified: mockDb, logger: { error: jest.fn(), warn } });
    const res = await request(app).get('/api/public/suppliers/sup_fail/avatar').expect(200);
    expect(res.body).toMatchObject({ hasPhoto: true, avatarUrl: '/uploads/logo.png' });
    expect(warn).toHaveBeenCalled();
  });

  test('endpoint returns placeholder metadata for approved supplier without photo', async () => {
    const { app } = routeApp({ suppliers: [{ id: 'sup_2', name: 'No Photo', approved: true }] });
    const res = await request(app).get('/api/public/suppliers/sup_2/avatar').expect(200);
    expect(res.body).toEqual({
      supplierId: 'sup_2',
      hasPhoto: false,
      avatarUrl: null,
      initials: 'NP',
    });
  });

  test('endpoint does not expose non-public suppliers', async () => {
    const { app } = routeApp({
      suppliers: [
        {
          id: 'sup_private',
          name: 'Private',
          approved: false,
          publicProfileAvatarUrl: '/api/photos/private',
        },
      ],
    });
    await request(app).get('/api/public/suppliers/sup_private/avatar').expect(404);
  });

  test('URL safety rejects data, javascript and protocol-relative URLs', () => {
    expect(service.isSafePublicImageUrl('/api/photos/photo')).toBe(true);
    expect(service.isSafePublicImageUrl('https://example.com/photo.jpg')).toBe(true);
    expect(service.isSafePublicImageUrl('data:image/png;base64,aaa')).toBe(false);
    expect(service.isSafePublicImageUrl('javascript:alert(1)')).toBe(false);
    expect(service.isSafePublicImageUrl('//evil.example/photo.jpg')).toBe(false);
    expect(service.isSafePublicImageUrl('ftp://evil.example/photo.jpg')).toBe(false);
    expect(service.isSafePublicImageUrl({ url: '/api/photos/photo' })).toBe(false);
  });

  test('diagnostic reports fallback source and write-through attempt without exposing private data', async () => {
    const mockDb = db({
      suppliers: [
        {
          id: 'sup_wtlrt6uiftxg2y',
          name: 'Romeo Test',
          approved: true,
          logo: '/uploads/romeo-logo.png',
          email: 'private@example.com',
          ownerUserId: 'user_private',
        },
      ],
    });

    const diagnostic = await service.diagnoseKnownSupplierAvatar({ dbUnified: mockDb });

    expect(diagnostic).toMatchObject({
      supplierId: 'sup_wtlrt6uiftxg2y',
      exists: true,
      hasPublicProfileAvatarUrl: false,
      publicProfileAvatarUrlSafe: false,
      safeFallbackExists: true,
      fallbackSourceField: 'logo',
      endpointHasPhoto: true,
      writeThroughRepairAttempted: true,
    });
    expect(diagnostic.email).toBeUndefined();
    expect(diagnostic.ownerUserId).toBeUndefined();
  });

  test('diagnostic reachability checks resolve relative safe image URLs against a base URL', async () => {
    const fetchImpl = jest.fn(async url => ({
      ok: true,
      status: 200,
      headers: { get: name => (name === 'content-type' ? 'image/jpeg' : null) },
      url,
    }));
    const result = await service.checkPublicImageReachability('/api/photos/rt', {
      baseUrl: 'https://event-flow.co.uk',
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://event-flow.co.uk/api/photos/rt', {
      method: 'HEAD',
    });
    expect(result).toMatchObject({
      checked: true,
      reachable: true,
      status: 200,
      imageContentType: true,
    });
  });

  test('upload and delete sync set and unset canonical publicProfileAvatarUrl', async () => {
    const mockDb = db({ suppliers: [{ id: 'sup_1', ownerUserId: 'user_1' }] });
    await service.syncPublicSupplierAvatarForUser('user_1', '/api/photos/new', {
      dbUnified: mockDb,
    });
    expect(mockDb.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      expect.objectContaining({
        $set: expect.objectContaining({ publicProfileAvatarUrl: '/api/photos/new' }),
      })
    );
    mockDb.updateOne.mockClear();
    await service.syncPublicSupplierAvatarForUser('user_1', null, { dbUnified: mockDb });
    expect(mockDb.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      expect.objectContaining({ $unset: { publicProfileAvatarUrl: '' } })
    );
  });

  test('user avatar sync supports legacy email-linked suppliers', async () => {
    const mockDb = db({ suppliers: [{ id: 'sup_email', ownerEmail: 'OWNER@example.com' }] });
    await service.syncPublicSupplierAvatarForUser(
      { id: 'user_email', email: 'owner@example.com' },
      '/api/photos/email-linked',
      { dbUnified: mockDb }
    );
    expect(mockDb.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_email' },
      expect.objectContaining({
        $set: expect.objectContaining({ publicProfileAvatarUrl: '/api/photos/email-linked' }),
      })
    );
  });

  test('backfill repairs old profile fields and does not overwrite canonical avatar without force', async () => {
    const mockDb = db({
      suppliers: [
        { id: 'sup_1', ownerUserId: 'user_1', profilePhotoUrl: '/api/photos/old' },
        {
          id: 'sup_2',
          ownerUserId: 'user_2',
          publicProfileAvatarUrl: '/api/photos/canonical',
          profilePhotoUrl: '/api/photos/other',
        },
        { id: 'sup_3', ownerUserId: 'user_3' },
      ],
      users: [{ id: 'user_3', avatarUrl: '/api/photos/user3' }],
    });
    const summary = await service.repairPublicSupplierAvatars({ dbUnified: mockDb });
    expect(summary).toMatchObject({
      scanned: 3,
      repaired: 1,
      skippedExisting: 1,
      skippedNoImage: 1,
      failed: 0,
    });
    expect(JSON.stringify(mockDb.updateOne.mock.calls)).toContain('/api/photos/old');
    expect(summary.sources).toMatchObject({ profilePhotoUrl: 1, skippedNoImage: 1 });
    expect(JSON.stringify(mockDb.updateOne.mock.calls)).not.toContain('/api/photos/user3');
    expect(JSON.stringify(mockDb.updateOne.mock.calls)).not.toContain('/api/photos/other');
  });
});

describe('public-supplier-avatar client', () => {
  function makeDom() {
    const img = {
      hidden: true,
      style: {},
      attributes: {},
      classList: { remove: jest.fn(), add: jest.fn() },
      set src(value) {
        this.attributes.src = value;
      },
      get src() {
        return this.attributes.src || '';
      },
      getAttribute(name) {
        return this.attributes[name] || null;
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
      hasAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name);
      },
      alt: '',
    };
    const initials = { textContent: 'RT', style: {}, hidden: false };
    const document = {
      readyState: 'loading',
      addEventListener: jest.fn(),
      getElementById: id =>
        id === 'hero-avatar-img' ? img : id === 'hero-avatar-initials' ? initials : null,
    };
    return {
      window: { location: { search: '?id=sup_1' }, URLSearchParams },
      document,
      img,
      initials,
    };
  }

  function loadClient(dom, fetchMock) {
    const avatarUtilCode = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/utils/supplier-avatar.js'),
      'utf8'
    );
    const code = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/public-supplier-avatar.js'),
      'utf8'
    );
    const sandbox = {
      window: dom.window,
      document: dom.document,
      URLSearchParams,
      fetch: fetchMock,
      module: { exports: {} },
    };
    // The shared avatar-initials/color utility attaches itself to
    // window.EFSupplierAvatar; load it into the same sandbox first, then
    // reset module.exports so it isn't overwritten by the client script.
    vm.runInNewContext(avatarUtilCode, sandbox);
    sandbox.module = { exports: {} };
    vm.runInNewContext(code, sandbox);
    return sandbox.module.exports;
  }

  test('fetches dedicated endpoint, sets src, waits for load, and restores placeholder on error', async () => {
    const dom = makeDom();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        supplierId: 'sup_1',
        hasPhoto: true,
        avatarUrl: '/api/photos/rt',
        initials: 'RT',
        profilePhotoUrl: '/old-ignored',
      }),
    }));
    const client = loadClient(dom, fetchMock);
    await client.loadPublicSupplierAvatar();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/public/suppliers/sup_1/avatar',
      expect.any(Object)
    );
    expect(dom.img.getAttribute('src')).toBe('/api/photos/rt');
    expect(dom.img.hidden).toBe(true);
    dom.img.onload();
    expect(dom.img.hidden).toBe(false);
    expect(dom.initials.style.display).toBe('none');
    dom.img.onerror();
    expect(dom.img.hidden).toBe(true);
    expect(dom.img.hasAttribute('src')).toBe(false);
  });

  test('resolves the supplier id from window.EventFlowSupplierRoute on a canonical /supplier/name--token URL', async () => {
    // The canonical profile URL (e.g. /supplier/meet-in-wales--2a97dadc1dc8b6c0)
    // carries no ?id= query string at all. supplier-route-context.js exposes
    // the real id via this API instead -- and, critically, it does not expire
    // the way its own URLSearchParams.get('id') monkey-patch deliberately
    // does shortly after DOMContentLoaded (see that file's own comment). This
    // is the regression this test guards: on a real network, the async
    // supplier-data fetch (and this module's resulting sp:dataReady-triggered
    // second call) can easily land after that monkey-patch has already been
    // restored to native -- at which point location.search has nothing for
    // it to find, and the avatar was getting stuck on its initial-load
    // placeholder forever even though the real photo had already loaded.
    const dom = makeDom();
    dom.window.location.search = '';
    dom.window.EventFlowSupplierRoute = { getSupplierId: () => 'sup_1' };
    dom.window.__supplierData = {
      id: 'sup_1',
      name: 'Romeo Test',
      profilePhotoUrl: '/api/photos/rt',
    };
    const fetchMock = jest.fn();
    const client = loadClient(dom, fetchMock);

    await client.loadPublicSupplierAvatar();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(dom.img.getAttribute('src')).toBe('/api/photos/rt');
  });

  test('falls back to the query string when EventFlowSupplierRoute is unavailable (e.g. supplier.html?id=... directly)', async () => {
    const dom = makeDom();
    dom.window.location.search = '?id=sup_legacy';
    dom.window.__supplierData = {
      id: 'sup_legacy',
      name: 'Legacy Supplier',
      profilePhotoUrl: '/api/photos/legacy',
    };
    const fetchMock = jest.fn();
    const client = loadClient(dom, fetchMock);

    await client.loadPublicSupplierAvatar();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(dom.img.getAttribute('src')).toBe('/api/photos/legacy');
  });
});
