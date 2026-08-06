/**
 * Location page publication state, quality gate, metadata and structured data.
 */

'use strict';

const registry = require('../../services/locationRegistry.service');
const locationPages = require('../../services/locationPage.service');
const { PUBLICATION_STATES, QUALITY_PASS_SCORE } = require('../../models/LocationContent');

const cardiff = registry.getCity('cardiff');

/**
 * A ranked entry good enough for the gate to count.
 * @param {number} index Index used for the id.
 * @param {string} category Supplier category.
 * @returns {Object} Ranked entry.
 */
function ranked(index, category) {
  return {
    supplier: { id: `sup-${index}`, name: `Supplier ${index}`, category },
    relationship: 'based_in',
    label: 'Based in Cardiff',
    score: 100,
  };
}

/**
 * A page record that clears every gate signal.
 * @param {Object} overrides Fields to override.
 * @returns {Object} Stored page record.
 */
function strongRecord(overrides = {}) {
  return {
    locationSlug: 'cardiff',
    status: PUBLICATION_STATES.published,
    indexingRequested: true,
    lastReviewedAt: new Date().toISOString(),
    reviewedBy: 'editor@example.com',
    content: {
      intro: 'Cardiff has a deep bench of venues, caterers and photographers.',
      planningSections: [{ title: 'City centre or the Bay', body: 'Guidance written by a human.' }],
      faqs: [],
    },
    ...overrides,
  };
}

/** Eight suppliers across four categories: full marks on inventory. */
const strongSuppliers = [
  ranked(1, 'Venues'),
  ranked(2, 'Venues'),
  ranked(3, 'Catering'),
  ranked(4, 'Catering'),
  ranked(5, 'Photography'),
  ranked(6, 'Photography'),
  ranked(7, 'Entertainment'),
  ranked(8, 'Entertainment'),
];

describe('page record defaults', () => {
  it('treats a city with no record as a draft', () => {
    const page = locationPages.normalisePageRecord(cardiff, null);
    expect(page.status).toBe(PUBLICATION_STATES.draft);
    expect(page.indexingRequested).toBe(false);
    expect(page.content.intro).toBe('');
    // No hero until an editor has chosen one. A curated photo is offered as a
    // suggestion in the admin editor, never injected onto a public page.
    expect(page.content.heroImageUrl).toBeNull();
    expect(page.content.heroImageAlt).toBeNull();
    expect(page.content.heroImageSourceUrl).toBeNull();
  });

  it('lets an editor remove a hero image and have it stay removed', () => {
    const page = locationPages.normalisePageRecord(cardiff, {
      content: { heroImageUrl: '', heroImageAlt: '' },
    });
    expect(page.content.heroImageUrl).toBeNull();
    expect(page.content.heroImageCredit).toBeNull();
  });

  it('attaches the curated attribution when an editor picks the curated photo', () => {
    const curated = require('../../services/locationHeroImage.service').getCuratedHero('cardiff');
    const page = locationPages.normalisePageRecord(cardiff, {
      content: { heroImageUrl: curated.url },
    });

    expect(page.content.heroImageAlt).toBe(curated.alt);
    expect(page.content.heroImageCredit).toBe(curated.credit);
    expect(page.content.heroImageSourceUrl).toBe(curated.sourceUrl);
  });

  it('keeps an editor-selected hero instead of replacing it with the curated default', () => {
    const page = locationPages.normalisePageRecord(cardiff, {
      content: {
        heroImageUrl: 'https://cdn.example.com/editor-cardiff.jpg',
        heroImageAlt: 'An editor-selected view of Cardiff',
        heroImageCredit: 'Example Photographer',
        heroImageSourceUrl: 'https://example.com/cardiff-photo',
      },
    });

    expect(page.content).toEqual(
      expect.objectContaining({
        heroImageUrl: 'https://cdn.example.com/editor-cardiff.jpg',
        heroImageAlt: 'An editor-selected view of Cardiff',
        heroImageCredit: 'Example Photographer',
        heroImageSourceUrl: 'https://example.com/cardiff-photo',
      })
    );
  });

  it('does not render unsafe stored image or attribution URLs', () => {
    const page = locationPages.normalisePageRecord(cardiff, {
      content: {
        heroImageUrl: 'javascript:alert(1)',
        heroImageCredit: 'Not the curated photographer',
        heroImageSourceUrl: 'javascript:alert(2)',
      },
    });

    expect(page.content.heroImageUrl).toBeNull();
    expect(page.content.heroImageCredit).toBeNull();
    expect(page.content.heroImageSourceUrl).toBeNull();
  });

  it('rejects an unrecognised status rather than trusting it', () => {
    const page = locationPages.normalisePageRecord(cardiff, { status: 'live-ish' });
    expect(page.status).toBe(PUBLICATION_STATES.draft);
  });

  it('exposes pilot and published pages to the public, and nothing else', () => {
    const visible = state =>
      locationPages.isPubliclyVisible(
        locationPages.normalisePageRecord(cardiff, { status: state })
      );
    expect(visible(PUBLICATION_STATES.published)).toBe(true);
    expect(visible(PUBLICATION_STATES.pilot)).toBe(true);
    expect(visible(PUBLICATION_STATES.draft)).toBe(false);
    expect(visible(PUBLICATION_STATES.review)).toBe(false);
    expect(visible(PUBLICATION_STATES.retired)).toBe(false);
  });
});

