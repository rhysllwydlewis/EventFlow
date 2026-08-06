/**
 * EventFlow skeleton loader utilities.
 *
 * This module is the canonical source for loading, empty and error states.
 * It intentionally preserves the legacy named exports while adding reusable
 * page-shaped presets and a deterministic `?skeletonDebug=1` inspection mode.
 */

const DEFAULT_COUNT = 3;
const MAX_COUNT = 12;

function resolveContainer(container) {
  return typeof container === 'string' ? document.querySelector(container) : container;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function normaliseCount(value, fallback = DEFAULT_COUNT) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(MAX_COUNT, Math.max(1, parsed));
}

function repeatMarkup(count, renderer) {
  return Array.from({ length: normaliseCount(count) }, (_, index) => renderer(index)).join('');
}

function line(width = 'long', extraClass = '') {
  return `<span class="skeleton skeleton-text skeleton-text-${width} ${extraClass}" aria-hidden="true"></span>`;
}

function supplierCardSkeleton() {
  return `
    <article class="skeleton-card skeleton-supplier-card-full" aria-hidden="true">
      <div class="skeleton-supplier-header">
        <span class="skeleton skeleton-avatar-large"></span>
        <div class="skeleton-supplier-content">
          <span class="skeleton skeleton-title"></span>
          ${line('medium')}
        </div>
      </div>
      ${line('long')}
      ${line('medium')}
      <div class="skeleton-supplier-meta">
        ${line('short')}${line('short')}${line('short')}
      </div>
      <div class="skeleton-actions-row">
        <span class="skeleton skeleton-button"></span>
        <span class="skeleton skeleton-button"></span>
      </div>
    </article>`;
}

function packageCardSkeleton() {
  return `
    <article class="skeleton-card skeleton-package-card" aria-hidden="true">
      <span class="skeleton skeleton-media skeleton-media--package"></span>
      <div class="skeleton-card-body">
        <span class="skeleton skeleton-pill"></span>
        <span class="skeleton skeleton-title"></span>
        ${line('long')}
        ${line('medium')}
        <div class="skeleton-card-footer">
          ${line('short')}
          <span class="skeleton skeleton-button skeleton-button--compact"></span>
        </div>
      </div>
    </article>`;
}

function eventCardSkeleton() {
  return `
    <article class="skeleton-card skeleton-event-card" aria-hidden="true">
      <span class="skeleton skeleton-media skeleton-media--event"></span>
      <div class="skeleton-card-body">
        <span class="skeleton skeleton-pill"></span>
        <span class="skeleton skeleton-title"></span>
        ${line('long')}
        ${line('medium')}
        ${line('short')}
        <div class="skeleton-actions-row">
          <span class="skeleton skeleton-button skeleton-button--compact"></span>
          <span class="skeleton skeleton-button skeleton-button--compact"></span>
        </div>
      </div>
    </article>`;
}

function guideCardSkeleton() {
  return `
    <article class="skeleton-card skeleton-guide-card" aria-hidden="true">
      <span class="skeleton skeleton-media skeleton-media--guide"></span>
      <div class="skeleton-card-body">
        <span class="skeleton skeleton-pill"></span>
        <span class="skeleton skeleton-title"></span>
        ${line('long')}
        ${line('medium')}
      </div>
    </article>`;
}

function galleryTileSkeleton() {
  return `
    <article class="skeleton-card skeleton-gallery-tile" aria-hidden="true">
      <span class="skeleton skeleton-media skeleton-media--gallery"></span>
      <div class="skeleton-gallery-actions">
        <span class="skeleton skeleton-button skeleton-button--compact"></span>
        <span class="skeleton skeleton-button skeleton-button--compact"></span>
      </div>
    </article>`;
}

function listItemSkeleton() {
  return `
    <div class="skeleton-list-item" aria-hidden="true">
      <span class="skeleton skeleton-avatar"></span>
      <div class="skeleton-list-copy">
        ${line('medium')}
        ${line('short')}
      </div>
      <span class="skeleton skeleton-meta-chip"></span>
    </div>`;
}

function ticketRowSkeleton() {
  return `
    <div class="skeleton-list-item skeleton-ticket-row" aria-hidden="true">
      <div class="skeleton-list-copy">
        ${line('medium')}
        ${line('long')}
        ${line('short')}
      </div>
      <span class="skeleton skeleton-pill"></span>
    </div>`;
}

function statCardSkeleton() {
  return `
    <article class="skeleton-stat-card" aria-hidden="true">
      <span class="skeleton skeleton-stat-icon"></span>
      <div>
        <span class="skeleton skeleton-stat-number"></span>
        <span class="skeleton skeleton-stat-label"></span>
      </div>
    </article>`;
}

