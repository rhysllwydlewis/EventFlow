/**
 * EventFlow skeleton loader utilities.
 *
 * This module is the canonical source for loading, empty and error states.
 * It intentionally preserves the legacy named exports while adding reusable
 * page-shaped presets and a deterministic `?skeletonDebug=1` inspection mode.
 */

const DEFAULT_COUNT = 3;
const MAX_COUNT = 12;

/**
 * Resolve a selector or return an existing container element.
 * @param {string|HTMLElement|null} container Selector or element.
 * @returns {HTMLElement|null} Resolved element.
 */
function resolveContainer(container) {
  return typeof container === 'string' ? document.querySelector(container) : container;
}

/**
 * Escape text before interpolation into trusted application-owned markup.
 * @param {*} value Value to escape.
 * @returns {string} HTML-safe text.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape a value for use inside a quoted HTML attribute.
 * @param {*} value Value to escape.
 * @returns {string} Attribute-safe text.
 */
function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

/**
 * Clamp a requested placeholder count to a safe rendering range.
 * @param {*} value Requested count.
 * @param {number} fallback Fallback count.
 * @returns {number} Normalized count between one and MAX_COUNT.
 */
function normaliseCount(value, fallback = DEFAULT_COUNT) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(MAX_COUNT, Math.max(1, parsed));
}

/**
 * Repeat trusted placeholder markup a bounded number of times.
 * @param {*} count Requested count.
 * @param {Function} renderer Markup factory.
 * @returns {string} Concatenated markup.
 */
function repeatMarkup(count, renderer) {
  return Array.from({ length: normaliseCount(count) }, () => renderer()).join('');
}

/**
 * Render one text-line placeholder.
 * @param {string} width Width modifier.
 * @param {string} extraClass Optional additional class.
 * @returns {string} Placeholder markup.
 */
function line(width = 'long', extraClass = '') {
  const className = [
    'skeleton',
    'skeleton-text',
    `skeleton-text-${width}`,
    extraClass,
  ]
    .filter(Boolean)
    .join(' ');
  return `<span class="${className}" aria-hidden="true"></span>`;
}

/**
 * Render a supplier-card placeholder matching the public results layout.
 * @returns {string} Placeholder markup.
 */
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

/**
 * Render a package-card placeholder.
 * @returns {string} Placeholder markup.
 */
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

/**
 * Render an event-card placeholder.
 * @returns {string} Placeholder markup.
 */
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

/**
 * Render a guide-card placeholder.
 * @returns {string} Placeholder markup.
 */
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

/**
 * Render a gallery-tile placeholder.
 * @returns {string} Placeholder markup.
 */
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

/**
 * Render a generic list or conversation row placeholder.
 * @returns {string} Placeholder markup.
 */
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

/**
 * Render a support-ticket row placeholder.
 * @returns {string} Placeholder markup.
 */
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

/**
 * Render a dashboard statistic placeholder.
 * @returns {string} Placeholder markup.
 */
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

/**
 * Render a table-row placeholder with a bounded number of columns.
 * @param {*} columns Requested column count.
 * @returns {string} Placeholder markup.
 */
function tableRowSkeleton(columns = 6) {
  const parsedColumns = Number.parseInt(columns, 10);
  const safeColumns = Number.isNaN(parsedColumns)
    ? 6
    : Math.min(12, Math.max(1, parsedColumns));
  return `<tr class="skeleton-table-row" aria-hidden="true">${repeatMarkup(
    safeColumns,
    () => '<td><span class="skeleton skeleton-table-cell"></span></td>'
  )}</tr>`;
}

/**
 * Render a complete supplier-profile page placeholder.
 * @returns {string} Placeholder markup.
 */
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
 * @returns {boolean} Whether debug mode is active.
 */
export function isSkeletonDebugMode() {
  if (typeof window === 'undefined') {
    return false;
  }
  return new URLSearchParams(window.location.search).get('skeletonDebug') === '1';
}

/**
 * Add a root class that allows CSS to visibly identify held skeleton states.
 * @returns {boolean} Whether the debug class was added.
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
 * @param {string} type Preset name.
 * @param {*} count Requested placeholder count.
 * @param {Object} options Preset options.
 * @returns {string} Placeholder markup.
 */
export function getSkeleton(type, count = DEFAULT_COUNT, options = {}) {
  const renderer = skeletonPresets[type];
  if (!renderer) {
    throw new Error(`Unknown skeleton preset: ${type}`);
  }
  if (type === 'supplierProfile') {
    return renderer();
  }
  if (type === 'tableRow') {
    return repeatMarkup(count, () => renderer(options.columns));
  }
  return repeatMarkup(count, renderer);
}

