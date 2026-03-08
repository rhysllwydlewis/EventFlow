/**
 * Suppliers Page Initialization
 * URL-driven filters, search integration, shortlist and quote features
 */

import { getFiltersFromURL, updateURL, handlePopState } from '../utils/url-state.js';
import {
  trackSearch,
  trackFilterChange,
  trackResultClick,
  trackShortlistAdd,
} from '../utils/analytics.js';
import shortlistManager from '../utils/shortlist-manager.js';

// HTML escaping utility
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') {
    return '';
  }
  const div = document.createElement('div');
  div.textContent = unsafe;
  return div.innerHTML;
}

// Generate gradient for supplier avatars
function generateSupplierGradient(name) {
  const colors = [
    ['#13B6A2', '#0B8073'],
    ['#8B5CF6', '#6D28D9'],
    ['#F59E0B', '#D97706'],
    ['#10B981', '#059669'],
    ['#3B82F6', '#2563EB'],
    ['#EC4899', '#DB2777'],
  ];
  const index = name ? name.charCodeAt(0) % colors.length : 0;
  return `linear-gradient(135deg, ${colors[index][0]} 0%, ${colors[index][1]} 100%)`;
}

// Enhanced supplier card with shortlist and quote features
function createSupplierCard(supplier, position) {
  const supplierInitial = supplier.name ? supplier.name.charAt(0).toUpperCase() : 'S';
  const avatarHtml = supplier.logo
    ? `<img src="${escapeHtml(supplier.logo)}" alt="${escapeHtml(supplier.name)} logo" class="supplier-card-avatar" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
       <div class="supplier-card-avatar-fallback" style="display: none; background: ${generateSupplierGradient(supplier.name)};">${supplierInitial}</div>`
    : `<div class="supplier-card-avatar-fallback" style="background: ${generateSupplierGradient(supplier.name)};">${supplierInitial}</div>`;

  const isInShortlist = shortlistManager.hasItem('supplier', supplier.id);
  const shortlistBtnClass = isInShortlist ? 'btn-shortlist-active' : '';
  const shortlistBtnText = isInShortlist ? '❤️ Saved' : '♡ Save';

  // Build badges — use subscriptionTier field first (most reliable), then isPro fallback
  const tier =
    supplier.subscriptionTier || supplier.subscription?.tier || (supplier.isPro ? 'pro' : null);
  const badges = [];
  // Founding supplier badge
  if (
    supplier.isFounding ||
    supplier.founding ||
    (supplier.badges && supplier.badges.includes('founding'))
  ) {
    const yearLabel = supplier.foundingYear
      ? ` (${escapeHtml(String(supplier.foundingYear))})`
      : '';
    badges.push(
      `<span class="badge badge-founding" title="Founding Supplier - Original member since 2024">⭐ Founding${yearLabel}</span>`
    );
  }
  if (supplier.verified || supplier.approved) {
    badges.push('<span class="badge badge-verified">✓ Verified</span>');
  }
  if (tier === 'pro_plus') {
    badges.push('<span class="badge badge-pro-plus">Pro Plus</span>');
  } else if (tier === 'pro') {
    badges.push('<span class="badge badge-pro">Pro</span>');
  }
  if (supplier.featuredSupplier) {
    badges.push('<span class="badge badge-featured">Featured</span>');
  }
  // Verification badges from verifications object
  if (supplier.verifications) {
    if (supplier.verifications.email && supplier.verifications.email.verified) {
      badges.push('<span class="badge badge-email-verified">✓ Email</span>');
    }
    if (supplier.verifications.phone && supplier.verifications.phone.verified) {
      badges.push('<span class="badge badge-phone-verified">✓ Phone</span>');
    }
    if (supplier.verifications.business && supplier.verifications.business.verified) {
      badges.push('<span class="badge badge-business-verified">✓ Business</span>');
    }
  }

  // Inline tier icon — use shared EFTierIcon helper if available (tier-icon.js)
  const tierIcon = typeof EFTierIcon !== 'undefined' ? EFTierIcon.render(supplier) : '';

  const rating = supplier.averageRating
    ? `⭐ ${Number(supplier.averageRating).toFixed(1)}${supplier.reviewCount ? ` (${supplier.reviewCount})` : ''}`
    : supplier.rating
      ? `⭐ ${supplier.rating}`
      : '';
  const priceDisplay = supplier.price_display || 'Contact for quote';
  const distanceBadge =
    typeof supplier.distanceMiles === 'number'
      ? `<span class="badge badge-distance">📍 ${supplier.distanceMiles < 1 ? '< 1' : supplier.distanceMiles.toFixed(1)} mi</span>`
      : '';

  return `
    <div class="card supplier-card" data-supplier-id="${escapeHtml(supplier.id)}">
      ${avatarHtml}
      <div class="supplier-card-content">
        <h3 class="supplier-card-name">
          <a href="/supplier?id=${encodeURIComponent(supplier.id)}" 
             data-position="${position}"
             class="supplier-card-link">
            ${escapeHtml(supplier.name)}
          </a>${tierIcon}
        </h3>
        <div class="supplier-card-meta">
          ${escapeHtml(supplier.category || '')}
          ${supplier.location ? `• ${escapeHtml(supplier.location)}` : ''}
          ${rating ? `• ${rating}` : ''}
        </div>
        <p class="supplier-card-description">${escapeHtml(supplier.description_short || '')}</p>
        <div class="supplier-card-badges">${badges.join('')}${distanceBadge}</div>
        <div class="supplier-card-price">${escapeHtml(priceDisplay)}</div>
        <div class="supplier-card-actions">
          <button class="btn btn-primary btn-quote" data-supplier-id="${escapeHtml(supplier.id)}">
            Request Quote
          </button>
          ${
            supplier.ownerUserId
              ? `
          <button class="btn btn-secondary btn-contact-supplier"
                  data-quick-compose="true"
                  data-recipient-id="${escapeHtml(supplier.ownerUserId)}"
                  data-context-type="supplier_profile"
                  data-context-id="${escapeHtml(supplier.id)}"
                  data-context-title="${escapeHtml(supplier.name)}"
                  style="font-size: 13px; padding: 6px 12px;">
            💬 Message
          </button>
          `
              : ''
          }
          <button class="btn btn-secondary btn-shortlist ${shortlistBtnClass}" 
                  data-supplier-id="${escapeHtml(supplier.id)}"
                  data-supplier-name="${escapeHtml(supplier.name)}"
                  data-supplier-category="${escapeHtml(supplier.category || '')}"
                  data-supplier-location="${escapeHtml(supplier.location || '')}"
                  data-supplier-image="${escapeHtml(supplier.logo || '')}"
                  data-supplier-price="${escapeHtml(priceDisplay)}"
                  data-supplier-rating="${supplier.rating || ''}">
            ${shortlistBtnText}
          </button>
          <a href="/supplier?id=${encodeURIComponent(supplier.id)}" 
             class="btn btn-tertiary">
            View Profile
          </a>
        </div>
      </div>
    </div>
  `;
}

