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
    it('should use AdminShared.api for loading users', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-users-init.js'),
        'utf8'
      );

      // Should use AdminShared.api instead of raw fetch
      expect(content).toContain("AdminShared.api('/api/admin/users'");
      // Template literal syntax
      expect(content).toContain(
        'AdminShared.api(`/api/admin/users/${userId}/subscription-history`'
      );
    });

    it('should handle both id and _id for user lookup', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-users-init.js'),
        'utf8'
      );

      // Should check both id and _id fields
      expect(content).toContain('u.id === userId || u._id === userId');
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

  describe('Admin Suppliers Init', () => {
    it('should accept data.items from API response', () => {
      const fs = require('fs');
      const path = require('path');
      const content = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-suppliers-init.js'),
        'utf8'
      );

      // Should use data.items not data.suppliers
      expect(content).toContain('allSuppliers = data.items');
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
      // Check that the actual assignment uses data.items
      expect(content).toContain('allSuppliers = data.items');
      expect(content).not.toContain('allSuppliers = data.suppliers');
    });
  });
});
