/**
 * Unit tests for the JadeAssist Catalog API (routes/catalog.js)
 *
 * Tests:
 *   - API key authentication (when CATALOG_API_KEY is set)
 *   - Public access (when CATALOG_API_KEY is not set)
 *   - GET /api/catalog/categories
 *   - GET /api/catalog/suppliers (list + filters)
 *   - GET /api/catalog/supplier/:id
 *   - GET /api/catalog/venues (list + capacity filters)
 *   - GET /api/catalog/venue/:id
 *   - Private field stripping
 *   - 404 handling for unknown IDs
 */

'use strict';

const request = require('supertest');
const express = require('express');

// ─── Mock dependencies ────────────────────────────────────────────────────────

// Prevent db-unified from touching the real filesystem / MongoDB in tests
jest.mock('../../db-unified', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));

// Suppress logger noise in test output
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Rate-limiter is a no-op in tests (avoids 429s from repeated calls)
jest.mock('../../middleware/rateLimits', () => ({
  searchLimiter: (_req, _res, next) => next(),
  apiLimiter: (_req, _res, next) => next(),
}));

// Catalog cache is a no-op in tests
jest.mock('../../services/catalogCache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  invalidate: jest.fn().mockResolvedValue(undefined),
  getTtl: jest.fn().mockReturnValue(300),
}));

const dbUnified = require('../../db-unified');
const catalogRouter = require('../../routes/catalog');

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A minimal approved, published supplier. */
const makeSupplier = (overrides = {}) => ({
  id: 'sup_001',
  name: 'Test Supplier',
  category: 'Photography',
  description: 'Great photos',
  location: 'London',
  priceRange: '££',
  logo: 'https://example.com/logo.png',
  coverImage: null,
  images: [],
  amenities: [],
  website: 'https://example.com',
  bookingUrl: null,
  slug: 'test-supplier',
  isPro: false,
  tags: [],
  maxGuests: null,
  responseTime: null,
  viewCount: 10,
  approved: true,
  status: 'published',
  // Private fields (must NOT appear in API responses)
  ownerUserId: 'user_secret_123',
  email: 'owner@private.com',
  phone: '07700900000',
  ...overrides,
});

const makeVenue = (overrides = {}) =>
  makeSupplier({
    id: 'sup_v01',
    name: 'Grand Hall',
    category: 'Venues',
    maxGuests: 200,
    ...overrides,
  });

// ─── App factory ────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/catalog', catalogRouter);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Catalog API — authentication', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    dbUnified.find.mockResolvedValue([]);
    dbUnified.findOne.mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.CATALOG_API_KEY;
  });

  test('allows requests when CATALOG_API_KEY is not set', async () => {
    delete process.env.CATALOG_API_KEY;
    const res = await request(app).get('/api/catalog/categories');
    expect(res.status).toBe(200);
  });

  test('returns 401 when CATALOG_API_KEY is set and header is missing', async () => {
    process.env.CATALOG_API_KEY = 'secret-key-123';
    const res = await request(app).get('/api/catalog/categories');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing or invalid/i);
  });

  test('returns 401 when CATALOG_API_KEY is set and header is wrong', async () => {
    process.env.CATALOG_API_KEY = 'secret-key-123';
    const res = await request(app)
      .get('/api/catalog/categories')
      .set('X-Catalog-Api-Key', 'wrong-key');
    expect(res.status).toBe(401);
  });

  test('allows requests when CATALOG_API_KEY is set and correct key is supplied', async () => {
    process.env.CATALOG_API_KEY = 'secret-key-123';
    const res = await request(app)
      .get('/api/catalog/categories')
      .set('X-Catalog-Api-Key', 'secret-key-123');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/catalog/categories', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    delete process.env.CATALOG_API_KEY;
  });

  test('returns an array of categories', async () => {
    const res = await request(app).get('/api/catalog/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(res.body.categories).toContain('Venues');
    expect(res.body.categories).toContain('Photography');
  });

  test('sets a public cache header', async () => {
    const res = await request(app).get('/api/catalog/categories');
    expect(res.headers['cache-control']).toMatch(/public/);
  });
});