describe('quality gate', () => {
  /**
   * Evaluate the gate with sensible strong defaults.
   * @param {Object} overrides Inputs to override.
   * @returns {Object} Gate result.
   */
  function gate(overrides = {}) {
    return locationPages.evaluateQualityGate({
      city: cardiff,
      page: locationPages.normalisePageRecord(cardiff, strongRecord()),
      rankedSuppliers: strongSuppliers,
      packageCount: 2,
      eventCount: 1,
      reviewCount: 4,
      nearbyPublishedCount: 2,
      ...overrides,
    });
  }

  it('passes a page with real inventory, copy, proof and a fresh review', () => {
    const result = gate();
    expect(result.passes).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.score).toBeGreaterThanOrEqual(QUALITY_PASS_SCORE);
  });

  it('holds a page back when indexing has not been requested', () => {
    const result = gate({
      page: locationPages.normalisePageRecord(cardiff, strongRecord({ indexingRequested: false })),
    });
    expect(result.passes).toBe(false);
    expect(result.blockers).toContain('indexing has not been requested by an editor');
  });

  it('holds a pilot page back however good its content is', () => {
    const result = gate({
      page: locationPages.normalisePageRecord(
        cardiff,
        strongRecord({ status: PUBLICATION_STATES.pilot })
      ),
    });
    expect(result.passes).toBe(false);
    expect(result.blockers).toContain('page is not published');
  });

  it('refuses a page with no local introduction', () => {
    const record = strongRecord();
    record.content.intro = '';
    const result = gate({ page: locationPages.normalisePageRecord(cardiff, record) });
    expect(result.passes).toBe(false);
    expect(result.blockers).toContain('page has no local introduction');
  });

  it('refuses a page that has never been reviewed', () => {
    const result = gate({
      page: locationPages.normalisePageRecord(cardiff, strongRecord({ lastReviewedAt: null })),
    });
    expect(result.blockers).toContain('page has never been reviewed by a human');
  });

  it('refuses a page whose review has gone stale', () => {
    const twoYearsAgo = new Date(Date.now() - 730 * 86400000).toISOString();
    const result = gate({
      page: locationPages.normalisePageRecord(
        cardiff,
        strongRecord({ lastReviewedAt: twoYearsAgo })
      ),
    });
    expect(result.passes).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/last reviewed \d+ days ago/);
  });

  it('refuses a thin page on score alone', () => {
    const result = gate({
      rankedSuppliers: [ranked(1, 'Venues')],
      packageCount: 0,
      eventCount: 0,
      reviewCount: 0,
      nearbyPublishedCount: 0,
    });
    expect(result.passes).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/below the pass mark/);
  });

  it('scores each signal against its own target rather than one supplier count', () => {
    const result = gate();
    expect(result.signals.supplierDepth.ratio).toBe(1);
    expect(result.signals.categoryDiversity.value).toBe(4);
    expect(result.signals.proofOfActivity.value).toBe(7);
  });

  it('is not indexable without a gate result', () => {
    expect(locationPages.isIndexable(null)).toBe(false);
    expect(locationPages.isIndexable({ passes: false })).toBe(false);
  });
});

describe('metadata', () => {
  it('builds a unique title and description from the city and its inventory', () => {
    const metadata = locationPages.buildCityMetadata({
      city: cardiff,
      page: locationPages.normalisePageRecord(cardiff, null),
      rankedSuppliers: strongSuppliers,
      baseUrl: 'https://event-flow.co.uk',
    });
    expect(metadata.title).toContain('Cardiff');
    expect(metadata.title.length).toBeLessThanOrEqual(70);
    expect(metadata.description).toContain('Cardiff');
    expect(metadata.description.length).toBeLessThanOrEqual(160);
    expect(metadata.canonicalUrl).toBe('https://event-flow.co.uk/locations/cardiff');
    expect(metadata.heading).toBe('Event suppliers in Cardiff');
    // No hero chosen, so nothing to share as an og:image.
    expect(metadata.imageUrl).toBeNull();
  });

  it('shares the hero an editor chose as the social image', () => {
    const metadata = locationPages.buildCityMetadata({
      city: cardiff,
      page: locationPages.normalisePageRecord(cardiff, {
        content: { heroImageUrl: 'https://cdn.example.com/cardiff.jpg' },
      }),
      rankedSuppliers: strongSuppliers,
      baseUrl: 'https://event-flow.co.uk',
    });
    expect(metadata.imageUrl).toBe('https://cdn.example.com/cardiff.jpg');
  });

  it("prefers the editor's title and description", () => {
    const metadata = locationPages.buildCityMetadata({
      city: cardiff,
      page: locationPages.normalisePageRecord(cardiff, {
        seo: { title: 'Editor title', metaDescription: 'Editor description' },
      }),
      rankedSuppliers: [],
    });
    expect(metadata.title).toBe('Editor title');
    expect(metadata.description).toBe('Editor description');
  });

  it('always builds an absolute canonical on the EventFlow origin', () => {
    const metadata = locationPages.buildCityMetadata({
      city: cardiff,
      page: null,
      baseUrl: 'http://attacker.example.com',
    });
    expect(metadata.canonicalUrl).toBe('https://event-flow.co.uk/locations/cardiff');
  });
});

