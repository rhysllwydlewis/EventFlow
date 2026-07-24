/**
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/catalogCache', () => ({
  invalidate: jest.fn(() => Promise.resolve()),
}));

function createApp(existingSupplier) {
  jest.resetModules();
  const catalogCache = require('../../services/catalogCache');
  const router = require('../../routes/supplier-management');
  const dbUnified = {
    findOne: jest.fn(async () => ({ ...existingSupplier })),
    updateOne: jest.fn(async () => true),
  };
  const pass = (_req, _res, next) => next();
  const authRequired = (req, _res, next) => {
    req.user = { id: existingSupplier.ownerUserId, role: 'supplier' };
    next();
  };
  router.initializeDependencies({
    dbUnified,
    authRequired,
    roleRequired: () => pass,
    requireVerifiedUser: pass,
    csrfProtection: pass,
    writeLimiter: pass,
    uid: prefix => `${prefix}_test`,
    geocoding: {
      isValidUKPostcode: () => true,
      geocodePostcode: async () => null,
    },
    supplierAnalytics: { getSupplierAnalytics: jest.fn() },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/me/suppliers', router);
  return { app, dbUnified, catalogCache };
}

describe('supplier theme PATCH route', () => {
  test('stores preset mode and atomically removes a stale custom colour', async () => {
    const existing = {
      id: 'sup_1',
      ownerUserId: 'user_1',
      category: 'Photography',
      themeMode: 'custom',
      themeColor: '#EC4899',
      approved: true,
    };
    const { app, dbUnified, catalogCache } = createApp(existing);
    const response = await request(app)
      .patch('/api/me/suppliers/sup_1')
      .send({ themeMode: 'preset', heroPreset: 'midnight' })
      .expect(200);

    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      expect.objectContaining({
        $set: expect.objectContaining({ themeMode: 'preset', heroPreset: 'midnight' }),
        $unset: { themeColor: 1 },
      })
    );
    expect(response.body.supplier).toMatchObject({
      themeMode: 'preset',
      heroPreset: 'midnight',
    });
    expect(response.body.supplier.themeColor).toBeUndefined();
    expect(catalogCache.invalidate).toHaveBeenCalled();
  });

  test('supports automatic mode by clearing both competing fields', async () => {
    const existing = {
      id: 'sup_2',
      ownerUserId: 'user_2',
      category: 'Music/DJ',
      themeMode: 'preset',
      heroPreset: 'ocean',
      themeColor: '#123456',
      approved: true,
    };
    const { app, dbUnified } = createApp(existing);
    const response = await request(app)
      .patch('/api/me/suppliers/sup_2')
      .send({ themeMode: 'automatic' })
      .expect(200);

    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_2' },
      expect.objectContaining({
        $set: expect.objectContaining({ themeMode: 'automatic' }),
        $unset: { themeColor: 1, heroPreset: 1 },
      })
    );
    expect(response.body.supplier).toMatchObject({ themeMode: 'automatic' });
    expect(response.body.supplier.heroPreset).toBeUndefined();
    expect(response.body.supplier.themeColor).toBeUndefined();
  });

  test('rejects an invalid explicit mode without writing', async () => {
    const existing = { id: 'sup_3', ownerUserId: 'user_3', approved: true };
    const { app, dbUnified } = createApp(existing);
    await request(app)
      .patch('/api/me/suppliers/sup_3')
      .send({ themeMode: 'preset', heroPreset: 'not-real' })
      .expect(400);
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });
});
