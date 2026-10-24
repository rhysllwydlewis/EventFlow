/**
 * Unit tests for lead quality filter and sort logic
 * Tests the MessengerWidgetV4 lead quality badges and the lead-quality-helper.js logic patterns.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Dashboard HTML – filter/sort controls ───────────────────────────────────

// ─── supplier-analytics-chart.js – new widgets ───────────────────────────────

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

  it('_init resolves current user before fetching conversations', () => {
    const fn = widgetJs.split('async _init()')[1].split('_setupWebSocket()')[0];
    expect(fn).toContain('await this._ensureCurrentUserId()');
    expect(fn).toContain('await this._fetchConversations()');
  });

  it('defines _ensureCurrentUserId with AuthStateManager init fallback', () => {
    const fn = widgetJs.split('async _ensureCurrentUserId()')[1].split('destroy()')[0];
    expect(fn).toContain('window.AuthStateManager.init');
    expect(fn).toContain("fetch('/api/v1/auth/me'");
  });
});

// ─── dashboard-supplier.html – date range selector + summary stats ────────────
