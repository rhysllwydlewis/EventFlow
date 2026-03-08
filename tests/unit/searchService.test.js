/**
 * Unit tests for search service
 */

'use strict';

const searchService = require('../../services/searchService');
const dbUnified = require('../../db-unified');

// Mock dbUnified
jest.mock('../../db-unified');

describe('Search Service', () => {
  const mockSuppliers = [
    {
      id: 'sup1',
      name: 'Wedding Photography Studio',
      description_short: 'Professional wedding photography',
      description_long: 'We specialize in beautiful wedding photography',
      category: 'Photography',
      location: 'London',
      price_display: '$$',
      averageRating: 4.8,
      reviewCount: 50,
      approved: true,
      featured: true,
      verified: true,
      isPro: true,
      amenities: ['WiFi', 'Parking'],
      tags: ['wedding', 'photography', 'professional'],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'sup2',
      name: 'Event Catering Services',
      description_short: 'Catering for all events',
      description_long: 'Professional catering services',
      category: 'Catering',
      location: 'Manchester',
      price_display: '$$$',
      averageRating: 4.5,
      reviewCount: 30,
      approved: true,
      featured: false,
      verified: false,
      isPro: false,
      amenities: ['Delivery', 'Setup'],
      tags: ['catering', 'events'],
      createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'sup3',
      name: 'Venue Spaces',
      description_short: 'Beautiful venues',
      description_long: 'Wedding and event venues',
      category: 'Venues',
      location: 'London',
      price_display: '$$$$',
      averageRating: 4.2,
      reviewCount: 15,
      approved: true,
      featured: false,
      verified: true,
      isPro: false,
      amenities: ['WiFi', 'Parking', 'Catering'],
      tags: ['venues', 'wedding'],
      createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'sup4',
      name: 'Unapproved Supplier',
      category: 'Other',
      approved: false,
    },
  ];

  const mockPackages = [
    {
      id: 'pkg1',
      supplierId: 'sup1',
      title: 'Wedding Photography Package',
      description: 'Full day wedding photography',
      price: 1500,
      approved: true,
      featured: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'pkg2',
      supplierId: 'sup2',
      title: 'Catering Package',
      description: 'Premium catering for 100 guests',
      price: 5000,
      approved: true,
      featured: false,
      createdAt: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'pkg3',
      supplierId: 'sup4',
      title: 'Unapproved Package',
      approved: false,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'suppliers') {
        return Promise.resolve([...mockSuppliers]);
      }
      if (collection === 'packages') {
        return Promise.resolve([...mockPackages]);
      }
      return Promise.resolve([]);
    });
  });

  describe('searchSuppliers', () => {
    it('should return all approved suppliers when no query', async () => {
      const result = await searchService.searchSuppliers({});

      expect(result.results.length).toBe(3);
      expect(result.results.every(s => s.approved)).toBe(true);
    });

    it('should filter suppliers by text query', async () => {
      const result = await searchService.searchSuppliers({ q: 'wedding' });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].id).toBe('sup1');
    });

    it('should filter by category', async () => {
      const result = await searchService.searchSuppliers({ category: 'Photography' });

      expect(result.results.length).toBe(1);
      expect(result.results[0].category).toBe('Photography');
    });

    it('should filter by location', async () => {
      const result = await searchService.searchSuppliers({ location: 'London' });

      expect(result.results.length).toBe(2);
      expect(result.results.every(s => s.location === 'London')).toBe(true);
    });

    it('should filter by minimum rating', async () => {
      const result = await searchService.searchSuppliers({ minRating: 4.7 });

      expect(result.results.length).toBe(1);
      expect(result.results[0].averageRating).toBeGreaterThanOrEqual(4.7);
    });

    it('should filter by pro only', async () => {
      const result = await searchService.searchSuppliers({ proOnly: 'true' });

      expect(result.results.every(s => s.isPro)).toBe(true);
    });

    it('should filter by featured only', async () => {
      const result = await searchService.searchSuppliers({ featuredOnly: 'true' });

      expect(result.results.every(s => s.featured)).toBe(true);
    });

    it('should filter by verified only', async () => {
      const result = await searchService.searchSuppliers({ verifiedOnly: 'true' });

      expect(result.results.every(s => s.verified)).toBe(true);
    });

    it('should filter by amenities', async () => {
      const result = await searchService.searchSuppliers({
        amenities: ['WiFi', 'Parking'],
      });

      expect(result.results.length).toBeGreaterThan(0);
      result.results.forEach(s => {
        expect(s.amenities).toContain('WiFi');
        expect(s.amenities).toContain('Parking');
      });
    });

    it('should sort by relevance when query provided', async () => {
      const result = await searchService.searchSuppliers({
        q: 'wedding',
        sortBy: 'relevance',
      });

      // First result should have highest relevance score
      if (result.results.length > 1) {
        expect(result.results[0].relevanceScore).toBeGreaterThanOrEqual(
          result.results[1].relevanceScore
        );
      }
    });

    it('should sort by rating', async () => {
      const result = await searchService.searchSuppliers({ sortBy: 'rating' });

      if (result.results.length > 1) {
        expect(result.results[0].averageRating).toBeGreaterThanOrEqual(
          result.results[1].averageRating
        );
      }
    });

    it('should sort by name alphabetically', async () => {
      const result = await searchService.searchSuppliers({ sortBy: 'name' });

      if (result.results.length > 1) {
        expect(result.results[0].name.localeCompare(result.results[1].name)).toBeLessThanOrEqual(0);
      }
    });

    it('should paginate results', async () => {
      const page1 = await searchService.searchSuppliers({ page: 1, limit: 2 });
      const page2 = await searchService.searchSuppliers({ page: 2, limit: 2 });

      expect(page1.results.length).toBeLessThanOrEqual(2);
      expect(page1.pagination.page).toBe(1);
      expect(page2.pagination.page).toBe(2);
    });

    it('should include relevance scores when query provided', async () => {
      const result = await searchService.searchSuppliers({ q: 'wedding' });

      result.results.forEach(s => {
        expect(s.relevanceScore).toBeDefined();
        expect(typeof s.relevanceScore).toBe('number');
      });
    });

    it('should include match information', async () => {
      const result = await searchService.searchSuppliers({ q: 'wedding' });

      result.results.forEach(s => {
        expect(s.match).toBeDefined();
        expect(s.match.fields).toBeDefined();
        expect(Array.isArray(s.match.fields)).toBe(true);
      });
    });

    it('should return facets', async () => {
      const result = await searchService.searchSuppliers({});

      expect(result.facets).toBeDefined();
      expect(result.facets.categories).toBeDefined();
      expect(result.facets.ratings).toBeDefined();
      expect(result.facets.priceRanges).toBeDefined();
      expect(result.facets.amenities).toBeDefined();
    });

    it('should return pagination information', async () => {
      const result = await searchService.searchSuppliers({ page: 1, limit: 10 });

      expect(result.pagination).toBeDefined();
      expect(result.pagination.total).toBeDefined();
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.pages).toBeDefined();
    });

    it('should return duration in milliseconds', async () => {
      const result = await searchService.searchSuppliers({});

      expect(result.durationMs).toBeDefined();
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should limit results to max 100 per page', async () => {
      const result = await searchService.searchSuppliers({ limit: 500 });

      expect(result.pagination.limit).toBeLessThanOrEqual(100);
    });

    it('should filter out zero-score results when query provided', async () => {
      const result = await searchService.searchSuppliers({ q: 'nonexistent' });

      expect(result.results.length).toBe(0);
    });
  });

  describe('searchPackages', () => {
    it('should return approved packages from approved suppliers', async () => {
      const result = await searchService.searchPackages({});

      expect(result.results.length).toBe(2);
      expect(result.results.every(p => p.approved)).toBe(true);
    });

    it('should include supplier information with packages', async () => {
      const result = await searchService.searchPackages({});

      result.results.forEach(pkg => {
        expect(pkg.supplier).toBeDefined();
        expect(pkg.supplier.id).toBeDefined();
        expect(pkg.supplier.name).toBeDefined();
      });
    });

    it('should filter packages by text query', async () => {
      const result = await searchService.searchPackages({ q: 'wedding' });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].title.toLowerCase()).toContain('wedding');
    });

    it('should filter packages by category (from supplier)', async () => {
      const result = await searchService.searchPackages({ category: 'Photography' });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].supplier.id).toBe('sup1');
    });

    it('should filter packages by location (from supplier)', async () => {
      const result = await searchService.searchPackages({ location: 'London' });

      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should filter packages by price range', async () => {
      const result = await searchService.searchPackages({
        minPrice: 1000,
        maxPrice: 2000,
      });

      result.results.forEach(pkg => {
        expect(pkg.price).toBeGreaterThanOrEqual(1000);
        expect(pkg.price).toBeLessThanOrEqual(2000);
      });
    });

    it('should sort packages by price ascending', async () => {
      const result = await searchService.searchPackages({ sortBy: 'priceAsc' });

      if (result.results.length > 1) {
        expect(result.results[0].price).toBeLessThanOrEqual(result.results[1].price);
      }
    });

    it('should sort packages by price descending', async () => {
      const result = await searchService.searchPackages({ sortBy: 'priceDesc' });

      if (result.results.length > 1) {
        expect(result.results[0].price).toBeGreaterThanOrEqual(result.results[1].price);
      }
    });

    it('should include relevance scores when query provided', async () => {
      const result = await searchService.searchPackages({ q: 'wedding' });

      result.results.forEach(pkg => {
        expect(pkg.relevanceScore).toBeDefined();
      });
    });

    it('should paginate package results', async () => {
      const result = await searchService.searchPackages({ page: 1, limit: 1 });

      expect(result.results.length).toBe(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(1);
    });

    it('should return duration', async () => {
      const result = await searchService.searchPackages({});

      expect(result.durationMs).toBeDefined();
      expect(typeof result.durationMs).toBe('number');
    });
  });

  describe('advancedSearch', () => {
    it('should search suppliers by default', async () => {
      const result = await searchService.advancedSearch({ q: 'wedding' });

      expect(result.results).toBeDefined();
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should search packages when type is specified', async () => {
      const result = await searchService.advancedSearch({
        type: 'packages',
        q: 'wedding',
      });

      expect(result.results).toBeDefined();
      expect(result.results[0].title).toBeDefined();
    });

    it('should apply all search criteria', async () => {
      const result = await searchService.advancedSearch({
        q: 'wedding',
        category: 'Photography',
        location: 'London',
        minRating: 4.5,
      });

      expect(result.results).toBeDefined();
    });

    it('should return duration', async () => {
      const result = await searchService.advancedSearch({});

      expect(result.durationMs).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      dbUnified.read.mockRejectedValue(new Error('Database error'));

      await expect(searchService.searchSuppliers({})).rejects.toThrow();
    });

    it('should handle empty database results', async () => {
      dbUnified.read.mockResolvedValue([]);

      const result = await searchService.searchSuppliers({});

      expect(result.results).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });

    it('should handle malformed supplier data', async () => {
      dbUnified.read.mockResolvedValue([
        { id: 'test', approved: true }, // Minimal data
      ]);

      const result = await searchService.searchSuppliers({ q: 'test' });

      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
    });
  });

  describe('New Filters (Phase 4)', () => {
    it('should filter by eventType matching category', async () => {
      const result = await searchService.searchSuppliers({ eventType: 'photography' });

      expect(result.results.length).toBe(1);
      expect(result.results[0].id).toBe('sup1');
    });

    it('should filter by eventType matching tags', async () => {
      const result = await searchService.searchSuppliers({ eventType: 'catering' });

      expect(result.results.length).toBeGreaterThan(0);
      result.results.forEach(s => {
        const catMatch = (s.category || '').toLowerCase().includes('catering');
        // tags are not projected in public fields, so category match is sufficient here
        expect(catMatch).toBe(true);
      });
    });

    it('should filter by price level using £ symbols', async () => {
      // Use mockImplementation to return suppliers with £ price_display
      dbUnified.read.mockImplementation(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([
            {
              id: 'gbp1',
              name: 'Budget Florist',
              category: 'Decor',
              location: 'London',
              price_display: '£',
              averageRating: 4.0,
              approved: true,
            },
            {
              id: 'gbp2',
              name: 'Premium Florist',
              category: 'Decor',
              location: 'London',
              price_display: '£££',
              averageRating: 4.5,
              approved: true,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await searchService.searchSuppliers({ minPrice: 1, maxPrice: 1 });

      expect(result.results.length).toBe(1);
      expect(result.results[0].id).toBe('gbp1');
    });

    it('should sort by distance falling back to relevance when no postcode provided', async () => {
      const result = await searchService.searchSuppliers({ sortBy: 'distance' });

      // No postcode provided — falls back to relevance order; should not throw
      expect(result.results).toBeDefined();
      expect(result.results.length).toBe(3);
    });

    it('should sort by priceAsc supporting £ symbols', async () => {
      dbUnified.read.mockImplementation(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([
            { id: 'gp1', name: 'A', category: 'X', price_display: '£££', approved: true },
            { id: 'gp2', name: 'B', category: 'X', price_display: '£', approved: true },
            { id: 'gp3', name: 'C', category: 'X', price_display: '££', approved: true },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await searchService.searchSuppliers({ sortBy: 'priceAsc' });

      expect(result.results[0].id).toBe('gp2'); // £
      expect(result.results[1].id).toBe('gp3'); // ££
      expect(result.results[2].id).toBe('gp1'); // £££
    });

    it('should sort by priceDesc supporting £ symbols', async () => {
      dbUnified.read.mockImplementation(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([
            { id: 'gp1', name: 'A', category: 'X', price_display: '£££', approved: true },
            { id: 'gp2', name: 'B', category: 'X', price_display: '£', approved: true },
            { id: 'gp3', name: 'C', category: 'X', price_display: '££', approved: true },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await searchService.searchSuppliers({ sortBy: 'priceDesc' });

      expect(result.results[0].id).toBe('gp1'); // £££
      expect(result.results[1].id).toBe('gp3'); // ££
      expect(result.results[2].id).toBe('gp2'); // £
    });

    it('should not crash when minRating is NaN', async () => {
      const result = await searchService.searchSuppliers({ minRating: 'notanumber' });
      expect(result.results.length).toBe(3);
    });

    it('should skip minRating filter when value is empty string', async () => {
      const result = await searchService.searchSuppliers({ minRating: '' });
      expect(result.results.length).toBe(3);
    });

    it('should not crash when minPrice is NaN', async () => {
      const result = await searchService.searchSuppliers({ minPrice: 'bad', maxPrice: 'bad' });
      expect(result.results.length).toBe(3);
    });
  });

  describe('Distance and geo filtering', () => {
    // Note: geocodeLocation is called internally. In test environment it returns
    // mock coordinates for known postcodes (see utils/geocoding.js test handling).

    it('should return all results when no postcode is provided with distance sort', async () => {
      const result = await searchService.searchSuppliers({ sortBy: 'distance' });
      expect(result.results).toBeDefined();
      expect(result.results.length).toBe(3);
    });

    it('should filter by maxDistance when supplier has GeoJSON coordinates', async () => {
      dbUnified.read.mockImplementation(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([
            {
              id: 'near',
              name: 'Near Supplier',
              category: 'Venues',
              approved: true,
              // Cardiff coordinates
              location: { type: 'Point', coordinates: [-3.1791, 51.4816] },
            },
            {
              id: 'far',
              name: 'Far Supplier',
              category: 'Catering',
              approved: true,
              // London coordinates
              location: { type: 'Point', coordinates: [-0.1278, 51.5074] },
            },
          ]);
        }
        return Promise.resolve([]);
      });

      // postcode 'CF10 1AA' geocodes to Cardiff in test env; maxDistance 5 miles
      const result = await searchService.searchSuppliers({
        postcode: 'CF10 1AA',
        maxDistance: 5,
      });

      // Only the near (Cardiff) supplier should be within 5 miles of Cardiff
      expect(result.results.find(r => r.id === 'near')).toBeDefined();
      expect(result.results.find(r => r.id === 'far')).toBeUndefined();
    });

    it('should include distanceMiles on results when postcode is provided', async () => {
      dbUnified.read.mockImplementation(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([
            {
              id: 'geo1',
              name: 'Geo Supplier',
              category: 'Venues',
              approved: true,
              location: { type: 'Point', coordinates: [-3.1791, 51.4816] },
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await searchService.searchSuppliers({ postcode: 'CF10 1AA' });
      const supplier = result.results[0];
      expect(supplier).toBeDefined();
      expect(supplier.distanceMiles).toBeDefined();
      expect(typeof supplier.distanceMiles).toBe('number');
    });

    it('should sort by distance nearest first when postcode is provided', async () => {
      dbUnified.read.mockImplementation(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([
            {
              id: 'london',
              name: 'London Supplier',
              category: 'Venues',
              approved: true,
              location: { type: 'Point', coordinates: [-0.1278, 51.5074] },
            },
            {
              id: 'cardiff',
              name: 'Cardiff Supplier',
              category: 'Venues',
              approved: true,
              location: { type: 'Point', coordinates: [-3.1791, 51.4816] },
            },
          ]);
        }
        return Promise.resolve([]);
      });

      // Searching near Cardiff — Cardiff supplier should be first
      const result = await searchService.searchSuppliers({
        postcode: 'CF10 1AA',
        sortBy: 'distance',
      });

      expect(result.results[0].id).toBe('cardiff');
      expect(result.results[1].id).toBe('london');
    });

    it('should not expose _distanceMiles internal field on results', async () => {
      dbUnified.read.mockImplementation(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([
            {
              id: 'geo2',
              name: 'Geo Supplier',
              category: 'Venues',
              approved: true,
              location: { type: 'Point', coordinates: [-3.1791, 51.4816] },
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await searchService.searchSuppliers({ postcode: 'CF10 1AA' });
      const supplier = result.results[0];
      expect(supplier).toBeDefined();
      expect(supplier._distanceMiles).toBeUndefined();
    });

    it('should include suppliers without coordinates when no maxDistance filter', async () => {
      dbUnified.read.mockImplementation(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([
            {
              id: 'no-coords',
              name: 'No Coords Supplier',
              category: 'Venues',
              approved: true,
              location: 'Birmingham',
            },
            {
              id: 'with-coords',
              name: 'Coords Supplier',
              category: 'Venues',
              approved: true,
              location: { type: 'Point', coordinates: [-3.1791, 51.4816] },
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await searchService.searchSuppliers({ postcode: 'CF10 1AA' });
      // Both suppliers should be included (no maxDistance filter)
      expect(result.results.length).toBe(2);
    });

    it('should exclude suppliers without coordinates when maxDistance is set', async () => {
      dbUnified.read.mockImplementation(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([
            {
              id: 'no-coords',
              name: 'No Coords Supplier',
              category: 'Venues',
              approved: true,
              location: 'Birmingham',
            },
            {
              id: 'near',
              name: 'Near Supplier',
              category: 'Venues',
              approved: true,
              location: { type: 'Point', coordinates: [-3.1791, 51.4816] },
            },
          ]);
        }
        return Promise.resolve([]);
      });

      // maxDistance=5 — supplier without coordinates should be excluded
      const result = await searchService.searchSuppliers({
        postcode: 'CF10 1AA',
        maxDistance: 5,
      });
      expect(result.results.find(r => r.id === 'no-coords')).toBeUndefined();
      expect(result.results.find(r => r.id === 'near')).toBeDefined();
    });

    it('should treat location as text filter even when other suppliers have GeoJSON', async () => {
      dbUnified.read.mockImplementation(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([
            {
              id: 'geo-london',
              name: 'London Venue',
              category: 'Venues',
              approved: true,
              location: { type: 'Point', coordinates: [-0.1278, 51.5074] },
            },
            {
              id: 'str-manchester',
              name: 'Manchester Venue',
              category: 'Venues',
              approved: true,
              location: 'Manchester',
            },
          ]);
        }
        return Promise.resolve([]);
      });

      // GeoJSON location field should not cause TypeError in text filter
      const result = await searchService.searchSuppliers({ location: 'Manchester' });
      expect(result.results.length).toBe(1);
      expect(result.results[0].id).toBe('str-manchester');
    });
  });

  describe('normalizeSupplierQuery', () => {
    const { normalizeSupplierQuery } = searchService;

    it('should default sortBy to relevance for unknown values', () => {
      const result = normalizeSupplierQuery({ sortBy: 'bogusSort' });
      expect(result.sortBy).toBe('relevance');
    });

    it('should accept all valid sortBy values', () => {
      const { VALID_SUPPLIER_SORT_VALUES } = searchService;
      VALID_SUPPLIER_SORT_VALUES.forEach(sort => {
        const result = normalizeSupplierQuery({ sortBy: sort });
        expect(result.sortBy).toBe(sort);
      });
    });

    it('should clamp page to minimum of 1', () => {
      expect(normalizeSupplierQuery({ page: 0 }).page).toBe(1);
      expect(normalizeSupplierQuery({ page: -5 }).page).toBe(1);
      expect(normalizeSupplierQuery({ page: 'abc' }).page).toBe(1);
    });

    it('should clamp limit to maximum of 100', () => {
      expect(normalizeSupplierQuery({ limit: 500 }).limit).toBe(100);
      expect(normalizeSupplierQuery({ limit: 0 }).limit).toBe(1);
    });

    it('should truncate q to 200 characters', () => {
      const longQuery = 'a'.repeat(300);
      const result = normalizeSupplierQuery({ q: longQuery });
      expect(result.q.length).toBe(200);
    });

    it('should trim q whitespace', () => {
      const result = normalizeSupplierQuery({ q: '  wedding  ' });
      expect(result.q).toBe('wedding');
    });

    it('should split amenities CSV string into array', () => {
      const result = normalizeSupplierQuery({ amenities: 'WiFi, Parking, Catering' });
      expect(Array.isArray(result.amenities)).toBe(true);
      expect(result.amenities).toContain('WiFi');
      expect(result.amenities).toContain('Parking');
      expect(result.amenities).toContain('Catering');
    });

    it('should preserve amenities array as-is', () => {
      const amenities = ['WiFi', 'Parking'];
      const result = normalizeSupplierQuery({ amenities });
      expect(result.amenities).toEqual(amenities);
    });

    it('should discard invalid minRating', () => {
      expect(normalizeSupplierQuery({ minRating: 'bad' }).minRating).toBeUndefined();
      expect(normalizeSupplierQuery({ minRating: '' }).minRating).toBeUndefined();
    });

    it('should discard invalid maxDistance', () => {
      expect(normalizeSupplierQuery({ maxDistance: 'bad' }).maxDistance).toBeUndefined();
      expect(normalizeSupplierQuery({ maxDistance: -1 }).maxDistance).toBeUndefined();
      expect(normalizeSupplierQuery({ maxDistance: 600 }).maxDistance).toBeUndefined();
    });

    it('should accept valid maxDistance', () => {
      expect(normalizeSupplierQuery({ maxDistance: 50 }).maxDistance).toBe(50);
    });

    it('should truncate eventType to 100 characters', () => {
      const long = 'x'.repeat(150);
      expect(normalizeSupplierQuery({ eventType: long }).eventType.length).toBe(100);
    });

    it('should truncate postcode to 10 characters', () => {
      const long = 'SW1A 1AA EXTRA';
      expect(normalizeSupplierQuery({ postcode: long }).postcode.length).toBe(10);
    });
  });

  describe('normalizePackageQuery', () => {
    const { normalizePackageQuery } = searchService;

    it('should default sortBy to relevance for unknown values', () => {
      const result = normalizePackageQuery({ sortBy: 'distance' }); // distance not valid for packages
      expect(result.sortBy).toBe('relevance');
    });

    it('should accept all valid package sortBy values', () => {
      const { VALID_PACKAGE_SORT_VALUES } = searchService;
      VALID_PACKAGE_SORT_VALUES.forEach(sort => {
        const result = normalizePackageQuery({ sortBy: sort });
        expect(result.sortBy).toBe(sort);
      });
    });

    it('should clamp page to minimum of 1', () => {
      expect(normalizePackageQuery({ page: -1 }).page).toBe(1);
    });

    it('should clamp limit to maximum of 100', () => {
      expect(normalizePackageQuery({ limit: 999 }).limit).toBe(100);
    });

    it('should truncate q to 200 characters', () => {
      const longQuery = 'b'.repeat(300);
      expect(normalizePackageQuery({ q: longQuery }).q.length).toBe(200);
    });

    it('should discard invalid minPrice', () => {
      expect(normalizePackageQuery({ minPrice: 'bad' }).minPrice).toBeUndefined();
    });
  });

  describe('appliedSort in response', () => {
    it('should include appliedSort in searchSuppliers response', async () => {
      const result = await searchService.searchSuppliers({ sortBy: 'rating' });
      expect(result.appliedSort).toBe('rating');
    });

    it('should include appliedSort defaulting to relevance when omitted', async () => {
      const result = await searchService.searchSuppliers({});
      expect(result.appliedSort).toBe('relevance');
    });

    it('should return appliedSort as relevance when invalid sortBy given', async () => {
      const result = await searchService.searchSuppliers({ sortBy: 'invalidSort' });
      expect(result.appliedSort).toBe('relevance');
    });

    it('should include appliedSort in searchPackages response', async () => {
      const result = await searchService.searchPackages({ sortBy: 'priceAsc' });
      expect(result.appliedSort).toBe('priceAsc');
    });

    it('should return appliedSort as relevance for packages when invalid sortBy given', async () => {
      const result = await searchService.searchPackages({ sortBy: 'distance' }); // not valid for packages
      expect(result.appliedSort).toBe('relevance');
    });
  });

  describe('calculateFacets', () => {
    it('should count suppliers per category', () => {
      const facets = searchService.calculateFacets(mockSuppliers.filter(s => s.approved));
      const photography = facets.categories.find(c => c.name === 'Photography');
      expect(photography).toBeDefined();
      expect(photography.count).toBe(1);
    });

    it('should sort categories by count descending', () => {
      const facets = searchService.calculateFacets(mockSuppliers.filter(s => s.approved));
      for (let i = 1; i < facets.categories.length; i++) {
        expect(facets.categories[i - 1].count).toBeGreaterThanOrEqual(facets.categories[i].count);
      }
    });

    it('should include all four rating range buckets', () => {
      const facets = searchService.calculateFacets(mockSuppliers.filter(s => s.approved));
      expect(facets.ratings.length).toBe(4);
      const bucket45 = facets.ratings.find(r => r.rating === '4.5+');
      expect(bucket45.count).toBeGreaterThanOrEqual(1); // sup1 has 4.8
    });

    it('should include amenity counts', () => {
      const facets = searchService.calculateFacets(mockSuppliers.filter(s => s.approved));
      const wifi = facets.amenities.find(a => a.name === 'WiFi');
      expect(wifi).toBeDefined();
      expect(wifi.count).toBeGreaterThanOrEqual(2); // sup1 and sup3 both have WiFi
    });

    it('should ignore unapproved suppliers (caller responsibility)', () => {
      // When called with only approved suppliers, unapproved ones should not appear
      const facets = searchService.calculateFacets(mockSuppliers.filter(s => s.approved));
      const other = facets.categories.find(c => c.name === 'Other');
      expect(other).toBeUndefined(); // sup4 is unapproved
    });
  });

  describe('getPriceLevel', () => {
    it('should count £ symbols', () => {
      expect(searchService.getPriceLevel('££')).toBe(2);
      expect(searchService.getPriceLevel('£££')).toBe(3);
    });

    it('should count $ symbols as well', () => {
      expect(searchService.getPriceLevel('$$$')).toBe(3);
    });

    it('should return 0 for falsy input', () => {
      expect(searchService.getPriceLevel(null)).toBe(0);
      expect(searchService.getPriceLevel('')).toBe(0);
      expect(searchService.getPriceLevel(undefined)).toBe(0);
    });
  });

  describe('ownerUserId projection', () => {
    it('should include ownerUserId in supplier search results', async () => {
      const supplierWithOwner = { ...mockSuppliers[0], ownerUserId: 'user-abc' };
      dbUnified.read.mockImplementation(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([supplierWithOwner, ...mockSuppliers.slice(1)]);
        }
        return Promise.resolve([]);
      });

      const result = await searchService.searchSuppliers({});
      const found = result.results.find(s => s.id === 'sup1');
      expect(found.ownerUserId).toBe('user-abc');
    });

    it('should not expose email or phone in search results', async () => {
      const sensitiveSupplier = {
        ...mockSuppliers[0],
        email: 'secret@test.com',
        phone: '07700900000',
        businessAddress: '1 Secret Lane',
      };
      dbUnified.read.mockImplementation(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([sensitiveSupplier]);
        }
        return Promise.resolve([]);
      });

      const result = await searchService.searchSuppliers({});
      const found = result.results.find(s => s.id === 'sup1');
      expect(found.email).toBeUndefined();
      expect(found.phone).toBeUndefined();
      expect(found.businessAddress).toBeUndefined();
    });
  });

  describe('newest sort uses updatedAt over createdAt', () => {
    it('should rank a recently-updated supplier above an older newly-created one', async () => {
      const recentlyUpdated = {
        ...mockSuppliers[1], // catering
        createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(), // old creation
        updatedAt: new Date().toISOString(), // just updated
      };
      const newlyCreated = {
        ...mockSuppliers[0], // photography
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
        updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      };
      dbUnified.read.mockImplementation(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([newlyCreated, recentlyUpdated]);
        }
        return Promise.resolve([]);
      });

      const result = await searchService.searchSuppliers({ sortBy: 'newest' });
      // recentlyUpdated has updatedAt = now, so it should come first
      expect(result.results[0].id).toBe(recentlyUpdated.id);
    });
  });

  describe('distance sort appliedSort fallback', () => {
    it('should report appliedSort as relevance when distance sort requested but no postcode given', async () => {
      const result = await searchService.searchSuppliers({ sortBy: 'distance' });
      // No postcode → geocoding is skipped → distance sort falls back
      expect(result.appliedSort).toBe('relevance');
    });
  });
});
