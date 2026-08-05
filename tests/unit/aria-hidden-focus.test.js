/**
 * Guards for accessibility defects found by sweeping every public page with
 * axe-core rather than only the pages a change touched.
 *
 * All four pre-date the branch that added this file. They are asserted here as
 * source-level contracts because the visual/a11y suite only covers five
 * baseline pages, so a regression on `/suppliers` or the shared bottom nav
 * would otherwise go unnoticed until someone ran a sweep again.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

/**
 * Read a file from the repository root.
 * @param {string} relative Repo-relative path.
 * @returns {string} File contents.
 */
function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('aria-hidden containers do not trap keyboard focus', () => {
  // `aria-hidden="true"` hides a subtree from assistive technology but leaves
  // its links, buttons and iframes in the tab order. A keyboard user can then
  // focus something a screen reader insists is not there. `inert` is the fix:
  // it removes the subtree from the tab order as well.

  it.each([
    ['public/index.html', 'hero-collage'],
    ['public/auth.html', 'auth-split-left'],
    ['public/suppliers.html', 'sp-map-section'],
  ])('%s: %s is inert while aria-hidden', (file, marker) => {
    const html = read(file);
    const line = html.split('\n').find(l => l.includes(marker) && l.includes('aria-hidden="true"'));
    expect(line).toBeDefined();
    expect(line).toMatch(/\binert\b/);
  });

  it('the suppliers map keeps inert in step with aria-hidden when toggled', () => {
    // The section is opened and closed at runtime, so a static attribute alone
    // would leave it inert once it had been opened.
    const js = read('public/assets/js/pages/suppliers-map-init.js');
    expect(js).toContain("section.setAttribute('aria-hidden', isOpen ? 'false' : 'true')");
    expect(js).toContain('section.inert = !isOpen');
  });
});

describe('the suppliers search field declares a role that allows its ARIA', () => {
  it('is a combobox, so aria-expanded is valid', () => {
    // axe flagged this as critical: `aria-expanded` is not allowed on a plain
    // searchbox. The field always behaved as a combobox — it has
    // aria-autocomplete and a popup — so the role was the missing part.
    const html = read('public/suppliers.html');
    const line = html.split('\n').find(l => l.includes('id="filterQuery"'));
    expect(line).toBeDefined();
    expect(line).toContain('role="combobox"');
    expect(line).toContain('aria-expanded=');
    expect(line).toContain('aria-haspopup="listbox"');
  });
});

describe('the bottom navigation label meets AA on a tinted bar', () => {
  /**
   * Relative luminance of a hex colour, per WCAG 2.1.
   * @param {string} hex Colour as #rrggbb.
   * @returns {number} Relative luminance.
   */
  function luminance(hex) {
    const channels = [1, 3, 5]
      .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  /**
   * Contrast ratio between two hex colours.
   * @param {string} a First colour.
   * @param {string} b Second colour.
   * @returns {number} Ratio between 1 and 21.
   */
  function ratio(a, b) {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  it('sets its own colour rather than inheriting the shared grey', () => {
    // The bar is translucent, so on a tinted page the label sits on the page
    // colour rather than white. --ef-text-gray (#6b7280) measured 3.70:1 there.
    const css = read('public/assets/css/navbar.css');
    const block = css.slice(css.indexOf('\n.ef-bottom-label {'));
    expect(block.slice(0, block.indexOf('}'))).toContain('color: #4b5563');
  });

  it('passes AA on both the tinted bar and white', () => {
    expect(ratio('#4b5563', '#cee6e3')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#4b5563', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    // The colour it replaced did not, which is why this guard exists.
    expect(ratio('#6b7280', '#cee6e3')).toBeLessThan(4.5);
  });
});
