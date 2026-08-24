/**
 * Server-rendered category directory pages: status codes, redirects, headers
 * and the difference between "reachable" and "indexable".
 */

'use strict';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-key-for-testing-only-minimum-32-characters-long';

const express = require('express');
const request = require('supertest');

const store = new Map();

const mockDb = {
  reset() {
    store.clear();
  },
  seed(collection, records) {
    store.set(
      collection,
      records.map(record => ({ ...record }))
    );
  },
  all(collection) {
    return store.get(collection) || [];
  },
  read: jest.fn(async collection => mockDb.all(collection)),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../middleware/rateLimits', () => {
  const passthrough = (req, res, next) => next();
  return { apiLimiter: passthrough, publicReadLimiter: passthrough, writeLimiter: passthrough };
});

const categoryDirectoryRoutes = require('../../routes/category-directory');

/**
 * Build a test app that mounts the category directory routes and a 404 fallback.
 * @returns {Object} Express app.
 */
function buildApp() {
  const app = express();
  app.use(categoryDirectoryRoutes);
  app.use((req, res) => res.status(404).send('<h1>Not found</h1>'));
  return app;
}

/**
 * An approved, eligible supplier in a given category.
 * @param {string} id Supplier id.
 * @param {string} category Canonical category name.
 * @param {Object} overrides Extra fields.
 * @returns {Object} Supplier record.
 */
function supplier(id, category, overrides = {}) {
  return {
    id,
    name: `Supplier ${id}`,
    category,
    approved: true,
    ownerUserId: 'user-1',
    ...overrides,
  };
}

const user = { id: 'user-1' };

beforeEach(() => {
  mockDb.reset();
  mockDb.seed('users', [user]);
  mockDb.seed('packages', []);
});

describe('GET /categories/:categorySlug', () => {
  it('is reachable but noindex when below the supplier threshold', async () => {
    mockDb.seed('suppliers', [supplier('1', 'Venues'), supplier('2', 'Venues')]);
    const response = await request(buildApp()).get('/categories/venues');
    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, follow');
    expect(response.text).toMatch(/content="noindex,follow"/);
  });

  it('is indexable with a self-referencing canonical once there is real inventory', async () => {
    mockDb.seed('suppliers', [
      supplier('1', 'Venues'),
      supplier('2', 'Venues'),
      supplier('3', 'Venues'),
    ]);
    const response = await request(buildApp()).get('/categories/venues');
    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('index, follow, max-image-preview:large');
    expect(response.text).toContain('href="https://event-flow.co.uk/categories/venues"');
    expect(response.text).toContain('<h1>Venues suppliers across the UK</h1>');
    expect(response.text).toMatch(/<meta name="description" content="[^"]+" \/>/);
    expect(response.text).toContain('"@type":"CollectionPage"');
  });

  it('never surfaces an unapproved or test-fixture supplier', async () => {
    mockDb.seed('suppliers', [
      supplier('1', 'Venues'),
      supplier('2', 'Venues', { approved: false }),
      supplier('3', 'Venues', { name: 'test-no2-yy7lo4' }),
    ]);
    const response = await request(buildApp()).get('/categories/venues');
    expect(response.headers['x-robots-tag']).toBe('noindex, follow');
    expect(response.text).not.toContain('Supplier 2');
    expect(response.text).not.toContain('test-no2-yy7lo4');
  });

  it('redirects a non-canonical slug spelling to the canonical one', async () => {
    mockDb.seed('suppliers', []);
    const response = await request(buildApp()).get('/categories/Venues');
    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/categories/venues');
  });

  it('falls through to the 404 handler for an unrecognised category', async () => {
    mockDb.seed('suppliers', []);
    const response = await request(buildApp()).get('/categories/not-a-real-category');
    expect(response.status).toBe(404);
  });
});

describe('GET /categories', () => {
  it('is noindex when no category currently has enough suppliers', async () => {
    mockDb.seed('suppliers', [supplier('1', 'Venues')]);
    const response = await request(buildApp()).get('/categories');
    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, follow');
  });

  it('lists every populated category, most-covered first', async () => {
    mockDb.seed('suppliers', [
      supplier('1', 'Venues'),
      supplier('2', 'Venues'),
      supplier('3', 'Venues'),
      supplier('4', 'Catering'),
    ]);
    const response = await request(buildApp()).get('/categories');
    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('index, follow, max-image-preview:large');
    expect(response.text).toContain('href="/categories/venues"');
    expect(response.text).toContain('href="/categories/catering"');
    expect(response.text.indexOf('/categories/venues')).toBeLessThan(
      response.text.indexOf('/categories/catering')
    );
  });
});
