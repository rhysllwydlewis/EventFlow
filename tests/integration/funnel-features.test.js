/**
 * Integration tests for Shortlist, Quote Requests, and Analytics routes
 */

'use strict';

const fs = require('fs');
const path = require('path');

describe('Shortlist API Integration Tests', () => {
  describe('Route File Structure', () => {
    it('should have shortlist.js routes file', () => {
      const routesPath = path.join(__dirname, '../../routes/shortlist.js');
      expect(fs.existsSync(routesPath)).toBe(true);
    });

    it('should export express router', () => {
      const shortlistRoutes = require('../../routes/shortlist');
      expect(shortlistRoutes).toBeDefined();
      expect(typeof shortlistRoutes).toBe('function');
    });
  });

  describe('Shortlist Endpoints', () => {
    it('should define GET / endpoint for retrieving shortlist', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/shortlist.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/'");
      // GET now requires auth — guest shortlist mode is disabled (Option A)
      expect(routeContent).toContain('authRequired');
    });

    it('should require authentication on GET (no guest shortlist)', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/shortlist.js'),
        'utf8'
      );

      // GET endpoint must use authRequired — no more guest localStorage fallback
      const getRouteMatch = routeContent.match(/router\.get\('\/'.+?(?=router\.)/s);
      expect(getRouteMatch).toBeTruthy();
      expect(getRouteMatch[0]).toContain('authRequired');
      // Should use findOne to fetch only the authenticated user's shortlist
      expect(getRouteMatch[0]).toContain('findOne');
    });

    it('should define POST / endpoint with auth and CSRF protection', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/shortlist.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.post('/'");
      expect(routeContent).toContain('authRequired');
      expect(routeContent).toContain('csrfProtection');
    });

    it('should define DELETE /:type/:id endpoint with CSRF protection', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/shortlist.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.delete('/:type/:id'");
      expect(routeContent).toContain('csrfProtection');
    });

    it('should define DELETE / endpoint to clear all with CSRF', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/shortlist.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.delete('/'");
      expect(routeContent).toContain('csrfProtection');
    });

    it('should validate item types (supplier or listing)', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/shortlist.js'),
        'utf8'
      );

      expect(routeContent).toContain("'supplier'");
      expect(routeContent).toContain("'listing'");
      expect(routeContent).toContain('Type must be');
    });

    it('should use validator for URL validation', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/shortlist.js'),
        'utf8'
      );

      expect(routeContent).toContain('validator.isURL');
    });
  });
});

describe('Quote Requests API Integration Tests', () => {
  describe('Route File Structure', () => {
    it('should have quote-requests.js routes file', () => {
      const routesPath = path.join(__dirname, '../../routes/quote-requests.js');
      expect(fs.existsSync(routesPath)).toBe(true);
    });

    it('should export express router', () => {
      const quoteRoutes = require('../../routes/quote-requests');
      expect(quoteRoutes).toBeDefined();
      expect(typeof quoteRoutes).toBe('function');
    });
  });

  describe('Quote Request Endpoints', () => {
    it('should define POST / endpoint with CSRF protection', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/quote-requests.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.post('/'");
      expect(routeContent).toContain('csrfProtection');
    });

    it('should validate email addresses', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/quote-requests.js'),
        'utf8'
      );

      expect(routeContent).toContain('validator.isEmail');
      expect(routeContent).toContain('Valid email is required');
    });

    it('should validate phone numbers', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/quote-requests.js'),
        'utf8'
      );

      expect(routeContent).toContain('Invalid phone number format');
    });

    it('should require at least one supplier', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/quote-requests.js'),
        'utf8'
      );

      expect(routeContent).toContain('At least one supplier is required');
    });

    it('should define GET / endpoint for user requests', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/quote-requests.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/'");
      expect(routeContent).toContain('getUserFromCookie');
    });

    it('should define GET /:id endpoint for specific request', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/quote-requests.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/:id'");
      expect(routeContent).toContain('Access denied');
    });

    it('should sanitize inputs with validator.escape', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/quote-requests.js'),
        'utf8'
      );

      expect(routeContent).toContain('validator.escape');
    });
  });
});

