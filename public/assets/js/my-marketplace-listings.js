/**
 * My Marketplace Listings - Gold Standard Implementation
 * Handles listing management, auth state, and "+ List an Item" UX
 */

(function () {
  'use strict';

  let allListings = [];
  let savedListings = [];
  let currentStatus = 'all';
  let currentUser = null;

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  async function init() {
    await checkAuth();
    initAddListingButton();
    initTabSwitching();

    if (currentUser) {
      await Promise.all([loadListings(), loadSavedListings()]);
    }
  }

  /**
   * Check authentication status
   * Handles both wrapped ({user: ...}) and unwrapped response formats
   * Treats 401 as expected logged-out state, not an error
   */
  async function checkAuth() {
    try {
      const res = await fetch('/api/v1/auth/me', {
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      });

      if (res.status === 401) {
        // Expected logged-out state
        currentUser = null;
        showAuthMessage('logged-out');
        return false;
      }

      if (!res.ok) {
        // Network or server error
        currentUser = null;
        showAuthMessage('error');
        return false;
      }

      const data = await res.json();

      // Handle both wrapped ({user: ...}) and unwrapped response formats
      // Check if user property exists and is not null before using it
      if (data.user !== undefined) {
        currentUser = data.user;
      } else if (data.id) {
        // User data is unwrapped (direct user object)
        currentUser = data;
      } else {
        // No valid user data
        currentUser = null;
      }

      if (!currentUser) {
        showAuthMessage('logged-out');
        return false;
      }

      // User is authenticated - clear any auth messages
      clearAuthMessage();
      return true;
    } catch (error) {
      // Network error or other issue - treat as not logged in
      console.error('Auth check failed:', error);
      currentUser = null;
      showAuthMessage('error');
      return false;
    }
  }

  /**
   * Show appropriate auth message based on state
   */
  function showAuthMessage(state) {
    const container = document.getElementById('auth-message-container');
    if (!container) {
      return;
    }

    let message = '';
    let className = 'auth-message';

    if (state === 'logged-out') {
      className += ' info';
      message = `
        <p><strong>Log in to manage your marketplace listings</strong></p>
        <p class="small" style="margin-top: 8px;">
          You need to be logged in to view and manage your marketplace listings.
        </p>
        <a href="/auth?redirect=/my-marketplace-listings" class="cta" style="margin-top: 12px; display: inline-block;">
          Log in or Sign up
        </a>
      `;
    } else if (state === 'error') {
      className += ' error';
      message = `
        <p><strong>Unable to verify your login status</strong></p>
        <p class="small" style="margin-top: 8px;">
          There was a problem connecting to the server. Please check your internet connection and try again.
        </p>
        <button onclick="window.location.reload()" class="cta secondary" style="margin-top: 12px;">
          Reload Page
        </button>
      `;
    } else if (state === 'not-supplier') {
      className += '';
      message = `
        <p><strong>Supplier account required</strong></p>
        <p class="small" style="margin-top: 8px;">
          You need a supplier account to manage marketplace listings. 
          <a href="/for-suppliers">Learn more about becoming a supplier</a> or 
          <a href="/contact">contact support</a> for help.
        </p>
      `;
    }

    container.innerHTML = `<div class="${className}">${message}</div>`;

    // Hide listings container when not authenticated
    if (state === 'logged-out' || state === 'error') {
      const listingsContainer = document.getElementById('my-listings-container');
      if (listingsContainer) {
        listingsContainer.innerHTML = '';
      }
    }
  }

  /**
   * Clear auth message
   */
  function clearAuthMessage() {
    const container = document.getElementById('auth-message-container');
    if (container) {
      container.innerHTML = '';
    }
  }

  /**
   * Initialize the "+ List an Item" button with gold-standard UX
   * Button always has a handler, regardless of auth or listing load state
   */
  function initAddListingButton() {
    const btn = document.getElementById('add-listing-btn');
    if (!btn) {
      return;
    }

    btn.addEventListener('click', async () => {
      // Re-check auth state in case it changed
      if (!currentUser) {
        await checkAuth();
      }

      if (!currentUser) {
        // Logged out - show toast and redirect to auth
        showToast('Please log in to list items');
        setTimeout(() => {
          window.location.href = '/auth?redirect=/my-marketplace-listings';
        }, 1500);
        return;
      }

      // Check if user has supplier role (optional check - can be removed if any user can list)
      // For now, allow any authenticated user to list items

      // Navigate to dedicated listing creation page
      window.location.href = '/supplier/marketplace-new-listing';
    });
  }

  /**
   * Load user's marketplace listings
   * Handles 401 gracefully with clear messaging
   */
  async function loadListings() {
    const container = document.getElementById('my-listings-container');
    if (!container) {
      return;
    }

    try {
      const res = await fetch('/api/v1/marketplace/my-listings', {
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      });

      if (res.status === 401) {
        // User is not authenticated or session expired
        currentUser = null;
        showAuthMessage('logged-out');
        return;
      }

      if (res.status === 403) {
        // User is authenticated but not authorized (e.g., not a supplier)
        showAuthMessage('not-supplier');
        container.innerHTML = '';
        return;
      }

      if (!res.ok) {
        throw new Error(`Failed to fetch listings: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      allListings = data.listings || [];
      renderListings();
    } catch (error) {
      console.error('Error loading listings:', error);
      container.innerHTML = `
        <div class="card">
          <p class="error" style="text-align: center; padding: 2rem;">
            <strong>Failed to load your listings</strong><br>
            <span class="small" style="display: block; margin-top: 8px;">
              ${error.message || 'An unexpected error occurred. Please try again.'}
            </span>
            <button onclick="window.location.reload()" class="cta secondary" style="margin-top: 16px;">
              Reload Page
            </button>
          </p>
        </div>
      `;
    }
  }

  /**
   * Load user's saved marketplace items
   */
  async function loadSavedListings() {
    try {
      const res = await fetch('/api/v1/marketplace/saved', {
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      });

      if (res.status === 401) {
        currentUser = null;
        showAuthMessage('logged-out');
        return;
      }

      if (!res.ok) {
        throw new Error(`Failed to fetch saved items: ${res.status}`);
      }

      const data = await res.json();
      savedListings = data.savedItems || [];

      if (currentStatus === 'saved') {
        renderListings();
      }
    } catch (error) {
      console.error('Error loading saved marketplace listings:', error);
      if (currentStatus === 'saved') {
        const container = document.getElementById('my-listings-container');
        if (container) {
          container.innerHTML = `
            <div class="card" style="text-align: center; padding: 2rem;">
              <p class="error">Unable to load saved items right now.</p>
            </div>
          `;
        }
      }
    }
  }

  /**
   * Render listings based on current filter
   */
  function renderListings() {
    const container = document.getElementById('my-listings-container');
    if (!container) {
      return;
    }

    const isSavedTab = currentStatus === 'saved';
    let filtered = allListings;

    if (!isSavedTab && currentStatus !== 'all') {
      filtered = filtered.filter(l => l.status === currentStatus);
    }

    if (isSavedTab && savedListings.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 3rem;">
          <h3>No saved items yet</h3>
          <p class="small">Tap the heart icon on marketplace listings to save items here.</p>
          <a href="/marketplace" class="cta" style="margin-top: 1rem; display: inline-flex;">Browse Marketplace</a>
        </div>
      `;
      return;
    }

    if (!isSavedTab && filtered.length === 0) {
      const message =
        currentStatus === 'all'
          ? 'Create your first listing to get started!'
          : `No ${currentStatus} listings found.`;

      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 3rem;">
          <h3>No listings found</h3>
          <p class="small">${message}</p>
          ${
            currentStatus === 'all'
              ? `
            <button class="cta" onclick="window.location.href='/supplier/marketplace-new-listing'" style="margin-top: 1rem;">
              + List an Item
            </button>
          `
              : ''
          }
        </div>
      `;
      return;
    }

    if (isSavedTab) {
      container.innerHTML = savedListings.map(item => createSavedListingCard(item)).join('');
      return;
    }

    container.innerHTML = filtered.map(listing => createListingCard(listing)).join('');
  }

  /**
   * Create listing card HTML with tags
   */
  function createListingCard(listing) {
    const defaultImage = '/assets/images/collage-venue.jpg';
    const image = listing.images && listing.images[0] ? listing.images[0] : defaultImage;
    const timeAgo = getTimeAgo(listing.createdAt);

    // Generate tags
    const tags = [];
    if (listing.category) {
      tags.push(`<span class="marketplace-tag">${formatCategory(listing.category)}</span>`);
    }
    if (listing.location) {
      tags.push(`<span class="marketplace-tag">📍 ${escapeHtml(listing.location)}</span>`);
    }
    if (listing.condition) {
      tags.push(`<span class="marketplace-tag">${formatCondition(listing.condition)}</span>`);
    }

    return `
      <div class="listing-card">
        <img src="${image}" alt="${escapeHtml(listing.title)}" class="listing-card-image" data-fallback-src="${defaultImage}">
        <div class="listing-card-info">
          <span class="status-badge status-${listing.status}">${formatStatus(listing.status)}</span>
          <h3>${escapeHtml(listing.title)}</h3>
          <p class="small">${escapeHtml(listing.description.slice(0, 150))}${listing.description.length > 150 ? '...' : ''}</p>
          <div class="listing-card-meta">
            <span><strong>£${listing.price.toFixed(2)}</strong></span>
            <span>Listed ${timeAgo}</span>
            ${!listing.approved ? '<span style="color: #dc2626;">⚠️ Awaiting approval</span>' : ''}
          </div>
          ${tags.length > 0 ? `<div class="marketplace-item-tags">${tags.join('')}</div>` : ''}
        </div>
        <div class="listing-card-actions">
          ${
            listing.status === 'active'
              ? `
            <button class="cta secondary" onclick="window.MyListings.markAsSold('${listing.id}')">Mark as Sold</button>
          `
              : ''
          }
          <button class="cta ghost" onclick="window.MyListings.editListing('${listing.id}')">Edit</button>
          <button class="cta ghost" onclick="window.MyListings.deleteListing('${listing.id}')" style="color: #dc2626;">Delete</button>
        </div>
      </div>
    `;
  }

  function createSavedListingCard(savedItem) {
    const listing = savedItem.listing || {};
    const defaultImage = '/assets/images/collage-venue.jpg';
    const image = listing.images && listing.images[0] ? listing.images[0] : defaultImage;
    const savedAt = savedItem.savedAt
      ? new Date(savedItem.savedAt).toLocaleDateString('en-GB')
      : 'Recently';

    return `
      <div class="listing-card">
        <img src="${image}" alt="${escapeHtml(listing.title || 'Saved listing')}" class="listing-card-image" data-fallback-src="${defaultImage}">
        <div class="listing-card-info">
          <span class="status-badge status-${listing.status || 'active'}">Saved Item</span>
          <h3>${escapeHtml(listing.title || 'Listing unavailable')}</h3>
          <p class="small">${escapeHtml((listing.description || 'This listing may have been removed.').slice(0, 150))}</p>
          <div class="listing-card-meta">
            <span><strong>${Number.isFinite(Number(listing.price)) ? `£${Number(listing.price).toFixed(2)}` : 'Price on request'}</strong></span>
            <span>Saved on ${savedAt}</span>
            ${listing.location ? `<span>📍 ${escapeHtml(listing.location)}</span>` : ''}
          </div>
        </div>
        <div class="listing-card-actions">
          <a class="cta secondary" href="/marketplace">View in Marketplace</a>
          <button class="cta ghost" onclick="window.MyListings.unsaveListing('${savedItem.id}')">Remove Saved</button>
        </div>
      </div>
    `;
  }

  /**
   * Mark listing as sold
   */
  async function markAsSold(id) {
    if (!confirm('Mark this listing as sold?')) {
      return;
    }

    try {
      const res = await fetch(`/api/v1/marketplace/listings/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
        },
        credentials: 'include',
        body: JSON.stringify({ status: 'sold' }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update listing');
      }

      showToast('Listing marked as sold');
      await loadListings();
    } catch (error) {
      console.error('Error updating listing:', error);
      showToast(error.message || 'Failed to update listing', 'error');
    }
  }

  /**
   * Delete listing
   */
  async function deleteListing(id) {
    if (!confirm('Are you sure you want to delete this listing? This cannot be undone.')) {
      return;
    }

    try {
      const res = await fetch(`/api/v1/marketplace/listings/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
        },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to delete listing');
      }

      showToast('Listing deleted');
      await loadListings();
    } catch (error) {
      console.error('Error deleting listing:', error);
      showToast(error.message || 'Failed to delete listing', 'error');
    }
  }

  /**
   * Edit listing - navigate to edit page or show modal
   */
  function editListing(id) {
    // For now, navigate to the new listing page with edit mode
    window.location.href = `/supplier/marketplace-new-listing?edit=${id}`;
  }

  /**
   * Initialize tab switching
   */
  function initTabSwitching() {
    document.querySelectorAll('.my-listings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.my-listings-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentStatus = tab.dataset.status;
        renderListings();
      });
    });
  }

  async function unsaveListing(listingId) {
    if (!listingId) {
      return;
    }

    try {
      const res = await fetch(`/api/v1/marketplace/saved/${encodeURIComponent(listingId)}`, {
        method: 'DELETE',
        headers: {
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
        },
        credentials: 'include',
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to remove saved item');
      }

      savedListings = savedListings.filter(item => item.id !== listingId);
      showToast('Removed from saved items');
      renderListings();
    } catch (error) {
      console.error('Error unsaving listing:', error);
      showToast(error.message || 'Unable to remove saved item', 'error');
    }
  }

  // Helper functions
  function getTimeAgo(dateString) {
    const seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
    const intervals = {
      year: 31536000,
      month: 2592000,
      week: 604800,
      day: 86400,
      hour: 3600,
      minute: 60,
    };

    for (const [name, secondsInInterval] of Object.entries(intervals)) {
      const interval = Math.floor(seconds / secondsInInterval);
      if (interval >= 1) {
        return `${interval} ${name}${interval > 1 ? 's' : ''} ago`;
      }
    }
    return 'Just now';
  }

  function formatCondition(condition) {
    const map = {
      new: 'New',
      'like-new': 'Like New',
      good: 'Good',
      fair: 'Fair',
    };
    return map[condition] || condition;
  }

  function formatCategory(category) {
    const map = {
      attire: 'Attire',
      decor: 'Décor',
      'av-equipment': 'AV Equipment',
      photography: 'Photography',
      'party-supplies': 'Party Supplies',
      florals: 'Florals',
    };
    return map[category] || category;
  }

  function formatStatus(status) {
    const map = {
      pending: 'Pending',
      active: 'Active',
      sold: 'Sold',
      removed: 'Removed',
    };
    return map[status] || status;
  }

  function escapeHtml(text) {
    if (!text) {
      return '';
    }
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'error' ? '#dc2626' : '#16a34a'};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10000;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // Expose functions that need to be called from HTML onclick handlers
  window.MyListings = {
    markAsSold,
    deleteListing,
    editListing,
    unsaveListing,
  };
})();