function tableRowSkeleton(columns = 6) {
  const safeColumns = Math.min(12, Math.max(1, Number.parseInt(columns, 10) || 6));
  return `<tr class="skeleton-table-row" aria-hidden="true">${repeatMarkup(
    safeColumns,
    () => `<td><span class="skeleton skeleton-table-cell"></span></td>`
  )}</tr>`;
}

function supplierProfileSkeleton() {
  return `
    <div class="skeleton-profile-page" aria-hidden="true">
      <section class="skeleton skeleton-profile-hero"></section>
      <div class="skeleton-profile-identity">
        <span class="skeleton skeleton-avatar-large skeleton-profile-avatar"></span>
        <div>${line('medium', 'skeleton-profile-title')}${line('short')}</div>
      </div>
      <div class="skeleton-profile-grid">
        <div class="skeleton-profile-main">
          <section class="skeleton-card">${line('medium')}${line('long')}${line('long')}${line('short')}</section>
          <section class="skeleton-gallery-grid">${repeatMarkup(4, galleryTileSkeleton)}</section>
          <section class="skeleton-grid skeleton-grid--packages">${repeatMarkup(2, packageCardSkeleton)}</section>
        </div>
        <aside class="skeleton-card skeleton-profile-sidebar">${line('medium')}${line('long')}${line('short')}<span class="skeleton skeleton-button"></span></aside>
      </div>
    </div>`;
}

export const skeletonPresets = Object.freeze({
  supplierCard: supplierCardSkeleton,
  packageCard: packageCardSkeleton,
  eventCard: eventCardSkeleton,
  guideCard: guideCardSkeleton,
  galleryTile: galleryTileSkeleton,
  listItem: listItemSkeleton,
  conversationRow: listItemSkeleton,
  ticketRow: ticketRowSkeleton,
  statCard: statCardSkeleton,
  dashboardKpi: statCardSkeleton,
  tableRow: tableRowSkeleton,
  supplierProfile: supplierProfileSkeleton,
});

/**
 * Return true when the deterministic skeleton inspection mode is active.
 */
export function isSkeletonDebugMode() {
  try {
    return new URLSearchParams(window.location.search).get('skeletonDebug') === '1';
  } catch (_) {
    return false;
  }
}

/**
 * Add a root class that allows CSS to visibly identify held skeleton states.
 */
export function initialiseSkeletonDebugMode() {
  if (typeof document !== 'undefined' && isSkeletonDebugMode()) {
    document.documentElement.classList.add('skeleton-debug');
    return true;
  }
  return false;
}

/**
 * Generate one or more placeholders from a named preset.
 */
export function getSkeleton(type, count = DEFAULT_COUNT, options = {}) {
  const renderer = skeletonPresets[type];
  if (!renderer) {
    throw new Error(`Unknown skeleton preset: ${type}`);
  }
  if (type === 'supplierProfile') {
    return renderer(options);
  }
  if (type === 'tableRow') {
    return repeatMarkup(count, () => renderer(options.columns));
  }
  return repeatMarkup(count, renderer);
}

// Legacy named helpers retained for existing imports.
export function getSupplierCardSkeleton() {
  return supplierCardSkeleton();
}

export function getSupplierCardSkeletons(count = DEFAULT_COUNT) {
  return getSkeleton('supplierCard', count);
}

export function getListItemSkeleton() {
  return listItemSkeleton();
}

export function getListItemSkeletons(count = 5) {
  return `<div class="skeleton-list">${getSkeleton('listItem', count)}</div>`;
}

export function getSearchResultSkeleton() {
  return eventCardSkeleton();
}

export function getSearchResultSkeletons(count = 5) {
  return getSkeleton('eventCard', count);
}

export function getStatCardSkeleton() {
  return statCardSkeleton();
}

export function getStatCardSkeletons(count = 4) {
  return `<div class="skeleton-stats-grid">${getSkeleton('statCard', count)}</div>`;
}

/**
 * Show a skeleton state. The second argument may be a preset name or legacy
 * HTML string. Named presets are preferred for new code.
 */
export function showSkeleton(container, typeOrHtml, options = {}) {
  const element = resolveContainer(container);
  if (!element) {
    return false;
  }

  const isPreset = typeof typeOrHtml === 'string' && Boolean(skeletonPresets[typeOrHtml]);
  const markup = isPreset
    ? getSkeleton(typeOrHtml, options.count || DEFAULT_COUNT, options)
    : String(typeOrHtml || getSkeleton('listItem', options.count || DEFAULT_COUNT));

  element.setAttribute('aria-busy', 'true');
  element.setAttribute('data-skeleton-state', 'loading');
  element.innerHTML = options.wrap === false ? markup : `<div class="${escapeAttribute(options.className || 'skeleton-grid')}">${markup}</div>`;
  return true;
}

