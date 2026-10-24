/**
 * A write that fails must not be reported as a success.
 *
 * db-unified's updateOne/deleteOne swallow errors and return false, which is also what they return
 * when nothing needed changing. These routes pass `throwOnError` so a failed write becomes a 500
 * the dashboard can show, while a write that matched but changed nothing stays a 200.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

const PASS = (_req, _res, next) => next();

describe('db-unified: throwOnError on updateOne / deleteOne', () => {
  it('rethrows a failed write only when asked, and still swallows it by default', async () => {
    jest.resetModules();
    // Run the real module against the local JSON store, then make its store throw.
    jest.doMock('../../store', () => ({
      read: jest.fn(() => [{ id: 'a' }]),
      write: jest.fn(() => {
        throw new Error('disk full');
      }),
    }));
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    const dbUnified = require('../../db-unified');

    expect(await dbUnified.updateOne('things', { id: 'a' }, { $set: { x: 1 } })).toBe(false);
    await expect(
      dbUnified.updateOne('things', { id: 'a' }, { $set: { x: 1 } }, { throwOnError: true })
    ).rejects.toThrow('disk full');

    expect(await dbUnified.deleteOne('things', { id: 'a' })).toBe(false);
    await expect(
      dbUnified.deleteOne('things', { id: 'a' }, { throwOnError: true })
    ).rejects.toThrow('disk full');
  });

  it('insertOne rethrows only when asked, so a unique-index duplicate can be told from a failure', async () => {
    jest.resetModules();
    jest.doMock('../../store', () => ({
      read: jest.fn(() => []),
      write: jest.fn(() => {
        throw Object.assign(new Error('duplicate'), { code: 11000 });
      }),
    }));
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    const dbUnified = require('../../db-unified');

    expect(await dbUnified.insertOne('events', { id: 'e1' })).toBeNull();
    await expect(
      dbUnified.insertOne('events', { id: 'e1' }, { throwOnError: true })
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('an unmatched or unchanged update is false but never throws', async () => {
    jest.resetModules();
    jest.doMock('../../store', () => ({
      read: jest.fn(() => [{ id: 'a' }]),
      write: jest.fn(),
    }));
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    const dbUnified = require('../../db-unified');

    await expect(
      dbUnified.updateOne('things', { id: 'missing' }, { $set: { x: 1 } }, { throwOnError: true })
    ).resolves.toBe(false);
  });
});

describe('package writes (routes/packages.js)', () => {
  const PKG = {
    id: 'pkg_1',
    supplierId: 'sup_1',
    title: 'Mine',
    price: '£10',
    price_display: '£10',
    paused: false,
  };

  let db;
  let app;

  function build() {
    jest.resetModules();
    jest.doMock('../../services/subscriptionService', () => ({
      getUserFeatures: jest.fn(async () => ({ features: { maxPackages: -1 }, name: 'Pro' })),
    }));
    const router = require('../../routes/packages');
    router.initializeDependencies({
      dbUnified: db,
      authRequired: (req, _res, next) => {
        req.user = { id: 'user_1', role: 'supplier' };
        next();
      },
      roleRequired: () => PASS,
      requireVerifiedUser: PASS,
      requireApprovedSupplier: PASS,
      csrfProtection: PASS,
      featureRequired: () => PASS,
      writeLimiter: PASS,
      photoUpload: { deleteImage: jest.fn(), processAndSaveImage: jest.fn() },
      uploadValidation: {},
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
      uid: prefix => `${prefix}_test`,
    });
    app = express();
    app.use(express.json());
    app.use('/api', router);
  }

  beforeEach(() => {
    db = {
      find: jest.fn(async () => [PKG]),
      findOne: jest.fn(async (collection, filter) => {
        if (collection === 'packages') {
          return filter.id === 'pkg_1' ? { ...PKG } : null;
        }
        return { id: 'sup_1', ownerUserId: 'user_1', approved: true };
      }),
      updateOne: jest.fn(async () => true),
      deleteOne: jest.fn(async () => true),
      insertOne: jest.fn(async doc => doc),
    };
    build();
  });

  const WRITES = [
    [
      'PUT edit',
      'put',
      '/api/me/packages/pkg_1',
      { title: 'New title', price: '£20' },
      'updateOne',
    ],
    ['PUT pause', 'put', '/api/me/packages/pkg_1/pause', {}, 'updateOne'],
    ['PUT unpause', 'put', '/api/me/packages/pkg_1/unpause', {}, 'updateOne'],
    ['DELETE', 'delete', '/api/me/packages/pkg_1', {}, 'deleteOne'],
  ];

  test.each(WRITES)(
    '%s asks the database to throw on failure',
    async (_name, method, url, body, fn) => {
      await request(app)[method](url).send(body).expect(200);
      expect(db[fn]).toHaveBeenCalledTimes(1);
      const args = db[fn].mock.calls[0];
      expect(args[args.length - 1]).toEqual({ throwOnError: true });
    }
  );

  test.each(WRITES)(
    '%s answers 500, not ok, when the write throws',
    async (_name, method, url, body, fn) => {
      db[fn].mockRejectedValue(new Error('mongo down'));
      const res = await request(app)[method](url).send(body);
      expect(res.status).toBe(500);
      expect(res.body.ok).toBeUndefined();
      expect(res.body.error).toBeTruthy();
    }
  );

  test('pausing an already paused package (matched, nothing modified) is still a success', async () => {
    db.updateOne.mockResolvedValue(false);
    const res = await request(app).put('/api/me/packages/pkg_1/pause').send({}).expect(200);
    expect(res.body.ok).toBe(true);
  });

  test('a failed package lookup is a 500, not a "not found" or "forbidden"', async () => {
    db.findOne.mockRejectedValue(new Error('mongo down'));
    const res = await request(app).put('/api/me/packages/pkg_1/pause').send({});
    expect(res.status).toBe(500);
    expect(db.updateOne).not.toHaveBeenCalled();
  });

  test('the ownership lookups ask for errors to be thrown', async () => {
    await request(app).put('/api/me/packages/pkg_1/pause').send({}).expect(200);
    db.findOne.mock.calls.forEach(call => {
      expect(call[2]).toEqual({ throwOnError: true });
    });
  });
});

describe('guide progress, trial and verification (routes/supplier.js)', () => {
  let mockDb;
  let app;

  beforeEach(() => {
    jest.resetModules();
    mockDb = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async (collection, filter) => {
        if (collection === 'users') {
          return { id: 'user_1', onboarding: {} };
        }
        return { id: 'sup_1', ownerUserId: filter.ownerUserId, approved: true };
      }),
      updateOne: jest.fn(async () => true),
      read: jest.fn(async () => []),
    };
    jest.doMock('../../db-unified', () => mockDb);
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    jest.doMock('../../middleware/auth', () => ({
      authRequired: (req, _res, next) => {
        req.user = { id: 'user_1', role: 'supplier' };
        next();
      },
    }));
    jest.doMock('../../middleware/csrf', () => ({ csrfProtection: PASS }));
    jest.doMock('../../middleware/rateLimits', () => ({ writeLimiter: PASS, apiLimiter: PASS }));
    const router = require('../../routes/supplier');
    app = express();
    app.use(express.json());
    app.use('/api/v1/supplier', router);
  });

  test('guide-progress saves and answers with the progress', async () => {
    const res = await request(app)
      .put('/api/v1/supplier/guide-progress')
      .send({ status: 'dismissed', step: 'profile' })
      .expect(200);
    expect(res.body.progress.status).toBe('dismissed');
    expect(mockDb.updateOne.mock.calls[0][3]).toEqual({ throwOnError: true });
  });

  test('guide-progress answers 500 when the write fails', async () => {
    mockDb.updateOne.mockRejectedValue(new Error('mongo down'));
    const res = await request(app)
      .put('/api/v1/supplier/guide-progress')
      .send({ status: 'completed', step: '' });
    expect(res.status).toBe(500);
    expect(res.body.progress).toBeUndefined();
  });

  test('trial activation answers 500 when the write fails', async () => {
    mockDb.updateOne.mockRejectedValue(new Error('mongo down'));
    const res = await request(app).post('/api/v1/supplier/trial/activate').send({});
    expect(res.status).toBe(500);
    expect(res.body.success).toBeUndefined();
  });

  test('verification submit answers 500 when the write fails', async () => {
    mockDb.updateOne.mockRejectedValue(new Error('mongo down'));
    mockDb.findOne.mockImplementation(async collection =>
      collection === 'suppliers'
        ? {
            id: 'sup_1',
            ownerUserId: 'user_1',
            name: 'A',
            category: 'Catering',
            email: 'a@example.com',
            phone: '0123',
            location: 'Cardiff',
            verificationStatus: 'unverified',
          }
        : null
    );
    const res = await request(app).post('/api/v1/supplier/verification/submit').send({});
    expect(res.status).toBe(500);
  });
});
