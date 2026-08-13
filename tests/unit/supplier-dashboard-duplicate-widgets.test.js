/**
 * A deeper visual-review pass on the supplier dashboard turned up a legacy
 * script (dashboard-supplier-overhaul.js, from an earlier PR) still running
 * alongside the current dashboard-supplier-module.js and duplicating its
 * output:
 *  - Both scripts rendered a KPI stat-tile row from the same
 *    dashboard-summary data into two separate, stacked containers
 *    (#supplier-kpi-grid and #supplier-stats-grid) with no divider between
 *    them — reading as an accidental duplicate rather than two intentional
 *    views.
 *  - The Availability card's own heading ("Availability Status") was
 *    repeated verbatim by the widget rendered inside it.
 *
 * These are pinned as plain source/string assertions (the same style
 * tests/unit/supplier-review-request-client.test.js uses for this file)
 * rather than full DOM rendering, since the fixes are structural: a
 * duplicate container removed, and a duplicate string no longer emitted.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'public/dashboard-supplier.html'), 'utf8');
const overhaulSource = fs.readFileSync(
  path.join(root, 'public/assets/js/dashboard-supplier-overhaul.js'),
  'utf8'
);
const appSource = fs.readFileSync(path.join(root, 'public/assets/js/app.js'), 'utf8');
const ringSource = fs.readFileSync(
  path.join(root, 'public/assets/js/components/profile-health-widget.js'),
  'utf8'
);

describe('the legacy KPI grid duplicate is removed', () => {
  it('no longer has a #supplier-kpi-grid container in the page', () => {
    expect(html).not.toContain('id="supplier-kpi-grid"');
  });

  it('no longer renders a KPI grid from dashboard-supplier-overhaul.js', () => {
    expect(overhaulSource).not.toContain('function renderKpiGrid');
    expect(overhaulSource).not.toContain('supplier-kpi-grid');
  });

  it('keeps the current stats grid that dashboard-supplier-module.js renders', () => {
    expect(html).toContain('id="supplier-stats-grid"');
  });

  it('no longer fetches dashboard-summary a second time just to feed the removed grid', () => {
    expect(overhaulSource).not.toContain('dashboard-summary?days=30');
  });
});

describe('the Availability widget no longer repeats the card heading', () => {
  it('the enclosing card heading is unchanged', () => {
    expect(html).toContain(
      '<h3 id="avail-heading" class="sd-card-header__heading">Availability Status</h3>'
    );
  });

  it('the inner widget shows the current status instead of repeating "Availability Status"', () => {
    expect(overhaulSource).not.toMatch(
      /availability-widget__title">\s*<span class="availability-dot[^>]*><\/span>\s*Availability Status/
    );
    expect(overhaulSource).toContain('statusLabel');
  });

  it('updates the status label live when the user picks a different status', () => {
    expect(overhaulSource).toContain("container.querySelector('.availability-widget__title')");
  });
});

describe('the package Pause/Resume control has a visible text label', () => {
  it('renders "Pause" and "Resume" text alongside the icon, not an icon alone', () => {
    const pauseBtnLine = appSource
      .split('\n')
      .find(line => line.includes('unpause-package') && line.includes('pause-package'));
    expect(pauseBtnLine).toBeDefined();
    expect(pauseBtnLine).toContain('Pause');
    expect(pauseBtnLine).toContain('Resume');
  });
});

describe('the Profile Health ring does not draw a stray dot at 0%', () => {
  it('only draws the progress circle when percentage is greater than zero', () => {
    expect(ringSource).toContain('percentage > 0');
  });

  it('the background circle is unconditional so the ring is still visible at 0%', () => {
    expect(ringSource).toContain('class="progress-ring-background"');
  });
});
