/**
 * City × category page publication state, quality gate, metadata and
 * structured data.
 */

'use strict';

const registry = require('../../services/locationRegistry.service');
const locationCategoryPages = require('../../services/locationCategoryPage.service');
const { PUBLICATION_STATES, CATEGORY_QUALITY_PASS_SCORE } = require('../../models/LocationContent');

const cardiff = registry.getCity('cardiff');
const venues = locationCategoryPages.resolveCategory('venues');

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
 * A stored category page record that clears every gate signal.
 * @param {Object} overrides Fields to override.
 * @returns {Object} Stored record.
 */
function strongRecord(overrides = {}) {
  return {
    locationSlug: 'cardiff',
    categorySlug: 'venues',
    status: PUBLICATION_STATES.published,
    indexingRequested: true,
    lastReviewedAt: new Date().toISOString(),
    reviewedBy: 'editor@example.com',
    content: {
      intro: 'Cardiff has a deep bench of wedding and event venues.',
      planningSections: [{ title: 'City centre or the Bay', body: 'Guidance written by a human.' }],
      faqs: [],
    },
    ...overrides,
  };
}

describe('resolveCategory', () => {
  it('resolves a slug, a canonical name, or a case variant, to the same category', () => {
    expect(locationCategoryPages.resolveCategory('venues')).toEqual({
      name: 'Venues',
      slug: 'venues',
    });
    expect(locationCategoryPages.resolveCategory('Venues')).toEqual({
      name: 'Venues',
      slug: 'venues',
    });
    expect(locationCategoryPages.resolveCategory('VENUES')).toEqual({
      name: 'Venues',
      slug: 'venues',
    });
  });

  it('returns null for an unrecognised category', () => {
    expect(locationCategoryPages.resolveCategory('not-a-real-category')).toBeNull();
  });
});

describe('category page record defaults', () => {
  it('treats a combination with no record as a draft', () => {
    const page = locationCategoryPages.normaliseCategoryPageRecord(cardiff, venues, null);
    expect(page.status).toBe(PUBLICATION_STATES.draft);
    expect(page.indexingRequested).toBe(false);
    expect(page.content.intro).toBe('');
  });
});

describe('category quality gate', () => {
  it('passes with strong content and four suppliers in the category', () => {
    const rankedSuppliers = [
      ranked(1, 'Venues'),
      ranked(2, 'Venues'),
      ranked(3, 'Venues'),
      ranked(4, 'Venues'),
    ];
    const gate = locationCategoryPages.evaluateCategoryQualityGate({
      city: cardiff,
      category: venues,
      page: locationCategoryPages.normaliseCategoryPageRecord(cardiff, venues, strongRecord()),
      rankedSuppliers,
      packageCount: 2,
      internalLinksCount: 2,
    });
    expect(gate.passes).toBe(true);
    expect(gate.score).toBeGreaterThanOrEqual(CATEGORY_QUALITY_PASS_SCORE);
  });

  it('fails on a draft page even with strong inventory', () => {
    const rankedSuppliers = [
      ranked(1, 'Venues'),
      ranked(2, 'Venues'),
      ranked(3, 'Venues'),
      ranked(4, 'Venues'),
    ];
    const gate = locationCategoryPages.evaluateCategoryQualityGate({
      city: cardiff,
      category: venues,
      page: locationCategoryPages.normaliseCategoryPageRecord(cardiff, venues, null),
      rankedSuppliers,
    });
    expect(gate.passes).toBe(false);
    expect(gate.blockers).toContain('page is not published');
  });

  it('fails a thin page with no suppliers and no local content', () => {
    const gate = locationCategoryPages.evaluateCategoryQualityGate({
      city: cardiff,
      category: venues,
      page: locationCategoryPages.normaliseCategoryPageRecord(
        cardiff,
        venues,
        strongRecord({ content: { intro: '', planningSections: [], faqs: [] } })
      ),
      rankedSuppliers: [],
    });
    expect(gate.passes).toBe(false);
    expect(gate.blockers.some(reason => reason.includes('no local introduction'))).toBe(true);
  });

  it('never mixes in a categoryDiversity signal — a single-category page has nothing to diversify', () => {
    const gate = locationCategoryPages.evaluateCategoryQualityGate({
      city: cardiff,
      category: venues,
      page: locationCategoryPages.normaliseCategoryPageRecord(cardiff, venues, strongRecord()),
      rankedSuppliers: [ranked(1, 'Venues')],
    });
    expect(gate.signals.categoryDiversity).toBeUndefined();
  });
});

