/**
 * The "Marketplace finds" module on a city page: real listings only, omitted
 * entirely when there is nothing eligible to show.
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

function buildApp() {
  const app = express();
  app.use(locationRoutes);
  app.use((req, res) => res.status(404).send('<h1>Not found</h1>'));
  return app;
}

function supplier(id, citySlug) {
  return {
    id,
    name: `Supplier ${id}`,
    category: 'Venues',
    approved: true,
    ownerUserId: 'user-1',
    baseLocation: { citySlug, source: 'postcode_lookup', confidence: 'high' },
  };
}

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

function listing(id, overrides = {}) {
  return {
    id,
    userId: 'user-2',
    title: `Listing ${id}`,
    description: 'A marketplace item.',
    price: 20,
    category: 'decor',
    condition: 'good',
    approved: true,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Eight suppliers across four categories: enough to pass the city gate. */
const strongInventory = [
  supplier('s1', 'cardiff'),
  { ...supplier('s2', 'cardiff'), category: 'Catering' },
  { ...supplier('s3', 'cardiff'), category: 'Photography' },
  { ...supplier('s4', 'cardiff'), category: 'Entertainment' },
  { ...supplier('s5', 'cardiff'), category: 'Florist' },
  { ...supplier('s6', 'cardiff'), category: 'Cake' },
  { ...supplier('s7', 'cardiff'), category: 'Transport' },
  { ...supplier('s8', 'cardiff'), category: 'Decor' },
];

beforeEach(() => {
  mockDb.reset();
  mockPexelsService.isConfigured.mockReturnValue(false);
  locationHeroImages.resetAutomaticHeroCache();
  locationRoutes.__internal.resetLocationDataCache();
  mockDb.seed('users', [{ id: 'user-1' }]);
  mockDb.seed('suppliers', strongInventory);
  mockDb.seed('supplierAnalytics', []);
  mockDb.seed('packages', []);
  mockDb.seed('public_calendar_events', []);
  mockDb.seed('location_pages', [pageRecord('cardiff')]);
  mockDb.seed('location_category_pages', []);
  mockDb.seed('marketplace_listings', []);
});

describe('GET /locations/:citySlug — marketplace module', () => {
  it('shows an in-city listing, linking to its listing page', async () => {
    mockDb.seed('marketplace_listings', [
      listing('mkt_1', { citySlug: 'cardiff', title: 'Wedding arch' }),
    ]);
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.status).toBe(200);
    expect(response.text).toContain('id="efl-marketplace"');
    expect(response.text).toContain('Marketplace finds in Cardiff');
    expect(response.text).toContain('Wedding arch');
    expect(response.text).toContain('href="/marketplace?listing=mkt_1"');
    expect(response.text).toContain('Listed in Cardiff');
  });

  it('omits the module entirely when there is nothing eligible, rather than showing an empty shelf', async () => {
    mockDb.seed('marketplace_listings', [
      listing('mkt_unapproved', { citySlug: 'cardiff', approved: false }),
      listing('mkt_sold', { citySlug: 'cardiff', status: 'sold' }),
      listing('mkt_elsewhere', { citySlug: 'edinburgh' }),
    ]);
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).not.toContain('id="efl-marketplace"');
    expect(response.text).not.toContain('Marketplace finds in');
  });

  it('shows a nearby listing with its distance label', async () => {
    // Newport is ~10.5 miles from Cardiff, well inside its 25-mile radius.
    mockDb.seed('marketplace_listings', [
      listing('mkt_near', {
        location: 'Newport',
        locationCoordinates: { lat: 51.5877, lng: -2.9984 },
        title: 'Vintage candelabra',
      }),
    ]);
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).toContain('Vintage candelabra');
    expect(response.text).toMatch(/\d+ miles from Cardiff/);
  });

  it('lists in-city listings ahead of nearby ones', async () => {
    mockDb.seed('marketplace_listings', [
      listing('mkt_near', {
        location: 'Newport',
        locationCoordinates: { lat: 51.5877, lng: -2.9984 },
        title: 'Nearby item',
        createdAt: '2026-02-01T00:00:00.000Z',
      }),
      listing('mkt_here', {
        citySlug: 'cardiff',
        title: 'Local item',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ]);
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text.indexOf('Local item')).toBeLessThan(response.text.indexOf('Nearby item'));
  });

  it('never shows a listing from an unrelated city', async () => {
    mockDb.seed('marketplace_listings', [
      listing('mkt_far', { citySlug: 'edinburgh', title: 'Edinburgh item' }),
    ]);
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).not.toContain('Edinburgh item');
  });
});
