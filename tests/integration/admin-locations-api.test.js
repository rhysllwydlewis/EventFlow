/**
 * Location pages admin API: access control, publication workflow, the quality
 * gate it reports and the editorial warnings it raises.
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
    supplier('s1', 'Venues'),
    supplier('s2', 'Catering'),
    supplier('s3', 'Photography'),
    supplier('s4', 'Entertainment'),
    supplier('s5', 'Florist'),
    supplier('s6', 'Cake'),
    supplier('s7', 'Transport'),
    supplier('s8', 'Decor'),
  ]);
  mockDb.seed('packages', []);
  mockDb.seed('public_calendar_events', []);
  mockDb.seed('location_pages', []);
  mockDb.seed('audit_logs', []);
});

describe('access control', () => {
  it('refuses an anonymous caller', async () => {
    const response = await request(buildApp()).get('/api/v1/admin/locations');
    expect(response.status).toBe(401);
  });

  it('refuses a signed-in non-admin', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations')
      .set('Cookie', authCookie(customer));
    expect(response.status).toBe(403);
  });
});

describe('GET /api/v1/admin/locations', () => {
  it('lists every registry city with its state and gate', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations')
      .set('Cookie', authCookie(admin));

    expect(response.status).toBe(200);
    expect(response.body.data.items.length).toBeGreaterThan(20);
    const cardiff = response.body.data.items.find(item => item.slug === 'cardiff');
    expect(cardiff.status).toBe('draft');
    expect(cardiff.indexable).toBe(false);
    expect(cardiff.gate.blockers).toContain('page is not published');
    expect(cardiff.supplierCount).toBe(8);
  });

  it('filters by publication state', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations?status=published')
      .set('Cookie', authCookie(admin));
    expect(response.body.data.items).toEqual([]);
    expect(response.body.data.summary.total).toBeGreaterThan(20);
  });
});

describe('GET /api/v1/admin/locations/:slug', () => {
  it('returns one city with a preview URL', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin));
    expect(response.status).toBe(200);
    expect(response.body.data.previewUrl).toBe('/locations/cardiff');
  });

  it('accepts an alias and answers for the canonical city', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/caerdydd')
      .set('Cookie', authCookie(admin));
    expect(response.status).toBe(200);
    expect(response.body.data.slug).toBe('cardiff');
  });

  it('404s for an unknown city', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/atlantis')
      .set('Cookie', authCookie(admin));
    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/v1/admin/locations/:slug', () => {
  it('saves editorial content and records the change', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({
        status: 'pilot',
        content: { intro: 'Cardiff has a deep bench of venues and caterers.' },
        seo: { title: 'Event Suppliers in Cardiff | EventFlow' },
      });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('pilot');
    expect(response.body.data.content.intro).toContain('deep bench');
    expect(mockDb.all('location_pages')).toHaveLength(1);
    expect(mockDb.all('audit_logs')[0].action).toBe('location_page_updated');
  });

  it('rejects an unrecognised publication state', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ status: 'live-ish' });
    expect(response.status).toBe(400);
    expect(mockDb.all('location_pages')).toEqual([]);
  });

  it('does not make a page indexable on the publish flag alone', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ status: 'published', indexingRequested: true });

    expect(response.body.data.status).toBe('published');
    expect(response.body.data.indexable).toBe(false);
    expect(response.body.data.gate.blockers).toContain('page has no local introduction');
  });

  it('reaches indexable once content, review and inventory are all in place', async () => {
    const app = buildApp();
    await request(app)
      .patch('/api/v1/admin/locations/newport')
      .set('Cookie', authCookie(admin))
      .send({ status: 'published' });

    const response = await request(app)
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({
        status: 'published',
        indexingRequested: true,
        markReviewed: true,
        content: {
          intro: 'A genuine, human-written introduction to booking suppliers in Cardiff.',
          planningSections: [{ title: 'City centre or the Bay', body: 'Reviewed local guidance.' }],
        },
      });

    expect(response.body.data.indexable).toBe(true);
    expect(response.body.data.gate.blockers).toEqual([]);
    expect(response.body.data.reviewedBy).toBe('admin@example.com');
    expect(response.body.data.lastReviewedAt).toBeTruthy();
  });

  it('stamps publishedAt on publish and clears it when unpublished', async () => {
    const app = buildApp();
    const published = await request(app)
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ status: 'published' });
    expect(published.body.data.publishedAt).toBeTruthy();

    const retired = await request(app)
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ status: 'retired' });
    expect(retired.body.data.publishedAt).toBeNull();
  });

  it('does not mark a page reviewed as a side effect of an ordinary save', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ content: { intro: 'A small typo fix.' } });
    expect(response.body.data.lastReviewedAt).toBeNull();
  });

  it('warns when two cities share the same copy', async () => {
    const app = buildApp();
    const intro = 'Exactly the same introduction on two different city pages.';
    await request(app)
      .patch('/api/v1/admin/locations/bristol')
      .set('Cookie', authCookie(admin))
      .send({ content: { intro } });

    const response = await request(app)
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ content: { intro } });

    expect(response.body.data.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/Introduction is identical to Bristol/)])
    );
  });

  it('warns when copy differs from another city only by the city name', async () => {
    const app = buildApp();
    await request(app)
      .patch('/api/v1/admin/locations/bristol')
      .set('Cookie', authCookie(admin))
      .send({ content: { intro: 'Find the best event suppliers in Bristol today.' } });

    const response = await request(app)
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ content: { intro: 'Find the best event suppliers in Cardiff today.' } });

    expect(response.body.data.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/only by the city name/)])
    );
  });

  it('warns when a section quotes figures without a source', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({
        content: {
          planningSections: [
            { title: 'Typical prices', body: 'Venues here average 3,500 pounds.' },
          ],
        },
      });

    expect(response.body.data.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/without a source/)])
    );
  });

  it('caps and trims editor input rather than storing it raw', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({
        seo: { title: 'x'.repeat(400) },
        content: {
          intro: `  spaced   out  `,
          faqs: [
            { question: 'Q', answer: 'A' },
            { question: '', answer: 'dropped' },
          ],
        },
      });

    expect(response.body.data.seo.title).toHaveLength(70);
    expect(response.body.data.content.intro).toBe('spaced out');
    expect(response.body.data.content.faqs).toEqual([{ question: 'Q', answer: 'A' }]);
  });
});
