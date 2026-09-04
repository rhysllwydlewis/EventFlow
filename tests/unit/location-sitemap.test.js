/**
 * Sitemap gating for city pages: a URL is listed only while it is genuinely
 * published, index-requested and passing the quality gate.
 */

'use strict';

const store = new Map();

const mockDb = {
  read: jest.fn(async collection => store.get(collection) || []),
};

jest.mock('../../db-unified', () => mockDb);

const { generateSitemap } = require('../../sitemap');

/**
 * Seed a collection.
 * @param {string} collection Collection name.
 * @param {Object[]} records Records.
 * @returns {void} Nothing.
 */
function seed(collection, records) {
  store.set(collection, records);
}

/**
 * An approved supplier based in a city.
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

/**
 * A location page record.
 * @param {string} slug City slug.
 * @param {Object} overrides Extra fields.
 * @returns {Object} Record.
 */
function pageRecord(slug, overrides = {}) {
  return {
    locationSlug: slug,
    status: 'published',
    indexingRequested: true,
    lastReviewedAt: new Date().toISOString(),
    updatedAt: '2026-07-01T00:00:00.000Z',
    content: {
      intro: 'Local copy written and reviewed by a person.',
      planningSections: [{ title: 'Getting around', body: 'Practical guidance.' }],
      faqs: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  seed('users', [{ id: 'user-1' }]);
  seed('suppliers', [
    supplier('s1', 'Venues'),
    supplier('s2', 'Catering'),
    supplier('s3', 'Photography'),
    supplier('s4', 'Entertainment'),
    supplier('s5', 'Florist'),
    supplier('s6', 'Cake'),
    supplier('s7', 'Transport'),
    supplier('s8', 'Decor'),
  ]);
  seed('packages', [{ id: 'pkg-1', supplierId: 's1', name: 'Package' }]);
  seed('public_calendar_events', []);
  seed('location_pages', [pageRecord('cardiff'), pageRecord('newport'), pageRecord('bristol')]);
});

describe('sitemap city entries', () => {
  it('includes the hub and each indexable city page', async () => {
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).toContain('<loc>https://event-flow.co.uk/locations</loc>');
    expect(xml).toContain('<loc>https://event-flow.co.uk/locations/cardiff</loc>');
  });

  it('uses the page content date, not the time of generation', async () => {
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).toMatch(/<lastmod>2026-07-01/);

    // The fixture sets `lastReviewedAt` to now and `updatedAt` to 2026-07-01,
    // so a city entry carrying today's date means the sitemap fell back to the
    // review/generation time. Scoped to the location URLs this file is about:
    // a blanket scan also failed whenever an unrelated guide was legitimately
    // updated on the day CI happened to run.
    const today = new Date().toISOString().slice(0, 10);
    const locationEntries = xml.split('<url>').filter(entry => /<loc>[^<]*\/locations/.test(entry));
    expect(locationEntries.length).toBeGreaterThan(0);
    for (const entry of locationEntries) {
      expect(entry).not.toContain(`<lastmod>${today}`);
    }
  });

  it('excludes a page whose editor has not requested indexing', async () => {
    seed('location_pages', [pageRecord('cardiff', { indexingRequested: false })]);
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).not.toContain('/locations/cardiff');
  });

  it('excludes a pilot page', async () => {
    seed('location_pages', [pageRecord('cardiff', { status: 'pilot' })]);
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).not.toContain('/locations/cardiff');
  });

  it('excludes a page that fails the quality gate', async () => {
    seed('suppliers', [supplier('s1', 'Venues')]);
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).not.toContain('/locations/cardiff');
  });

  it('drops a page automatically when it is unpublished', async () => {
    const before = await generateSitemap('https://event-flow.co.uk');
    expect(before).toContain('/locations/cardiff');

    seed('location_pages', [pageRecord('cardiff', { status: 'retired' })]);
    const after = await generateSitemap('https://event-flow.co.uk');
    expect(after).not.toContain('/locations/cardiff');
  });

  it('omits the hub entirely when no city page is indexable', async () => {
    seed('location_pages', []);
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).not.toContain('<loc>https://event-flow.co.uk/locations</loc>');
  });

  it('never lists a city that is not in the registry', async () => {
    seed('location_pages', [pageRecord('atlantis'), pageRecord('cardiff')]);
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).not.toContain('atlantis');
    expect(xml).toContain('/locations/cardiff');
  });

  it('keeps the rest of the sitemap intact', async () => {
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).toContain('<loc>https://event-flow.co.uk/suppliers</loc>');
    expect(xml).toContain('</urlset>');
  });
});
