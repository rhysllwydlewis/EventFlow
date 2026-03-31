/**
 * Tests for marketplace geo/distance filter
 * Covers: lat/lng/radius filtering in GET /api/v1/marketplace/listings
 * and the GET /api/v1/marketplace/geocode-postcode endpoint
 */

const request = require('supertest');
const express = require('express');

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

// Cardiff centre: 51.4816, -3.1791
// London (approx): 51.5074, -0.1278
// Edinburgh (approx): 55.9533, -3.1883

const LISTINGS = [
  {
    id: 'mkt_cardiff',
    userId: 'usr_1',
    title: 'Wedding Arch Cardiff',
    description: 'Beautiful arch',
    price: 100,
    category: 'decor',
    condition: 'good',
    location: 'Cardiff',
    locationCoordinates: { lat: 51.4816, lng: -3.1791 },
    approved: true,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'mkt_london',
    userId: 'usr_2',
    title: 'Floral Centrepieces London',
    description: 'Set of 10',
    price: 250,
    category: 'florals',
    condition: 'like-new',
    location: 'London',
    locationCoordinates: { lat: 51.5074, lng: -0.1278 },
    approved: true,
    status: 'active',
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'mkt_edinburgh',
    userId: 'usr_3',
    title: 'Vintage Candleholders Edinburgh',
    description: 'Set of 20',
    price: 50,
    category: 'decor',
    condition: 'fair',
    location: 'Edinburgh',
    locationCoordinates: { lat: 55.9533, lng: -3.1883 },
    approved: true,
    status: 'active',
    createdAt: '2026-01-03T00:00:00.000Z',
  },
  {
    id: 'mkt_nocoords',
    userId: 'usr_4',
    title: 'No-location item',
    description: 'Has no stored coordinates',
    price: 30,
    category: 'party-supplies',
    condition: 'new',
    location: '',
    approved: true,
    status: 'active',
    createdAt: '2026-01-04T00:00:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// Mock dbUnified
// ---------------------------------------------------------------------------

const mockDbUnified = {
  getDatabaseType: jest.fn(() => 'local'),
  read: jest.fn(async collection => {
    if (collection === 'marketplace_listings') {
      return [...LISTINGS];
    }
    if (collection === 'suppliers') {
      return [];
    }
    return [];
  }),
  findWithOptions: jest.fn(async (collection, _filter, _opts) => {
    if (collection === 'marketplace_listings') {
      return [...LISTINGS];
    }
    return [];
  }),
};

// ---------------------------------------------------------------------------
// Mock geocoding utility
// ---------------------------------------------------------------------------

jest.mock('../../utils/geocoding', () => ({
  geocodeLocation: jest.fn(async location => {
    const map = {
      'CF10 1AA': { latitude: 51.4816, longitude: -3.1791 },
      Cardiff: { latitude: 51.4816, longitude: -3.1791 },
      'SW1A 1AA': { latitude: 51.5014, longitude: -0.1419 },
      London: { latitude: 51.5074, longitude: -0.1278 },
    };
    return map[location] || null;
  }),
  calculateDistance: jest.fn((lat1, lng1, lat2, lng2) => {
    // Real Haversine (miles)
    const R = 3958.8;
    const toRad = d => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }),
  isValidUKPostcode: jest.fn(() => true),
}));

// ---------------------------------------------------------------------------
// Create test Express app using the actual marketplace router
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());

  const marketplaceRoutes = require('../../routes/marketplace');

  const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const sentry = { captureException: jest.fn() };

  marketplaceRoutes.initializeDependencies({
    dbUnified: mockDbUnified,
    authRequired: (_req, _res, next) => next(),
    csrfProtection: (_req, _res, next) => next(),
    writeLimiter: (_req, _res, next) => next(),
    uid: prefix => `${prefix}_test_${Date.now()}`,
    logger,
    sentry,
  });

  app.use('/api/v1/marketplace', marketplaceRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Tests: GET /api/v1/marketplace/listings — geo filter
// ---------------------------------------------------------------------------

describe('GET /api/v1/marketplace/listings — geo/distance filter', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  it('returns all listings when no geo params provided', async () => {
    const res = await request(app).get('/api/v1/marketplace/listings');
    expect(res.status).toBe(200);
    // Includes all 4 fixtures (all approved + active)
    expect(res.body.listings).toHaveLength(4);
  });

  it('filters to nearby listings when lat/lng/radius are provided (Cardiff, 50 miles)', async () => {
    // Cardiff centre lat/lng; 50 miles covers Cardiff and London is ~150 miles away
    const res = await request(app)
      .get('/api/v1/marketplace/listings')
      .query({ lat: 51.4816, lng: -3.1791, radius: 50 });

    expect(res.status).toBe(200);
    const ids = res.body.listings.map(l => l.id);

    // Cardiff listing should be included (distance = 0)
    expect(ids).toContain('mkt_cardiff');
    // London listing should NOT be included (~150 miles away)
    expect(ids).not.toContain('mkt_london');
    // Edinburgh listing should NOT be included (~290 miles away)
    expect(ids).not.toContain('mkt_edinburgh');
    // Listing with no coordinates should be included (graceful degradation)
    expect(ids).toContain('mkt_nocoords');
  });

  it('includes listing without coordinates regardless of radius (graceful degradation)', async () => {
    const res = await request(app)
      .get('/api/v1/marketplace/listings')
      .query({ lat: 51.4816, lng: -3.1791, radius: 1 }); // 1 mile — very tight

    expect(res.status).toBe(200);
    const ids = res.body.listings.map(l => l.id);
    expect(ids).toContain('mkt_nocoords');
  });

  it('includes all listings with coordinates within large radius', async () => {
    // 500 miles from London should cover all of UK
    const res = await request(app)
      .get('/api/v1/marketplace/listings')
      .query({ lat: 51.5074, lng: -0.1278, radius: 500 });

    expect(res.status).toBe(200);
    const ids = res.body.listings.map(l => l.id);
    expect(ids).toContain('mkt_cardiff');
    expect(ids).toContain('mkt_london');
    expect(ids).toContain('mkt_edinburgh');
    expect(ids).toContain('mkt_nocoords');
  });

  it('geo filter still works alongside category filter', async () => {
    const res = await request(app)
      .get('/api/v1/marketplace/listings')
      .query({ lat: 51.4816, lng: -3.1791, radius: 50, category: 'decor' });

    expect(res.status).toBe(200);
    const ids = res.body.listings.map(l => l.id);
    expect(ids).toContain('mkt_cardiff');
    // London florals should be excluded (wrong category + out of range)
    expect(ids).not.toContain('mkt_london');
  });

  it('ignores geo filter when radius is 0', async () => {
    const res = await request(app)
      .get('/api/v1/marketplace/listings')
      .query({ lat: 51.4816, lng: -3.1791, radius: 0 });

    expect(res.status).toBe(200);
    // radius=0 means filter is not applied (guard: radiusMiles > 0)
    expect(res.body.listings).toHaveLength(4);
  });

  it('ignores geo filter when lat or lng are missing', async () => {
    const res = await request(app).get('/api/v1/marketplace/listings').query({ radius: 50 }); // missing lat/lng

    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/v1/marketplace/geocode-postcode
// ---------------------------------------------------------------------------

describe('GET /api/v1/marketplace/geocode-postcode', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  it('returns 400 when postcode query param is missing', async () => {
    const res = await request(app).get('/api/v1/marketplace/geocode-postcode');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when postcode is blank', async () => {
    const res = await request(app)
      .get('/api/v1/marketplace/geocode-postcode')
      .query({ postcode: '  ' });
    expect(res.status).toBe(400);
  });

  it('returns lat/lng for a known postcode', async () => {
    const res = await request(app)
      .get('/api/v1/marketplace/geocode-postcode')
      .query({ postcode: 'CF10 1AA' });

    expect(res.status).toBe(200);
    expect(res.body.latitude).toBeCloseTo(51.4816, 2);
    expect(res.body.longitude).toBeCloseTo(-3.1791, 2);
  });

  it('returns 404 for an unknown postcode', async () => {
    const { geocodeLocation } = require('../../utils/geocoding');
    geocodeLocation.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/v1/marketplace/geocode-postcode')
      .query({ postcode: 'ZZ99 9ZZ' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
