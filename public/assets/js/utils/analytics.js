/**
 * Analytics Utility
 * Provides tracking functions for user interactions
 */

/**
 * Track search query
 * @param {string} query - Search query
 * @param {Object} filters - Applied filters
 * @param {number} resultCount - Number of results returned
 */

const isDevelopment =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
export function trackSearch(query, filters, resultCount) {
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'search', {
      search_term: query,
      filters: JSON.stringify(filters),
      result_count: resultCount,
    });
  }
  if (isDevelopment) {
    console.log('Search tracked:', { query, filters, resultCount });
  }
}

/**
 * Filters the visitor types into. Their text can be personal (a postcode, a name), so the analytics
 * tag is told only whether the filter is in use, never what was typed.
 */
const FREE_TEXT_FILTERS = new Set(['query', 'postcode', 'location']);

/**
 * Track filter change
 * @param {string} filterType - Type of filter changed
 * @param {string} value - New filter value
 */
export function trackFilterChange(filterType, value) {
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'filter_change', {
      filter_type: filterType,
      filter_value: FREE_TEXT_FILTERS.has(filterType) ? (value ? 'set' : 'cleared') : value,
    });
  }
  if (isDevelopment) {
    console.log('Filter change tracked:', { filterType, value });
  }
}

/**
 * Track result click
 * @param {string} type - Type of result (e.g., 'supplier')
 * @param {string} id - Result ID
 * @param {number} position - Position in results
 */
export function trackResultClick(type, id, position) {
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'select_content', {
      content_type: type,
      content_id: id,
      position: position,
    });
  }
  if (isDevelopment) {
    console.log('Result click tracked:', { type, id, position });
  }
}

/**
 * Track shortlist add
 * @param {string} type - Type of item (e.g., 'supplier')
 * @param {string} id - Item ID
 */
export function trackShortlistAdd(type, id) {
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'add_to_wishlist', {
      content_type: type,
      content_id: id,
    });
  }
  if (isDevelopment) {
    console.log('Shortlist add tracked:', { type, id });
  }
}

/**
 * Track quote request started
 * @param {number} supplierCount - Number of suppliers in the quote request
 */
export function trackQuoteRequestStarted(supplierCount) {
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'begin_checkout', {
      value: supplierCount,
      currency: 'GBP', // Fixed currency - EventFlow operates in UK market
    });
  }
  if (isDevelopment) {
    console.log('Quote request started:', { supplierCount });
  }
}

/**
 * Track quote request submitted
 * @param {number} supplierCount - Number of suppliers in the quote request
 * @param {string} eventType - Type of event
 */
export function trackQuoteRequestSubmitted(supplierCount, eventType) {
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'purchase', {
      value: supplierCount,
      currency: 'GBP',
      items: [{ item_name: eventType }],
    });
  }
  if (isDevelopment) {
    console.log('Quote request submitted:', { supplierCount, eventType });
  }
}
