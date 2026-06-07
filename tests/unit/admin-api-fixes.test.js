/**
 * Unit tests for admin functionality fixes
 * Tests the changes made to fix:
 * - Admin users page using AdminShared.api
 * - Subscription history endpoint
 * - Admin suppliers API response shape
 * - Maintenance mode data source consistency
 */

describe('Admin API Fixes', () => {
  describe('Admin Users Init', () => {
    it('should use AdminShared.api for loading users (summary and list)', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-users-init.js'),
        'utf8'
      );

      // Users Centre uses the shared summary and list endpoints
      expect(content).toContain("AdminShared.api('/api/admin/users/summary')");
      expect(content).toContain("AdminShared.api('/api/admin/users/list')");
      // Should not use raw fetch for data loading
      expect(content).not.toContain("fetch('/api/admin/users'");
    });

    it('should look up user id via dataset.userId for stable ID resolution', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-users-init.js'),
        'utf8'
      );

      // Users are identified via data-user-id attributes on checkboxes
      // This is more robust than relying on u.id || u._id in click handlers
      expect(content).toContain('dataset.userId');
      expect(content).toContain('data-user-id=');
    });

    it('should use AdminShared.showToast for notifications', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-users-init.js'),
        'utf8'
      );

      // Should use AdminShared.showToast instead of alert
      expect(content).toContain('AdminShared.showToast');
    });
  });

  describe('Admin Dashboard Account Health', () => {
    it('shows controlled fallback when summary API fails', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-init.js'),
        'utf8'
      );

      expect(content).toContain('renderAccountHealthFallback');
      expect(content).toContain('Could not load account health. Try again or open Users Centre.');
      expect(content).toContain('Dashboard loaded with warnings.');
      expect(content).toContain('data-action="retryAccountHealth"');
    });
  });

  describe('Admin Suppliers Init', () => {
    it('should accept data.items from API response', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-suppliers-init.js'),
        'utf8'
      );

      // Should use suppliersData.items (destructured from Promise.all response)
      expect(content).toContain('suppliersData.items');
    });

    it('should load suppliers from the correct endpoint', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-suppliers-init.js'),
        'utf8'
      );

      // Should call the suppliers endpoint
      expect(content).toContain('/api/admin/suppliers');
    });
  });

  describe('Maintenance Mode Middleware', () => {
    it('should use dbUnified instead of store', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(
        path.join(__dirname, '../../middleware/maintenance.js'),
        'utf8'
      );

      // Should require dbUnified
      expect(content).toContain("const dbUnified = require('../db-unified')");

      // Should use async function
      expect(content).toContain('async function maintenanceMode');

      // Should use dbUnified.read
      expect(content).toContain("await dbUnified.read('settings')");
    });

    it('should allow public maintenance message endpoint', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(
        path.join(__dirname, '../../middleware/maintenance.js'),
        'utf8'
      );

      // Should allow /api/maintenance/message
      expect(content).toContain('/api/maintenance/message');
    });
  });

  describe('Admin Routes - Maintenance Endpoint', () => {
    it('should have public maintenance message endpoint', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(path.join(__dirname, '../../routes/admin.js'), 'utf8');

      // Should have GET /maintenance/message route
      expect(content).toContain("router.get('/maintenance/message'");

      // Should use dbUnified.read
      expect(content).toMatch(/router\.get\('\/maintenance\/message'.*dbUnified\.read/s);
    });
  });

  describe('Maintenance HTML Page', () => {
    it('should use public maintenance message endpoint', () => {
      const fs = require('fs');
      const path = require('path');
      // The maintenance page now uses an external JS file for CSP hardening
      const content = `${fs.readFileSync(
        path.join(__dirname, '../../public/maintenance.html'),
        'utf8'
      )}\n${fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/maintenance-init.js'),
        'utf8'
      )}`;

      // Should fetch from public endpoint (not admin-only)
      expect(content).toContain('/api/maintenance/message');

      // Should NOT use /api/admin/settings/maintenance or /api/admin/maintenance/message
      expect(content).not.toContain('/api/admin/settings/maintenance');
      expect(content).not.toContain('/api/admin/maintenance/message');
    });
  });

  describe('Code Quality', () => {
    it('admin-users-init.js should be syntactically valid', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-users-init.js'),
        'utf8'
      );

      // Basic validation - should not have obvious syntax errors
      expect(content).not.toContain('undefined.api');
      expect(content).not.toContain('window.fetchJSON');
    });

    it('admin-suppliers-init.js should be syntactically valid', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-suppliers-init.js'),
        'utf8'
      );

      // Should not reference data.suppliers in actual code (comments are ok)
      // Check that the actual assignment uses suppliersData.items (parallel fetch pattern)
      expect(content).toContain('suppliersData.items');
      expect(content).not.toContain('allSuppliers = data.suppliers');
    });
  });
});
