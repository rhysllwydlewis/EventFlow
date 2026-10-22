/**
 * A supplier can always read their own packages, approved or not; every route that changes one
 * still refuses an unapproved supplier. (A supplier who was approved, listed packages and was then
 * suspended used to see an empty list.)
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

function createApp({ suppliers, packages, userId = 'user_1' }) {
  jest.resetModules();
  const router = require('../../routes/packages');
  const dbUnified = {
    find: jest.fn(async (collection, query) => {
      if (collection === 'suppliers') {
        return suppliers.filter(s => s.ownerUserId === query.ownerUserId);
      }
      if (collection === 'packages') {
        return packages.filter(p => query.supplierId.$in.includes(p.supplierId));
      }
      return [];
    }),
    findOne: jest.fn(async () => null),
    updateOne: jest.fn(async () => true),
    insertOne: jest.fn(async doc => doc),
  };
  const pass = (_req, _res, next) => next();
  router.initializeDependencies({
    dbUnified,
    authRequired: (req, _res, next) => {
      req.user = { id: userId, role: 'supplier' };
      next();
    },
    roleRequired: () => pass,
    requireVerifiedUser: pass,
    // What middleware/auth.js does for a supplier that is not approved.
    requireApprovedSupplier: (_req, res) =>
      res.status(403).json({ error: 'Supplier not approved', code: 'SUPPLIER_NOT_APPROVED' }),
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
  return app;
}

const suppliers = [
  { id: 'sup_1', ownerUserId: 'user_1', approved: false },
  { id: 'sup_2', ownerUserId: 'user_2', approved: true },
];
const packages = [
  { id: 'pkg_1', supplierId: 'sup_1', title: 'Mine' },
  { id: 'pkg_2', supplierId: 'sup_2', title: 'Theirs' },
];

describe('GET /api/me/packages for a supplier who is not approved', () => {
  test('lists their own packages and says they cannot edit', async () => {
    const res = await request(createApp({ suppliers, packages }))
      .get('/api/me/packages')
      .expect(200);
    expect(res.body.items.map(p => p.id)).toEqual(['pkg_1']);
    expect(res.body.canEdit).toBe(false);
  });

  test('never lists another supplier’s packages', async () => {
    const res = await request(createApp({ suppliers, packages, userId: 'user_9' }))
      .get('/api/me/packages')
      .expect(200);
    expect(res.body.items).toEqual([]);
  });

  test('says an approved supplier can edit', async () => {
    const res = await request(createApp({ suppliers, packages, userId: 'user_2' }))
      .get('/api/me/packages')
      .expect(200);
    expect(res.body.canEdit).toBe(true);
  });

  test('creating a package is still refused', async () => {
    const res = await request(createApp({ suppliers, packages }))
      .post('/api/me/packages')
      .send({
        title: 'New',
        price: '£10',
        primaryCategoryKey: 'catering',
        eventTypes: ['wedding'],
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUPPLIER_NOT_APPROVED');
  });
});