describe('structured data', () => {
  it('emits a breadcrumb trail down to the city', () => {
    const data = locationPages.buildBreadcrumbStructuredData(cardiff, 'https://event-flow.co.uk');
    expect(data['@type']).toBe('BreadcrumbList');
    expect(data.itemListElement).toHaveLength(3);
    expect(data.itemListElement[2].item).toBe('https://event-flow.co.uk/locations/cardiff');
    expect(data.itemListElement.map(item => item.position)).toEqual([1, 2, 3]);
  });

  it('stops at the hub when there is no city', () => {
    const data = locationPages.buildBreadcrumbStructuredData(null, 'https://event-flow.co.uk');
    expect(data.itemListElement).toHaveLength(2);
  });

  it('describes the page as a collection, never a local business', () => {
    const metadata = locationPages.buildCityMetadata({
      city: cardiff,
      page: null,
      rankedSuppliers: strongSuppliers,
    });
    const data = locationPages.buildCollectionStructuredData({
      city: cardiff,
      metadata,
      rankedSuppliers: strongSuppliers,
      supplierUrlFor: supplier => `https://event-flow.co.uk/supplier/${supplier.id}`,
    });
    expect(data['@type']).toBe('CollectionPage');
    expect(JSON.stringify(data)).not.toContain('LocalBusiness');
    expect(data.mainEntity.numberOfItems).toBe(strongSuppliers.length);
    expect(data.about.geo.latitude).toBeCloseTo(51.4816, 3);
  });

  it('omits the item list when no supplier has a public URL', () => {
    const metadata = locationPages.buildCityMetadata({ city: cardiff, page: null });
    const data = locationPages.buildCollectionStructuredData({
      city: cardiff,
      metadata,
      rankedSuppliers: strongSuppliers,
      supplierUrlFor: () => '',
    });
    expect(data.mainEntity).toBeUndefined();
  });
});

describe('page model', () => {
  it('omits modules that have nothing reliable to show', () => {
    const model = locationPages.buildCityPageModel({
      city: cardiff,
      page: locationPages.normalisePageRecord(cardiff, null),
      suppliers: [],
      validOwnerIds: new Set(),
    });
    expect(model.rankedSuppliers).toEqual([]);
    expect(model.categories).toEqual([]);
    expect(model.packages).toEqual([]);
    expect(model.nearby).toEqual([]);
    expect(model.indexable).toBe(false);
  });

  it('links only to nearby cities whose pages are published', () => {
    const model = locationPages.buildCityPageModel({
      city: cardiff,
      page: locationPages.normalisePageRecord(cardiff, strongRecord()),
      suppliers: [],
      publishedSlugs: new Set(['newport']),
    });
    expect(model.nearby.map(city => city.slug)).toEqual(['newport']);
  });

  it('counts only packages and events belonging to visible suppliers', () => {
    const owners = new Set(['user-1']);
    const suppliers = [
      {
        id: 'sup-1',
        name: 'Cardiff Venue',
        category: 'Venues',
        approved: true,
        ownerUserId: 'user-1',
        baseLocation: { citySlug: 'cardiff' },
      },
    ];
    const model = locationPages.buildCityPageModel({
      city: cardiff,
      page: locationPages.normalisePageRecord(cardiff, strongRecord()),
      suppliers,
      validOwnerIds: owners,
      packages: [
        { id: 'pkg-1', supplierId: 'sup-1', name: 'Package' },
        { id: 'pkg-2', supplierId: 'sup-999', name: 'Other city package' },
      ],
      events: [{ id: 'evt-1', supplierId: 'sup-999', title: 'Elsewhere' }],
    });
    expect(model.packages.map(pkg => pkg.id)).toEqual(['pkg-1']);
    expect(model.events).toEqual([]);
  });
});

describe('indexable city selection', () => {
  it('returns only published, index-requested cities that pass', () => {
    const records = new Map([
      ['cardiff', strongRecord()],
      ['bristol', strongRecord({ locationSlug: 'bristol', indexingRequested: false })],
      ['newport', strongRecord({ locationSlug: 'newport', status: PUBLICATION_STATES.pilot })],
    ]);
    const selected = locationPages.indexableCities({
      records,
      gateFor: (city, page) =>
        locationPages.evaluateQualityGate({
          city,
          page,
          rankedSuppliers: strongSuppliers,
          packageCount: 2,
          eventCount: 1,
          reviewCount: 4,
          nearbyPublishedCount: 2,
        }),
    });
    expect(selected.map(entry => entry.city.slug)).toEqual(['cardiff']);
  });
});