describe('Analytics API Integration Tests', () => {
  describe('Route File Structure', () => {
    it('should have analytics.js routes file', () => {
      const routesPath = path.join(__dirname, '../../routes/analytics.js');
      expect(fs.existsSync(routesPath)).toBe(true);
    });

    it('should export express router', () => {
      const analyticsRoutes = require('../../routes/analytics');
      expect(analyticsRoutes).toBeDefined();
      expect(typeof analyticsRoutes).toBe('function');
    });
  });

  describe('Analytics Endpoints', () => {
    it('should define POST /event endpoint with rate limiting and CSRF', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/analytics.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.post('/event'");
      expect(routeContent).toContain('writeLimiter');
      expect(routeContent).toContain('csrfProtection');
    });

    it('should whitelist allowed event types', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/analytics.js'),
        'utf8'
      );

      expect(routeContent).toContain('ALLOWED_EVENTS');
      expect(routeContent).toContain('search_performed');
      expect(routeContent).toContain('shortlist_add');
      expect(routeContent).toContain('quote_request_submitted');
    });

    it('should whitelist allowed property keys', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/analytics.js'),
        'utf8'
      );

      expect(routeContent).toContain('ALLOWED_PROPERTY_KEYS');
      expect(routeContent).toContain('sanitizeProperties');
    });

    it('should truncate string values to prevent huge payloads', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/analytics.js'),
        'utf8'
      );

      expect(routeContent).toContain('MAX_STRING_LENGTH');
      expect(routeContent).toContain('slice(0,');
    });

    it('should use configurable max events limit', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/analytics.js'),
        'utf8'
      );

      expect(routeContent).toContain('MAX_ANALYTICS_EVENTS');
      expect(routeContent).toContain('parseInt(process.env.MAX_ANALYTICS_EVENTS');
    });

    it('should fail silently without breaking UX', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/analytics.js'),
        'utf8'
      );

      expect(routeContent).toContain('Fail silently');
      expect(routeContent).toContain('logger.debug');
    });

    it('should define GET /events endpoint for admin', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/analytics.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/events'");
      expect(routeContent).toContain('Admin access required');
    });

    it('should define POST /track endpoint for profile views and enquiries', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/analytics.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.post('/track'");
      expect(routeContent).toContain('profile_view');
      expect(routeContent).toContain("'enquiry'");
    });

    it('should rate-limit the /track endpoint by IP and supplierId', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/analytics.js'),
        'utf8'
      );

      expect(routeContent).toContain('isTrackRateLimited');
      expect(routeContent).toContain('trackRateLimitCache');
    });

    it('should validate supplierId format on /track endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/analytics.js'),
        'utf8'
      );

      expect(routeContent).toContain('Invalid supplierId format');
      expect(routeContent).toContain('[a-zA-Z0-9_-]');
    });

    it('should call supplierAnalytics.trackProfileView for profile_view type', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/analytics.js'),
        'utf8'
      );

      expect(routeContent).toContain('supplierAnalytics.trackProfileView');
      expect(routeContent).toContain('supplierAnalytics.trackEnquirySent');
    });
  });
});

describe('Search Service Data Safety', () => {
  describe('Public Field Projection', () => {
    it('should define projectPublicSupplierFields function', () => {
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/searchService.js'),
        'utf8'
      );

      expect(serviceContent).toContain('projectPublicSupplierFields');
      expect(serviceContent).toContain('Excludes sensitive information');
    });

    it('should exclude email, phone, and addresses from supplier results', () => {
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/searchService.js'),
        'utf8'
      );

      // Check that the function explicitly excludes these fields
      const projectionMatch = serviceContent.match(
        /function projectPublicSupplierFields[\s\S]+?(?=function|$)/
      );
      expect(projectionMatch).toBeTruthy();
      expect(projectionMatch[0]).toContain('Explicitly exclude');
      expect(projectionMatch[0]).not.toContain('email:');
      expect(projectionMatch[0]).not.toContain('phone:');
    });

    it('should define projectPublicPackageFields function', () => {
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/searchService.js'),
        'utf8'
      );

      expect(serviceContent).toContain('projectPublicPackageFields');
    });

    it('should use projection in searchSuppliers results', () => {
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/searchService.js'),
        'utf8'
      );

      expect(serviceContent).toContain('projectPublicSupplierFields(supplier)');
    });

    it('should use projection in searchPackages results', () => {
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/searchService.js'),
        'utf8'
      );

      expect(serviceContent).toContain('projectPublicPackageFields(pkg)');
    });
  });
});

