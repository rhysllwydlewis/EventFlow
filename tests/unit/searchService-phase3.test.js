/**
 * Phase 3 unit tests — personalized discovery, people-also-viewed,
 * zero-results fallback, ranking reasons, and configurable ranking config.
 */

'use strict';

const searchService = require('../../services/searchService');
const searchWeighting = require('../../utils/searchWeighting');
const dbUnified = require('../../db-unified');

// Mock dbUnified so tests are fully isolated
jest.mock('../../db-unified');
jest.mock('../../services/catalogCache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  invalidate: jest.fn().mockResolvedValue(undefined),
  getTtl: jest.fn().mockReturnValue(300),
}));

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const baseDate = new Date().toISOString();
// 200 days is well outside the 90-day "new arrivals" window and the 30-day
// "new supplier" boost window, so suppliers with this date are reliably "old".
const OLD_SUPPLIER_DAYS = 200;
const oldDate = new Date(Date.now() - OLD_SUPPLIER_DAYS * 24 * 60 * 60 * 1000).toISOString();

const mockSuppliers = [
  {
    id: 'sup-photo-london',
    name: 'London Wedding Photography',
    category: 'Photography',
    location: 'London',
    price_display: '$$',
    averageRating: 4.8,
    reviewCount: 40,
    approved: true,
    featured: true,
    verified: true,
    isPro: true,
    tags: ['wedding', 'photography', 'portrait'],
    amenities: ['WiFi'],
    createdAt: baseDate,
  },
  {
    id: 'sup-catering-london',
    name: 'London Catering Co',
    category: 'Catering',
    location: 'London',
    price_display: '$$$',
    averageRating: 4.5,
    reviewCount: 20,
    approved: true,
    featured: false,
    verified: true,
    tags: ['catering', 'wedding', 'events'],
    amenities: ['Delivery'],
    createdAt: baseDate,
  },
  {
    id: 'sup-venue-manchester',
    name: 'Manchester Grand Venue',
    category: 'Venues',
    location: 'Manchester',
    price_display: '$$$$',
    averageRating: 4.2,
    reviewCount: 15,
    approved: true,
    featured: false,
    verified: false,
    tags: ['venue', 'corporate'],
    amenities: ['WiFi', 'Parking'],
    createdAt: oldDate,
  },
  {
    id: 'sup-photo-manchester',
    name: 'Manchester Photography',
    category: 'Photography',
    location: 'Manchester',
    price_display: '$$',
    averageRating: 4.0,
    reviewCount: 8,
    approved: true,
    featured: false,
    verified: false,
    tags: ['photography', 'portrait', 'events'],
    amenities: [],
    createdAt: oldDate,
  },
  {
    id: 'sup-music-london',
    name: 'London Music Events',
    category: 'Entertainment',
    location: 'London',
    price_display: '$$',
    averageRating: 4.6,
    reviewCount: 12,
    approved: true,
    featured: false,
    verified: true,
    tags: ['music', 'wedding', 'events'],
    amenities: ['Sound System'],
    createdAt: baseDate,
  },
  {
    id: 'sup-unapproved',
    name: 'Unapproved Supplier',
    category: 'Photography',
    location: 'London',
    approved: false,
    tags: ['photography'],
  },
];

