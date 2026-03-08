/**
 * Integration tests for Search V2 API endpoints
 */

'use strict';

const fs = require('fs');
const path = require('path');

describe('Search V2 API Integration Tests', () => {
  describe('Route File Structure', () => {
    it('should have search-v2.js routes file', () => {
      const routesPath = path.join(__dirname, '../../routes/search-v2.js');
      expect(fs.existsSync(routesPath)).toBe(true);
    });

    it('should export express router', () => {
      const searchRoutes = require('../../routes/search-v2');
      expect(searchRoutes).toBeDefined();
      expect(typeof searchRoutes).toBe('function'); // Express router is a function
    });
  });

  describe('Core Search Endpoints', () => {
    it('should define GET /suppliers endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/suppliers'");
      expect(routeContent).toContain('searchService.searchSuppliers');
    });

    it('should define GET /packages endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/packages'");
      expect(routeContent).toContain('searchService.searchPackages');
    });

    it('should define POST /advanced endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.post('/advanced'");
      expect(routeContent).toContain('searchService.advancedSearch');
    });

    it('should use cache middleware for suppliers search', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('searchCacheMiddleware');
    });
  });

  describe('Saved Searches & History Endpoints', () => {
    it('should define POST /saved endpoint with auth', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.post('/saved'");
      expect(routeContent).toContain('authRequired');
    });

    it('should define GET /saved endpoint with auth', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/saved'");
      expect(routeContent).toContain('authRequired');
    });

    it('should define DELETE /saved/:id endpoint with auth', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.delete('/saved/:id'");
      expect(routeContent).toContain('authRequired');
    });

    it('should define GET /history endpoint with auth', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/history'");
      expect(routeContent).toContain('authRequired');
    });
  });

  describe('Suggestions & Autocomplete Endpoints', () => {
    it('should define GET /suggestions endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/suggestions'");
      expect(routeContent).toContain('searchAnalytics.getAutocompleteSuggestions');
    });

    it('should define GET /trending endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/trending'");
      expect(routeContent).toContain('searchAnalytics.getTrendingSearches');
    });

    it('should define GET /popular-queries endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/popular-queries'");
      expect(routeContent).toContain('searchAnalytics.getPopularQueries');
    });

    it('should cache suggestions and trending searches', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      // Check that cache middleware is used
      const suggestionsSection = routeContent.slice(
        routeContent.indexOf("router.get('/suggestions'"),
        routeContent.indexOf("router.get('/suggestions'") + 500
      );

      expect(suggestionsSection).toContain('searchCacheMiddleware');
    });
  });

  describe('Filters & Facets Endpoints', () => {
    it('should define GET /categories endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/categories'");
    });

    it('should define GET /amenities endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/amenities'");
    });

    it('should define GET /locations endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/locations'");
    });

    it('should use long cache TTL for static data', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      // Categories should have long cache (86400 = 24 hours)
      const categoriesSection = routeContent.slice(
        routeContent.indexOf("router.get('/categories'"),
        routeContent.indexOf("router.get('/categories'") + 300
      );

      expect(categoriesSection).toContain('86400');
    });
  });

  describe('Analytics & Insights Endpoints (Admin)', () => {
    it('should define GET /analytics endpoint with admin auth', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/analytics'");
      expect(routeContent).toContain('authRequired');
      expect(routeContent).toContain("roleRequired('admin')");
    });

    it('should define GET /analytics/trends endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/analytics/trends'");
      expect(routeContent).toContain("roleRequired('admin')");
    });

    it('should define GET /analytics/user-behavior endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/analytics/user-behavior'");
      expect(routeContent).toContain("roleRequired('admin')");
    });
  });

  describe('Performance & Cache Management Endpoints (Admin)', () => {
    it('should define GET /performance endpoint with admin auth', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/performance'");
      expect(routeContent).toContain('authRequired');
      expect(routeContent).toContain("roleRequired('admin')");
    });

    it('should define POST /cache/clear endpoint with admin auth', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/cache/clear'");
      expect(routeContent).toContain('authRequired');
      expect(routeContent).toContain("roleRequired('admin')");
    });

    it('should define GET /cache/stats endpoint with admin auth', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/cache/stats'");
      expect(routeContent).toContain('authRequired');
      expect(routeContent).toContain("roleRequired('admin')");
    });
  });

  describe('Input Validation', () => {
    it('should validate query length in supplier search', () => {
      // Query length validation is now centralized in normalizeSupplierQuery in the service
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/searchService.js'),
        'utf8'
      );

      // The normalization caps query at 200 characters via .slice(0, 200)
      expect(serviceContent).toContain('slice(0, 200)');
      expect(serviceContent).toContain('normalizeSupplierQuery');
    });

    it('should validate saved search name', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      const savedSection = routeContent.slice(
        routeContent.indexOf("router.post('/saved'"),
        routeContent.indexOf("router.post('/saved'") + 2000
      );

      expect(savedSection).toContain('!name || !criteria');
      expect(savedSection).toContain('name.length < 3 || name.length > 100');
    });

    it('should sanitize saved search inputs', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      const savedSection = routeContent.slice(
        routeContent.indexOf("router.post('/saved'"),
        routeContent.indexOf("router.post('/saved'") + 2000
      );

      expect(savedSection).toContain('validator.escape');
    });

    it('should validate time range for trending searches', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      const trendingSection = routeContent.slice(
        routeContent.indexOf("router.get('/trending'"),
        routeContent.indexOf("router.get('/trending'") + 1500
      );

      expect(trendingSection).toContain("'1h', '24h', '7d', '30d'");
      expect(trendingSection).toContain('Invalid time range');
    });
  });

  describe('Search Tracking', () => {
    it('should track searches for analytics', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('trackSearch');
    });

    it('should include user and session info in tracking', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('getUserFromCookie');
      expect(routeContent).toContain('sessionId');
    });

    it('should track query text and filters', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      // Find the first trackSearch call
      const trackIndex = routeContent.indexOf('trackSearch');
      expect(trackIndex).toBeGreaterThan(-1);

      // Check general structure includes tracking fields
      expect(routeContent).toContain('userId:');
      expect(routeContent).toContain('resultsCount:');
      expect(routeContent).toContain('durationMs:');
    });
  });

  describe('Response Format', () => {
    it('should return standardized success response', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('success: true');
      expect(routeContent).toContain('data:');
    });

    it('should return timestamp in responses', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('timestamp: new Date().toISOString()');
    });

    it('should handle errors with standardized format', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('success: false');
      expect(routeContent).toContain('error:');
      expect(routeContent).toContain('catch (error)');
    });
  });

  describe('Pagination and Limits', () => {
    it('should respect limit parameter', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('req.query.limit');
      expect(routeContent).toContain('Math.min');
    });

    it('should support page parameter', () => {
      // Page parameter normalization is handled in the service layer
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/searchService.js'),
        'utf8'
      );

      // normalizeSupplierQuery parses and clamps page
      expect(serviceContent).toContain('parseInt(raw.page');
    });

    it('should support skip parameter for history', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      const historySection = routeContent.slice(
        routeContent.indexOf("router.get('/history'"),
        routeContent.indexOf("router.get('/history'") + 1500
      );

      expect(historySection).toContain('req.query.skip');
    });
  });

  describe('Route Registration', () => {
    it('should be registered in routes/index.js', () => {
      const indexContent = fs.readFileSync(path.join(__dirname, '../../routes/index.js'), 'utf8');

      expect(indexContent).toContain("require('./search-v2')");
      expect(indexContent).toContain("app.use('/api/v2/search'");
    });
  });

  describe('Dependencies', () => {
    it('should import required modules', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("require('express')");
      expect(routeContent).toContain("require('../db-unified')");
      expect(routeContent).toContain("require('../middleware/auth')");
      expect(routeContent).toContain("require('../middleware/searchCache')");
      expect(routeContent).toContain("require('../services/searchService')");
      expect(routeContent).toContain("require('../utils/searchAnalytics')");
      expect(routeContent).toContain("require('validator')");
    });
  });

  describe('Phase 4 Filter Parameters', () => {
    it('should pass eventType to search query', () => {
      // eventType normalization is now in normalizeSupplierQuery in the service
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/searchService.js'),
        'utf8'
      );

      expect(serviceContent).toContain('eventType');
      expect(serviceContent).toContain('raw.eventType');
    });

    it('should pass verifiedOnly to search query', () => {
      // verifiedOnly is forwarded via req.query passed directly to the service
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/searchService.js'),
        'utf8'
      );

      expect(serviceContent).toContain('verifiedOnly');
      expect(serviceContent).toContain('raw.verifiedOnly');
    });

    it('should pass minRating to search query', () => {
      // minRating normalization is now in the service
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/searchService.js'),
        'utf8'
      );

      expect(serviceContent).toContain('minRating');
      expect(serviceContent).toContain('raw.minRating');
    });
  });

  describe('Suppliers HTML Filter UI', () => {
    const suppliersHtml = fs.readFileSync(
      path.join(__dirname, '../../public/suppliers.html'),
      'utf8'
    );

    it('should have rating filter', () => {
      expect(suppliersHtml).toContain('filterRating');
    });

    it('should have verified suppliers checkbox', () => {
      expect(suppliersHtml).toContain('filterVerified');
    });

    it('should have sort dropdown', () => {
      expect(suppliersHtml).toContain('filterSort');
    });

    it('should have ££££ price tier option', () => {
      expect(suppliersHtml).toContain('££££');
    });

    it('should have priceAsc and priceDesc sort options', () => {
      expect(suppliersHtml).toContain('priceAsc');
      expect(suppliersHtml).toContain('priceDesc');
    });
  });

  describe('Input validation in route', () => {
    it('should validate sortBy against allowed values', () => {
      // Sort validation is now centralized in the service via VALID_SUPPLIER_SORT_VALUES
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/searchService.js'),
        'utf8'
      );
      expect(serviceContent).toContain('VALID_SUPPLIER_SORT_VALUES');
      expect(serviceContent).toContain("'priceAsc'");
      expect(serviceContent).toContain("'distance'");
    });

    it('should validate eventType max length', () => {
      // eventType max length is enforced via .slice(0, 100) in normalizeSupplierQuery
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/searchService.js'),
        'utf8'
      );
      expect(serviceContent).toContain('slice(0, 100)');
    });

    it('should sanitize eventType input by trimming', () => {
      // eventType is trimmed in normalizeSupplierQuery in the service
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/searchService.js'),
        'utf8'
      );
      expect(serviceContent).toContain('String(raw.eventType).trim()');
    });
  });

  describe('Pagination normalisation', () => {
    it('should normalise pages to totalPages in suppliers-init.js', () => {
      const suppliersSrc = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/suppliers-init.js'),
        'utf8'
      );
      expect(suppliersSrc).toContain('totalPages = data.pagination.pages');
    });
  });

  describe('Phase 1 improvements — service-level normalisation and ranking', () => {
    it('should export normalizeSupplierQuery from searchService', () => {
      const searchService = require('../../services/searchService');
      expect(typeof searchService.normalizeSupplierQuery).toBe('function');
    });

    it('should export normalizePackageQuery from searchService', () => {
      const searchService = require('../../services/searchService');
      expect(typeof searchService.normalizePackageQuery).toBe('function');
    });

    it('should export VALID_SUPPLIER_SORT_VALUES from searchService', () => {
      const searchService = require('../../services/searchService');
      expect(Array.isArray(searchService.VALID_SUPPLIER_SORT_VALUES)).toBe(true);
      expect(searchService.VALID_SUPPLIER_SORT_VALUES).toContain('relevance');
      expect(searchService.VALID_SUPPLIER_SORT_VALUES).toContain('distance');
    });

    it('should export VALID_PACKAGE_SORT_VALUES from searchService', () => {
      const searchService = require('../../services/searchService');
      expect(Array.isArray(searchService.VALID_PACKAGE_SORT_VALUES)).toBe(true);
      expect(searchService.VALID_PACKAGE_SORT_VALUES).toContain('relevance');
      expect(searchService.VALID_PACKAGE_SORT_VALUES).toContain('priceAsc');
      // 'distance' is not valid for packages
      expect(searchService.VALID_PACKAGE_SORT_VALUES).not.toContain('distance');
    });

    it('should include appliedSort field in supplier search response', async () => {
      const dbUnified = require('../../db-unified');
      jest.mock('../../db-unified');
      dbUnified.read = jest.fn(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([
            { id: 's1', name: 'Test', category: 'Photography', approved: true },
          ]);
        }
        return Promise.resolve([]);
      });

      const searchService = require('../../services/searchService');
      const result = await searchService.searchSuppliers({ sortBy: 'rating' });
      expect(result).toHaveProperty('appliedSort');
      expect(result.appliedSort).toBe('rating');
    });

    it('should include appliedSort field in package search response', async () => {
      const dbUnified = require('../../db-unified');
      jest.mock('../../db-unified');
      dbUnified.read = jest.fn(collection => {
        if (collection === 'suppliers') {
          return Promise.resolve([
            { id: 's1', name: 'Test', category: 'Photography', approved: true },
          ]);
        }
        if (collection === 'packages') {
          return Promise.resolve([
            { id: 'p1', supplierId: 's1', title: 'Test Pkg', price: 500, approved: true },
          ]);
        }
        return Promise.resolve([]);
      });

      const searchService = require('../../services/searchService');
      const result = await searchService.searchPackages({ sortBy: 'priceDesc' });
      expect(result).toHaveProperty('appliedSort');
      expect(result.appliedSort).toBe('priceDesc');
    });

    it('should export calculateProfileCompleteness from searchWeighting', () => {
      const { calculateProfileCompleteness } = require('../../utils/searchWeighting');
      expect(typeof calculateProfileCompleteness).toBe('function');
    });

    it('should have sortBy tracking in analytics call within route', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );
      // The route now tracks appliedSort from the results object
      expect(routeContent).toContain('results.appliedSort');
    });

    it('should track page number in analytics filters', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/search-v2.js'),
        'utf8'
      );
      expect(routeContent).toContain('results.pagination.page');
    });
  });
});
