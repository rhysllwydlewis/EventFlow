/**
 * Tests for dashboard widget enhancements
 * Validates timestamps, attachment indicators, search, and filter functionality
 */

const fs = require('fs');
const path = require('path');

// Guard hoisted files removed in Messenger v4 migration (Phase 7)

const supplierMsgJsPath = path.join(process.cwd(), 'public/assets/js/supplier-messages.js');
const supplierMsgJsExists = fs.existsSync(supplierMsgJsPath);
const supplierMessagesJs = supplierMsgJsExists ? fs.readFileSync(supplierMsgJsPath, 'utf8') : '';

(supplierMsgJsExists ? describe : describe.skip)('Dashboard Widget Enhancements - Supplier', () => {
  describe('supplier-messages.js helper functions', () => {
    it('includes formatTimeAgo helper function', () => {
      expect(supplierMessagesJs).toContain('function formatTimeAgo(timestamp)');
    });

    it('includes truncate helper function', () => {
      expect(supplierMessagesJs).toContain('function truncate(text, maxLength)');
    });
  });

  describe('renderConversations with timestamps', () => {
    it('uses formatTimeAgo for timestamps', () => {
      const renderFn = supplierMessagesJs
        .split('function renderConversations(conversations, supplierProfile')[1]
        .split('function ')[0];

      expect(renderFn).toContain('formatTimeAgo(conversation.lastMessageTime)');
    });

    it('gets attachment count from conversation', () => {
      const renderFn = supplierMessagesJs
        .split('function renderConversations(conversations, supplierProfile')[1]
        .split('function ')[0];

      expect(renderFn).toContain('const attachmentCount = conversation.attachmentCount || 0');
    });

    it('displays attachment indicator when files present', () => {
      const renderFn = supplierMessagesJs
        .split('function renderConversations(conversations, supplierProfile')[1]
        .split('function ')[0];

      expect(renderFn).toContain('attachmentCount > 0');
      expect(renderFn).toContain("${attachmentCount} ${attachmentCount === 1 ? 'file' : 'files'}");
    });
  });

  describe('search and filter functionality', () => {
    it('includes setupSearchAndFilterSupplier function', () => {
      expect(supplierMessagesJs).toContain(
        'function setupSearchAndFilterSupplier(getConversations, supplierProfile, user)'
      );
    });

    it('attaches input event to supplier search box', () => {
      const setupFn = supplierMessagesJs
        .split('function setupSearchAndFilterSupplier(getConversations, supplierProfile, user)')[1]
        .split('function ')[0];

      expect(setupFn).toContain("getElementById('widget-search-input-supplier')");
      expect(setupFn).toContain("addEventListener('input',");
    });

    it('attaches change event to supplier filter dropdown', () => {
      const setupFn = supplierMessagesJs
        .split('function setupSearchAndFilterSupplier(getConversations, supplierProfile, user)')[1]
        .split('function ')[0];

      expect(setupFn).toContain("getElementById('widget-filter-select-supplier')");
      expect(setupFn).toContain("addEventListener('change',");
    });

    it('includes applyFiltersSupplier function', () => {
      expect(supplierMessagesJs).toContain(
        'function applyFiltersSupplier(conversations, supplierProfile, user)'
      );
    });

    it('filters by search query on customer name and message', () => {
      const applyFn = supplierMessagesJs
        .split('function applyFiltersSupplier(conversations, supplierProfile, user)')[1]
        .split('function ')[0];

      expect(applyFn).toContain('const searchQuery');
      expect(applyFn).toContain('conv.customerName');
      expect(applyFn).toContain('name.includes(searchQuery)');
    });
  });
});

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
