'use strict';

/**
 * Focused tests for the mobile supplier-card redesign and package image
 * fallback (suppliers page).
 *
 * Covers:
 *  - formatPackagePrice(): GBP formatting of supplier-entered free-text prices
 *  - Package image fallback: approved generic placeholder, retry-loop guard,
 *    and retirement of the cardboard-box emoji
 *  - Carousel markup: position indicator, labelled controls, single-package
 *    suppliers rendering no carousel chrome
 *  - Description "Show more": accessible expanded state wiring
 *  - Mobile CSS: square package media, hidden PACKAGES label, 44px targets,
 *    reduced-motion handling
 *
 * Follows the repository's established pattern for frontend unit tests
 * (see tests/unit/admin-notif-panel-viewport.test.js): read the shipped
 * source, extract pure functions for direct execution, and assert on
 * structural markers for template/CSS behaviour.
 */

const fs = require('fs');
const path = require('path');

const JS_SRC = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/pages/suppliers-init.js'),
  'utf8'
);
const CSS_SRC = fs.readFileSync(
  path.join(__dirname, '../../public/assets/css/suppliers-page.css'),
  'utf8'
);

// ── Helper: extract a named top-level function ─────────────────────────────
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) {
    throw new Error(`function ${name} not found`);
  }
  let depth = 0;
  let i = src.indexOf('{', start);
  const bodyStart = i;
  do {
    if (src[i] === '{') {
      depth++;
    }
    if (src[i] === '}') {
      depth--;
    }
    i++;
  } while (depth > 0 && i < src.length);
  const header = src.slice(start, bodyStart);
  const body = src.slice(bodyStart, i);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${header}${body}`)();
}

describe('formatPackagePrice — GBP formatting of free-text prices', () => {
  const formatPackagePrice = extractFn(JS_SRC, 'formatPackagePrice');

  test('bare numeric strings gain a £ prefix', () => {
    expect(formatPackagePrice('300')).toBe('£300');
    expect(formatPackagePrice('999')).toBe('£999');
    expect(formatPackagePrice('2,500')).toBe('£2,500');
    expect(formatPackagePrice('2,500.50')).toBe('£2,500.50');
  });

  test('numeric with trailing plus gains a £ prefix', () => {
    expect(formatPackagePrice('650+')).toBe('£650+');
  });

  test('already-formatted prices are left exactly as entered', () => {
    expect(formatPackagePrice('£1,200')).toBe('£1,200');
    expect(formatPackagePrice('£45 pp')).toBe('£45 pp');
    expect(formatPackagePrice('From £150')).toBe('From £150');
  });

  test('non-numeric free text is left as entered', () => {
    expect(formatPackagePrice('POA')).toBe('POA');
    expect(formatPackagePrice('Contact us')).toBe('Contact us');
  });

  test('empty and nullish values return an empty string', () => {
    expect(formatPackagePrice('')).toBe('');
    expect(formatPackagePrice(null)).toBe('');
    expect(formatPackagePrice(undefined)).toBe('');
  });

  test('numbers are handled as well as strings', () => {
    expect(formatPackagePrice(300)).toBe('£300');
  });
});

describe('Package image fallback — approved placeholder', () => {
  test('template references the approved static placeholder asset', () => {
    expect(JS_SRC).toContain('/assets/images/package-placeholder.webp');
  });

  test('the placeholder assets exist in the repository', () => {
    const img = p => fs.existsSync(path.join(__dirname, '../../public/assets/images', p));
    expect(img('package-placeholder.png')).toBe(true);
    expect(img('package-placeholder.webp')).toBe(true);
  });

  test('the cardboard-box emoji is no longer rendered anywhere in the card template', () => {
    expect(JS_SRC).not.toContain('📦');
  });

  test('error fallback guards against an infinite retry loop', () => {
    // The delegated error handler must check-and-set a one-shot flag.
    expect(JS_SRC).toMatch(/!img\.dataset\.pf/);
    expect(JS_SRC).toMatch(/img\.dataset\.pf\s*=\s*'1'/);
  });

  test('placeholder is decorative (empty alt) while real images use the package title', () => {
    expect(JS_SRC).toMatch(/sp-pkg-mini-img--placeholder/);
    expect(JS_SRC).toMatch(/alt="\$\{escapeHtml\(pkg\.title\)\}"/);
    expect(JS_SRC).toMatch(/<img src="\$\{PKG_GENERIC_PLACEHOLDER\}" alt=""/);
  });

  test('package images lazy-load with async decoding', () => {
    expect(JS_SRC).toMatch(/class="sp-pkg-mini-img"[^>]*loading="lazy"[^>]*decoding="async"/);
  });
});

describe('Carousel markup and behaviour', () => {
  test('single-package suppliers render no carousel controls', () => {
    // Controls are conditional on total > 1
    expect(JS_SRC).toMatch(/total > 1\s*\?/);
    expect(JS_SRC).toContain('sp-pkg-carousel--single');
  });

  test('position indicator is rendered and updated', () => {
    expect(JS_SRC).toContain('data-pkg-position');
    expect(JS_SRC).toMatch(/positionEl\.textContent\s*=\s*`\$\{idx \+ 1\} of \$\{total\}`/);
  });

  test('controls carry supplier-specific accessible labels', () => {
    expect(JS_SRC).toMatch(/aria-label="View next package for \$\{escapeHtml\(supplier\.name\)\}"/);
    expect(JS_SRC).toMatch(
      /aria-label="View previous package for \$\{escapeHtml\(supplier\.name\)\}"/
    );
  });

  test('supplier-provided fields are escaped before templating', () => {
    expect(JS_SRC).toMatch(/escapeHtml\(pkg\.title\)/);
    expect(JS_SRC).toMatch(/escapeHtml\(pkg\.description\)/);
    expect(JS_SRC).toMatch(/escapeHtml\(displayPrice\)/);
  });

  test('Detailed View uses the existing package route', () => {
    expect(JS_SRC).toMatch(/\/package\/\$\{encodeURIComponent\(String\(packageIdentifier\)\)\}/);
    expect(JS_SRC).toContain('btn-pkg-detail');
  });
});

describe('Description "Show more" control', () => {
  test('toggle is rendered hidden and revealed only on overflow', () => {
    expect(JS_SRC).toMatch(/sp-desc-toggle" aria-expanded="false" hidden/);
    expect(JS_SRC).toMatch(/desc\.scrollHeight > desc\.clientHeight \+ 1/);
  });

  test('toggle flips accessible state and label', () => {
    expect(JS_SRC).toMatch(/toggle\.setAttribute\('aria-expanded', String\(expanded\)\)/);
    expect(JS_SRC).toMatch(/'Show less' : 'Show more'/);
  });
});

describe('Mobile card CSS', () => {
  // Isolate the appended redesign section for targeted assertions
  const redesign = CSS_SRC.slice(CSS_SRC.indexOf('MOBILE SUPPLIER CARD REDESIGN'));

  test('redesign section exists and is appended after legacy rules', () => {
    expect(redesign.length).toBeGreaterThan(0);
  });

  test('package media is square and cannot stretch', () => {
    expect(redesign).toMatch(/aspect-ratio:\s*1\s*\/\s*1/);
    expect(redesign).toMatch(/object-fit:\s*cover/);
  });

  test('PACKAGES label is removed from the mobile card', () => {
    expect(redesign).toMatch(/\.sp-pkg-label\s*\{\s*display:\s*none/);
  });

  test('primary touch targets meet 44px', () => {
    const hits = redesign.match(/min-height:\s*44px/g) || [];
    expect(hits.length).toBeGreaterThanOrEqual(3); // card actions, pkg actions, carousel controls
  });

  test('carousel transition respects prefers-reduced-motion', () => {
    expect(redesign).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  test('position indicator and arrow labels are hidden outside mobile widths', () => {
    expect(redesign).toMatch(/\.sp-pkg-position\s*\{[^}]*display:\s*none/);
    expect(redesign).toMatch(/\.sp-pkg-arrow-label\s*\{\s*display:\s*none/);
  });
});
