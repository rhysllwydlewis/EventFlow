/**
 * Server-rendered location pages: status codes, redirects, headers, metadata
 * and the difference between "reachable" and "indexable".
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
 * A page record that clears the quality gate.
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
    content: {
      intro: `A human-written introduction to planning an event in ${slug}.`,
      planningSections: [
        { title: 'Where to look first', body: 'Practical, reviewed local guidance.' },
      ],
      faqs: [{ question: 'Do suppliers travel?', answer: 'Many do; each card says so.' }],
    },
    ...overrides,
  };
}

/** Eight suppliers across four categories: enough to pass the gate. */
const strongInventory = [
  supplier('s1', 'cardiff'),
  supplier('s2', 'cardiff', { category: 'Catering' }),
  supplier('s3', 'cardiff', { category: 'Photography' }),
  supplier('s4', 'cardiff', { category: 'Entertainment' }),
  supplier('s5', 'cardiff', { category: 'Florist' }),
  supplier('s6', 'cardiff', { category: 'Cake' }),
  supplier('s7', 'cardiff', { category: 'Transport' }),
  supplier('s8', 'cardiff', { category: 'Decor' }),
];

beforeEach(() => {
  mockDb.reset();
  mockPexelsService.isConfigured.mockReturnValue(false);
  mockPexelsService.searchPhotos.mockReset();
  locationHeroImages.resetAutomaticHeroCache();
  locationRoutes.__internal.resetLocationDataCache();
  mockDb.seed('users', [{ id: 'user-1', email: 'owner@example.com' }]);
  mockDb.seed('suppliers', strongInventory);
  mockDb.seed('supplierAnalytics', []);
  mockDb.seed('packages', [{ id: 'pkg-1', supplierId: 's1', name: 'Winter package' }]);
  mockDb.seed('public_calendar_events', []);
  mockDb.seed('location_pages', [pageRecord('cardiff'), pageRecord('newport')]);
});

describe('GET /locations', () => {
  it('returns 200 with server-rendered, crawlable city links', async () => {
    const response = await request(buildApp()).get('/locations');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('<h1>Event suppliers across the UK</h1>');
    expect(response.text).toContain('class="efl-hero efl-hero--hub"');
    expect(response.text).toContain('class="efl-hub-visual"');
    expect(response.text).toContain('class="efl-card efl-city-card"');
    expect(response.text).toContain('href="/locations/cardiff"');
    expect(response.text).toContain('href="/locations/newport"');
  });

  it('lists only published cities', async () => {
    mockDb.seed('location_pages', [
      pageRecord('cardiff'),
      pageRecord('bristol', { status: 'draft' }),
    ]);
    const response = await request(buildApp()).get('/locations');
    expect(response.text).toContain('href="/locations/cardiff"');
    expect(response.text).not.toContain('href="/locations/bristol"');
  });

  it('groups cities by nation with a real heading structure', async () => {
    const response = await request(buildApp()).get('/locations');
    expect(response.text).toContain('Browse by nation');
    expect(response.text).toContain('<h3>Wales</h3>');
  });

  it('hides a supplier count rather than publishing zero', async () => {
    mockDb.seed('suppliers', []);
    const response = await request(buildApp()).get('/locations');
    expect(response.text).not.toContain('0 suppliers');
  });

  it('is not indexable while no city page is published', async () => {
    mockDb.seed('location_pages', []);
    const response = await request(buildApp()).get('/locations');
    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, follow');
  });
});

describe('GET /api/v1/locations/featured', () => {
  it('lists only published cities with real supplier coverage, most-covered first', async () => {
    const response = await request(buildApp()).get('/api/v1/locations/featured');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const slugs = response.body.data.cities.map(city => city.slug);
    // Newport is published but has no seeded suppliers, so it earns no place —
    // a homepage shortcut that leads to an empty city is worse than none.
    expect(slugs).toEqual(['cardiff']);
    expect(response.body.data.cities[0]).toEqual(
      expect.objectContaining({ slug: 'cardiff', name: 'Cardiff', supplierCount: 8 })
    );
  });

  it('never lists a draft city, however much coverage it has', async () => {
    mockDb.seed('location_pages', [pageRecord('cardiff', { status: 'draft' })]);
    const response = await request(buildApp()).get('/api/v1/locations/featured');
    expect(response.body.data.cities).toEqual([]);
  });

  it('caps the list at the requested limit, itself capped at 12', async () => {
    const response = await request(buildApp()).get('/api/v1/locations/featured?limit=1');
    expect(response.body.data.cities).toHaveLength(1);
  });
});

