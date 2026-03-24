/**
 * Unit tests for supplier-facing package CRUD routes
 * Verifies that GET, PUT, and DELETE /me/packages/:id routes exist in routes/packages.js
 * with the correct auth guards, ownership verification, rate limiting, and CSRF protection.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PACKAGES_ROUTES = path.join(__dirname, '../../routes/packages.js');

let routesContent;

beforeAll(() => {
  routesContent = fs.readFileSync(PACKAGES_ROUTES, 'utf8');
});

describe('Supplier Packages — Route Structure', () => {
  it('GET /me/packages/:id route exists', () => {
    expect(routesContent).toContain("router.get(\n  '/me/packages/:id'");
  });

  it('PUT /me/packages/:id route exists', () => {
    expect(routesContent).toContain("router.put(\n  '/me/packages/:id'");
  });

  it('DELETE /me/packages/:id route exists', () => {
    expect(routesContent).toContain("router.delete(\n  '/me/packages/:id'");
  });
});

describe('Supplier Packages — Auth & Role Guards', () => {
  function extractRouteBlock(method, path) {
    const marker = `router.${method}(\n  '${path}'`;
    const start = routesContent.indexOf(marker);
    if (start === -1) {
      return null;
    }
    // Find the start of the next router.* definition to avoid truncating the block.
    const afterStart = routesContent.indexOf('\nrouter.', start + marker.length);
    const end = afterStart === -1 ? routesContent.length : afterStart;
    return routesContent.substring(start, end);
  }

  it('GET /me/packages/:id requires applyAuthRequired', () => {
    const block = extractRouteBlock('get', '/me/packages/:id');
    expect(block).not.toBeNull();
    expect(block).toContain('applyAuthRequired');
  });

  it("GET /me/packages/:id requires applyRoleRequired('supplier')", () => {
    const block = extractRouteBlock('get', '/me/packages/:id');
    expect(block).toContain("applyRoleRequired('supplier')");
  });

  it('GET /me/packages/:id has rate limiting (applyWriteLimiter)', () => {
    const block = extractRouteBlock('get', '/me/packages/:id');
    expect(block).toContain('applyWriteLimiter');
  });

  it('PUT /me/packages/:id requires applyAuthRequired', () => {
    const block = extractRouteBlock('put', '/me/packages/:id');
    expect(block).not.toBeNull();
    expect(block).toContain('applyAuthRequired');
  });

  it("PUT /me/packages/:id requires applyRoleRequired('supplier')", () => {
    const block = extractRouteBlock('put', '/me/packages/:id');
    expect(block).toContain("applyRoleRequired('supplier')");
  });

  it('PUT /me/packages/:id has CSRF protection', () => {
    const block = extractRouteBlock('put', '/me/packages/:id');
    expect(block).toContain('applyCsrfProtection');
  });

  it('PUT /me/packages/:id has rate limiting (applyWriteLimiter)', () => {
    const block = extractRouteBlock('put', '/me/packages/:id');
    expect(block).toContain('applyWriteLimiter');
  });

  it('DELETE /me/packages/:id requires applyAuthRequired', () => {
    const block = extractRouteBlock('delete', '/me/packages/:id');
    expect(block).not.toBeNull();
    expect(block).toContain('applyAuthRequired');
  });

  it("DELETE /me/packages/:id requires applyRoleRequired('supplier')", () => {
    const block = extractRouteBlock('delete', '/me/packages/:id');
    expect(block).toContain("applyRoleRequired('supplier')");
  });

  it('DELETE /me/packages/:id has CSRF protection', () => {
    const block = extractRouteBlock('delete', '/me/packages/:id');
    expect(block).toContain('applyCsrfProtection');
  });

  it('DELETE /me/packages/:id has rate limiting (applyWriteLimiter)', () => {
    const block = extractRouteBlock('delete', '/me/packages/:id');
    expect(block).toContain('applyWriteLimiter');
  });
});

describe('Supplier Packages — Ownership Verification', () => {
  it('resolveOwnedPackage helper function exists', () => {
    expect(routesContent).toContain('async function resolveOwnedPackage(');
  });

  it('resolveOwnedPackage fetches packages and suppliers in parallel via Promise.all', () => {
    expect(routesContent).toContain('Promise.all([');
    expect(routesContent).toContain("dbUnified.read('packages')");
    expect(routesContent).toContain("dbUnified.read('suppliers')");
  });

  it('resolveOwnedPackage returns 404 for unknown package', () => {
    const helperStart = routesContent.indexOf('async function resolveOwnedPackage(');
    const helperBlock = routesContent.substring(helperStart, helperStart + 600);
    expect(helperBlock).toContain('404');
    expect(helperBlock).toContain('Package not found');
  });

  it('resolveOwnedPackage returns 403 when supplier does not own package', () => {
    const helperStart = routesContent.indexOf('async function resolveOwnedPackage(');
    const helperBlock = routesContent.substring(helperStart, helperStart + 600);
    expect(helperBlock).toContain('403');
    expect(helperBlock).toContain('Forbidden');
  });

  it('ownership check uses ownerUserId matching req.user.id', () => {
    expect(routesContent).toContain('s.ownerUserId === req.user.id');
  });
});

describe('Supplier Packages — DELETE response', () => {
  it('DELETE /me/packages/:id calls dbUnified.deleteOne', () => {
    expect(routesContent).toContain("dbUnified.deleteOne('packages'");
  });

  it('DELETE /me/packages/:id returns { ok: true, message }', () => {
    expect(routesContent).toContain("'Package deleted successfully'");
  });
});

describe('Supplier Packages — PUT field handling', () => {
  it('PUT /me/packages/:id updates title with length cap', () => {
    expect(routesContent).toContain('String(req.body.title).slice(0, 120)');
  });

  it('PUT /me/packages/:id updates description with length cap', () => {
    expect(routesContent).toContain('String(req.body.description).slice(0, 1500)');
  });

  it('PUT /me/packages/:id validates eventTypes to allowed values', () => {
    expect(routesContent).toMatch(/eventTypes.*filter.*wedding.*other/s);
  });

  it('PUT /me/packages/:id sets updatedAt timestamp', () => {
    expect(routesContent).toContain('updatedAt');
    expect(routesContent).toContain('new Date().toISOString()');
  });

  it('PUT /me/packages/:id calls dbUnified.updateOne', () => {
    expect(routesContent).toContain("dbUnified.updateOne('packages'");
  });
});

describe('Supplier Packages — Router mounting (routes/index.js)', () => {
  it('packages router is mounted at /api/v1 in routes/index.js', () => {
    const indexContent = fs.readFileSync(path.join(__dirname, '../../routes/index.js'), 'utf8');
    expect(indexContent).toContain("app.use('/api/v1', packagesRoutes)");
  });

  it('packages router is mounted at /api for backward compat', () => {
    const indexContent = fs.readFileSync(path.join(__dirname, '../../routes/index.js'), 'utf8');
    expect(indexContent).toContain("app.use('/api', packagesRoutes)");
  });
});

describe('Supplier Packages — Pause/Unpause Routes', () => {
  function extractRouteBlock(method, path) {
    const marker = `router.${method}(\n  '${path}'`;
    const start = routesContent.indexOf(marker);
    if (start === -1) {
      return null;
    }
    const afterStart = routesContent.indexOf('\nrouter.', start + marker.length);
    const end = afterStart === -1 ? routesContent.length : afterStart;
    return routesContent.substring(start, end);
  }

  it('PUT /me/packages/:id/pause route exists', () => {
    expect(routesContent).toContain("router.put(\n  '/me/packages/:id/pause'");
  });

  it('PUT /me/packages/:id/unpause route exists', () => {
    expect(routesContent).toContain("router.put(\n  '/me/packages/:id/unpause'");
  });

  it('PUT /me/packages/:id/pause requires applyAuthRequired', () => {
    const block = extractRouteBlock('put', '/me/packages/:id/pause');
    expect(block).not.toBeNull();
    expect(block).toContain('applyAuthRequired');
  });

  it("PUT /me/packages/:id/pause requires applyRoleRequired('supplier')", () => {
    const block = extractRouteBlock('put', '/me/packages/:id/pause');
    expect(block).toContain("applyRoleRequired('supplier')");
  });

  it('PUT /me/packages/:id/pause has CSRF protection', () => {
    const block = extractRouteBlock('put', '/me/packages/:id/pause');
    expect(block).toContain('applyCsrfProtection');
  });

  it('PUT /me/packages/:id/pause has rate limiting', () => {
    const block = extractRouteBlock('put', '/me/packages/:id/pause');
    expect(block).toContain('applyWriteLimiter');
  });

  it('PUT /me/packages/:id/pause enforces ownership via resolveOwnedPackage', () => {
    const block = extractRouteBlock('put', '/me/packages/:id/pause');
    expect(block).toContain('resolveOwnedPackage');
  });

  it('PUT /me/packages/:id/pause sets paused to true via dbUnified.updateOne', () => {
    const block = extractRouteBlock('put', '/me/packages/:id/pause');
    expect(block).toContain('paused: true');
    expect(block).toContain("dbUnified.updateOne('packages'");
  });

  it('PUT /me/packages/:id/pause returns { ok: true, package }', () => {
    const block = extractRouteBlock('put', '/me/packages/:id/pause');
    expect(block).toContain('ok: true');
    expect(block).toContain('package:');
  });

  it('PUT /me/packages/:id/unpause requires applyAuthRequired', () => {
    const block = extractRouteBlock('put', '/me/packages/:id/unpause');
    expect(block).not.toBeNull();
    expect(block).toContain('applyAuthRequired');
  });

  it("PUT /me/packages/:id/unpause requires applyRoleRequired('supplier')", () => {
    const block = extractRouteBlock('put', '/me/packages/:id/unpause');
    expect(block).toContain("applyRoleRequired('supplier')");
  });

  it('PUT /me/packages/:id/unpause has CSRF protection', () => {
    const block = extractRouteBlock('put', '/me/packages/:id/unpause');
    expect(block).toContain('applyCsrfProtection');
  });

  it('PUT /me/packages/:id/unpause enforces ownership via resolveOwnedPackage', () => {
    const block = extractRouteBlock('put', '/me/packages/:id/unpause');
    expect(block).toContain('resolveOwnedPackage');
  });

  it('PUT /me/packages/:id/unpause sets paused to false via dbUnified.updateOne', () => {
    const block = extractRouteBlock('put', '/me/packages/:id/unpause');
    expect(block).toContain('paused: false');
    expect(block).toContain("dbUnified.updateOne('packages'");
  });

  it('PUT /me/packages/:id/unpause returns { ok: true, package }', () => {
    const block = extractRouteBlock('put', '/me/packages/:id/unpause');
    expect(block).toContain('ok: true');
    expect(block).toContain('package:');
  });
});
