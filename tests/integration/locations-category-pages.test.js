/**
 * Server-rendered city × category pages: status codes, redirects, headers,
 * cross-links and the category-scoped quality gate.
 */

'use strict';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-key-for-testing-only-minimum-32-characters-long';

const express = require('express');
const request = require('supertest');

const mockPexelsService = {
  isConfigured: jest.fn(() => false),
  searchPhotos: jest.fn(),
};

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
  find: jest.fn(async collection => mockDb.all(collection)),
  findOne: jest.fn(async () => null),
  insertOne: jest.fn(async () => true),
  updateOne: jest.fn(async () => true),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../middleware/rateLimits', () => {
  const passthrough = (req, res, next) => next();
  return { apiLimiter: passthrough, publicReadLimiter: passthrough, writeLimiter: passthrough };
});
jest.mock('../../utils/pexels-service', () => ({
  getPexelsService: () => mockPexelsService,
}));

const locationHeroImages = require('../../services/locationHeroImage.service');
const locationRoutes = require('../../routes/locations');

/**
 * Build a test app that mounts the location routes and a 404 fallback.
 * @returns {Object} Express app.
 */
function buildApp() {
  const app = express();
  app.use(locationRoutes);
  app.use((req, res) => res.status(404).send('<h1>Not found</h1>'));
  return app;
}

/**
 * An approved supplier based in a city.
 * @param {string} id Supplier id.
 * @param {string} citySlug City slug.
 * @param {Object} overrides Extra fields.
 * @returns {Object} Supplier record.
 */
function supplier(id, citySlug, overrides = {}) {
  return {
    id,
    name: `Supplier ${id}`,
    category: 'Venues',
    approved: true,
    ownerUserId: 'user-1',
    baseLocation: { citySlug, source: 'postcode_lookup', confidence: 'high' },
    ...overrides,
  };
}

/**
 * A city page record that clears the city-level quality gate.
 * @param {string} slug City slug.
 * @param {Object} overrides Extra fields.
 * @returns {Object} Location page record.
 */
function pageRecord(slug, overrides = {}) {
  return {
    locationSlug: slug,
    status: 'published',
    indexingRequested: true,
    lastReviewedAt: new Date().toISOString(),
    reviewedBy: 'editor@example.com',
    updatedAt: '2026-07-01T00:00:00.000Z',
    content: { intro: `A human-written introduction to ${slug}.`, planningSections: [], faqs: [] },
    ...overrides,
  };
}

/**
 * A category page record that clears the category-level quality gate.
 * @param {string} citySlug City slug.
 * @param {string} categorySlug Category slug.
 * @param {Object} overrides Extra fields.
 * @returns {Object} Location category page record.
 */
function categoryPageRecord(citySlug, categorySlug, overrides = {}) {
  return {
    locationSlug: citySlug,
    categorySlug,
    status: 'published',
    indexingRequested: true,
    lastReviewedAt: new Date().toISOString(),
    reviewedBy: 'editor@example.com',
    updatedAt: '2026-07-01T00:00:00.000Z',
    content: {
      intro: `A human-written introduction to ${categorySlug} in ${citySlug}.`,
      planningSections: [{ title: 'Booking timeline', body: 'Guidance written by a human.' }],
      faqs: [],
    },
    ...overrides,
  };
}

/** Four venue suppliers in Cardiff: enough to pass the category gate. */
const strongVenueInventory = [
  supplier('v1', 'cardiff', { category: 'Venues' }),
  supplier('v2', 'cardiff', { category: 'Venues' }),
  supplier('v3', 'cardiff', { category: 'Venues' }),
  supplier('v4', 'cardiff', { category: 'Venues' }),
];

beforeEach(() => {
  mockDb.reset();
  mockPexelsService.isConfigured.mockReturnValue(false);
  mockPexelsService.searchPhotos.mockReset();
  locationHeroImages.resetAutomaticHeroCache();
  locationRoutes.__internal.resetLocationDataCache();
  mockDb.seed('users', [{ id: 'user-1', email: 'owner@example.com' }]);
  mockDb.seed('suppliers', strongVenueInventory);
  mockDb.seed('supplierAnalytics', []);
  mockDb.seed('packages', []);
  mockDb.seed('public_calendar_events', []);
  mockDb.seed('location_pages', [pageRecord('cardiff'), pageRecord('newport')]);
  mockDb.seed('location_category_pages', [categoryPageRecord('cardiff', 'venues')]);
});

