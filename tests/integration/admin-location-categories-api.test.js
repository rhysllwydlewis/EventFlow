/**
 * City × category pages admin API: a direct, one-level-deeper mirror of the
 * city editor's access control, publication workflow and quality gate.
 */

'use strict';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-key-for-testing-only-minimum-32-characters-long';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const jwt = require('jsonwebtoken');

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
  uid: () => `id-${store.size}-${Math.random().toString(16).slice(2)}`,
  read: jest.fn(async collection => mockDb.all(collection)),
  find: jest.fn(async collection => mockDb.all(collection)),
  findOne: jest.fn(async (collection, filter) => {
    const entries = Object.entries(filter || {});
    return (
      mockDb.all(collection).find(item => entries.every(([key, value]) => item[key] === value)) ||
      null
    );
  }),
  insertOne: jest.fn(async (collection, record) => {
    store.set(collection, [...mockDb.all(collection), { ...record }]);
    return true;
  }),
  updateOne: jest.fn(async (collection, filter, update) => {
    const entries = Object.entries(filter || {});
    store.set(
      collection,
      mockDb
        .all(collection)
        .map(item =>
          entries.every(([key, value]) => item[key] === value) ? { ...item, ...update } : item
        )
    );
    return true;
  }),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../middleware/rateLimits', () => {
  const passthrough = (req, res, next) => next();
  return { apiLimiter: passthrough, publicReadLimiter: passthrough, writeLimiter: passthrough };
});
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (req, res, next) => next() }));

const adminLocationRoutes = require('../../routes/admin-locations');
const { LIMITS } = require('../../models/LocationContent');

const admin = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
const customer = { id: 'user-9', email: 'user@example.com', role: 'customer' };

/**
 * Build a signed auth cookie for a user.
 * @param {Object} user User record.
 * @returns {string} Cookie header value.
 */
