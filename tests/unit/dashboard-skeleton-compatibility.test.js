'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('dashboard skeleton compatibility layer', () => {
  const skeletonCss = read('public/assets/css/skeleton.css');

  it('loads the repaired canonical stylesheet cache key on both dashboards', () => {
    expect(read('public/dashboard-customer.html')).toContain('/assets/css/skeleton.css?v=2.1.1');
    expect(read('public/dashboard-supplier.html')).toContain('/assets/css/skeleton.css?v=2.1.1');
  });

  it('has no placeholders left for the customer widgets the redesigned dashboard removed', () => {
    expect(skeletonCss).not.toContain('#customer-event-countdown');
    expect(skeletonCss).not.toContain('#customer-budget-kpis');
    expect(skeletonCss).not.toContain('#customer-milestones-widget');
  });

  it('the supplier dashboard draws its own loading placeholders and no longer needs the old dashboard overhaul sheet', () => {
    const supplierHtml = read('public/dashboard-supplier.html');
    expect(supplierHtml).toContain('sdh-skel');
    expect(supplierHtml).not.toContain('dashboard-overhaul.css');
  });
});