describe('buildCategoryPageModel', () => {
  const rankedCitySuppliers = [
    ranked(1, 'Venues'),
    ranked(2, 'Venues'),
    ranked(3, 'Catering'),
    ranked(4, 'Photography'),
  ];

  it('filters ranked suppliers down to the one category', () => {
    const model = locationCategoryPages.buildCategoryPageModel({
      city: cardiff,
      category: venues,
      page: locationCategoryPages.normaliseCategoryPageRecord(cardiff, venues, strongRecord()),
      rankedCitySuppliers,
      cityCategories: [
        { name: 'Venues', count: 2 },
        { name: 'Catering', count: 1 },
        { name: 'Photography', count: 1 },
      ],
    });
    expect(model.rankedSuppliers).toHaveLength(2);
    expect(model.rankedSuppliers.every(entry => entry.supplier.category === 'Venues')).toBe(true);
  });

  it('composes a factual automatic introduction when no editor copy exists', () => {
    const model = locationCategoryPages.buildCategoryPageModel({
      city: cardiff,
      category: venues,
      page: locationCategoryPages.normaliseCategoryPageRecord(cardiff, venues, null),
      rankedCitySuppliers,
      cityCategories: [{ name: 'Venues', count: 2 }],
    });
    expect(model.page.content.intro).toContain('2');
    expect(model.page.content.intro.toLowerCase()).toContain('venues');
  });

  it('gives no introduction to a category with no suppliers — there is nothing true to say', () => {
    const model = locationCategoryPages.buildCategoryPageModel({
      city: cardiff,
      category: venues,
      page: locationCategoryPages.normaliseCategoryPageRecord(cardiff, venues, null),
      rankedCitySuppliers: [],
      cityCategories: [],
    });
    expect(model.page.content.intro).toBe('');
  });

  it('excludes the category itself from its own sibling cross-links', () => {
    const model = locationCategoryPages.buildCategoryPageModel({
      city: cardiff,
      category: venues,
      page: locationCategoryPages.normaliseCategoryPageRecord(cardiff, venues, strongRecord()),
      rankedCitySuppliers,
      cityCategories: [
        { name: 'Venues', count: 2 },
        { name: 'Catering', count: 1 },
      ],
      publishedCategoryKeys: new Set([
        locationCategoryPages.categoryPageKey('cardiff', 'catering'),
      ]),
    });
    expect(model.siblingCategories.map(entry => entry.name)).toEqual(['Catering']);
  });

  it('only links to a nearby city’s same category once that page is published', () => {
    const bristol = registry.getCity('bristol');
    const modelUnpublished = locationCategoryPages.buildCategoryPageModel({
      city: cardiff,
      category: venues,
      page: locationCategoryPages.normaliseCategoryPageRecord(cardiff, venues, strongRecord()),
      rankedCitySuppliers,
      cityCategories: [{ name: 'Venues', count: 2 }],
      nearbyCities: [bristol],
      publishedCategoryKeys: new Set(),
    });
    expect(modelUnpublished.nearbySameCategory).toEqual([]);

    const modelPublished = locationCategoryPages.buildCategoryPageModel({
      city: cardiff,
      category: venues,
      page: locationCategoryPages.normaliseCategoryPageRecord(cardiff, venues, strongRecord()),
      rankedCitySuppliers,
      cityCategories: [{ name: 'Venues', count: 2 }],
      nearbyCities: [bristol],
      publishedCategoryKeys: new Set([locationCategoryPages.categoryPageKey('bristol', 'venues')]),
    });
    expect(modelPublished.nearbySameCategory.map(city => city.slug)).toEqual(['bristol']);
  });
});

describe('structured data', () => {
  it('gives a category page collection a distinct @id from its parent city', () => {
    const cityData = require('../../services/locationPage.service').buildCollectionStructuredData({
      city: cardiff,
      metadata: {
        title: 't',
        description: 'd',
        canonicalUrl: 'https://event-flow.co.uk/locations/cardiff',
      },
      rankedSuppliers: [],
      baseUrl: 'https://event-flow.co.uk',
    });
    const categoryData = locationCategoryPages.buildCategoryCollectionStructuredData({
      city: cardiff,
      category: venues,
      metadata: {
        title: 't',
        description: 'd',
        canonicalUrl: 'https://event-flow.co.uk/locations/cardiff/venues',
      },
      rankedSuppliers: [],
      baseUrl: 'https://event-flow.co.uk',
    });
    expect(categoryData['@id']).not.toBe(cityData['@id']);
    expect(categoryData['@id']).toBe(
      'https://event-flow.co.uk/locations/cardiff/venues#collection'
    );
  });

  it('breadcrumbs include the city and the category as separate crumbs', () => {
    const data = locationCategoryPages.buildCategoryBreadcrumbStructuredData(
      cardiff,
      venues,
      'https://event-flow.co.uk'
    );
    const names = data.itemListElement.map(item => item.name);
    expect(names).toEqual(['Home', 'UK locations', 'Cardiff', 'Venues']);
  });
});
