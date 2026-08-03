/**
 * Ranked supplier-search adapter tests.
 */

'use strict';

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
}));

jest.mock('../../services/catalogCache', () => ({
  get: jest.fn(),
  set: jest.fn(),
}));

jest.mock('../../services/searchService', () => ({
  searchSuppliers: jest.fn(),
  normalizeSupplierQuery: jest.fn(),
  projectPublicSupplierFields: jest.fn(),
  searchPackages: jest.fn(),
}));

const dbUnified = require('../../db-unified');
const catalogCache = require('../../services/catalogCache');
const baseSearchService = require('../../services/searchService');
const {
  RANKING_VERSION,
  searchSuppliers,
  getCachedCollection,
  projectRankedSupplier,
  sortPriceResults,
} = require('../../services/rankedSupplierSearch.service');

const NOW = '2026-08-01T12:00:00.000Z';

function supplier(overrides = {}) {
  return {
    id: 'supplier_1',
    ownerUserId: 'owner_1',
    approved: true,
    status: 'published',
    name: 'Cardiff Celebration Photography',
    category: 'Photography',
    location: 'Cardiff',
    postcode: 'CF10 1AA',
    profilePhotoUrl: '/uploads/profile.jpg',
    coverImage: '/uploads/cover.jpg',
    description_short: 'Natural wedding and event photography across Cardiff and South Wales.',
    description_long:
      'Relaxed wedding and event photography with planning support, professionally edited images and a private online gallery for every booking throughout South Wales.',
    images: ['/uploads/one.jpg', '/uploads/two.jpg', '/uploads/three.jpg', '/uploads/four.jpg'],
    tags: ['wedding', 'photography'],
    amenities: ['Planning call', 'Online gallery'],
    price_display: '££',
    averageRating: 4.8,
    reviewCount: 10,
    verified: true,
    verifications: {
      business: { verified: true },
      email: { verified: true },
      phone: { verified: true },
    },
    subscriptionTier: 'free',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: NOW,
    email: 'private@example.com',
    phone: '07123456789',
    businessAddress: 'Private address',
    ...overrides,
  };
}

function packageFor(supplierId = 'supplier_1', overrides = {}) {
  return {
    id: `package_${supplierId}`,
    supplierId,
    approved: true,
    title: 'Full-day wedding photography',
    description:
      'Full-day wedding photography with planning support, edited photographs and an online gallery.',
    price: 1495,
    image: '/uploads/package.jpg',
    features: ['Full-day coverage', 'Edited gallery'],
    updatedAt: NOW,
    ...overrides,
  };
}

function project(raw, overrides = {}) {
  return {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    location: raw.location,
    description_short: raw.description_short,
    description_long: raw.description_long,
    images: raw.images,
    price_display: raw.price_display,
    averageRating: raw.averageRating,
    reviewCount: raw.reviewCount,
    verified: raw.verified,
    featured: raw.featured,
    featuredSupplier: raw.featuredSupplier,
    approved: raw.approved,
    ownerUserId: raw.ownerUserId,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    topPackages: [],
    ...overrides,
  };
}

function normalizedQuery(raw = {}) {
  const parsedPage = Number(raw.page) || 1;
  const parsedLimit = Number(raw.limit) || 20;
  return {
    q: raw.q ? String(raw.q).trim() : '',
    minRating:
      raw.minRating === undefined || raw.minRating === '' ? undefined : Number(raw.minRating),
    sortBy: raw.sortBy || 'relevance',
    page: parsedPage,
    limit: parsedLimit,
  };
}

