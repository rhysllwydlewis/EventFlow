'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('dashboard skeleton compatibility layer', () => {
  const dashboardCss = read('public/assets/css/dashboard-overhaul.css');
  const skeletonCss = read('public/assets/css/skeleton.css');

  it('loads the repaired canonical stylesheet cache key on both dashboards', () => {
    expect(read('public/dashboard-customer.html')).toContain('/assets/css/skeleton.css?v=2.0.1');
    expect(read('public/dashboard-supplier.html')).toContain('/assets/css/skeleton.css?v=2.0.1');
  });

  it('keeps the existing dashboard overhaul in its original stylesheet', () => {
    expect(dashboardCss).toContain('.supplier-dashboard-page');
    expect(dashboardCss).toContain('.customer-dashboard-page');
    expect(dashboardCss).toContain('.kpi-grid');
    expect(dashboardCss).toContain('@keyframes dash-shimmer');
    expect(dashboardCss).not.toContain('dashboard-overhaul-base.css');
  });

  it('replaces customer dashboard slabs with scoped widget-shaped placeholders', () => {
    expect(skeletonCss).toContain('#customer-event-countdown > .skeleton:only-child');
    expect(skeletonCss).toContain('#customer-budget-kpis:has(> .skeleton:only-child)');
    expect(skeletonCss).toContain('#customer-milestones-widget > .skeleton:only-child');
  });

  it('adds internal hierarchy to the supplier availability placeholder', () => {
    // #supplier-kpi-grid was removed with the legacy KPI grid it skeletoned for
    // (dashboard-supplier-overhaul.js's renderKpiGrid duplicated #supplier-stats-grid,
    // which dashboard-supplier-module.js already renders from the same data).
    expect(skeletonCss).toContain('#supplier-availability-widget > .skeleton:only-child');
  });
});