describe('GET /locations/:citySlug/:categorySlug', () => {
  it('returns 200 for a published, indexable combination', async () => {
    const response = await request(buildApp()).get('/locations/cardiff/venues');
    expect(response.status).toBe(200);
    expect(response.text).toContain('<h1>Venues in Cardiff</h1>');
    expect(response.headers['x-robots-tag']).toBe('index, follow, max-image-preview:large');
    expect(response.text).toContain(
      '<link rel="canonical" href="https://event-flow.co.uk/locations/cardiff/venues" />'
    );
  });

  it('filters the supplier list to just this category', async () => {
    mockDb.seed('suppliers', [
      ...strongVenueInventory,
      supplier('c1', 'cardiff', { category: 'Catering' }),
    ]);
    const response = await request(buildApp()).get('/locations/cardiff/venues');
    expect(response.text).toContain('data-supplier-id="v1"');
    expect(response.text).not.toContain('data-supplier-id="c1"');
  });

  it('carries its own breadcrumb trail including the category', async () => {
    const response = await request(buildApp()).get('/locations/cardiff/venues');
    expect(response.text).toContain('aria-label="Breadcrumb"');
    expect(response.text).toContain('>Venues</span>');
    expect(response.text).toContain('href="/locations/cardiff"');
  });

  it('redirects an alias city spelling to the canonical URL', async () => {
    const response = await request(buildApp()).get('/locations/caerdydd/venues');
    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/locations/cardiff/venues');
  });

  it('redirects a legacy category spelling to the canonical slug', async () => {
    const response = await request(buildApp()).get('/locations/cardiff/Venues');
    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/locations/cardiff/venues');
  });

  it('404s for an unknown category', async () => {
    const response = await request(buildApp()).get('/locations/cardiff/not-a-category');
    expect(response.status).toBe(404);
  });

  it('404s for a draft combination, so unfinished work is unreachable', async () => {
    mockDb.seed('location_category_pages', [
      categoryPageRecord('cardiff', 'venues', { status: 'draft' }),
    ]);
    const response = await request(buildApp()).get('/locations/cardiff/venues');
    expect(response.status).toBe(404);
  });

  it('serves a pilot combination as reachable but never indexable', async () => {
    mockDb.seed('location_category_pages', [
      categoryPageRecord('cardiff', 'venues', { status: 'pilot' }),
    ]);
    const response = await request(buildApp()).get('/locations/cardiff/venues');
    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, follow');
    expect(response.text).toContain('in pilot');
  });

  it('drops to noindex when a published combination fails its own gate', async () => {
    mockDb.seed('suppliers', [supplier('v1', 'cardiff', { category: 'Venues' })]);
    const response = await request(buildApp()).get('/locations/cardiff/venues');
    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, follow');
  });

  it('shows "still building" copy rather than a 404 when the category has since lost all its suppliers', async () => {
    mockDb.seed('suppliers', []);
    const response = await request(buildApp()).get('/locations/cardiff/venues');
    expect(response.status).toBe(200);
    expect(response.text).toContain('still building');
    expect(response.text).toContain('See every supplier in Cardiff');
  });

  it('links to a sibling category page only once that page is published too', async () => {
    mockDb.seed('suppliers', [
      ...strongVenueInventory,
      supplier('c1', 'cardiff', { category: 'Catering' }),
    ]);
    const withoutSibling = await request(buildApp()).get('/locations/cardiff/venues');
    expect(withoutSibling.text).not.toContain('href="/locations/cardiff/catering"');

    mockDb.seed('location_category_pages', [
      categoryPageRecord('cardiff', 'venues'),
      categoryPageRecord('cardiff', 'catering'),
    ]);
    locationRoutes.__internal.resetLocationDataCache();
    const withSibling = await request(buildApp()).get('/locations/cardiff/venues');
    expect(withSibling.text).toContain('href="/locations/cardiff/catering"');
  });

  it('links to the same category in a nearby city only once that page is published', async () => {
    mockDb.seed('suppliers', [
      ...strongVenueInventory,
      supplier('n1', 'newport', { category: 'Venues' }),
    ]);
    const withoutNearby = await request(buildApp()).get('/locations/cardiff/venues');
    expect(withoutNearby.text).not.toContain('href="/locations/newport/venues"');

    mockDb.seed('location_category_pages', [
      categoryPageRecord('cardiff', 'venues'),
      categoryPageRecord('newport', 'venues'),
    ]);
    locationRoutes.__internal.resetLocationDataCache();
    const withNearby = await request(buildApp()).get('/locations/cardiff/venues');
    expect(withNearby.text).toContain('href="/locations/newport/venues"');
  });

  it('inherits the parent city’s hero image rather than resolving its own', async () => {
    const curated = require('../../services/locationHeroImage.service').getCuratedHero('cardiff');
    const cityRecord = pageRecord('cardiff');
    mockDb.seed('location_pages', [
      { ...cityRecord, content: { ...cityRecord.content, heroImageUrl: curated.url } },
      pageRecord('newport'),
    ]);

    const response = await request(buildApp()).get('/locations/cardiff/venues');
    // The rendered `src` is HTML-escaped (`&` becomes `&amp;`), so match a
    // substring free of query-string separators rather than the raw URL.
    expect(response.text).toContain('/photos/5743996/pexels-photo-5743996.jpeg');
  });

  it('carries its own analytics dimensions, distinct from the city page', async () => {
    const response = await request(buildApp()).get('/locations/cardiff/venues');
    expect(response.text).toContain(
      '<meta name="ef-page-type" content="location_city_category" />'
    );
    expect(response.text).toContain('<meta name="ef-location-slug" content="cardiff" />');
    expect(response.text).toContain('<meta name="ef-category-slug" content="venues" />');
  });

  it('the city page links straight to a published category page instead of a filtered search', async () => {
    mockDb.seed('location_category_pages', [categoryPageRecord('cardiff', 'venues')]);
    locationRoutes.__internal.resetLocationDataCache();
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).toContain('href="/locations/cardiff/venues"');
  });

  it('the city page falls back to a filtered search link for an unpublished category', async () => {
    mockDb.seed('location_category_pages', []);
    locationRoutes.__internal.resetLocationDataCache();
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).toContain('href="/suppliers?category=Venues&location=Cardiff"');
  });
});
