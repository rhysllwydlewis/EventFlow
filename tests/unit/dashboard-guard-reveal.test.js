'use strict';

/**
 * Revealing a guarded dashboard must not start visibility transitions.
 *
 * The guard hides the page with `visibility: hidden` until sign-in is confirmed. Taking that away
 * made every element with `transition: all` (buttons, inputs, table cells) animate from hidden to
 * visible; in a browser whose animation clock is throttled they stayed hidden, and the admin
 * packages page showed no search box, filters or table in WebKit. The reveal now switches
 * transitions off in the same step and restores them a moment later.
 */

const fs = require('fs');
const path = require('path');

const guard = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/dashboard-guard.js'),
  'utf8'
);

/** The body of showPage(), cut out of the source. */
function showPageSource() {
  const start = guard.indexOf('function showPage()');
  const end = guard.indexOf('function showAccessError()');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return guard.slice(start, end);
}

describe('dashboard guard: revealing the page', () => {
  test('turns transitions off in the same step as removing the hiding rule', () => {
    const source = showPageSource();
    expect(source).toMatch(/transition: none !important/);
    // The no-transition rule is added before the hiding rule is removed, so no element has a
    // transition in the style it is revealed with.
    expect(source.indexOf('appendChild(calm)')).toBeGreaterThan(-1);
    expect(source.indexOf('appendChild(calm)')).toBeLessThan(source.indexOf('style.remove()'));
  });

  test('puts transitions back shortly afterwards', () => {
    expect(showPageSource()).toMatch(/setTimeout\(\(\) => calm\.remove\(\), \d+\)/);
  });

  test('still hides the page with visibility until sign-in is confirmed', () => {
    expect(guard).toContain('body { visibility: hidden !important; opacity: 0 !important; }');
  });
});
