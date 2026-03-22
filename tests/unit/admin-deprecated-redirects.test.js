/**
 * Admin Deprecated Redirect Tests
 *
 * Asserts that the server.js and serve-static.js source files contain the
 * expected redirect rules for deprecated admin pages.  These are static source
 * checks — no HTTP server is started — so they run fast and require no network.
 *
 * The canonical redirect targets (as of PR #750 post-merge hardening):
 *   /admin-pexels        → /admin-media          (302)
 *   /admin-pexels.html   → /admin-media          (302, single hop)
 *   /admin-content-dates → /admin-content?tab=legalDates  (302)
 *   /admin-content-dates.html → same             (302, single hop)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SERVER_JS = path.resolve(__dirname, '../../server.js');
const SERVE_STATIC_JS = path.resolve(__dirname, '../../scripts/serve-static.js');

let serverSrc;
let serveStaticSrc;

beforeAll(() => {
  serverSrc = fs.readFileSync(SERVER_JS, 'utf8');
  serveStaticSrc = fs.readFileSync(SERVE_STATIC_JS, 'utf8');
});

// ─── server.js redirect assertions ───────────────────────────────────────────

describe('server.js — deprecated admin page redirects', () => {
  it('defines a redirect for /admin-pexels to /admin-media', () => {
    expect(serverSrc).toMatch(/admin-pexels/);
    expect(serverSrc).toMatch(/admin-media/);
    // The redirect for admin-pexels must point to /admin-media, not serve the file
    const pexelsBlock = serverSrc.match(
      /\/admin-pexels[\s\S]{0,400}?admin-media/
    );
    expect(pexelsBlock).not.toBeNull();
  });

  it('handles /admin-pexels.html as a single-hop redirect (not via the generic .html handler)', () => {
    // The deprecated handlers are registered BEFORE the generic admin .html redirect,
    // so /admin-pexels.html should redirect directly to /admin-media.
    // Verify both patterns appear and deprecated handlers precede the generic one.
    const pexelsHtmlIdx = serverSrc.indexOf("'/admin-pexels.html'");
    // The generic handler uses a regex literal: /^\/admin(-[\w]+)*\.html$/
    const genericHtmlIdx = serverSrc.indexOf('admin(-[\\w]+)*\\.html');
    // Both must be present; deprecated must come first
    expect(pexelsHtmlIdx).toBeGreaterThan(-1);
    expect(genericHtmlIdx).toBeGreaterThan(pexelsHtmlIdx);
  });

  it('defines a redirect for /admin-content-dates to /admin-content with legalDates tab', () => {
    expect(serverSrc).toMatch(/admin-content-dates/);
    const contentDatesBlock = serverSrc.match(
      /\/admin-content-dates[\s\S]{0,400}?legalDates/
    );
    expect(contentDatesBlock).not.toBeNull();
  });

  it('preserves query strings in admin-pexels redirect', () => {
    // The redirect logic must extract and forward the query string
    const pexelsSection = (() => {
      const start = serverSrc.indexOf("'/admin-pexels'");
      return serverSrc.slice(start, start + 600);
    })();
    expect(pexelsSection).toMatch(/qs/);
    expect(pexelsSection).toMatch(/admin-media/);
  });

  it('preserves query strings in admin-content-dates redirect', () => {
    const datesSection = (() => {
      const start = serverSrc.indexOf("'/admin-content-dates'");
      return serverSrc.slice(start, start + 600);
    })();
    expect(datesSection).toMatch(/qs/);
    expect(datesSection).toMatch(/legalDates/);
  });

  it('uses 302 (temporary) status for deprecated redirects', () => {
    // Deprecated redirects should be 302, not 301, so they can be updated later
    const pexelsIdx = serverSrc.indexOf("'/admin-pexels'");
    const pexelsSnippet = serverSrc.slice(pexelsIdx, pexelsIdx + 400);
    expect(pexelsSnippet).toMatch(/302/);

    const datesIdx = serverSrc.indexOf("'/admin-content-dates'");
    const datesSnippet = serverSrc.slice(datesIdx, datesIdx + 600);
    expect(datesSnippet).toMatch(/302/);
  });
});

// ─── serve-static.js redirect assertions ────────────────────────────────────

describe('serve-static.js — deprecated admin page redirects (static-mode parity)', () => {
  it('defines a redirect for /admin-pexels to /admin-media', () => {
    expect(serveStaticSrc).toMatch(/admin-pexels/);
    const pexelsBlock = serveStaticSrc.match(
      /\/admin-pexels[\s\S]{0,400}?admin-media/
    );
    expect(pexelsBlock).not.toBeNull();
  });

  it('defines a redirect for /admin-content-dates to /admin-content with legalDates tab', () => {
    const datesBlock = serveStaticSrc.match(
      /\/admin-content-dates[\s\S]{0,400}?legalDates/
    );
    expect(datesBlock).not.toBeNull();
  });

  it('deprecated redirect routes appear before the adminPages serve loop', () => {
    // Ensure redirects take precedence over the generic serve handler
    const pexelsRedirectIdx = serveStaticSrc.indexOf("'/admin-pexels'");
    const adminPagesLoopIdx = serveStaticSrc.indexOf('adminPages.forEach');
    expect(pexelsRedirectIdx).toBeGreaterThan(-1);
    expect(adminPagesLoopIdx).toBeGreaterThan(pexelsRedirectIdx);
  });

  it('uses 302 (temporary) status for deprecated redirects', () => {
    const pexelsIdx = serveStaticSrc.indexOf("'/admin-pexels'");
    const snippet = serveStaticSrc.slice(pexelsIdx, pexelsIdx + 400);
    expect(snippet).toMatch(/302/);
  });
});

// ─── Admin navbar — no deprecated links ──────────────────────────────────────

describe('Admin navbar — no deprecated page links', () => {
  const adminHtmlFiles = fs
    .readdirSync(path.resolve(__dirname, '../../public'))
    .filter(f => f.startsWith('admin') && f.endsWith('.html'))
    .map(f => path.resolve(__dirname, '../../public', f));

  adminHtmlFiles.forEach(filePath => {
    const basename = path.basename(filePath);
    it(`${basename} navbar should not link to /admin-pexels or /admin-content-dates`, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      // Grab the navbar region (between admin-navbar-nav open/close), be lenient
      // and just check the whole file for href links to deprecated pages.
      const deprecatedLinks = [
        'href="/admin-pexels"',
        'href="/admin-pexels.html"',
        'href="/admin-content-dates"',
        'href="/admin-content-dates.html"',
      ];
      deprecatedLinks.forEach(link => {
        expect(content).not.toContain(link);
      });
    });
  });
});
