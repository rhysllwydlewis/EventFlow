'use strict';

/**
 * SEO-003 regression guard: internal directory/card/link renderers must
 * never bake a `/supplier?id=` (or `/category?slug=`) href into markup they
 * generate — those forms still work (the server 301-redirects them to the
 * clean canonical URL), but Search Console flagged /suppliers as internally
 * *linking* to the query form, which is exactly what these files used to do.
 *
 * This is a source-level scan rather than a full render, matching the
 * existing pattern in tests/unit/suppliers-mobile-card.test.js: read the
 * shipped file and assert on the literal template strings, so the guard
 * catches a regression the moment someone reintroduces the old pattern
 * without needing a browser/jsdom render pipeline.
 */

const fs = require('fs');
const path = require('path');

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

function walkJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkJs(full) : entry.name.endsWith('.js') ? [full] : [];
  });
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// Matches a literal href/onclick-navigation built directly from the legacy
// query form: href="/supplier?id=..., href=`/supplier?id=..., location.href=...`/supplier?id=
const LEGACY_SUPPLIER_HREF = /href=["'`]\/supplier\?id=|location\.href\s*=\s*`\/supplier\?id=/;
const LEGACY_CATEGORY_HREF = /href=["'`]\/category\?slug=/;

describe('no internally-rendered directory link uses the legacy query form', () => {
  it('no shipped public script or public-response route generates a legacy supplier query URL', () => {
    const root = path.join(__dirname, '../..');
    const files = [
      ...walkJs(path.join(root, 'public')),
      path.join(root, 'routes/community-discovery.js'),
      path.join(root, 'routes/review-requests.js'),
    ];
    const offenders = files
      .filter(file => stripComments(fs.readFileSync(file, 'utf8')).includes('/supplier?id='))
      .map(file => path.relative(root, file));
    expect(offenders).toEqual([]);
  });

  const supplierLinkFiles = [
    'public/assets/js/pages/suppliers-init.js',
    'public/assets/js/pages/package-init.js',
    'public/assets/js/components/package-list.js',
  ];

  it.each(supplierLinkFiles)('%s does not hard-code a /supplier?id= href', relativePath => {
    const src = readSource(relativePath);
    expect(LEGACY_SUPPLIER_HREF.test(src)).toBe(false);
  });

  const categoryLinkFiles = [
    'public/assets/js/components/category-grid.js',
    'public/assets/js/pages/package-init.js',
    'public/index.html',
    'public/home-v2.html',
  ];

  it.each(categoryLinkFiles)('%s does not hard-code a /category?slug= href', relativePath => {
    const src = readSource(relativePath);
    expect(LEGACY_CATEGORY_HREF.test(src)).toBe(false);
  });

  it('the homepage hero collage links directly at /suppliers?category=<Name>', () => {
    for (const file of ['public/index.html', 'public/home-v2.html']) {
      const src = readSource(file);
      for (const category of ['Venues', 'Catering', 'Entertainment', 'Photography']) {
        expect(src).toContain(`href="/suppliers?category=${category}"`);
      }
    }
  });

  it('supplier-profile.js reuses the page canonical link instead of rebuilding a query URL', () => {
    const src = readSource('public/assets/js/supplier-profile.js');
    expect(src).toContain('link[rel="canonical"]');
  });

  // app.js's supplierCard() (used by both initResults() and initPlan())
  // checks `window.EventFlowSupplierLink` and falls back to the legacy
  // `/supplier?id=${s.id}` form with no error/warning if it's missing. Every
  // page whose <meta name="ef-page"> dispatches app.js into a supplierCard()
  // code path must also load supplier-link.js — plan.html shipped without
  // it (silently regressing to the legacy link) until this was caught here.
  const pagesRenderingSupplierCardsViaAppJs = ['public/plan.html', 'public/suppliers.html'];

  it.each(pagesRenderingSupplierCardsViaAppJs)(
    '%s loads supplier-link.js alongside app.js',
    relativePath => {
      const src = readSource(relativePath);
      expect(src).toMatch(/src=["']\/assets\/js\/utils\/supplier-link\.js/);
    }
  );
});