describe('rankedSupplierSearch.service', () => {
  let cache;
  let rawSuppliers;
  let packages;
  let projectedSuppliers;

  beforeEach(() => {
    jest.clearAllMocks();
    cache = new Map();
    rawSuppliers = [supplier()];
    packages = [packageFor()];
    projectedSuppliers = rawSuppliers.map(item => project(item));

    catalogCache.get.mockImplementation(async key => (cache.has(key) ? cache.get(key) : null));
    catalogCache.set.mockImplementation(async (key, value) => {
      cache.set(key, value);
    });

    dbUnified.read.mockImplementation(async collection => {
      if (collection === 'suppliers') return rawSuppliers;
      if (collection === 'packages') return packages;
      if (collection === 'users') return [{ id: 'owner_1' }, { _id: 'owner_2' }];
      return [];
    });

    baseSearchService.normalizeSupplierQuery.mockImplementation(normalizedQuery);
    baseSearchService.projectPublicSupplierFields.mockImplementation(item => ({
      id: item.id,
      name: item.name,
      category: item.category,
      location: item.location,
      description_short: item.description_short,
      description_long: item.description_long,
      images: item.images,
      price_display: item.price_display,
      startingPrice: item.startingPrice,
      rating: item.rating,
      averageRating: item.averageRating,
      reviewCount: item.reviewCount,
      verified: item.verified,
      isPro: item.isPro,
      featured: item.featured,
      featuredSupplier: item.featuredSupplier,
      approved: item.approved,
      amenities: item.amenities,
      subscriptionTier: item.subscriptionTier,
      ownerUserId: item.ownerUserId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    baseSearchService.searchSuppliers.mockImplementation(async query => {
      const page = Number(query.page) || 1;
      const limit = Number(query.limit) || 20;
      const skip = (page - 1) * limit;
      return {
        results: projectedSuppliers.slice(skip, skip + limit),
        pagination: {
          total: projectedSuppliers.length,
          page,
          limit,
          pages: Math.ceil(projectedSuppliers.length / limit),
        },
        facets: { categories: { Photography: projectedSuppliers.length } },
      };
    });
  });

  test('uses a cached collection without rereading the database', async () => {
    const cached = [{ id: 'cached_supplier' }];
    cache.set('suppliers:all', cached);

    await expect(getCachedCollection('suppliers:all', 'suppliers')).resolves.toBe(cached);
    expect(dbUnified.read).not.toHaveBeenCalledWith('suppliers');
    expect(catalogCache.set).not.toHaveBeenCalled();
  });

  test('populates the shared catalog cache on a miss', async () => {
    const result = await getCachedCollection('suppliers:all', 'suppliers');

    expect(result).toBe(rawSuppliers);
    expect(dbUnified.read).toHaveBeenCalledWith('suppliers');
    expect(catalogCache.set).toHaveBeenCalledWith('suppliers:all', rawSuppliers);
  });

  test('ranks browse results, projects safe fields and preserves card metadata', async () => {
    projectedSuppliers[0] = project(rawSuppliers[0], {
      distanceMiles: 4.2,
      topPackages: [{ id: 'package_supplier_1', title: 'Wedding photography' }],
      match: { fields: ['name'] },
    });

    const result = await searchSuppliers({ limit: 10 });
    const ranked = result.results[0];

    expect(result.rankingVersion).toBe(RANKING_VERSION);
    expect(result.pagination.total).toBe(1);
    expect(ranked.qualityScore).toBeGreaterThan(0);
    expect(ranked.finalRankingScore).toBeGreaterThanOrEqual(ranked.qualityScore);
    expect(ranked.qualityBand).toBeTruthy();
    expect(ranked.rankingReason).toContain('Complete profile');
    expect(ranked.distanceMiles).toBe(4.2);
    expect(ranked.topPackages).toHaveLength(1);
    expect(ranked.match).toEqual({ fields: ['name'] });
    expect(ranked.approved).toBeUndefined();
    expect(ranked.email).toBeUndefined();
    expect(ranked.phone).toBeUndefined();
    expect(ranked.businessAddress).toBeUndefined();
  });

  test('uses the shared cached snapshot after the established search populates it', async () => {
    cache.set('suppliers:all', rawSuppliers);
    cache.set('packages:all', packages);

    await searchSuppliers({});

    expect(dbUnified.read).not.toHaveBeenCalledWith('suppliers');
    expect(dbUnified.read).not.toHaveBeenCalledWith('packages');
    expect(dbUnified.read).toHaveBeenCalledWith('users');
  });

  test('collects every filtered page before ranking and paginating', async () => {
    rawSuppliers = Array.from({ length: 105 }, (_, index) =>
      supplier({
        id: `supplier_${index + 1}`,
        name: `Supplier ${index + 1}`,
        ownerUserId: 'owner_1',
        averageRating: index === 104 ? 5 : 3,
        reviewCount: index === 104 ? 20 : 1,
      })
    );
    packages = rawSuppliers.map(item => packageFor(item.id));
    projectedSuppliers = rawSuppliers.map(item => project(item));

    const result = await searchSuppliers({ page: 1, limit: 5 });

    expect(baseSearchService.searchSuppliers).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 100 })
    );
    expect(result.pagination.total).toBe(105);
    expect(result.results).toHaveLength(5);
    expect(result.results.some(item => item.id === 'supplier_105')).toBe(true);
  });

  test('uses package text for keyword relevance and removes zero-match suppliers', async () => {
    const jazz = supplier({
      id: 'jazz_supplier',
      name: 'Cardiff Live Music',
      category: 'Entertainment',
      ownerUserId: 'owner_1',
    });
    const catering = supplier({
      id: 'catering_supplier',
      name: 'Welsh Banqueting',
      category: 'Catering',
      ownerUserId: 'owner_1',
      description_short: 'Seasonal menus for celebrations across Wales.',
      description_long:
        'Seasonal event catering with menus, service staff and planning support for private celebrations.',
      tags: ['food'],
    });
    rawSuppliers = [jazz, catering];
    projectedSuppliers = rawSuppliers.map(item => project(item));
    packages = [
      packageFor('jazz_supplier', {
        title: 'Live jazz quartet',
        description: 'A live jazz quartet for weddings, receptions and evening celebrations.',
      }),
    ];

    const result = await searchSuppliers({ q: 'jazz quartet' });

    expect(result.results.map(item => item.id)).toEqual(['jazz_supplier']);
    expect(result.results[0].textRelevanceScore).toBeGreaterThan(0);
    expect(result.results[0].rankingReason).toContain('Packages available');
  });

  test('enforces rating and public eligibility after the established filters', async () => {
    rawSuppliers = [
      supplier({ id: 'eligible', averageRating: 4.8 }),
      supplier({ id: 'low_rating', averageRating: 2.5 }),
      supplier({ id: 'test_supplier', isTest: true }),
      supplier({ id: 'suspended', status: 'suspended' }),
      supplier({ id: 'orphan', ownerUserId: 'missing_owner' }),
    ];
    projectedSuppliers = rawSuppliers.map(item => project(item));
    packages = rawSuppliers.map(item => packageFor(item.id));

    const result = await searchSuppliers({ minRating: 4 });

    expect(result.results.map(item => item.id)).toEqual(['eligible']);
  });

  test('accepts owners represented by a Mongo _id', async () => {
    const mongoOwned = supplier({ id: 'mongo_owned', ownerUserId: 'owner_2' });
    rawSuppliers = [mongoOwned];
    projectedSuppliers = [project(mongoOwned)];
    packages = [packageFor(mongoOwned.id)];

    const result = await searchSuppliers({});

    expect(result.results.map(item => item.id)).toEqual(['mongo_owned']);
  });

  test('sanitises fallback suggestions and removes ineligible suppliers', async () => {
    const safe = supplier({ id: 'safe_fallback' });
    const unsafe = supplier({ id: 'unsafe_fallback', isTest: true });
    rawSuppliers = [safe, unsafe];
    packages = [packageFor(safe.id), packageFor(unsafe.id)];
    projectedSuppliers = [project(unsafe)];

    baseSearchService.searchSuppliers.mockImplementation(async query => {
      if (query.q) {
        return {
          results: [],
          pagination: { total: 0, page: 1, limit: 20, pages: 0 },
          facets: {},
          fallback: {
            message: 'Showing alternatives',
            suggestions: [project(safe), project(unsafe)],
          },
        };
      }
      return {
        results: [project(unsafe)],
        pagination: { total: 1, page: 1, limit: 100, pages: 1 },
        facets: {},
      };
    });

    const result = await searchSuppliers({ q: 'unmatched phrase' });

    expect(result.results).toEqual([]);
    expect(result.fallback.message).toBe('Showing alternatives');
    expect(result.fallback.suggestions.map(item => item.id)).toEqual(['safe_fallback']);
    expect(result.fallback.suggestions[0].email).toBeUndefined();
    expect(result.fallback.suggestions[0].approved).toBeUndefined();
  });

  test('omits an empty fallback', async () => {
    const unsafe = supplier({ id: 'unsafe_fallback', isTest: true });
    rawSuppliers = [unsafe];
    projectedSuppliers = [project(unsafe)];
    packages = [];
    baseSearchService.searchSuppliers.mockImplementation(async query => ({
      results: query.q ? [] : [project(unsafe)],
      pagination: { total: query.q ? 0 : 1, page: 1, limit: 100, pages: 1 },
      facets: {},
      ...(query.q
        ? { fallback: { message: 'No safe alternatives', suggestions: [project(unsafe)] } }
        : {}),
    }));

    const result = await searchSuppliers({ q: 'nothing' });

    expect(result.fallback).toBeUndefined();
  });

  test('keeps missing prices last for ascending and descending price sorts', () => {
    const results = [
      { id: 'missing', qualityScore: 100 },
      { id: 'low', startingPrice: '£100', qualityScore: 10 },
      { id: 'high', startingPrice: '£900', qualityScore: 10 },
    ];

    expect(sortPriceResults(results, 'priceAsc').map(item => item.id)).toEqual([
      'low',
      'high',
      'missing',
    ]);
    expect(sortPriceResults(results, 'priceDesc').map(item => item.id)).toEqual([
      'high',
      'low',
      'missing',
    ]);
  });

  test('projects only the public contract from a fully ranked supplier', () => {
    const projected = projectRankedSupplier({
      ...supplier(),
      rating: 4.8,
      averageRating: 4.8,
      qualityScore: 80,
      finalRankingScore: 83,
      relevanceScore: 83,
      textRelevanceScore: 75,
      qualityBand: 'excellent',
      rankingVersion: RANKING_VERSION,
      rankingReason: 'Strong match',
      reviewConfidenceAdjustedRating: 4.6,
      rankingImprovementCodes: [],
    });

    expect(projected.name).toBe('Cardiff Celebration Photography');
    expect(projected.qualityScore).toBe(80);
    expect(projected.approved).toBeUndefined();
    expect(projected.email).toBeUndefined();
    expect(projected.phone).toBeUndefined();
    expect(projected.businessAddress).toBeUndefined();
  });
});
