'use strict';

/**
 * The public brand lockup.
 *
 * `public/assets/css/eventflow-brand.css` swaps the generated navbar mark and
 * footer text for the supplied SVG artwork. Two things about that treatment
 * are easy to undo by accident, so they are pinned here.
 */

const fs = require('fs');
const path = require('path');

const readAsset = relativePath =>
  fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');

describe('brand lockup', () => {
  let brandStyles;

  beforeAll(() => {
    brandStyles = readAsset('public/assets/css/eventflow-brand.css');
  });

  it('ships both brand assets as separate files', () => {
    // Compositing a single lockup image would stop either surface using the
    // piece it needs on its own.
    expect(
      fs.existsSync(path.resolve(__dirname, '../../public/assets/brand/eventflow-mark.svg'))
    ).toBe(true);
    expect(
      fs.existsSync(path.resolve(__dirname, '../../public/assets/brand/eventflow-wordmark.svg'))
    ).toBe(true);
  });

  it('shows the wordmark alone in the header, with no EF tile', () => {
    // The tile sat immediately beside a wordmark that already reads
    // "EventFlow", and put a white plate on a white navbar.
    expect(brandStyles).toMatch(/\.ef-brand \.ef-logo \{\s*display: none !important;/);
  });

  it('keeps the header wordmark visible at every width', () => {
    // It used to be clipped to 1px below 900px because the mark carried the
    // lockup there. With the mark gone, hiding it would leave no brand at all
    // on a phone.
    expect(brandStyles).not.toMatch(/\.ef-brand-text \{[^}]*clip-path: inset\(50%\)/);
    expect(brandStyles).toContain('@media (max-width: 400px)');
    // Three steps down: desktop, sub-900 and small phones.
    expect(brandStyles.match(/\.ef-brand-text \{/g).length).toBeGreaterThanOrEqual(3);
  });

  describe('footer wordmark', () => {
    /**
     * Pull one rule body out of the stylesheet.
     * @param {string} selector Exact selector text.
     * @returns {string} The rule body.
     */
    const ruleFor = selector => {
      const start = brandStyles.indexOf(`${selector} {`);
      expect(start).toBeGreaterThan(-1);
      return brandStyles.slice(start, brandStyles.indexOf('}', start));
    };

    it('sits directly on the dark premium footer rather than a white plate', () => {
      const rule = ruleFor('.ef-footer-premium .ef-brand-logo');
      expect(rule).toContain('background: transparent');
      expect(rule).not.toMatch(/background:\s*#ffffff/);
    });

    it('inverts the teal artwork to white on the dark footer', () => {
      const rule = ruleFor('.ef-footer-premium .ef-brand-logo-name');
      expect(rule).toContain('filter: brightness(0) invert(1)');
    });

    it('does NOT invert on the legacy footer, which is white', () => {
      // Inverting here would render a white wordmark on a white footer — the
      // logo would simply disappear. The two footers differ in ground colour,
      // so they cannot share one treatment.
      const rule = ruleFor('.footer .ef-footer-content > div:first-child > strong');
      expect(rule).not.toContain('invert');
      expect(rule).toContain('background: transparent');
    });
  });
});
