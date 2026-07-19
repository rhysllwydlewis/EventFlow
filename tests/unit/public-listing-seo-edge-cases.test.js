'use strict';

const {
  buildEventSeoModel,
  buildPublicEventSlug,
  publicSupplierIds,
  resolvePublicEvent,
  resolvePublicPackage,
} = require('../../services/publicListingSeo.service');

const supplier = {
  id: 'supplier-1',
  ownerUserId: 'user-1',
  approved: true,
  name: 'Cwm Valley Events',
};

describe('public listing SEO compatibility edge cases', () => {
  test('matches the public-calendar fallback slug exactly for legacy events', () => {
    const legacyEvent = {
      id: 'pce_12345678',
      title: 'A & B Wedding Showcase',
      status: 'published',
      startDate: '2030-06-15T10:00:00.000Z',
    };

    expect(buildPublicEventSlug(legacyEvent)).toBe('a-b-wedding-showcase-12345678');
    expect(resolvePublicEvent([legacyEvent], 'a-b-wedding-showcase-12345678')).toBe(legacyEvent);
  });

  test('matches the calendar API title truncation for legacy event slugs', () => {
    const title = `A ${'long '.repeat(30)}event title`;
    const legacyEvent = {
      id: 'pce_abcdefgh',
      title,
      status: 'published',
      startDate: '2030-06-15T10:00:00.000Z',
    };

    const expectedTitlePart = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    expect(buildPublicEventSlug(legacyEvent)).toBe(`${expectedTitlePart}-abcdefgh`);
  });

  test('keeps paused packages out of public canonical resolution', () => {
    const supplierIds = publicSupplierIds([supplier], [{ id: 'user-1' }]);
    const pausedPackage = {
      id: 'pkg-paused',
      supplierId: supplier.id,
      approved: true,
      paused: true,
      title: 'Paused package',
      slug: 'paused-package',
    };

    expect(resolvePublicPackage([pausedPackage], pausedPackage.slug, supplierIds)).toBeNull();
  });

  test('marks cancelled event offers unavailable in structured data', () => {
    const cancelledEvent = {
      id: 'pce_cancelled',
      slug: 'cancelled-fair',
      title: 'Cancelled Wedding Fair',
      description: 'This event has been cancelled.',
      status: 'cancelled',
      startDate: '2030-06-15T10:00:00.000Z',
      endDate: '2030-06-15T16:00:00.000Z',
      priceType: 'free',
    };

    const seo = buildEventSeoModel(cancelledEvent, { baseUrl: 'https://event-flow.co.uk' });
    expect(seo.structuredData.eventStatus).toBe('https://schema.org/EventCancelled');
    expect(seo.structuredData.offers.availability).toBe('https://schema.org/SoldOut');
  });
});
