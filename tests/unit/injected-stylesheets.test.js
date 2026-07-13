'use strict';

/**
 * Guards against malformed component stylesheets.
 *
 * Several components build a <style> element and assign a CSS template
 * literal to it. A 2026-03 commit stripped declaration bodies but left the
 * opening braces behind, e.g.
 *
 *     .timeline-event {
 *
 *     .timeline-event::before {
 *
 * The sheet is then unbalanced, and the CSS parser discards every rule that
 * follows the orphan — so large parts of a component silently render with
 * browser-default styling (raw grey buttons, no layout). Nine components
 * shipped in that state.
 *
 * These tests fail loudly if any injected stylesheet is unparseable again.
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

/** CSS strings assigned to elements created via document.createElement('style'). */
function injectedStylesheets(src) {
  const sheets = [];
  const varPattern =
    /(?:const|let|var)\s+(\w+)\s*=\s*document\.createElement\(\s*['"]style['"]\s*\)/g;
  const vars = new Set();
  let m;
  while ((m = varPattern.exec(src)) !== null) {
    vars.add(m[1]);
  }
  for (const v of vars) {
    const assign = new RegExp(`${v}\\.(?:textContent|innerHTML|innerText)\\s*=\\s*\``, 'g');
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

/** Strip ${...} interpolations and comments, which legitimately contain braces. */
function normalise(css) {
  return css.replace(/\$\{[^}]*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const files = walk(JS_ROOT);
const sheets = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  for (const css of injectedStylesheets(src)) {
    if ((css.match(/\{/g) || []).length >= 3) {
      sheets.push({ file: path.relative(JS_ROOT, file), css });
    }
  }
}

describe('injected component stylesheets', () => {
  test('the scan finds the component stylesheets (guards the guard)', () => {
    // If this ever hits zero the extraction has silently broken and the
    // balance assertions below would pass vacuously.
    expect(sheets.length).toBeGreaterThan(5);
  });

  test.each(sheets.map(s => [s.file, s.css]))(
    '%s — braces are balanced (sheet parses)',
    (file, css) => {
      const clean = normalise(css);
      const open = (clean.match(/\{/g) || []).length;
      const close = (clean.match(/\}/g) || []).length;
      expect({ file, open, close }).toEqual({ file, open, close: open });
    }
  );

  test.each(sheets.map(s => [s.file, s.css]))(
    '%s — no rule is opened and left without declarations',
    (file, css) => {
      // "selector {" immediately followed by a blank line and another
      // selector is the exact signature of the 2026-03 breakage.
      const orphans = [...normalise(css).matchAll(/([^{}\n][^{}]*?)\s*\{\s*\n\s*\n(?=\s*[^\s{}])/g)]
        .map(m => m[1].trim().replace(/\s+/g, ' '));
      expect(orphans).toEqual([]);
    }
  );
});

describe('timeline builder hardening', () => {
  const src = fs.readFileSync(
    path.join(JS_ROOT, 'components/timeline-builder.js'),
    'utf8'
  );

  test('formatTime never renders the literal string "Invalid Date"', () => {
    // new Date(undefined).toLocaleTimeString() => "Invalid Date", which was
    // rendered straight into the timeline for items without a time.
    const match = src.match(/formatTime\(dateStr\)\s*\{([\s\S]*?)\n {2}\}/);
    expect(match).not.toBeNull();
    const body = match[1];
    expect(body).toMatch(/if \(!dateStr\)/);
    expect(body).toMatch(/Number\.isNaN\(date\.getTime\(\)\)/);
  });

  test('icon buttons are not styled as full-width CTAs', () => {
    // `ef-cta` is caught by a global mobile full-width rule, which stretched
    // the emoji-only edit/delete buttons to 268px.
    expect(src).not.toMatch(/class="ef-cta btn-icon"/);
    expect(src).toMatch(/class="btn-icon"/);
  });

  test('icon buttons carry accessible names', () => {
    expect(src).toMatch(/aria-label="Edit \$\{this\.escapeHtml\(/);
    expect(src).toMatch(/aria-label="Delete \$\{this\.escapeHtml\(/);
  });
});
