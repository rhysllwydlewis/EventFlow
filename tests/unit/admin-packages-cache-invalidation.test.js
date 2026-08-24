/**
 * Regression test: the admin package management endpoints (approve, feature,
 * update, delete) must invalidate the featured/spotlight package caches in
 * routes/suppliers.js after mutating a package. Without this, an admin
 * marking a package "Featured" wouldn't see it reflected on the homepage
 * carousels until the cache expired — up to an hour for the spotlight cache.
 */

'use strict';

const express = require('express');
const request = require('supertest');

function mockLogger() {
  jest.doMock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }));
}

describe('admin package routes invalidate featured/spotlight caches', () => {
  let packagesRouter;
  let data;
  let invalidatePackageCaches;

  beforeEach(() => {
    jest.resetModules();
    mockLogger();
    invalidatePackageCaches = jest.fn();
    jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches }));

    packagesRouter = require('../../routes/packages');
    data = {
      packages: [
        { id: 'pkg_1', supplierId: 'sup_1', title: 'Wedding chauffeur hire', approved: true },
      ],
    };

    const dbUnified = {
      findOne: jest.fn(async (collection, filter) => {
        const rows = data[collection] || [];
        return rows.find(row => Object.keys(filter).every(key => row[key] === filter[key])) || null;
      }),
      updateOne: jest.fn(async (collection, filter, update) => {
        const rows = data[collection] || [];
        const row = rows.find(r => r.id === filter.id);
        if (row) {
          Object.assign(row, update.$set || {});
        }
        return row;
      }),
      deleteOne: jest.fn(async (collection, id) => {
        const targetId = typeof id === 'string' ? id : id.id;
        data[collection] = (data[collection] || []).filter(row => row.id !== targetId);
        return true;
      }),
    };

    packagesRouter.initializeDependencies({
      dbUnified,
      authRequired: (req, _res, next) => {
        req.user = { id: 'usr_admin', role: 'admin' };
        next();
      },
      roleRequired: () => (_req, _res, next) => next(),
      requireVerifiedUser: (_req, _res, next) => next(),
      requireApprovedSupplier: (_req, _res, next) => next(),
      csrfProtection: (_req, _res, next) => next(),
      featureRequired: () => (_req, _res, next) => next(),
      writeLimiter: (_req, _res, next) => next(),
      photoUpload: {
        upload: { single: () => (_req, _res, next) => next() },
        processAndSaveImage: jest.fn(),
      },
      uploadValidation: {},
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      uid: jest.fn(prefix => `${prefix}_new`),
    });
  });

  function app() {
    const instance = express();
    instance.use(express.json());
    instance.use(packagesRouter);
    return instance;
  }

  it('POST /admin/packages/:id/approve invalidates package caches', async () => {
    const res = await request(app()).post('/admin/packages/pkg_1/approve').send({ approved: true });

    expect(res.status).toBe(200);
    expect(invalidatePackageCaches).toHaveBeenCalledTimes(1);
  });

  it('POST /admin/packages/:id/feature invalidates package caches', async () => {
    const res = await request(app()).post('/admin/packages/pkg_1/feature').send({ featured: true });

    expect(res.status).toBe(200);
    expect(res.body.package.featured).toBe(true);
    expect(invalidatePackageCaches).toHaveBeenCalledTimes(1);
  });

  it('PUT /admin/packages/:id invalidates package caches', async () => {
    const res = await request(app())
      .put('/admin/packages/pkg_1')
      .send({ featured: true, approved: true });

    expect(res.status).toBe(200);
    expect(invalidatePackageCaches).toHaveBeenCalledTimes(1);
  });

  it('DELETE /admin/packages/:id invalidates package caches', async () => {
    const res = await request(app()).delete('/admin/packages/pkg_1');

    expect(res.status).toBe(200);
    expect(invalidatePackageCaches).toHaveBeenCalledTimes(1);
  });
});
