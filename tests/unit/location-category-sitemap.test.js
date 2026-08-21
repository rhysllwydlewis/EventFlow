/**
 * Sitemap gating for city × category pages: a URL is listed only while it is
 * genuinely published, index-requested and passing its own quality gate —
 * never its parent city's.
 */

'use strict';

const store = new Map();

const mockDb = {
  read: jest.fn(async collection => store.get(collection) || []),
};

jest.mock('../../db-unified', () => mockDb);

const { generateSitemap } = require('../../sitemap');

function seed(collection, records) {
  store.set(collection, records);
}

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

function categoryPageRecord(citySlug, categorySlug, overrides = {}) {
  return {
    locationSlug: citySlug,
    categorySlug,
    status: 'published',
    indexingRequested: true,
    lastReviewedAt: new Date().toISOString(),
    updatedAt: '2026-07-01T00:00:00.000Z',
    content: {
      intro: 'Local copy written and reviewed by a person.',
      planningSections: [{ title: 'Booking timeline', body: 'Practical guidance.' }],
      faqs: [],
    },
    ...overrides,
  };
}

function pageRecord(citySlug, overrides = {}) {
  return {
    locationSlug: citySlug,
    status: 'published',
    indexingRequested: true,
    lastReviewedAt: new Date().toISOString(),
    updatedAt: '2026-07-01T00:00:00.000Z',
    content: {
      intro: `A human-written introduction to ${citySlug}.`,
      planningSections: [],
      faqs: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  seed('users', [{ id: 'user-1' }]);
  seed('suppliers', [
    supplier('v1', 'Venues'),
    supplier('v2', 'Venues'),
    supplier('v3', 'Venues'),
    supplier('v4', 'Venues'),
  ]);
  seed('packages', []);
  seed('public_calendar_events', []);
  seed('location_pages', [pageRecord('cardiff')]);
  seed('location_category_pages', [categoryPageRecord('cardiff', 'venues')]);
});

describe('sitemap category entries', () => {
  it('includes an indexable city × category page once its own gate passes', async () => {
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).toContain('<loc>https://event-flow.co.uk/locations/cardiff/venues</loc>');
  });

  it('excludes a category page whose parent city page is not itself published', async () => {
    // Its breadcrumb and every "see the whole city" link point back at the
    // city page — indexing it while that page is still a draft would put a
    // dead link in front of both crawlers and visitors.
    seed('location_pages', [pageRecord('cardiff', { status: 'pilot' })]);
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).not.toContain('/locations/cardiff/venues');
  });

  it('excludes a category page whose editor has not requested indexing', async () => {
    seed('location_category_pages', [
      categoryPageRecord('cardiff', 'venues', { indexingRequested: false }),
    ]);
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).not.toContain('/locations/cardiff/venues');
  });

  it('excludes a category page that fails its own quality gate', async () => {
    seed('suppliers', [supplier('v1', 'Venues')]);
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).not.toContain('/locations/cardiff/venues');
  });

  it('never evaluates a category the city has no suppliers in', async () => {
    seed('location_category_pages', [
      categoryPageRecord('cardiff', 'venues'),
      categoryPageRecord('cardiff', 'catering'),
    ]);
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).toContain('/locations/cardiff/venues');
    expect(xml).not.toContain('/locations/cardiff/catering');
  });

  it('uses the page content date, not the time of generation', async () => {
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).toMatch(/<lastmod>2026-07-01/);
  });
});
