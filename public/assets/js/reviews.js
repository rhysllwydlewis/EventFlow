/**
 * EventFlow Reviews System Manager
 *
 * Handles all client-side review functionality:
 * - Review widget rendering
 * - Review submission and validation
 * - Rating distribution visualization
 * - Review filtering and sorting
 * - Voting (helpful/unhelpful)
 * - Supplier responses
 * - Photo uploads
 * - Admin moderation
 */

'use strict';
(function () {
  const ReviewsManager = {
    currentSupplierId: null,
    currentPage: 1,
    perPage: 10,
    filters: {
      minRating: null,
      sortBy: 'date',
      verifiedOnly: false,
    },
    currentUser: null,
    csrfToken: null,

    // Photo upload limits (single source of truth used by addPhotoFiles / renderPhotoPreviews)
    REVIEW_MAX_PHOTOS: 5,
    REVIEW_MAX_PHOTO_MB: 5,

    /**
     * Build the sign-in URL that redirects back to the current page after auth
     */
    getSignInRedirectUrl() {
      return `/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    },

    /**
     * Initialize the reviews system
     */
    init(supplierId, user = null) {
      this.currentSupplierId = supplierId;
      this.currentUser = user;
      this.csrfToken = this.getCSRFToken();

      // Load reviews
      this.loadReviews();

      // Load distribution
      this.loadRatingDistribution();

      // Setup event listeners
      this.setupEventListeners();
    },

    /**
     * Get CSRF token from global context, cookie, or meta tag
     */
    getCSRFToken() {
      // Try cookie first (authoritative server value)
      const csrfCookie = document.cookie.split('; ').find(row => row.startsWith('csrf='));
      if (csrfCookie) {
        const token = decodeURIComponent(csrfCookie.split('=')[1] || '');
        if (token) {
          window.__CSRF_TOKEN__ = token;
          window.csrfToken = token;
          return token;
        }
      }

      if (window.__CSRF_TOKEN__) {
        return window.__CSRF_TOKEN__;
      }

      if (window.csrfToken) {
        return window.csrfToken;
      }

      // Fallback to meta tag
      const metaTag = document.querySelector('meta[name="csrf-token"]');
      if (metaTag && metaTag.content) {
        return metaTag.content;
      }

      return null;
    },

    async ensureCSRFToken(forceRefresh = false) {
      if (!forceRefresh) {
        const existing = this.getCSRFToken();
        if (existing) {
          this.csrfToken = existing;
          return existing;
        }
      }

      if (typeof window.ensureCsrfToken === 'function') {
        const token = await window.ensureCsrfToken(forceRefresh);
        this.csrfToken = token;
        return token;
      }

      const response = await fetch('/api/v1/csrf-token', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch CSRF token');
      }

      const data = await response.json();
      const token = data?.csrfToken;

      if (!token) {
        throw new Error('CSRF token missing from response');
      }

      window.__CSRF_TOKEN__ = token;
      window.csrfToken = token;
      this.csrfToken = token;
      return token;
    },

    async fetchWithCSRF(url, options = {}) {
      const token = await this.ensureCSRFToken();
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        'X-CSRF-Token': token,
      };

      let response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers,
      });

      let data = await response.json().catch(() => ({}));
      const isCsrfFailure = response.status === 403 && /csrf/i.test(data?.error || '');

      if (isCsrfFailure) {
        const freshToken = await this.ensureCSRFToken(true);
        response = await fetch(url, {
          ...options,
          credentials: 'include',
          headers: {
            ...headers,
            'X-CSRF-Token': freshToken,
          },
        });
        data = await response.json().catch(() => ({}));
      }

      return { response, data };
    },

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
      // Write review button
      const writeBtn = document.getElementById('btn-write-review');
      if (writeBtn) {
        writeBtn.addEventListener('click', () => this.openReviewModal());
      }

      // Filter and sort controls
      const minRatingSelect = document.getElementById('filter-min-rating');
      if (minRatingSelect) {
        minRatingSelect.addEventListener('change', e => {
          this.filters.minRating = e.target.value ? parseInt(e.target.value) : null;
          this.currentPage = 1;
          this.loadReviews();
        });
      }

      const sortSelect = document.getElementById('filter-sort-by');
      if (sortSelect) {
        sortSelect.addEventListener('change', e => {
          this.filters.sortBy = e.target.value;
          this.currentPage = 1;
          this.loadReviews();
        });
      }

      const verifiedCheckbox = document.getElementById('filter-verified');
      if (verifiedCheckbox) {
        // NOTE: The verified-customers filter is currently hidden (display:none in reviews.css)
        // and the verification system is not yet implemented.
        // The checkbox is disabled and hidden; the listener below is a safety-net guard
        // that keeps verifiedOnly=false in case this code is re-enabled in the future
        // without updating this listener.
        verifiedCheckbox.disabled = true;
        verifiedCheckbox.setAttribute('aria-hidden', 'true');
        verifiedCheckbox.addEventListener('change', () => {
          this.filters.verifiedOnly = false;
        });
      }
    },

    /**
     * Load reviews from API
     */
    async loadReviews() {
      const container = document.getElementById('reviews-list');
      if (!container) {
        return;
      }

      // Show loading state
      container.innerHTML = `
        <div class="reviews-loading">
          <div class="loading-spinner"></div>
          <p class="reviews-loading__message">Loading reviews...</p>
        </div>
      `;

      try {
        const params = new URLSearchParams({
          page: this.currentPage,
          perPage: this.perPage,
          sortBy: this.filters.sortBy,
        });

        if (this.filters.minRating) {
          params.append('minRating', this.filters.minRating);
        }

        if (this.filters.verifiedOnly) {
          params.append('verifiedOnly', 'true');
        }

        const response = await fetch(
          `/api/suppliers/${this.currentSupplierId}/reviews?${params.toString()}`
        );

        if (!response.ok) {
          throw new Error('Failed to load reviews');
        }

        const data = await response.json();
        this.renderReviews(data.reviews, data.pagination);
      } catch (error) {
        console.error('Error loading reviews:', error);
        container.innerHTML = `
          <div class="reviews-empty">
            <div class="empty-icon">⚠️</div>
            <h3 class="empty-title">Unable to Load Reviews</h3>
            <p class="empty-message">Please try again later.</p>
          </div>
        `;
      }
    },

    /**
     * Render reviews list
     */
    renderReviews(reviews, pagination) {
      const container = document.getElementById('reviews-list');
      if (!container) {
        return;
      }

      if (reviews.length === 0) {
        container.innerHTML = `
          <div class="reviews-empty">
            <div class="empty-icon">⭐</div>
            <h3 class="empty-title">No Reviews Yet</h3>
            <p class="empty-message">This supplier is new to our platform. Be the first to share your experience!</p>
            ${
              this.currentUser
                ? '<button class="ef-cta btn-write-review" onclick="reviewsManager.openReviewModal()">Write the First Review</button>'
                : `<a href="${this.getSignInRedirectUrl()}" class="reviews-empty__signin-cta">Sign in to write a review</a>`
            }
          </div>
        `;
        return;
      }

      container.innerHTML = reviews.map(review => this.renderReviewCard(review)).join('');

      // Cache reviews for edit modal access
      this._reviewCache = {};
      reviews.forEach(r => {
        this._reviewCache[r.id] = r;
      });

      // Render pagination
      this.renderPagination(pagination);

      // Setup vote buttons
      this.setupVoteButtons();

      // Setup edit, delete, and report buttons
      this.setupReviewActionButtons();

      // Setup lightbox for review photos
      this.setupPhotoLightbox();
    },

    /**
     * Render a single review card
     */
    renderReviewCard(review) {
      const stars = this.renderStars(review.rating);

      // Issue 3 fix: ticks come from CSS ::before — no inline ✓ in text
      const verified = review.verified
        ? '<span class="badge badge-verified">Verified Customer</span>'
        : '';
      const emailVerified = review.emailVerified
        ? '<span class="badge badge-email-verified">Email Verified</span>'
        : '';

      // Supplier reviewer badge — shown when the reviewer holds a supplier account.
      // Uses .badge-supplier (indigo, 🏢) which is intentionally different from
      // .badge-supplier-account (green, 🏪) shown on a supplier's own profile/account page.
      // This only reflects account type, not any verification EventFlow performed —
      // holding a supplier account is not evidence of identity or business
      // verification, so the label text below must stay unqualified ("Supplier").
      const supplierBadge =
        review.isSupplier || review.authorSupplierId
          ? '<span class="badge badge-supplier">Supplier</span>'
          : '';

      const recommend = review.recommend
        ? '<div class="review-recommendation">👍 Recommends this supplier</div>'
        : '';

      const photos =
        review.photos && review.photos.length > 0
          ? `<div class="review-photos">
             ${review.photos
               .map(
                 (photo, i) =>
                   `<div class="review-photo" role="button" tabindex="0" data-lightbox-src="${this.escapeHtml(photo)}" data-lightbox-index="${i}" data-lightbox-total="${review.photos.length}" aria-label="View photo ${i + 1} of ${review.photos.length}">
                     <img src="${this.escapeHtml(photo)}" alt="Photo ${i + 1} from ${this.escapeHtml(review.userName)}'s review" loading="lazy" />
                     <div class="review-photo-overlay" aria-hidden="true">🔍</div>
                   </div>`
               )
               .join('')}
           </div>`
          : '';

      const supplierResponse = review.supplierResponse
        ? `<div class="supplier-response">
             <div class="supplier-response-header">
               <span>💬</span>
               <span>Supplier Response</span>
             </div>
             <div class="supplier-response-text">${this.escapeHtml(review.supplierResponse.text)}</div>
             <div class="supplier-response-date">
               Responded ${this.formatDate(review.supplierResponse.respondedAt)}
             </div>
           </div>`
        : '';

      // Issue 1: Hyperlinked name for supplier reviewers
      const authorProfileHref = review.authorSupplierProfilePath || '';
      const authorNameHtml =
        review.isSupplier && authorProfileHref
          ? `<a class="review-author-name review-author-name--link" href="${this.escapeHtml(authorProfileHref)}">${this.escapeHtml(review.userName)}</a>`
          : `<div class="review-author-name">${this.escapeHtml(review.userName)}</div>`;

      const helpfulCount = review.helpfulCount || 0;
      const unhelpfulCount = review.unhelpfulCount || 0;

      // Issue 4 & 5: Edit/Delete buttons for the review author or admin.
      // Check multiple possible user ID properties because the auth system may return
      // the user object with 'id', 'uid', or '_id' depending on the auth provider.
      const currentUserId = this.currentUser?.id || this.currentUser?.uid || this.currentUser?._id;
      const isAuthor = currentUserId && review.userId && currentUserId === review.userId;
      const isAdmin = this.currentUser?.role === 'admin';

      const ownerActions =
        isAuthor || isAdmin
          ? `<button class="ef-cta review-action-btn review-edit-btn" data-review-id="${review.id}" aria-label="Edit review">
             ✏️ <span>Edit</span>
           </button>
           <button class="ef-cta review-action-btn review-delete-btn" data-review-id="${review.id}" aria-label="Delete review">
             🗑️ <span>Delete</span>
           </button>`
          : '';

      // Issue 6: Report button for non-authors (logged-in users only)
      const reportBtn =
        this.currentUser && !isAuthor
          ? `<button class="ef-cta review-action-btn review-report-btn" data-review-id="${review.id}" aria-label="Report this review">
               🚩 <span>Report</span>
             </button>`
          : '';

      // Issue 4: Show "Edited on" timestamp if the review was edited
      const editedNote =
        review.editedAt || (review.updatedAt && review.updatedAt !== review.createdAt)
          ? `<div class="review-edited-note">Edited on ${this.formatDateTime(review.editedAt || review.updatedAt)}</div>`
          : '';

      return `
        <div class="review-card ${review.flagged ? 'flagged' : ''}" data-review-id="${review.id}">
          <div class="review-card-header">
            <div class="review-author-info">
              <div class="review-author-avatar">
                ${this.getInitials(review.userName)}
              </div>
              <div class="review-author-details">
                ${authorNameHtml}
                <div class="review-badges-inline">
                  ${verified}
                  ${emailVerified}
                  ${supplierBadge}
                </div>
                <div class="review-meta">
                  <span class="review-date">${this.formatDate(review.createdAt)}</span>
                  ${review.eventType ? `<span class="review-event-type">🎉 ${this.escapeHtml(review.eventType)}</span>` : ''}
                </div>
              </div>
            </div>
            <div class="review-card-rating">
              <div class="review-stars" role="img" aria-label="${Number(review.rating).toFixed(1)} out of 5 stars">${stars}</div>
              <span class="review-rating-number" aria-hidden="true">${Number(review.rating).toFixed(1)}</span>
            </div>
          </div>
          
          <div class="review-card-content">
            ${review.title ? `<h4 class="review-title">${this.escapeHtml(review.title)}</h4>` : ''}
            <p class="review-text">${this.escapeHtml(review.comment)}</p>
            ${recommend}
            ${photos}
          </div>
          
          ${supplierResponse}
          ${editedNote}
          
          <div class="review-card-actions">
            <button class="ef-cta review-action-btn vote-btn" data-review-id="${review.id}" data-vote-type="helpful" aria-label="Mark review as helpful">
              <span aria-hidden="true">👍</span>
              <span>Helpful</span>
              <span class="vote-count">(${helpfulCount})</span>
            </button>
            <button class="ef-cta review-action-btn vote-btn" data-review-id="${review.id}" data-vote-type="unhelpful" aria-label="Mark review as not helpful">
              <span aria-hidden="true">👎</span>
              <span>Not Helpful</span>
              <span class="vote-count">(${unhelpfulCount})</span>
            </button>
            ${ownerActions || reportBtn ? `<div class="review-actions-right">${ownerActions}${reportBtn}</div>` : ''}
          </div>
        </div>
      `;
    },

    /**
     * Render star rating with support for fractional/partial stars.
     * Full stars: gold ★. Partial star: gold ★ overlaid on grey ☆ via absolute positioning.
     * Empty stars: grey ☆. All spans are aria-hidden (container should carry the label).
     */
    renderStars(rating) {
      const fullStars = Math.floor(rating);
      const fraction = rating - fullStars;
      const stars = [];

      for (let i = 0; i < fullStars; i++) {
        stars.push('<span class="star-full" aria-hidden="true">★</span>');
      }

      if (fraction > 0 && fullStars < 5) {
        const pct = Math.round(fraction * 100);
        // Overlay gold ★ (clipped to pct% width) on top of grey ☆
        stars.push(
          `<span class="star-partial-wrapper" aria-hidden="true"><span class="star-bg">☆</span><span class="star-fg" style="--fill-width:${pct}%">★</span></span>`
        );
      }

      const emptiesStart = fraction > 0 ? fullStars + 1 : fullStars;
      for (let i = emptiesStart; i < 5; i++) {
        stars.push('<span class="star-empty" aria-hidden="true">☆</span>');
      }

      return stars.join('');
    },

    /**
     * Get user initials
     */
    getInitials(name) {
      if (!name) {
        return '?';
      }
      return name
        .split(' ')
        .map(part => part[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    },

    /**
     * Format date
     */
    formatDate(dateString) {
      const date = new Date(dateString);
      const now = new Date();
      const diff = now - date;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));

      if (days === 0) {
        return 'Today';
      }
      if (days === 1) {
        return 'Yesterday';
      }
      if (days < 7) {
        return `${days} days ago`;
      }
      if (days < 30) {
        return `${Math.floor(days / 7)} weeks ago`;
      }
      if (days < 365) {
        return `${Math.floor(days / 30)} months ago`;
      }
      return date.toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
    },

    /**
     * Format date and time for edit timestamps
     */
    formatDateTime(dateString) {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/London',
      });
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
      if (!text) {
        return '';
      }
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },

    /**
     * Render pagination
     */
    renderPagination(pagination) {
      const container = document.getElementById('review-pagination');
      if (!container || pagination.totalPages <= 1) {
        if (container) {
          container.style.display = 'none';
        }
        return;
      }

      container.style.display = 'flex';

      const pages = [];
      const currentPage = pagination.page;
      const totalPages = pagination.totalPages;

      // Previous button
      pages.push(
        `<button class="ef-cta pagination-btn" ${!pagination.hasPrev ? 'disabled' : ''} onclick="reviewsManager.goToPage(${currentPage - 1})">← Previous</button>`
      );

      // Page numbers (show max 5)
      let startPage = Math.max(1, currentPage - 2);
      let endPage = Math.min(totalPages, currentPage + 2);

      if (currentPage <= 3) {
        endPage = Math.min(5, totalPages);
      }

      if (currentPage >= totalPages - 2) {
        startPage = Math.max(1, totalPages - 4);
      }

      for (let i = startPage; i <= endPage; i++) {
        pages.push(
          `<button class="ef-cta pagination-btn ${i === currentPage ? 'active' : ''}" onclick="reviewsManager.goToPage(${i})">${i}</button>`
        );
      }

      // Next button
      pages.push(
        `<button class="ef-cta pagination-btn" ${!pagination.hasNext ? 'disabled' : ''} onclick="reviewsManager.goToPage(${currentPage + 1})">Next →</button>`
      );

      container.innerHTML = pages.join('');
    },

    /**
     * Go to page
     */
    goToPage(page) {
      this.currentPage = page;
      this.loadReviews();

      // Scroll to top of reviews
      const widget = document.querySelector('.reviews-widget');
      if (widget) {
        widget.scrollIntoView({ behavior: 'smooth' });
      }
    },

    /**
     * Setup vote buttons
     */
    setupVoteButtons() {
      const voteButtons = document.querySelectorAll('.vote-btn');
      voteButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const reviewId = btn.dataset.reviewId;
          const voteType = btn.dataset.voteType;
          this.voteOnReview(reviewId, voteType);
        });
      });
    },

    /**
     * Vote on a review
     */
    async voteOnReview(reviewId, voteType) {
      try {
        const { response, data } = await this.fetchWithCSRF(`/api/reviews/${reviewId}/vote`, {
          method: 'POST',
          body: JSON.stringify({ voteType }),
        });

        if (response.ok) {
          this.showToast(data.message, 'success');
          // Reload reviews to update counts
          this.loadReviews();
        } else {
          this.showToast(data.error || 'Unable to record vote', 'error');
        }
      } catch (error) {
        console.error('Vote error:', error);
        this.showToast('Network error. Please try again.', 'error');
      }
    },

    /**
     * Load rating distribution
     */
    async loadRatingDistribution() {
      const container = document.querySelector('.rating-distribution');
      if (!container) {
        return;
      }

      try {
        const response = await fetch(
          `/api/reviews/supplier/${this.currentSupplierId}/distribution`
        );

        if (!response.ok) {
          throw new Error('Failed to load distribution');
        }

        const data = await response.json();
        this.renderRatingDistribution(data);
      } catch (error) {
        console.error('Error loading distribution:', error);
      }
    },

    /**
     * Render rating distribution bars
     */
    renderRatingDistribution(data) {
      const container = document.querySelector('.rating-distribution');
      if (!container) {
        return;
      }

      const total = data.total || 0;
      const distribution = data.distribution || { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

      let html = '';
      for (let rating = 5; rating >= 1; rating--) {
        const count = distribution[rating] || 0;
        const percentage = total > 0 ? (count / total) * 100 : 0;

        html += `
          <div class="rating-bar-row">
            <div class="rating-bar-label">
              <span>${rating}</span>
              <span>★</span>
            </div>
            <div class="rating-bar-container">
              <div class="rating-bar-fill" style="width: ${percentage}%"></div>
            </div>
            <div class="rating-bar-count">${count}</div>
          </div>
        `;
      }

      container.innerHTML = html;

      // Update summary - Show "New" for suppliers with no reviews
      const avgElement = document.querySelector('.review-average-rating');
      if (avgElement) {
        if (total === 0) {
          avgElement.textContent = 'New';
          avgElement.style.fontSize = '2.5rem';
        } else {
          avgElement.textContent = data.average ? data.average.toFixed(1) : '0.0';
          avgElement.style.fontSize = '3.5rem';
        }
      }

      const countElement = document.querySelector('.review-count');
      if (countElement) {
        if (total === 0) {
          countElement.textContent = 'No reviews yet';
        } else {
          countElement.textContent = `${total} ${total === 1 ? 'Review' : 'Reviews'}`;
        }
      }

      // Update stars display
      const starsElement = document.querySelector('.review-stars-large');
      if (starsElement) {
        if (total === 0) {
          starsElement.innerHTML = this.renderStars(0);
          starsElement.style.opacity = '0.3';
          starsElement.setAttribute('aria-label', 'No reviews yet');
        } else {
          starsElement.innerHTML = this.renderStars(data.average || 0);
          starsElement.style.opacity = '1';
          starsElement.setAttribute(
            'aria-label',
            `Average rating: ${(data.average || 0).toFixed(1)} out of 5 stars`
          );
        }
      }
    },

    /**
     * Open review submission modal
     */
    async openReviewModal() {
      // If currentUser wasn't passed during init, try fetching it from the auth endpoint
      if (!this.currentUser) {
        try {
          const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
          if (response.ok) {
            const data = await response.json();
            if (data && data.user) {
              this.currentUser = data.user;
            }
          }
        } catch {
          // ignore network errors — fall through to redirect if still unauthenticated
        }
      }

      if (!this.currentUser) {
        this.showToast('Please sign in to write a review', 'error');
        window.location.href = this.getSignInRedirectUrl();
        return;
      }

      // Always remove stale modal before creating fresh, to prevent duplicate listeners
      const stale = document.getElementById('review-modal');
      if (stale) {
        stale.remove();
      }

      this.createReviewModal();

      // Setup star rating
      this.setupStarRating();

      // Setup form submission
      this.setupReviewForm();
    },

    /**
     * Create review modal HTML
     */
    createReviewModal() {
      const modalHTML = `
        <div id="review-modal" class="review-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="write-modal-title">
          <div class="review-modal">
            <div class="review-modal-header">
              <h2 class="review-modal-title" id="write-modal-title">Write a Review</h2>
              <p class="review-modal-subtitle">Share your experience with this supplier</p>
            </div>
            
            <form id="review-form" class="review-modal-body">
              <!-- Rating -->
              <div class="review-form-group">
                <label class="review-form-label required">Overall Rating</label>
                <div class="star-rating-input" id="star-rating-input" aria-label="Rating">
                  <span class="star" data-rating="1" role="button" tabindex="0" aria-label="1 star">★</span>
                  <span class="star" data-rating="2" role="button" tabindex="0" aria-label="2 stars">★</span>
                  <span class="star" data-rating="3" role="button" tabindex="0" aria-label="3 stars">★</span>
                  <span class="star" data-rating="4" role="button" tabindex="0" aria-label="4 stars">★</span>
                  <span class="star" data-rating="5" role="button" tabindex="0" aria-label="5 stars">★</span>
                </div>
                <div class="rating-description" id="rating-description"></div>
                <input type="hidden" id="review-rating" name="rating" required />
              </div>

              <!-- Title -->
              <div class="review-form-group">
                <label class="review-form-label" for="review-title">Review Title</label>
                <input
                  type="text"
                  id="review-title"
                  name="title"
                  class="review-input"
                  placeholder="Sum up your experience"
                  maxlength="100"
                />
              </div>

              <!-- Comment -->
              <div class="review-form-group">
                <label class="review-form-label required" for="review-comment">Your Review</label>
                <textarea
                  id="review-comment"
                  name="comment"
                  class="review-textarea"
                  placeholder="Share details of your experience..."
                  required
                  minlength="20"
                  maxlength="2000"
                ></textarea>
                <div class="character-count">
                  <span id="char-count">0</span> / 2000 characters (minimum 20)
                </div>
              </div>

              <!-- Recommend -->
              <div class="review-form-group">
                <label class="review-checkbox">
                  <input type="checkbox" id="review-recommend" name="recommend" />
                  <span class="review-checkbox-label">
                    <strong>I would recommend this supplier</strong>
                  </span>
                </label>
              </div>

              <!-- Event Type -->
              <div class="review-form-group">
                <label class="review-form-label" for="review-event-type">Event Type</label>
                <select id="review-event-type" name="eventType" class="review-filter-select">
                  <option value="">Select event type (optional)</option>
                  <option value="Wedding">Wedding</option>
                  <option value="Birthday">Birthday</option>
                  <option value="Corporate">Corporate Event</option>
                  <option value="Anniversary">Anniversary</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <!-- Photos -->
              <div class="review-form-group">
                <label class="review-form-label">Photos <span class="review-form-label-hint">(optional, up to 5)</span></label>
                <div class="photo-drop-zone review-photo-drop-zone" id="review-photo-upload-area" role="button" tabindex="0" aria-label="Click or drag photos to upload">
                  <div class="review-drop-icon" aria-hidden="true">📷</div>
                  <div class="upload-text">Add photos to your review</div>
                  <p class="review-drop-hint">Click to browse or drag &amp; drop &bull; JPEG, PNG, WebP &bull; Max 5MB each</p>
                  <input type="file" id="review-photo-input" accept="image/jpeg,image/png,image/webp,image/gif" multiple style="display:none" aria-hidden="true" />
                </div>
                <div class="review-photo-previews" id="review-photo-previews"></div>
                <div class="photo-upload-count" id="review-photo-count" style="display:none">
                  <span id="review-photo-count-text">0 / 5 photos selected</span>
                </div>
              </div>
            </form>

            <div class="review-modal-footer">
              <button type="button" class="ef-cta btn-cancel" id="btn-write-cancel">
                Cancel
              </button>
              <button type="submit" form="review-form" class="ef-cta btn-submit-review" id="btn-submit-review">
                Submit Review
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHTML);

      const modal = document.getElementById('review-modal');

      // Close on overlay click
      modal.addEventListener('click', e => {
        if (e.target === modal) {
          this.closeReviewModal();
        }
      });

      // Close on Escape
      document.getElementById('btn-write-cancel').addEventListener('click', () => {
        this.closeReviewModal();
      });

      this._writeModalEscHandler = e => {
        if (e.key === 'Escape') {
          this.closeReviewModal();
        }
      };
      document.addEventListener('keydown', this._writeModalEscHandler);

      // Setup photo upload
      this.setupPhotoUpload();
    },

    /**
     * Setup the photo upload area (drag-drop + click-to-browse)
     */
    setupPhotoUpload() {
      const uploadArea = document.getElementById('review-photo-upload-area');
      const fileInput = document.getElementById('review-photo-input');
      if (!uploadArea || !fileInput) {
        return;
      }

      // Stored files for upload on submit
      this._pendingPhotoFiles = [];

      const openPicker = () => fileInput.click();
      uploadArea.addEventListener('click', openPicker);
      uploadArea.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPicker();
        }
      });

      fileInput.addEventListener('change', () => {
        this.addPhotoFiles(Array.from(fileInput.files));
        // Reset so re-selecting same file fires change again
        fileInput.value = '';
      });

      // Drag & drop support
      uploadArea.addEventListener('dragover', e => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
      });
      uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
      });
      uploadArea.addEventListener('drop', e => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        this.addPhotoFiles(files);
      });
    },

    /**
     * Add photo files to the pending list and render previews
     */
    addPhotoFiles(files) {
      const limit = this.REVIEW_MAX_PHOTOS;
      const maxSizeBytes = this.REVIEW_MAX_PHOTO_MB * 1024 * 1024;

      for (const file of files) {
        if (this._pendingPhotoFiles.length >= limit) {
          this.showToast(`Maximum ${limit} photos per review`, 'error');
          break;
        }
        if (file.size > maxSizeBytes) {
          this.showToast(`${file.name} is too large (max ${this.REVIEW_MAX_PHOTO_MB}MB)`, 'error');
          continue;
        }
        if (!file.type.startsWith('image/')) {
          this.showToast(`${file.name} is not an image`, 'error');
          continue;
        }
        this._pendingPhotoFiles.push(file);
      }
      this.renderPhotoPreviews();
    },

    /**
     * Render photo preview thumbnails with remove buttons
     */
    renderPhotoPreviews() {
      const container = document.getElementById('review-photo-previews');
      const countEl = document.getElementById('review-photo-count');
      const countText = document.getElementById('review-photo-count-text');
      const uploadArea = document.getElementById('review-photo-upload-area');
      if (!container) {
        return;
      }

      container.innerHTML = '';

      const files = this._pendingPhotoFiles || [];

      files.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = ev => {
          // Use supplier dashboard tile pattern: photo-preview-item--pending
          const tile = document.createElement('div');
          tile.className = 'photo-preview-item photo-preview-item--pending';

          const imgWrap = document.createElement('div');
          imgWrap.className = 'photo-preview-item__image-wrap';

          const img = document.createElement('img');
          img.src = ev.target.result;
          img.alt = `Photo ${index + 1} preview`;
          imgWrap.appendChild(img);
          tile.appendChild(imgWrap);

          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'photo-remove-btn';
          removeBtn.setAttribute('data-index', String(index));
          removeBtn.setAttribute('aria-label', `Remove photo ${index + 1}`);
          removeBtn.textContent = '✕';
          removeBtn.addEventListener('click', e => {
            const idx = parseInt(e.currentTarget.dataset.index, 10);
            if (isNaN(idx)) {
              return;
            }
            this._pendingPhotoFiles.splice(idx, 1);
            this.renderPhotoPreviews();
          });
          tile.appendChild(removeBtn);

          container.appendChild(tile);
        };
        reader.readAsDataURL(file);
      });

      const limit = this.REVIEW_MAX_PHOTOS;

      // Show/hide count
      if (files.length > 0) {
        countText.textContent = `${files.length} / ${limit} photo${files.length !== 1 ? 's' : ''} selected`;
        countEl.style.display = 'block';
      } else {
        countEl.style.display = 'none';
      }

      // Disable upload area when at limit
      if (files.length >= limit) {
        uploadArea.setAttribute('aria-disabled', 'true');
        uploadArea.classList.add('upload-limit-reached');
      } else {
        uploadArea.removeAttribute('aria-disabled');
        uploadArea.classList.remove('upload-limit-reached');
      }
    },

    /**
     * Setup star rating input
     */
    setupStarRating() {
      const stars = document.querySelectorAll('#star-rating-input .star');
      const ratingInput = document.getElementById('review-rating');
      const description = document.getElementById('rating-description');

      const descriptions = {
        1: 'Poor - Would not recommend',
        2: 'Fair - Below expectations',
        3: 'Good - Met expectations',
        4: 'Very Good - Exceeded expectations',
        5: 'Excellent - Outstanding!',
      };

      let selectedRating = 0;

      stars.forEach(star => {
        star.addEventListener('mouseenter', () => {
          const rating = parseInt(star.dataset.rating);
          this.highlightStars(stars, rating);
          description.textContent = descriptions[rating];
        });

        star.addEventListener('mouseleave', () => {
          this.highlightStars(stars, selectedRating);
          description.textContent = selectedRating > 0 ? descriptions[selectedRating] : '';
        });

        const selectStar = () => {
          selectedRating = parseInt(star.dataset.rating);
          ratingInput.value = selectedRating;
          this.highlightStars(stars, selectedRating);
          description.textContent = descriptions[selectedRating];
        };

        star.addEventListener('click', selectStar);

        // Keyboard support: Enter or Space activates the star (role="button")
        star.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectStar();
          }
        });
      });
    },

    /**
     * Highlight stars
     */
    highlightStars(stars, rating) {
      stars.forEach((star, index) => {
        if (index < rating) {
          star.classList.add('active');
        } else {
          star.classList.remove('active');
        }
      });
    },

    /**
     * Setup review form submission
     */
    setupReviewForm() {
      const form = document.getElementById('review-form');
      const commentTextarea = document.getElementById('review-comment');
      const charCount = document.getElementById('char-count');

      // Character counter
      if (commentTextarea && charCount) {
        commentTextarea.addEventListener('input', () => {
          const length = commentTextarea.value.length;
          charCount.textContent = length;

          const counterDiv = charCount.parentElement;
          if (length < 20) {
            counterDiv.classList.add('error');
            counterDiv.classList.remove('warning');
          } else if (length > 1800) {
            counterDiv.classList.add('warning');
            counterDiv.classList.remove('error');
          } else {
            counterDiv.classList.remove('error', 'warning');
          }
        });
      }

      // Form submission
      if (form) {
        form.addEventListener('submit', e => {
          e.preventDefault();
          this.submitReview();
        });
      }
    },

    /**
     * Submit review (uploads photos first if any, then submits review JSON)
     */
    async submitReview() {
      const submitBtn = document.getElementById('btn-submit-review');

      // Validate
      const rating = document.getElementById('review-rating').value;
      const comment = document.getElementById('review-comment').value;

      if (!rating) {
        this.showToast('Please select a rating', 'error');
        return;
      }

      if (comment.length < 20) {
        this.showToast('Review must be at least 20 characters', 'error');
        return;
      }

      // Disable submit button
      submitBtn.disabled = true;

      try {
        // Step 1: Upload any pending photos
        let photoUrls = [];
        const pendingFiles = this._pendingPhotoFiles || [];

        if (pendingFiles.length > 0) {
          submitBtn.textContent = `Uploading ${pendingFiles.length} photo${pendingFiles.length !== 1 ? 's' : ''}…`;

          const formData = new FormData();
          pendingFiles.forEach(file => formData.append('photos', file));

          try {
            const csrfToken = this.getCSRFToken();
            const uploadRes = await fetch('/api/reviews/photos/upload', {
              method: 'POST',
              headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
              credentials: 'include',
              body: formData,
            });

            const uploadData = await uploadRes.json();

            if (uploadRes.ok && uploadData.urls) {
              photoUrls = uploadData.urls;
            } else if (!uploadRes.ok) {
              this.showToast(uploadData.error || 'Photo upload failed', 'error');
              return;
            }
          } catch (uploadErr) {
            console.error('Photo upload error:', uploadErr);
            this.showToast('Photo upload failed. Submitting without photos.', 'error');
            photoUrls = [];
          }
        }

        // Step 2: Submit review with photo URLs
        submitBtn.textContent = 'Submitting…';

        const form = document.getElementById('review-form');
        const formData = new FormData(form);
        const data = {
          rating: parseInt(rating),
          title: formData.get('title'),
          comment: formData.get('comment'),
          recommend: document.getElementById('review-recommend').checked,
          eventType: formData.get('eventType'),
          photos: photoUrls,
        };

        const { response, data: result } = await this.fetchWithCSRF(
          `/api/suppliers/${this.currentSupplierId}/reviews`,
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        );

        if (response.ok) {
          this.showToast(result.message, 'success');
          this.closeReviewModal();
          // Reload reviews
          this.loadReviews();
          this.loadRatingDistribution();
          if (result.notification) {
            this.handleReviewNotification(result.notification);
          }
        } else {
          this.showToast(result.error || 'Failed to submit review', 'error');
        }
      } catch (error) {
        console.error('Submit error:', error);
        this.showToast('Network error. Please try again.', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Review';
      }
    },

    /**
     * Close review modal
     */
    closeReviewModal() {
      const modal = document.getElementById('review-modal');
      if (modal) {
        modal.remove();
      }
      // Remove Escape listener
      if (this._writeModalEscHandler) {
        document.removeEventListener('keydown', this._writeModalEscHandler);
        this._writeModalEscHandler = null;
      }
      // Clear pending photo files
      this._pendingPhotoFiles = [];
    },

    // -------------------------------------------------------------------------
    // Photo Lightbox
    // -------------------------------------------------------------------------

    /**
     * Attach click / keyboard handlers to review photo thumbnails to open lightbox
     */
    setupPhotoLightbox() {
      document.querySelectorAll('.review-photo[data-lightbox-src]').forEach(el => {
        const open = () => {
          const src = el.dataset.lightboxSrc;
          const index = parseInt(el.dataset.lightboxIndex, 10);
          // Collect all photos in the same review card
          const card = el.closest('.review-card');
          const allPhotos = card
            ? Array.from(card.querySelectorAll('.review-photo[data-lightbox-src]')).map(
                p => p.dataset.lightboxSrc
              )
            : [src];
          this.openLightbox(allPhotos, index);
        };
        el.addEventListener('click', open);
        el.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        });
      });
    },

    /**
     * Inject Lightbox.js-compatible styles once (idempotent via id guard).
     * Uses the same id='lightbox-styles' and class names as components/Lightbox.js
     * so styles are shared if that component is ever loaded on the same page.
     */
    injectLightboxStyles() {
      if (document.getElementById('lightbox-styles')) {
        return;
      }
      const style = document.createElement('style');
      style.id = 'lightbox-styles';
      style.textContent = `
        .lightbox{position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:10000;display:none;align-items:center;justify-content:center;opacity:0;transition:opacity .3s ease}
        .lightbox.is-open{display:flex;opacity:1}
        .lightbox-content{position:relative;max-width:90vw;max-height:90vh;display:flex;align-items:center;justify-content:center}
        .lightbox-image{max-width:100%;max-height:90vh;object-fit:contain;transform:scale(.95);transition:transform .3s ease;border-radius:4px}
        .lightbox.is-open .lightbox-image{transform:scale(1)}
        .lightbox-close{position:fixed;top:20px;right:20px;width:44px;height:44px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:50%;color:#fff;font-size:24px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s;z-index:10001}
        .lightbox-close:hover{background:rgba(255,255,255,.2)}
        .lightbox-nav{position:fixed;top:50%;transform:translateY(-50%);width:44px;height:44px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:50%;color:#fff;font-size:24px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s;z-index:10001}
        .lightbox-nav:hover{background:rgba(255,255,255,.2)}
        .lightbox-nav:disabled{opacity:.3;cursor:not-allowed}
        .lightbox-nav.lightbox-prev{left:20px}
        .lightbox-nav.lightbox-next{right:20px}
        .lightbox-counter{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);color:#fff;background:rgba(0,0,0,.5);padding:8px 16px;border-radius:20px;font-size:14px;z-index:10001;white-space:nowrap}
        .lightbox-loader{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:40px;height:40px;border:3px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:lightbox-spin .8s linear infinite;display:none}
        @keyframes lightbox-spin{to{transform:translate(-50%,-50%) rotate(360deg)}}
        @media(max-width:640px){.lightbox-nav,.lightbox-close{width:40px;height:40px;font-size:20px}.lightbox-nav.lightbox-prev{left:10px}.lightbox-nav.lightbox-next{right:10px}}
        @media(prefers-reduced-motion:reduce){.lightbox,.lightbox-image{transition:none}.lightbox-loader{animation:none}}
      `;
      document.head.appendChild(style);
    },

    /**
     * Open the photo lightbox showing the given array of image URLs, starting at index.
     * Uses Lightbox.js-compatible class names and patterns for visual consistency.
     */
    openLightbox(photos, startIndex = 0) {
      this.injectLightboxStyles();

      // Remove any stale lightbox
      const stale = document.getElementById('review-lightbox');
      if (stale) {
        stale.remove();
      }

      let currentIndex = startIndex;
      const total = photos.length;

      const lightboxEl = document.createElement('div');
      lightboxEl.id = 'review-lightbox';
      lightboxEl.className = 'lightbox';
      lightboxEl.setAttribute('role', 'dialog');
      lightboxEl.setAttribute('aria-modal', 'true');
      lightboxEl.setAttribute('aria-label', 'Photo viewer');
      lightboxEl.innerHTML = `
        <button class="ef-cta lightbox-close" aria-label="Close photo viewer">×</button>
        <div class="lightbox-content">
          <div class="lightbox-loader"></div>
          <img class="lightbox-image" src="" alt="" style="display:none" />
        </div>
        ${total > 1 ? `<button class="ef-cta lightbox-nav lightbox-prev" aria-label="Previous photo">‹</button>` : ''}
        ${total > 1 ? `<button class="ef-cta lightbox-nav lightbox-next" aria-label="Next photo">›</button>` : ''}
        ${total > 1 ? `<div class="lightbox-counter">${currentIndex + 1} / ${total}</div>` : ''}
      `;

      document.body.appendChild(lightboxEl);
      document.body.style.overflow = 'hidden';

      const img = lightboxEl.querySelector('.lightbox-image');
      const loader = lightboxEl.querySelector('.lightbox-loader');
      const counter = lightboxEl.querySelector('.lightbox-counter');
      const prevBtn = lightboxEl.querySelector('.lightbox-prev');
      const nextBtn = lightboxEl.querySelector('.lightbox-next');

      const loadImage = idx => {
        const url = photos[idx];
        const isTrusted =
          typeof url === 'string' &&
          (url.startsWith('/api/photos/') || url.startsWith('/uploads/'));
        loader.style.display = 'block';
        img.style.display = 'none';
        img.src = isTrusted ? url : '';
        img.alt = `Review photo ${idx + 1} of ${total}`;
        if (counter) {
          counter.textContent = `${idx + 1} / ${total}`;
        }
        if (prevBtn) {
          prevBtn.disabled = idx === 0;
        }
        if (nextBtn) {
          nextBtn.disabled = idx === total - 1;
        }
      };

      img.addEventListener('load', () => {
        loader.style.display = 'none';
        img.style.display = 'block';
      });
      img.addEventListener('error', () => {
        loader.style.display = 'none';
      });

      const close = () => {
        lightboxEl.classList.remove('is-open');
        document.body.style.overflow = '';
        document.removeEventListener('keydown', keyHandler);
        setTimeout(() => lightboxEl.remove(), 300);
      };

      const prev = () => {
        if (currentIndex > 0) {
          currentIndex--;
          loadImage(currentIndex);
        }
      };

      const next = () => {
        if (currentIndex < total - 1) {
          currentIndex++;
          loadImage(currentIndex);
        }
      };

      function keyHandler(e) {
        if (e.key === 'Escape') {
          close();
        } else if (e.key === 'ArrowLeft') {
          prev();
        } else if (e.key === 'ArrowRight') {
          next();
        }
      }

      document.addEventListener('keydown', keyHandler);
      lightboxEl.querySelector('.lightbox-close').addEventListener('click', close);
      lightboxEl.addEventListener('click', e => {
        if (e.target === lightboxEl) {
          close();
        }
      });
      if (prevBtn) {
        prevBtn.addEventListener('click', prev);
      }
      if (nextBtn) {
        nextBtn.addEventListener('click', next);
      }

      // Trigger open animation on next frame
      requestAnimationFrame(() => lightboxEl.classList.add('is-open'));

      // Load initial image
      loadImage(currentIndex);
      lightboxEl.querySelector('.lightbox-close').focus();
    },

    /**
     * Setup edit, delete, and report button event listeners
     */
    setupReviewActionButtons() {
      // Edit buttons
      document.querySelectorAll('.review-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const reviewId = btn.dataset.reviewId;
          const review = this._reviewCache ? this._reviewCache[reviewId] : null;
          if (review) {
            this.openEditModal(review);
          } else {
            this.showToast('Unable to load review data. Please refresh.', 'error');
          }
        });
      });

      // Delete buttons
      document.querySelectorAll('.review-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const reviewId = btn.dataset.reviewId;
          this.openDeleteConfirmation(reviewId);
        });
      });

      // Report buttons
      document.querySelectorAll('.review-report-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const reviewId = btn.dataset.reviewId;
          this.openReportModal(reviewId);
        });
      });
    },

    // -------------------------------------------------------------------------
    // Issue 4: Edit Own Review
    // -------------------------------------------------------------------------

    /**
     * Open the edit modal pre-populated with existing review data
     */
    openEditModal(review) {
      // Remove stale modal if any
      const existing = document.getElementById('review-edit-modal');
      if (existing) {
        existing.remove();
      }

      this.createEditModal();

      const modal = document.getElementById('review-edit-modal');
      modal.style.display = 'flex';

      // Pre-fill rating
      const ratingInput = document.getElementById('edit-review-rating');
      if (ratingInput) {
        ratingInput.value = review.rating;
      }
      const stars = document.querySelectorAll('#edit-star-rating-input .star');
      this.highlightStars(stars, review.rating);

      // Wire up star rating for edit modal
      let selectedRating = review.rating;
      const descriptions = {
        1: 'Poor - Would not recommend',
        2: 'Fair - Below expectations',
        3: 'Good - Met expectations',
        4: 'Very Good - Exceeded expectations',
        5: 'Excellent - Outstanding!',
      };
      stars.forEach(star => {
        star.addEventListener('mouseenter', () => {
          this.highlightStars(stars, parseInt(star.dataset.rating));
        });
        star.addEventListener('mouseleave', () => {
          this.highlightStars(stars, selectedRating);
        });

        const selectEditStar = () => {
          selectedRating = parseInt(star.dataset.rating);
          ratingInput.value = selectedRating;
          this.highlightStars(stars, selectedRating);
          const desc = document.getElementById('edit-rating-description');
          if (desc) {
            desc.textContent = descriptions[selectedRating];
          }
        };

        star.addEventListener('click', selectEditStar);

        // Keyboard support: Enter or Space activates the star (role="button")
        star.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectEditStar();
          }
        });
      });

      // Pre-fill form fields
      const titleInput = document.getElementById('edit-review-title');
      if (titleInput) {
        titleInput.value = review.title || '';
      }

      const commentTextarea = document.getElementById('edit-review-comment');
      if (commentTextarea) {
        commentTextarea.value = review.comment || '';
        const charCount = document.getElementById('edit-char-count');
        if (charCount) {
          charCount.textContent = (review.comment || '').length;
        }
        commentTextarea.addEventListener('input', () => {
          if (charCount) {
            charCount.textContent = commentTextarea.value.length;
          }
        });
      }

      const recommendCheckbox = document.getElementById('edit-review-recommend');
      if (recommendCheckbox) {
        recommendCheckbox.checked = review.recommend === true;
      }

      const eventTypeSelect = document.getElementById('edit-review-event-type');
      if (eventTypeSelect) {
        eventTypeSelect.value = review.eventType || '';
      }

      // Wire up submit
      const form = document.getElementById('edit-review-form');
      if (form) {
        form.onsubmit = e => {
          e.preventDefault();
          this.submitEditReview(review.id);
        };
      }
    },

    /**
     * Create the edit modal HTML
     */
    createEditModal() {
      const modalHTML = `
        <div id="review-edit-modal" class="review-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
          <div class="review-modal">
            <div class="review-modal-header">
              <h2 class="review-modal-title" id="edit-modal-title">Edit Your Review</h2>
              <p class="review-modal-subtitle">Update your experience with this supplier</p>
            </div>

            <form id="edit-review-form" class="review-modal-body">
              <div class="review-form-group">
                <label class="review-form-label required">Overall Rating</label>
                <div class="star-rating-input" id="edit-star-rating-input" aria-label="Rating">
                  <span class="star" data-rating="1" role="button" tabindex="0" aria-label="1 star">★</span>
                  <span class="star" data-rating="2" role="button" tabindex="0" aria-label="2 stars">★</span>
                  <span class="star" data-rating="3" role="button" tabindex="0" aria-label="3 stars">★</span>
                  <span class="star" data-rating="4" role="button" tabindex="0" aria-label="4 stars">★</span>
                  <span class="star" data-rating="5" role="button" tabindex="0" aria-label="5 stars">★</span>
                </div>
                <div class="rating-description" id="edit-rating-description"></div>
                <input type="hidden" id="edit-review-rating" name="rating" required />
              </div>

              <div class="review-form-group">
                <label class="review-form-label" for="edit-review-title">Review Title</label>
                <input
                  type="text"
                  id="edit-review-title"
                  name="title"
                  class="review-input"
                  placeholder="Sum up your experience"
                  maxlength="100"
                />
              </div>

              <div class="review-form-group">
                <label class="review-form-label required" for="edit-review-comment">Your Review</label>
                <textarea
                  id="edit-review-comment"
                  name="comment"
                  class="review-textarea"
                  placeholder="Share details of your experience..."
                  required
                  minlength="20"
                  maxlength="2000"
                ></textarea>
                <div class="character-count">
                  <span id="edit-char-count">0</span> / 2000 characters (minimum 20)
                </div>
              </div>

              <div class="review-form-group">
                <label class="review-checkbox">
                  <input type="checkbox" id="edit-review-recommend" name="recommend" />
                  <span class="review-checkbox-label">
                    <strong>I would recommend this supplier</strong>
                  </span>
                </label>
              </div>

              <div class="review-form-group">
                <label class="review-form-label" for="edit-review-event-type">Event Type</label>
                <select id="edit-review-event-type" name="eventType" class="review-filter-select">
                  <option value="">Select event type (optional)</option>
                  <option value="Wedding">Wedding</option>
                  <option value="Birthday">Birthday</option>
                  <option value="Corporate">Corporate Event</option>
                  <option value="Anniversary">Anniversary</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </form>

            <div class="review-modal-footer">
              <button type="button" class="ef-cta btn-cancel" id="btn-edit-cancel">Cancel</button>
              <button type="submit" form="edit-review-form" class="ef-cta btn-submit-review" id="btn-submit-edit">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHTML);

      const modal = document.getElementById('review-edit-modal');

      modal.addEventListener('click', e => {
        if (e.target === modal) {
          this.closeEditModal();
        }
      });

      document.getElementById('btn-edit-cancel').addEventListener('click', () => {
        this.closeEditModal();
      });

      this._editModalEscHandler = e => {
        if (e.key === 'Escape') {
          this.closeEditModal();
        }
      };
      document.addEventListener('keydown', this._editModalEscHandler);
    },

    /**
     * Submit the edited review
     */
    async submitEditReview(reviewId) {
      const submitBtn = document.getElementById('btn-submit-edit');
      const rating = document.getElementById('edit-review-rating')?.value;
      const comment = document.getElementById('edit-review-comment')?.value || '';
      const title = document.getElementById('edit-review-title')?.value || '';
      const recommend = document.getElementById('edit-review-recommend')?.checked;
      const eventType = document.getElementById('edit-review-event-type')?.value || '';

      if (!rating) {
        this.showToast('Please select a rating', 'error');
        return;
      }
      if (comment.length < 20) {
        this.showToast('Review must be at least 20 characters', 'error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      try {
        const { response, data } = await this.fetchWithCSRF(`/api/reviews/${reviewId}`, {
          method: 'PUT',
          body: JSON.stringify({ rating: parseInt(rating), title, comment, recommend, eventType }),
        });

        if (response.ok) {
          this.showToast('Review updated successfully!', 'success');
          this.closeEditModal();
          this.loadReviews();
        } else {
          this.showToast(data.error || 'Failed to update review', 'error');
        }
      } catch (error) {
        console.error('Edit review error:', error);
        this.showToast('Network error. Please try again.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Changes';
        }
      }
    },

    /**
     * Close the edit modal
     */
    closeEditModal() {
      const modal = document.getElementById('review-edit-modal');
      if (modal) {
        modal.remove();
      }
      if (this._editModalEscHandler) {
        document.removeEventListener('keydown', this._editModalEscHandler);
        this._editModalEscHandler = null;
      }
    },

    // -------------------------------------------------------------------------
    // Issue 5: Delete Own Review
    // -------------------------------------------------------------------------

    /**
     * Open the delete confirmation widget
     */
    openDeleteConfirmation(reviewId) {
      const existing = document.getElementById('review-delete-confirm');
      if (existing) {
        existing.remove();
      }

      const widgetHTML = `
        <div id="review-delete-confirm" class="review-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
          <div class="review-confirm-dialog">
            <div class="review-confirm-icon">🗑️</div>
            <h3 class="review-confirm-title" id="delete-confirm-title">Delete Review</h3>
            <p class="review-confirm-message">Are you sure you want to delete this review? This action cannot be undone.</p>
            <div class="review-confirm-actions">
              <button class="ef-cta btn-cancel" id="btn-delete-cancel">Cancel</button>
              <button class="ef-cta btn-danger" id="btn-delete-confirm" data-review-id="${reviewId}">Delete Review</button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', widgetHTML);

      const overlay = document.getElementById('review-delete-confirm');

      const closeDelete = () => {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      };
      function escHandler(e) {
        if (e.key === 'Escape') {
          closeDelete();
        }
      }
      document.addEventListener('keydown', escHandler);

      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          closeDelete();
        }
      });

      document.getElementById('btn-delete-cancel').addEventListener('click', closeDelete);

      document.getElementById('btn-delete-confirm').addEventListener('click', () => {
        this.deleteReview(reviewId);
        closeDelete();
      });
    },

    /**
     * Delete a review
     */
    async deleteReview(reviewId) {
      try {
        const { response, data } = await this.fetchWithCSRF(`/api/reviews/${reviewId}`, {
          method: 'DELETE',
        });

        if (response.ok) {
          this.showToast('Review deleted successfully.', 'success');
          this.loadReviews();
          this.loadRatingDistribution();
        } else {
          this.showToast(data.error || 'Failed to delete review', 'error');
        }
      } catch (error) {
        console.error('Delete review error:', error);
        this.showToast('Network error. Please try again.', 'error');
      }
    },

    // -------------------------------------------------------------------------
    // Issue 6: Report a Review
    // -------------------------------------------------------------------------

    /**
     * Open the report modal
     */
    openReportModal(reviewId) {
      const existing = document.getElementById('review-report-modal');
      if (existing) {
        existing.remove();
      }

      const modalHTML = `
        <div id="review-report-modal" class="review-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
          <div class="review-modal review-modal--sm">
            <div class="review-modal-header">
              <h2 class="review-modal-title" id="report-modal-title">🚩 Report Review</h2>
              <p class="review-modal-subtitle">Help us keep reviews trustworthy and accurate</p>
            </div>
            <div class="review-modal-body">
              <div class="review-form-group">
                <label class="review-form-label required" for="report-reason-select">Reason for reporting</label>
                <select id="report-reason-select" class="review-filter-select" aria-required="true">
                  <option value="">Select a reason...</option>
                  <option value="inappropriate">Inappropriate content</option>
                  <option value="spam">Spam or advertising</option>
                  <option value="fake">Fake or misleading review</option>
                  <option value="offensive">Offensive language</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div class="review-form-group" id="report-detail-group" style="display:none">
                <label class="review-form-label" for="report-detail">Additional details (optional)</label>
                <textarea
                  id="report-detail"
                  class="review-textarea"
                  placeholder="Please provide any additional context..."
                  maxlength="500"
                  style="min-height:80px"
                ></textarea>
              </div>
            </div>
            <div class="review-modal-footer">
              <button type="button" class="ef-cta btn-cancel" id="btn-report-cancel">Cancel</button>
              <button type="button" class="ef-cta btn-submit-review" id="btn-report-submit" disabled>Submit Report</button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHTML);

      const overlay = document.getElementById('review-report-modal');
      const reasonSelect = document.getElementById('report-reason-select');
      const detailGroup = document.getElementById('report-detail-group');
      const submitBtn = document.getElementById('btn-report-submit');

      const closeReport = () => {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      };
      function escHandler(e) {
        if (e.key === 'Escape') {
          closeReport();
        }
      }
      document.addEventListener('keydown', escHandler);

      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          closeReport();
        }
      });

      document.getElementById('btn-report-cancel').addEventListener('click', closeReport);

      reasonSelect.addEventListener('change', () => {
        const hasReason = reasonSelect.value !== '';
        submitBtn.disabled = !hasReason;
        detailGroup.style.display = reasonSelect.value === 'other' ? 'block' : 'none';
      });

      submitBtn.addEventListener('click', () => {
        const reason = reasonSelect.value;
        const detail = document.getElementById('report-detail')?.value || '';
        if (!reason) {
          this.showToast('Please select a reason for the report', 'error');
          return;
        }
        this.submitReport(reviewId, reason, detail);
        closeReport();
      });
    },

    /**
     * Submit a review report
     */
    async submitReport(reviewId, reason, detail = '') {
      try {
        const { response, data } = await this.fetchWithCSRF(`/api/reviews/${reviewId}/report`, {
          method: 'POST',
          body: JSON.stringify({ reason, detail }),
        });

        if (response.ok) {
          this.showToast('Thank you for your report. Our team will review it.', 'success');
        } else {
          this.showToast(data.error || 'Failed to submit report. Please try again.', 'error');
        }
      } catch (error) {
        console.error('Report error:', error);
        this.showToast('Network error. Please try again.', 'error');
      }
    },

    // -------------------------------------------------------------------------
    // Issue 7: New Review Notification (front-end helper)
    // -------------------------------------------------------------------------

    /**
     * Handle a review notification received from the API response.
     * Increments the notification bell badge if present and shows a toast.
     */
    handleReviewNotification(notification) {
      // Increment unread badge on any notification bell elements
      const bells = document.querySelectorAll(
        '.notification-bell, .notification-badge, [data-notification-count], #notification-count'
      );
      bells.forEach(el => {
        if (el.dataset.notificationCount !== undefined) {
          const current = parseInt(el.dataset.notificationCount || '0', 10);
          el.dataset.notificationCount = current + 1;
          el.textContent = current + 1;
        } else {
          const countEl = el.querySelector('.badge, .count, [data-count]');
          if (countEl) {
            const current = parseInt(countEl.textContent || '0', 10);
            countEl.textContent = current + 1;
          }
        }
        el.classList.add('has-notifications');
      });

      if (notification.message) {
        this.showToast(`🔔 ${notification.message}`, 'info');
      }
    },

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
      // Ensure global styles for toast animations exist
      if (!document.getElementById('review-toast-styles')) {
        const style = document.createElement('style');
        style.id = 'review-toast-styles';
        style.textContent = `
          @keyframes reviewToastIn {
            from { opacity: 0; transform: translateX(100%); }
            to   { opacity: 1; transform: translateX(0); }
          }
          @keyframes reviewToastOut {
            from { opacity: 1; transform: translateX(0); }
            to   { opacity: 0; transform: translateX(100%); }
          }
          .review-toast {
            display: flex;
            align-items: center;
            gap: 0.6rem;
            min-width: 240px;
            max-width: 360px;
            padding: 0.85rem 1.25rem;
            border-radius: 10px;
            margin-bottom: 0.5rem;
            box-shadow: 0 6px 20px rgba(0,0,0,0.18);
            font-size: 0.875rem;
            font-weight: 500;
            line-height: 1.4;
            animation: reviewToastIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both;
            cursor: pointer;
          }
          .review-toast--out { animation: reviewToastOut 0.25s ease forwards; }
          .review-toast--success { background: #10b981; color: #fff; }
          .review-toast--error   { background: #ef4444; color: #fff; }
          .review-toast--info    { background: #3b82f6; color: #fff; }
          .review-toast__icon    { font-size: 1.125rem; flex-shrink: 0; }
        `;
        document.head.appendChild(style);
      }

      let container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'reviews-toast-container';
        document.body.appendChild(container);
      }

      const icons = { success: '✅', error: '❌', info: 'ℹ️' };
      const toast = document.createElement('div');
      toast.className = `review-toast review-toast--${type}`;
      toast.setAttribute('role', 'alert');
      toast.setAttribute('aria-live', 'polite');

      // Build icon + message using DOM methods to avoid innerHTML XSS risk
      const iconSpan = document.createElement('span');
      iconSpan.className = 'review-toast__icon';
      iconSpan.setAttribute('aria-hidden', 'true');
      iconSpan.textContent = icons[type] || icons.info;

      const msgSpan = document.createElement('span');
      msgSpan.textContent = message;

      toast.appendChild(iconSpan);
      toast.appendChild(msgSpan);

      container.appendChild(toast);

      const dismiss = () => {
        toast.classList.add('review-toast--out');
        setTimeout(() => toast.remove(), 280);
      };

      toast.addEventListener('click', dismiss);
      setTimeout(dismiss, 4000);
    },
  };

  // Expose to global scope
  window.ReviewsManager = ReviewsManager;
  window.reviewsManager = ReviewsManager; // Instance for direct access
})();
