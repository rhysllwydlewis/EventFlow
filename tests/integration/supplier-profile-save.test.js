/**
 * Integration tests for Supplier Profile Save functionality
 * Tests the fixes for CSRF token, venuePostcode validation, and error handling
 */

const fs = require('fs');
const path = require('path');

describe('Supplier Profile Save Fixes', () => {
  let dashboardSupplierHtml;
  let appJsContent;
  let supplierGalleryContent;
  let serverJsContent;
  let geocodingContent;

  beforeAll(() => {
    const pagesDir = path.join(__dirname, '../../public/assets/js/pages');
    dashboardSupplierHtml = `${fs.readFileSync(
      path.join(__dirname, '../../public/dashboard-supplier.html'),
      'utf8'
    )}\n${fs.readFileSync(
      path.join(pagesDir, 'dashboard-supplier-module.js'),
      'utf8'
    )}\n${fs.readFileSync(path.join(pagesDir, 'dashboard-supplier-category.js'), 'utf8')}\n${
      fs.existsSync(path.join(pagesDir, 'dashboard-supplier-inline.js'))
        ? fs.readFileSync(path.join(pagesDir, 'dashboard-supplier-inline.js'), 'utf8')
        : ''
    }\n${fs.readFileSync(path.join(pagesDir, 'dashboard-supplier-threads.js'), 'utf8')}`;
    appJsContent = fs.readFileSync(path.join(__dirname, '../../public/assets/js/app.js'), 'utf8');
    supplierGalleryContent = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/supplier-gallery.js'),
      'utf8'
    );
    serverJsContent = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    geocodingContent = fs.readFileSync(path.join(__dirname, '../../utils/geocoding.js'), 'utf8');
  });

  describe('Frontend Form Updates', () => {
    it('should have venue postcode field in dashboard-supplier.html', () => {
      expect(dashboardSupplierHtml).toContain('id="sup-venue-postcode"');
      expect(dashboardSupplierHtml).toContain('name="venuePostcode"');
      expect(dashboardSupplierHtml).toContain('id="venue-postcode-row"');
    });

    it('should have venue postcode field initially hidden', () => {
      expect(dashboardSupplierHtml).toContain('id="venue-postcode-row" style="display:none"');
    });

    it('should have venue postcode validation error display', () => {
      expect(dashboardSupplierHtml).toContain('id="venue-postcode-error"');
    });

    it('should have venue postcode help text', () => {
      expect(dashboardSupplierHtml).toContain('id="venue-postcode-help"');
      expect(dashboardSupplierHtml).toContain('Required for Venues category');
    });

    it('should have client-side validation script', () => {
      expect(dashboardSupplierHtml).toContain('window.validateVenuePostcode');
      expect(dashboardSupplierHtml).toContain('ukPostcodeRegex');
    });

    it('should have category change listener to show/hide venue postcode field', () => {
      expect(dashboardSupplierHtml).toContain('updateVenuePostcodeVisibility');
      expect(dashboardSupplierHtml).toContain("categorySelect.addEventListener('change'");
    });

    it('should have real-time validation on input', () => {
      expect(dashboardSupplierHtml).toContain("venuePostcodeInput.addEventListener('input'");
      expect(dashboardSupplierHtml).toContain("venuePostcodeInput.addEventListener('blur'");
    });

    it('should use UK postcode regex matching backend', () => {
      // Frontend regex should match backend pattern (using \d instead of [0-9])
      expect(dashboardSupplierHtml).toContain('/^[A-Z]{1,2}\\d{1,2}[A-Z]?\\s*\\d[A-Z]{2}$/i');
    });

    it('should have accessibility attributes on venue postcode field', () => {
      expect(dashboardSupplierHtml).toContain(
        'aria-describedby="venue-postcode-help venue-postcode-error"'
      );
      expect(dashboardSupplierHtml).toContain('aria-required=');
      expect(dashboardSupplierHtml).toContain('role="alert"');
      expect(dashboardSupplierHtml).toContain('aria-live="polite"');
    });

    it('should have smooth scrolling to error field', () => {
      expect(dashboardSupplierHtml).toContain("scrollIntoView({ behavior: 'smooth'");
    });
  });

  describe('Form Submission Logic in app.js', () => {
    it('should have ensureCsrfToken function', () => {
      expect(appJsContent).toContain('async function ensureCsrfToken()');
      expect(appJsContent).toContain("fetch('/api/csrf-token'");
      expect(appJsContent).toContain('window.__CSRF_TOKEN__');
    });

    it('should fetch CSRF token at initDashSupplier start', () => {
      const initDashSupplierMatch = appJsContent.match(
        /async function initDashSupplier\(\)[\s\S]*?await ensureCsrfToken\(\)/
      );
      expect(initDashSupplierMatch).toBeTruthy();
    });

    it('should include CSRF token in supplier form submission', () => {
      const supplierFormMatch = appJsContent.match(
        /getElementById\('supplier-form'\)[\s\S]*?'X-CSRF-Token':\s*csrfToken/
      );
      expect(supplierFormMatch).toBeTruthy();
    });

    it('should have try-catch error handling in supplier form submission', () => {
      const supplierFormMatch = appJsContent.match(
        /getElementById\('supplier-form'\)[\s\S]{0,1500}try[\s\S]{0,1500}catch\s*\(\s*err\s*\)/
      );
      expect(supplierFormMatch).toBeTruthy();
    });

    it('should validate venue postcode before submission', () => {
      const supplierFormMatch = appJsContent.match(
        /getElementById\('supplier-form'\)[\s\S]{0,500}window\.validateVenuePostcode/
      );
      expect(supplierFormMatch).toBeTruthy();
    });

    it('should display error messages to user', () => {
      const supplierFormMatch = appJsContent.match(
        /getElementById\('supplier-form'\)[\s\S]{0,2000}statusEl\.textContent\s*=.*err\.message/
      );
      expect(supplierFormMatch).toBeTruthy();
    });

    it('should clean up payload for non-Venues categories', () => {
      const supplierFormMatch = appJsContent.match(
        /getElementById\('supplier-form'\)[\s\S]{0,1500}delete\s+payload\.venuePostcode/
      );
      expect(supplierFormMatch).toBeTruthy();
    });

    it('should include credentials in fetch requests', () => {
      // Check that api function includes credentials
      const apiFunction = appJsContent.match(
        /async function api\(path, opts[\s\S]*?return r\.json\(\)/
      );
      expect(apiFunction).toBeTruthy();
      expect(apiFunction[0]).toContain("credentials: opts.credentials || 'include'");
    });

    it('should inject X-CSRF-Token header for write methods in api()', () => {
      // The api() function inside initDashSupplier() must add CSRF token for POST/PUT/PATCH/DELETE
      const apiFunction = appJsContent.match(
        /async function api\(path, opts[\s\S]*?\}\s*\n\s*const supWrap/
      );
      expect(apiFunction).toBeTruthy();
      expect(apiFunction[0]).toContain("'POST', 'PUT', 'PATCH', 'DELETE'");
      expect(apiFunction[0]).toContain('ensureCsrfToken');
      expect(apiFunction[0]).toContain("'X-CSRF-Token'");
    });

    it('should retry once with refreshed CSRF token on 403 CSRF error', () => {
      // The api() function must clear the cached token and retry on 403 CSRF error
      const apiFunction = appJsContent.match(
        /async function api\(path, opts[\s\S]*?\}\s*\n\s*const supWrap/
      );
      expect(apiFunction).toBeTruthy();
      expect(apiFunction[0]).toContain('window.__CSRF_TOKEN__ = null');
      expect(apiFunction[0]).toContain('/csrf/i.test');
    });
  });

  describe('Supplier Gallery Updates', () => {
    it('should have improved error handling with backend error messages', () => {
      expect(supplierGalleryContent).toContain('const errorData = await response.json()');
      expect(supplierGalleryContent).toContain('errorData.error ||');
    });

    it('should include CSRF token in requests', () => {
      expect(supplierGalleryContent).toContain('ensureCsrfToken');
      expect(supplierGalleryContent).toContain("'X-CSRF-Token': csrfToken");
    });

    it('should include credentials in fetch requests', () => {
      expect(supplierGalleryContent).toContain("credentials: 'include'");
    });
  });

  describe('Backend Validation', () => {
    it('should require venuePostcode for Venues category on POST', () => {
      const postRoute = serverJsContent.match(
        /app\.post\(\s*['"]\/api\/me\/suppliers['"][\s\S]*?res\.json/
      );
      expect(postRoute).toBeTruthy();
      expect(postRoute[0]).toContain("category === 'Venues'");
      expect(postRoute[0]).toContain('venuePostcode');
    });

    it('should validate UK postcode format', () => {
      const postRoute = serverJsContent.match(
        /app\.post\(\s*['"]\/api\/me\/suppliers['"][\s\S]*?res\.json/
      );
      expect(postRoute).toBeTruthy();
      expect(postRoute[0]).toContain('isValidUKPostcode');
      expect(postRoute[0]).toContain('Invalid UK postcode format');
    });

    it('should return proper error messages', () => {
      const postRoute = serverJsContent.match(
        /app\.post\(\s*['"]\/api\/me\/suppliers['"][\s\S]*?res\.json/
      );
      expect(postRoute).toBeTruthy();
      expect(postRoute[0]).toContain(
        'Venue postcode is required for suppliers in the Venues category'
      );
    });

    it('should have CSRF protection on POST /api/me/suppliers', () => {
      expect(serverJsContent).toContain("app.post(\n  '/api/me/suppliers'");
      const postRoute = serverJsContent.match(
        /app\.post\(\s*['"]\/api\/me\/suppliers['"][\s\S]{0,300}csrfProtection/
      );
      expect(postRoute).toBeTruthy();
    });

    it('should have CSRF protection on PATCH /api/me/suppliers/:id', () => {
      expect(serverJsContent).toContain("app.patch(\n  '/api/me/suppliers/:id'");
      const patchRoute = serverJsContent.match(
        /app\.patch\(\s*['"]\/api\/me\/suppliers\/:id['"][\s\S]{0,300}csrfProtection/
      );
      expect(patchRoute).toBeTruthy();
    });
  });

  describe('UK Postcode Validation', () => {
    it('should have isValidUKPostcode function', () => {
      expect(geocodingContent).toContain('function isValidUKPostcode');
    });

    it('should export isValidUKPostcode', () => {
      expect(geocodingContent).toContain('isValidUKPostcode');
      expect(geocodingContent).toContain('module.exports');
    });

    it('should validate postcode with regex', () => {
      expect(geocodingContent).toContain('/^[A-Z]{1,2}\\d{1,2}[A-Z]?\\s*\\d[A-Z]{2}$/i');
    });
  });

  describe('Error Message Display', () => {
    it('should have status element for showing messages', () => {
      expect(dashboardSupplierHtml).toContain('id="sup-status"');
    });

    it('should show saving state', () => {
      const supplierFormMatch = appJsContent.match(
        /getElementById\('supplier-form'\)[\s\S]{0,1500}statusEl\.textContent\s*=\s*['"]Saving\.\.\.['"]/
      );
      expect(supplierFormMatch).toBeTruthy();
    });

    it('should show success state with green color', () => {
      const supplierFormMatch = appJsContent.match(
        /getElementById\('supplier-form'\)[\s\S]{0,2000}statusEl\.style\.color\s*=\s*['"]#10b981['"]/
      );
      expect(supplierFormMatch).toBeTruthy();
    });

    it('should show error state with red color', () => {
      const supplierFormMatch = appJsContent.match(
        /getElementById\('supplier-form'\)[\s\S]{0,2000}statusEl\.style\.color\s*=\s*['"]#ef4444['"]/
      );
      expect(supplierFormMatch).toBeTruthy();
    });
  });
});
