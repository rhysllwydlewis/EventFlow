'use strict';

const express = require('express');
const request = require('supertest');
const createPublicSupplierSeoRouter = require('../../routes/public-supplier-seo');
const { buildPublicSupplierSlug } = require('../../services/publicSupplierSeo.service');

function createApp(data, options = {}) {
  const dbUnified = {
    read: jest.fn(async collection => data[collection] || []),
  };
  const logger = { error: jest.fn() };
  const app = express();
  app.use(
    createPublicSupplierSeoRouter({
      dbUnified,
      logger,
      baseUrl: 'https://event-flow.co.uk',
      ...options,
    })
  );
  app.use((_req, res) => res.status(404).send('Not found'));
  return { app, dbUnified, logger };
}

const approvedSupplier = {
  id: 'supplier-123',
  ownerUserId: 'user-1',
  approved: true,
  name: 'Cwm Valley Photography',
  category: 'Photography',
  location: 'Cardiff',
  description_short: 'Natural wedding and event photography across South Wales.',
  updatedAt: '2026-07-18T10:00:00.000Z',
};

describe('public supplier SEO routes', () => {
  test('serves the existing supplier page with server-rendered head metadata and route context', async () => {
    const { app } = createApp({
      suppliers: [approvedSupplier],
      users: [{ id: 'user-1' }],
    });
    const slug = buildPublicSupplierSlug(approvedSupplier);

    const response = await request(app).get(`/supplier/${slug}`).expect(200);

    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.headers['x-robots-tag']).toContain('index');
    expect(response.headers['cache-control']).toBe(
      'public, max-age=60, s-maxage=300, stale-while-revalidate=60'
    );
    expect(response.text).toContain(
      `<link rel="canonical" href="https://event-flow.co.uk/supplier/${slug}">`
    );
    expect(response.text).toContain('<meta name="ef-public-supplier-id" content="supplier-123">');
    expect(response.text).toContain('<script src="/assets/js/supplier-route-context.js"></script>');
    expect(response.text).toContain('id="supplier-structured-data"');
    expect(response.text).toContain('id="supplier-hero"');
  });

  test('serves legacy businessName suppliers with supplier-specific metadata', async () => {
    const legacySupplier = {
      ...approvedSupplier,
      name: undefined,
      businessName: 'Dragon Events Wales',
      description_short: undefined,
      descriptionShort: 'Legacy supplier profile description.',
    };
    const { app } = createApp({
      suppliers: [legacySupplier],
      users: [{ id: 'user-1' }],
    });
    const slug = buildPublicSupplierSlug(legacySupplier);

    const response = await request(app).get(`/supplier/${slug}`).expect(200);

    expect(slug).toMatch(/^dragon-events-wales--[a-f0-9]{16}$/);
    expect(response.text).toContain('Dragon Events Wales | Photography | EventFlow');
    expect(response.text).toContain('Legacy supplier profile description.');
  });

  test('does not apply the shared 100-request API limiter to indexable supplier HTML', async () => {
    const { app, dbUnified } = createApp({
      suppliers: [approvedSupplier],
      users: [{ id: 'user-1' }],
    });
    const slug = buildPublicSupplierSlug(approvedSupplier);

    for (let index = 0; index < 105; index += 1) {
      await request(app).get(`/supplier/${slug}`).expect(200);
    }

    expect(dbUnified.read).toHaveBeenCalledTimes(2);
  });

  test('rejects malformed public slugs before reading supplier data', async () => {
    const { app, dbUnified } = createApp({
      suppliers: [approvedSupplier],
      users: [{ id: 'user-1' }],
    });

    const response = await request(app).get('/supplier/not-a-public-profile').expect(404);

    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(dbUnified.read).not.toHaveBeenCalled();
  });

  test('redirects an outdated display-name slug to the current canonical slug', async () => {
    const { app } = createApp({
      suppliers: [approvedSupplier],
      users: [{ id: 'user-1' }],
    });
    const canonical = buildPublicSupplierSlug(approvedSupplier);
    const token = canonical.split('--')[1];

    const response = await request(app)
      .get(`/supplier/old-name--${token}?utm_source=google&preview=true`)
      .expect(301);

    expect(response.headers.location).toBe(`/supplier/${canonical}?utm_source=google`);
  });

  test('does not index missing, unapproved, unnamed or orphaned suppliers', async () => {
    const orphan = { ...approvedSupplier, id: 'orphan', ownerUserId: 'missing-user' };
    const unapproved = { ...approvedSupplier, id: 'pending', approved: false };
    const unnamed = {
      ...approvedSupplier,
      id: 'unnamed',
      name: undefined,
      businessName: undefined,
      company: undefined,
    };
    const { app } = createApp({
      suppliers: [orphan, unapproved, unnamed],
      users: [{ id: 'user-1' }],
    });

    for (const candidate of [orphan, unapproved, unnamed]) {
      const response = await request(app)
        .get(`/supplier/${buildPublicSupplierSlug(candidate)}`)
        .expect(404);
      expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    }
  });
});