/**
 * Replace a loading region with real markup unless debug mode is holding it.
 */
export function replaceSkeleton(container, html) {
  const element = resolveContainer(container);
  if (!element || isSkeletonDebugMode()) {
    return false;
  }
  element.innerHTML = String(html ?? '');
  element.removeAttribute('aria-busy');
  element.removeAttribute('data-skeleton-state');
  return true;
}

/**
 * Clear a loading region unless debug mode is holding it.
 */
export function clearSkeleton(container) {
  return replaceSkeleton(container, '');
}

/**
 * Legacy spinner helper. Prefer a page-shaped skeleton for primary content.
 */
export function showLoadingSpinner(container, message = 'Loading…') {
  const element = resolveContainer(container);
  if (!element) {
    return false;
  }
  element.setAttribute('aria-busy', 'true');
  element.innerHTML = `
    <div class="loading-container" role="status">
      <div class="loading-spinner" aria-hidden="true"></div>
      <div class="loading-text">${escapeHtml(message)}</div>
    </div>`;
  return true;
}

export function showEmptyState(container, options = {}) {
  const element = resolveContainer(container);
  if (!element || isSkeletonDebugMode()) {
    return false;
  }

  const {
    icon = '📭',
    title = 'Nothing here yet',
    description = '',
    actionText = '',
    actionHref = '',
  } = options;
  const actionHtml = actionText
    ? `<a href="${escapeAttribute(actionHref || '#')}" class="empty-state-action">${escapeHtml(actionText)}</a>`
    : '';

  element.innerHTML = `
    <div class="empty-state" role="status">
      <div class="empty-state-icon" aria-hidden="true">${escapeHtml(icon)}</div>
      <div class="empty-state-title">${escapeHtml(title)}</div>
      ${description ? `<div class="empty-state-description">${escapeHtml(description)}</div>` : ''}
      ${actionHtml}
    </div>`;
  element.removeAttribute('aria-busy');
  element.removeAttribute('data-skeleton-state');
  return true;
}

export function showErrorState(container, options = {}) {
  const element = resolveContainer(container);
  if (!element || isSkeletonDebugMode()) {
    return false;
  }

  const {
    icon = '⚠️',
    title = 'Something went wrong',
    description = 'Please try again later.',
    actionText = 'Try again',
    onAction = null,
  } = options;
  const actionHtml = actionText
    ? `<button class="ef-cta error-state-action" type="button" data-skeleton-retry>${escapeHtml(actionText)}</button>`
    : '';

  element.innerHTML = `
    <div class="error-state" role="alert">
      <div class="error-state-icon" aria-hidden="true">${escapeHtml(icon)}</div>
      <div class="error-state-title">${escapeHtml(title)}</div>
      <div class="error-state-description">${escapeHtml(description)}</div>
      ${actionHtml}
    </div>`;
  element.removeAttribute('aria-busy');
  element.removeAttribute('data-skeleton-state');

  if (typeof onAction === 'function') {
    element.querySelector('[data-skeleton-retry]')?.addEventListener('click', onAction, { once: true });
  }
  return true;
}

export function loadSkeletonCSS() {
  if (typeof document === 'undefined' || document.getElementById('skeleton-css')) {
    return;
  }
  const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(link =>
    /\/assets\/css\/skeleton\.css(?:\?|$)/.test(link.getAttribute('href') || '')
  );
  if (existing) {
    existing.id = existing.id || 'skeleton-css';
    return;
  }
  const link = document.createElement('link');
  link.id = 'skeleton-css';
  link.rel = 'stylesheet';
  link.href = '/assets/css/skeleton.css?v=2.0.0';
  document.head.appendChild(link);
}

loadSkeletonCSS();
initialiseSkeletonDebugMode();

export default {
  skeletonPresets,
  getSkeleton,
  getSupplierCardSkeleton,
  getSupplierCardSkeletons,
  getListItemSkeleton,
  getListItemSkeletons,
  getSearchResultSkeleton,
  getSearchResultSkeletons,
  getStatCardSkeleton,
  getStatCardSkeletons,
  showSkeleton,
  replaceSkeleton,
  clearSkeleton,
  showLoadingSpinner,
  showEmptyState,
  showErrorState,
  isSkeletonDebugMode,
  initialiseSkeletonDebugMode,
  loadSkeletonCSS,
};
