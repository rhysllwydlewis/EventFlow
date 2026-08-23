'use strict';

/**
 * Type-scale guard.
 *
 * Before this pass the site declared 134 distinct font-size values and
 * rendered 49 distinct sizes — including 13, 13.1, 13.3, 13.4, 13.6 and
 * 13.8px, six sizes within 0.8px of each other. Nobody can tell those
 * apart; together they make the UI read as assembled rather than designed.
 *
 * Customer-facing CSS is now snapped to one scale, biased small:
 *
 *     10  11  12  13  14  16  18  20  24  28  32
 *
 * >= 36px is decorative (emoji glyphs, empty-state illustrations) and is
 * exempt, as are fluid clamp() headlines and `em` values (relative by
 * design). Admin is a separate surface and is excluded entirely.
 */

const fs = require('fs');
const path = require('path');

const CSS_DIR = path.join(__dirname, '../../public/assets/css');

const SCALE = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32];
const DECORATIVE_MIN = 36;

/** Customer-facing stylesheets only. */
const files = fs.readdirSync(CSS_DIR).filter(f => f.endsWith('.css') && !f.startsWith('admin'));

/** Plain `font-size: <n>px|rem` declarations (not clamp(), not em). */
function declaredSizes(css) {
  const out = [];
  // strip clamp(...) first: its fluid middle term is viewport-dependent by
  // design and cannot land on a fixed scale
  const withoutClamp = css.replace(/font-size:\s*clamp\([^()]*\)/g, '');
  const re = /font-size:\s*([0-9.]+)(px|rem)\b/g;
  let m;
  while ((m = re.exec(withoutClamp)) !== null) {
    const value = parseFloat(m[1]);
    out.push(m[2] === 'px' ? value : value * 16);
  }
  return out;
}

describe('Type scale', () => {
  test('the scale itself is the documented one', () => {
    expect(SCALE).toEqual([10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32]);
  });

  test('customer-facing stylesheets are found', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  test.each(files)('%s declares only on-scale font sizes', file => {
    const css = fs.readFileSync(path.join(CSS_DIR, file), 'utf8');
    const offScale = declaredSizes(css)
      .filter(px => px < DECORATIVE_MIN)
      .filter(px => !SCALE.some(step => Math.abs(step - px) < 0.01))
      .map(px => Math.round(px * 100) / 100);
    expect({ file, offScale: [...new Set(offScale)] }).toEqual({ file, offScale: [] });
  });

  test('the scale stays lean — no creeping back to 20+ sizes', () => {
    const all = new Set();
    for (const file of files) {
      const css = fs.readFileSync(path.join(CSS_DIR, file), 'utf8');
      declaredSizes(css)
        .filter(px => px < DECORATIVE_MIN)
        .forEach(px => all.add(Math.round(px)));
    }
    // 10 steps in the scale; allow no more than that below the decorative line
    expect(all.size).toBeLessThanOrEqual(SCALE.length);
  });
});

/**
 * Static stylesheets must PARSE.
 *
 * The injected-stylesheet test added earlier only checked CSS built inside
 * JavaScript. It never looked at the .css files themselves — and three of
 * them (animations.css, eventflow-17.0.0.css, admin-enhanced.css) had
 * unclosed rules from the same dark-mode-removal commit. A CSS parser
 * discards everything after an unclosed block, so those files were
 * silently dropping rules in production.
 *
 * Brace-counting is not enough to catch this (braces can balance while the
 * structure is still wrong), so this parses each file for real.
 */
describe('Every static stylesheet parses', () => {
  const postcss = require('postcss');
  const dirs = [
    path.join(__dirname, '../../public/assets/css'),
    path.join(__dirname, '../../public/messenger/css'),
  ];

  const sheets = dirs.flatMap(dir =>
    fs
      .readdirSync(dir)
      .filter(f => f.endsWith('.css'))
      .map(f => [`${path.basename(dir)}/${f}`, path.join(dir, f)])
  );

  test('stylesheets are found', () => {
    expect(sheets.length).toBeGreaterThan(50);
  });

  test('the parser rejects an unclosed rule', () => {
    expect(() => postcss.parse('.broken { color: red;', { from: 'fixture.css' })).toThrow();
  });

  test.each(sheets)('%s parses without unclosed blocks', (_label, file) => {
    const css = fs.readFileSync(file, 'utf8');
    expect(() => postcss.parse(css, { from: file })).not.toThrow();
  });
});
