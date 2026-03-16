/**
 * Unit tests for lead quality filter and sort logic
 * Tests the supplier-messages.js helper functions via file content inspection
 * and the lead-quality-helper.js logic patterns.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── supplier-messages.js content tests ──────────────────────────────────────

const supplierMsgPath = path.join(process.cwd(), 'public/assets/js/supplier-messages.js');
const supplierMsgContent = fs.readFileSync(supplierMsgPath, 'utf8');

describe('supplier-messages.js – lead quality filter/sort', () => {
  describe('getLeadQualityMeta', () => {
    it('is defined', () => {
      expect(supplierMsgContent).toContain('function getLeadQualityMeta(conv)');
    });

    it('maps "High" leadScore string to green color', () => {
      // QUALITY_MAP defined at module level with these values
      expect(supplierMsgContent).toContain("label: 'High'");
      expect(supplierMsgContent).toContain('#10b981');
    });

    it('maps "Medium" leadScore string to amber color', () => {
      expect(supplierMsgContent).toContain("label: 'Medium'");
      expect(supplierMsgContent).toContain('#f59e0b');
    });

    it('maps "Low" leadScore string to red color', () => {
      expect(supplierMsgContent).toContain("label: 'Low'");
      expect(supplierMsgContent).toContain('#ef4444');
    });

    it('falls back to numeric leadScoreRaw when leadScore absent', () => {
      const fn = supplierMsgContent
        .split('function getLeadQualityMeta(conv)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain('conv.leadScoreRaw');
      expect(fn).toContain('>= 60');
    });

    it('returns null when no quality data present', () => {
      const fn = supplierMsgContent
        .split('function getLeadQualityMeta(conv)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain('return null');
    });
  });

  describe('renderLeadQualityBadge', () => {
    it('is defined', () => {
      expect(supplierMsgContent).toContain('function renderLeadQualityBadge(conv)');
    });

    it('uses getLeadQualityMeta internally', () => {
      const fn = supplierMsgContent
        .split('function renderLeadQualityBadge(conv)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain('getLeadQualityMeta(conv)');
    });

    it('returns empty string when no quality meta', () => {
      const fn = supplierMsgContent
        .split('function renderLeadQualityBadge(conv)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("return ''");
    });

    it('includes aria-label for accessibility', () => {
      const fn = supplierMsgContent
        .split('function renderLeadQualityBadge(conv)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain('aria-label');
      expect(fn).toContain('Lead quality:');
    });

    it('uses escapeHtml to prevent XSS', () => {
      const fn = supplierMsgContent
        .split('function renderLeadQualityBadge(conv)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain('escapeHtml');
    });
  });

  describe('applyFiltersSupplier', () => {
    it('is defined', () => {
      expect(supplierMsgContent).toContain(
        'function applyFiltersSupplier(conversations, supplierProfile, user)'
      );
    });

    it('reads from widget-filter-select-supplier element', () => {
      const fn = supplierMsgContent
        .split('function applyFiltersSupplier(conversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("getElementById('widget-filter-select-supplier')");
    });

    it('reads from widget-sort-select-supplier element', () => {
      const fn = supplierMsgContent
        .split('function applyFiltersSupplier(conversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("getElementById('widget-sort-select-supplier')");
    });

    it('filters by search query on customer name', () => {
      const fn = supplierMsgContent
        .split('function applyFiltersSupplier(conversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain('const searchQuery');
      expect(fn).toContain('conv.customerName');
      expect(fn).toContain('name.includes(searchQuery)');
    });

    it('supports "high" quality filter value', () => {
      const fn = supplierMsgContent
        .split('function applyFiltersSupplier(conversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("filterValue === 'high'");
    });

    it('supports "medium" quality filter value', () => {
      const fn = supplierMsgContent
        .split('function applyFiltersSupplier(conversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("filterValue === 'medium'");
    });

    it('supports "low" quality filter value', () => {
      const fn = supplierMsgContent
        .split('function applyFiltersSupplier(conversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("filterValue === 'low'");
    });

    it('supports "unread" filter value', () => {
      const fn = supplierMsgContent
        .split('function applyFiltersSupplier(conversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("filterValue === 'unread'");
    });

    it('supports "score-high" sort option', () => {
      const fn = supplierMsgContent
        .split('function applyFiltersSupplier(conversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("sortValue === 'score-high'");
    });

    it('supports "score-low" sort option', () => {
      const fn = supplierMsgContent
        .split('function applyFiltersSupplier(conversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("sortValue === 'score-low'");
    });

    it('supports "oldest" sort option', () => {
      const fn = supplierMsgContent
        .split('function applyFiltersSupplier(conversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("sortValue === 'oldest'");
    });

    it('defaults to newest sort', () => {
      const fn = supplierMsgContent
        .split('function applyFiltersSupplier(conversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("'newest'");
    });

    it('returns empty array for null input', () => {
      const fn = supplierMsgContent
        .split('function applyFiltersSupplier(conversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain('return []');
    });
  });

  describe('setupSearchAndFilterSupplier', () => {
    it('is defined', () => {
      expect(supplierMsgContent).toContain(
        'function setupSearchAndFilterSupplier(getConversations, supplierProfile, user)'
      );
    });

    it('attaches input event to search box', () => {
      const fn = supplierMsgContent
        .split('function setupSearchAndFilterSupplier(getConversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("getElementById('widget-search-input-supplier')");
      expect(fn).toContain("addEventListener('input',");
    });

    it('attaches change event to filter dropdown', () => {
      const fn = supplierMsgContent
        .split('function setupSearchAndFilterSupplier(getConversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("getElementById('widget-filter-select-supplier')");
      expect(fn).toContain("addEventListener('change',");
    });

    it('attaches change event to sort dropdown', () => {
      const fn = supplierMsgContent
        .split('function setupSearchAndFilterSupplier(getConversations, supplierProfile, user)')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain("getElementById('widget-sort-select-supplier')");
      expect(fn).toContain("addEventListener('change',");
    });
  });

  describe('getLeadQualitySummary', () => {
    it('is defined', () => {
      expect(supplierMsgContent).toContain('function getLeadQualitySummary(conversations)');
    });

    it('returns zero counts for empty array', () => {
      const fn = supplierMsgContent
        .split('function getLeadQualitySummary(conversations)')[1]
        .split(/\nexport /)[0];
      expect(fn).toContain('total: 0');
      expect(fn).toContain('high: 0');
    });

    it('computes highPercent', () => {
      const fn = supplierMsgContent
        .split('function getLeadQualitySummary(conversations)')[1]
        .split(/\nexport /)[0];
      expect(fn).toContain('highPercent');
    });
  });

  describe('renderConversations', () => {
    it('is defined', () => {
      expect(supplierMsgContent).toContain(
        'function renderConversations(conversations, supplierProfile'
      );
    });

    it('calls formatTimeAgo for timestamp', () => {
      const fn = supplierMsgContent
        .split('function renderConversations(conversations, supplierProfile')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain('formatTimeAgo(conversation.lastMessageTime');
    });

    it('reads attachmentCount from conversation', () => {
      const fn = supplierMsgContent
        .split('function renderConversations(conversations, supplierProfile')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain('const attachmentCount = conversation.attachmentCount || 0');
    });

    it('shows attachment indicator with count', () => {
      const fn = supplierMsgContent
        .split('function renderConversations(conversations, supplierProfile')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain('attachmentCount > 0');
      expect(fn).toContain("${attachmentCount} ${attachmentCount === 1 ? 'file' : 'files'}");
    });

    it('calls renderLeadQualityBadge per conversation', () => {
      const fn = supplierMsgContent
        .split('function renderConversations(conversations, supplierProfile')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain('renderLeadQualityBadge(conversation)');
    });

    it('returns no-data message for empty list', () => {
      const fn = supplierMsgContent
        .split('function renderConversations(conversations, supplierProfile')[1]
        .split(/\nfunction /)[0];
      expect(fn).toContain('No conversations yet');
    });
  });
});

// ─── Dashboard HTML – filter/sort controls ───────────────────────────────────

describe('dashboard-supplier.html – lead quality controls', () => {
  const html = `${fs.readFileSync(
    path.join(process.cwd(), 'public/dashboard-supplier.html'),
    'utf8'
  )}\n${fs.readFileSync(
    path.join(process.cwd(), 'public/assets/js/pages/dashboard-supplier-module.js'),
    'utf8'
  )}`;

  it('has lead quality High filter option', () => {
    expect(html).toContain('<option value="high">High Quality</option>');
  });

  it('has lead quality Medium filter option', () => {
    expect(html).toContain('<option value="medium">Medium Quality</option>');
  });

  it('has lead quality Low filter option', () => {
    expect(html).toContain('<option value="low">Low Quality</option>');
  });

  it('retains All/Unread/Starred options', () => {
    expect(html).toContain('<option value="all">All</option>');
    expect(html).toContain('<option value="unread">Unread</option>');
    expect(html).toContain('<option value="starred">Starred</option>');
  });

  it('has sort dropdown', () => {
    expect(html).toContain('id="widget-sort-select-supplier"');
    expect(html).toContain('<option value="newest">Newest</option>');
    expect(html).toContain('<option value="score-high">Lead Score ↑</option>');
  });

  it('has conversion funnel widget container', () => {
    expect(html).toContain('id="supplier-conversion-funnel"');
  });

  it('has response time widget container', () => {
    expect(html).toContain('id="supplier-response-time"');
  });

  it('imports createConversionFunnelWidget', () => {
    expect(html).toContain('createConversionFunnelWidget');
  });

  it('imports createResponseTimeWidget', () => {
    expect(html).toContain('createResponseTimeWidget');
  });
});

// ─── supplier-analytics-chart.js – new widgets ───────────────────────────────

describe('supplier-analytics-chart.js – conversion funnel + response time', () => {
  const chartJs = fs.readFileSync(
    path.join(process.cwd(), 'public/assets/js/supplier-analytics-chart.js'),
    'utf8'
  );

  describe('createConversionFunnelWidget', () => {
    it('is exported', () => {
      expect(chartJs).toContain('export async function createConversionFunnelWidget(containerId');
    });

    it('shows "Not enough data yet" empty state', () => {
      expect(chartJs).toContain('Not enough data yet');
    });

    it('fetches analytics from supplier analytics API', () => {
      const fn = chartJs
        .split('export async function createConversionFunnelWidget(containerId')[1]
        .split('export async function ')[0];
      expect(fn).toContain('/api/supplier/analytics');
    });

    it('renders Views, Enquiries, Replies funnel steps', () => {
      const fn = chartJs
        .split('export async function createConversionFunnelWidget(containerId')[1]
        .split('export async function ')[0];
      expect(fn).toContain('Profile Views');
      expect(fn).toContain('Enquiries');
      expect(fn).toContain('Replies');
    });

    it('shows loading skeleton', () => {
      const fn = chartJs
        .split('export async function createConversionFunnelWidget(containerId')[1]
        .split('export async function ')[0];
      expect(fn).toContain('skeleton');
    });

    it('handles fetch error gracefully', () => {
      const fn = chartJs
        .split('export async function createConversionFunnelWidget(containerId')[1]
        .split('export async function ')[0];
      expect(fn).toContain('catch (error)');
      expect(fn).toContain('Unable to load');
    });
  });

  describe('createResponseTimeWidget', () => {
    it('is exported', () => {
      expect(chartJs).toContain('export async function createResponseTimeWidget(containerId');
    });

    it('shows "Not enough data yet" empty state', () => {
      const fn = chartJs
        .split('export async function createResponseTimeWidget(containerId')[1]
        .split('export default')[0];
      expect(fn).toContain('Not enough data yet');
    });

    it('displays avg response time', () => {
      const fn = chartJs
        .split('export async function createResponseTimeWidget(containerId')[1]
        .split('export default')[0];
      expect(fn).toContain('Avg Response Time');
    });

    it('displays response rate', () => {
      const fn = chartJs
        .split('export async function createResponseTimeWidget(containerId')[1]
        .split('export default')[0];
      expect(fn).toContain('Response Rate');
    });

    it('handles fetch error gracefully', () => {
      const fn = chartJs
        .split('export async function createResponseTimeWidget(containerId')[1]
        .split('export default')[0];
      expect(fn).toContain('catch (error)');
      expect(fn).toContain('Unable to load');
    });
  });
});

// ─── MessengerWidgetV4.js – lead quality badges ──────────────────────────────

describe('MessengerWidgetV4.js – lead quality badge rendering', () => {
  const widgetJs = fs.readFileSync(
    path.join(process.cwd(), 'public/messenger/js/MessengerWidgetV4.js'),
    'utf8'
  );

  it('defines renderLeadQualityBadge helper', () => {
    expect(widgetJs).toContain('function renderLeadQualityBadge(conv)');
  });

  it('renders badge in _renderItem', () => {
    const fn = widgetJs.split('_renderItem(conv)')[1].split('_renderQuickReplyPanel')[0];
    expect(fn).toContain('renderLeadQualityBadge(conv)');
  });

  it('badge includes aria-label for accessibility', () => {
    const fn = widgetJs.split('function renderLeadQualityBadge(conv)')[1].split(/\n {2}\/\/ /)[0];
    expect(fn).toContain('aria-label');
    expect(fn).toContain('Lead quality:');
  });

  it('uses escapeHtml to prevent XSS', () => {
    const fn = widgetJs.split('function renderLeadQualityBadge(conv)')[1].split(/\n {2}\/\/ /)[0];
    expect(fn).toContain('escapeHtml');
  });

  it('returns empty string when no quality data', () => {
    const fn = widgetJs.split('function renderLeadQualityBadge(conv)')[1].split(/\n {2}\/\/ /)[0];
    expect(fn).toContain("return ''");
  });

  it('defines _applyClientFilters method', () => {
    expect(widgetJs).toContain('_applyClientFilters(conversations)');
  });

  it('_applyClientFilters filters by "high" quality', () => {
    const fn = widgetJs.split('_applyClientFilters(conversations)')[1].split('_render()')[0];
    expect(fn).toContain("filterValue === 'high'");
    expect(fn).toContain("leadScore === 'High'");
  });

  it('_applyClientFilters filters by "medium" quality', () => {
    const fn = widgetJs.split('_applyClientFilters(conversations)')[1].split('_render()')[0];
    expect(fn).toContain("filterValue === 'medium'");
  });

  it('_applyClientFilters filters by "low" quality', () => {
    const fn = widgetJs.split('_applyClientFilters(conversations)')[1].split('_render()')[0];
    expect(fn).toContain("filterValue === 'low'");
  });

  it('_applyClientFilters supports score-high and score-low sort', () => {
    const fn = widgetJs.split('_applyClientFilters(conversations)')[1].split('_render()')[0];
    expect(fn).toContain("sortValue === 'score-high'");
    expect(fn).toContain("sortValue === 'score-low'");
  });

  it('_applyClientFilters is called inside _render', () => {
    // Check that _render calls _applyClientFilters
    expect(widgetJs).toContain('_applyClientFilters(this.conversations)');
  });

  it('defines _setupExternalControls method', () => {
    expect(widgetJs).toContain('_setupExternalControls()');
  });

  it('_setupExternalControls listens to filter, sort and search controls', () => {
    // Split on the method definition, not the call site
    const fn = widgetJs
      .split('_setupExternalControls() {')[1]
      .split('_applyClientFilters(conversations)')[0];
    expect(fn).toContain('this._filterSelectId');
    expect(fn).toContain('this._sortSelectId');
    expect(fn).toContain('this._searchInputId');
    expect(fn).toContain("addEventListener('change'");
    expect(fn).toContain("addEventListener('input'");
  });

  it('supports onRendered callback option', () => {
    expect(widgetJs).toContain('onRendered');
    expect(widgetJs).toContain('this._onRendered');
  });

  it('calls _setupExternalControls in _init', () => {
    const fn = widgetJs.split('async _init()')[1].split('_resolveCurrentUserId')[0];
    expect(fn).toContain('_setupExternalControls()');
  });
});

// ─── dashboard-supplier.html – date range selector + summary stats ────────────

describe('dashboard-supplier.html – ROI widgets date range + summary stats', () => {
  const html = `${fs.readFileSync(
    path.join(process.cwd(), 'public/dashboard-supplier.html'),
    'utf8'
  )}\n${fs.readFileSync(
    path.join(process.cwd(), 'public/assets/js/pages/dashboard-supplier-module.js'),
    'utf8'
  )}\n${fs.readFileSync(
    path.join(process.cwd(), 'public/assets/js/pages/dashboard-supplier-threads.js'),
    'utf8'
  )}`;

  it('has date range selector for ROI analytics widgets', () => {
    expect(html).toContain('id="roi-date-range"');
  });

  it('date range selector has 7/30/90 day options', () => {
    expect(html).toContain('<option value="7">Last 7 days</option>');
    expect(html).toContain('<option value="30" selected>Last 30 days</option>');
    expect(html).toContain('<option value="90">Last 90 days</option>');
  });

  it('wires date range change to refresh ROI widgets', () => {
    expect(html).toContain('roi-date-range');
    expect(html).toContain("createConversionFunnelWidget('supplier-conversion-funnel'");
    expect(html).toContain("createResponseTimeWidget('supplier-response-time'");
  });

  it('has lead quality summary stats container', () => {
    expect(html).toContain('id="lead-quality-summary-stats"');
  });

  it('summary stats shows high/medium/low counts', () => {
    expect(html).toContain('id="lqs-high-text"');
    expect(html).toContain('id="lqs-medium-text"');
    expect(html).toContain('id="lqs-low-text"');
  });

  it('summary stats shows high-quality percentage', () => {
    expect(html).toContain('id="lqs-pct"');
    expect(html).toContain('high-quality leads');
  });

  it('uses onRendered callback to populate summary stats', () => {
    expect(html).toContain('onRendered: function');
    expect(html).toContain('lead-quality-summary-stats');
  });
});
