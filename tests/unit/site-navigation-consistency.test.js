/**
 * Every public page ships its own copy of the site header, so the main
 * navigation exists 87 times over and nothing kept the copies in step.
 *
 * They had drifted twice over. The desktop navigation was missing /pricing on
 * fourteen pages — the eleven generated community pages plus three hand-made
 * ones — so those pages showed six links where the rest of the site showed
 * seven. The mobile navigation was worse: eight distinct variants, with Guides
 * and Pricing swapped on twenty-four pages, /for-suppliers and /faq missing on
 * others, and the log-out control absent from ten. None of it was broken, so
 * none of it was noticed.
 *
 * public/guides.html is the canonical source (see scripts/lib/article-chrome.mjs),
 * and both generators now read it. This test holds the same line for the pages
 * no generator owns, so adding a link to guides.html and forgetting the rest of
 * the site fails here instead of shipping.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'public');
const ARTICLES = path.join(PUBLIC, 'articles');

const DESKTOP_NAV = /<nav[^>]*class="ef-nav-desktop"[\s\S]*?<\/nav>/;
const MOBILE_NAV = /<nav[^>]*class="ef-mobile-nav"[\s\S]*?<\/nav>/;

/**
 * Pull the navigation links out of one <nav> block.
 *
 * Anchors carrying an id are the log-in / dashboard / log-out controls: they are
 * per-page state rather than navigation, and pages legitimately differ on
 * whether they render them, so they are excluded here and asserted separately.
 * @param {string} html The page source.
 * @param {RegExp} navPattern Which nav to read.
 * @param {string} linkClass The link class to match.
 * @returns {Array<{href: string, label: string}>|null} The links, or null when the nav is absent.
 */
function navLinks(html, navPattern, linkClass) {
  const nav = html.match(navPattern);
  if (!nav) {
    return null;
  }
  const pattern = new RegExp(`<a\\s([^>]*class="${linkClass}[^"]*"[^>]*)>([^<]*)</a>`, 'g');
  return [...nav[0].matchAll(pattern)]
    .filter(match => !/\sid="/.test(match[1]))
    .map(match => ({
      href: (match[1].match(/href="([^"]+)"/) || [])[1],
      label: match[2].trim(),
    }))
    .filter(link => link.href && link.label);
}

/**
 * Every non-admin page that renders the site header.
 *
 * Admin pages use a different chrome entirely (admin-navbar.js), so they are
 * out of scope; they are excluded by name rather than by absence of the header
 * so that an admin page growing an ef-header does not silently opt itself in.
 * @returns {Array<{name: string, html: string}>} The pages.
 */
function sitePages() {
  const pages = [];
  for (const dir of [PUBLIC, ARTICLES]) {
    for (const entry of fs.readdirSync(dir).sort()) {
      if (!entry.endsWith('.html') || entry.startsWith('admin')) {
        continue;
      }
      const file = path.join(dir, entry);
      const html = fs.readFileSync(file, 'utf8');
      if (/class="[^"]*\bef-header\b/.test(html)) {
        pages.push({ name: path.relative(PUBLIC, file), html });
      }
    }
  }
  return pages;
}

const guides = fs.readFileSync(path.join(PUBLIC, 'guides.html'), 'utf8');
const canonicalDesktop = navLinks(guides, DESKTOP_NAV, 'ef-nav-link');
const canonicalMobile = navLinks(guides, MOBILE_NAV, 'ef-mobile-link');
const pages = sitePages();

describe('site navigation is the same on every non-admin page', () => {
  test('guides.html, the canonical source, has a navigation worth copying', () => {
    // Guards the rest of the file: a parse that silently returned [] would make
    // every assertion below vacuously true.
    expect(canonicalDesktop.length).toBeGreaterThanOrEqual(7);
    expect(canonicalMobile.length).toBeGreaterThanOrEqual(9);
    expect(canonicalDesktop.map(link => link.href)).toContain('/pricing');
  });

  test('enough pages are in scope for this to mean anything', () => {
    expect(pages.length).toBeGreaterThanOrEqual(80);
  });

  test.each(pages.map(page => [page.name, page]))('%s: desktop navigation', (_name, page) => {
    expect(navLinks(page.html, DESKTOP_NAV, 'ef-nav-link')).toEqual(canonicalDesktop);
  });

  test.each(pages.map(page => [page.name, page]))('%s: mobile navigation', (_name, page) => {
    expect(navLinks(page.html, MOBILE_NAV, 'ef-mobile-link')).toEqual(canonicalMobile);
  });

  test.each(pages.map(page => [page.name, page]))(
    '%s: renders each mobile auth control exactly once',
    (_name, page) => {
      // support.html carried a second #ef-mobile-auth outside the nav. Duplicate
      // ids mean getElementById picks one and the other never updates on login.
      for (const id of ['ef-mobile-auth', 'ef-mobile-dashboard', 'ef-mobile-logout']) {
        expect((page.html.match(new RegExp(`id="${id}"`, 'g')) || []).length).toBe(1);
      }
    }
  );
});