/**
 * Return one legacy supplier-card placeholder.
 * @returns {string} Placeholder markup.
 */
export function getSupplierCardSkeleton() {
  return supplierCardSkeleton();
}

/**
 * Return multiple legacy supplier-card placeholders.
 * @param {*} count Requested count.
 * @returns {string} Placeholder markup.
 */
export function getSupplierCardSkeletons(count = DEFAULT_COUNT) {
  return getSkeleton('supplierCard', count);
}

/**
 * Return one legacy list-item placeholder.
 * @returns {string} Placeholder markup.
 */
export function getListItemSkeleton() {
  return listItemSkeleton();
}

/**
 * Return multiple legacy list-item placeholders.
 * @param {*} count Requested count.
 * @returns {string} Placeholder markup.
 */
export function getListItemSkeletons(count = 5) {
  return `<div class="skeleton-list">${getSkeleton('listItem', count)}</div>`;
}

/**
 * Return one legacy search-result placeholder.
 * @returns {string} Placeholder markup.
 */
export function getSearchResultSkeleton() {
  return eventCardSkeleton();
}

/**
 * Return multiple legacy search-result placeholders.
 * @param {*} count Requested count.
 * @returns {string} Placeholder markup.
 */
export function getSearchResultSkeletons(count = 5) {
  return getSkeleton('eventCard', count);
}

/**
 * Return one legacy statistic placeholder.
 * @returns {string} Placeholder markup.
 */
export function getStatCardSkeleton() {
  return statCardSkeleton();
}

/**
 * Return multiple legacy statistic placeholders.
 * @param {*} count Requested count.
 * @returns {string} Placeholder markup.
 */
export function getStatCardSkeletons(count = 4) {
  return `<div class="skeleton-stats-grid">${getSkeleton('statCard', count)}</div>`;
}

/**
 * Show a skeleton state. The second argument may be a preset name or trusted
 * legacy HTML string. Named presets are preferred for new code.
 * @param {string|HTMLElement} container Target container.
 * @param {string} typeOrHtml Preset name or trusted application markup.
 * @param {Object} options Rendering options.
 * @returns {boolean} Whether the state was rendered.
 */
export function showSkeleton(container, typeOrHtml, options = {}) {
  const element = resolveContainer(container);
  if (!element) {
    return false;
  }

  const requestedCount = options.count ?? DEFAULT_COUNT;
  const isPreset = typeof typeOrHtml === 'string' && Boolean(skeletonPresets[typeOrHtml]);
  const markup = isPreset
    ? getSkeleton(typeOrHtml, requestedCount, options)
    : String(typeOrHtml || getSkeleton('listItem', requestedCount));

  element.setAttribute('aria-busy', 'true');
  element.setAttribute('data-skeleton-state', 'loading');
  element.innerHTML =
    options.wrap === false
      ? markup
      : `<div class="${escapeAttribute(options.className || 'skeleton-grid')}">${markup}</div>`;
  return true;
}

/**
 * Replace a loading region with real markup unless debug mode is holding it.
 * @param {string|HTMLElement} container Target container.
 * @param {*} html Trusted application-owned markup.
 * @returns {boolean} Whether the content was replaced.
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
 * @param {string|HTMLElement} container Target container.
 * @returns {boolean} Whether the region was cleared.
 */
export function clearSkeleton(container) {
  return replaceSkeleton(container, '');
}

/**
 * Show the legacy spinner fallback for non-layout-critical content.
 * @param {string|HTMLElement} container Target container.
 * @param {string} message Loading copy.
 * @returns {boolean} Whether the spinner was rendered.
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

/**
 * Render a terminal empty state and clear loading semantics.
 * @param {string|HTMLElement} container Target container.
 * @param {Object} options Empty-state options.
 * @returns {boolean} Whether the state was rendered.
 */
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

/**
 * Render a terminal retryable error state and clear loading semantics.
 * @param {string|HTMLElement} container Target container.
 * @param {Object} options Error-state options.
 * @returns {boolean} Whether the state was rendered.
 */
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
    const retryButton = element.querySelector('[data-skeleton-retry]');
    retryButton?.addEventListener('click', onAction, { once: true });
  }
  return true;
}

/**
 * Load the canonical stylesheet once for module consumers that omit a link tag.
 * @returns {void}
 */
export function loadSkeletonCSS() {
  if (typeof document === 'undefined' || document.getElementById('skeleton-css')) {
    return;
  }
  const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(link =>
    /\/assets\/css\/skeleton\.css(?:\?|$)/.test(link.getAttribute('href') || '')
  );
  if (existing) {
    if (!existing.id) {
      existing.id = 'skeleton-css';
    }
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
