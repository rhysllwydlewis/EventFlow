/**
 * Marketplace listing creation and editing: deriving and keeping a city
 * mapping in step with the listing's own location text.
 */

'use strict';

const request = require('supertest');
const express = require('express');

const LISTINGS = new Map();

const mockDbUnified = {
  getDatabaseType: jest.fn(() => 'local'),
  read: jest.fn(async collection => {
    if (collection === 'marketplace_listings') {
      return [...LISTINGS.values()];
    }
    if (collection === 'suppliers') {
      return [];
    }
    return [];
  }),
  findOne: jest.fn(async (collection, filter) => {
    if (collection !== 'marketplace_listings') {
      return null;
    }
    return LISTINGS.get(filter.id) || null;
  }),
  insertOne: jest.fn(async (collection, record) => {
    if (collection === 'marketplace_listings') {
      LISTINGS.set(record.id, { ...record });
    }
    return record;
  }),
  updateOne: jest.fn(async (collection, filter, update) => {
    if (collection !== 'marketplace_listings') {
      return true;
    }
    const existing = LISTINGS.get(filter.id);
    if (!existing) {
      return false;
    }
    const merged = { ...existing, ...(update.$set || update) };
    LISTINGS.set(filter.id, merged);
    return true;
  }),
};

jest.mock('../../utils/geocoding', () => ({
  geocodeLocation: jest.fn(async location => {
    const map = {
      Cardiff: { latitude: 51.4816, longitude: -3.1791 },
      Newport: { latitude: 51.5877, longitude: -2.9984 },
    };
    return map[location] || null;
  }),
  calculateDistance: jest.requireActual('../../utils/geocoding').calculateDistance,
  isValidUKPostcode: jest.requireActual('../../utils/geocoding').isValidUKPostcode,
}));

/**
 * Build a test app mounting the real marketplace router.
 * @returns {Object} Express app.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());

  const marketplaceRoutes = require('../../routes/marketplace');
  const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const sentry = { captureException: jest.fn() };

  marketplaceRoutes.initializeDependencies({
    dbUnified: mockDbUnified,
    authRequired: (req, _res, next) => {
      req.user = { id: 'user-1', role: 'customer' };
      next();
    },
    requireVerifiedUser: (_req, _res, next) => next(),
    csrfProtection: (_req, _res, next) => next(),
    writeLimiter: (_req, _res, next) => next(),
    uid: prefix => `${prefix}_${LISTINGS.size}`,
    logger,
    sentry,
  });

  app.use('/api/v1/marketplace', marketplaceRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  LISTINGS.clear();
});

describe('POST /listings — city mapping on create', () => {
  it('derives a citySlug from a geocodable location', async () => {
    const app = createTestApp();
    const res = await request(app).post('/api/v1/marketplace/listings').send({
      title: 'Wedding arch',
      description: 'Lightly used',
      price: 50,
      category: 'decor',
      condition: 'good',
      location: 'Cardiff',
    });

    expect(res.status).toBe(200);
    expect(res.body.listing.citySlug).toBe('cardiff');
    expect(res.body.listing.citySlugSource).toBeTruthy();
    expect(res.body.listing.citySlugConfidence).toBe('high');
  });

  it('leaves citySlug unset for a listing with no location', async () => {
    const app = createTestApp();
    const res = await request(app).post('/api/v1/marketplace/listings').send({
      title: 'Wedding arch',
      description: 'Lightly used',
      price: 50,
      category: 'decor',
      condition: 'good',
    });

    expect(res.status).toBe(200);
    expect(res.body.listing.citySlug).toBeUndefined();
  });

  it('leaves citySlug unmapped for location text that names no registry city, rather than guessing', async () => {
    const app = createTestApp();
    const res = await request(app).post('/api/v1/marketplace/listings').send({
      title: 'Wedding arch',
      description: 'Lightly used',
      price: 50,
      category: 'decor',
      condition: 'good',
      location: 'Somewhere lovely',
    });

    expect(res.status).toBe(200);
    expect(res.body.listing.citySlug).toBeUndefined();
  });
});

describe('PUT /listings/:id — city mapping stays in step with edits', () => {
  async function createListing(app, location) {
    const res = await request(app).post('/api/v1/marketplace/listings').send({
      title: 'Wedding arch',
      description: 'Lightly used',
      price: 50,
      category: 'decor',
      condition: 'good',
      location,
    });
    return res.body.listing;
  }

  it('re-derives the citySlug when the location text changes', async () => {
    const app = createTestApp();
    const created = await createListing(app, 'Cardiff');
    expect(created.citySlug).toBe('cardiff');

    const res = await request(app)
      .put(`/api/v1/marketplace/listings/${created.id}`)
      .send({ location: 'Newport' });

    expect(res.status).toBe(200);
    expect(res.body.listing.citySlug).toBe('newport');
  });

  it('costs no re-derivation when an edit does not touch the location', async () => {
    const app = createTestApp();
    const created = await createListing(app, 'Cardiff');
    mockDbUnified.updateOne.mockClear();

    const res = await request(app)
      .put(`/api/v1/marketplace/listings/${created.id}`)
      .send({ title: 'Wedding arch, now with lights' });

    expect(res.status).toBe(200);
    expect(res.body.listing.citySlug).toBe('cardiff');
  });

  it('clears the mapping when the new location resolves to nothing', async () => {
    const app = createTestApp();
    const created = await createListing(app, 'Cardiff');

    const res = await request(app)
      .put(`/api/v1/marketplace/listings/${created.id}`)
      .send({ location: 'Somewhere lovely' });

    expect(res.status).toBe(200);
    expect(res.body.listing.citySlug).toBeNull();
  });
});
