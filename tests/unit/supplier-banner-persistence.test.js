'use strict';

const express = require('express');
const request = require('supertest');

describe('supplier banner persistence', () => {
  let supplier;
  let updateOne;
  let processAndSaveImage;

  beforeEach(() => {
    jest.resetModules();

    supplier = {
      id: 'sup_1',
      ownerUserId: 'usr_supplier',
      name: 'Example Supplier',
      category: 'Photography',
      approved: true,
    };
    updateOne = jest.fn(async (_collection, _filter, update) => {
      Object.assign(supplier, update.$set || {});
      return true;
    });
    processAndSaveImage = jest.fn(async () => ({
      optimized: '/api/photos/banner_opt',
      large: '/api/photos/banner_large',
      original: '/api/photos/banner_original',
    }));

    jest.doMock('../../photo-upload', () => ({ processAndSaveImage }));
    jest.doMock('../../services/catalogCache', () => ({
      invalidate: jest.fn(async () => undefined),
    }));
    jest.doMock('../../services/supplierProfileProvisioning.service', () => ({
      supplierApprovalDefaults: jest.fn(async () => ({ approved: false })),
    }));
    jest.doMock('../../middleware/audit', () => ({
      auditLog: jest.fn(async () => ({ id: 'audit_1' })),
      AUDIT_ACTIONS: { SUPPLIER_APPROVED: 'supplier_approved' },
    }));
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
  });

  function app() {
    const router = require('../../routes/supplier-management');
    router.initializeDependencies({
      dbUnified: {
        findOne: jest.fn(async (_collection, filter) =>
          filter.id === supplier.id && filter.ownerUserId === supplier.ownerUserId ? supplier : null
        ),
        updateOne,
        insertOne: jest.fn(),
        find: jest.fn(async () => []),
        read: jest.fn(async () => []),
      },
      authRequired: (req, _res, next) => {
        req.user = { id: 'usr_supplier', role: 'supplier', email: 'supplier@example.com' };
        next();
      },
      roleRequired: () => (_req, _res, next) => next(),
      requireVerifiedUser: (_req, _res, next) => next(),
      csrfProtection: (_req, _res, next) => next(),
      writeLimiter: (_req, _res, next) => next(),
      uid: jest.fn(prefix => `${prefix}_1`),
      geocoding: {
        isValidUKPostcode: jest.fn(() => true),
        geocodePostcode: jest.fn(async () => null),
      },
      supplierAnalytics: { getSupplierAnalytics: jest.fn() },
    });

    const instance = express();
    instance.use(express.json({ limit: '10mb' }));
    instance.use(router);
    return instance;
  }

  test('persists a data URL through the image pipeline and stores only stable URLs', async () => {
    const res = await request(app())
      .patch('/sup_1')
      .send({ bannerUrl: 'data:image/png;base64,aGVsbG8=' });

    expect(res.status).toBe(200);
    expect(processAndSaveImage).toHaveBeenCalledTimes(1);
    const [buffer, filename, context] = processAndSaveImage.mock.calls[0];
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString('utf8')).toBe('hello');
    expect(filename).toBe('supplier-banner.png');
    expect(context).toBe('supplier');
    expect(updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          bannerUrl: '/api/photos/banner_opt',
          coverImage: '/api/photos/banner_opt',
        }),
      })
    );
    expect(res.body.supplier.bannerUrl).toBe('/api/photos/banner_opt');
    expect(res.body.supplier.coverImage).toBe('/api/photos/banner_opt');
  });

  test('accepts an existing stable photo route without reprocessing it', async () => {
    const res = await request(app())
      .patch('/sup_1')
      .send({ bannerUrl: '/api/photos/existing_banner' });

    expect(res.status).toBe(200);
    expect(processAndSaveImage).not.toHaveBeenCalled();
    expect(res.body.supplier.bannerUrl).toBe('/api/photos/existing_banner');
    expect(res.body.supplier.coverImage).toBe('/api/photos/existing_banner');
  });

  test('rejects unsafe banner URL schemes', async () => {
    const res = await request(app())
      .patch('/sup_1')
      .send({ bannerUrl: 'javascript:alert(1)' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uploaded image|http\/https/i);
    expect(processAndSaveImage).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  test('clearing the banner clears both modern and legacy banner fields', async () => {
    supplier.bannerUrl = '/api/photos/old';
    supplier.coverImage = '/api/photos/old';

    const res = await request(app()).patch('/sup_1').send({ bannerUrl: '' });

    expect(res.status).toBe(200);
    expect(res.body.supplier.bannerUrl).toBe('');
    expect(res.body.supplier.coverImage).toBe('');
  });
});
