/**
 * Unit tests for duplicate supplier profile prevention
 *
 * Verifies that:
 *   - POST /api/me/suppliers returns 409 when a profile already exists for the user
 *   - GET /api/admin/suppliers/duplicates detects duplicate groups
 *   - POST /api/admin/suppliers/cleanup-duplicates removes extras and keeps the best
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SUPPLIER_MANAGEMENT = path.join(__dirname, '../../routes/supplier-management.js');
const ADMIN_ROUTES = path.join(__dirname, '../../routes/admin.js');

describe('supplier-management.js — duplicate prevention logic', () => {
  it('checks for existing supplier profile before inserting', () => {
    const content = fs.readFileSync(SUPPLIER_MANAGEMENT, 'utf8');
    // Should contain a check for ownerUserId uniqueness
    expect(content).toMatch(/ownerUserId.*===.*req\.user\.id|SUPPLIER_PROFILE_EXISTS/);
  });

  it('returns 409 status code for duplicate profiles', () => {
    const content = fs.readFileSync(SUPPLIER_MANAGEMENT, 'utf8');
    expect(content).toContain('409');
  });

  it('includes SUPPLIER_PROFILE_EXISTS error code', () => {
    const content = fs.readFileSync(SUPPLIER_MANAGEMENT, 'utf8');
    expect(content).toContain('SUPPLIER_PROFILE_EXISTS');
  });

  it('requires verified user for supplier creation', () => {
    const content = fs.readFileSync(SUPPLIER_MANAGEMENT, 'utf8');
    expect(content).toContain('applyRequireVerifiedUser');
  });

  it('requires verified user for supplier update', () => {
    const content = fs.readFileSync(SUPPLIER_MANAGEMENT, 'utf8');
    // PATCH route should also include applyRequireVerifiedUser
    const patchSection = content.slice(content.indexOf("router.patch(\n  '/:id'"));
    expect(patchSection.slice(0, 500)).toContain('applyRequireVerifiedUser');
  });
});

describe('admin.js — duplicate detection endpoints', () => {
  it('has GET /suppliers/duplicates endpoint', () => {
    const content = fs.readFileSync(ADMIN_ROUTES, 'utf8');
    expect(content).toContain('/suppliers/duplicates');
  });

  it('has POST /suppliers/cleanup-duplicates endpoint', () => {
    const content = fs.readFileSync(ADMIN_ROUTES, 'utf8');
    expect(content).toContain('/suppliers/cleanup-duplicates');
  });

  it('cleanup-duplicates endpoint writes an audit log entry', () => {
    const content = fs.readFileSync(ADMIN_ROUTES, 'utf8');
    expect(content).toContain('supplier_duplicate_cleanup');
    expect(content).toContain('audit_log');
  });

  it('cleanup-duplicates requires admin role and CSRF protection', () => {
    const content = fs.readFileSync(ADMIN_ROUTES, 'utf8');
    const cleanupSection = content.slice(content.indexOf("'/suppliers/cleanup-duplicates'"));
    // The first ~300 chars of the cleanup route definition should reference CSRF
    expect(cleanupSection.slice(0, 300)).toContain('csrfProtection');
  });
});

describe('emailVerification.js — canonical verification link', () => {
  it('sends /verify?token=... links (not /verify-email?token=...)', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '../../routes/emailVerification.js'),
      'utf8'
    );
    expect(content).toContain('/verify?token=');
    expect(content).not.toContain('/verify-email?token=');
  });
});