// Skeleton loading cards
function createSkeletonCards(count = 3) {
  const card = `
    <div class="skeleton-supplier-card-full skeleton-card" aria-hidden="true">
      <div class="skeleton-supplier-header">
        <div class="skeleton skeleton-avatar-large"></div>
        <div style="flex:1">
          <div class="skeleton skeleton-title"></div>
          <div class="skeleton skeleton-text skeleton-text-medium"></div>
        </div>
      </div>
      <div class="skeleton skeleton-text skeleton-text-long"></div>
      <div class="skeleton skeleton-text skeleton-text-medium"></div>
      <div class="skeleton-supplier-meta">
        <div class="skeleton skeleton-text skeleton-text-short"></div>
        <div class="skeleton skeleton-text skeleton-text-short"></div>
      </div>
    </div>
  `;
  return Array(count).fill(card).join('');
}

// Empty state
function createEmptyState(filters) {
  const hasFilters =
    filters.q ||
    filters.category ||
    filters.location ||
    filters.priceLevel ||
    filters.minRating ||
    filters.verifiedOnly ||
    filters.eventType ||
    filters.postcode ||
    filters.maxDistance;

  return `
    <div class="empty-state">
      <div class="empty-state-icon">🔍</div>
      <h2>No suppliers found</h2>
      <p>${hasFilters ? 'No suppliers match your current filters.' : 'No suppliers available at the moment.'}</p>
      <div class="empty-state-actions">
        ${hasFilters ? '<button class="btn btn-secondary" id="clear-filters-btn">Clear filters</button>' : ''}
        <a href="/start" class="btn btn-primary">Start planning</a>
      </div>
    </div>
  `;
}

