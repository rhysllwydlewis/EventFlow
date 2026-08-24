/**
 * National category directory pages: ranking, indexability gate, metadata
 * and structured data for `/categories/:categorySlug`.
 */

'use strict';

const categoryDirectoryPages = require('../../services/categoryDirectoryPage.service');

const venues = categoryDirectoryPages.resolveCategory('venues');

/**
 * An approved, eligible supplier in a given category.
 * @param {string} id Supplier id.
 * @param {string} category Canonical category name.
 * @param {Object} overrides Extra fields.
 * @returns {Object} Supplier record.
 */
function supplier(id, category, overrides = {}) {
  return {
    id,
    name: `Supplier ${id}`,
    category,
    approved: true,
    ownerUserId: 'user-1',
    ...overrides,
  };
}

describe('resolveCategory', () => {
  it('resolves a slug to its canonical name', () => {
    expect(venues).toEqual({ name: 'Venues', slug: 'venues' });
  });

  it('returns null for an unrecognised category', () => {
    expect(categoryDirectoryPages.resolveCategory('not-a-real-category')).toBeNull();
  });
});

describe('rankSuppliersForCategory', () => {
  it('only includes suppliers in the requested category', () => {
    const suppliers = [supplier('1', 'Venues'), supplier('2', 'Catering')];
    const ranked = categoryDirectoryPages.rankSuppliersForCategory(suppliers, venues, {
      validOwnerIds: new Set(['user-1']),
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].supplier.id).toBe('1');
  });

  it('excludes an unapproved supplier', () => {
    const suppliers = [supplier('1', 'Venues', { approved: false })];
    const ranked = categoryDirectoryPages.rankSuppliersForCategory(suppliers, venues, {
      validOwnerIds: new Set(['user-1']),
    });
    expect(ranked).toHaveLength(0);
  });

  it('excludes a supplier whose owner is not a valid user', () => {
    const suppliers = [supplier('1', 'Venues')];
    const ranked = categoryDirectoryPages.rankSuppliersForCategory(suppliers, venues, {
      validOwnerIds: new Set(),
    });
    expect(ranked).toHaveLength(0);
  });

  it('excludes a known test fixture', () => {
    const suppliers = [supplier('1', 'Venues', { name: 'test-no2-yy7lo4' })];
    const ranked = categoryDirectoryPages.rankSuppliersForCategory(suppliers, venues, {
      validOwnerIds: new Set(['user-1']),
    });
    expect(ranked).toHaveLength(0);
  });

  it('collapses duplicate identities to the strongest scoring entry', () => {
    const suppliers = [
      supplier('1', 'Venues', { canonicalSupplierId: 'biz-1', featured: true }),
      supplier('2', 'Venues', { canonicalSupplierId: 'biz-1' }),
    ];
    const ranked = categoryDirectoryPages.rankSuppliersForCategory(suppliers, venues, {
      validOwnerIds: new Set(['user-1']),
    });
    expect(ranked).toHaveLength(1);
  });

  it('respects a limit', () => {
    const suppliers = Array.from({ length: 5 }, (_, i) => supplier(String(i), 'Venues'));
    const ranked = categoryDirectoryPages.rankSuppliersForCategory(suppliers, venues, {
      validOwnerIds: new Set(['user-1']),
      limit: 2,
    });
    expect(ranked).toHaveLength(2);
  });
});

describe('isIndexable', () => {
  it('is false below the shared supplier-count threshold', () => {
    expect(categoryDirectoryPages.isIndexable([{}, {}])).toBe(false);
  });

  it('is true at or above the shared supplier-count threshold', () => {
    expect(categoryDirectoryPages.isIndexable([{}, {}, {}])).toBe(true);
  });
});

describe('buildCategoryDirectoryMetadata', () => {
  it('builds a self-referencing canonical URL and a real supplier count in the description', () => {
    const rankedSuppliers = [
      { supplier: supplier('1', 'Venues') },
      { supplier: supplier('2', 'Venues') },
    ];
    const metadata = categoryDirectoryPages.buildCategoryDirectoryMetadata({
      category: venues,
      rankedSuppliers,
      baseUrl: 'https://event-flow.co.uk',
    });
    expect(metadata.canonicalUrl).toBe('https://event-flow.co.uk/categories/venues');
    expect(metadata.description).toContain('2');
    expect(metadata.supplierCount).toBe(2);
  });
});

