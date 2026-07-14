'use strict';

/**
 * Guards the class of bug that shipped silently for four months:
 * components inject a <style> element whose CSS has an unclosed rule, e.g.
 *
 *     .timeline-event {
 *
 *     .timeline-event::before {
 *
 * The CSS parser then discards everything that follows, so large parts of
 * a component render with browser-default styling (the timeline's edit and
 * delete controls appeared as full-width grey slabs with black borders).
 *
 * Introduced by the dark-mode-removal commit, which stripped declaration
 * bodies but left the opening braces. Nothing caught it because the JS
 * still parsed and no test looked inside the template literal.
 */

const fs = require('fs');
const path = require('path');

const JS_ROOT = path.join(__dirname, '../../public/assets/js');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

/** CSS assigned to elements created via document.createElement('style'). */
function injectedStylesheets(src) {
  const sheets = [];
  const varPattern =
    /(?:const|let|var)\s+(\w+)\s*=\s*document\.createElement\(\s*['"]style['"]\s*\)/g;
  const names = new Set();
  let m;
  while ((m = varPattern.exec(src)) !== null) {
    names.add(m[1]);
  }
  for (const name of names) {
    const assign = new RegExp(`${name}\\.(?:textContent|innerHTML|innerText)\\s*=\\s*\``, 'g');
    let a;
    while ((a = assign.exec(src)) !== null) {
      const start = a.index + a[0].length;
      const end = src.indexOf('`', start);
      if (end !== -1) {
        sheets.push(src.slice(start, end));
      }
    }
  }
  return sheets;
}

/** Strip ${...} interpolations and comments, which carry non-CSS braces. */
function normalise(css) {
  return css.replace(/\$\{[^}]*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function unclosedRules(css) {
  const clean = normalise(css);
  const opens = (clean.match(/\{/g) || []).length;
  const closes = (clean.match(/\}/g) || []).length;
  return opens - closes;
}

/** Selectors opened but immediately followed by another rule (no body). */
function orphanSelectors(css) {
  const out = [];
  const re = /([^{}\n][^{}]*?)\s*\{\s*\n\s*\n(?=\s*[^\s{}])/g;
  let m;
  while ((m = re.exec(normalise(css))) !== null) {
    out.push(m[1].trim().replace(/\s+/g, ' '));
  }
  return out;
}

describe('Injected component stylesheets are well-formed', () => {
  const files = walk(JS_ROOT).filter(f => {
    const src = fs.readFileSync(f, 'utf8');
    return injectedStylesheets(src).some(css => (css.match(/\{/g) || []).length >= 3);
  });

  test('the scan finds component stylesheets to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files.map(f => [path.relative(JS_ROOT, f), f]))(
    '%s: every injected rule is closed',
    (_label, file) => {
      const src = fs.readFileSync(file, 'utf8');
      for (const css of injectedStylesheets(src)) {
        const diff = unclosedRules(css);
        const orphans = orphanSelectors(css);
        expect({ unclosed: diff, orphans }).toEqual({ unclosed: 0, orphans: [] });
      }
    }
  );
});

describe('TimelineBuilder — defects found on the signed-in mobile pass', () => {
  const SRC = fs.readFileSync(path.join(JS_ROOT, 'components/timeline-builder.js'), 'utf8');

  test('REGRESSION: formatTime never renders the literal string "Invalid Date"', () => {
    // Extract and execute the real implementation.
    const body = SRC.slice(SRC.indexOf('formatTime(dateStr) {'));
    const end = body.indexOf('\n  }');
    // eslint-disable-next-line no-new-func
    const formatTime = new Function('dateStr', body.slice(body.indexOf('{') + 1, end));
    expect(formatTime(undefined)).toBe('');
    expect(formatTime(null)).toBe('');
    expect(formatTime('')).toBe('');
    expect(formatTime('not-a-date')).toBe('');
    expect(formatTime('2026-09-12T14:30:00Z')).not.toContain('Invalid');
  });

  test('REGRESSION: icon buttons are not global CTA buttons', () => {
    // `ef-cta` is forced to full width at mobile widths, which stretched the
    // pencil/bin glyphs into 268px slabs.
    expect(SRC).not.toMatch(/class="ef-cta btn-icon"/);
    expect(SRC).toMatch(/class="btn-icon"/);
  });

  test('icon buttons are square 44px targets with accessible names', () => {
    expect(SRC).toMatch(/\.btn-icon\s*\{[^}]*width:\s*44px/);
    expect(SRC).toMatch(/\.btn-icon\s*\{[^}]*height:\s*44px/);
    expect(SRC).toMatch(/aria-label="Edit \$\{this\.escapeHtml/);
    expect(SRC).toMatch(/aria-label="Delete \$\{this\.escapeHtml/);
  });

  test('the timeline header stacks at phone widths instead of colliding', () => {
    expect(SRC).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.timeline-header\s*\{[\s\S]*?flex-direction:\s*column/
    );
  });
});

describe('Signed-in mobile fixes stylesheet', () => {
  const CSS = fs.readFileSync(
    path.join(__dirname, '../../public/assets/css/signed-in-mobile-fixes.css'),
    'utf8'
  );

  test('breadcrumb crumbs share a baseline while keeping their 44px target', () => {
    expect(CSS).toMatch(/\.breadcrumbs \.breadcrumb-item[\s\S]*?display:\s*inline-flex/);
    expect(CSS).toMatch(/\.breadcrumbs \.breadcrumb-item[\s\S]*?align-items:\s*center/);
  });

  test('ring label is constrained to the inscribed circle, not the bounding box', () => {
    // A 140px ring only has ~99px of inscribed width (d / sqrt2 = 70.7%).
    // The label must be capped at or below that, whatever exact value is
    // chosen — assert the property, not a magic number.
    const rule = CSS.match(/\.plan-ring-label\s*\{([\s\S]*?)\}/);
    expect(rule).not.toBeNull();
    const maxWidth = rule[1].match(/max-width:\s*([\d.]+)%/);
    expect(maxWidth).not.toBeNull();
    expect(Number(maxWidth[1])).toBeLessThanOrEqual(70.7);
  });

  test('the settings avatar is deliberately NOT restyled (documented false positive)', () => {
    expect(CSS).toMatch(/FALSE POSITIVE/);
    expect(CSS).not.toMatch(/\.avatar-initials\s*\{/);
  });
});

describe('Polish pass — compactness and duplicate headings', () => {
  const CSS = fs.readFileSync(
    path.join(__dirname, '../../public/assets/css/signed-in-mobile-fixes.css'),
    'utf8'
  );
  const TL = fs.readFileSync(path.join(JS_ROOT, 'components/timeline-builder.js'), 'utf8');
  const SC = fs.readFileSync(path.join(JS_ROOT, 'components/supplier-comparison.js'), 'utf8');
  const TL_INIT = fs.readFileSync(path.join(JS_ROOT, 'pages/timeline-init.js'), 'utf8');
  const SC_INIT = fs.readFileSync(path.join(JS_ROOT, 'pages/compare-init.js'), 'utf8');
  const ED = fs.readFileSync(path.join(JS_ROOT, 'pages/event-detail-init.js'), 'utf8');

  test('components can suppress their title so they do not repeat the page <h1>', () => {
    expect(TL).toMatch(/showTitle:\s*options\.showTitle !== false/);
    expect(SC).toMatch(/showTitle:\s*options\.showTitle !== false/);
    // default stays true: any other call site is unaffected
    expect(TL).toMatch(/this\.options\.showTitle \?/);
    expect(SC).toMatch(/this\.options\.showTitle \?/);
  });

  test('the pages that already own an <h1> opt out of the component title', () => {
    expect(TL_INIT).toMatch(/showTitle:\s*false/);
    expect(SC_INIT).toMatch(/showTitle:\s*false/);
  });

  test('event-detail no longer repeats the hero title inside the panel', () => {
    expect(ED).not.toMatch(/<h2>\$\{esc\(event\.title\)\}<\/h2>/);
  });

  test('REGRESSION: compaction only ever reduces — no blanket empty-state padding', () => {
    // An earlier draft applied `padding: 26px !important` to [class*=empty],
    // which INFLATED .empty-state (already 24px) and made two pages longer.
    // Only the measured offender (.comparison-empty at 80px) is touched.
    expect(CSS).toMatch(/\.comparison-empty\s*\{[^}]*padding:\s*26px/);
    expect(CSS).not.toMatch(/\[class\*='empty/);
    expect(CSS).not.toMatch(/\[class\*='-empty'\]/);
  });
});
