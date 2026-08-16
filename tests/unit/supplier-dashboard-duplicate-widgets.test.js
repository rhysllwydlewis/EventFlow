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
const analyticsSource = fs.readFileSync(
  path.join(root, 'public/assets/js/supplier-analytics-chart.js'),
  'utf8'
);

const performanceChartStart = analyticsSource.indexOf(
  'export async function createPerformanceChart'
);
const performanceChartEnd = analyticsSource.indexOf(
  '/**\n * Fetch analytics data for a specific period',
  performanceChartStart
);
const performanceChartSource = analyticsSource.slice(performanceChartStart, performanceChartEnd);

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

describe('the Profile Health ring renders as a single conic-gradient element, not an SVG', () => {
  it('has no percentage-conditional branch — the old SVG stroke-linecap:round drew a stray dot at 0% and needed one; a conic-gradient does not', () => {
    expect(ringSource).not.toContain('percentage > 0');
  });

  it('renders one .health-ring element with the percentage text as its real child, not a separately-positioned sibling', () => {
    expect(ringSource).toContain('class="health-ring"');
    expect(ringSource).toContain('class="health-ring-value"');
    expect(ringSource).not.toContain('<svg');
  });
});

describe('analytics period controls remain usable when the initial period is empty', () => {
  it('keeps both the chart canvas and empty state available instead of returning early', () => {
    expect(performanceChartStart).toBeGreaterThanOrEqual(0);
    expect(performanceChartEnd).toBeGreaterThan(performanceChartStart);
    expect(performanceChartSource).toContain('class="chart-container"');
    expect(performanceChartSource).toContain('class="sd-empty-state sd-chart-empty"');
    expect(performanceChartSource).toContain('await createAnalyticsChart(canvasId, chartData)');
    expect(performanceChartSource).not.toMatch(/if \(!hasAnyData\)[\s\S]*?return null;/);
  });

  it('wires the 7/30/90-day buttons before returning the chart instance', () => {
    const controlsIndex = performanceChartSource.indexOf(
      "container.querySelectorAll('.chart-period-btn')"
    );
    const returnIndex = performanceChartSource.lastIndexOf('return chart;');
    expect(controlsIndex).toBeGreaterThanOrEqual(0);
    expect(returnIndex).toBeGreaterThan(controlsIndex);
    expect(performanceChartSource).toContain('fetchAnalyticsData(period)');
  });

  it('switches between the empty state and the same live chart as period data changes', () => {
    expect(performanceChartSource).toContain('chartContainer.hidden = !currentHasData');
    expect(performanceChartSource).toContain('emptyState.hidden = currentHasData');
    expect(performanceChartSource).toContain('chart.data.labels = newData.labels');
    expect(performanceChartSource).toContain('chart.data.datasets[0].data = newData.views');
    expect(performanceChartSource).toContain('chart.data.datasets[1].data = newData.enquiries');
    expect(performanceChartSource).toContain("chart.update('active')");
  });
});
