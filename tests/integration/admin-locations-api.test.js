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

  it('surfaces the automatic introduction when no editor has written one', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin));
    expect(response.body.data.content.intro).toBe('');
    expect(response.body.data.automaticIntro).toContain('Cardiff');
    expect(response.body.data.automaticIntro).toContain('8');
  });

  it('has no automatic introduction to show once an editor has written one', async () => {
    await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ content: { intro: 'A human-written introduction.' } });

    const response = await request(buildApp())
      .get('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin));
    expect(response.body.data.automaticIntro).toBeNull();
  });

  it('has no automatic introduction for a city with no suppliers yet', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/bristol')
      .set('Cookie', authCookie(admin));
    expect(response.body.data.automaticIntro).toBeNull();
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

  it('rejects an unrecognised hero source', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ content: { heroSource: 'manual-upload' } });
    expect(response.status).toBe(400);
    expect(mockDb.all('location_pages')).toEqual([]);
  });

  it('defaults a new page to the automatic hero source', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ content: { intro: 'A short local introduction.' } });
    expect(response.body.data.content.heroSource).toBe('auto');
  });

  it('saves and preserves an explicit custom hero source across an unrelated edit', async () => {
    const app = buildApp();
    const first = await request(app)
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({
        content: {
          heroSource: 'custom',
          heroImageUrl: 'https://cdn.example.com/cardiff.jpg',
          heroImageAlt: 'Cardiff Bay at dusk',
        },
      });
    expect(first.body.data.content.heroSource).toBe('custom');

    const second = await request(app)
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ content: { intro: 'A short local introduction.' } });
    expect(second.body.data.content.heroSource).toBe('custom');
    expect(second.body.data.content.heroImageUrl).toBe('https://cdn.example.com/cardiff.jpg');
  });

  it('does not make a page indexable on the publish flag alone', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ status: 'published', indexingRequested: true });

    expect(response.body.data.status).toBe('published');
    expect(response.body.data.indexable).toBe(false);
    // Real inventory earns the page an automatically composed introduction, so
    // the human-review signal is the blocker left standing: indexing still
    // needs a person to have looked at the page, not just real suppliers on it.
    expect(response.body.data.gate.blockers).toContain('page has never been reviewed by a human');
    expect(response.body.data.gate.blockers).not.toContain('page has no local introduction');
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

