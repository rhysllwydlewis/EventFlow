/**
 * Integration tests for consolidated admin audit endpoints
 * Tests the refactored audit system using dbUnified
 */

'use strict';

const fs = require('fs');
const path = require('path');

describe('Admin Audit Endpoints Consolidation', () => {
  describe('Endpoint Structure', () => {
    it('should have audit-logs endpoint in routes/admin.js', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      // Verify canonical audit-logs endpoint exists
      expect(adminRoutesContent).toContain("router.get('/audit-logs'");
      expect(adminRoutesContent).toContain('authRequired');
      expect(adminRoutesContent).toContain("roleRequired('admin')");
    });

    it('should have backwards compatible audit endpoint', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      // Verify backwards compatible audit endpoint exists
      expect(adminRoutesContent).toContain("router.get('/audit'");
      expect(adminRoutesContent).toContain('getAuditLogs');
    });

    it('should not have audit-logs endpoint in server.js', () => {
      const serverContent = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

      // Verify endpoint is moved (should have comment about consolidation)
      expect(serverContent).toContain('Admin audit endpoints moved to routes/admin.js');
    });
  });

  describe('Marketplace Admin Endpoints', () => {
    it('should have marketplace listings endpoint in routes/admin.js', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      expect(adminRoutesContent).toContain("router.get('/marketplace/listings'");
      expect(adminRoutesContent).toContain('authRequired');
      expect(adminRoutesContent).toContain("roleRequired('admin')");
    });

    it('should have marketplace approve endpoint in routes/admin.js', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      expect(adminRoutesContent).toContain('router.post');
      expect(adminRoutesContent).toContain("'/marketplace/listings/:id/approve'");
      expect(adminRoutesContent).toContain('csrfProtection');
    });

    it('should use auditLog function for marketplace approve', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      // Check that marketplace approve uses auditLog
      // Look for the entire approve route section
      expect(adminRoutesContent).toContain("'/marketplace/listings/:id/approve'");
      expect(adminRoutesContent).toContain('await auditLog({');
      expect(adminRoutesContent).toContain('marketplace_listing_approved');
      expect(adminRoutesContent).toContain('marketplace_listing_rejected');
    });
  });

  describe('Audit Middleware', () => {
    it('should use dbUnified in audit.js', () => {
      const auditContent = fs.readFileSync(
        path.join(__dirname, '../../middleware/audit.js'),
        'utf8'
      );

      // Verify dbUnified is required
      expect(auditContent).toContain("require('../db-unified')");
      expect(auditContent).not.toContain("require('../store')");
    });

    it('should have resilient auditLog function', () => {
      const auditContent = fs.readFileSync(
        path.join(__dirname, '../../middleware/audit.js'),
        'utf8'
      );

      // Verify auditLog is async and has error handling
      expect(auditContent).toContain('async function auditLog');
      expect(auditContent).toContain('try {');
      expect(auditContent).toContain('catch (error)');
      expect(auditContent).toContain('AUDIT ERROR');
    });

    it('should have async getAuditLogs with adminEmail filter', () => {
      const auditContent = fs.readFileSync(
        path.join(__dirname, '../../middleware/audit.js'),
        'utf8'
      );

      // Verify getAuditLogs is async and supports adminEmail filter
      expect(auditContent).toContain('async function getAuditLogs');
      expect(auditContent).toContain('adminEmail');
      expect(auditContent).toContain('await dbUnified.read');
    });

    it('should have audit middleware with async auditLog', () => {
      const auditContent = fs.readFileSync(
        path.join(__dirname, '../../middleware/audit.js'),
        'utf8'
      );

      // Verify middleware uses async pattern
      expect(auditContent).toContain('function auditMiddleware');
      expect(auditContent).toContain('await auditLog');
    });
  });

  describe('Audit Frontend', () => {
    it('should use canonical audit-logs endpoint in admin-audit.html or admin-audit-init.js', () => {
      const auditHtmlContent = fs.readFileSync(
        path.join(__dirname, '../../public/admin-audit.html'),
        'utf8'
      );

      // The JS may be in the HTML inline or in the extracted init file
      const auditInitPath = path.join(
        __dirname,
        '../../public/assets/js/pages/admin-audit-init.js'
      );
      const auditInitContent = fs.existsSync(auditInitPath)
        ? fs.readFileSync(auditInitPath, 'utf8')
        : '';

      const combined = auditHtmlContent + auditInitContent;

      // Verify it uses audit-logs endpoint
      expect(combined).toContain('/api/admin/audit-logs');
      // Verify it expects logs response format
      expect(combined).toContain('data.logs');
    });

    it('should use AdminShared.api() in admin-audit.html or admin-audit-init.js', () => {
      const auditHtmlContent = fs.readFileSync(
        path.join(__dirname, '../../public/admin-audit.html'),
        'utf8'
      );

      // The JS may be in the HTML inline or in the extracted init file
      const auditInitPath = path.join(
        __dirname,
        '../../public/assets/js/pages/admin-audit-init.js'
      );
      const auditInitContent = fs.existsSync(auditInitPath)
        ? fs.readFileSync(auditInitPath, 'utf8')
        : '';

      const combined = auditHtmlContent + auditInitContent;

      // Verify it uses AdminShared.api
      expect(combined).toContain('AdminShared.api');
    });
  });

  describe('Response Format Standardization', () => {
    it('both audit endpoints should return same response format', () => {
      const adminRoutesContent = fs.readFileSync(
        path.join(__dirname, '../../routes/admin.js'),
        'utf8'
      );

      // Both routes share one handler, so they cannot drift apart
      expect(adminRoutesContent).toMatch(
        /router\.get\('\/audit-logs', authRequired, roleRequired\('admin'\), listAuditLogs\)/
      );
      expect(adminRoutesContent).toMatch(
        /router\.get\('\/audit', authRequired, roleRequired\('admin'\), listAuditLogs\)/
      );

      // ...and it returns the { logs, count } format (plus total/page/limit for paging)
      const handler = adminRoutesContent.match(/async function listAuditLogs[\s\S]*?\n\}\n/);
      expect(handler).toBeTruthy();
      expect(handler[0]).toContain('logs: result.logs');
      expect(handler[0]).toContain('count: result.logs.length');
      expect(handler[0]).toContain('total: result.total');
    });
  });
});