function authCookie(user) {
  return `token=${jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
}

/**
 * Build the test app.
 * @returns {Object} Express app.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/admin/locations', adminLocationRoutes);
  return app;
}

/**
 * An approved supplier based in Cardiff.
 * @param {string} id Supplier id.
 * @param {string} category Category.
 * @returns {Object} Supplier record.
 */
function supplier(id, category) {
  return {
    id,
    name: `Supplier ${id}`,
    category,
    approved: true,
    ownerUserId: 'user-1',
    baseLocation: { citySlug: 'cardiff' },
  };
}

beforeEach(() => {
  mockDb.reset();
  mockDb.seed('users', [{ id: 'user-1' }, admin, customer]);
  mockDb.seed('suppliers', [
    supplier('v1', 'Venues'),
    supplier('v2', 'Venues'),
    supplier('v3', 'Venues'),
    supplier('v4', 'Venues'),
  ]);
  mockDb.seed('packages', []);
  mockDb.seed('public_calendar_events', []);
  mockDb.seed('location_pages', []);
  mockDb.seed('location_category_pages', []);
  mockDb.seed('audit_logs', []);
});

describe('access control', () => {
  it('refuses an anonymous caller', async () => {
    const response = await request(buildApp()).get('/api/v1/admin/locations/cardiff/categories');
    expect(response.status).toBe(401);
  });

  it('refuses a non-admin caller', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/cardiff/categories')
      .set('Cookie', authCookie(customer));
    expect(response.status).toBe(403);
  });
});

describe('GET /:slug/categories', () => {
  it('lists a category the city has real supplier coverage in', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/cardiff/categories')
      .set('Cookie', authCookie(admin));
    expect(response.status).toBe(200);
    expect(response.body.data.items.map(item => item.categorySlug)).toContain('venues');
    const venues = response.body.data.items.find(item => item.categorySlug === 'venues');
    expect(venues.supplierCount).toBe(4);
    expect(venues.status).toBe('draft');
  });

  it('keeps a category with an existing record visible even after its suppliers disappear', async () => {
    mockDb.seed('suppliers', []);
    mockDb.seed('location_category_pages', [
      { locationSlug: 'cardiff', categorySlug: 'venues', status: 'published', managedBy: 'admin' },
    ]);
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/cardiff/categories')
      .set('Cookie', authCookie(admin));
    expect(response.body.data.items.map(item => item.categorySlug)).toContain('venues');
  });

  it('404s for an unknown city', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/atlantis/categories')
      .set('Cookie', authCookie(admin));
    expect(response.status).toBe(404);
  });
});

describe('GET /:slug/categories/:categorySlug', () => {
  it('reports the quality gate and blockers for a fresh combination', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/cardiff/categories/venues')
      .set('Cookie', authCookie(admin));
    expect(response.status).toBe(200);
    expect(response.body.data.gate.passes).toBe(false);
    expect(response.body.data.previewUrl).toBe('/locations/cardiff/venues');
    expect(response.body.data.draftPreviewUrl).toBe(
      '/api/v1/admin/locations/cardiff/categories/venues/preview'
    );
    expect(response.body.data.limits).toEqual(LIMITS);
  });

  it('404s for an unknown category', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/cardiff/categories/not-a-category')
      .set('Cookie', authCookie(admin));
    expect(response.status).toBe(404);
  });
});

describe('PATCH /:slug/categories/:categorySlug', () => {
  it('creates a new record, marking it admin-managed', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff/categories/venues')
      .set('Cookie', authCookie(admin))
      .send({
        status: 'published',
        content: {
          intro: 'A hand-written introduction to Cardiff venues.',
          planningSections: [{ title: 'Booking timeline', body: 'Book six months ahead.' }],
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('published');
    expect(response.body.data.managedBy).toBe('admin');
    expect(response.body.data.content.intro).toBe('A hand-written introduction to Cardiff venues.');

    const stored = mockDb
      .all('location_category_pages')
      .find(row => row.locationSlug === 'cardiff' && row.categorySlug === 'venues');
    expect(stored).toBeTruthy();
    expect(stored.status).toBe('published');
    expect(stored.publishedAt).toBeTruthy();
  });

  it('rejects an unknown publication status', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff/categories/venues')
      .set('Cookie', authCookie(admin))
      .send({ status: 'not-a-real-status' });
    expect(response.status).toBe(400);
  });

  it('marks a page reviewed only as an explicit action, not a side effect', async () => {
    await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff/categories/venues')
      .set('Cookie', authCookie(admin))
      .send({ content: { intro: 'First save.' } });

    const secondSave = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff/categories/venues')
      .set('Cookie', authCookie(admin))
      .send({ content: { intro: 'Second save, still not reviewed.' } });
    expect(secondSave.body.data.lastReviewedAt).toBeFalsy();

    const reviewed = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff/categories/venues')
      .set('Cookie', authCookie(admin))
      .send({ markReviewed: true });
    expect(reviewed.body.data.lastReviewedAt).toBeTruthy();
    expect(reviewed.body.data.reviewedBy).toBe(admin.email);
  });

  it('writes an audit log entry tagged as a category page, not a city page', async () => {
    await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff/categories/venues')
      .set('Cookie', authCookie(admin))
      .send({ status: 'published' });

    const entry = mockDb
      .all('audit_logs')
      .find(row => row.action === 'location_category_page_updated');
    expect(entry).toBeTruthy();
    expect(entry.targetType).toBe('location_category_page');
    expect(entry.details.categorySlug).toBe('venues');
  });

  it('refuses a non-admin caller', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff/categories/venues')
      .set('Cookie', authCookie(customer))
      .send({ status: 'published' });
    expect(response.status).toBe(403);
  });
});

describe('GET /:slug/categories/:categorySlug/preview', () => {
  it('renders a draft combination that the public route would 404', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/cardiff/categories/venues/preview')
      .set('Cookie', authCookie(admin));
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.text).toContain('Admin preview');
    expect(response.text).toContain('not reachable by the public');
  });
});
