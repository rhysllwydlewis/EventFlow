'use strict';

/**
 * Regression tests for admin notification panel viewport bounds.
 *
 * Why the first fix (notifications.js) failed:
 *   The admin dashboard uses a completely separate notification panel:
 *   class="admin-notif-panel" id="adminNotifPanel" — implemented in
 *   admin-navbar.js / admin-enhanced.css.  The notifications.js fix
 *   only corrected the generic .notification-dropdown element, which is
 *   NOT rendered on the /admin page.
 *
 * Actual root cause:
 *   .admin-notif-panel was position:absolute inside .admin-notif-bell-wrap
 *   (position:relative).  On mobile the bell wrap sits at ~x=250 on a
 *   390 px screen.  right:0; width:360px placed the panel left edge at
 *   250-360 = -110 px — completely off the left of the viewport.
 *   The old @media(max-width:480px) fix kept the same position:absolute
 *   anchor and had no effect.
 *
 * This fix:
 *   positionAdminNotifPanel() in admin-navbar.js switches to position:fixed
 *   (viewport-relative) using getBoundingClientRect() for the exact top.
 *   On mobile (<=600px): left:12px / right:12px / width:auto.
 *   On desktop: right-aligned to bell with viewport clamping on both edges.
 */

const fs   = require('fs');
const path = require('path');

const JS_PATH  = path.join(__dirname, '../../public/assets/js/admin-navbar.js');
const CSS_PATH = path.join(__dirname, '../../public/assets/css/admin-enhanced.css');