describe('composeCategoryDirectoryIntro', () => {
  it('returns an empty string with no suppliers, never inventing a claim', () => {
    expect(
      categoryDirectoryPages.composeCategoryDirectoryIntro(venues, { rankedSuppliers: [] })
    ).toBe('');
  });

  it('states the real supplier count when there are suppliers', () => {
    const rankedSuppliers = [
      { supplier: supplier('1', 'Venues') },
      { supplier: supplier('2', 'Venues') },
    ];
    const intro = categoryDirectoryPages.composeCategoryDirectoryIntro(venues, { rankedSuppliers });
    expect(intro).toContain('2');
  });

  it('is stable across repeated calls for the same category', () => {
    const rankedSuppliers = [{ supplier: supplier('1', 'Venues') }];
    const first = categoryDirectoryPages.composeCategoryDirectoryIntro(venues, { rankedSuppliers });
    const second = categoryDirectoryPages.composeCategoryDirectoryIntro(venues, {
      rankedSuppliers,
    });
    expect(first).toBe(second);
  });
});

describe('buildCategoryDirectoryStructuredData', () => {
  it('omits mainEntity when no supplier resolves to a URL', () => {
    const metadata = { title: 'Venues suppliers | EventFlow', description: 'x' };
    const data = categoryDirectoryPages.buildCategoryDirectoryStructuredData({
      category: venues,
      metadata,
      rankedSuppliers: [{ supplier: supplier('1', 'Venues') }],
      baseUrl: 'https://event-flow.co.uk',
      supplierUrlFor: () => '',
    });
    expect(data.mainEntity).toBeUndefined();
    expect(data['@type']).toBe('CollectionPage');
  });

  it('lists suppliers as an ItemList when URLs resolve', () => {
    const metadata = { title: 'Venues suppliers | EventFlow', description: 'x' };
    const data = categoryDirectoryPages.buildCategoryDirectoryStructuredData({
      category: venues,
      metadata,
      rankedSuppliers: [{ supplier: supplier('1', 'Venues') }],
      baseUrl: 'https://event-flow.co.uk',
      supplierUrlFor: s => `https://event-flow.co.uk/supplier/${s.id}`,
    });
    expect(data.mainEntity.numberOfItems).toBe(1);
    expect(data.mainEntity.itemListElement[0].url).toBe('https://event-flow.co.uk/supplier/1');
  });
});

describe('buildCategoryDirectoryPageModel', () => {
  it('is not indexable below the supplier threshold', () => {
    const suppliers = [supplier('1', 'Venues'), supplier('2', 'Venues')];
    const model = categoryDirectoryPages.buildCategoryDirectoryPageModel({
      category: venues,
      suppliers,
      validOwnerIds: new Set(['user-1']),
      baseUrl: 'https://event-flow.co.uk',
    });
    expect(model.indexable).toBe(false);
  });

  it('is indexable at or above the supplier threshold', () => {
    const suppliers = [supplier('1', 'Venues'), supplier('2', 'Venues'), supplier('3', 'Venues')];
    const model = categoryDirectoryPages.buildCategoryDirectoryPageModel({
      category: venues,
      suppliers,
      validOwnerIds: new Set(['user-1']),
      baseUrl: 'https://event-flow.co.uk',
    });
    expect(model.indexable).toBe(true);
    expect(model.rankedSuppliers).toHaveLength(3);
  });

  it('excludes the current category from related categories', () => {
    const catering = categoryDirectoryPages.resolveCategory('catering');
    const suppliers = [supplier('1', 'Venues'), supplier('2', 'Venues'), supplier('3', 'Venues')];
    const allPopulatedCategories = [
      { category: venues, rankedSuppliers: [{}, {}, {}] },
      { category: catering, rankedSuppliers: [{}, {}] },
    ];
    const model = categoryDirectoryPages.buildCategoryDirectoryPageModel({
      category: venues,
      suppliers,
      validOwnerIds: new Set(['user-1']),
      allPopulatedCategories,
      baseUrl: 'https://event-flow.co.uk',
    });
    expect(model.relatedCategories.map(c => c.slug)).toEqual(['catering']);
  });
});

describe('populatedCategories', () => {
  it('only lists categories with at least one eligible supplier', () => {
    const suppliers = [supplier('1', 'Venues')];
    const entries = categoryDirectoryPages.populatedCategories(suppliers, new Set(['user-1']));
    expect(entries).toHaveLength(1);
    expect(entries[0].category.name).toBe('Venues');
  });
});
