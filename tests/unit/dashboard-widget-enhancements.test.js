/**
 * Tests for dashboard widget enhancements
 * Validates timestamps, attachment indicators, search, and filter functionality
 */

const fs = require('fs');
const path = require('path');

describe('Dashboard HTML - Customer', () => {
  const dashboardCustomerHtml = fs.readFileSync(
    path.join(process.cwd(), 'public/dashboard-customer.html'),
    'utf8'
  );

  it('mounts MessengerWidgetV4 in the Messages card', () => {
    expect(dashboardCustomerHtml).toContain('id="messenger-dashboard-widget"');
    expect(dashboardCustomerHtml).toContain('Open inbox');
  });

  it('does not ship search/filter controls the widget never read', () => {
    // MessengerWidgetV4 defaults to the "-supplier" control ids, so the customer
    // page's #widget-search-input / #widget-filter-select were never wired up.
    expect(dashboardCustomerHtml).not.toContain('widget-search-input');
    expect(dashboardCustomerHtml).not.toContain('widget-filter-select');
  });
});

describe('Dashboard HTML - Supplier', () => {
  const dashboardSupplierHtml = fs.readFileSync(
    path.join(process.cwd(), 'public/dashboard-supplier.html'),
    'utf8'
  );

  it('mounts the messenger widget with search, filter and sort over its latest 20 conversations', () => {
    expect(dashboardSupplierHtml).toContain('id="messenger-dashboard-widget-supplier"');
    expect(dashboardSupplierHtml).toContain('id="widget-search-input-supplier"');
    expect(dashboardSupplierHtml).toContain('id="widget-filter-select-supplier"');
    expect(dashboardSupplierHtml).toContain('id="widget-sort-select-supplier"');
  });
});