// Valid sort values — kept in sync with VALID_SUPPLIER_SORT_VALUES in searchService.js
const VALID_SORT_VALUES = [
  'relevance',
  'rating',
  'reviews',
  'name',
  'newest',
  'priceAsc',
  'priceDesc',
  'distance',
];

// Human-readable labels for each sort value (mirrors the HTML <option> labels)
const SORT_LABELS = {
  relevance: 'Relevance',
  rating: 'Rating',
  reviews: 'Most reviewed',
  name: 'Name (A–Z)',
  newest: 'Recently joined',
  priceAsc: 'Price: low → high',
  priceDesc: 'Price: high → low',
  distance: 'Distance (nearest first)',
};

// Search suppliers using the v2 API
// Returns the full data object including appliedSort, results, pagination.
// Throws on network/server errors so callers can show error state.
async function searchSuppliers(filters, page = 1, signal = null) {
  const params = new URLSearchParams();

  if (filters.q) {
    params.set('q', filters.q);
  }
  if (filters.location) {
    params.set('location', filters.location);
  }
  if (filters.category) {
    params.set('category', filters.category);
  }
  if (filters.eventType) {
    params.set('eventType', filters.eventType);
  }
  if (filters.priceLevel) {
    params.set('minPrice', filters.priceLevel);
    params.set('maxPrice', filters.priceLevel);
  }
  if (filters.minRating) {
    params.set('minRating', filters.minRating);
  }
  if (filters.verifiedOnly) {
    params.set('verifiedOnly', 'true');
  }
  if (filters.postcode) {
    params.set('postcode', filters.postcode);
  }
  if (filters.maxDistance) {
    params.set('maxDistance', filters.maxDistance);
  }
  // Validate sort client-side before sending; fall back to 'relevance' for unknowns
  const sortBy = VALID_SORT_VALUES.includes(filters.sort) ? filters.sort : 'relevance';
  if (filters.sort && filters.sort !== sortBy) {
    console.warn(`[suppliers] Unknown sort value "${filters.sort}", falling back to "relevance"`);
  }
  if (sortBy !== 'relevance') {
    params.set('sortBy', sortBy);
  }
  params.set('page', page);
  params.set('limit', 20);

  const response = await fetch(`/api/v2/search/suppliers?${params.toString()}`, {
    credentials: 'include',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Search failed (${response.status})`);
  }

  const result = await response.json();
  const data = result.data || {
    results: [],
    pagination: { total: 0, page: 1, totalPages: 1 },
    appliedSort: 'relevance',
  };
  // Normalise: API returns `pages`, but components use `totalPages`
  if (
    data.pagination &&
    data.pagination.pages !== undefined &&
    data.pagination.totalPages === undefined
  ) {
    data.pagination.totalPages = data.pagination.pages;
  }
  return data;
}

// Initialize suppliers page
async function initSuppliersPage() {
  const resultsContainer = document.getElementById('results');
  const resultCountEl = document.getElementById('resultCount');
  const appliedSortEl = document.getElementById('applied-sort-indicator');
  const filterCategoryEl = document.getElementById('filterCategory');
  const filterPriceEl = document.getElementById('filterPrice');
  const filterQueryEl = document.getElementById('filterQuery');
  const filterRatingEl = document.getElementById('filterRating');
  const filterVerifiedEl = document.getElementById('filterVerified');
  const filterSortEl = document.getElementById('filterSort');
  const filterEventTypeEl = document.getElementById('filterEventType');
  const filterPostcodeEl = document.getElementById('filterPostcode');
  const filterDistanceEl = document.getElementById('filterDistance');

  if (!resultsContainer) {
    console.warn('Results container not found, skipping suppliers init');
    return;
  }

  let currentFilters = getFiltersFromURL();
  // AbortController for the current in-flight request; allows cancelling stale requests
  let currentAbortController = null;

  // Populate filter inputs from URL
  function populateFiltersFromURL() {
    if (filterQueryEl && currentFilters.q) {
      filterQueryEl.value = currentFilters.q;
    }
    if (filterCategoryEl && currentFilters.category) {
      filterCategoryEl.value = currentFilters.category;
    }
    if (filterPriceEl && currentFilters.priceLevel) {
      filterPriceEl.value = currentFilters.priceLevel;
    }
    if (filterRatingEl && currentFilters.minRating) {
      filterRatingEl.value = currentFilters.minRating;
    }
    if (filterVerifiedEl) {
      filterVerifiedEl.checked = !!currentFilters.verifiedOnly;
    }
    if (filterSortEl && currentFilters.sort) {
      filterSortEl.value = currentFilters.sort;
    }
    if (filterEventTypeEl && currentFilters.eventType) {
      filterEventTypeEl.value = currentFilters.eventType;
    }
    if (filterPostcodeEl && currentFilters.postcode) {
      filterPostcodeEl.value = currentFilters.postcode;
    }
    if (filterDistanceEl && currentFilters.maxDistance) {
      filterDistanceEl.value = currentFilters.maxDistance;
    }
  }

  // Update the "Sorted by:" indicator below the filter panel
  function updateAppliedSortIndicator(sort) {
    if (!appliedSortEl) {
      return;
    }
    if (!sort || sort === 'relevance') {
      appliedSortEl.hidden = true;
      appliedSortEl.textContent = '';
    } else {
      const label = SORT_LABELS[sort] || sort;
      appliedSortEl.textContent = `↕ Sorted by: ${label}`;
      appliedSortEl.hidden = false;
    }
  }

  // Render results
  async function renderResults(append = false) {
    // Cancel any in-flight request before starting a new one
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    // Show skeleton loading for fresh searches (not for load-more appends)
    if (!append) {
      resultsContainer.innerHTML = createSkeletonCards();
    }

    try {
      const data = await searchSuppliers(currentFilters, currentFilters.page, signal);
      const { results, pagination, appliedSort } = data;

      // Track search
      if (!append) {
        trackSearch(currentFilters.q || '', currentFilters, pagination.total);
      }

      // Update result count
      if (resultCountEl) {
        resultCountEl.textContent = `${pagination.total} supplier${pagination.total !== 1 ? 's' : ''} found`;
      }

      // Show which sort the API actually applied
      updateAppliedSortIndicator(appliedSort);

      // Render results or empty state
      if (results.length === 0 && !append) {
        resultsContainer.innerHTML = createEmptyState(currentFilters);
        attachEmptyStateHandlers();
      } else {
        const cardsHTML = results
          .map((supplier, index) =>
            createSupplierCard(supplier, (currentFilters.page - 1) * 20 + index + 1)
          )
          .join('');

        if (append) {
          // Remove load more button before appending
          const loadMoreBtn = document.getElementById('load-more-btn');
          if (loadMoreBtn) {
            loadMoreBtn.remove();
          }
          resultsContainer.insertAdjacentHTML('beforeend', cardsHTML);
        } else {
          resultsContainer.innerHTML = cardsHTML;
        }
        attachCardHandlers();

        // Add Load More button if there are more pages
        if (pagination.page < pagination.totalPages) {
          addLoadMoreButton(pagination);
        }
      }
    } catch (error) {
      // AbortError means a newer request superseded this one — do nothing
      if (error.name === 'AbortError') {
        return;
      }
      resultsContainer.innerHTML = `
        <div class="error-state" role="status" aria-live="polite">
          <div class="error-state-icon">⚠️</div>
          <div class="error-state-title">Unable to load suppliers</div>
          <div class="error-state-description">Please check your connection and try again.</div>
          <button class="error-state-action" id="retry-suppliers-btn">Try Again</button>
        </div>
      `;
      const retryBtn = resultsContainer.querySelector('#retry-suppliers-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          renderResults();
        });
      }
    }
  }

  // Add Load More button
  function addLoadMoreButton(pagination) {
    const existingBtn = document.getElementById('load-more-btn');
    if (existingBtn) {
      existingBtn.remove();
    }

    const loadMoreHTML = `
      <div style="text-align: center; margin: 2rem 0;">
        <button id="load-more-btn" class="btn btn-secondary">
          Load More (${pagination.page} of ${pagination.totalPages})
        </button>
      </div>
    `;
    resultsContainer.insertAdjacentHTML('beforeend', loadMoreHTML);

    const loadMoreBtn = document.getElementById('load-more-btn');
    loadMoreBtn.addEventListener('click', async () => {
      currentFilters.page = (currentFilters.page || 1) + 1;
      await renderResults(true);
    });
  }

  // Attach handlers to supplier cards
  function attachCardHandlers() {
    // Shortlist buttons
    resultsContainer.querySelectorAll('.btn-shortlist').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.preventDefault();
        const supplierId = btn.dataset.supplierId;
        const isActive = btn.classList.contains('btn-shortlist-active');

        if (isActive) {
          await shortlistManager.removeItem('supplier', supplierId);
          btn.classList.remove('btn-shortlist-active');
          btn.textContent = '♡ Save';
        } else {
          const item = {
            type: 'supplier',
            id: supplierId,
            name: btn.dataset.supplierName,
            category: btn.dataset.supplierCategory,
            location: btn.dataset.supplierLocation,
            imageUrl: btn.dataset.supplierImage,
            priceHint: btn.dataset.supplierPrice,
            rating: btn.dataset.supplierRating ? parseFloat(btn.dataset.supplierRating) : null,
          };
          await shortlistManager.addItem(item);
          btn.classList.add('btn-shortlist-active');
          btn.textContent = '❤️ Saved';
          trackShortlistAdd('supplier', supplierId);
        }
      });
    });

    // Quote buttons
    resultsContainer.querySelectorAll('.btn-quote').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const supplierId = btn.dataset.supplierId;
        const card = btn.closest('.supplier-card');
        const shortlistBtn = card.querySelector('.btn-shortlist');

        // Get supplier data from card
        const supplier = {
          id: supplierId,
          name: shortlistBtn.dataset.supplierName,
          category: shortlistBtn.dataset.supplierCategory,
        };

        // Dispatch event to open quote modal
        window.dispatchEvent(
          new CustomEvent('openQuoteRequestModal', {
            detail: { items: [supplier] },
          })
        );
      });
    });

    // Track result clicks
    resultsContainer.querySelectorAll('.supplier-card-link').forEach(link => {
      link.addEventListener('click', _e => {
        const supplierId = link.closest('.supplier-card').dataset.supplierId;
        const position = parseInt(link.dataset.position, 10);
        trackResultClick('supplier', supplierId, position);
      });
    });

    // Attach QuickComposeV4 to any new compose triggers
    if (window.QuickComposeV4 && typeof window.QuickComposeV4.attachAll === 'function') {
      window.QuickComposeV4.attachAll();
    }
  }

  // Attach handlers to empty state
  function attachEmptyStateHandlers() {
    const clearBtn = document.getElementById('clear-filters-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        currentFilters = { sort: 'relevance', page: 1 };
        updateURL(currentFilters, true);
        if (filterQueryEl) {
          filterQueryEl.value = '';
        }
        if (filterCategoryEl) {
          filterCategoryEl.value = '';
        }
        if (filterPriceEl) {
          filterPriceEl.value = '';
        }
        if (filterRatingEl) {
          filterRatingEl.value = '';
        }
        if (filterVerifiedEl) {
          filterVerifiedEl.checked = false;
        }
        if (filterSortEl) {
          filterSortEl.value = 'relevance';
        }
        if (filterEventTypeEl) {
          filterEventTypeEl.value = '';
        }
        if (filterPostcodeEl) {
          filterPostcodeEl.value = '';
        }
        if (filterDistanceEl) {
          filterDistanceEl.value = '';
        }
        renderResults();
      });
    }
  }

  // Handle filter changes
  if (filterQueryEl) {
    let debounceTimer;
    filterQueryEl.addEventListener('input', e => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        currentFilters.q = e.target.value;
        currentFilters.page = 1;
        updateURL(currentFilters);
        renderResults();
        trackFilterChange('query', e.target.value);
      }, 500);
    });
  }

  if (filterCategoryEl) {
    filterCategoryEl.addEventListener('change', e => {
      currentFilters.category = e.target.value;
      currentFilters.page = 1;
      updateURL(currentFilters);
      renderResults();
      trackFilterChange('category', e.target.value);
    });
  }

  if (filterPriceEl) {
    filterPriceEl.addEventListener('change', e => {
      const level = e.target.value;
      if (level) {
        currentFilters.priceLevel = level;
      } else {
        delete currentFilters.priceLevel;
      }
      currentFilters.page = 1;
      updateURL(currentFilters);
      renderResults();
      trackFilterChange('price', level);
    });
  }

  if (filterRatingEl) {
    filterRatingEl.addEventListener('change', e => {
      currentFilters.minRating = e.target.value;
      currentFilters.page = 1;
      updateURL(currentFilters);
      renderResults();
      trackFilterChange('minRating', e.target.value);
    });
  }

  if (filterVerifiedEl) {
    filterVerifiedEl.addEventListener('change', e => {
      currentFilters.verifiedOnly = e.target.checked;
      currentFilters.page = 1;
      updateURL(currentFilters);
      renderResults();
      trackFilterChange('verifiedOnly', e.target.checked);
    });
  }

  if (filterSortEl) {
    filterSortEl.addEventListener('change', e => {
      currentFilters.sort = e.target.value;
      currentFilters.page = 1;
      updateURL(currentFilters);
      renderResults();
      trackFilterChange('sort', e.target.value);
    });
  }

  if (filterEventTypeEl) {
    filterEventTypeEl.addEventListener('change', e => {
      currentFilters.eventType = e.target.value;
      currentFilters.page = 1;
      updateURL(currentFilters);
      renderResults();
      trackFilterChange('eventType', e.target.value);
    });
  }

  if (filterPostcodeEl) {
    let postcodeDebounce;
    filterPostcodeEl.addEventListener('input', e => {
      clearTimeout(postcodeDebounce);
      postcodeDebounce = setTimeout(() => {
        currentFilters.postcode = e.target.value.trim();
        currentFilters.page = 1;
        updateURL(currentFilters);
        renderResults();
        trackFilterChange('postcode', e.target.value.trim());
      }, 600);
    });
  }

  if (filterDistanceEl) {
    filterDistanceEl.addEventListener('change', e => {
      currentFilters.maxDistance = e.target.value;
      currentFilters.page = 1;
      updateURL(currentFilters);
      renderResults();
      trackFilterChange('maxDistance', e.target.value);
    });
  }

  // Handle browser back/forward
  handlePopState(filters => {
    currentFilters = filters;
    populateFiltersFromURL();
    renderResults();
  });

  // Quick category shortcuts
  document.querySelectorAll('[data-quick-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      const category = btn.getAttribute('data-quick-category');
      currentFilters.category = category;
      currentFilters.page = 1;
      if (filterCategoryEl) {
        filterCategoryEl.value = category;
      }
      updateURL(currentFilters);
      renderResults();
    });
  });

  // Clear filters button (top of page)
  const clearFiltersBtn = document.getElementById('clear-filters-btn-top');
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      currentFilters = { sort: 'relevance', page: 1 };
      updateURL(currentFilters, true);
      if (filterQueryEl) {
        filterQueryEl.value = '';
      }
      if (filterCategoryEl) {
        filterCategoryEl.value = '';
      }
      if (filterPriceEl) {
        filterPriceEl.value = '';
      }
      if (filterRatingEl) {
        filterRatingEl.value = '';
      }
      if (filterVerifiedEl) {
        filterVerifiedEl.checked = false;
      }
      if (filterSortEl) {
        filterSortEl.value = 'relevance';
      }
      if (filterEventTypeEl) {
        filterEventTypeEl.value = '';
      }
      if (filterPostcodeEl) {
        filterPostcodeEl.value = '';
      }
      if (filterDistanceEl) {
        filterDistanceEl.value = '';
      }
      renderResults();
    });
  }

  // Initial render
  populateFiltersFromURL();
  renderResults();
}

// Auto-initialize when DOM is ready, only on suppliers page
function shouldInit() {
  // Check if we're on the suppliers page by looking for the results container
  // and verifying the page context
  return document.getElementById('results') && window.location.pathname.includes('suppliers');
}

if (shouldInit()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSuppliersPage);
  } else {
    initSuppliersPage();
  }
}

export default initSuppliersPage;
