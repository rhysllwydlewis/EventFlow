'use strict';

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
}));

const dbUnified = require('../../db-unified');
const { generateSitemap } = require('../../sitemap');
const {
  buildPublicEventSlug,
  buildPublicPackageSlug,
} = require('../../services/publicListingSeo.service');

const BASE_URL = 'https://event-flow.co.uk';

const supplier = {
  id: 'supplier-1',
  ownerUserId: 'user-1',
  approved: true,
  name: 'Cwm Valley Events',
  category: 'Photography',
  location: 'Cardiff',
  description_short: 'Natural wedding and event photography across South Wales.',
};
const pkg = {
  id: 'pkg-1',
  supplierId: supplier.id,
  approved: true,
  title: 'Full Day Photography',
  slug: 'full-day-photography-pkg001',
  description: 'A full day of documentary-style wedding photography across South Wales.',
  updatedAt: '2026-07-18T10:00:00.000Z',
};
const futureEvent = {
  id: 'pce_future01',
  slug: 'future-wedding-fair-future01',
  title: 'Future Wedding Fair',
  status: 'published',
  startDate: '2035-06-15T10:00:00.000Z',
  endDate: '2035-06-15T16:00:00.000Z',
  updatedAt: '2026-07-18T11:00:00.000Z',
};

describe('listing sitemap eligibility and canonical URLs', () => {
  beforeEach(() => {
    const data = {
      suppliers: [supplier],
      users: [{ id: 'user-1' }],
      packages: [
        pkg,
        { ...pkg, id: 'pkg-pending', slug: 'pending-package', approved: false },
        { ...pkg, id: 'pkg-orphan', slug: 'orphan-package', supplierId: 'missing' },
        { ...pkg, id: 'pkg-paused', slug: 'paused-package', paused: true },
      ],
      public_calendar_events: [
        futureEvent,
        { ...futureEvent, id: 'pce_future02', slug: 'future-fair-two', startDate: '2035-06-29T10:00:00.000Z' },
        { ...futureEvent, id: 'pce_future03', slug: 'future-fair-three', startDate: '2035-07-15T10:00:00.000Z' },
        {
          ...futureEvent,
          id: 'pce_past0001',
          slug: 'past-event-past0001',
          startDate: '2020-01-01T10:00:00.000Z',
          endDate: '2020-01-01T12:00:00.000Z',
        },
        { ...futureEvent, id: 'pce_draft001', slug: 'draft-event', status: 'draft' },
        { ...futureEvent, id: 'pce_private1', slug: 'private-event', isPrivate: true },
      ],
    };
    dbUnified.read.mockImplementation(async collection => data[collection] || []);
  });

  test('publishes only canonical, indexable packages and future public events', async () => {
    const xml = await generateSitemap(BASE_URL);

    expect(xml).toContain(`<loc>${BASE_URL}/package/${buildPublicPackageSlug(pkg)}</loc>`);
    expect(xml).toContain(`<loc>${BASE_URL}/events/${buildPublicEventSlug(futureEvent)}</loc>`);
    expect(xml).toContain('<lastmod>2026-07-18T10:00:00.000Z</lastmod>');
    expect(xml).toContain('<lastmod>2026-07-18T11:00:00.000Z</lastmod>');
    expect(xml).toContain(`<loc>${BASE_URL}/public-calendar</loc>`);

    expect(xml).not.toContain('/package.html?');
    expect(xml).not.toContain('pending-package');
    expect(xml).not.toContain('orphan-package');
    expect(xml).not.toContain('paused-package');
    expect(xml).not.toContain('past-event-past0001');
    expect(xml).not.toContain('draft-event');
    expect(xml).not.toContain('private-event');
    expect(xml).not.toContain('<priority>');
    expect(xml).not.toContain('<changefreq>');
  });

  test('does not fabricate lastmod dates for static pages', async () => {
    const xml = await generateSitemap(BASE_URL);
    const location = `<loc>${BASE_URL}/</loc>`;
    const locationIndex = xml.indexOf(location);
    const blockEnd = xml.indexOf('</url>', locationIndex);
    expect(locationIndex).toBeGreaterThanOrEqual(0);
    expect(blockEnd).toBeGreaterThan(locationIndex);
    expect(xml.slice(locationIndex, blockEnd)).not.toContain('<lastmod>');
  });

  test('omits the public calendar hub when there are no indexable events (SEO-005)', async () => {
    const data = {
      suppliers: [supplier],
      users: [{ id: 'user-1' }],
      packages: [],
      public_calendar_events: [
        {
          ...futureEvent,
          id: 'pce_past0001',
          slug: 'past-event-past0001',
          startDate: '2020-01-01T10:00:00.000Z',
          endDate: '2020-01-01T12:00:00.000Z',
        },
      ],
    };
    dbUnified.read.mockImplementation(async collection => data[collection] || []);

    const xml = await generateSitemap(BASE_URL);
    expect(xml).not.toContain(`<loc>${BASE_URL}/public-calendar</loc>`);
  });
});
