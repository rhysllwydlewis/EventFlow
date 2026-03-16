/**
 * Customer dashboard security-oriented asset loading tests.
 * Mirrors tests/integration/dashboard-supplier-security-assets.test.js.
 */

const fs = require('fs');
const path = require('path');

describe('Dashboard customer security-oriented script loading', () => {
  let dashboardContent;
  let ticketsJs;

  beforeAll(() => {
    const pagesDir = path.resolve(__dirname, '..', '..', 'public', 'assets', 'js', 'pages');
    dashboardContent = `${fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'public', 'dashboard-customer.html'),
      'utf8'
    )}\n${fs.readFileSync(
      path.join(pagesDir, 'dashboard-customer-module.js'),
      'utf8'
    )}\n${fs.readFileSync(
      path.join(pagesDir, 'dashboard-customer-init.js'),
      'utf8'
    )}\n${fs.readFileSync(path.join(pagesDir, 'dashboard-customer-messenger.js'), 'utf8')}`;
    ticketsJs = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'public', 'assets', 'js', 'customer-tickets.js'),
      'utf8'
    );
  });

  it('uses local confetti script instead of jsdelivr CDN', () => {
    expect(dashboardContent).toContain('/assets/js/vendor/confetti-safe.js');
    expect(dashboardContent).not.toContain('canvas-confetti@1.9.2/dist/confetti.browser.min.js');
  });

  it('confetti-safe.js script has defer so it does not block page rendering', () => {
    // Extract the script tag for confetti-safe.js and verify it has a defer attribute.
    // The tag must be a <script> element with both the src and the standalone 'defer' attribute.
    const match = dashboardContent.match(/<script\s[^>]*confetti-safe\.js[^>]*>/);
    expect(match).not.toBeNull();
    // 'defer' must appear as a standalone attribute token (not inside a quoted value)
    expect(match[0]).toMatch(/\bdefer\b/);
  });

  it('has customer-dashboard-improvements.css linked', () => {
    expect(dashboardContent).toContain('customer-dashboard-improvements.css');
  });

  it('does not contain a legacy #threads-cust message section', () => {
    expect(dashboardContent).not.toContain('id="threads-cust"');
  });

  it('relies on MessengerWidgetV4 for conversations', () => {
    expect(dashboardContent).toContain('messenger-dashboard-widget');
    expect(dashboardContent).toContain('MessengerWidgetV4');
  });

  it('exposes initCustomerDashboardWidgets to global scope from module script', () => {
    expect(dashboardContent).toContain(
      'window.initCustomerDashboardWidgets = initCustomerDashboardWidgets'
    );
  });

  it('hero section stats use event listeners, not synchronous badge reads', () => {
    // hero-stat-messages must not be set from unreadMessageBadge text content synchronously.
    // It should instead be wired via addEventListener('unreadCountUpdated', ...).
    // We verify that the old synchronous pattern is absent and the event pattern is present.
    expect(dashboardContent).not.toContain("getElementById('unreadMessageBadge')");
    // Must use the event-driven update
    expect(dashboardContent).toContain('unreadCountUpdated');
  });

  it('stats grid Messages stat starts at 0 and uses event for real count', () => {
    // The stats grid must register the unread event listener
    expect(dashboardContent).toContain('onUnreadForStats');
  });

  it('budget priority is server-first then localStorage fallback', () => {
    // Priority 1 comment must reference server plan
    expect(dashboardContent).toContain('Priority 1: Server plan budget');
    // Priority 2 comment must reference localStorage
    expect(dashboardContent).toContain('Priority 2: localStorage fallback');
  });

  it('calendar shows empty state when CalendarView unavailable', () => {
    expect(dashboardContent).toContain('No events scheduled yet');
    expect(dashboardContent).toContain('Calendar could not be loaded');
  });

  it('aria-live regions are present on dynamic content containers', () => {
    expect(dashboardContent).toContain('id="customer-stats-grid" aria-live="polite"');
    expect(dashboardContent).toContain('id="customer-plans-list" aria-live="polite"');
    expect(dashboardContent).toContain('id="tickets-cust"');
    expect(dashboardContent).toMatch(/id="tickets-cust"[^>]*aria-live="polite"/);
  });

  it('customer-tickets.js renders a "View all" link when the display limit (5) is reached', () => {
    expect(ticketsJs).toContain('customer-tickets-view-all');
    expect(ticketsJs).toContain('tickets.length >= 5');
  });
});
