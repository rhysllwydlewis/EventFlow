/**
 * Marketplace Page Initialization
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

// Enhanced listing card with shortlist and quote features
function createListingCard(listing, position) {
  const isInShortlist = shortlistManager.hasItem('listing', listing.id);
  const shortlistBtnClass = isInShortlist ? 'btn-shortlist-active' : '';
  const shortlistBtnText = isInShortlist ? '❤️ Saved' : '♡ Save';

  const imageUrl =
    listing.images && listing.images.length > 0
      ? listing.images[0]
      : '/assets/images/placeholder-listing.jpg';

  const condition = listing.condition || 'Good';
  const priceDisplay = listing.price ? `£${listing.price}` : 'Price on request';

  return `
    <div class="card listing-card" data-listing-id="${escapeHtml(listing.id)}">
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(listing.title)}" class="listing-card-image" />
      <div class="listing-card-content">
        <h3 class="listing-card-title">
          <a href="/package?id=${encodeURIComponent(listing.id)}" 
             data-position="${position}"
             class="listing-card-link">
            ${escapeHtml(listing.title)}
          </a>
        </h3>
        <div class="listing-card-meta">
          ${escapeHtml(listing.category || '')}
          ${listing.location ? `• ${escapeHtml(listing.location)}` : ''}
          ${condition ? `• ${condition}` : ''}
        </div>
        <p class="listing-card-description">${escapeHtml(listing.description_short || listing.description || '')}</p>
        <div class="listing-card-price">${priceDisplay}</div>
        <div class="listing-card-actions">
          <a href="/package?id=${encodeURIComponent(listing.id)}" 
             class="btn btn-primary">
            View Details
          </a>
          <button class="btn btn-secondary btn-shortlist ${shortlistBtnClass}" 
                  data-listing-id="${escapeHtml(listing.id)}"
                  data-listing-name="${escapeHtml(listing.title)}"
                  data-listing-category="${escapeHtml(listing.category || '')}"
                  data-listing-location="${escapeHtml(listing.location || '')}"
                  data-listing-image="${escapeHtml(imageUrl)}"
                  data-listing-price="${escapeHtml(priceDisplay)}">
            ${shortlistBtnText}
          </button>
        </div>
      </div>
    </div>
  `;
}

// Skeleton loading cards
function createSkeletonCards(count = 3) {
  return Array(count)
    .fill()
    .map(
      () => `
    <div class="card skeleton-card" style="height: 300px; margin-bottom: 20px;"></div>
  `
    )
    .join('');
}

// Empty state
function createEmptyState(filters) {
  const hasFilters =
    filters.q || filters.category || filters.location || filters.budgetMin || filters.budgetMax;

  return `
    <div class="empty-state">
      <div class="empty-state-icon">🔍</div>
      <h2>No listings found</h2>
      <p>${hasFilters ? 'No listings match your current filters.' : 'No listings available at the moment.'}</p>
      <div class="empty-state-actions">
        ${hasFilters ? '<button class="btn btn-secondary" id="clear-filters-btn">Clear filters</button>' : ''}
        <a href="/marketplace" class="btn btn-primary">Browse all</a>
      </div>
    </div>
  `;
}

// Search marketplace listings
async function searchListings(filters, page = 1) {
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
  if (filters.budgetMin) {
    params.set('minPrice', filters.budgetMin);
  }
  if (filters.budgetMax) {
    params.set('maxPrice', filters.budgetMax);
  }
  if (filters.sort) {
    params.set('sortBy', filters.sort);
  }
  params.set('page', page);
  params.set('limit', 20);

  try {
    // Use the marketplace listings endpoint
    const response = await fetch(`/api/marketplace/listings?${params.toString()}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Search failed');
    }

    const result = await response.json();
    // Backend returns { listings: [...] } not { data: { results: [...] } }
    return {
      results: result.listings || [],
      pagination: {
        total: result.listings ? result.listings.length : 0,
        page: 1,
        totalPages: 1,
      },
    };
  } catch (error) {
    console.error('Search error:', error);
    return { results: [], pagination: { total: 0, page: 1, totalPages: 1 } };
  }
}

// Initialize marketplace page
async function initMarketplacePage() {
  const resultsContainer = document.getElementById('marketplace-results');
  const resultCountEl = document.getElementById('marketplace-count');
  const filterCategoryEl = document.getElementById('marketplace-filter-category');
  const filterPriceEl = document.getElementById('marketplace-filter-price');
  const filterQueryEl = document.getElementById('marketplace-filter-query');
  const sortSelectEl = document.getElementById('marketplace-sort');

  if (!resultsContainer) {
    console.warn('Marketplace results container not found, skipping marketplace init');
    return;
  }

  let currentFilters = getFiltersFromURL();
  let isLoading = false;

  // Populate filter inputs from URL
  function populateFiltersFromURL() {
    if (filterQueryEl && currentFilters.q) {
      filterQueryEl.value = currentFilters.q;
    }
    if (filterCategoryEl && currentFilters.category) {
      filterCategoryEl.value = currentFilters.category;
    }
    if (filterPriceEl && currentFilters.budgetMin && currentFilters.budgetMax) {
      // Map budget to price range
      filterPriceEl.value = `${currentFilters.budgetMin}-${currentFilters.budgetMax}`;
    }
    if (sortSelectEl && currentFilters.sort) {
      sortSelectEl.value = currentFilters.sort;
    }
  }

  // Render results
  async function renderResults(append = false) {
    if (isLoading) {
      return;
    }
    isLoading = true;

    // Show skeleton loading
    if (!append) {
      resultsContainer.innerHTML = createSkeletonCards();
    }

    try {
      const data = await searchListings(currentFilters, currentFilters.page);
      const { results, pagination } = data;

      // Track search
      if (!append) {
        trackSearch(currentFilters.q || '', currentFilters, pagination.total);
      }

      // Update result count
      if (resultCountEl) {
        resultCountEl.textContent = `${pagination.total} listing${pagination.total !== 1 ? 's' : ''} found`;
      }

      // Render results or empty state
      if (results.length === 0 && !append) {
        resultsContainer.innerHTML = createEmptyState(currentFilters);
        attachEmptyStateHandlers();
      } else {
        const cardsHTML = results
          .map((listing, index) =>
            createListingCard(listing, (currentFilters.page - 1) * 20 + index + 1)
          )
          .join('');

        if (append) {
          // Remove load more button before appending
          const loadMoreBtn = document.getElementById('marketplace-load-more-btn');
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
      console.error('Render error:', error);
      resultsContainer.innerHTML =
        '<div class="card"><p>Error loading listings. Please try again.</p></div>';
    } finally {
      isLoading = false;
    }
  }

  // Add Load More button
  function addLoadMoreButton(pagination) {
    const existingBtn = document.getElementById('marketplace-load-more-btn');
    if (existingBtn) {
      existingBtn.remove();
    }

    const loadMoreHTML = `
      <div style="text-align: center; margin: 2rem 0;">
        <button id="marketplace-load-more-btn" class="btn btn-secondary">
          Load More (${pagination.page} of ${pagination.totalPages})
        </button>
      </div>
    `;
    resultsContainer.insertAdjacentHTML('beforeend', loadMoreHTML);

    const loadMoreBtn = document.getElementById('marketplace-load-more-btn');
    loadMoreBtn.addEventListener('click', async () => {
      currentFilters.page = (currentFilters.page || 1) + 1;
      await renderResults(true);
    });
  }

  // Attach handlers to listing cards
  function attachCardHandlers() {
    // Shortlist buttons
    resultsContainer.querySelectorAll('.btn-shortlist').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.preventDefault();
        const listingId = btn.dataset.listingId;
        const isActive = btn.classList.contains('btn-shortlist-active');

        if (isActive) {
          await shortlistManager.removeItem('listing', listingId);
          btn.classList.remove('btn-shortlist-active');
          btn.textContent = '♡ Save';
        } else {
          const item = {
            type: 'listing',
            id: listingId,
            name: btn.dataset.listingName,
            category: btn.dataset.listingCategory,
            location: btn.dataset.listingLocation,
            imageUrl: btn.dataset.listingImage,
            priceHint: btn.dataset.listingPrice,
          };
          await shortlistManager.addItem(item);
          btn.classList.add('btn-shortlist-active');
          btn.textContent = '❤️ Saved';
          trackShortlistAdd('listing', listingId);
        }
      });
    });

    // Track result clicks
    resultsContainer.querySelectorAll('.listing-card-link').forEach(link => {
      link.addEventListener('click', _e => {
        const listingId = link.closest('.listing-card').dataset.listingId;
        const position = parseInt(link.dataset.position, 10);
        trackResultClick('listing', listingId, position);
      });
    });
  }

  // Attach handlers to empty state
  function attachEmptyStateHandlers() {
    const clearBtn = document.getElementById('clear-filters-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        currentFilters = { sort: 'newest', page: 1 };
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
        if (sortSelectEl) {
          sortSelectEl.value = 'newest';
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
      // Parse price range (e.g., "0-50", "50-100")
      const range = e.target.value.split('-');
      if (range.length === 2) {
        const min = parseInt(range[0], 10);
        const max = parseInt(range[1], 10);
        if (!isNaN(min) && !isNaN(max)) {
          currentFilters.budgetMin = min;
          currentFilters.budgetMax = max;
        } else {
          delete currentFilters.budgetMin;
          delete currentFilters.budgetMax;
        }
      } else {
        delete currentFilters.budgetMin;
        delete currentFilters.budgetMax;
      }
      currentFilters.page = 1;
      updateURL(currentFilters);
      renderResults();
      trackFilterChange('price', e.target.value);
    });
  }

  // Handle sort changes
  if (sortSelectEl) {
    sortSelectEl.addEventListener('change', e => {
      currentFilters.sort = e.target.value;
      currentFilters.page = 1;
      updateURL(currentFilters);
      renderResults();
      trackFilterChange('sort', e.target.value);
    });
  }

  // Handle browser back/forward
  handlePopState(filters => {
    currentFilters = filters;
    populateFiltersFromURL();
    renderResults();
  });

  // Keep card shortlist buttons in sync whenever the shortlist changes externally
  // (e.g. item removed from the shortlist drawer panel)
  shortlistManager.onChange(() => {
    resultsContainer.querySelectorAll('.btn-shortlist').forEach(btn => {
      const listingId = btn.dataset.listingId;
      const inShortlist = shortlistManager.hasItem('listing', listingId);
      btn.classList.toggle('btn-shortlist-active', inShortlist);
      btn.textContent = inShortlist ? '❤️ Saved' : '♡ Save';
    });
  });

  // Initial render
  populateFiltersFromURL();
  renderResults();
}

// Auto-initialize when DOM is ready, only on marketplace page
function shouldInit() {
  return (
    document.getElementById('marketplace-results') &&
    window.location.pathname.includes('marketplace')
  );
}

if (shouldInit()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMarketplacePage);
  } else {
    initMarketplacePage();
  }
}

export default initMarketplacePage;
