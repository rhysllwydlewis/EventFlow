/**
 * The supplier dashboard used to show the same facts several times: two stat-tile rows built
 * from the same summary, an Availability widget repeating its own card heading, and a chart
 * whose period buttons fed on a different source than the tiles. The redesign draws each
 * fact once. These are plain source assertions, like the rest of this page's tests, because
 * the fixes are structural: a duplicate container gone, a duplicate string no longer emitted.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/dashboard-supplier.html');
const homeSource = read('public/assets/js/pages/supplier-dashboard-home.js');
const appSource = read('public/assets/js/app.js');
const ringSource = read('public/assets/js/components/profile-health-widget.js');

describe('the legacy stat grids are gone', () => {
  it('has neither the KPI grid nor the second stats grid', () => {
    expect(html).not.toContain('id="supplier-kpi-grid"');
    expect(html).not.toContain('id="supplier-stats-grid"');
  });

  it('has one summary row, filled from the one dashboard summary request', () => {
    expect(html.match(/id="sdh-summary-grid"/g)).toHaveLength(1);
    expect(homeSource.match(/dashboard-summary\?days=/g)).toHaveLength(1);
  });
});

describe('the Availability widget does not repeat the card heading', () => {
  it('the card heading is "Availability", and the widget has no title of its own', () => {
    expect(html).toContain('<h2 id="avail-heading" class="sdh-card__title">Availability</h2>');
    expect(homeSource).not.toContain('availability-widget__title');
  });

  it('tells the supplier when availability could not be loaded, instead of a skeleton that never ends', () => {
    expect(homeSource).toContain('We could not load your availability.');
    expect(homeSource).toContain('retry-availability');
  });
});

describe('the package Pause/Resume control has a visible text label', () => {
  it('renders "Pause" and "Resume" as text', () => {
    const pauseLine = appSource.split('\n').find(line => line.includes('const pauseControl'));
    expect(pauseLine).toBeDefined();
    expect(pauseLine).toContain('Pause');
    expect(pauseLine).toContain('Resume');
  });
});

describe('the Profile Health ring (still used on the admin supplier page) is one conic-gradient element', () => {
  it('has no percentage-conditional branch', () => {
    expect(ringSource).not.toContain('percentage > 0');
  });

  it('renders one .health-ring element with the percentage text as its real child', () => {
    expect(ringSource).toContain('class="health-ring"');
    expect(ringSource).toContain('class="health-ring-value"');
    expect(ringSource).not.toContain('<svg');
  });

  it('is not loaded on the supplier dashboard, whose completeness comes from the summary', () => {
    expect(html).not.toContain('profile-health-widget');
    expect(html).not.toContain('id="profile-completeness-widget"');
  });
});

describe('the visits chart', () => {
  it('is one chart with honest labels: visits, page loads, and the window the server served', () => {
    expect(html.match(/id="supplier-performance-chart"/g)).toHaveLength(1);
    expect(homeSource).toContain('Counts page loads, not people.');
    expect(homeSource).toContain('views.days');
  });

  it('draws only when the server sent a daily series, and never invents one', () => {
    expect(homeSource).toContain('views.daily.length >= 2');
    expect(homeSource).not.toContain('Math.random');
  });
});