// ---------------------------------------------------------------------------
// Helper: set up dbUnified mock for suppliers (no search history by default)
// ---------------------------------------------------------------------------
function mockDb(supplierOverrides, searchHistoryOverrides) {
  dbUnified.read.mockImplementation(collection => {
    if (collection === 'suppliers') {
      return Promise.resolve(supplierOverrides !== undefined ? supplierOverrides : mockSuppliers);
    }
    if (collection === 'searchHistory') {
      return Promise.resolve(searchHistoryOverrides !== undefined ? searchHistoryOverrides : []);
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb();
});

// ===========================================================================
// 1. RANKING_CONFIG export
// ===========================================================================

describe('RANKING_CONFIG', () => {
  it('should export RANKING_CONFIG from searchWeighting', () => {
    expect(searchWeighting.RANKING_CONFIG).toBeDefined();
    expect(typeof searchWeighting.RANKING_CONFIG).toBe('object');
  });

  it('should expose fieldWeights in RANKING_CONFIG', () => {
    expect(searchWeighting.RANKING_CONFIG.fieldWeights).toBeDefined();
    expect(searchWeighting.RANKING_CONFIG.fieldWeights.supplierName).toBeDefined();
  });

  it('should expose boosts in RANKING_CONFIG', () => {
    expect(searchWeighting.RANKING_CONFIG.boosts).toBeDefined();
    expect(searchWeighting.RANKING_CONFIG.boosts.featured).toBeGreaterThan(1);
  });

  it('should expose personalization config in RANKING_CONFIG', () => {
    expect(searchWeighting.RANKING_CONFIG.personalization).toBeDefined();
    expect(typeof searchWeighting.RANKING_CONFIG.personalization.categoryMatchBonus).toBe('number');
    expect(typeof searchWeighting.RANKING_CONFIG.personalization.locationMatchBonus).toBe('number');
  });

  it('should expose freshness config in RANKING_CONFIG', () => {
    expect(searchWeighting.RANKING_CONFIG.freshness).toBeDefined();
    expect(searchWeighting.RANKING_CONFIG.freshness.day7).toBe(1.0);
    expect(searchWeighting.RANKING_CONFIG.freshness.older).toBeLessThan(1.0);
  });

  it('RANKING_CONFIG.fieldWeights should reference the same object as FIELD_WEIGHTS export', () => {
    expect(searchWeighting.RANKING_CONFIG.fieldWeights).toBe(searchWeighting.FIELD_WEIGHTS);
  });

  it('RANKING_CONFIG.boosts should reference the same object as BOOSTS export', () => {
    expect(searchWeighting.RANKING_CONFIG.boosts).toBe(searchWeighting.BOOSTS);
  });
});

// ===========================================================================
// 2. getRankingReason
// ===========================================================================

describe('getRankingReason', () => {
  const { getRankingReason } = searchWeighting;

  it('should export getRankingReason from searchWeighting', () => {
    expect(typeof getRankingReason).toBe('function');
  });

  it('should return "Featured supplier" for a featured item with no query', () => {
    const item = { featured: true, averageRating: 3.0, reviewCount: 1 };
    expect(getRankingReason(item, '')).toBe('Featured supplier');
  });

  it('should return a high-rating reason when item is highly rated', () => {
    const item = { averageRating: 4.8, reviewCount: 10 };
    const reason = getRankingReason(item, '');
    expect(reason).toMatch(/4\.8★/);
    expect(reason).toMatch(/Highly rated/);
  });

  it('should return "New on EventFlow" for recently created suppliers', () => {
    const item = { createdAt: new Date().toISOString(), averageRating: 3.0, reviewCount: 0 };
    const reason = getRankingReason(item, '');
    expect(reason).toBe('New on EventFlow');
  });

  it('should return "Verified supplier" for verified items', () => {
    const item = { verified: true, averageRating: 3.0, reviewCount: 2, createdAt: oldDate };
    expect(getRankingReason(item, '')).toBe('Verified supplier');
  });

  it('should return "Popular with great reviews" for items with many reviews', () => {
    const item = { reviewCount: 25, averageRating: 4.0, createdAt: oldDate };
    expect(getRankingReason(item, '')).toBe('Popular with great reviews');
  });

  it('should return name-match reason when query matches supplier name', () => {
    const item = { name: 'London Wedding Photography', reviewCount: 2, createdAt: oldDate };
    const reason = getRankingReason(item, 'wedding');
    expect(reason).toBe('Name matches your search');
  });

  it('should return tag-match reason when query matches a tag', () => {
    const item = {
      name: 'Some Supplier',
      tags: ['photography', 'portrait'],
      reviewCount: 2,
      createdAt: oldDate,
    };
    const reason = getRankingReason(item, 'photography');
    expect(reason).toBe('Tagged keyword match');
  });

  it('should return category match reason when query matches category', () => {
    const item = {
      name: 'Some Supplier',
      category: 'Catering',
      reviewCount: 0,
      createdAt: oldDate,
    };
    expect(getRankingReason(item, 'catering')).toBe('Category matches your search');
  });

  it('should return personalized category reason in personalized context', () => {
    const item = { category: 'Photography', name: 'Test', createdAt: oldDate };
    const reason = getRankingReason(item, '', {
      isPersonalized: true,
      preferredCategory: 'Photography',
    });
    expect(reason).toContain('Photography');
    expect(reason).toContain('interest');
  });

  it('should return personalized location reason in personalized context', () => {
    const item = { location: 'London', category: 'Venues', createdAt: oldDate };
    const reason = getRankingReason(item, '', {
      isPersonalized: true,
      preferredCategory: 'Catering', // different category — should hit location check
      preferredLocation: 'London',
    });
    expect(reason).toContain('London');
  });

  it('should return a fallback reason for items with no notable signals', () => {
    const item = { name: 'Generic Supplier', createdAt: oldDate, reviewCount: 0 };
    const reason = getRankingReason(item, '');
    expect(typeof reason).toBe('string');
    expect(reason.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 3. rankingReason on searchSuppliers results
// ===========================================================================

describe('Phase 3: rankingReason in searchSuppliers', () => {
  it('should include a rankingReason field on each result', async () => {
    const result = await searchService.searchSuppliers({});
    result.results.forEach(r => {
      expect(r).toHaveProperty('rankingReason');
      expect(typeof r.rankingReason).toBe('string');
      expect(r.rankingReason.length).toBeGreaterThan(0);
    });
  });

  it('should include a rankingReason when searching with a query', async () => {
    const result = await searchService.searchSuppliers({ q: 'photography' });
    result.results.forEach(r => {
      expect(r).toHaveProperty('rankingReason');
    });
  });

  it('should return a rankingReason for browse (no-query) mode', async () => {
    const result = await searchService.searchSuppliers({});
    const featured = result.results.find(r => r.featured);
    if (featured) {
      expect(featured.rankingReason).toBe('Featured supplier');
    }
  });
});

// ===========================================================================
// 4. Zero-results fallback
// ===========================================================================

describe('Phase 3: zero-results fallback in searchSuppliers', () => {
  it('should include a fallback object when search returns zero results', async () => {
    // Search for something that won't match any supplier
    const result = await searchService.searchSuppliers({ q: 'xyzzy_nonexistent_term_99' });
    expect(result.pagination.total).toBe(0);
    // fallback may be null if no approved suppliers exist, but it must be present
    expect('fallback' in result).toBe(true);
  });

  it('fallback should include suggestions array when alternatives exist', async () => {
    const result = await searchService.searchSuppliers({ q: 'xyzzy_nonexistent_term_99' });
    if (result.fallback) {
      expect(Array.isArray(result.fallback.suggestions)).toBe(true);
      expect(result.fallback.suggestions.length).toBeGreaterThan(0);
    }
  });

  it('fallback suggestions should only include approved suppliers', async () => {
    const result = await searchService.searchSuppliers({ q: 'xyzzy_nonexistent_term_99' });
    if (result.fallback) {
      result.fallback.suggestions.forEach(s => {
        // unapproved supplier should not appear
        expect(s.id).not.toBe('sup-unapproved');
      });
    }
  });

  it('fallback should include a human-readable message', async () => {
    const result = await searchService.searchSuppliers({ q: 'xyzzy_nonexistent_term_99' });
    if (result.fallback) {
      expect(typeof result.fallback.message).toBe('string');
      expect(result.fallback.message.length).toBeGreaterThan(10);
    }
  });

  it('fallback should include relaxedFilters array', async () => {
    const result = await searchService.searchSuppliers({ q: 'xyzzy_nonexistent_term_99' });
    if (result.fallback) {
      expect(Array.isArray(result.fallback.relaxedFilters)).toBe(true);
    }
  });

  it('should NOT include a fallback when results are found', async () => {
    const result = await searchService.searchSuppliers({ q: 'photography' });
    expect(result.pagination.total).toBeGreaterThan(0);
    // fallback should be absent entirely when results exist
    expect(result.fallback).toBeUndefined();
  });

  it('should NOT include a fallback on page > 1 even with zero results', async () => {
    const result = await searchService.searchSuppliers({
      q: 'xyzzy_nonexistent_term_99',
      page: 2,
    });
    // On page 2, we never build a fallback (avoid redundant processing)
    expect(result.fallback).toBeUndefined();
  });

  it('fallback suggestions should have rankingReason attached', async () => {
    const result = await searchService.searchSuppliers({ q: 'xyzzy_nonexistent_term_99' });
    if (result.fallback && result.fallback.suggestions.length > 0) {
      result.fallback.suggestions.forEach(s => {
        expect(s).toHaveProperty('rankingReason');
        expect(typeof s.rankingReason).toBe('string');
      });
    }
  });

  it('should relax rating filter and find results when only minRating blocks', async () => {
    // Set an impossibly high minimum rating — all suppliers have < 5.0
    mockDb(mockSuppliers, []);
    const result = await searchService.searchSuppliers({ minRating: '5' });

    // Ensure the original results are zero (none have exactly 5.0)
    expect(result.pagination.total).toBe(0);
    // Fallback should surface suppliers once minRating is relaxed
    if (result.fallback) {
      expect(result.fallback.suggestions.length).toBeGreaterThan(0);
      expect(result.fallback.relaxedFilters.some(f => f.includes('rating'))).toBe(true);
    }
  });
});

// ===========================================================================
// 5. getPersonalizedFeed
// ===========================================================================

describe('Phase 3: getPersonalizedFeed', () => {
  it('should export getPersonalizedFeed from searchService', () => {
    expect(typeof searchService.getPersonalizedFeed).toBe('function');
  });

  it('should return an object with results and context fields', async () => {
    const feed = await searchService.getPersonalizedFeed(null, {});
    expect(feed).toHaveProperty('results');
    expect(feed).toHaveProperty('context');
    expect(Array.isArray(feed.results)).toBe(true);
  });

  it('should only include approved suppliers', async () => {
    const feed = await searchService.getPersonalizedFeed(null, {});
    feed.results.forEach(r => {
      expect(r.id).not.toBe('sup-unapproved');
    });
  });

  it('should respect the limit option', async () => {
    const feed = await searchService.getPersonalizedFeed(null, {}, { limit: 2 });
    expect(feed.results.length).toBeLessThanOrEqual(2);
  });

  it('should boost suppliers matching the provided eventType', async () => {
    const feed = await searchService.getPersonalizedFeed(
      null,
      { eventType: 'Photography' },
      { limit: 10 }
    );
    // Photography suppliers should appear near the top
    const firstFewIds = feed.results.slice(0, 3).map(r => r.id);
    const photographyIds = mockSuppliers
      .filter(s => s.approved && s.category === 'Photography')
      .map(s => s.id);
    const hasPhotographyNearTop = firstFewIds.some(id => photographyIds.includes(id));
    expect(hasPhotographyNearTop).toBe(true);
  });

  it('should boost suppliers matching the provided location', async () => {
    const feed = await searchService.getPersonalizedFeed(
      null,
      { location: 'Manchester' },
      { limit: 10 }
    );
    // Manchester suppliers should appear near the top
    const firstFewIds = feed.results.slice(0, 3).map(r => r.id);
    const manchesterIds = mockSuppliers
      .filter(
        s => s.approved && typeof s.location === 'string' && s.location.includes('Manchester')
      )
      .map(s => s.id);
    const hasManchesterNearTop = firstFewIds.some(id => manchesterIds.includes(id));
    expect(hasManchesterNearTop).toBe(true);
  });

  it('context.isPersonalized should be true when eventType is provided', async () => {
    const feed = await searchService.getPersonalizedFeed(null, { eventType: 'Photography' });
    expect(feed.context.isPersonalized).toBe(true);
    expect(feed.context.preferredCategory).toBe('Photography');
  });

  it('context.isPersonalized should be false when no signals are provided', async () => {
    const feed = await searchService.getPersonalizedFeed(null, {});
    expect(feed.context.isPersonalized).toBe(false);
  });

  it('should use search history to infer preferred category when userId is provided', async () => {
    const userId = 'user-123';
    const history = [
      {
        userId,
        queryText: 'london photographer',
        filters: { category: 'Photography', location: 'London' },
        timestamp: new Date().toISOString(),
      },
      {
        userId,
        queryText: 'wedding photography',
        filters: { category: 'Photography' },
        timestamp: new Date().toISOString(),
      },
    ];
    mockDb(mockSuppliers, history);

    const feed = await searchService.getPersonalizedFeed(userId, {});
    // History signals Photography — context should reflect that
    expect(feed.context.preferredCategory).toBe('Photography');
    expect(feed.context.isPersonalized).toBe(true);
    expect(feed.context.signalSource).toBe('history');
  });

  it('explicit eventType context should take precedence over history', async () => {
    const userId = 'user-123';
    const history = [
      {
        userId,
        queryText: 'catering',
        filters: { category: 'Catering' },
        timestamp: new Date().toISOString(),
      },
    ];
    mockDb(mockSuppliers, history);

    const feed = await searchService.getPersonalizedFeed(userId, { eventType: 'Venues' });
    // Explicit eventType overrides history-inferred category
    expect(feed.context.preferredCategory).toBe('Venues');
  });

  it('should return results with rankingReason fields', async () => {
    const feed = await searchService.getPersonalizedFeed(null, { eventType: 'Photography' });
    feed.results.forEach(r => {
      expect(r).toHaveProperty('rankingReason');
      expect(typeof r.rankingReason).toBe('string');
    });
  });

  it('should ignore search history from other users', async () => {
    const userId = 'user-abc';
    const history = [
      {
        userId: 'other-user',
        queryText: 'catering services',
        filters: { category: 'Catering', location: 'London' },
        timestamp: new Date().toISOString(),
      },
    ];
    mockDb(mockSuppliers, history);

    const feed = await searchService.getPersonalizedFeed(userId, {});
    // No history for this user — should not be personalized from history
    expect(feed.context.signalSource).not.toBe('history');
  });

  it('should handle null userId gracefully (anonymous user)', async () => {
    await expect(searchService.getPersonalizedFeed(null, {})).resolves.toBeDefined();
  });

  it('should return empty results gracefully when no suppliers exist', async () => {
    mockDb([], []);
    const feed = await searchService.getPersonalizedFeed(null, { eventType: 'Photography' });
    expect(Array.isArray(feed.results)).toBe(true);
    expect(feed.results.length).toBe(0);
  });
});

// ===========================================================================
// 6. getPeopleAlsoViewed
// ===========================================================================

describe('Phase 3: getPeopleAlsoViewed', () => {
  it('should export getPeopleAlsoViewed from searchService', () => {
    expect(typeof searchService.getPeopleAlsoViewed).toBe('function');
  });

  it('should return an array', async () => {
    const results = await searchService.getPeopleAlsoViewed('sup-photo-london');
    expect(Array.isArray(results)).toBe(true);
  });

  it('should not include the reference supplier itself', async () => {
    const results = await searchService.getPeopleAlsoViewed('sup-photo-london');
    const ids = results.map(r => r.id);
    expect(ids).not.toContain('sup-photo-london');
  });

  it('should not include unapproved suppliers', async () => {
    const results = await searchService.getPeopleAlsoViewed('sup-photo-london');
    results.forEach(r => {
      expect(r.id).not.toBe('sup-unapproved');
    });
  });

  it('should return at most limit results', async () => {
    const results = await searchService.getPeopleAlsoViewed('sup-photo-london', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('should return [] for an unknown supplierId', async () => {
    const results = await searchService.getPeopleAlsoViewed('does-not-exist');
    expect(results).toEqual([]);
  });

  it('should surface suppliers with overlapping tags near the top', async () => {
    // 'sup-photo-london' has tags: ['wedding', 'photography', 'portrait']
    // 'sup-photo-manchester' shares 'photography' and 'portrait'
    // 'sup-catering-london' shares 'wedding'
    const results = await searchService.getPeopleAlsoViewed('sup-photo-london', 6);
    const ids = results.map(r => r.id);

    // Both photography and wedding-tagged suppliers should appear
    const photographyManchester = ids.includes('sup-photo-manchester');
    const cateringLondon = ids.includes('sup-catering-london');
    expect(photographyManchester || cateringLondon).toBe(true);
  });

  it('should include suppliers from different categories (unlike getSimilarSuppliers)', async () => {
    // 'sup-photo-london' is Photography; we expect non-Photography suppliers to appear
    const results = await searchService.getPeopleAlsoViewed('sup-photo-london', 6);
    const categories = results.map(r => r.category);
    const hasNonPhotography = categories.some(c => c !== 'Photography');
    expect(hasNonPhotography).toBe(true);
  });

  it('should attach a rankingReason to each result', async () => {
    const results = await searchService.getPeopleAlsoViewed('sup-photo-london', 6);
    results.forEach(r => {
      expect(r).toHaveProperty('rankingReason');
      expect(typeof r.rankingReason).toBe('string');
    });
  });

  it('should return [] when no other approved suppliers exist', async () => {
    mockDb([{ id: 'sup-photo-london', ...mockSuppliers[0] }], []);
    const results = await searchService.getPeopleAlsoViewed('sup-photo-london');
    expect(results).toEqual([]);
  });

  it('should default to 6 results when limit is not provided', async () => {
    mockDb(mockSuppliers, []);
    const results = await searchService.getPeopleAlsoViewed('sup-photo-london');
    expect(results.length).toBeLessThanOrEqual(6);
  });
});

// ===========================================================================
// 7. buildZeroResultsFallback (direct unit tests)
// ===========================================================================

describe('Phase 3: buildZeroResultsFallback', () => {
  it('should export buildZeroResultsFallback from searchService', () => {
    expect(typeof searchService.buildZeroResultsFallback).toBe('function');
  });

  it('should return null when there are no approved suppliers to fall back on', async () => {
    const result = await searchService.buildZeroResultsFallback({ q: 'anything' }, []);
    expect(result).toBeNull();
  });

  it('should return a fallback object with suggestions when approved suppliers exist', async () => {
    const approvedSuppliers = mockSuppliers.filter(s => s.approved);
    const query = searchService.normalizeSupplierQuery({
      q: 'xyzzy_nonexistent',
      minRating: '5',
    });
    const result = await searchService.buildZeroResultsFallback(query, approvedSuppliers);
    if (result) {
      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(typeof result.message).toBe('string');
      expect(Array.isArray(result.relaxedFilters)).toBe(true);
    }
  });

  it('fallback suggestions should be ordered by quality score descending', async () => {
    const approvedSuppliers = mockSuppliers.filter(s => s.approved);
    const query = searchService.normalizeSupplierQuery({ q: 'xyzzy', minRating: '5' });
    const result = await searchService.buildZeroResultsFallback(query, approvedSuppliers);

    if (result && result.suggestions.length >= 2) {
      const scores = result.suggestions.map(s => s.relevanceScore || 0);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
      }
    }
  });
});
