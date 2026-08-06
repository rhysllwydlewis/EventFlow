'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('dashboard skeleton compatibility layer', () => {
  const entry = read('public/assets/css/dashboard-overhaul.css');
  const base = read('public/assets/css/dashboard-overhaul-base.css');

  it('preserves the existing dashboard overhaul behind the skeleton entry point', () => {
    expect(entry).toContain("@import url('/assets/css/skeleton.css?v=2.0.0')");
    expect(entry).toContain("@import url('/assets/css/dashboard-overhaul-base.css?v=18.4.2')");
    expect(base).toContain('.supplier-dashboard-page');
    expect(base).toContain('.customer-dashboard-page');
    expect(base).toContain('.kpi-grid');
  });

  it('replaces customer dashboard slabs with widget-shaped placeholders', () => {
    expect(entry).toContain('#customer-event-countdown > .skeleton:only-child');
    expect(entry).toContain('#customer-budget-kpis:has(> .skeleton:only-child)');
    expect(entry).toContain('#customer-milestones-widget > .skeleton:only-child');
  });

  it('adds internal hierarchy to supplier KPI and availability placeholders', () => {
    expect(entry).toContain('#supplier-kpi-grid > .skeleton');
    expect(entry).toContain('#supplier-availability-widget > .skeleton:only-child');
  });
});
