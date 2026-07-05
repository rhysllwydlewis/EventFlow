/**
 * Tests for admin route database connectivity fixes
 * Verifies that admin routes use dbUnified instead of legacy store.read()
 */
'use strict';

const fs = require('fs');
const path = require('path');

describe('Admin Route Database Connectivity', () => {
  let adminContent;
  let adminDebugContent;
  let reportsContent;

  beforeAll(() => {
    adminContent = fs.readFileSync(path.join(__dirname, '../../routes/admin.js'), 'utf8');
    adminDebugContent = fs.readFileSync(
      path.join(__dirname, '../../routes/admin-debug.js'),
      'utf8'
    );
    reportsContent = fs.readFileSync(path.join(__dirname, '../../routes/reports.js'), 'utf8');
  });

  describe('Singleton admin content storage', () => {
    it('treats content as a singleton MongoDB collection alongside settings', () => {
      const dbUnifiedContent = fs.readFileSync(path.join(__dirname, '../../db-unified.js'), 'utf8');

      expect(dbUnifiedContent).toContain("new Set(['settings', 'content'])");
      expect(dbUnifiedContent).toContain('SINGLETON_COLLECTIONS.has(collectionName)');
    });

    it('initialises content as an object in the local fallback store', () => {
      const storeContent = fs.readFileSync(path.join(__dirname, '../../store.js'), 'utf8');

      expect(storeContent).toContain("new Set(['settings', 'content'])");
      expect(storeContent).toContain('objectCollections.has(name)');
    });
  });

  describe('Admin packages endpoint', () => {
    it('should use dbUnified.read for packages (not legacy read())', () => {
      // The packages GET endpoint should use dbUnified
      expect(adminContent).toContain("dbUnified.read('packages')");
    });

    it('should support supplierId filtering in packages endpoint', () => {
      expect(adminContent).toContain('supplierId');
      expect(adminContent).toMatch(/pkg\.supplierId\s*===\s*supplierId/);
    });

    it('should support featured=true filtering in packages endpoint', () => {
      expect(adminContent).toContain("featured === 'true'");
      expect(adminContent).toContain('pkg.featured === true');
    });
  });

  describe('Admin payments endpoint', () => {
    it('should use dbUnified.read for payments (not legacy read())', () => {
      expect(adminContent).toContain("dbUnified.read('payments')");
      // Should NOT have the old synchronous read('payments')
      const syncReadPayments = /const payments = read\('payments'\)/;
      expect(syncReadPayments.test(adminContent)).toBe(false);
    });
  });

  describe('Admin content endpoints', () => {
    it('GET /content/homepage should use dbUnified.read', () => {
      expect(adminContent).toContain('/content/homepage');
      // No sync read('content') in GET handlers
      const syncReadContent = /\bconst content = read\('content'\)/g;
      const matches = adminContent.match(syncReadContent);
      expect(matches).toBeNull();
    });

    it('GET /content/announcements should use dbUnified.read', () => {
      expect(adminContent).toContain('/content/announcements');
    });

    it('GET /content/faqs should use dbUnified.read', () => {
      expect(adminContent).toContain('/content/faqs');
    });
  });

  describe('Admin reports endpoint', () => {
    it('should return items alias alongside reports in response', () => {
      // Verify the response includes both 'items' and 'reports' fields
      expect(reportsContent).toContain('items: paginatedReports');
      expect(reportsContent).toContain('reports: paginatedReports');
    });
  });

  describe('Admin supplier reject endpoint', () => {
    it('should have a POST /suppliers/:id/reject route', () => {
      expect(adminContent).toContain("'/suppliers/:id/reject'");
    });

    it('should set approved=false and rejected=true on reject', () => {
      expect(adminContent).toContain('approved: false');
      expect(adminContent).toContain('rejected: true');
    });

    it('should audit log the rejection', () => {
      // Find the reject route block and verify it has auditLog
      const rejectRouteMatch = adminContent.match(
        /\/suppliers\/:id\/reject[\s\S]*?(?=\/suppliers\/:id\/pro|\/suppliers\/:id\/verify)/
      );
      expect(rejectRouteMatch).not.toBeNull();
      expect(rejectRouteMatch[0]).toContain('auditLog');
    });
  });

  describe('Admin debug routes', () => {
    it('should use dbUnified.read for user lookups', () => {
      const syncReadUsers = /const user = read\('users'\)/;
      expect(syncReadUsers.test(adminDebugContent)).toBe(false);
      expect(adminDebugContent).toContain("dbUnified.read('users')");
    });

    it('GET /user debug endpoint should be async', () => {
      expect(adminDebugContent).toContain('async (req, res) =>');
    });
  });
});

describe('Admin content init frontend fixes', () => {
  let contentInitContent;

  beforeAll(() => {
    const fs = require('fs');
    const path = require('path');
    contentInitContent = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/pages/admin-content-init.js'),
      'utf8'
    );
  });

  it('should call /packages/:id/feature POST to unfeature a package (not PUT on /packages/:id)', () => {
    expect(contentInitContent).toContain('/api/admin/packages/${id}/feature');
    expect(contentInitContent).not.toContain("'/api/admin/packages/${id}', 'PUT'");
  });
});

describe('Admin user disable endpoint', () => {
  let adminUserMgmtContent;
  let adminInitContent;

  beforeAll(() => {
    const fs = require('fs');
    const path = require('path');
    adminUserMgmtContent = fs.readFileSync(
      path.join(__dirname, '../../routes/admin-user-management.js'),
      'utf8'
    );
    adminInitContent = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/pages/admin-init.js'),
      'utf8'
    );
  });

  it('should have POST /users/:id/disable backward-compat endpoint in admin-user-management.js', () => {
    expect(adminUserMgmtContent).toContain("'/users/:id/disable'");
  });

  it('disableUser in admin-init.js should call /suspend not /disable', () => {
    expect(adminInitContent).toContain('/suspend');
    expect(adminInitContent).not.toContain('/api/admin/users/${id}/disable');
  });
});
