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

  test('REGRESSION: package actions are a direct child of .sp-pkg-mini, not nested in the body', () => {
    // grid-template-areas can only place direct grid children. When the
    // actions row was nested inside .sp-pkg-mini-body it was confined to
    // the narrow text column and the two buttons overlapped (reported on
    // device at ~375px). This pins the flattened structure.
    const mini = JS_SRC.slice(
      JS_SRC.indexOf('<div class="sp-pkg-mini">'),
      JS_SRC.indexOf('</div>`;', JS_SRC.indexOf('<div class="sp-pkg-mini">'))
    );
    const bodyStart = mini.indexOf('sp-pkg-mini-body');
    const bodyEnd = mini.indexOf('</div>', bodyStart);
    const actionsStart = mini.indexOf('sp-pkg-mini-actions');
    expect(actionsStart).toBeGreaterThan(bodyEnd);
  });
});

describe('Description "Show more" control — single ownership', () => {
  const POLISH_CSS = fs.readFileSync(
    path.join(__dirname, '../../public/assets/css/suppliers-mobile-polish.css'),
    'utf8'
  );
  const MOBILE_JS = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/pages/suppliers-mobile.js'),
    'utf8'
  );

  test('REGRESSION: the card template renders NO toggle of its own', () => {
    // suppliers-mobile.js injects sp-description-toggle for every card; a
    // second template-rendered toggle shipped once and produced duplicate
    // "Show more" links in production. Single ownership is pinned here.
    expect(JS_SRC).not.toContain('sp-desc-toggle');
    expect(JS_SRC).not.toContain('initDescriptionToggles');
  });

  test('the polish layer owns clamp + toggle', () => {
    expect(MOBILE_JS).toContain('sp-description-toggle');
    expect(POLISH_CSS).toMatch(/\.sp-description-toggle/);
    expect(POLISH_CSS).toMatch(/-webkit-line-clamp:\s*2/);
  });
});

describe('Polish-layer reconciliation (parallel-merge conflicts)', () => {
  const POLISH_CSS = fs.readFileSync(
    path.join(__dirname, '../../public/assets/css/suppliers-mobile-polish.css'),
    'utf8'
  );

  test('REGRESSION: mobile package media is square (approved mock), not the pre-redesign fixed banner', () => {
    const mobile = POLISH_CSS.slice(POLISH_CSS.indexOf('@media (max-width: 767px)'));
    expect(mobile).toMatch(/\.sp-pkg-mini-thumb\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/);
    expect(mobile).toMatch(/\.sp-pkg-mini-thumb\s*\{[^}]*height:\s*auto !important/);
  });

  test('REGRESSION: the desktop glyph-arrow offset is scoped to >=768px', () => {
    // Unscoped, this margin-top calc pushed the 44px labelled mobile
    // controls ~45px below the position pill (reported in production).
    const idx = POLISH_CSS.indexOf(
      '--sp-active-media-height, var(--sp-polish-thumb-height)) - 22px'
    );
    const before = POLISH_CSS.slice(0, idx);
    const lastMedia = before.lastIndexOf('@media');
    expect(POLISH_CSS.slice(lastMedia, idx)).toContain('min-width: 768px');
  });

  test('mobile carousel controls share one centred row', () => {
    const mobile = POLISH_CSS.slice(POLISH_CSS.indexOf('@media (max-width: 767px)'));
    expect(mobile).toMatch(/\.sp-pkg-arrow\s*\{[^}]*align-self:\s*center !important/);
    expect(mobile).toMatch(/\.sp-pkg-arrow\s*\{[^}]*margin-top:\s*0 !important/);
  });

  test('main action buttons meet the 44px spec (not the pre-redesign 36px)', () => {
    expect(POLISH_CSS).toMatch(/\.sp-card-actions \.sp-btn\s*\{[^}]*min-height:\s*44px !important/);
    expect(POLISH_CSS).not.toMatch(/min-height:\s*36px !important/);
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

  test('REGRESSION: action rows use grid so the global mobile width:100% !important button rule is capped at track size', () => {
    // styles.css forces width:100% !important on buttons at mobile
    // widths; in a flex row that blows every button out to container
    // width (overflowing invisibly under the card's overflow:hidden).
    // Grid tracks cap it. Pin both action rows to grid.
    const actions = redesign.slice(redesign.indexOf('Row 4: main actions'));
    expect(actions).toMatch(/\.sp-card-actions\s*\{[^}]*display:\s*grid !important/);
    expect(redesign).toMatch(/\.sp-pkg-mini-actions\s*\{[^}]*display:\s*grid/);
  });

  test('position indicator and arrow labels are hidden outside mobile widths', () => {
    expect(redesign).toMatch(/\.sp-pkg-position\s*\{[^}]*display:\s*none/);
    expect(redesign).toMatch(/\.sp-pkg-arrow-label\s*\{\s*display:\s*none/);
  });
});