describe('URL State Management Safety', () => {
  describe('URL Parameter Validation', () => {
    it('should validate page parameter', () => {
      const urlStateContent = fs.readFileSync(
        path.join(__dirname, '../../utils/url-state.js'),
        'utf8'
      );

      expect(urlStateContent).toContain('parseInt(pageParam, 10)');
      expect(urlStateContent).toContain('!isNaN(parsed) && parsed > 0');
    });

    it('should validate budget min/max relationship', () => {
      const urlStateContent = fs.readFileSync(
        path.join(__dirname, '../../utils/url-state.js'),
        'utf8'
      );

      expect(urlStateContent).toContain('min <= max');
    });

    it('should handle multi-select categories', () => {
      const urlStateContent = fs.readFileSync(
        path.join(__dirname, '../../utils/url-state.js'),
        'utf8'
      );

      expect(urlStateContent).toContain("split(',')");
      expect(urlStateContent).toContain('params.getAll');
    });

    it('should debounce URL updates', () => {
      const urlStateContent = fs.readFileSync(
        path.join(__dirname, '../../utils/url-state.js'),
        'utf8'
      );

      expect(urlStateContent).toContain('updateURLTimer');
      expect(urlStateContent).toContain('setTimeout');
      expect(urlStateContent).toContain('clearTimeout');
    });
  });
});

describe('Client-Side Analytics Safety', () => {
  describe('Non-Blocking Behavior', () => {
    it('should use AbortController for timeout', () => {
      const analyticsContent = fs.readFileSync(
        path.join(__dirname, '../../utils/analytics.js'),
        'utf8'
      );

      expect(analyticsContent).toContain('AbortController');
      expect(analyticsContent).toContain('controller.abort()');
      expect(analyticsContent).toContain('signal:');
    });

    it('should set 5-second timeout', () => {
      const analyticsContent = fs.readFileSync(
        path.join(__dirname, '../../utils/analytics.js'),
        'utf8'
      );

      expect(analyticsContent).toContain('5000');
    });

    it('should fail silently', () => {
      const analyticsContent = fs.readFileSync(
        path.join(__dirname, '../../utils/analytics.js'),
        'utf8'
      );

      expect(analyticsContent).toContain('Fail silently');
      expect(analyticsContent).toContain('catch');
    });
  });
});

describe('Shortlist Manager Auth Requirement', () => {
  describe('Guest shortlist disabled (Option A)', () => {
    it('should NOT contain mergeLocalStorageOnLogin (removed in Option A)', () => {
      const managerContent = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/utils/shortlist-manager.js'),
        'utf8'
      );

      expect(managerContent).not.toContain('mergeLocalStorageOnLogin');
    });

    it('should gate addItem behind authentication', () => {
      const managerContent = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/utils/shortlist-manager.js'),
        'utf8'
      );

      expect(managerContent).toContain('requiresAuth');
    });

    it('should gate hasItem behind authentication', () => {
      const managerContent = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/utils/shortlist-manager.js'),
        'utf8'
      );

      // hasItem returns false when not authenticated
      expect(managerContent).toContain('isAuthenticated');
    });

    it('should clear stale localStorage keys via _clearLocalStorage', () => {
      const managerContent = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/utils/shortlist-manager.js'),
        'utf8'
      );

      expect(managerContent).toContain('_clearLocalStorage');
      expect(managerContent).toContain('eventflow_shortlist');
    });
  });
});

describe('Supplier Profile View Tracking', () => {
  describe('supplier.html client-side analytics ping', () => {
    const supplierHtml = fs.readFileSync(
      path.join(__dirname, '../../public/supplier.html'),
      'utf8'
    );

    it('fires POST /api/analytics/track on page load', () => {
      expect(supplierHtml).toContain('/api/analytics/track');
      expect(supplierHtml).toContain("type: 'profile_view'");
    });

    it('reads supplierId from URL query parameters', () => {
      expect(supplierHtml).toContain('URLSearchParams');
      expect(supplierHtml).toContain("params.get('id')");
    });

    it('uses fetch to send the tracking request', () => {
      expect(supplierHtml).toContain("method: 'POST'");
      expect(supplierHtml).toContain("'Content-Type': 'application/json'");
    });

    it('wraps tracking in try/catch to not break page load', () => {
      expect(supplierHtml).toContain('try {');
      expect(supplierHtml).toContain('} catch (e) {}');
    });
  });
});
