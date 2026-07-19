'use strict';

const {
  buildEventSeoModel,
  buildPackageSeoModel,
  buildPublicEventSlug,
  buildPublicPackageSlug,
  isIndexablePublicEvent,
  publicSupplierIds,
  renderSeoHtml,
  resolvePublicEvent,
  resolvePublicPackage,
} = require('../../services/publicListingSeo.service');

const supplier = {
  id: 'supplier-1',
  ownerUserId: 'user-1',
  approved: true,
  name: 'Cwm Valley Events',
  location: 'Cardiff',
};

const pkg = {
  id: 'pkg-1',
  supplierId: supplier.id,
  approved: true,
  title: 'Full Day Wedding Photography',
  slug: 'full-day-wedding-photography-pkg001',
  description: 'Natural wedding photography across South Wales.',
  price: '£1,250',
  image: '/uploads/package.jpg',
  primaryCategoryKey: 'photography',
};

const futureEvent = {
  id: 'pce_12345678',
  slug: 'cardiff-wedding-fair-12345678',
  title: 'Cardiff Wedding Fair',
  description: 'Meet local wedding suppliers in Cardiff.',
  status: 'published',
  startDate: '2030-06-15T10:00:00.000Z',
  endDate: '2030-06-15T16:00:00.000Z',
  venueName: 'Cardiff City Hall',
  townCity: 'Cardiff',
  postcode: 'CF10 3ND',
  organiserName: 'Cwm Valley Events',
  priceType: 'free',
  featuredImageUrl: '/uploads/wedding-fair.jpg',
};

describe('public listing SEO service', () => {
  test('uses stored package slugs and resolves legacy identifiers', () => {
    const supplierIds = publicSupplierIds([supplier], [{ id: 'user-1' }]);
    expect(buildPublicPackageSlug(pkg)).toBe(pkg.slug);
    expect(resolvePublicPackage([pkg], pkg.id, supplierIds)).toBe(pkg);
    expect(resolvePublicPackage([pkg], 'full-day-wedding-photography', supplierIds)).toBe(pkg);
  });

  test('creates a deterministic unique package fallback slug', () => {
    const legacyPackage = { ...pkg, slug: '', title: 'Evening Package' };
    expect(buildPublicPackageSlug(legacyPackage)).toMatch(/^evening-package-[a-f0-9]{8}$/);
  });

  test('builds Service and Offer structured data for public packages', () => {
    const seo = buildPackageSeoModel(pkg, supplier, { baseUrl: 'https://event-flow.co.uk' });
    expect(seo.canonicalUrl).toBe(`https://event-flow.co.uk/package/${pkg.slug}`);
    expect(seo.structuredData).toEqual(
      expect.objectContaining({
        '@type': 'Service',
        name: pkg.title,
        offers: expect.objectContaining({ price: 1250, priceCurrency: 'GBP' }),
        provider: expect.objectContaining({ name: supplier.name }),
      })
    );
  });

  test('only considers genuinely public upcoming events indexable', () => {
    const now = new Date('2029-01-01T00:00:00.000Z');
    expect(isIndexablePublicEvent(futureEvent, now)).toBe(true);
    expect(isIndexablePublicEvent({ ...futureEvent, isPrivate: true }, now)).toBe(false);
    expect(isIndexablePublicEvent({ ...futureEvent, status: 'draft' }, now)).toBe(false);
    expect(
      isIndexablePublicEvent(
        { ...futureEvent, startDate: '2020-01-01T00:00:00.000Z', endDate: '' },
        now
      )
    ).toBe(false);
  });

  test('resolves public events by id, stored slug and canonical slug', () => {
    expect(buildPublicEventSlug(futureEvent)).toBe(futureEvent.slug);
    expect(resolvePublicEvent([futureEvent], futureEvent.id)).toBe(futureEvent);
    expect(resolvePublicEvent([futureEvent], futureEvent.slug)).toBe(futureEvent);
    expect(resolvePublicEvent([{ ...futureEvent, status: 'draft' }], futureEvent.slug)).toBeNull();
  });

  test('builds Event structured data with location and free offer', () => {
    const seo = buildEventSeoModel(futureEvent, { baseUrl: 'https://event-flow.co.uk' });
    expect(seo.structuredData).toEqual(
      expect.objectContaining({
        '@type': 'Event',
        startDate: futureEvent.startDate,
        location: expect.objectContaining({ '@type': 'Place', name: futureEvent.venueName }),
        offers: expect.objectContaining({ price: 0, priceCurrency: 'GBP' }),
      })
    );
  });

  test('replaces generic metadata without changing body markup', () => {
    const template = `<!doctype html><html><head><title>Generic</title><meta name="description" content="Generic"><link rel="canonical" href="https://event-flow.co.uk/events/"><script type="application/ld+json" id="event-structured-data">{}</script></head><body><main id="content">Unchanged body</main></body></html>`;
    const seo = buildEventSeoModel(futureEvent, { baseUrl: 'https://event-flow.co.uk' });
    const html = renderSeoHtml(template, 'event', futureEvent.id, seo, true);

    expect(html).toContain('<main id="content">Unchanged body</main>');
    expect(html).toContain(`<link rel="canonical" href="${seo.canonicalUrl}">`);
    expect(html).toContain('id="event-structured-data"');
    expect(html.match(/id="event-structured-data"/g)).toHaveLength(1);
    expect(html).not.toContain('<title>Generic</title>');
  });
});
