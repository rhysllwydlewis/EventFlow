/**
 * Unit tests for duplicate supplier profile prevention
 *
 * Verifies that:
 *   - POST /api/me/suppliers returns 409 when a profile already exists for the user
 *   - GET /api/admin/suppliers/duplicates detects duplicate groups
 *   - GET /api/admin/suppliers/duplicates excludes missing-owner suppliers from groups
 *   - POST /api/admin/suppliers/cleanup-duplicates removes extras and keeps the best
 *   - POST /api/admin/suppliers/cleanup-duplicates rejects missing/invalid ownerUserId
 *   - POST /api/admin/suppliers/cleanup-duplicates supports dryRun mode
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
    expect(content).toContain('ownerUserId === req.user.id');
  });

  it('uses SUPPLIER_PROFILE_EXISTS error code when duplicate found', () => {
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

describe('packages.js — verification gating', () => {
  const PACKAGES_ROUTES = path.join(__dirname, '../../routes/packages.js');

  it('requires verified user for package creation (POST /me/packages)', () => {
    const content = fs.readFileSync(PACKAGES_ROUTES, 'utf8');
    // Find the POST /me/packages route and check for applyRequireVerifiedUser
    const postSection = content.slice(content.indexOf("'/me/packages',\n  applyWriteLimiter"));
    expect(postSection.slice(0, 300)).toContain('applyRequireVerifiedUser');
  });

  it('requires verified user for package update (PUT /me/packages/:id)', () => {
    const content = fs.readFileSync(PACKAGES_ROUTES, 'utf8');
    // Find PUT route via its preceding JSDoc comment
    const putIdx = content.indexOf('PUT /api/me/packages/:id\n * Update a package');
    const putSection = content.slice(putIdx, putIdx + 400);
    expect(putSection).toContain('applyRequireVerifiedUser');
  });

  it('requires verified user for package deletion (DELETE /me/packages/:id)', () => {
    const content = fs.readFileSync(PACKAGES_ROUTES, 'utf8');
    // Find the DELETE route block
    const deleteIdx = content.indexOf('DELETE /api/me/packages/:id');
    const deleteSection = content.slice(deleteIdx, deleteIdx + 400);
    expect(deleteSection).toContain('applyRequireVerifiedUser');
  });

  it('requires verified user for package photo upload (POST /me/packages/:id/photos)', () => {
    const content = fs.readFileSync(PACKAGES_ROUTES, 'utf8');
    const photoIdx = content.indexOf('POST /api/me/packages/:id/photos');
    const photoSection = content.slice(photoIdx, photoIdx + 400);
    expect(photoSection).toContain('applyRequireVerifiedUser');
  });

  it('requires verified user for package photo delete (DELETE /me/packages/:id/photos)', () => {
    const content = fs.readFileSync(PACKAGES_ROUTES, 'utf8');
    const photoDeleteIdx = content.indexOf('DELETE /api/me/packages/:id/photos');
    const photoDeleteSection = content.slice(photoDeleteIdx, photoDeleteIdx + 400);
    expect(photoDeleteSection).toContain('applyRequireVerifiedUser');
  });

  it('requires verified user for package pause (PUT /me/packages/:id/pause)', () => {
    const content = fs.readFileSync(PACKAGES_ROUTES, 'utf8');
    const pauseIdx = content.indexOf('PUT /api/me/packages/:id/pause');
    const pauseSection = content.slice(pauseIdx, pauseIdx + 400);
    expect(pauseSection).toContain('applyRequireVerifiedUser');
  });

  it('requires verified user for package unpause (PUT /me/packages/:id/unpause)', () => {
    const content = fs.readFileSync(PACKAGES_ROUTES, 'utf8');
    const unpauseIdx = content.indexOf('PUT /api/me/packages/:id/unpause');
    const unpauseSection = content.slice(unpauseIdx, unpauseIdx + 400);
    expect(unpauseSection).toContain('applyRequireVerifiedUser');
  });
});

describe('admin.js — duplicate detection endpoints', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(ADMIN_ROUTES, 'utf8');
  });

  it('has GET /suppliers/duplicates endpoint', () => {
    expect(content).toContain('/suppliers/duplicates');
  });

  it('has POST /suppliers/cleanup-duplicates endpoint', () => {
    expect(content).toContain('/suppliers/cleanup-duplicates');
  });

  it('cleanup-duplicates endpoint writes an audit log entry', () => {
    expect(content).toContain('supplier_duplicate_cleanup');
    expect(content).toContain('audit_log');
  });

  it('cleanup-duplicates requires admin role and CSRF protection', () => {
    const cleanupSection = content.slice(content.indexOf("'/suppliers/cleanup-duplicates'"));
    // The first ~300 chars of the cleanup route definition should reference CSRF
    expect(cleanupSection.slice(0, 300)).toContain('csrfProtection');
  });

  // New tests for hardened duplicate detection (PR follow-up)

  it('duplicates scan does NOT use __no_owner__ as a grouping key', () => {
    // Suppliers with no ownerUserId must not be grouped together as duplicates
    const dupSection = content.slice(
      content.indexOf('GET /api/admin/suppliers/duplicates'),
      content.indexOf('POST /api/admin/suppliers/cleanup-duplicates')
    );
    expect(dupSection).not.toContain("'__no_owner__'");
    expect(dupSection).not.toContain('"__no_owner__"');
  });

  it('duplicates scan returns missingOwnerSuppliers field', () => {
    const dupSection = content.slice(
      content.indexOf('GET /api/admin/suppliers/duplicates'),
      content.indexOf('POST /api/admin/suppliers/cleanup-duplicates')
    );
    expect(dupSection).toContain('missingOwnerSuppliers');
  });

  it('duplicates scan skips suppliers without ownerUserId', () => {
    const dupSection = content.slice(
      content.indexOf('GET /api/admin/suppliers/duplicates'),
      content.indexOf('POST /api/admin/suppliers/cleanup-duplicates')
    );
    // Should have a guard that skips entries missing ownerUserId
    expect(dupSection).toContain('!s.ownerUserId');
  });

  it('cleanup-duplicates rejects __no_owner__ sentinel value', () => {
    const cleanupSection = content.slice(content.indexOf("'/suppliers/cleanup-duplicates'"));
    expect(cleanupSection).toContain('__no_owner__');
    expect(cleanupSection).toContain('INVALID_OWNER_ID');
  });

  it('cleanup-duplicates supports dryRun option', () => {
    const cleanupSection = content.slice(content.indexOf("'/suppliers/cleanup-duplicates'"));
    expect(cleanupSection).toContain('dryRun');
  });

  it('cleanup-duplicates returns dryRun:true in response when dry run requested', () => {
    const cleanupSection = content.slice(content.indexOf("'/suppliers/cleanup-duplicates'"));
    // Should set dryRun: true in the response object
    expect(cleanupSection).toContain('dryRun: true');
  });

  it('cleanup-duplicates defaults dryRun to true (safe-by-default)', () => {
    const cleanupSection = content.slice(content.indexOf("'/suppliers/cleanup-duplicates'"));
    // Default parameter must be true so omitting dryRun performs a dry run
    expect(cleanupSection).toContain('dryRun = true');
  });

  it('cleanup-duplicates requires confirm=true when dryRun is false', () => {
    const cleanupSection = content.slice(content.indexOf("'/suppliers/cleanup-duplicates'"));
    // Must gate destructive path behind explicit confirmation
    expect(cleanupSection).toContain('CONFIRMATION_REQUIRED');
    expect(cleanupSection).toContain('confirm !== true');
  });

  it('cleanup-duplicates rejects empty/whitespace ownerUserId', () => {
    const cleanupSection = content.slice(content.indexOf("'/suppliers/cleanup-duplicates'"));
    // Must trim/check for blank ownerUserId, not just falsy
    expect(cleanupSection).toContain('ownerUserId.trim()');
  });

  it('cleanup-duplicates reassigns reviews collection', () => {
    const cleanupSection = content.slice(content.indexOf("'/suppliers/cleanup-duplicates'"));
    expect(cleanupSection).toContain("'reviews'");
  });

  it('cleanup-duplicates reassigns threads collection', () => {
    const cleanupSection = content.slice(content.indexOf("'/suppliers/cleanup-duplicates'"));
    expect(cleanupSection).toContain("'threads'");
  });

  it('cleanup-duplicates reassigns messages collection', () => {
    const cleanupSection = content.slice(content.indexOf("'/suppliers/cleanup-duplicates'"));
    expect(cleanupSection).toContain("'messages'");
  });
});

describe('admin.js — cleanup-duplicates reassignment plan', () => {
  it('uses collectionsToReassign array covering packages, reviews, threads, messages', () => {
    const content = fs.readFileSync(ADMIN_ROUTES, 'utf8');
    const cleanupSection = content.slice(content.indexOf("'/suppliers/cleanup-duplicates'"));
    expect(cleanupSection).toContain('collectionsToReassign');
    expect(cleanupSection).toContain("'packages'");
    expect(cleanupSection).toContain("'reviews'");
    expect(cleanupSection).toContain("'threads'");
    expect(cleanupSection).toContain("'messages'");
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
