/**
 * Tests for dashboard widget enhancements
 * Validates timestamps, attachment indicators, search, and filter functionality
 */

const fs = require('fs');
const path = require('path');

// Guard hoisted files removed in Messenger v4 migration (Phase 7)
const customerMsgJsPath = path.join(process.cwd(), 'public/assets/js/customer-messages.js');
const customerMsgJsExists = fs.existsSync(customerMsgJsPath);
const customerMessagesJs = customerMsgJsExists ? fs.readFileSync(customerMsgJsPath, 'utf8') : '';

const supplierMsgJsPath = path.join(process.cwd(), 'public/assets/js/supplier-messages.js');
const supplierMsgJsExists = fs.existsSync(supplierMsgJsPath);
const supplierMessagesJs = supplierMsgJsExists ? fs.readFileSync(supplierMsgJsPath, 'utf8') : '';

(customerMsgJsExists ? describe : describe.skip)('Dashboard Widget Enhancements - Customer', () => {
  describe('customer-messages.js helper functions', () => {
    it('includes formatTimeAgo helper function', () => {
      expect(customerMessagesJs).toContain('function formatTimeAgo(timestamp)');
    });

    it('formats time as relative strings', () => {
      const formatFn = customerMessagesJs
        .split('function formatTimeAgo(timestamp)')[1]
        .split('function ')[0];

      expect(formatFn).toContain("return 'Just now'");
      expect(formatFn).toContain('return `${diffMins}m ago`');
      expect(formatFn).toContain('return `${diffHours}h ago`');
      expect(formatFn).toContain('return `${diffDays}d ago`');
    });

    it('formats old timestamps as dates', () => {
      const formatFn = customerMessagesJs
        .split('function formatTimeAgo(timestamp)')[1]
        .split('function ')[0];

      expect(formatFn).toContain("toLocaleDateString('en-GB'");
      expect(formatFn).toContain("{ day: 'numeric', month: 'short' }");
    });

    it('includes truncate helper function', () => {
      expect(customerMessagesJs).toContain('function truncate(text, maxLength)');
    });

    it('truncates text with ellipsis', () => {
      const truncateFn = customerMessagesJs
        .split('function truncate(text, maxLength)')[1]
        .split('function ')[0];

      expect(truncateFn).toContain("return text.substring(0, maxLength) + '...'");
    });
  });

  describe('renderConversations with timestamps', () => {
    it('uses formatTimeAgo for timestamps', () => {
      const renderFn = customerMessagesJs
        .split('function renderConversations(conversations, currentUser)')[1]
        .split('function ')[0];

      expect(renderFn).toContain('formatTimeAgo(conversation.lastMessageTime)');
    });

    it('gets attachment count from conversation', () => {
      const renderFn = customerMessagesJs
        .split('function renderConversations(conversations, currentUser)')[1]
        .split('function ')[0];

      expect(renderFn).toContain('const attachmentCount = conversation.attachmentCount || 0');
    });

    it('displays attachment indicator when files present', () => {
      const renderFn = customerMessagesJs
        .split('function renderConversations(conversations, currentUser)')[1]
        .split('function ')[0];

      expect(renderFn).toContain('attachmentCount > 0');
      expect(renderFn).toContain('<svg width="12" height="12"');
      expect(renderFn).toContain("${attachmentCount} ${attachmentCount === 1 ? 'file' : 'files'}");
    });

    it('shows paperclip icon for attachments', () => {
      const renderFn = customerMessagesJs
        .split('function renderConversations(conversations, currentUser)')[1]
        .split('function ')[0];

      // Check for paperclip SVG path
      expect(renderFn).toContain('m21.44 11.05-9.19 9.19');
    });
  });

  describe('search and filter functionality', () => {
    it('includes setupSearchAndFilter function', () => {
      expect(customerMessagesJs).toContain('function setupSearchAndFilter(getConversations, user)');
    });

    it('attaches input event to search box', () => {
      const setupFn = customerMessagesJs
        .split('function setupSearchAndFilter(getConversations, user)')[1]
        .split('function ')[0];

      expect(setupFn).toContain("getElementById('widget-search-input')");
      expect(setupFn).toContain("addEventListener('input',");
    });

    it('attaches change event to filter dropdown', () => {
      const setupFn = customerMessagesJs
        .split('function setupSearchAndFilter(getConversations, user)')[1]
        .split('function ')[0];

      expect(setupFn).toContain("getElementById('widget-filter-select')");
      expect(setupFn).toContain("addEventListener('change',");
    });

    it('includes applyFilters function', () => {
      expect(customerMessagesJs).toContain('function applyFilters(conversations, user)');
    });

    it('filters by search query', () => {
      const applyFn = customerMessagesJs
        .split('function applyFilters(conversations, user)')[1]
        .split('function ')[0];

      expect(applyFn).toContain('const searchQuery');
      expect(applyFn).toContain('.toLowerCase()');
      expect(applyFn).toContain('name.includes(searchQuery)');
      expect(applyFn).toContain('lastMessage.includes(searchQuery)');
    });

    it('filters by unread status', () => {
      const applyFn = customerMessagesJs
        .split('function applyFilters(conversations, user)')[1]
        .split('function ')[0];

      expect(applyFn).toContain("filterValue === 'unread'");
      expect(applyFn).toContain('(conv.unreadCount || 0) > 0');
    });

    it('filters by starred status', () => {
      const applyFn = customerMessagesJs
        .split('function applyFilters(conversations, user)')[1]
        .split('function ')[0];

      expect(applyFn).toContain("filterValue === 'starred'");
      expect(applyFn).toContain('conv.isStarred === true');
    });

    it('calls applyFilters from init function', () => {
      const initFn = customerMessagesJs
        .split('async function init()')[1]
        .split('async function')[0];

      expect(initFn).toContain('applyFilters(allConversations, user)');
    });
  });
});

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
