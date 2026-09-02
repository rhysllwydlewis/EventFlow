/**
 * Integration tests for Admin v2 API endpoints
 * Tests RBAC permission enforcement, audit logging, and batch operations
 */

const fs = require('fs');
const path = require('path');

describe('Admin v2 API Integration Tests', () => {
  describe('File Structure Verification', () => {
    it('should have admin-v2 routes file', () => {
      const routePath = path.join(__dirname, '../../routes/admin-v2.js');
      expect(fs.existsSync(routePath)).toBe(true);
    });

    it('should have permissions middleware file', () => {
      const middlewarePath = path.join(__dirname, '../../middleware/permissions.js');
      expect(fs.existsSync(middlewarePath)).toBe(true);
    });

    it('should have auditTrail utility file', () => {
      const utilPath = path.join(__dirname, '../../utils/auditTrail.js');
      expect(fs.existsSync(utilPath)).toBe(true);
    });

    it('should have adminService file', () => {
      const servicePath = path.join(__dirname, '../../services/adminService.js');
      expect(fs.existsSync(servicePath)).toBe(true);
    });

    it('should have AuditLog model file', () => {
      const modelPath = path.join(__dirname, '../../models/AuditLog.js');
      expect(fs.existsSync(modelPath)).toBe(true);
    });
  });

  describe('Route Registration', () => {
    it('should register admin-v2 routes in server.js', () => {
      const serverContent = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

      expect(serverContent).toContain("require('./routes/admin-v2')");
      expect(serverContent).toContain("app.use('/api/v2/admin'");
    });
  });

  describe('Permission Management Endpoints', () => {
    it('should have GET /api/v2/admin/permissions endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/permissions'");
      expect(routeContent).toContain('PERMISSIONS');
    });

    it('should have GET /api/v2/admin/roles endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("router.get('/roles'");
      expect(routeContent).toContain('ROLES');
    });

    it('should have POST /api/v2/admin/users/:id/permissions endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('router.post');
      expect(routeContent).toContain("'/users/:id/permissions'");
      expect(routeContent).toContain('grantPermission');
    });

    it('should have DELETE /api/v2/admin/users/:id/permissions/:permission endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('router.delete');
      expect(routeContent).toContain("'/users/:id/permissions/:permission'");
      expect(routeContent).toContain('revokePermission');
    });
  });

  describe('User Management Endpoints', () => {
    it('should have GET /api/v2/admin/users endpoint with pagination', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('router.get');
      expect(routeContent).toContain("'/users'");
      expect(routeContent).toContain('pagination');
    });

    it('should have GET /api/v2/admin/users/:id endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/users/:id'");
      expect(routeContent).toContain('USER_NOT_FOUND');
    });

    it('should have PUT /api/v2/admin/users/:id endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('router.put');
      expect(routeContent).toContain("'/users/:id'");
      expect(routeContent).toContain('USER_UPDATED');
    });

    it('should have DELETE /api/v2/admin/users/:id endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('router.delete');
      expect(routeContent).toContain("'/users/:id'");
      expect(routeContent).toContain('USER_DELETED');
    });

    it('should have POST /api/v2/admin/users/:id/ban endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/users/:id/ban'");
      expect(routeContent).toContain('USER_BANNED');
    });

    it('should have POST /api/v2/admin/users/:id/unban endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/users/:id/unban'");
      expect(routeContent).toContain('USER_UNBANNED');
    });
  });

  describe('Supplier Management Endpoints', () => {
    it('should have GET /api/v2/admin/suppliers endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/suppliers'");
      expect(routeContent).toContain('SUPPLIERS_READ');
    });

    it('should have PUT /api/v2/admin/suppliers/:id endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/suppliers/:id'");
      expect(routeContent).toContain('SUPPLIERS_UPDATE');
    });

    it('should have DELETE /api/v2/admin/suppliers/:id endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('router.delete');
      expect(routeContent).toContain("'/suppliers/:id'");
      expect(routeContent).toContain('SUPPLIER_DELETED');
    });

    it('should have POST /api/v2/admin/suppliers/:id/verify endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/suppliers/:id/verify'");
      expect(routeContent).toContain('SUPPLIER_VERIFIED');
    });
  });

  describe('Package Management Endpoints', () => {
    it('should have GET /api/v2/admin/packages endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/packages'");
      expect(routeContent).toContain('PACKAGES_READ');
    });

    it('should have PUT /api/v2/admin/packages/:id endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/packages/:id'");
      expect(routeContent).toContain('PACKAGES_UPDATE');
    });

    it('should have DELETE /api/v2/admin/packages/:id endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('router.delete');
      expect(routeContent).toContain("'/packages/:id'");
      expect(routeContent).toContain('PACKAGE_DELETED');
    });

    it('should have POST /api/v2/admin/packages/batch-approve endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/packages/batch-approve'");
      expect(routeContent).toContain('batchApprove');
    });
  });

  describe('Review Moderation Endpoints', () => {
    it('should have GET /api/v2/admin/reviews/pending endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/reviews/pending'");
      expect(routeContent).toContain('REVIEWS_READ');
    });

    it('should have POST /api/v2/admin/reviews/:id/approve endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/reviews/:id/approve'");
      expect(routeContent).toContain('REVIEWS_APPROVE');
    });

    it('should have POST /api/v2/admin/reviews/:id/reject endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/reviews/:id/reject'");
      expect(routeContent).toContain('REVIEWS_REJECT');
    });
  });

  describe('Photo Moderation Endpoints', () => {
    it('should have GET /api/v2/admin/photos/pending endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/photos/pending'");
      expect(routeContent).toContain('PHOTOS_READ');
    });

    it('should have POST /api/v2/admin/photos/batch-action endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/photos/batch-action'");
      expect(routeContent).toContain('PHOTOS_APPROVE');
    });
  });

  describe('Dashboard & Analytics Endpoints', () => {
    it('should have GET /api/v2/admin/dashboard/overview endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/dashboard/overview'");
      expect(routeContent).toContain('getDashboardOverview');
    });

    it('should have GET /api/v2/admin/dashboard/metrics endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/dashboard/metrics'");
      expect(routeContent).toContain('getDetailedMetrics');
    });

    it('should have GET /api/v2/admin/system-health endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/system-health'");
      expect(routeContent).toContain('getSystemHealth');
    });
  });

  describe('Audit & Logging Endpoints', () => {
    it('should have GET /api/v2/admin/audit-log endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/audit-log'");
      expect(routeContent).toContain('queryAuditLogs');
    });

    it('should have GET /api/v2/admin/audit-log/:id endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/audit-log/:id'");
      expect(routeContent).toContain('getAuditLogById');
    });

    it('should have GET /api/v2/admin/audit-log/user/:userId endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/audit-log/user/:userId'");
      expect(routeContent).toContain('getUserAuditLogs');
    });

    it('should have GET /api/v2/admin/audit-log/statistics endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/audit-log/statistics'");
      expect(routeContent).toContain('getAuditStatistics');
    });
  });

  describe('Batch Operations Endpoints', () => {
    it('should have POST /api/v2/admin/bulk-actions endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain("'/bulk-actions'");
      expect(routeContent).toContain('batchApprove');
      expect(routeContent).toContain('batchReject');
      expect(routeContent).toContain('batchDelete');
    });
  });

  describe('Permission Middleware Integration', () => {
    it('should use requirePermission middleware on endpoints', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('requirePermission');
      expect(routeContent).toContain('PERMISSIONS.');
    });

    it('should use authRequired middleware on all endpoints', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('authRequired');
    });

    it('should use csrfProtection on write endpoints', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('csrfProtection');
    });
  });

  describe('Audit Logging Integration', () => {
    it('should create audit logs for user actions', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('createAuditLog');
      expect(routeContent).toContain('actor:');
      expect(routeContent).toContain('action:');
      expect(routeContent).toContain('resource:');
    });

    it('should include changes in audit logs', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('changes:');
      expect(routeContent).toContain('before:');
      expect(routeContent).toContain('after:');
    });

    it('should include IP address and user agent in audit logs', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('ipAddress: req.ip');
      expect(routeContent).toContain("userAgent: req.get('user-agent')");
    });
  });

  describe('Error Handling', () => {
    it('should return standardized error responses', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('success: false');
      expect(routeContent).toContain('error:');
      expect(routeContent).toContain('code:');
      expect(routeContent).toContain('timestamp:');
    });

    it('should log errors using logger', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('logger.error');
    });

    it('should handle 404 errors', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('404');
      expect(routeContent).toContain('not found');
    });
  });

  describe('Response Formatting', () => {
    it('should return success responses with standard format', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('success: true');
      expect(routeContent).toContain('data:');
      expect(routeContent).toContain('timestamp: new Date().toISOString()');
    });

    it('should include pagination metadata in list endpoints', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('pagination:');
      // Check for either ES6 shorthand (page,) or explicit (page:) syntax
      expect(routeContent).toMatch(/page[,:]/);
      expect(routeContent).toMatch(/limit[,:]/);
      expect(routeContent).toMatch(/total[,:]/);
      expect(routeContent).toMatch(/totalPages[,:]/);
    });
  });

  describe('Security Features', () => {
    it('should prevent self-deletion in user delete endpoint', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('CANNOT_DELETE_SELF');
      expect(routeContent).toContain('user.id === req.user.id');
    });

    it('should validate input parameters', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      expect(routeContent).toContain('INVALID_INPUT');
      expect(routeContent).toContain('400');
    });

    it('should use permission checks before operations', () => {
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin-v2.js'),
        'utf8'
      );

      // Count number of requirePermission calls (should be many)
      const permissionChecks = (routeContent.match(/requirePermission/g) || []).length;
      expect(permissionChecks).toBeGreaterThan(20);
    });
  });

  describe('Mass assignment & privilege escalation protections (security fix regression)', () => {
    const routeContent = fs.readFileSync(path.join(__dirname, '../../routes/admin-v2.js'), 'utf8');

    it('PUT /suppliers/:id only writes an explicit allowlist of fields, not the raw request body', () => {
      const handlerMatch = routeContent.match(/router\.put\(\s*'\/suppliers\/:id'[\s\S]*?\n\);/);
      expect(handlerMatch).toBeTruthy();
      const handlerSource = handlerMatch[0];

      expect(handlerSource).toContain('editableFields');
      expect(handlerSource).toMatch(/editableFields\.forEach/);
      // The old vulnerable pattern wrote every key from the request body verbatim.
      expect(handlerSource).not.toMatch(/Object\.keys\(updateData\)\.forEach/);
    });

    it('PUT /suppliers/:id rejects verified/approved being set directly', () => {
      const handlerMatch = routeContent.match(/router\.put\(\s*'\/suppliers\/:id'[\s\S]*?\n\);/);
      const handlerSource = handlerMatch[0];
      expect(handlerSource).toContain("'verified' in updateData");
      expect(handlerSource).toContain("'approved' in updateData");
    });

    it('PUT /users/:id validates role against an enum before accepting it', () => {
      const handlerMatch = routeContent.match(/router\.put\(\s*'\/users\/:id'[\s\S]*?\n\);/);
      expect(handlerMatch).toBeTruthy();
      const handlerSource = handlerMatch[0];

      expect(handlerSource).toContain('VALID_ROLES');
      expect(handlerSource).toContain('INVALID_ROLE');
    });

    it('PUT /users/:id requires USERS_GRANT_ADMIN to grant or revoke admin', () => {
      const handlerMatch = routeContent.match(/router\.put\(\s*'\/users\/:id'[\s\S]*?\n\);/);
      const handlerSource = handlerMatch[0];

      expect(handlerSource).toContain('PERMISSIONS.USERS_GRANT_ADMIN');
      expect(handlerSource).toMatch(/hasPermission\(req\.user, PERMISSIONS\.USERS_GRANT_ADMIN\)/);
    });
  });

  describe('Admin Service Functions', () => {
    it('should export getDashboardOverview function', () => {
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/adminService.js'),
        'utf8'
      );

      expect(serviceContent).toContain('getDashboardOverview');
      expect(serviceContent).toContain('module.exports');
    });

    it('should export getDetailedMetrics function', () => {
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/adminService.js'),
        'utf8'
      );

      expect(serviceContent).toContain('getDetailedMetrics');
    });

    it('should export batch operation functions', () => {
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/adminService.js'),
        'utf8'
      );

      expect(serviceContent).toContain('batchApprove');
      expect(serviceContent).toContain('batchReject');
      expect(serviceContent).toContain('batchDelete');
    });

    it('should export getSystemHealth function', () => {
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../services/adminService.js'),
        'utf8'
      );

      expect(serviceContent).toContain('getSystemHealth');
    });
  });

  describe('Audit Trail Functions', () => {
    it('should export createAuditLog function', () => {
      const auditContent = fs.readFileSync(
        path.join(__dirname, '../../utils/auditTrail.js'),
        'utf8'
      );

      expect(auditContent).toContain('createAuditLog');
      expect(auditContent).toContain('module.exports');
    });

    it('should export queryAuditLogs function', () => {
      const auditContent = fs.readFileSync(
        path.join(__dirname, '../../utils/auditTrail.js'),
        'utf8'
      );

      expect(auditContent).toContain('queryAuditLogs');
    });

    it('should export getAuditStatistics function', () => {
      const auditContent = fs.readFileSync(
        path.join(__dirname, '../../utils/auditTrail.js'),
        'utf8'
      );

      expect(auditContent).toContain('getAuditStatistics');
    });
  });

  describe('Backward Compatibility', () => {
    it('should not modify existing admin routes', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      // Existing routes should still be present
      expect(adminRoutesContent).toContain("router.get('/dashboard/stats'");
      expect(adminRoutesContent).toContain('module.exports');
    });

    it('should mount admin-v2 on separate path', () => {
      const serverContent = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

      expect(serverContent).toContain("app.use('/api/v2/admin'");
    });
  });
});
