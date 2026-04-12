/**
 * Unit tests for supplier photo gallery endpoints in routes/suppliers-v2.js
 * Covers the new PATCH /:id/photos/order endpoint and verifies the existing
 * DELETE /:id/photos/:photoId route has proper guards.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SUPPLIERS_V2 = path.join(__dirname, '../../routes/suppliers-v2.js');

let routesContent;

beforeAll(() => {
  routesContent = fs.readFileSync(SUPPLIERS_V2, 'utf8');
});

// ─── Module loading ───────────────────────────────────────────────────────────

describe('Suppliers V2 Module', () => {
  it('should be requireable without crashing', () => {
    expect(() => {
      const r = require('../../routes/suppliers-v2');
      expect(r).toBeDefined();
    }).not.toThrow();
  });

  it('should export initializeDependencies', () => {
    const r = require('../../routes/suppliers-v2');
    expect(typeof r.initializeDependencies).toBe('function');
  });

  it('should export a router with delete and patch methods', () => {
    const r = require('../../routes/suppliers-v2');
    expect(typeof r.delete).toBe('function');
    expect(typeof r.patch).toBe('function');
  });
});

// ─── Route structure ──────────────────────────────────────────────────────────

describe('Suppliers V2 — Route Structure', () => {
  it('GET /:id/photos route exists', () => {
    expect(routesContent).toContain("router.get('/:id/photos'");
  });

  it('GET /:id/photos has rate limiting (applyWriteLimiter)', () => {
    const idx = routesContent.indexOf("router.get('/:id/photos'");
    const block = routesContent.substring(idx, routesContent.indexOf('\nrouter.', idx + 1));
    expect(block).toContain('applyWriteLimiter');
  });

  it('POST /:id/photos route exists', () => {
    expect(routesContent).toContain("router.post(\n  '/:id/photos'");
  });

  it('DELETE /:id/photos/:photoId route exists', () => {
    expect(routesContent).toContain("router.delete(\n  '/:id/photos/:photoId'");
  });

  it('PATCH /:id/photos/order route exists', () => {
    expect(routesContent).toContain("router.patch(\n  '/:id/photos/order'");
  });
});

// ─── Helper to extract a route block ─────────────────────────────────────────

function extractRouteBlock(method, routePath) {
  const marker = `router.${method}(\n  '${routePath}'`;
  const start = routesContent.indexOf(marker);
  if (start === -1) {
    return null;
  }
  const afterStart = routesContent.indexOf('\nrouter.', start + marker.length);
  const end = afterStart === -1 ? routesContent.length : afterStart;
  return routesContent.substring(start, end);
}

// ─── Auth & security guards ───────────────────────────────────────────────────

describe('Suppliers V2 — PATCH /:id/photos/order guards', () => {
  let block;

  beforeAll(() => {
    block = extractRouteBlock('patch', '/:id/photos/order');
  });

  it('route block exists', () => {
    expect(block).not.toBeNull();
  });

  it('requires applyAuthRequired', () => {
    expect(block).toContain('applyAuthRequired');
  });

  it('requires applyRequireVerifiedUser', () => {
    expect(block).toContain('applyRequireVerifiedUser');
  });

  it('requires applyCsrfProtection', () => {
    expect(block).toContain('applyCsrfProtection');
  });

  it('requires applyWriteLimiter (rate limiting)', () => {
    expect(block).toContain('applyWriteLimiter');
  });

  it('validates that photoIds is an array', () => {
    expect(block).toContain('Array.isArray(photoIds)');
  });

  it('enforces a max of 10 photos', () => {
    expect(block).toContain('photoIds.length > 10');
  });

  it('checks supplier ownership', () => {
    expect(block).toContain("req.user.id");
    expect(block).toContain('ownerUserId');
  });

  it('validates that provided IDs belong to the supplier', () => {
    expect(block).toContain('invalidIds');
  });

  it('busts the catalog cache after reorder', () => {
    expect(block).toContain('catalogCache');
    expect(block).toContain('invalidate');
  });
});

describe('Suppliers V2 — DELETE /:id/photos/:photoId guards', () => {
  let block;

  beforeAll(() => {
    block = extractRouteBlock('delete', '/:id/photos/:photoId');
  });

  it('route block exists', () => {
    expect(block).not.toBeNull();
  });

  it('requires applyAuthRequired', () => {
    expect(block).toContain('applyAuthRequired');
  });

  it('requires applyRequireVerifiedUser', () => {
    expect(block).toContain('applyRequireVerifiedUser');
  });

  it('requires applyCsrfProtection', () => {
    expect(block).toContain('applyCsrfProtection');
  });

  it('requires applyWriteLimiter (rate limiting)', () => {
    expect(block).toContain('applyWriteLimiter');
  });

  it('checks supplier ownership', () => {
    expect(block).toContain('ownerUserId');
  });
});

// ─── catalogCache import ──────────────────────────────────────────────────────

describe('Suppliers V2 — catalogCache dependency', () => {
  it('imports catalogCache at the top of the file', () => {
    expect(routesContent).toContain("require('../services/catalogCache')");
  });
});
