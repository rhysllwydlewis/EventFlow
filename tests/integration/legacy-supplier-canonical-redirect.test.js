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
}));
jest.mock('../../utils/sentry', () => ({
  captureException: jest.fn(),
}));

const dbUnified = require('../../db-unified');
const staticRoutes = require('../../routes/static');
const { buildPublicSupplierSlug } = require('../../services/publicSupplierSeo.service');

const supplier = {
  id: 'supplier-123',
  ownerUserId: 'user-1',
  approved: true,
  name: 'Cwm Valley Photography',
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

describe('legacy supplier canonical redirect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each(['/supplier', '/supplier.html'])(
    'redirects approved public %s links to the clean canonical URL',
    async path => {
      setData({ suppliers: [supplier], users: [{ id: 'user-1' }] });
      const slug = buildPublicSupplierSlug(supplier);

      const response = await request(createApp())
        .get(`${path}?id=supplier-123&utm_source=google&utm_campaign=launch&untrusted=value`)
        .expect(301);

      expect(response.headers.location).toBe(
        `/supplier/${slug}?utm_source=google&utm_campaign=launch`
      );
    }
  );

  test('leaves preview URLs on the existing owner-preview flow', async () => {
    setData({ suppliers: [supplier], users: [{ id: 'user-1' }] });

    const response = await request(createApp())
      .get('/supplier?id=supplier-123&preview=true')
      .expect(204);

    expect(response.headers['x-fell-through']).toBe('/supplier');
    expect(dbUnified.read).not.toHaveBeenCalled();
  });

  test.each([
    [{ ...supplier, approved: false }, [{ id: 'user-1' }]],
    [supplier, []],
  ])('does not redirect a non-public supplier', async (candidate, users) => {
    setData({ suppliers: [candidate], users });

    const response = await request(createApp()).get('/supplier?id=supplier-123').expect(204);

    expect(response.headers['x-fell-through']).toBe('/supplier');
  });

  test('falls through safely when supplier lookup fails', async () => {
    dbUnified.read.mockRejectedValue(new Error('database unavailable'));

    const response = await request(createApp()).get('/supplier?id=supplier-123').expect(204);

    expect(response.headers['x-fell-through']).toBe('/supplier');
  });
});
