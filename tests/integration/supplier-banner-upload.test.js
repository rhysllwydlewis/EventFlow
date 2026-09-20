/**
 * @jest-environment node
 *
 * Persistent supplier banner uploads (P0 item 1 of
 * docs/audits/SUPPLIER_PROFILE_EDITING_CORRECTNESS_HANDOFF.md):
 *
 * The dedicated Profile Customisation page used to store a banner as a
 * base64 data URL in the hidden `bannerUrl` field and send it through the
 * ordinary supplier PATCH route. That route truncates `bannerUrl` to 500
 * characters and the public serializer excludes data-image URLs, so the
 * editor could report a successful save while the banner never actually
 * persisted or rendered publicly.
 *
 * POST /api/me/suppliers/:id/banner fixes this by storing the banner
 * through the same MongoDB-backed photo pipeline the gallery uses, so
 * bannerUrl is always a short, stable /api/photos/... URL.
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/catalogCache', () => ({
  invalidate: jest.fn(() => Promise.resolve()),
}));

function createApp(existingSupplier) {
  jest.resetModules();
  const router = require('../../routes/suppliers-v2');
  const catalogCache = require('../../services/catalogCache');
  const dbUnified = {
    read: jest.fn(async collection => (collection === 'suppliers' ? [existingSupplier] : [])),
    updateOne: jest.fn(async () => true),
  };
  const photoUpload = {
    deleteImage: jest.fn(async () => true),
    processAndSaveImage: jest.fn(async (_buffer, filename) => ({
      optimized: `/api/photos/optimized_${filename}`,
      thumbnail: `/api/photos/thumb_${filename}`,
      large: `/api/photos/large_${filename}`,
      original: `/api/photos/original_${filename}`,
    })),
  };
  const pass = (_req, _res, next) => next();
  const authRequired = (req, _res, next) => {
    req.user = { id: existingSupplier.ownerUserId, role: 'supplier' };
    next();
  };

  router.initializeDependencies({
    dbUnified,
    authRequired,
    requireVerifiedUser: pass,
    csrfProtection: pass,
    featureRequired: () => pass,
    photoUpload,
    writeLimiter: pass,
  });

  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use('/api/me/suppliers', router);
  return { app, dbUnified, photoUpload, catalogCache };
}

const TINY_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('supplier banner upload', () => {
  test('stores a real EventFlow URL, stamps updatedAt, and busts the catalogue cache', async () => {
    const existingSupplier = {
      id: 'sup_1',
      ownerUserId: 'user_1',
      bannerUrl: '',
    };
    const { app, dbUnified, catalogCache } = createApp(existingSupplier);

    const res = await request(app)
      .post('/api/me/suppliers/sup_1/banner')
      .send({ image: TINY_PNG_BASE64 })
      .expect(200);

    expect(res.body.url).toMatch(/^\/api\/photos\//);
    expect(res.body.supplier.bannerUrl).toBe(res.body.url);
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      {
        $set: {
          bannerUrl: res.body.url,
          updatedAt: expect.any(String),
        },
      }
    );
    expect(catalogCache.invalidate).toHaveBeenCalledTimes(1);
  });

  test('never stores a base64 data URL as the banner', async () => {
    const existingSupplier = { id: 'sup_2', ownerUserId: 'user_2', bannerUrl: '' };
    const { app } = createApp(existingSupplier);

    const res = await request(app)
      .post('/api/me/suppliers/sup_2/banner')
      .send({ image: TINY_PNG_BASE64 })
      .expect(200);

    expect(res.body.url.startsWith('data:')).toBe(false);
    expect(res.body.url.length).toBeLessThan(500);
  });

  test('rejects a request with no image', async () => {
    const existingSupplier = { id: 'sup_3', ownerUserId: 'user_3', bannerUrl: '' };
    const { app, dbUnified } = createApp(existingSupplier);

    await request(app).post('/api/me/suppliers/sup_3/banner').send({}).expect(400);

    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });

  test('rejects a malformed image payload without touching the supplier', async () => {
    const existingSupplier = { id: 'sup_4', ownerUserId: 'user_4', bannerUrl: '' };
    const { app, dbUnified } = createApp(existingSupplier);

    const res = await request(app)
      .post('/api/me/suppliers/sup_4/banner')
      .send({ image: 'not-a-data-url' })
      .expect(400);

    expect(res.body.error).toBe('Invalid image');
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });

  test('a supplier cannot upload a banner for another supplier', async () => {
    const existingSupplier = { id: 'sup_5', ownerUserId: 'user_5', bannerUrl: '' };
    const { app, dbUnified, photoUpload } = createApp(existingSupplier);

    // authRequired in this harness always authenticates as the owner of
    // existingSupplier, so requesting a different supplier id simulates a
    // non-owner trying to upload someone else's banner.
    await request(app)
      .post('/api/me/suppliers/not-my-supplier/banner')
      .send({ image: TINY_PNG_BASE64 })
      .expect(403);

    expect(photoUpload.processAndSaveImage).not.toHaveBeenCalled();
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });
});
