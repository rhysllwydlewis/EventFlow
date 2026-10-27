'use strict';

/**
 * /suppliers layout shift (CLS).
 *
 * The results area first holds a short loading skeleton, then the real cards, which are far
 * taller. When the map and SEO sections below sat inside the first screen during that time, they
 * were pushed off it as the cards arrived and Lighthouse recorded a large layout shift - or not,
 * depending on whether they had been painted yet, which made the performance check flip between
 * passing and failing with no code change. A min-height on the loading skeleton keeps them
 * below the first screen. These tests pin that rule to the markup it has to match.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const css = read('public/assets/css/suppliers-page.css');
const html = read('public/suppliers.html');
const script = read('public/assets/js/pages/suppliers-init.js');

describe('suppliers results loading state', () => {
  it('holds the loading skeleton at least one screen tall', () => {
    const rule = css.match(
      /#results:has\(> #initial-skeleton\),\s*#results:has\(> \.sp-card\[aria-hidden='true'\]\)\s*\{([^}]*)\}/
    );
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/min-height:\s*100vh;/);
  });

  it('matches the skeleton the page HTML ships (a direct child of #results)', () => {
    const results = html.match(/<div id="results"[^>]*>\s*<div[^>]*id="initial-skeleton"/);
    expect(results).not.toBeNull();
  });

  it('matches the skeleton the script builds (aria-hidden sp-card children of #results)', () => {
    const skeleton = script.match(/function createSkeletonCards[\s\S]*?\n}\n/);
    expect(skeleton).not.toBeNull();
    expect(skeleton[0]).toContain('<div class="sp-card" aria-hidden="true"');
    expect(script).toMatch(/resultsContainer\.innerHTML = createSkeletonCards\(\)/);
  });

  it('does not match real supplier cards, so no blank space is added after loading', () => {
    const card = script.match(/<article class="sp-card[^>]*>/);
    expect(card).not.toBeNull();
    expect(card[0]).not.toMatch(/aria-hidden/);
  });

  it.each(['suppliers.html', 'supplier-card-showcase.html'])(
    '%s loads the stylesheet with the bumped version so cached copies are replaced',
    page => {
      expect(read(`public/${page}`)).toContain('/assets/css/suppliers-page.css?v=18.5.9');
    }
  );
});
