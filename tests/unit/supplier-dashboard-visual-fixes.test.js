'use strict';

/**
 * Fixes from the visual review of the supplier dashboard: long package lists fold, package actions
 * remain usable, anchor jumps clear the fixed header, the calendar keeps to one accent, and the
 * messenger's load error matches the rest of the page.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const html = read('public/dashboard-supplier.html');
const css = read('public/assets/css/supplier-dashboard-home.css');
const calendarJs = read('public/assets/js/pages/dashboard-supplier-calendar.js');
const widget = read('public/messenger/js/MessengerWidgetV4.js');

const cards = JSON.parse(
  execFileSync(
    process.execPath,
    [path.join(__dirname, '../helpers/supplier-overlays-scenario.js'), 'cards'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
  )
);

describe('supplier dashboard: visual fixes', () => {
  test('a long package list shows the first five and folds the rest into a real <details>', () => {
    expect(cards.list).toEqual({
      shown: 5,
      folded: 7,
      summary: 'Show the other 7 packages',
      open: false,
      few: 0,
      keptOpen: true,
      one: 'Show the other 1 package',
    });
  });

  // Package action visibility and wrapping are checked at actual viewport sizes in
  // e2e/supplier-dashboard-audit.spec.js; fixed column counts previously hid overflow at 320px.

  test('Escape answers "no" in the confirmation dialog itself (a browser may ignore its own close request)', () => {
    const home = read('public/assets/js/pages/supplier-dashboard-home.js');
    const confirm = home.slice(
      home.indexOf('function confirmAction('),
      home.indexOf('function openDialog(')
    );
    expect(confirm).toContain("document.addEventListener('keydown', onKey)");
    expect(confirm).toContain("event.key === 'Escape'");
    expect(confirm).toContain("document.removeEventListener('keydown', onKey)");
  });

  test('anchor jumps land below the fixed header', () => {
    expect(css).toMatch(/\.sdh-page \[id\] \{\s*scroll-margin-top: 96px/);
  });

  test('an odd last summary tile spans the row instead of leaving an empty cell', () => {
    expect(css).toContain('.sdh-summary__grid > :last-child:nth-child(odd)');
  });

  test('the calendar keeps to one accent and tells entries apart by shape, with a key that says so', () => {
    expect(html).toContain('Private entries (solid)');
    expect(html).toContain('Public events (dashed)');
    expect(html).toContain('Saved public events (dotted)');
    expect(css).toMatch(/\.sdh-ev--public \{\s*border-style: dashed/);
    expect(css).toMatch(/\.sdh-ev--saved \{\s*border-style: dotted/);
    ['#6366f1', '#f59e0b', '#7c3aed', '#e11d48'].forEach(colour =>
      expect(css.toLowerCase()).not.toContain(colour)
    );
    expect(calendarJs).toContain("classNames: ['sdh-ev--private']");
    expect(calendarJs).toContain("'sdh-ev--public'");
  });

  test("the messenger load error has no emoji or inline styles, and its retry matches the page's buttons", () => {
    const error = widget.slice(
      widget.indexOf('_renderError() {'),
      widget.indexOf('// ── Event handling')
    );
    expect(error).not.toMatch(/[\u{1F300}-\u{1FAFF}⚠]/u);
    expect(error).not.toContain('style=');
    expect(error).toContain('mwv4__retry-btn');
    expect(css).toMatch(/\.mwv4__retry-btn \{[^}]*min-height: 44px/);
  });

  test('messenger rows name a supplier by their business and fall back to initials, not a hidden photo', () => {
    expect(widget).toContain("other.role === 'supplier'");
    expect(widget).toContain('safeDisplayName(other.businessName, other.displayName, other.name)');
    expect(widget).toContain('data-fallback-text=');
    expect(widget).not.toContain('class="mwv4__avatar-img" loading="lazy" data-fallback-hide');
    expect(read('public/assets/js/app.js')).toContain('ef-img-fallback-initials');
  });
});