describe('field limits', () => {
  it('reports the limits the API enforces, so the editor cannot drift from them', async () => {
    const list = await request(buildApp())
      .get('/api/v1/admin/locations')
      .set('Cookie', authCookie(admin));
    const single = await request(buildApp())
      .get('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin));

    expect(list.body.data.limits).toEqual(LIMITS);
    expect(single.body.data.limits).toEqual(LIMITS);
  });
});

describe('editorial saves and the workflow', () => {
  /**
   * Put Cardiff into a known published, indexing-requested, reviewed state.
   * @param {Object} app Express app.
   * @returns {Promise<Object>} The resulting record.
   */
  async function publishCardiff(app) {
    const response = await request(app)
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ status: 'published', indexingRequested: true, markReviewed: true });
    return response.body.data;
  }

  it('leaves publication state, indexing and review alone when only content is sent', async () => {
    const app = buildApp();
    const before = await publishCardiff(app);

    const after = await request(app)
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({
        seo: { title: 'Event suppliers in Cardiff', metaDescription: 'Reviewed local guidance.' },
        content: {
          intro: 'A fresh introduction, written by a human who knows the city.',
          heroImageUrl: 'https://cdn.example.com/cardiff.jpg',
          heroImageAlt: 'Cardiff Bay at dusk',
          heroImageCredit: 'Balazs Bezeczky',
          heroImageSourceUrl: 'https://www.pexels.com/photo/cardiff-bay-5743996/',
          planningSections: [
            {
              title: 'Where to look first',
              body: 'Practical local guidance.',
              sourceName: 'Cardiff Council',
              sourceUrl: 'https://cardiff.gov.uk',
              sourceDate: 'March 2026',
            },
          ],
          faqs: [{ question: 'Do suppliers travel?', answer: 'Many do.' }],
        },
      });

    expect(after.status).toBe(200);
    expect(after.body.data.status).toBe('published');
    expect(after.body.data.indexingRequested).toBe(true);
    expect(after.body.data.lastReviewedAt).toBe(before.lastReviewedAt);
    expect(after.body.data.reviewedBy).toBe(before.reviewedBy);
    expect(after.body.data.publishedAt).toBe(before.publishedAt);
  });

  it('stores every editorial field the editor offers', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({
        seo: { title: 'Cardiff suppliers', metaDescription: 'What to know before you book.' },
        content: {
          heroImageUrl: 'https://cdn.example.com/cardiff.jpg',
          heroImageAlt: 'Cardiff Bay at dusk',
          heroImageCredit: 'Balazs Bezeczky',
          heroImageSourceUrl: 'https://www.pexels.com/photo/cardiff-bay-5743996/',
          intro: 'Written locally.',
          planningSections: [
            {
              title: 'Venues',
              body: 'Two paragraphs.\n\nThe second one.',
              sourceName: 'Cardiff Council',
              sourceUrl: 'https://cardiff.gov.uk',
              sourceDate: 'March 2026',
            },
          ],
          faqs: [{ question: 'How far ahead?', answer: 'Six months for a Saturday.' }],
        },
      });

    const content = response.body.data.content;
    expect(response.body.data.seo).toEqual({
      title: 'Cardiff suppliers',
      metaDescription: 'What to know before you book.',
    });
    expect(content.heroImageUrl).toBe('https://cdn.example.com/cardiff.jpg');
    expect(content.heroImageAlt).toBe('Cardiff Bay at dusk');
    expect(content.heroImageCredit).toBe('Balazs Bezeczky');
    expect(content.heroImageSourceUrl).toBe('https://www.pexels.com/photo/cardiff-bay-5743996/');
    expect(content.planningSections[0]).toEqual({
      title: 'Venues',
      body: 'Two paragraphs.\n\nThe second one.',
      sourceName: 'Cardiff Council',
      sourceUrl: 'https://cardiff.gov.uk',
      sourceDate: 'March 2026',
    });
    expect(content.faqs).toEqual([
      { question: 'How far ahead?', answer: 'Six months for a Saturday.' },
    ]);
  });

  it('keeps the sections in the order the editor arranged them', async () => {
    const response = await request(buildApp())
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({
        content: {
          planningSections: [
            { title: 'Third', body: 'c' },
            { title: 'First', body: 'a' },
            { title: 'Second', body: 'b' },
          ],
        },
      });

    expect(response.body.data.content.planningSections.map(section => section.title)).toEqual([
      'Third',
      'First',
      'Second',
    ]);
  });
});

describe('GET /api/v1/admin/locations/:slug/preview', () => {
  it('renders a draft page without making it public', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/cardiff/preview')
      .set('Cookie', authCookie(admin));

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).toContain('<h1>Event suppliers in Cardiff</h1>');
    expect(response.text).toContain('Admin preview');
    expect(response.text).toContain('not reachable by the public');
  });

  it('never marks a preview indexable, even for a page that would pass the gate', async () => {
    const app = buildApp();
    await request(app)
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ status: 'published', indexingRequested: true, markReviewed: true });

    const response = await request(app)
      .get('/api/v1/admin/locations/cardiff/preview')
      .set('Cookie', authCookie(admin));

    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.text).toContain('<meta name="robots" content="noindex,follow" />');
  });

  it('shows unsaved-state copy in the preview once content is saved', async () => {
    const app = buildApp();
    await request(app)
      .patch('/api/v1/admin/locations/cardiff')
      .set('Cookie', authCookie(admin))
      .send({ content: { intro: 'A draft introduction nobody else can see yet.' } });

    const response = await request(app)
      .get('/api/v1/admin/locations/cardiff/preview')
      .set('Cookie', authCookie(admin));

    expect(response.text).toContain('A draft introduction nobody else can see yet.');
  });

  it('404s for an unknown city', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/atlantis/preview')
      .set('Cookie', authCookie(admin));
    expect(response.status).toBe(404);
  });

  it('refuses a non-admin', async () => {
    const response = await request(buildApp())
      .get('/api/v1/admin/locations/cardiff/preview')
      .set('Cookie', authCookie(customer));
    expect(response.status).toBe(403);
  });
});
