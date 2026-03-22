/**
 * Admin Registry Tests
 *
 * Validates the integrity of config/adminRegistry.js and ensures it stays
 * in sync with the middleware allowlist, the HTML files on disk, and the
 * serve-static.js adminPages array.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const SERVE_STATIC_FILE = path.resolve(__dirname, '../../scripts/serve-static.js');

// Load registry without triggering server dependencies
const {
  REGISTRY,
  getAdminPagesAllowlist,
  getNavItems,
  getLegacyRedirects,
} = require('../../config/adminRegistry');

// ── Registry structure tests ───────────────────────────────────────────────

describe('config/adminRegistry.js — structure', () => {
  it('exports a non-empty REGISTRY array', () => {
    expect(Array.isArray(REGISTRY)).toBe(true);
    expect(REGISTRY.length).toBeGreaterThan(0);
  });

  it('every registry entry has required fields', () => {
    REGISTRY.forEach(page => {
      expect(typeof page.route).toBe('string');
      expect(typeof page.htmlFile).toBe('string');
      expect(typeof page.label).toBe('string');
      expect(typeof page.category).toBe('string');
      expect(typeof page.inNav).toBe('boolean');
      // route must start with /admin
      expect(page.route).toMatch(/^\/admin/);
      // htmlFile must not have an extension
      expect(page.htmlFile).not.toMatch(/\./);
    });
  });

  it('all route values are unique', () => {
    const routes = REGISTRY.map(p => p.route);
    const unique = new Set(routes);
    expect(unique.size).toBe(routes.length);
  });

  it('all htmlFile values are unique', () => {
    const files = REGISTRY.map(p => p.htmlFile);
    const unique = new Set(files);
    expect(unique.size).toBe(files.length);
  });

  it('getNavItems() returns only inNav=true pages', () => {
    const navItems = getNavItems();
    navItems.forEach(item => {
      expect(item.inNav).toBe(true);
    });
    // Must include at least a few canonical pages
    const routes = navItems.map(i => i.route);
    expect(routes).toContain('/admin');
    expect(routes).toContain('/admin-users');
    expect(routes).toContain('/admin-exports');
  });

  it('getNavItems() does NOT include compat/redirect pages', () => {
    const navRoutes = getNavItems().map(i => i.route);
    expect(navRoutes).not.toContain('/admin-pexels');
    expect(navRoutes).not.toContain('/admin-content-dates');
  });

  it('getLegacyRedirects() returns pages with a redirect target', () => {
    const redirects = getLegacyRedirects();
    expect(redirects.length).toBeGreaterThan(0);
    redirects.forEach(r => {
      expect(typeof r.redirect).toBe('string');
      expect(r.redirect.length).toBeGreaterThan(0);
    });
    const routes = redirects.map(r => r.route);
    expect(routes).toContain('/admin-pexels');
    expect(routes).toContain('/admin-content-dates');
  });
});

// ── Allowlist generation tests ─────────────────────────────────────────────

describe('getAdminPagesAllowlist()', () => {
  const allowlist = getAdminPagesAllowlist();

  it('returns a non-empty array of strings', () => {
    expect(Array.isArray(allowlist)).toBe(true);
    expect(allowlist.length).toBeGreaterThan(0);
  });

  it('every entry starts with a forward slash', () => {
    allowlist.forEach(entry => {
      expect(entry).toMatch(/^\//);
    });
  });

  it('includes both clean URL and .html variant for every registry page', () => {
    REGISTRY.forEach(page => {
      expect(allowlist).toContain(page.route);
      expect(allowlist).toContain(`${page.route}.html`);
    });
  });

  it('includes /admin-exports and /admin-exports.html', () => {
    expect(allowlist).toContain('/admin-exports');
    expect(allowlist).toContain('/admin-exports.html');
  });
});

// ── HTML file sync tests ───────────────────────────────────────────────────

describe('Registry ↔ HTML files on disk', () => {
  const adminHtmlFiles = fs
    .readdirSync(PUBLIC_DIR)
    .filter(f => f.startsWith('admin') && f.endsWith('.html'))
    .map(f => f.replace(/\.html$/, ''));

  it('every admin HTML file on disk has a matching registry entry', () => {
    const registryFiles = REGISTRY.map(p => p.htmlFile);
    const missing = adminHtmlFiles.filter(f => !registryFiles.includes(f));
    expect(missing).toEqual([]);
  });

  it('every registry htmlFile has a corresponding file on disk', () => {
    const extra = REGISTRY.filter(
      p => !fs.existsSync(path.join(PUBLIC_DIR, `${p.htmlFile}.html`))
    ).map(p => p.htmlFile);
    expect(extra).toEqual([]);
  });
});

// ── serve-static.js sync test ──────────────────────────────────────────────

describe('serve-static.js adminPages array', () => {
  function parseServeStaticAdminPages() {
    const source = fs.readFileSync(SERVE_STATIC_FILE, 'utf8');
    const match = source.match(/const adminPages\s*=\s*\[([\s\S]*?)\];/);
    if (!match) {
      throw new Error('Could not locate adminPages array in scripts/serve-static.js');
    }
    return match[1]
      .split('\n')
      .map(line =>
        line
          .trim()
          .replace(/^['"]|['"],?$/g, '')
          .trim()
      )
      .filter(line => line.length > 0 && !line.startsWith('/'));
  }

  it('includes every non-compat registry htmlFile', () => {
    const servePages = parseServeStaticAdminPages();
    const nonCompatFiles = REGISTRY.filter(p => p.category !== 'compat').map(p => p.htmlFile);
    const missing = nonCompatFiles.filter(f => !servePages.includes(f));
    expect(missing).toEqual([]);
  });

  it('includes admin-exports', () => {
    const servePages = parseServeStaticAdminPages();
    expect(servePages).toContain('admin-exports');
  });
});

// ── Admin navbar — no deprecated links ────────────────────────────────────

describe('Admin HTML pages — no deprecated page links in navbar', () => {
  const adminHtmlFiles = fs
    .readdirSync(PUBLIC_DIR)
    .filter(f => f.startsWith('admin') && f.endsWith('.html'))
    .map(f => path.join(PUBLIC_DIR, f));

  adminHtmlFiles.forEach(filePath => {
    const basename = path.basename(filePath);
    it(`${basename} should not contain links to deprecated admin pages`, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      const deprecated = [
        'href="/admin-pexels"',
        'href="/admin-pexels.html"',
        'href="/admin-content-dates"',
        'href="/admin-content-dates.html"',
      ];
      deprecated.forEach(link => {
        expect(content).not.toContain(link);
      });
    });
  });
});

// ── admin-navbar.js NAV_ITEMS sync ────────────────────────────────────────

describe('admin-navbar.js NAV_ITEMS', () => {
  const navbarSrc = fs.readFileSync(
    path.resolve(__dirname, '../../public/assets/js/admin-navbar.js'),
    'utf8'
  );

  it('contains NAV_ITEMS definition', () => {
    expect(navbarSrc).toContain('NAV_ITEMS');
  });

  it('includes /admin-exports in NAV_ITEMS', () => {
    expect(navbarSrc).toContain("'/admin-exports'");
  });

  it('does NOT include /admin-pexels in NAV_ITEMS', () => {
    // admin-pexels must not appear as a nav link (only as a redirect)
    // The source may reference it in comments/non-nav context — check the NAV_ITEMS block specifically
    const navItemsMatch = navbarSrc.match(/(?:var|const) NAV_ITEMS\s*=\s*\[([\s\S]*?)\];/);
    expect(navItemsMatch).not.toBeNull();
    if (navItemsMatch) {
      expect(navItemsMatch[1]).not.toContain('/admin-pexels');
      expect(navItemsMatch[1]).not.toContain('/admin-content-dates');
    }
  });

  it('includes renderNavMount function', () => {
    expect(navbarSrc).toContain('renderNavMount');
  });
});
