'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
}));
jest.mock('../../sitemap', () => ({
  generateSitemap: jest.fn().mockResolvedValue('<urlset></urlset>'),
  generateRobotsTxt: jest.fn().mockReturnValue('User-agent: *'),
}));
jest.mock('../../middleware/rateLimits', () => ({
  authLimiter: (_req, _res, next) => next(),
  apiLimiter: (_req, _res, next) => next(),
}));
jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));
jest.mock('../../utils/sentry', () => ({
  captureException: jest.fn(),
}));

const dbUnified = require('../../db-unified');
const staticRoutes = require('../../routes/static');
const { buildPublicPackageSlug } = require('../../services/publicListingSeo.service');

const categories = [
  { id: 'cat-venues', slug: 'venues', name: 'Venues', order: 1 },
  { id: 'cat-catering', slug: 'catering', name: 'Catering', order: 2 },
  { id: 'cat-hair-makeup', slug: 'hair-makeup', name: 'Hair & Makeup', order: 3 },
];

const pkg = {
  id: 'pkg-regression-1',
  supplierId: 'supplier-1',
  approved: true,
  title: 'Full Day Wedding Photography',
  slug: 'full-day-wedding-photography-pkg1',
  description: 'Natural wedding photography.',
  price: '£1,250',
  image: '/uploads/package.jpg',
};
const packageSupplier = {
  id: 'supplier-1',
  ownerUserId: 'user-1',
  approved: true,
  name: 'Cwm Valley Events',
};

function createApp() {
  const app = express();
  app.use(staticRoutes);
  app.use((req, res) => res.status(204).set('X-Fell-Through', req.path).send());
  return app;
}

function setData(data) {
  dbUnified.read.mockImplementation(async collection => data[collection] || []);
}

describe('legacy category canonical redirect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each(['/category', '/category.html'])(
    '%s?slug=venues redirects to /suppliers?category=Venues in a single hop',
    async path => {
      setData({ categories });

      const response = await request(createApp()).get(`${path}?slug=venues`).expect(301);

      expect(response.headers.location).toBe('/suppliers?category=Venues');
    }
  );

  test('is case-insensitive and preserves other query parameters', async () => {
    setData({ categories });

    const response = await request(createApp())
      .get('/category?slug=CATERING&location=Cardiff')
      .expect(301);

    const location = new URL(response.headers.location, 'https://event-flow.co.uk');
    expect(location.pathname).toBe('/suppliers');
    expect(location.searchParams.get('category')).toBe('Catering');
    expect(location.searchParams.get('location')).toBe('Cardiff');
  });

  test('resolves a slug that is not a simple case of its name (Hair & Makeup)', async () => {
    setData({ categories });

    const response = await request(createApp()).get('/category?slug=hair-makeup').expect(301);

    const location = new URL(response.headers.location, 'https://event-flow.co.uk');
    expect(location.pathname).toBe('/suppliers');
    expect(location.searchParams.get('category')).toBe('Hair & Makeup');
  });

  test('an already-canonical category name passed as slug still resolves', async () => {
    setData({ categories });

    const response = await request(createApp()).get('/category?slug=Venues').expect(301);

    expect(response.headers.location).toBe('/suppliers?category=Venues');
  });

  test('an unknown slug redirects to the neutral unfiltered /suppliers page, not a soft-404 shell', async () => {
    setData({ categories });

    const response = await request(createApp())
      .get('/category?slug=not-a-real-category')
      .expect(301);

    expect(response.headers.location).toBe('/suppliers');
  });

  test('a bare /category with no slug redirects to plain /suppliers', async () => {
    setData({ categories: [] });

    const response = await request(createApp()).get('/category').expect(301);

    expect(response.headers.location).toBe('/suppliers');
  });

  test('falls back to plain /suppliers when the category lookup fails', async () => {
    dbUnified.read.mockRejectedValue(new Error('database unavailable'));

    const response = await request(createApp()).get('/category?slug=venues').expect(301);

    expect(response.headers.location).toBe('/suppliers');
  });

  // Regression: the /category fix must not disturb the already-correct
  // /package?slug= redirect, which the SEO audit confirmed works and asked
  // to be preserved untouched.
  test('regression: /package?slug= still redirects to its clean canonical URL unchanged', async () => {
    setData({ packages: [pkg], suppliers: [packageSupplier], users: [{ id: 'user-1' }] });
    const slug = buildPublicPackageSlug(pkg);

    const response = await request(createApp())
      .get(`/package?slug=${pkg.slug}&utm_source=newsletter`)
      .expect(301);

    expect(response.headers.location).toBe(`/package/${slug}?utm_source=newsletter`);
  });
});
