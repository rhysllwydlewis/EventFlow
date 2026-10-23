/**
 * The admin quick-navigation drawer.
 *
 * Closed, it must cost nothing to draw and nothing to tab through: the blurs behind the drawer and
 * its backdrop (a full-screen layer) are only applied while it is open, and the closed drawer is
 * inert. A closed drawer that still blurred the page made headless WebKit stop producing animation
 * frames on every admin page, and its links were focusable while the drawer was aria-hidden.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'public/assets/css/admin-navbar.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/assets/js/admin-navbar.js'), 'utf8');

/** The declarations of the first rule that starts with this exact selector. */
function ruleBody(selector) {
  const start = css.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('the quick-navigation drawer and its backdrop', () => {
  test.each(['.admin-qnav-panel', '.admin-qnav-backdrop'])(
    '%s does not blur the page while closed',
    selector => {
      expect(ruleBody(selector)).not.toMatch(/backdrop-filter/);
    }
  );

  test.each(['.admin-qnav-panel.qnav-open', '.admin-qnav-backdrop.qnav-open'])(
    '%s blurs the page while open',
    selector => {
      expect(ruleBody(selector)).toMatch(/backdrop-filter: blur\(/);
    }
  );

  test('the closed backdrop is not rendered at all, not only transparent', () => {
    expect(ruleBody('.admin-qnav-backdrop')).toMatch(/visibility: hidden/);
    expect(ruleBody('.admin-qnav-backdrop.qnav-open')).toMatch(/visibility: visible/);
  });

  test('the panel contents carry no blurs of their own', () => {
    expect(ruleBody('.admin-qnav-search')).not.toMatch(/backdrop-filter/);
    expect(ruleBody('.admin-qnav-tile')).not.toMatch(/backdrop-filter/);
  });

  test('reduced motion also removes the open-state transitions', () => {
    const block = css.slice(css.indexOf('Quick Nav reduced-motion overrides'));
    expect(block).toContain('.admin-qnav-backdrop.qnav-open');
  });
});

describe('the closed drawer is out of the tab order', () => {
  test('it is drawn inert', () => {
    expect(js).toContain('aria-hidden="true" inert>');
  });

  test('opening makes it interactive and closing makes it inert again', () => {
    const open = js.slice(js.indexOf('function openPanel()'), js.indexOf('function closePanel()'));
    const close = js.slice(js.indexOf('function closePanel()'));
    expect(open).toContain('panel.inert = false;');
    expect(close).toContain('panel.inert = true;');
  });
});
