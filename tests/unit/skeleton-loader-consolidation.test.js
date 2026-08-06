'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('canonical skeleton loader contract', () => {
  const loader = read('public/assets/js/utils/skeleton-loader.js');
  const css = read('public/assets/css/skeleton.css');

  it('provides page-shaped presets for the main asynchronous surfaces', () => {
    [
      'supplierCard',
      'packageCard',
      'eventCard',
      'guideCard',
      'galleryTile',
      'conversationRow',
      'ticketRow',
      'dashboardKpi',
      'tableRow',
      'supplierProfile',
    ].forEach(preset => expect(loader).toContain(`${preset}:`));
  });

  it('keeps legacy named exports during migration', () => {
    [
      'getSupplierCardSkeletons',
      'getListItemSkeletons',
      'getSearchResultSkeletons',
      'getStatCardSkeletons',
      'showLoadingSpinner',
      'showEmptyState',
      'showErrorState',
    ].forEach(exportName => expect(loader).toContain(`export function ${exportName}`));
  });

  it('supports deterministic visual inspection mode', () => {
    expect(loader).toContain("get('skeletonDebug') === '1'");
    expect(loader).toContain("document.documentElement.classList.add('skeleton-debug')");
    expect(css).toContain('html.skeleton-debug');
    expect(css).toContain("[data-skeleton-state='loading'] {\n  position: relative;");
  });

  it('sets and clears accessible loading state attributes', () => {
    expect(loader).toContain("setAttribute('aria-busy', 'true')");
    expect(loader).toContain("setAttribute('data-skeleton-state', 'loading')");
    expect(loader).toContain("removeAttribute('aria-busy')");
    expect(loader).toContain("removeAttribute('data-skeleton-state')");
  });

  it('escapes user-facing empty and error state content', () => {
    expect(loader).toContain('escapeHtml(title)');
    expect(loader).toContain('escapeHtml(description)');
    expect(loader).toContain('escapeAttribute(actionHref');
    expect(loader).not.toContain('id="error-action-btn"');
  });

  it('has colour fallbacks, progressive enhancement and reduced motion', () => {
    expect(css).toContain('--skeleton-base: #e5ebef');
    expect(css).toContain('--skeleton-highlight: #f7f9fa');
    expect(css).toContain('@supports (color: color-mix');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('does not override EventFlow light mode from the operating-system preference', () => {
    expect(css).not.toContain('@media (prefers-color-scheme: dark)');
  });
});

describe('legacy skeleton compatibility', () => {
  const compatibilityCss = read('public/assets/css/loading-skeleton.css');
  const guides = read('public/guides.html');

  it('routes the old stylesheet through the canonical implementation', () => {
    expect(compatibilityCss).toContain("@import url('/assets/css/skeleton.css?v=2.0.0')");
  });

  it('supports the Guides legacy skeleton-grid markup', () => {
    expect(guides).toContain('class="skeleton-grid"');
    expect(guides).toContain('loading-skeleton.css');
    expect(compatibilityCss).toContain('.skeleton-grid');
  });
});

describe('priority public route migration', () => {
  const eventDetail = read('public/event-detail.html');

  it('renders a page-shaped event detail skeleton without raw loading copy', () => {
    expect(eventDetail).toContain('/assets/css/skeleton.css?v=2.0.0');
    expect(eventDetail).toContain('class="skeleton-event-detail"');
    expect(eventDetail).toContain('skeleton-event-detail__media');
    expect(eventDetail).not.toContain('Loading event…');
    expect(eventDetail).not.toContain('<div class="event-body">Loading…</div>');
  });
});
