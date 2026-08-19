/**
 * URL State Management Utility
 * Manages filter state in URL parameters for shareable search results
 */

/**
 * Read filters from URL parameters
 * @returns {Object} Filter object with category, location, priceLevel, q, eventType, sort, minRating, verifiedOnly, postcode, maxDistance, page
 */
export function getFiltersFromURL() {
  const params = new URLSearchParams(window.location.search);
  const rawCategory = params.get('category') || '';
  const category = window.EventFlowCategoryLink
    ? window.EventFlowCategoryLink.canonicalCategoryValue(rawCategory)
    : rawCategory;

  return {
    category,
    location: params.get('location') || '',
    priceLevel: params.get('priceLevel') || '',
    q: params.get('q') || '',
    eventType: params.get('eventType') || '',
    sort: params.get('sort') || 'relevance',
    minRating: params.get('minRating') || '',
    verifiedOnly: params.get('verifiedOnly') === 'true',
    postcode: params.get('postcode') || '',
    maxDistance: params.get('maxDistance') || '',
    page: parseInt(params.get('page'), 10) || 1,
  };
}

/**
 * Update URL with current filter state
 * @param {Object} filters - Filter object
 * @param {boolean} replace - If true, use replaceState instead of pushState
 */
export function updateURL(filters, replace = false) {
  const params = new URLSearchParams();

  // Add non-empty filter parameters
  const category = window.EventFlowCategoryLink
    ? window.EventFlowCategoryLink.canonicalCategoryValue(filters.category)
    : filters.category;
  if (category) {
    params.set('category', category);
  }
  if (filters.location) {
    params.set('location', filters.location);
  }
  if (filters.priceLevel) {
    params.set('priceLevel', filters.priceLevel);
  }
  if (filters.q) {
    params.set('q', filters.q);
  }
  if (filters.eventType) {
    params.set('eventType', filters.eventType);
  }
  if (filters.postcode) {
    params.set('postcode', filters.postcode);
  }
  if (filters.maxDistance) {
    params.set('maxDistance', filters.maxDistance);
  }
  if (filters.minRating) {
    params.set('minRating', filters.minRating);
  }
  if (filters.verifiedOnly) {
    params.set('verifiedOnly', 'true');
  }
  if (filters.sort && filters.sort !== 'relevance') {
    params.set('sort', filters.sort);
  }
  if (filters.page && filters.page > 1) {
    params.set('page', filters.page);
  }

  const queryString = params.toString();
  const newUrl = queryString
    ? `${window.location.pathname}?${queryString}`
    : window.location.pathname;

  if (replace) {
    window.history.replaceState({}, '', newUrl);
  } else {
    window.history.pushState({}, '', newUrl);
  }
}

/**
 * Handle browser back/forward navigation
 * @param {Function} callback - Function to call with updated filters
 */
export function handlePopState(callback) {
  window.addEventListener('popstate', () => {
    const filters = getFiltersFromURL();
    callback(filters);
  });
}
