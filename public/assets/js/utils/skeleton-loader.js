/**
 * Skeleton Loader Utilities
 * Helper functions to generate skeleton loading states
 */

/**
 * Generate skeleton for supplier card
 * @returns {string} HTML string for skeleton
 */
export function getSupplierCardSkeleton() {
  return `
    <div class="skeleton-supplier-card-full">
      <div class="skeleton-supplier-header">
        <div class="skeleton skeleton-avatar-large"></div>
        <div class="skeleton-supplier-content" style="flex: 1;">
          <div class="skeleton skeleton-title"></div>
          <div class="skeleton skeleton-text skeleton-text-medium"></div>
        </div>
      </div>
      <div class="skeleton skeleton-text skeleton-text-long"></div>
      <div class="skeleton skeleton-text skeleton-text-medium"></div>
      <div class="skeleton-supplier-meta">
        <div class="skeleton skeleton-text skeleton-text-short"></div>
        <div class="skeleton skeleton-text skeleton-text-short"></div>
        <div class="skeleton skeleton-text skeleton-text-short"></div>
      </div>
    </div>
  `;
}

/**
 * Generate skeleton for multiple supplier cards
 * @param {number} count - Number of skeleton cards
 * @returns {string} HTML string for skeletons
 */
export function getSupplierCardSkeletons(count = 3) {
  return Array(count)
    .fill(null)
    .map(() => getSupplierCardSkeleton())
    .join('');
}

/**
 * Generate skeleton for list item (e.g., message thread)
 * @returns {string} HTML string for skeleton
 */
export function getListItemSkeleton() {
  return `
    <div class="skeleton-list-item">
      <div class="skeleton skeleton-avatar"></div>
      <div style="flex: 1;">
        <div class="skeleton skeleton-text skeleton-text-medium" style="margin-bottom: 0.25rem;"></div>
        <div class="skeleton skeleton-text skeleton-text-short"></div>
      </div>
      <div class="skeleton skeleton-text" style="width: 80px; height: 0.875rem;"></div>
    </div>
  `;
}

/**
 * Generate skeleton for multiple list items
 * @param {number} count - Number of skeleton items
 * @returns {string} HTML string for skeletons
 */
export function getListItemSkeletons(count = 5) {
  return `<div>${Array(count)
    .fill(null)
    .map(() => getListItemSkeleton())
    .join('')}</div>`;
}

/**
 * Generate skeleton for search result
 * @returns {string} HTML string for skeleton
 */
export function getSearchResultSkeleton() {
  return `
    <div class="skeleton-search-result">
      <div class="skeleton skeleton-search-image"></div>
      <div class="skeleton-search-content">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-text skeleton-text-long"></div>
        <div class="skeleton skeleton-text skeleton-text-medium"></div>
        <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
          <div class="skeleton skeleton-text" style="width: 80px; height: 1.5rem;"></div>
          <div class="skeleton skeleton-text" style="width: 100px; height: 1.5rem;"></div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Generate skeleton for multiple search results
 * @param {number} count - Number of skeleton results
 * @returns {string} HTML string for skeletons
 */
export function getSearchResultSkeletons(count = 5) {
  return Array(count)
    .fill(null)
    .map(() => getSearchResultSkeleton())
    .join('');
}

/**
 * Generate skeleton for dashboard stat card
 * @returns {string} HTML string for skeleton
 */
export function getStatCardSkeleton() {
  return `
    <div class="skeleton-stat-card">
      <div class="skeleton skeleton-stat-number"></div>
      <div class="skeleton skeleton-stat-label"></div>
    </div>
  `;
}

/**
 * Generate skeleton for multiple stat cards
 * @param {number} count - Number of skeleton cards
 * @returns {string} HTML string for skeletons
 */
export function getStatCardSkeletons(count = 4) {
  return `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
    ${Array(count)
      .fill(null)
      .map(() => getStatCardSkeleton())
      .join('')}
  </div>`;
}

/**
 * Show loading state with skeleton
 * @param {HTMLElement|string} container - Container element or selector
 * @param {string} skeletonHtml - Skeleton HTML to show
 */
export function showSkeleton(container, skeletonHtml) {
  const element = typeof container === 'string' ? document.querySelector(container) : container;
  if (element) {
    element.innerHTML = skeletonHtml;
  }
}

/**
 * Show loading spinner
 * @param {HTMLElement|string} container - Container element or selector
 * @param {string} message - Loading message (optional)
 */
export function showLoadingSpinner(container, message = 'Loading...') {
  const element = typeof container === 'string' ? document.querySelector(container) : container;
  if (element) {
    element.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <div class="loading-text">${message}</div>
      </div>
    `;
  }
}

/**
 * Show empty state
 * @param {HTMLElement|string} container - Container element or selector
 * @param {object} options - Empty state options
 */
export function showEmptyState(container, options = {}) {
  const {
    icon = '📭',
    title = 'Nothing here yet',
    description = '',
    actionText = '',
    actionHref = '',
  } = options;

  const element = typeof container === 'string' ? document.querySelector(container) : container;
  if (element) {
    const actionHtml = actionText
      ? `<a href="${actionHref}" class="empty-state-action">${actionText}</a>`
      : '';

    element.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icon}</div>
        <div class="empty-state-title">${title}</div>
        ${description ? `<div class="empty-state-description">${description}</div>` : ''}
        ${actionHtml}
      </div>
    `;
  }
}

/**
 * Show error state
 * @param {HTMLElement|string} container - Container element or selector
 * @param {object} options - Error state options
 */
export function showErrorState(container, options = {}) {
  const {
    icon = '⚠️',
    title = 'Something went wrong',
    description = 'Please try again later.',
    actionText = 'Try Again',
    onAction = null,
  } = options;

  const element = typeof container === 'string' ? document.querySelector(container) : container;
  if (element) {
    element.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">${icon}</div>
        <div class="error-state-title">${title}</div>
        <div class="error-state-description">${description}</div>
        ${actionText ? `<button class="ef-cta error-state-action" id="error-action-btn">${actionText}</button>` : ''}
      </div>
    `;

    if (onAction && actionText) {
      const actionBtn = element.querySelector('#error-action-btn');
      if (actionBtn) {
        actionBtn.addEventListener('click', onAction);
      }
    }
  }
}

/**
 * Ensure skeleton CSS is loaded
 */
export function loadSkeletonCSS() {
  if (!document.getElementById('skeleton-css')) {
    const link = document.createElement('link');
    link.id = 'skeleton-css';
    link.rel = 'stylesheet';
    link.href = '/assets/css/skeleton.css';
    document.head.appendChild(link);
  }
}

// Auto-load CSS when module is imported
loadSkeletonCSS();

export default {
  getSupplierCardSkeleton,
  getSupplierCardSkeletons,
  getListItemSkeleton,
  getListItemSkeletons,
  getSearchResultSkeleton,
  getSearchResultSkeletons,
  getStatCardSkeleton,
  getStatCardSkeletons,
  showSkeleton,
  showLoadingSpinner,
  showEmptyState,
  showErrorState,
  loadSkeletonCSS,
};
