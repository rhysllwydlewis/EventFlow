/**
 * EventFlow Marketplace - Interactive features
 * Handles map, filters, search, view toggling, and real listings
 */

(function () {
  'use strict';

  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  let allListings = [];
  let currentUser = null;
  let savedListingIds = new Set();
  let pendingListingId = null;

  // Issue 2 Fix: Initialization guards to prevent multiple calls
  let isInitialized = false;
  let isLoadingListings = false;

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  async function init() {
    // Issue 2 Fix: Prevent multiple initializations
    if (isInitialized) {
      console.warn('[Marketplace] Already initialized');
      return;
    }
    isInitialized = true;

    hydrateFiltersFromUrl();
    pendingListingId = new URLSearchParams(window.location.search).get('listing');
    await checkAuth();
    await loadSavedListings();
    await loadListings();
    initLocationModal();
    initFilters();
    initViewToggle();
    initQuickActions();
    initMobileFilters();
    loadSavedLocation();

    // Expose showListItemModal globally for onclick handlers after initialization
    // Note: Required for dynamically generated HTML with onclick handlers (e.g., empty state button)
    // Alternative would require refactoring to use event delegation or data attributes
    window.showListItemModal = showListItemModal;
  }

  // Check if user is logged in
  async function checkAuth() {
    try {
      let res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (res.status === 404) {
        // Backward compatibility for environments using /api/auth/me only
        res = await fetch('/api/auth/me', { credentials: 'include' });
      }

      if (res.ok) {
        const data = await res.json();
        if (
          data &&
          typeof data === 'object' &&
          Object.prototype.hasOwnProperty.call(data, 'user')
        ) {
          currentUser = data.user;
        } else if (data && data.id) {
          currentUser = data;
        } else {
          currentUser = null;
        }
        updateAuthUI();
      } else if (res.status === 401) {
        // User not logged in - this is expected, not an error
        currentUser = null;
        updateAuthUI();
      } else {
        currentUser = null;
        updateAuthUI();
      }
    } catch (error) {
      // Network error or other issue - treat as not logged in
      console.error('Auth check failed:', error);
      currentUser = null;
      updateAuthUI();
    }
  }

  // Update UI based on auth status
  function updateAuthUI() {
    const authCta = document.getElementById('auth-cta');
    const sellBtn = document.getElementById('sell-item-btn');
    const myListingsLink = document.getElementById('my-listings-link');
    const ctaSection = document.getElementById('marketplace-cta-section');
    const listBtn = document.getElementById('marketplace-list-btn');

    if (currentUser) {
      // Hide entire CTA section for logged-in users
      if (ctaSection) {
        ctaSection.style.display = 'none';
      }
      if (authCta) {
        authCta.style.display = 'none';
      }
      if (sellBtn) {
        sellBtn.textContent = 'List an Item';
        sellBtn.onclick = () => {
          window.location.href = '/supplier/marketplace-new-listing';
        };
      }
      if (myListingsLink) {
        myListingsLink.style.display = 'flex';
      }
      if (listBtn) {
        listBtn.style.display = 'inline-flex';
      }
    } else {
      // Show CTA section for logged-out users
      if (ctaSection) {
        ctaSection.style.display = 'block';
      }
      if (authCta) {
        authCta.style.display = 'inline-flex';
      }
      if (sellBtn) {
        sellBtn.onclick = () => {
          showToast('Please log in to list items');
          setTimeout(() => (window.location.href = '/auth'), 1500);
        };
      }
      if (myListingsLink) {
        myListingsLink.style.display = 'none';
      }
      if (listBtn) {
        listBtn.style.display = 'none';
      }
    }
  }

  // Load marketplace listings
  async function loadListings() {
    // Issue 2 Fix: Prevent multiple simultaneous loading calls
    if (isLoadingListings) {
      if (isDevelopment) {
        console.log('[Marketplace] Already loading, skipping...');
      }
      return;
    }
    isLoadingListings = true;

    try {
      // Issue 2 Fix: Show loading skeleton immediately
      showLoadingSkeleton();

      const params = new URLSearchParams();
      const categoryFilter = document.getElementById('marketplace-filter-category');
      const priceFilter = document.getElementById('marketplace-filter-price');
      const conditionFilter = document.getElementById('marketplace-filter-condition');
      const queryInput = document.getElementById('marketplace-filter-query');
      const sortSelect = document.getElementById('marketplace-sort');

      if (categoryFilter && categoryFilter.value) {
        params.append('category', categoryFilter.value);
      }
      if (conditionFilter && conditionFilter.value) {
        params.append('condition', conditionFilter.value);
      }
      if (queryInput && queryInput.value) {
        params.append('search', queryInput.value);
      }
      if (sortSelect && sortSelect.value) {
        params.append('sort', normalizeSortValue(sortSelect.value));
      }

      // Handle price filter
      if (priceFilter && priceFilter.value) {
        const priceRange = priceFilter.value;
        if (priceRange === '0-50') {
          params.append('minPrice', '0');
          params.append('maxPrice', '50');
        } else if (priceRange === '50-100') {
          params.append('minPrice', '50');
          params.append('maxPrice', '100');
        } else if (priceRange === '100-250') {
          params.append('minPrice', '100');
          params.append('maxPrice', '250');
        } else if (priceRange === '250-500') {
          params.append('minPrice', '250');
          params.append('maxPrice', '500');
        } else if (priceRange === '500-plus') {
          params.append('minPrice', '500');
        }
      }

      const res = await fetch(`/api/v1/marketplace/listings?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Failed to fetch listings');
      }

      // Check content type before parsing JSON
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn('Response is not JSON:', contentType);
        throw new Error('Invalid response format');
      }

      const data = await res.json();
      allListings = data.listings || [];
      renderListings();
      updateResultCount();
      await maybeOpenListingFromUrl();
    } catch (error) {
      console.error('Error loading listings:', error);
      const resultsContainer = document.getElementById('marketplace-results');
      if (resultsContainer) {
        resultsContainer.innerHTML = `
          <div class="card" style="text-align: center; padding: 2rem;">
            <p>Unable to load listings. Please try again later.</p>
          </div>
        `;
      }
    } finally {
      isLoadingListings = false;
    }
  }

  // Issue 2 Fix: Show loading skeleton while fetching data
  function showLoadingSkeleton() {
    const resultsContainer = document.getElementById('marketplace-results');
    if (!resultsContainer) {
      return;
    }

    const skeletonHTML = `
      <div class="marketplace-skeleton">
        ${Array(6)
          .fill(0)
          .map(
            () => `
          <div class="marketplace-skeleton-card">
            <div class="skeleton-image"></div>
            <div class="skeleton-content">
              <div class="skeleton-text skeleton-title"></div>
              <div class="skeleton-text"></div>
              <div class="skeleton-text skeleton-short"></div>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;

    resultsContainer.innerHTML = skeletonHTML;
  }

  // Render listings
  function renderListings() {
    const resultsContainer = document.getElementById('marketplace-results');
    if (!resultsContainer) {
      return;
    }

    if (allListings.length === 0) {
      resultsContainer.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-state-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          </div>
          <h3 class="empty-state-title">No listings yet</h3>
          <p class="empty-state-message">
            ${currentUser ? 'Be the first to list a pre-loved event item and help others save money!' : 'Check back soon for new listings or create an account to list your items.'}
          </p>
          ${currentUser ? '<a href="/supplier/marketplace-new-listing" class="btn btn-primary">List Your First Item</a>' : '<a href="/auth" class="btn btn-primary">Create Account</a>'}
        </div>
      `;
      return;
    }

    resultsContainer.innerHTML = allListings.map(listing => createListingCard(listing)).join('');

    // Re-attach event listeners
    document.querySelectorAll('.marketplace-item-card').forEach((card, index) => {
      card.addEventListener('click', () => showListingDetail(allListings[index]));
    });

    document.querySelectorAll('.marketplace-save-btn').forEach((btn, index) => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        toggleSave(btn, allListings[index]);
      });
    });
  }

  function getListingImages(listing) {
    if (!listing || typeof listing !== 'object') {
      return ['/assets/images/marketplace-placeholder.svg'];
    }

    const normalizeImages = value =>
      (Array.isArray(value) ? value : [])
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);

    const images = normalizeImages(listing.images);
    if (images.length > 0) {
      return images;
    }

    const photos = normalizeImages(listing.photos);
    if (photos.length > 0) {
      return photos;
    }

    if (typeof listing.image === 'string' && listing.image.trim()) {
      return [listing.image.trim()];
    }

    // Return placeholder if no images
    return ['/assets/images/marketplace-placeholder.svg'];
  }

  // Create listing card HTML
  function createListingCard(listing) {
    const timeAgo = getTimeAgo(listing.createdAt);
    const defaultImage = '/assets/images/collage-venue.jpg';
    const images = getListingImages(listing);
    const image = images[0] || defaultImage;
    const title = listing.title || 'Untitled listing';
    const formattedPrice = formatPrice(listing.price);

    // Category icon mapping
    const categoryIcons = {
      attire: '👗',
      decor: '🎨',
      'av-equipment': '🔊',
      photography: '📸',
      'party-supplies': '🎉',
      florals: '🌸',
    };

    // Generate tags (category, location, condition)
    const tags = [];
    if (listing.category) {
      const icon = categoryIcons[listing.category] || '📦';
      tags.push(`<span class="marketplace-tag">${icon} ${formatCategory(listing.category)}</span>`);
    }
    if (listing.location) {
      tags.push(`<span class="marketplace-tag">📍 ${escapeHtml(listing.location)}</span>`);
    }
    if (listing.condition) {
      tags.push(`<span class="marketplace-tag">${formatCondition(listing.condition)}</span>`);
    }

    const isSaved = savedListingIds.has(listing.id);

    return `
      <div class="marketplace-item-card" data-listing-id="${listing.id}">
        <div class="marketplace-item-image">
          <img src="${image}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.src='${defaultImage}'">
          <button class="marketplace-save-btn ${isSaved ? 'saved' : ''}" aria-label="${isSaved ? 'Unsave item' : 'Save item'}" aria-pressed="${isSaved}" title="${isSaved ? 'Unsave' : 'Save'} item">${isSaved ? '♥' : '♡'}</button>
        </div>
        <div class="marketplace-item-details">
          <div class="marketplace-item-price">${formattedPrice}</div>
          <h3 class="marketplace-item-title">${escapeHtml(title)}</h3>
          ${tags.length > 0 ? `<div class="marketplace-item-tags">${tags.join('')}</div>` : ''}
          <div class="marketplace-item-time">Listed ${timeAgo}</div>
        </div>
      </div>
    `;
  }

  function formatPrice(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 'Price on request';
    }

    return `£${number.toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  // Show listing detail modal (Facebook-style split-pane)
  function showListingDetail(listing) {
    const overlay = document.createElement('div');
    overlay.className = 'listing-detail-overlay';

    const listingImages = getListingImages(listing);
    const images = listingImages.length ? listingImages : ['/assets/images/collage-venue.jpg'];

    const thumbnailsHTML =
      images.length > 1
        ? `<div class="listing-detail-thumbnails">
          ${images
            .map(
              (img, idx) => `
            <div class="listing-detail-thumbnail ${idx === 0 ? 'active' : ''}" data-index="${idx}">
              <img src="${img}" alt="Image ${idx + 1}">
            </div>
          `
            )
            .join('')}
         </div>`
        : '';

    overlay.innerHTML = `
      <div class="listing-detail-container">
        <div class="listing-detail-gallery">
          <div class="listing-detail-main-image">
            <img id="main-listing-image" src="${images[0]}" alt="${escapeHtml(listing.title)}">
          </div>
          ${thumbnailsHTML}
        </div>
        <div class="listing-detail-sidebar">
          <div class="listing-detail-header">
            <div class="listing-detail-header-content">
              <div class="listing-detail-price">${formatPrice(listing.price)}</div>
              <h2 class="listing-detail-title">${escapeHtml(listing.title)}</h2>
            </div>
            <button class="listing-detail-close" aria-label="Close">&times;</button>
          </div>
          <div class="listing-detail-body">
            <div class="listing-detail-meta">
              <div class="listing-detail-meta-item">
                <span class="listing-detail-meta-label">Condition:</span>
                <span>${formatCondition(listing.condition)}</span>
              </div>
              <div class="listing-detail-meta-item">
                <span class="listing-detail-meta-label">Category:</span>
                <span>${formatCategory(listing.category)}</span>
              </div>
              <div class="listing-detail-meta-item">
                <span class="listing-detail-meta-label">Location:</span>
                <span>📍 ${escapeHtml(listing.location || 'Location not specified')}</span>
              </div>
              <div class="listing-detail-meta-item">
                <span class="listing-detail-meta-label">Listed:</span>
                <span>${getTimeAgo(listing.createdAt)}</span>
              </div>
            </div>
            <div class="listing-detail-description">
              <h4>Description</h4>
              <p>${escapeHtml(listing.description)}</p>
            </div>
            
            <!-- Share Buttons -->
            <div class="listing-detail-share">
              <h4 class="listing-detail-share-title">Share this listing</h4>
              <div class="listing-detail-share-actions">
                <button onclick="shareOnFacebook('${listing.id}')" class="btn-share" type="button">
                  📘 Facebook
                </button>
                <button onclick="shareOnTwitter('${escapeHtml(listing.title)}', '${listing.id}')" class="btn-share" type="button">
                  🐦 Twitter
                </button>
                <button onclick="copyListingLink('${listing.id}')" class="btn-share" type="button">
                  🔗 Copy Link
                </button>
              </div>
            </div>
          </div>
          <div class="listing-detail-actions">
            ${
              currentUser && currentUser.id !== resolveListingSellerUserId(listing)
                ? `<button class="cta listing-message-toggle" type="button"
                          data-quick-compose="true"
                          data-recipient-id="${escapeHtml(resolveListingSellerUserId(listing) || '')}"
                          data-context-type="marketplace_listing"
                          data-context-id="${escapeHtml(listing.id)}"
                          data-context-title="${escapeHtml(listing.title)}"
                          data-prefill="${escapeHtml(buildInitialMarketplaceMessage(listing.title))}">
                     Contact Seller
                   </button>
                   <div class="listing-inline-composer" hidden>
                     <p class="listing-inline-composer-intro">Send a message about <strong>${escapeHtml(listing.title)}</strong>.</p>
                     <textarea class="listing-inline-composer-input" maxlength="2000" rows="5" placeholder="Type your message...">${escapeHtml(buildInitialMarketplaceMessage(listing.title))}</textarea>
                     <div class="listing-inline-composer-status" aria-live="polite"></div>
                     <div class="listing-inline-composer-actions">
                       <button class="btn btn-secondary listing-inline-composer-cancel" type="button">Cancel</button>
                       <button class="cta listing-inline-composer-send" type="button">Send Message</button>
                     </div>
                   </div>`
                : currentUser && currentUser.id === resolveListingSellerUserId(listing)
                  ? `<div class="listing-own-notice">
                       <p>This is your listing</p>
                       <div class="listing-own-notice-actions">
                         <a href="/supplier/marketplace-new-listing?edit=${listing.id}" class="btn btn-secondary">Edit Listing</a>
                         <a href="/my-marketplace-listings" class="btn btn-secondary">View My Listings</a>
                       </div>
                     </div>`
                  : `<a href="/auth?redirect=${encodeURIComponent(`/marketplace?listing=${listing.id}`)}" class="cta">Log in to message seller</a>`
            }
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Trigger animation
    setTimeout(() => overlay.classList.add('active'), 10);

    // Attach QuickComposeV4 to any compose triggers in the overlay
    if (window.QuickComposeV4 && typeof window.QuickComposeV4.attachAll === 'function') {
      window.QuickComposeV4.attachAll();
    }

    // Close button
    const closeBtn = overlay.querySelector('.listing-detail-close');
    closeBtn.addEventListener('click', () => closeModal(overlay));

    // Background click
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        closeModal(overlay);
      }
    });

    // Escape key
    const handleEscape = e => {
      if (e.key === 'Escape') {
        closeModal(overlay);
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

    const messageToggleBtn = overlay.querySelector('.listing-message-toggle');
    const inlineComposer = overlay.querySelector('.listing-inline-composer');

    if (messageToggleBtn && inlineComposer) {
      // If QuickComposeV4 is handling this button, skip inline composer setup
      if (messageToggleBtn.dataset.quickCompose !== 'true' || !window.QuickComposeV4) {
        const composerInput = inlineComposer.querySelector('.listing-inline-composer-input');
        const composerStatus = inlineComposer.querySelector('.listing-inline-composer-status');
        const composerSendBtn = inlineComposer.querySelector('.listing-inline-composer-send');
        const composerCancelBtn = inlineComposer.querySelector('.listing-inline-composer-cancel');

        const hideComposer = () => {
          inlineComposer.classList.remove('open');
          setTimeout(() => {
            inlineComposer.hidden = true;
            messageToggleBtn.hidden = false;
          }, 220);
        };

        messageToggleBtn.addEventListener('click', () => {
          inlineComposer.hidden = false;
          requestAnimationFrame(() => inlineComposer.classList.add('open'));
          messageToggleBtn.hidden = true;
          composerInput.focus();
          composerInput.setSelectionRange(composerInput.value.length, composerInput.value.length);
        });

        composerCancelBtn.addEventListener('click', hideComposer);

        composerSendBtn.addEventListener('click', async () => {
          const message = composerInput.value.trim();
          if (!message) {
            composerStatus.textContent = 'Please enter a message.';
            composerStatus.style.color = '#dc2626';
            return;
          }

          await submitMarketplaceMessage({
            listing,
            listingTitle: listing.title,
            message,
            statusEl: composerStatus,
            sendBtn: composerSendBtn,
          });
        });
      } // end if inline composer
    }

    // Thumbnail clicks
    const thumbnails = overlay.querySelectorAll('.listing-detail-thumbnail');
    const mainImage = overlay.querySelector('#main-listing-image');
    thumbnails.forEach((thumb, idx) => {
      thumb.addEventListener('click', () => {
        thumbnails.forEach(t => t.classList.remove('active'));
        thumb.classList.add('active');
        mainImage.src = images[idx];
      });
    });
  }

  function closeModal(overlay) {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  }

  function buildInitialMarketplaceMessage(listingTitle) {
    return `Hi, I'm interested in your listing: ${listingTitle}`;
  }

  function resolveListingSellerUserId(listing) {
    if (!listing || typeof listing !== 'object') {
      return null;
    }

    const candidate = listing.sellerUserId || listing.userId || listing.ownerUserId || null;
    if (candidate) {
      return String(candidate);
    }

    if (listing.createdBy && !String(listing.createdBy).includes('@')) {
      return String(listing.createdBy);
    }

    return null;
  }

  async function fetchCsrfToken() {
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }

    const csrfRes = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    if (!csrfRes.ok) {
      throw new Error('Failed to fetch CSRF token');
    }

    const csrfData = await csrfRes.json();
    window.__CSRF_TOKEN__ = csrfData.csrfToken;
    return csrfData.csrfToken;
  }

  async function submitMarketplaceMessage({ listing, listingTitle, message, statusEl, sendBtn }) {
    try {
      sendBtn.disabled = true;
      statusEl.textContent = 'Sending...';
      statusEl.style.color = '#6b7280';

      const sellerUserId = resolveListingSellerUserId(listing);

      const sellerSupplierId = listing.sellerSupplierId || listing.supplierId || null;

      if (!sellerUserId && !sellerSupplierId) {
        throw new Error('This listing is missing seller details. Please contact support.');
      }

      const csrfToken = await fetchCsrfToken();

      // Use v4 API for conversation creation (2-step: create conversation, then send message)
      const threadRes = await fetch('/api/v4/messenger/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          type: 'marketplace',
          participantIds: [sellerUserId],
          context: {
            type: 'marketplace_listing',
            referenceId: listing.id,
            referenceTitle: listingTitle,
          },
        }),
      });

      let conversationId = null;

      if (threadRes.ok) {
        // v4 API succeeded - now send the initial message
        const data = await threadRes.json();
        conversationId = data.conversation?._id || data.conversation?.id;

        if (conversationId && message.trim()) {
          // Step 2: Send initial message to the conversation
          try {
            await fetch(`/api/v4/messenger/conversations/${conversationId}/messages`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
              },
              credentials: 'include',
              body: JSON.stringify({ content: message.trim() }),
            });
          } catch (msgError) {
            console.error('Failed to send initial message:', msgError);
            // Continue anyway - conversation was created
          }
        }
      } else {
        const data = await threadRes.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'Failed to start conversation');
      }

      // Show success message instead of redirecting
      statusEl.textContent = '✓ Message sent!';
      statusEl.style.color = '#10b981';

      // Change button to "Go to Conversation"
      sendBtn.textContent = 'Go to Conversation';
      sendBtn.disabled = false;
      sendBtn.onclick = () => {
        window.location.href = `/messenger/?conversation=${conversationId}`;
      };
    } catch (error) {
      console.error('Error messaging seller:', error);
      statusEl.textContent = error?.message || 'Failed to send message. Please try again.';
      statusEl.style.color = '#dc2626';
      sendBtn.disabled = false;
    }
  }

  // Show list item modal
  async function showListItemModal() {
    // Fetch CSRF token first
    let csrfToken = '';
    try {
      const csrfRes = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      if (csrfRes.ok) {
        const csrfData = await csrfRes.json();
        csrfToken = csrfData.csrfToken;
        window.__CSRF_TOKEN__ = csrfData.csrfToken;
      }
    } catch (error) {
      console.error('Failed to fetch CSRF token:', error);
      showToast('Unable to load form. Please try again.', 'error');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header">
          <h2>List an Item</h2>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
          <form id="list-item-form">
            <div style="margin-bottom: 16px;">
              <label for="item-title">Title *</label>
              <input type="text" id="item-title" required maxlength="100" 
                     placeholder="e.g. Ivory Wedding Dress, Size 10">
            </div>
            <div style="margin-bottom: 16px;">
              <label for="item-description">Description *</label>
              <textarea id="item-description" required maxlength="1000" rows="4"
                        placeholder="Describe your item in detail..."></textarea>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
              <div>
                <label for="item-price">Price (£) *</label>
                <input type="number" id="item-price" required min="0" step="0.01" placeholder="0.00">
              </div>
              <div>
                <label for="item-location">Location</label>
                <input type="text" id="item-location" maxlength="100" placeholder="e.g. London">
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
              <div>
                <label for="item-category">Category *</label>
                <select id="item-category" required>
                  <option value="">Select category</option>
                  <option value="attire">Attire</option>
                  <option value="decor">Décor</option>
                  <option value="av-equipment">AV Equipment</option>
                  <option value="photography">Photography</option>
                  <option value="party-supplies">Party Supplies</option>
                  <option value="florals">Florals</option>
                </select>
              </div>
              <div>
                <label for="item-condition">Condition *</label>
                <select id="item-condition" required>
                  <option value="">Select condition</option>
                  <option value="new">New / Unused</option>
                  <option value="like-new">Like New</option>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                </select>
              </div>
            </div>
            <div style="margin-bottom: 16px;">
              <label for="item-images">Images (Optional)</label>
              <input type="file" id="item-images" accept="image/*" multiple style="margin-bottom: 8px;">
              <p class="small" style="color: #6b7280; margin: 0;">
                Upload up to 5 images (JPG, PNG, max 5MB each). First image will be the main photo.
              </p>
              <div id="image-preview" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px;"></div>
            </div>
            <p class="small" style="color: #6b7280; margin-bottom: 16px;">
              Your listing will be reviewed by our team before it appears on the marketplace.
            </p>
            <div style="display: flex; gap: 8px;">
              <button type="submit" class="cta">Submit Listing</button>
              <button type="button" class="cta secondary" onclick="this.closest('.modal-overlay').remove()">
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    // Apply styles
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 20px;
    `;

    const modalContent = modal.querySelector('.modal-content');
    modalContent.style.cssText = `
      background: white;
      border-radius: 12px;
      max-width: 600px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
    `;

    const modalHeader = modal.querySelector('.modal-header');
    modalHeader.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px;
      border-bottom: 1px solid #e5e7eb;
    `;

    const modalBody = modal.querySelector('.modal-body');
    modalBody.style.cssText = 'padding: 20px;';

    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.style.cssText = `
      background: none;
      border: none;
      font-size: 28px;
      cursor: pointer;
      color: #6b7280;
      line-height: 1;
      padding: 0;
      width: 32px;
      height: 32px;
    `;

    document.body.appendChild(modal);

    // Handle image upload and preview
    const imageInput = document.getElementById('item-images');
    const imagePreview = document.getElementById('image-preview');
    let selectedImages = [];

    imageInput.addEventListener('change', async e => {
      const files = Array.from(e.target.files).slice(0, 5); // Max 5 images
      selectedImages = [];
      imagePreview.innerHTML = '';

      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) {
          showToast('Image must be under 5MB', 'error');
          continue;
        }

        // Convert to base64 for preview and storage
        const reader = new FileReader();
        reader.onload = function (event) {
          const base64 = event.target.result;
          selectedImages.push(base64);

          // Create preview
          const preview = document.createElement('div');
          preview.style.cssText = `
            position: relative;
            width: 80px;
            height: 80px;
            border-radius: 4px;
            overflow: hidden;
            border: 1px solid #e5e7eb;
          `;
          preview.innerHTML = `
            <img src="${base64}" style="width: 100%; height: 100%; object-fit: cover;">
            <button type="button" style="position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 12px; line-height: 1;" onclick="this.parentElement.remove()">×</button>
          `;
          imagePreview.appendChild(preview);
        };
        reader.readAsDataURL(file);
      }
    });

    // Handle form submission
    const form = document.getElementById('list-item-form');
    form.addEventListener('submit', async e => {
      e.preventDefault();

      const listing = {
        title: document.getElementById('item-title').value,
        description: document.getElementById('item-description').value,
        price: parseFloat(document.getElementById('item-price').value),
        location: document.getElementById('item-location').value,
        category: document.getElementById('item-category').value,
        condition: document.getElementById('item-condition').value,
        images: selectedImages,
      };

      try {
        const res = await fetch('/api/v1/marketplace/listings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify(listing),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          const errorMessage = errorData.error || 'Failed to create listing';

          // Handle specific error cases
          if (res.status === 401) {
            showToast('Please log in to list items', 'error');
            setTimeout(() => (window.location.href = '/auth'), 1500);
            return;
          } else if (res.status === 403) {
            showToast('Session expired. Please log in again.', 'error');
            setTimeout(() => (window.location.href = '/auth'), 1500);
            return;
          }

          throw new Error(errorMessage);
        }

        modal.remove();
        showToast('Listing created successfully!');
        setTimeout(() => loadListings(), 1500);
      } catch (error) {
        console.error('Error creating listing:', error);
        showToast(error.message || 'Failed to create listing', 'error');
      }
    });

    // Close on background click
    modal.addEventListener('click', e => {
      if (e.target === modal) {
        modal.remove();
      }
    });
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
      new: 'New / Unused',
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

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async function maybeOpenListingFromUrl() {
    if (!pendingListingId) {
      return;
    }

    const listingIdToOpen = pendingListingId;
    pendingListingId = null;

    let listing = allListings.find(item => item.id === listingIdToOpen);

    if (!listing) {
      try {
        const res = await fetch(
          `/api/v1/marketplace/listings/${encodeURIComponent(listingIdToOpen)}`
        );
        if (!res.ok) {
          throw new Error('Listing not found');
        }
        const payload = await res.json();
        listing = payload.listing;
      } catch (error) {
        console.error('Unable to open requested listing:', error);
        showToast('That listing is no longer available', 'error');
        return;
      }
    }

    if (history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.delete('listing');
      history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    }

    showListingDetail(listing);
  }

  async function loadSavedListings() {
    if (!currentUser) {
      savedListingIds = new Set();
      return;
    }

    try {
      const res = await fetch('/api/v1/marketplace/saved', {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to load saved listings');
      }

      const data = await res.json();
      savedListingIds = new Set(
        (data.savedItems || [])
          .map(item => item.listing?.id || item.listingId)
          .filter(listingId => typeof listingId === 'string' && listingId.length > 0)
      );
    } catch (error) {
      console.error('Error loading saved listings:', error);
      savedListingIds = new Set();
    }
  }

  async function toggleSave(btn, listing) {
    if (!listing || !listing.id) {
      return;
    }

    if (!currentUser) {
      showToast('Please log in to save items', 'error');
      setTimeout(() => {
        window.location.href = `/auth?redirect=${encodeURIComponent('/marketplace')}`;
      }, 1200);
      return;
    }

    const isCurrentlySaved = savedListingIds.has(listing.id);
    btn.disabled = true;

    try {
      const endpoint = `/api/v1/marketplace/saved/${encodeURIComponent(listing.id)}`;
      const res = await fetch(endpoint, {
        method: isCurrentlySaved ? 'DELETE' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
        },
        credentials: 'include',
        body: isCurrentlySaved ? undefined : JSON.stringify({ listingId: listing.id }),
      });

      if (res.status === 401) {
        showToast('Session expired. Please log in again.', 'error');
        setTimeout(() => {
          window.location.href = `/auth?redirect=${encodeURIComponent('/marketplace')}`;
        }, 1200);
        return;
      }

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || payload.message || 'Unable to update saved item');
      }

      if (isCurrentlySaved) {
        savedListingIds.delete(listing.id);
      } else {
        savedListingIds.add(listing.id);
      }

      const shortlistManager = window.shortlistManager;
      if (shortlistManager) {
        if (isCurrentlySaved) {
          await shortlistManager.removeItem('listing', listing.id);
        } else {
          await shortlistManager.addItem({
            type: 'listing',
            id: listing.id,
            name: listing.title || 'Untitled listing',
            category: formatCategory(listing.category),
            location: listing.location || '',
            priceHint: formatPrice(listing.price),
            imageUrl: getListingImages(listing)[0] || '/assets/images/collage-venue.jpg',
          });
        }
      }

      const nextSavedState = !isCurrentlySaved;
      btn.classList.toggle('saved', nextSavedState);
      btn.textContent = nextSavedState ? '♥' : '♡';
      btn.setAttribute('aria-pressed', String(nextSavedState));
      btn.setAttribute('aria-label', nextSavedState ? 'Unsave item' : 'Save item');
      btn.setAttribute('title', `${nextSavedState ? 'Unsave' : 'Save'} item`);
      showToast(nextSavedState ? 'Saved to your Saved Items list' : 'Removed from Saved Items');
    } catch (error) {
      console.error('Save toggle failed:', error);
      showToast(error.message || 'Unable to save item right now', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // Initialize location modal
  function initLocationModal() {
    const changeLocationBtn = document.getElementById('btn-change-location');
    if (!changeLocationBtn) {
      return;
    }

    changeLocationBtn.addEventListener('click', showLocationModal);
  }

  function showLocationModal() {
    const overlay = document.createElement('div');
    overlay.className = 'location-modal-overlay';

    const savedLocation = JSON.parse(localStorage.getItem('marketplaceLocation') || '{}');

    overlay.innerHTML = `
      <div class="location-modal">
        <div class="location-modal-header">
          <h3>Change Location</h3>
          <button class="location-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="location-modal-body">
          <div class="location-modal-group">
            <label for="location-postcode">Postcode or City</label>
            <input 
              type="text" 
              id="location-postcode" 
              placeholder="e.g. SW1A 1AA or London"
              value="${savedLocation.postcode || ''}"
            >
          </div>
          <div class="location-modal-group">
            <label for="location-radius">Search Radius</label>
            <select id="location-radius">
              <option value="">Any distance</option>
              <option value="5" ${savedLocation.radius === '5' ? 'selected' : ''}>Within 5 miles</option>
              <option value="10" ${savedLocation.radius === '10' ? 'selected' : ''}>Within 10 miles</option>
              <option value="25" ${savedLocation.radius === '25' ? 'selected' : ''}>Within 25 miles</option>
              <option value="50" ${savedLocation.radius === '50' ? 'selected' : ''}>Within 50 miles</option>
              <option value="100" ${savedLocation.radius === '100' ? 'selected' : ''}>Within 100 miles</option>
            </select>
          </div>
          <div class="location-modal-actions">
            <button class="cta secondary" id="use-my-location">Use My Location</button>
            <button class="cta" id="apply-location">Apply</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('active'), 10);

    // Close handlers
    const closeBtn = overlay.querySelector('.location-modal-close');
    closeBtn.addEventListener('click', () => closeModal(overlay));

    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        closeModal(overlay);
      }
    });

    const handleEscape = e => {
      if (e.key === 'Escape') {
        closeModal(overlay);
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Use my location
    const useLocationBtn = overlay.querySelector('#use-my-location');
    useLocationBtn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showToast('Geolocation is not supported', 'error');
        return;
      }

      useLocationBtn.textContent = 'Getting location...';
      useLocationBtn.disabled = true;

      navigator.geolocation.getCurrentPosition(
        position => {
          const { latitude, longitude } = position.coords;
          const postcodeInput = overlay.querySelector('#location-postcode');
          postcodeInput.value = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
          useLocationBtn.textContent = 'Use My Location';
          useLocationBtn.disabled = false;
          showToast('Location detected');
        },
        _error => {
          showToast('Unable to get location', 'error');
          useLocationBtn.textContent = 'Use My Location';
          useLocationBtn.disabled = false;
        }
      );
    });

    // Apply location
    const applyBtn = overlay.querySelector('#apply-location');
    applyBtn.addEventListener('click', () => {
      const postcode = overlay.querySelector('#location-postcode').value.trim();
      const radius = overlay.querySelector('#location-radius').value;

      // Save to localStorage
      localStorage.setItem('marketplaceLocation', JSON.stringify({ postcode, radius }));

      // Update UI
      updateLocationSummary(postcode, radius);

      // Close modal
      closeModal(overlay);

      // STUB: Location/distance filter saved to localStorage but not yet applied to API queries.
      // To implement properly:
      //   1. Resolve postcode to lat/lng (e.g. postcodes.io API)
      //   2. Pass coordinates + radius to the listings API endpoint
      //   3. Add a 2dsphere index on listing location field in MongoDB
      //   4. Use MongoDB $geoNear or $near operator in the query
      // For now, listings are reloaded without distance filtering.
      loadListings();

      showToast('Location updated');
    });
  }

  function loadSavedLocation() {
    const saved = JSON.parse(localStorage.getItem('marketplaceLocation') || '{}');
    if (saved.postcode || saved.radius) {
      updateLocationSummary(saved.postcode, saved.radius);
    }
  }

  function updateLocationSummary(postcode, radius) {
    const locationText = document.querySelector('.location-text');
    if (!locationText) {
      return;
    }

    let text = '📍 ';
    if (postcode && radius) {
      text += `${postcode}, ${radius} miles`;
    } else if (postcode) {
      text += postcode;
    } else if (radius) {
      text += `Within ${radius} miles`;
    } else {
      text += 'All UK';
    }

    locationText.textContent = text;
  }

  // Initialize mobile filters toggle
  function initMobileFilters() {
    const toggleBtn = document.getElementById('mobile-filter-toggle');
    const sidebar = document.querySelector('.marketplace-sidebar');

    if (!toggleBtn || !sidebar) {
      return;
    }

    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('active');
      document.body.style.overflow = sidebar.classList.contains('active') ? 'hidden' : '';
    });

    // Close on filter selection (mobile)
    const filterInputs = sidebar.querySelectorAll('select, input[type="text"]');
    filterInputs.forEach(input => {
      input.addEventListener('change', () => {
        if (window.innerWidth <= 768) {
          setTimeout(() => {
            sidebar.classList.remove('active');
            document.body.style.overflow = '';
          }, 300);
        }
      });
    });
  }

  // Initialize filters
  function initFilters() {
    const categoryFilter = document.getElementById('marketplace-filter-category');
    const priceFilter = document.getElementById('marketplace-filter-price');
    const conditionFilter = document.getElementById('marketplace-filter-condition');
    const queryInput = document.getElementById('marketplace-filter-query');
    const sortSelect = document.getElementById('marketplace-sort');

    // Add change listeners
    [categoryFilter, priceFilter, conditionFilter, sortSelect].forEach(element => {
      if (element) {
        element.addEventListener('change', applyFilters);
      }
    });

    if (queryInput) {
      // Debounce search input
      let searchTimeout;
      queryInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(applyFilters, 300);
      });
    }

    function applyFilters() {
      syncFiltersToUrl();
      // Reload listings with new filters
      loadListings();

      // Show filtering feedback
      const tips = document.getElementById('marketplace-results-tips');
      if (tips && hasActiveFilters()) {
        tips.style.display = 'none';
      } else if (tips) {
        tips.style.display = 'block';
      }
    }

    function hasActiveFilters() {
      return (
        (categoryFilter && categoryFilter.value) ||
        (priceFilter && priceFilter.value) ||
        (conditionFilter && conditionFilter.value) ||
        (queryInput && queryInput.value.trim())
      );
    }
  }

  function normalizeSortValue(value) {
    if (value === 'priceAsc') {
      return 'price-low';
    }
    if (value === 'priceDesc') {
      return 'price-high';
    }
    return value;
  }

  function hydrateFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);

    const categoryFilter = document.getElementById('marketplace-filter-category');
    const priceFilter = document.getElementById('marketplace-filter-price');
    const conditionFilter = document.getElementById('marketplace-filter-condition');
    const queryInput = document.getElementById('marketplace-filter-query');
    const sortSelect = document.getElementById('marketplace-sort');

    const category = params.get('category');
    const condition = params.get('condition');
    const search = params.get('search');
    const sort = params.get('sort');

    if (categoryFilter && category) {
      categoryFilter.value = category;
    }
    if (conditionFilter && condition) {
      conditionFilter.value = condition;
    }
    if (queryInput && search) {
      queryInput.value = search;
    }
    if (sortSelect && sort) {
      sortSelect.value = normalizeSortValue(sort);
    }

    const minPrice = params.get('minPrice');
    const maxPrice = params.get('maxPrice');
    if (priceFilter && (minPrice || maxPrice)) {
      if (minPrice === '0' && maxPrice === '50') {
        priceFilter.value = '0-50';
      } else if (minPrice === '50' && maxPrice === '100') {
        priceFilter.value = '50-100';
      } else if (minPrice === '100' && maxPrice === '250') {
        priceFilter.value = '100-250';
      } else if (minPrice === '250' && maxPrice === '500') {
        priceFilter.value = '250-500';
      } else if (minPrice === '500' && !maxPrice) {
        priceFilter.value = '500-plus';
      }
    }
  }

  function syncFiltersToUrl() {
    const params = new URLSearchParams();

    const category = document.getElementById('marketplace-filter-category')?.value || '';
    const condition = document.getElementById('marketplace-filter-condition')?.value || '';
    const search = document.getElementById('marketplace-filter-query')?.value?.trim() || '';
    const sort = document.getElementById('marketplace-sort')?.value || '';
    const priceRange = document.getElementById('marketplace-filter-price')?.value || '';

    if (category) {
      params.set('category', category);
    }
    if (condition) {
      params.set('condition', condition);
    }
    if (search) {
      params.set('search', search);
    }
    if (sort && sort !== 'newest') {
      params.set('sort', normalizeSortValue(sort));
    }

    if (priceRange === '0-50') {
      params.set('minPrice', '0');
      params.set('maxPrice', '50');
    } else if (priceRange === '50-100') {
      params.set('minPrice', '50');
      params.set('maxPrice', '100');
    } else if (priceRange === '100-250') {
      params.set('minPrice', '100');
      params.set('maxPrice', '250');
    } else if (priceRange === '250-500') {
      params.set('minPrice', '250');
      params.set('maxPrice', '500');
    } else if (priceRange === '500-plus') {
      params.set('minPrice', '500');
    }

    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, '', nextUrl);
  }

  // Initialize view toggle (grid/list)
  function initViewToggle() {
    const toggleBtn = document.getElementById('marketplace-view-toggle');
    const resultsContainer = document.getElementById('marketplace-results');

    if (!toggleBtn || !resultsContainer) {
      return;
    }

    let isGridView = true;

    toggleBtn.addEventListener('click', () => {
      isGridView = !isGridView;

      if (isGridView) {
        resultsContainer.className = 'marketplace-grid';
        toggleBtn.innerHTML = '<span id="view-icon">⊞</span> Grid';
      } else {
        resultsContainer.className = 'marketplace-list';
        toggleBtn.innerHTML = '<span id="view-icon">☰</span> List';
      }
    });
  }

  // Initialize quick action buttons
  function initQuickActions() {
    // Quick search buttons
    const searchButtons = document.querySelectorAll('[data-marketplace-search]');
    searchButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const searchTerm = btn.getAttribute('data-marketplace-search');
        const queryInput = document.getElementById('marketplace-filter-query');
        if (queryInput) {
          queryInput.value = searchTerm;
          queryInput.dispatchEvent(new Event('input'));
        }
      });
    });

    // Quick category buttons
    const categoryButtons = document.querySelectorAll('[data-marketplace-category]');
    categoryButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const category = btn.getAttribute('data-marketplace-category');
        const categoryFilter = document.getElementById('marketplace-filter-category');
        if (categoryFilter) {
          categoryFilter.value = category;
          categoryFilter.dispatchEvent(new Event('change'));
        }
      });
    });
  }

  // Update result count
  function updateResultCount() {
    const resultCount = document.getElementById('marketplace-result-count');

    if (resultCount) {
      if (allListings.length === 0) {
        resultCount.textContent = 'No listings found';
      } else {
        resultCount.textContent = `Showing ${allListings.length} listing${allListings.length !== 1 ? 's' : ''}`;
      }
    }
  }

  // Show toast notification
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = 'marketplace-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'error' ? 'rgba(220, 38, 38, 0.95)' : 'rgba(15, 23, 42, 0.95)'};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 10000;
      animation: slideUp 0.3s ease;
    `;

    document.body.appendChild(toast);

    // Remove after 3 seconds
    setTimeout(() => {
      toast.style.animation = 'slideDown 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Add animation styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }
    @keyframes slideDown {
      from {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      to {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
      }
    }
  `;
  document.head.appendChild(style);
})();

// Share functions
window.shareOnFacebook = function (listingId) {
  const url = `${window.location.origin}/marketplace?listing=${listingId}`;
  const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  window.open(shareUrl, '_blank', 'width=600,height=400');
};

window.shareOnTwitter = function (title, listingId) {
  const url = `${window.location.origin}/marketplace?listing=${listingId}`;
  const text = `Check out this item on EventFlow Marketplace: ${title}`;
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(shareUrl, '_blank', 'width=600,height=400');
};

window.copyListingLink = function (listingId) {
  const url = `${window.location.origin}/marketplace?listing=${listingId}`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        // Use global toast if available, otherwise show alert
        if (window.EFToast && window.EFToast.success) {
          window.EFToast.success('Link copied to clipboard!');
        } else {
          alert('Link copied to clipboard!');
        }
      })
      .catch(err => {
        console.error('Failed to copy link:', err);
        fallbackCopyLink(url);
      });
  } else {
    fallbackCopyLink(url);
  }
};

function fallbackCopyLink(url) {
  const textArea = document.createElement('textarea');
  textArea.value = url;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();

  try {
    document.execCommand('copy');
    // Use global toast if available, otherwise show alert
    if (window.EFToast && window.EFToast.success) {
      window.EFToast.success('Link copied to clipboard!');
    } else {
      alert('Link copied to clipboard!');
    }
  } catch (err) {
    console.error('Failed to copy link:', err);
    if (window.EFToast && window.EFToast.error) {
      window.EFToast.error('Failed to copy link');
    } else {
      alert('Failed to copy link');
    }
  }

  document.body.removeChild(textArea);
}
