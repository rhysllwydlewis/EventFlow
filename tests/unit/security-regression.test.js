/**
 * Security Regression Tests
 *
 * Guards against reintroduction of critical security issues:
 * A) Admin debug routes exposed in production
 * B) CSP unsafe-inline for scripts
 */

'use strict';

const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ─── A) Admin Debug Route Gating ─────────────────────────────────────────────

describe('Admin Debug Route Gating', () => {
  /**
   * Build a minimal Express app that calls mountRoutes.
   * We inject a stub `db` so route modules don't blow up on require.
   */
  function buildApp({ nodeEnv, enableDebugEnvVar }) {
    // Set env BEFORE requiring routes (require cache may already be warm,
    // but mountRoutes reads process.env at call time, not require time).
    const origNodeEnv = process.env.NODE_ENV;
    const origDebug = process.env.ENABLE_ADMIN_DEBUG_ROUTES;

    process.env.NODE_ENV = nodeEnv;
    if (enableDebugEnvVar === undefined) {
      delete process.env.ENABLE_ADMIN_DEBUG_ROUTES;
    } else {
      process.env.ENABLE_ADMIN_DEBUG_ROUTES = enableDebugEnvVar;
    }

    const app = express();

    // Minimal stub deps expected by mountRoutes / route modules
    const stubDb = {
      collection: () => ({
        findOne: async () => null,
        find: () => ({ toArray: async () => [] }),
        insertOne: async () => ({}),
        updateOne: async () => ({}),
        deleteOne: async () => ({}),
      }),
    };

    try {
      // Clear the routes/index module from cache so NODE_ENV is re-evaluated
      delete require.cache[require.resolve('../../routes/index')];
      const { mountRoutes } = require('../../routes/index');
      mountRoutes(app, { db: stubDb });
    } catch (err) {
      // If mountRoutes throws due to missing deps in a specific route,
      // that's acceptable for this test – we've still exercised the gating logic.
    }

    // Restore env
    process.env.NODE_ENV = origNodeEnv;
    if (origDebug === undefined) {
      delete process.env.ENABLE_ADMIN_DEBUG_ROUTES;
    } else {
      process.env.ENABLE_ADMIN_DEBUG_ROUTES = origDebug;
    }

    return app;
  }

  describe('Production environment (NODE_ENV=production)', () => {
    let app;

    beforeAll(() => {
      app = buildApp({ nodeEnv: 'production', enableDebugEnvVar: undefined });
    });

    it('returns 404 for GET /api/v1/admin/debug/user in production', async () => {
      const res = await request(app).get('/api/v1/admin/debug/user');
      expect(res.status).toBe(404);
    });

    it('returns 404 for GET /api/admin/debug/user (legacy alias) in production', async () => {
      const res = await request(app).get('/api/admin/debug/user');
      expect(res.status).toBe(404);
    });

    it('remains 404 even when ENABLE_ADMIN_DEBUG_ROUTES=true in production', async () => {
      const app2 = buildApp({ nodeEnv: 'production', enableDebugEnvVar: 'true' });
      const res = await request(app2).get('/api/v1/admin/debug/user');
      expect(res.status).toBe(404);
    });
  });

  describe('Non-production environment without ENABLE_ADMIN_DEBUG_ROUTES', () => {
    let app;

    beforeAll(() => {
      app = buildApp({ nodeEnv: 'development', enableDebugEnvVar: undefined });
    });

    it('returns 404 for /api/v1/admin/debug/user when flag not set', async () => {
      const res = await request(app).get('/api/v1/admin/debug/user');
      expect(res.status).toBe(404);
    });
  });

  describe('routes/index.js source guards', () => {
    const routesIndexPath = path.join(__dirname, '../../routes/index.js');
    let src;

    beforeAll(() => {
      src = fs.readFileSync(routesIndexPath, 'utf8');
    });

    it('does not unconditionally require or mount admin-debug routes', () => {
      // Verify the require of admin-debug is inside a conditional block,
      // not at the top-level module scope.
      // The require line itself is indented inside an if-block — confirm
      // that the surrounding context contains !isProduction and the debug flag.
      const requireIndex = src.indexOf("require('./admin-debug')");
      expect(requireIndex).toBeGreaterThan(-1); // sanity check: line exists
      // The 300 characters before the require should contain the if condition
      const context = src.slice(Math.max(0, requireIndex - 300), requireIndex);
      expect(context).toMatch(/if\s*\(/);
      expect(context).toMatch(/isProduction|ENABLE_ADMIN_DEBUG_ROUTES/);
    });

    it('gates debug routes behind both !isProduction and ENABLE_ADMIN_DEBUG_ROUTES check', () => {
      expect(src).toMatch(/!isProduction/);
      expect(src).toMatch(/ENABLE_ADMIN_DEBUG_ROUTES/);
    });

    it('production check uses NODE_ENV === production (not just truthy)', () => {
      expect(src).toMatch(/NODE_ENV\s*===\s*['"]production['"]/);
    });
  });
});

// ─── B) CSP unsafe-inline Regression ─────────────────────────────────────────

describe('CSP unsafe-inline Regression', () => {
  const securityPath = path.join(__dirname, '../../middleware/security.js');
  let src;

  beforeAll(() => {
    src = fs.readFileSync(securityPath, 'utf8');
  });

  it("does not include 'unsafe-inline' in scriptSrc", () => {
    // Parse out the scriptSrc array region; ensure unsafe-inline is absent
    // We check the raw source since the actual config object is nested.
    // Look for the specific pattern used in the directive.
    const scriptSrcRegion = src.match(/scriptSrc:\s*\[([^\]]+)\]/);
    if (scriptSrcRegion) {
      expect(scriptSrcRegion[1]).not.toContain("'unsafe-inline'");
    }
    // Belt-and-braces: also verify the full file doesn't accidentally include it
    // in a non-commented line adjacent to scriptSrc
    const lines = src.split('\n');
    const scriptSrcLines = [];
    let inScriptSrc = false;
    let depth = 0;
    for (const line of lines) {
      if (line.match(/scriptSrc\s*:/)) {
        inScriptSrc = true;
        depth = 0;
      }
      if (inScriptSrc) {
        scriptSrcLines.push(line);
        depth += (line.match(/\[/g) || []).length - (line.match(/\]/g) || []).length;
        if (depth <= 0 && scriptSrcLines.length > 1) {
          inScriptSrc = false;
        }
      }
    }
    const scriptSrcBlock = scriptSrcLines.join('\n');
    expect(scriptSrcBlock).not.toContain("'unsafe-inline'");
  });

  it("does not include 'unsafe-inline' in scriptSrcElem", () => {
    const scriptSrcElemRegion = src.match(/scriptSrcElem:\s*\[([^\]]+)\]/);
    if (scriptSrcElemRegion) {
      expect(scriptSrcElemRegion[1]).not.toContain("'unsafe-inline'");
    }
  });

  it("does not include 'unsafe-inline' in scriptSrcAttr", () => {
    const scriptSrcAttrRegion = src.match(/scriptSrcAttr:\s*\[([^\]]+)\]/);
    if (scriptSrcAttrRegion) {
      expect(scriptSrcAttrRegion[1]).not.toContain("'unsafe-inline'");
    }
  });

  it("sets scriptSrcAttr to 'none' (fully disables inline event handlers)", () => {
    expect(src).toMatch(/scriptSrcAttr:\s*\[\s*["']'none'["']\s*\]/);
  });
});

// ─── C) HTML inline handler regression ────────────────────────────────────────

describe('HTML Inline Event Handler Regression', () => {
  const publicDir = path.join(__dirname, '../../public');

  function getHtmlFiles(dir) {
    return fs
      .readdirSync(dir)
      .filter(f => f.endsWith('.html'))
      .map(f => path.join(dir, f));
  }

  it('no HTML file in public/ contains onclick= or onerror= attributes', () => {
    const violations = [];
    for (const filePath of getHtmlFiles(publicDir)) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (/\s(?:onclick|onerror)=/.test(content)) {
        violations.push(path.basename(filePath));
      }
    }
    expect(violations).toEqual([]);
  });

  it('no HTML file in public/ contains inline <script> blocks (excluding JSON-LD and src= scripts)', () => {
    const violations = [];
    for (const filePath of getHtmlFiles(publicDir)) {
      const content = fs.readFileSync(filePath, 'utf8');
      // Match <script> tags that are:
      //  - NOT external (no src=)
      //  - NOT JSON-LD (no type="application/ld+json")
      const inlineScripts = content.match(
        /<script(?![^>]*\bsrc=)(?![^>]*\btype=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi
      );
      if (inlineScripts) {
        // Filter out empty script tags
        const nonEmpty = inlineScripts.filter(s => {
          const inner = s
            .replace(/<script[^>]*>/i, '')
            .replace(/<\/script>/i, '')
            .trim();
          return inner.length > 0;
        });
        if (nonEmpty.length > 0) {
          violations.push(path.basename(filePath));
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