const src = fs.readFileSync(JS_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// ── Why the first fix failed ───────────────────────────────────────────────

describe('admin-navbar.js — uses DIFFERENT panel from notifications.js', () => {
  test('admin page uses adminNotifPanel, not notification-dropdown', () => {
    expect(src).toContain('adminNotifPanel');
    expect(src).toContain('admin-notif-panel');
    // The generic notification-dropdown is NOT managed by admin-navbar.js
    expect(src).not.toContain("getElementById('notification-dropdown')");
  });
});

// ── positionAdminNotifPanel — viewport-fixed positioning ──────────────────

describe('admin-navbar.js — positionAdminNotifPanel()', () => {
  test('function exists', () => {
    expect(src).toContain('function positionAdminNotifPanel(');
  });

  test('uses position:fixed (not absolute) for viewport anchoring', () => {
    const fn = src.slice(
      src.indexOf('function positionAdminNotifPanel('),
      src.indexOf('\n  function ', src.indexOf('function positionAdminNotifPanel(') + 10)
    );
    expect(fn).toContain("position'   = 'fixed'");
  });

  test('uses getBoundingClientRect() to compute top relative to bell', () => {
    const fn = src.slice(
      src.indexOf('function positionAdminNotifPanel('),
      src.indexOf('\n  function ', src.indexOf('function positionAdminNotifPanel(') + 10)
    );
    expect(fn).toContain('getBoundingClientRect()');
    expect(fn).toContain('btnRect.bottom');
  });

  test('mobile path (<=600px) sets left:12px and right:12px', () => {
    const fn = src.slice(
      src.indexOf('function positionAdminNotifPanel('),
      src.indexOf('\n  function ', src.indexOf('function positionAdminNotifPanel(') + 10)
    );
    expect(fn).toContain("left       = '12px'");
    expect(fn).toContain("right      = '12px'");
    expect(fn).toContain('vw <= 600');
  });

  test('mobile path sets width:auto and maxWidth:none to prevent CSS width override', () => {
    const fn = src.slice(
      src.indexOf('function positionAdminNotifPanel('),
      src.indexOf('\n  function ', src.indexOf('function positionAdminNotifPanel(') + 10)
    );
    expect(fn).toContain("width      = 'auto'");
    expect(fn).toContain("maxWidth   = 'none'");
  });

  test('desktop path clamps left edge: leftEdge = Math.max(leftEdge, MARGIN)', () => {
    const fn = src.slice(
      src.indexOf('function positionAdminNotifPanel('),
      src.indexOf('\n  function ', src.indexOf('function positionAdminNotifPanel(') + 10)
    );
    expect(fn).toContain('Math.max(leftEdge, MARGIN)');
  });

  test('desktop path clamps right edge: rightEdge = Math.min(rightEdge, vw - MARGIN)', () => {
    const fn = src.slice(
      src.indexOf('function positionAdminNotifPanel('),
      src.indexOf('\n  function ', src.indexOf('function positionAdminNotifPanel(') + 10)
    );
    expect(fn).toContain('Math.min(rightEdge, vw - MARGIN)');
  });
});

// ── clearAdminNotifPanelStyles ─────────────────────────────────────────────

describe('admin-navbar.js — clearAdminNotifPanelStyles()', () => {
  test('exists and clears position, top, left, right, width, maxWidth, boxSizing', () => {
    expect(src).toContain('function clearAdminNotifPanelStyles(');
    const fn = src.slice(
      src.indexOf('function clearAdminNotifPanelStyles('),
      src.indexOf('}', src.indexOf('function clearAdminNotifPanelStyles(')) + 2
    );
    expect(fn).toContain('position');
    expect(fn).toContain('top');
    expect(fn).toContain('left');
    expect(fn).toContain('right');
    expect(fn).toContain('width');
  });
});

// ── toggleNotifPanel integration ──────────────────────────────────────────

describe('admin-navbar.js — toggleNotifPanel()', () => {
  test('calls positionAdminNotifPanel before making panel visible', () => {
    const toggleFn = src.slice(
      src.indexOf('function toggleNotifPanel('),
      src.indexOf('\n  function ', src.indexOf('function toggleNotifPanel(') + 10)
    );
    const posIdx  = toggleFn.indexOf('positionAdminNotifPanel(');
    const showIdx = toggleFn.indexOf('panel.hidden = false');
    expect(posIdx).toBeGreaterThan(-1);
    expect(showIdx).toBeGreaterThan(posIdx); // position THEN show
  });

  test('clears inline styles when closing', () => {
    const toggleFn = src.slice(
      src.indexOf('function toggleNotifPanel('),
      src.indexOf('\n  function ', src.indexOf('function toggleNotifPanel(') + 10)
    );
    expect(toggleFn).toContain('clearAdminNotifPanelStyles(');
  });
});

// ── CSS safety net ────────────────────────────────────────────────────────

describe('admin-enhanced.css — mobile safety fallback', () => {
  test('breakpoint is 600px or wider (covers all common mobile widths)', () => {
    expect(css).toMatch(/@media.*max-width.*600px/);
    // Old broken 480px breakpoint should be removed
    expect(css).not.toMatch(/@media.*max-width.*480px/);
  });

  test('mobile rule uses position:fixed (not absolute)', () => {
    const mq = css.slice(css.indexOf('@media (max-width: 600px)'));
    expect(mq).toContain('position: fixed');
  });

  test('mobile rule uses left:12px and right:12px', () => {
    const mq = css.slice(css.indexOf('@media (max-width: 600px)'));
    expect(mq).toContain('left: 12px');
    expect(mq).toContain('right: 12px');
  });

  test('mobile rule sets width:auto and max-width:none', () => {
    const mq = css.slice(css.indexOf('@media (max-width: 600px)'));
    expect(mq).toContain('width: auto');
    expect(mq).toContain('max-width: none');
  });
});

// ── Simulate viewport bounds at mobile widths ─────────────────────────────
// These are pure logic tests — they reproduce the arithmetic that
// positionAdminNotifPanel() uses and assert the panel stays within the viewport.

function simulatePosition(vpWidth, bellRight) {
  const PANEL_W = 360;
  const MARGIN  = 12;
  let rightEdge = Math.min(bellRight, vpWidth - MARGIN);
  let leftEdge  = rightEdge - PANEL_W;
  leftEdge      = Math.max(leftEdge, MARGIN);
  rightEdge     = leftEdge + PANEL_W;
  return { leftEdge, rightEdge, panelWidth: PANEL_W };
}

describe('positionAdminNotifPanel arithmetic — desktop viewport bounds', () => {
  const widths = [768, 1024, 1280, 1440];
  widths.forEach(vw => {
    test(\`desktop \${vw}px — panel left >= 12px and right <= vw-12px\`, () => {
      // Bell typically at right edge of header
      const bellRight = vw - 20;
      const { leftEdge, rightEdge } = simulatePosition(vw, bellRight);
      expect(leftEdge).toBeGreaterThanOrEqual(12);
      expect(rightEdge).toBeLessThanOrEqual(vw - 12);
    });
  });
});
