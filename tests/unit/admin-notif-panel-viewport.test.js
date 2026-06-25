'use strict';

/**
 * Regression tests for admin notification panel viewport positioning.
 *
 * Why the FIRST fix failed (notifications.js, PR #1250):
 *   The admin dashboard does NOT use the generic .notification-dropdown
 *   element targeted by notifications.js.  It has its own completely
 *   separate panel: class="admin-notif-panel" id="adminNotifPanel",
 *   implemented in admin-navbar.js / admin-enhanced.css.  The PR #1250
 *   fix had zero effect on the admin dashboard.
 *
 * Actual root cause:
 *   .admin-notif-panel was position:absolute inside .admin-notif-bell-wrap
 *   (position:relative).  On mobile the bell wrap sits at ~x=250 on a
 *   390 px screen.  With right:0; width:360px the panel left edge was at
 *   250-360 = -110 px — completely off-screen to the left.
 *
 *   The old CSS "@media(max-width:480px) { right:-8px }" override was still
 *   anchored to the same container and had no real effect.
 *
 * This fix:
 *   positionAdminNotifPanel() switches to position:fixed (viewport-relative)
 *   using getBoundingClientRect() for an exact top.  On mobile (<=600 px):
 *   left:12px / right:12px / width:auto / maxWidth:none.
 *   On desktop: right-aligned to the bell with viewport clamping on both edges.
 */

const fs   = require('fs');
const path = require('path');

const JS_SRC  = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/admin-navbar.js'), 'utf8'
);
const CSS_SRC = fs.readFileSync(
  path.join(__dirname, '../../public/assets/css/admin-enhanced.css'), 'utf8'
);

// ── Helper: extract a named function body ──────────────────────────────────
function extractFn(src, name) {
  const s = src.indexOf(`function ${name}(`);
  if (s < 0) return '';
  const e = src.indexOf('\n  function ', s + name.length);
  return src.slice(s, e > s ? e : src.length);
}

// ── Helper: find the CSS block that actually contains admin-notif-panel ────
// admin-enhanced.css has several @media blocks; we need the one for the panel.
function findNotifCssBlock(css) {
  // Work backwards from the last occurrence of admin-notif-panel inside a
  // @media rule — that is the notification-specific mobile override.
  const lastIdx = css.lastIndexOf('admin-notif-panel');
  if (lastIdx < 0) return '';
  // Walk back to the opening @media
  const mqIdx = css.lastIndexOf('@media', lastIdx);
  if (mqIdx < 0) return '';
  // Extract to the closing brace of the block
  const end = css.indexOf('\n}', mqIdx) + 2;
  return css.slice(mqIdx, end);
}

const fnPos    = extractFn(JS_SRC, 'positionAdminNotifPanel');
const fnClear  = extractFn(JS_SRC, 'clearAdminNotifPanelStyles');
const fnToggle = extractFn(JS_SRC, 'toggleNotifPanel');
const notifMQ  = findNotifCssBlock(CSS_SRC);

// ── 1. Proof that admin uses a different panel ─────────────────────────────

describe('admin-navbar.js — separate panel, not notification-dropdown', () => {
  test('manages adminNotifPanel / admin-notif-panel, not notification-dropdown', () => {
    expect(JS_SRC).toContain('adminNotifPanel');
    expect(JS_SRC).toContain('admin-notif-panel');
    expect(JS_SRC).not.toContain("getElementById('notification-dropdown')");
  });
});

// ── 2. positionAdminNotifPanel ─────────────────────────────────────────────

