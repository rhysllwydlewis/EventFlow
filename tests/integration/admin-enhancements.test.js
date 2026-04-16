/**
 * Integration tests for admin enhancements
 * Tests bulk operations, dashboard stats, and search functionality
 */

'use strict';

const fs = require('fs');
const path = require('path');

describe('Admin Enhancements', () => {
  describe('Bulk Operations API', () => {
    it('should have bulk approve packages endpoint', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      expect(adminRoutesContent).toContain('router.post');
      expect(adminRoutesContent).toContain("'/packages/bulk-approve'");
      expect(adminRoutesContent).toContain('csrfProtection');
      expect(adminRoutesContent).toContain('packageIds');
    });

    it('should have bulk feature packages endpoint', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      expect(adminRoutesContent).toContain("'/packages/bulk-feature'");
      expect(adminRoutesContent).toContain('BULK_PACKAGES_FEATURED');
    });

    it('should have bulk delete packages endpoint', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      expect(adminRoutesContent).toContain("'/packages/bulk-delete'");
      expect(adminRoutesContent).toContain('BULK_PACKAGES_DELETED');
    });

    it('should have bulk verify users endpoint', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      expect(adminRoutesContent).toContain("'/users/bulk-verify'");
      expect(adminRoutesContent).toContain('userIds');
      expect(adminRoutesContent).toContain('BULK_USERS_VERIFIED');
    });

    it('should have bulk suspend users endpoint', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      expect(adminRoutesContent).toContain("'/users/bulk-suspend'");
      expect(adminRoutesContent).toContain('BULK_USERS_SUSPENDED');
    });

    it('all bulk operations should use dbUnified', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      // Check that bulk operations use dbUnified.read and write
      // Use a more robust regex that captures the full router.post() call
      const bulkApproveMatch = adminRoutesContent.match(
        /router\.post\(\s*'\/packages\/bulk-approve'[\s\S]*?\n\);/
      );
      const bulkVerifyMatch = adminRoutesContent.match(
        /router\.post\(\s*'\/users\/bulk-verify'[\s\S]*?\n\);/
      );

      expect(bulkApproveMatch).toBeTruthy();
      expect(bulkApproveMatch[0]).toContain('await dbUnified.read');
      expect(bulkApproveMatch[0]).toMatch(/dbUnified\.(write|updateOne)\(/);

      expect(bulkVerifyMatch).toBeTruthy();
      expect(bulkVerifyMatch[0]).toContain('await dbUnified.read');
      // bulk-verify now uses atomic updateOne calls instead of full-collection write
      expect(bulkVerifyMatch[0]).toContain('dbUnified.updateOne');
    });

    it('all bulk operations should create audit logs', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      const bulkOperations = [
        '/packages/bulk-approve',
        '/packages/bulk-feature',
        '/packages/bulk-delete',
        '/users/bulk-verify',
        '/users/bulk-suspend',
      ];

      bulkOperations.forEach(operation => {
        expect(adminRoutesContent).toContain(operation);
        const operationSection = adminRoutesContent.substring(
          adminRoutesContent.indexOf(operation)
        );
        expect(operationSection).toContain('await auditLog(');
      });
    });
  });

  describe('Dashboard Statistics API', () => {
    it('should have dashboard stats endpoint', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      expect(adminRoutesContent).toContain("'/dashboard/stats'");
      expect(adminRoutesContent).toContain('GET /api/admin/dashboard/stats');
    });

    it('dashboard stats should fetch data in parallel', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      const statsSection = adminRoutesContent.match(/\/dashboard\/stats'[\s\S]*?}\s*\);/);
      expect(statsSection).toBeTruthy();
      expect(statsSection[0]).toContain('Promise.all');
      expect(statsSection[0]).toContain('dbUnified.read');
    });

    it('dashboard stats should calculate comprehensive metrics', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      const statsSection = adminRoutesContent.match(/\/dashboard\/stats'[\s\S]*?}\s*\);/);
      expect(statsSection).toBeTruthy();

      // Check for various stat categories
      expect(statsSection[0]).toContain('users:');
      expect(statsSection[0]).toContain('suppliers:');
      expect(statsSection[0]).toContain('packages:');
      expect(statsSection[0]).toContain('photos:');
      expect(statsSection[0]).toContain('tickets:');
      expect(statsSection[0]).toContain('marketplace:');
      expect(statsSection[0]).toContain('pendingActions:');
    });

    it('should have recent activity endpoint', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      expect(adminRoutesContent).toContain("'/dashboard/recent-activity'");
      expect(adminRoutesContent).toContain('formatActionDescription');
      expect(adminRoutesContent).toContain('getTimeAgo');
    });

    it('recent activity should enrich logs with descriptions', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      const activitySection = adminRoutesContent.match(
        /\/dashboard\/recent-activity'[\s\S]*?}\s*\);/
      );
      expect(activitySection).toBeTruthy();
      expect(activitySection[0]).toContain('enrichedLogs');
      expect(activitySection[0]).toContain('description:');
      expect(activitySection[0]).toContain('timeAgo:');
    });
  });

  describe('Advanced Search API', () => {
    it('should have users search endpoint', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      expect(adminRoutesContent).toContain("'/users/search'");
      expect(adminRoutesContent).toContain('GET /api/admin/users/search');
    });

    it('users search should support multiple filters', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      const searchSection = adminRoutesContent.match(/\/users\/search'[\s\S]*?}\s*\);/);
      expect(searchSection).toBeTruthy();

      // Check for filter parameters
      expect(searchSection[0]).toContain('role');
      expect(searchSection[0]).toContain('verified');
      expect(searchSection[0]).toContain('suspended');
      expect(searchSection[0]).toContain('startDate');
      expect(searchSection[0]).toContain('endDate');
      expect(searchSection[0]).toContain('limit');
      expect(searchSection[0]).toContain('offset');
    });

    it('users search should support pagination', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      // Find the route and capture until the next router. or comment
      const startIdx = adminRoutesContent.indexOf("router.get('/users/search'");
      const nextRouteIdx = adminRoutesContent.indexOf('router.', startIdx + 1);
      const nextCommentIdx = adminRoutesContent.indexOf('/**', startIdx + 1);
      const endIdx = Math.min(
        nextRouteIdx !== -1 ? nextRouteIdx : Infinity,
        nextCommentIdx !== -1 ? nextCommentIdx : Infinity
      );
      const searchSection = adminRoutesContent.substring(startIdx, endIdx);

      expect(searchSection).toContain('total');
      expect(searchSection).toContain('hasMore');
      expect(searchSection).toContain('slice(startIndex, endIndex)');
    });

    it('users search should sanitize returned data', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      // Find the route and capture until the next router. or comment
      const startIdx = adminRoutesContent.indexOf("router.get('/users/search'");
      const nextRouteIdx = adminRoutesContent.indexOf('router.', startIdx + 1);
      const nextCommentIdx = adminRoutesContent.indexOf('/**', startIdx + 1);
      const endIdx = Math.min(
        nextRouteIdx !== -1 ? nextRouteIdx : Infinity,
        nextCommentIdx !== -1 ? nextCommentIdx : Infinity
      );
      const searchSection = adminRoutesContent.substring(startIdx, endIdx);

      expect(searchSection).toContain('sanitizedUsers');
      expect(searchSection).not.toContain('password');
    });
  });

  describe('AUDIT_ACTIONS Constants', () => {
    it('should include bulk operation audit actions', () => {
      const auditContent = fs.readFileSync(
        path.join(__dirname, '../../middleware/audit-actions.js'),
        'utf8'
      );

      expect(auditContent).toContain('BULK_USERS_VERIFIED');
      expect(auditContent).toContain('BULK_USERS_SUSPENDED');
      expect(auditContent).toContain('BULK_PACKAGES_APPROVED');
      expect(auditContent).toContain('BULK_PACKAGES_FEATURED');
      expect(auditContent).toContain('BULK_PACKAGES_DELETED');
    });

    it('audit actions should be exported', () => {
      const auditContent = fs.readFileSync(
        path.join(__dirname, '../../middleware/audit.js'),
        'utf8'
      );

      expect(auditContent).toContain('module.exports');
      expect(auditContent).toContain('AUDIT_ACTIONS');
    });
  });

  describe('Helper Functions', () => {
    it('should have parseDuration helper for suspension duration', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      expect(adminRoutesContent).toContain('function parseDuration');
      expect(adminRoutesContent).toContain('days');
      expect(adminRoutesContent).toContain('hours');
      expect(adminRoutesContent).toContain('minutes');
    });

    it('should have formatActionDescription helper', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      expect(adminRoutesContent).toContain('function formatActionDescription');
      expect(adminRoutesContent).toContain('BULK_PACKAGES_APPROVED');
      expect(adminRoutesContent).toContain('BULK_USERS_VERIFIED');
    });

    it('should have getTimeAgo helper', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      expect(adminRoutesContent).toContain('function getTimeAgo');
      expect(adminRoutesContent).toContain('just now');
      expect(adminRoutesContent).toContain('ago');
    });
  });

  describe('Security & Best Practices', () => {
    it('bulk operations should validate input arrays', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      const bulkApproveSection = adminRoutesContent.match(
        /\/packages\/bulk-approve'[\s\S]*?}\s*\);/
      );
      expect(bulkApproveSection).toBeTruthy();
      expect(bulkApproveSection[0]).toContain('Array.isArray');
      expect(bulkApproveSection[0]).toContain('length === 0');
      expect(bulkApproveSection[0]).toContain('400');
    });

    it('bulk suspend should prevent self-suspension', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      const bulkSuspendSection = adminRoutesContent.match(
        /router\.post\(\s*'\/users\/bulk-suspend'[\s\S]*?\n\);/
      );
      expect(bulkSuspendSection).toBeTruthy();
      expect(bulkSuspendSection[0]).toContain('req.user.id');
      expect(bulkSuspendSection[0]).toContain('!==');
    });

    it('bulk operations should have proper error handling', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      const bulkOperations = [
        '/packages/bulk-approve',
        '/users/bulk-verify',
        '/users/bulk-suspend',
      ];

      bulkOperations.forEach(operation => {
        const operationSection = adminRoutesContent.substring(
          adminRoutesContent.indexOf(operation)
        );
        expect(operationSection).toContain('try {');
        expect(operationSection).toContain('catch (error)');
        expect(operationSection).toContain('logger.error');
        expect(operationSection).toContain('500');
      });
    });
  });
});
