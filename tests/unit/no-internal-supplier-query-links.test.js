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

// Matches a literal href/onclick-navigation built directly from the legacy
// query form: href="/supplier?id=..., href=`/supplier?id=..., location.href=...`/supplier?id=
const LEGACY_SUPPLIER_HREF = /href=["'`]\/supplier\?id=|location\.href\s*=\s*`\/supplier\?id=/;
const LEGACY_CATEGORY_HREF = /href=["'`]\/category\?slug=/;

describe('no internally-rendered directory link uses the legacy query form', () => {
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
});
