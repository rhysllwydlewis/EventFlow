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
  let navbarStyles;

  beforeAll(() => {
    brandStyles = readAsset('public/assets/css/eventflow-brand.css');
    navbarStyles = readAsset('public/assets/css/navbar.css');
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
    // Three steps down: desktop, tablet-and-below, and small phones.
    expect(brandStyles.match(/\.ef-brand-text \{/g).length).toBeGreaterThanOrEqual(3);
  });

  it('wins against the page stylesheets that hide the brand text on mobile', () => {
    // navbar.css, customer-dashboard-polish.css and home-v3-mobile.css all set
    // `display: none` on `.ef-brand-text` below their mobile breakpoints. They
    // were written when the EF tile carried the lockup there. Two of them beat
    // this file on specificity, and on pages that link this file themselves the
    // third beats it on order — so without `!important` the header renders no
    // brand at all on a phone. That is the bug this pins.
    expect(brandStyles).toMatch(/\.ef-brand-text \{\s*display: block !important;/);
  });

  describe('header fit', () => {
    it('hands the navigation to the hamburger below 1024px', () => {
      // Eight nav links plus the auth buttons do not fit beside a wordmark
      // below 1024px — measured signed-out, the actions ran up to 79px past the
      // right edge of the header and "Sign up" was partly off screen.
      const start = navbarStyles.indexOf('@media (max-width: 1023px)');
      expect(start).toBeGreaterThan(-1);
      const block = navbarStyles.slice(start, navbarStyles.indexOf('\n}\n', start));
      expect(block).toMatch(/\.ef-nav-desktop \{\s*display: none;/);
      expect(block).toMatch(/\.ef-mobile-toggle \{\s*display: flex;/);
    });

    it('declares that rule after the one that shows the nav from 768px', () => {
      // Same specificity, so source order decides. Moving it above the
      // `min-width: 768px` block would silently restore the overflow.
      expect(navbarStyles.indexOf('@media (min-width: 768px) {')).toBeLessThan(
        navbarStyles.indexOf('@media (max-width: 1023px)')
      );
    });

    describe('the menu that replaces the nav', () => {
      /** @returns {string} The mobile-menu visibility block. */
      const menuBlock = () => {
        const start = navbarStyles.indexOf('#ef-mobile-menu.open {');
        expect(start).toBeGreaterThan(-1);
        return navbarStyles.slice(start, navbarStyles.indexOf('\n  }', start));
      };

      it('gives the menu a real height across the whole band it can open in', () => {
        // `.ef-header` carries `backdrop-filter`, which makes it the containing
        // block for its `position: fixed` children. The menu's `bottom: 0`
        // therefore resolves against the header, not the viewport — without an
        // explicit height it computed to 8px and the menu opened as a sliver
        // with its links spilling out over a dimmed page. The explicit height
        // used to stop at 768px, which is why only phones looked right.
        const openRule = navbarStyles.indexOf('#ef-mobile-menu.open {');
        const guard = navbarStyles.lastIndexOf('@media (', openRule);
        expect(navbarStyles.slice(guard, openRule)).toContain('@media (max-width: 1099px)');
        expect(menuBlock()).toMatch(/height: calc\(100vh - var\(--ef-menu-offset\)\) !important/);
      });

      it('lifts the header above the backdrop while the menu is open', () => {
        // Same stacking context: the menu paints at the header's level whatever
        // z-index it carries itself. From 768px the header sits at 1000, below
        // the 1998 backdrop, so the dimming covered the open menu completely.
        expect(navbarStyles).toMatch(
          /body\.ef-menu-open \.ef-header \{\s*z-index: var\(--ef-z-header\);/
        );
      });

      it('starts the menu below the taller header from 768px', () => {
        expect(navbarStyles).toMatch(
          /@media \(min-width: 768px\) and \(max-width: 1099px\) \{\s*#ef-mobile-menu\.open \{\s*--ef-menu-offset: 72px;/
        );
      });
    });

    it('holds the wordmark at its smaller size until 1100px', () => {
      // 1024–1099 is the tightest band that does show the full nav; the full
      // 168px wordmark pushed the actions past the header edge there.
      expect(brandStyles).toContain('@media (max-width: 1099px)');
      // The old 900px and 840px split steps are gone — one step covers it.
      expect(brandStyles).not.toContain('min-width: 900px');
      expect(brandStyles).not.toContain('min-width: 840px');
    });
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