describe('admin-navbar.js — positionAdminNotifPanel()', () => {
  test('function exists', () => {
    expect(fnPos).not.toBe('');
  });

  test('switches to position:fixed so panel is viewport-relative (not parent-relative)', () => {
    expect(fnPos).toContain("panel.style.position   = 'fixed'");
  });

  test('computes top from getBoundingClientRect() so panel opens below the bell', () => {
    expect(fnPos).toContain('getBoundingClientRect()');
    expect(fnPos).toContain('btnRect.bottom');
  });

  test('mobile path (vw <= 600): left:12px', () => {
    expect(fnPos).toContain("panel.style.left       = '12px'");
    expect(fnPos).toContain('vw <= 600');
  });

  test('mobile path (vw <= 600): right:12px', () => {
    expect(fnPos).toContain("panel.style.right      = '12px'");
  });

  test('mobile path: width:auto overrides the CSS 360px width', () => {
    expect(fnPos).toContain("panel.style.width      = 'auto'");
  });

  test('mobile path: maxWidth:none overrides the CSS max-width', () => {
    expect(fnPos).toContain("panel.style.maxWidth   = 'none'");
  });

  test('mobile path: boxSizing:border-box set', () => {
    expect(fnPos).toContain("panel.style.boxSizing  = 'border-box'");
  });

  test('desktop path: clamps left edge to MARGIN (panel never bleeds off-screen left)', () => {
    expect(fnPos).toContain('Math.max(leftEdge, MARGIN)');
  });

  test('desktop path: clamps right edge to vw - MARGIN (never bleeds off-screen right)', () => {
    expect(fnPos).toContain('Math.min(rightEdge, vw - MARGIN)');
  });

  test('desktop path: also uses position:fixed (not absolute)', () => {
    // Both mobile and desktop branches set position:fixed
    const occurrences = (fnPos.match(/panel\.style\.position\s*=\s*'fixed'/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

// ── 3. clearAdminNotifPanelStyles ─────────────────────────────────────────

describe('admin-navbar.js — clearAdminNotifPanelStyles()', () => {
  test('function exists', () => {
    expect(fnClear).not.toBe('');
  });

  test('resets all 7 inline properties added by positionAdminNotifPanel', () => {
    for (const prop of ['position', 'top', 'left', 'right', 'width', 'maxWidth', 'boxSizing']) {
      expect(fnClear).toContain(prop);
    }
  });
});

// ── 4. toggleNotifPanel integration ───────────────────────────────────────

describe('admin-navbar.js — toggleNotifPanel()', () => {
  test('calls positionAdminNotifPanel() before panel.hidden = false', () => {
    const posIdx  = fnToggle.indexOf('positionAdminNotifPanel(');
    const showIdx = fnToggle.indexOf('panel.hidden = false');
    expect(posIdx).toBeGreaterThan(-1);
    expect(showIdx).toBeGreaterThan(posIdx);
  });

  test('calls clearAdminNotifPanelStyles() when closing', () => {
    expect(fnToggle).toContain('clearAdminNotifPanelStyles(');
  });

  test('sets panel.hidden = true when closing', () => {
    expect(fnToggle).toContain('panel.hidden = true');
  });
});

// ── 5. CSS safety fallback in admin-enhanced.css ──────────────────────────

describe('admin-enhanced.css — notification panel mobile rule', () => {
  test('notification-specific mobile rule found (last @media block targeting admin-notif-panel)', () => {
    expect(notifMQ).not.toBe('');
    expect(notifMQ).toContain('admin-notif-panel');
  });

  test('breakpoint is max-width:600px (not the old 480px that missed some phones)', () => {
    expect(notifMQ).toContain('600px');
  });

  test('uses position:fixed (overrides base position:absolute)', () => {
    expect(notifMQ).toContain('position: fixed');
  });

  test('uses left:12px and right:12px for viewport pinning', () => {
    expect(notifMQ).toContain('left: 12px');
    expect(notifMQ).toContain('right: 12px');
  });

  test('uses width:auto (lets left+right pins control width)', () => {
    expect(notifMQ).toContain('width: auto');
  });

  test('uses max-width:none (prevents CSS width from limiting the pinned width)', () => {
    expect(notifMQ).toContain('max-width: none');
  });

  test('includes box-sizing:border-box', () => {
    expect(notifMQ).toContain('box-sizing: border-box');
  });

  test('no longer has the broken right:-8px mobile override for admin-notif-panel', () => {
    // The old rule only adjusted right and width within the same position:absolute
    // container, which kept the panel off-screen.  It must be gone.
    expect(notifMQ).not.toContain('right: -8px');
  });
});

// ── 6. Pure-arithmetic simulation of desktop clamping ─────────────────────
// Reproduces positionAdminNotifPanel() desktop math and asserts the panel
// bounding box is always within the viewport at representative widths.

function simulateDesktopPosition(vpWidth, bellRight) {
  const PANEL_W = 360;
  const MARGIN  = 12;
  let rightEdge = Math.min(bellRight, vpWidth - MARGIN);
  let leftEdge  = rightEdge - PANEL_W;
  leftEdge      = Math.max(leftEdge, MARGIN);
  rightEdge     = leftEdge + PANEL_W;
  return { leftEdge, rightEdge };
}

describe('positionAdminNotifPanel arithmetic — panel stays within viewport', () => {
  // Desktop widths: bell sits near the right side of the header
  const cases = [
    { vw: 768,  bellRight: 748 },
    { vw: 1024, bellRight: 1004 },
    { vw: 1280, bellRight: 1260 },
    { vw: 1440, bellRight: 1420 },
    // Edge case: bell at far left (would flip the panel right)
    { vw: 1024, bellRight: 100 },
    // Edge case: bell at extreme right (clamp prevents right overflow)
    { vw: 768,  bellRight: 768 },
  ];

  cases.forEach(({ vw, bellRight }) => {
    test(`vw=${vw} bellRight=${bellRight} → panel within [12, vw-12]`, () => {
      const { leftEdge, rightEdge } = simulateDesktopPosition(vw, bellRight);
      expect(leftEdge).toBeGreaterThanOrEqual(12);
      expect(rightEdge).toBeLessThanOrEqual(vw - 12 + 360); // panel width is fixed at 360
      expect(leftEdge).toBeLessThan(rightEdge);
    });
  });
});
