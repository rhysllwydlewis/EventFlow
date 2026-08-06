'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('dashboard skeleton compatibility layer', () => {
  const dashboardCss = read('public/assets/css/dashboard-overhaul.css');
  const skeletonCss = read('public/assets/css/skeleton.css');

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

  it('adds internal hierarchy to supplier KPI and availability placeholders', () => {
    expect(skeletonCss).toContain('#supplier-kpi-grid > .skeleton');
    expect(skeletonCss).toContain('#supplier-availability-widget > .skeleton:only-child');
  });
});