describe('GET /locations/:citySlug', () => {
  it('returns 200 for a published city with full metadata', async () => {
    // The hero is set explicitly, because an editor choosing one is the only
    // way a photograph reaches a public page.
    const curated = require('../../services/locationHeroImage.service').getCuratedHero('cardiff');
    const record = pageRecord('cardiff');
    mockDb.seed('location_pages', [
      { ...record, content: { ...record.content, heroImageUrl: curated.url } },
      pageRecord('newport'),
    ]);

    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.status).toBe(200);
    expect(response.text).toContain('<h1>Event suppliers in Cardiff</h1>');
    expect(response.text).toContain('class="efl-hero efl-hero--city"');
    expect(response.text).toContain('class="efl-card__avatar"');
    expect(response.text).toContain('class="efl-planning__grid"');
    expect(response.text).toContain(
      '<link rel="canonical" href="https://event-flow.co.uk/locations/cardiff" />'
    );
    expect(response.text).toMatch(/<meta name="description" content="[^"]+" \/>/);
    expect(response.text).toContain('/photos/5743996/pexels-photo-5743996.jpeg');
    expect(response.text).toContain('alt="Cardiff Bay waterfront');
    expect(response.text).toContain('Photo by');
    expect(response.text).toContain('Balazs Bezeczky');
    expect(response.text).toContain(' on Pexels');
    expect(response.text).toContain(
      '<meta property="og:image" content="https://images.pexels.com/'
    );
    expect(response.text).toContain(
      '<meta name="twitter:image" content="https://images.pexels.com/'
    );
    expect(response.text).toContain('BreadcrumbList');
    expect(response.text).toContain('aria-label="Breadcrumb"');
  });

  it('links to helpful planning guides relevant to the suppliers actually on the page', async () => {
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).toContain('id="efl-guides"');
    expect(response.text).toContain('Helpful planning guides');
  });

  it('omits the guides module for a city with no supplier categories yet', async () => {
    const response = await request(buildApp()).get('/locations/newport');
    expect(response.text).not.toContain('id="efl-guides"');
  });

  it('does not mislabel a non-Pexels editorial source as Pexels', async () => {
    const record = pageRecord('cardiff');
    record.content = {
      ...record.content,
      heroSource: 'custom',
      heroImageUrl: 'https://cdn.example.com/cardiff.jpg',
      heroImageAlt: 'A local view of Cardiff',
      heroImageCredit: 'City Photographer',
      heroImageSourceUrl: 'https://example.com/cardiff-photo',
    };
    mockDb.seed('location_pages', [record]);

    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).toContain('>City Photographer</a>');
    expect(response.text).not.toContain('City Photographer on Pexels');
  });

  it('server-renders a city-specific Pexels hero for an uncurated registry city', async () => {
    mockPexelsService.isConfigured.mockReturnValue(true);
    mockPexelsService.searchPhotos.mockResolvedValue({
      photos: [
        {
          id: 456,
          width: 1800,
          height: 1200,
          url: 'https://www.pexels.com/photo/london-river-skyline-456/',
          photographer: 'London Photographer',
          alt: 'London skyline beside the River Thames',
          src: {
            landscape: 'https://images.pexels.com/photos/456/london-456.jpeg?w=1200',
          },
        },
      ],
    });
    mockDb.seed('location_pages', [pageRecord('london')]);

    const response = await request(buildApp()).get('/locations/london');

    expect(response.status).toBe(200);
    expect(response.text).toContain('images.pexels.com/photos/456/london-456.jpeg');
    expect(response.text).toContain('alt="London skyline beside the River Thames"');
    expect(response.text).toContain('London Photographer');
    expect(response.text).toContain(' on Pexels');
    expect(response.text).toContain('<meta property="og:image"');
  });

  it('links to supplier profiles with their relationship labels', async () => {
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).toContain('Based in Cardiff');
    expect(response.text).toMatch(/href="\/supplier\/supplier-s1--[a-f0-9]{16}"/);
  });

  it('redirects an alias permanently to the canonical slug', async () => {
    const response = await request(buildApp()).get('/locations/caerdydd');
    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/locations/cardiff');
  });

  it('redirects a differently-cased slug permanently', async () => {
    const response = await request(buildApp()).get('/locations/Cardiff');
    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/locations/cardiff');
  });

  it('returns a real 404 for an unknown slug, not a soft 404', async () => {
    const response = await request(buildApp()).get('/locations/atlantis');
    expect(response.status).toBe(404);
    expect(response.text).not.toContain('Event suppliers in');
    expect(response.headers['x-robots-tag']).toBe('noindex, follow');
  });

  it('returns 404 for a draft city, so unfinished work is unreachable', async () => {
    mockDb.seed('location_pages', [pageRecord('cardiff', { status: 'draft' })]);
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.status).toBe(404);
  });

  it('serves a pilot page as reachable but never indexable', async () => {
    mockDb.seed('location_pages', [pageRecord('cardiff', { status: 'pilot' })]);
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, follow');
    expect(response.text).toContain('<meta name="robots" content="noindex,follow" />');
    expect(response.text).toContain('in pilot');
  });

  it('serves index, follow only when the gate passes', async () => {
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.headers['x-robots-tag']).toBe('index, follow, max-image-preview:large');
    expect(response.text).toContain('content="index,follow,max-image-preview:large"');
  });

  it('drops to noindex when a published page fails the gate', async () => {
    mockDb.seed('suppliers', [supplier('s1', 'cardiff')]);
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, follow');
  });

  it('omits modules with nothing to show', async () => {
    mockDb.seed('suppliers', []);
    mockDb.seed('packages', []);
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).not.toContain('Packages from');
    expect(response.text).not.toContain('Public events near');
    expect(response.text).toContain('still building');
  });

  it('links only to nearby cities that are published', async () => {
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).toContain('href="/locations/newport"');
    expect(response.text).not.toContain('href="/locations/swansea"');
  });

  it('escapes editorial content rather than trusting it as markup', async () => {
    mockDb.seed('location_pages', [
      pageRecord('cardiff', {
        content: {
          intro: '<script>alert(1)</script>',
          planningSections: [],
          faqs: [],
        },
      }),
    ]);
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).not.toContain('<script>alert(1)</script>');
    expect(response.text).toContain('&lt;script&gt;');
  });

  it('renders copy containing a dollar sign literally', async () => {
    // `String.replace` with a string replacement treats `$&` and friends as
    // back-references, which would splice the placeholder back into the page.
    mockDb.seed('location_pages', [
      pageRecord('cardiff', {
        content: {
          intro: 'Budgets here run $& upwards, per $` head.',
          planningSections: [],
          faqs: [],
        },
      }),
    ]);
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).toContain('Budgets here run $&amp; upwards, per $` head.');
    expect(response.text).not.toContain('LOCATIONS_CONTENT');
  });

  it('carries the analytics dimensions without any personal data', async () => {
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).toContain('<meta name="ef-page-type" content="location_city" />');
    expect(response.text).toContain('<meta name="ef-location-slug" content="cardiff" />');
    expect(response.text).toContain('data-relationship="based_in"');
  });

  it('excludes suspended and unapproved suppliers from the page', async () => {
    mockDb.seed('suppliers', [
      ...strongInventory,
      supplier('hidden-1', 'cardiff', { approved: false, name: 'Unapproved Co' }),
      supplier('hidden-2', 'cardiff', { status: 'suspended', name: 'Suspended Co' }),
    ]);
    const response = await request(buildApp()).get('/locations/cardiff');
    expect(response.text).not.toContain('Unapproved Co');
    expect(response.text).not.toContain('Suspended Co');
  });
});

describe('GET /locations/:citySlug/:categorySlug (unpublished)', () => {
  it('404s for a category with no editorial record — a draft by default', async () => {
    const response = await request(buildApp()).get('/locations/cardiff/venues');
    expect(response.status).toBe(404);
    expect(response.headers['x-robots-tag']).toBe('noindex, follow');
  });

  it('404s for an unrecognised category slug', async () => {
    const response = await request(buildApp()).get('/locations/cardiff/not-a-real-category');
    expect(response.status).toBe(404);
  });

  it('404s for an unknown city slug', async () => {
    const response = await request(buildApp()).get('/locations/atlantis/venues');
    expect(response.status).toBe(404);
  });
});

// Deeper coverage of the published/indexable path — redirects, cross-links,
// the category-scoped gate and guides — lives in
// tests/integration/locations-category-pages.test.js.