describe('GET /api/catalog/suppliers', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    delete process.env.CATALOG_API_KEY;
  });

  test('returns a list of suppliers with pagination metadata', async () => {
    const suppliers = [makeSupplier(), makeSupplier({ id: 'sup_002', name: 'Another Supplier' })];
    dbUnified.find.mockResolvedValue(suppliers);

    const res = await request(app).get('/api/catalog/suppliers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.suppliers)).toBe(true);
    expect(res.body.total).toBe(2);
    expect(res.body).toHaveProperty('limit');
    expect(res.body).toHaveProperty('offset');
  });

  test('strips private fields from each supplier', async () => {
    dbUnified.find.mockResolvedValue([makeSupplier()]);
    const res = await request(app).get('/api/catalog/suppliers');
    const sup = res.body.suppliers[0];
    expect(sup.ownerUserId).toBeUndefined();
    expect(sup.email).toBeUndefined();
    expect(sup.phone).toBeUndefined();
    // Public field must be present
    expect(sup.name).toBe('Test Supplier');
    expect(sup.id).toBe('sup_001');
  });

  test('respects the limit query param', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      makeSupplier({ id: `sup_${i}`, name: `Supplier ${i}` })
    );
    dbUnified.find.mockResolvedValue(many);

    const res = await request(app).get('/api/catalog/suppliers?limit=5');
    expect(res.body.suppliers.length).toBe(5);
    expect(res.body.limit).toBe(5);
    expect(res.body.total).toBe(30);
  });

  test('respects the offset query param', async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      makeSupplier({ id: `sup_${i}`, name: `Supplier ${String(i).padStart(2, '0')}` })
    );
    dbUnified.find.mockResolvedValue(many);

    const res = await request(app).get('/api/catalog/suppliers?limit=5&offset=5');
    expect(res.body.suppliers.length).toBe(5);
    expect(res.body.offset).toBe(5);
  });

  test('returns 500 on database error', async () => {
    dbUnified.find.mockRejectedValue(new Error('DB down'));
    const res = await request(app).get('/api/catalog/suppliers');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

  test('sets a public cache header', async () => {
    dbUnified.find.mockResolvedValue([]);
    const res = await request(app).get('/api/catalog/suppliers');
    expect(res.headers['cache-control']).toMatch(/public/);
  });
});

describe('GET /api/catalog/supplier/:id', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    delete process.env.CATALOG_API_KEY;
  });

  test('returns the supplier when found', async () => {
    dbUnified.findOne.mockResolvedValue(makeSupplier());
    const res = await request(app).get('/api/catalog/supplier/sup_001');
    expect(res.status).toBe(200);
    expect(res.body.supplier.id).toBe('sup_001');
  });

  test('strips private fields', async () => {
    dbUnified.findOne.mockResolvedValue(makeSupplier());
    const res = await request(app).get('/api/catalog/supplier/sup_001');
    expect(res.body.supplier.ownerUserId).toBeUndefined();
    expect(res.body.supplier.email).toBeUndefined();
  });

  test('returns 404 when supplier not found', async () => {
    dbUnified.findOne.mockResolvedValue(null);
    const res = await request(app).get('/api/catalog/supplier/nope');
    expect(res.status).toBe(404);
  });

  test('returns 500 on database error', async () => {
    dbUnified.findOne.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/api/catalog/supplier/sup_001');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/catalog/venues', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    delete process.env.CATALOG_API_KEY;
  });

  test('returns venues list with pagination metadata', async () => {
    dbUnified.find.mockResolvedValue([makeVenue(), makeVenue({ id: 'sup_v02', name: 'The Barn' })]);
    const res = await request(app).get('/api/catalog/venues');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.venues)).toBe(true);
    expect(res.body.total).toBe(2);
  });

  test('filters by minCapacity', async () => {
    const venues = [
      makeVenue({ id: 'v1', name: 'Small', maxGuests: 50 }),
      makeVenue({ id: 'v2', name: 'Large', maxGuests: 300 }),
    ];
    dbUnified.find.mockResolvedValue(venues);

    const res = await request(app).get('/api/catalog/venues?minCapacity=100');
    expect(res.body.venues.length).toBe(1);
    expect(res.body.venues[0].name).toBe('Large');
  });

  test('filters by maxCapacity', async () => {
    const venues = [
      makeVenue({ id: 'v1', name: 'Small', maxGuests: 50 }),
      makeVenue({ id: 'v2', name: 'Large', maxGuests: 300 }),
    ];
    dbUnified.find.mockResolvedValue(venues);

    const res = await request(app).get('/api/catalog/venues?maxCapacity=100');
    expect(res.body.venues.length).toBe(1);
    expect(res.body.venues[0].name).toBe('Small');
  });

  test('strips private fields', async () => {
    dbUnified.find.mockResolvedValue([makeVenue()]);
    const res = await request(app).get('/api/catalog/venues');
    expect(res.body.venues[0].ownerUserId).toBeUndefined();
    expect(res.body.venues[0].email).toBeUndefined();
  });

  test('returns 500 on database error', async () => {
    dbUnified.find.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/api/catalog/venues');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/catalog/venue/:id', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    delete process.env.CATALOG_API_KEY;
  });

  test('returns the venue when found', async () => {
    dbUnified.findOne.mockResolvedValue(makeVenue());
    const res = await request(app).get('/api/catalog/venue/sup_v01');
    expect(res.status).toBe(200);
    expect(res.body.venue.id).toBe('sup_v01');
  });

  test('returns 404 when venue not found', async () => {
    dbUnified.findOne.mockResolvedValue(null);
    const res = await request(app).get('/api/catalog/venue/nope');
    expect(res.status).toBe(404);
  });
});
