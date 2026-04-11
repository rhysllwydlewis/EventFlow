/**
 * Unit tests for supplier directory health diagnostics and
 * businessName/name search normalisation.
 *
 * Verifies that:
 *   - GET /api/admin/suppliers/directory-health endpoint exists in supplier-admin.js
 *   - The endpoint is admin-only
 *   - The endpoint groups excluded suppliers by the correct reasons
 *   - routes/admin.js declares a pass-through for /suppliers/directory-health BEFORE
 *     the /suppliers/:id wildcard (prevents Express from swallowing the static path)
 *   - searchService.js normalises businessName → name when projecting public fields
 *   - searchWeighting.js scores against businessName as a fallback for name
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SUPPLIER_ADMIN = path.join(__dirname, '../../routes/supplier-admin.js');
const ADMIN_ROUTES = path.join(__dirname, '../../routes/admin.js');
const SEARCH_SERVICE = path.join(__dirname, '../../services/searchService.js');
const SEARCH_WEIGHTING = path.join(__dirname, '../../utils/searchWeighting.js');

// ---------------------------------------------------------------------------
// supplier-admin.js — directory-health endpoint
// ---------------------------------------------------------------------------
describe('supplier-admin.js — directory-health diagnostic endpoint', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SUPPLIER_ADMIN, 'utf8');
  });

  it('has GET /suppliers/directory-health endpoint', () => {
    expect(content).toContain('/suppliers/directory-health');
  });

  it('requires admin role', () => {
    const routeIdx = content.indexOf("'/suppliers/directory-health'");
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 300);
    expect(routeSection).toContain("'admin'");
  });

  it('returns noProfile group for supplier-role users without a profile', () => {
    const routeIdx = content.indexOf("'/suppliers/directory-health'");
    const routeBody = content.slice(routeIdx, routeIdx + 3200);
    expect(routeBody).toContain('noProfile');
    expect(routeBody).toContain("role === 'supplier'");
  });

  it('returns notApproved group for supplier profiles not yet approved', () => {
    const routeIdx = content.indexOf("'/suppliers/directory-health'");
    const routeBody = content.slice(routeIdx, routeIdx + 3200);
    expect(routeBody).toContain('notApproved');
    expect(routeBody).toContain('approved !== true');
  });

  it('returns orphaned group for profiles with no ownerUserId', () => {
    const routeIdx = content.indexOf("'/suppliers/directory-health'");
    const routeBody = content.slice(routeIdx, routeIdx + 3200);
    expect(routeBody).toContain('orphaned');
    expect(routeBody).toContain('!s.ownerUserId');
  });

  it('returns missingName group for profiles with no name or businessName', () => {
    const routeIdx = content.indexOf("'/suppliers/directory-health'");
    const routeBody = content.slice(routeIdx, routeIdx + 3200);
    expect(routeBody).toContain('missingName');
    expect(routeBody).toContain('!s.name');
    expect(routeBody).toContain('!s.businessName');
  });

  it('response includes a summary object with counts', () => {
    const routeIdx = content.indexOf("'/suppliers/directory-health'");
    const routeBody = content.slice(routeIdx, routeIdx + 3200);
    expect(routeBody).toContain('summary');
    expect(routeBody).toContain('supplierUsers');
    expect(routeBody).toContain('supplierProfiles');
  });

  it('includes excludedReason on each diagnostic entry', () => {
    const routeIdx = content.indexOf("'/suppliers/directory-health'");
    const routeBody = content.slice(routeIdx, routeIdx + 3200);
    expect(routeBody).toContain('excludedReason');
  });
});

// ---------------------------------------------------------------------------
// searchService.js — businessName normalisation in projectPublicSupplierFields
// ---------------------------------------------------------------------------
describe('searchService.js — businessName normalisation', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SEARCH_SERVICE, 'utf8');
  });

  it('uses || supplier.businessName as fallback when projecting name', () => {
    const projFnIdx = content.indexOf('function projectPublicSupplierFields');
    expect(projFnIdx).not.toBe(-1);
    const projFnBody = content.slice(projFnIdx, projFnIdx + 600);
    // Should use businessName as fallback
    expect(projFnBody).toContain('supplier.businessName');
  });
});

// ---------------------------------------------------------------------------
// searchWeighting.js — businessName fallback in calculateRelevanceScore
// ---------------------------------------------------------------------------
describe('searchWeighting.js — businessName fallback in calculateRelevanceScore', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SEARCH_WEIGHTING, 'utf8');
  });

  it('calculates field score using item.businessName as name fallback', () => {
    const fnIdx = content.indexOf('function calculateRelevanceScore');
    expect(fnIdx).not.toBe(-1);
    const fnBody = content.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toContain('item.businessName');
  });

  it('getMatchingFields checks businessName as name fallback', () => {
    const fnIdx = content.indexOf('function getMatchingFields');
    expect(fnIdx).not.toBe(-1);
    const fnBody = content.slice(fnIdx, fnIdx + 400);
    expect(fnBody).toContain('item.businessName');
  });
});

// ---------------------------------------------------------------------------
// routes/admin.js — directory-health must not be swallowed by /suppliers/:id
// ---------------------------------------------------------------------------
describe('admin.js — directory-health route ordering prevents wildcard capture', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(ADMIN_ROUTES, 'utf8');
  });

  it('has a pass-through or handler for /suppliers/directory-health', () => {
    expect(content).toContain('/suppliers/directory-health');
  });

  it('declares /suppliers/directory-health BEFORE /suppliers/:id', () => {
    const healthIdx = content.indexOf('/suppliers/directory-health');
    const wildcardIdx = content.indexOf("router.get('/suppliers/:id'");
    expect(healthIdx).not.toBe(-1);
    expect(wildcardIdx).not.toBe(-1);
    expect(healthIdx).toBeLessThan(wildcardIdx);
  });
});
