/**
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/catalogCache', () => ({
  invalidate: jest.fn(() => Promise.resolve()),
}));

function createApp(existingSupplier, { hasCustomBranding = true } = {}) {
  jest.resetModules();
  const checkFeatureAccess = jest.fn(async () => hasCustomBranding);
  jest.doMock('../../services/subscriptionService', () => ({ checkFeatureAccess }));
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
  return { app, dbUnified, catalogCache, checkFeatureAccess };
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

  test('rejects setting a custom theme colour without the customBranding entitlement', async () => {
    const existing = { id: 'sup_4', ownerUserId: 'user_4', approved: true };
    const { app, dbUnified, checkFeatureAccess } = createApp(existing, {
      hasCustomBranding: false,
    });
    const response = await request(app)
      .patch('/api/me/suppliers/sup_4')
      .send({ themeMode: 'custom', themeColor: '#FF00FF' })
      .expect(403);

    expect(response.body.code).toBe('FEATURE_REQUIRES_UPGRADE');
    expect(checkFeatureAccess).toHaveBeenCalledWith('user_4', 'customBranding');
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });

  test('allows setting a custom theme colour with the customBranding entitlement', async () => {
    const existing = { id: 'sup_5', ownerUserId: 'user_5', approved: true };
    const { app, dbUnified } = createApp(existing, { hasCustomBranding: true });
    const response = await request(app)
      .patch('/api/me/suppliers/sup_5')
      .send({ themeMode: 'custom', themeColor: '#FF00FF' })
      .expect(200);

    expect(response.body.supplier.themeMode).toBe('custom');
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_5' },
      expect.objectContaining({ $set: expect.objectContaining({ themeColor: '#FF00FF' }) })
    );
  });

  test('does not re-check the entitlement for an unrelated PATCH that leaves an existing custom theme untouched', async () => {
    const existing = {
      id: 'sup_6',
      ownerUserId: 'user_6',
      approved: true,
      themeMode: 'custom',
      themeColor: '#00FFAA',
    };
    const { app, checkFeatureAccess } = createApp(existing, { hasCustomBranding: false });
    await request(app)
      .patch('/api/me/suppliers/sup_6')
      .send({ tagline: 'Now booking for 2027' })
      .expect(200);

    expect(checkFeatureAccess).not.toHaveBeenCalled();
  });
});
