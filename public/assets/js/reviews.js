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

(function () {
  'use strict';

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
          <p style="margin-top: 1rem; color: #6b7280;">Loading reviews...</p>
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
                ? '<button class="btn-write-review" onclick="reviewsManager.openReviewModal()">Write the First Review</button>'
                : `<a href="${this.getSignInRedirectUrl()}" class="reviews-empty__signin-cta">Sign in to write a review</a>`
            }
          </div>
        `;
        return;
      }

      container.innerHTML = reviews.map(review => this.renderReviewCard(review)).join('');

      // Render pagination
      this.renderPagination(pagination);

      // Setup vote buttons
      this.setupVoteButtons();
    },

    /**
     * Render a single review card
     */
    renderReviewCard(review) {
      const stars = this.renderStars(review.rating);
      const verified = review.verified
        ? '<span class="badge-verified">✓ Verified Customer</span>'
        : '';
      const emailVerified = review.emailVerified
        ? '<span class="badge-email-verified">✓ Email Verified</span>'
        : '';

      const recommend = review.recommend
        ? '<div class="review-recommendation">👍 Recommends this supplier</div>'
        : '';

      const photos =
        review.photos && review.photos.length > 0
          ? `<div class="review-photos">
             ${review.photos.map(photo => `<div class="review-photo"><img src="${photo}" alt="Review photo" /></div>`).join('')}
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

      const helpfulCount = review.helpfulCount || 0;
      const unhelpfulCount = review.unhelpfulCount || 0;

      return `
        <div class="review-card ${review.flagged ? 'flagged' : ''}" data-review-id="${review.id}">
          <div class="review-card-header">
            <div class="review-author-info">
              <div class="review-author-avatar">
                ${this.getInitials(review.userName)}
              </div>
              <div class="review-author-details">
                <div class="review-author-name">${this.escapeHtml(review.userName)}</div>
                <div class="review-badges-inline">
                  ${verified}
                  ${emailVerified}
                </div>
                <div class="review-meta">
                  <span class="review-date">${this.formatDate(review.createdAt)}</span>
                  ${review.eventType ? `<span class="review-event-type">🎉 ${this.escapeHtml(review.eventType)}</span>` : ''}
                </div>
              </div>
            </div>
            <div class="review-card-rating">
              <div class="review-stars">${stars}</div>
              <span class="review-rating-number">${review.rating}.0</span>
            </div>
          </div>
          
          <div class="review-card-content">
            ${review.title ? `<h4 class="review-title">${this.escapeHtml(review.title)}</h4>` : ''}
            <p class="review-text">${this.escapeHtml(review.comment)}</p>
            ${recommend}
            ${photos}
          </div>
          
          ${supplierResponse}
          
          <div class="review-card-actions">
            <button class="review-action-btn vote-btn" data-review-id="${review.id}" data-vote-type="helpful">
              <span>👍</span>
              <span>Helpful</span>
              <span class="vote-count">(${helpfulCount})</span>
            </button>
            <button class="review-action-btn vote-btn" data-review-id="${review.id}" data-vote-type="unhelpful">
              <span>👎</span>
              <span>Not Helpful</span>
              <span class="vote-count">(${unhelpfulCount})</span>
            </button>
          </div>
        </div>
      `;
    },

    /**
     * Render star rating
     */
    renderStars(rating) {
      const fullStars = Math.floor(rating);
      const stars = [];

      for (let i = 0; i < fullStars; i++) {
        stars.push('★');
      }

      for (let i = fullStars; i < 5; i++) {
        stars.push('☆');
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
      return date.toLocaleDateString();
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
        `<button class="pagination-btn" ${!pagination.hasPrev ? 'disabled' : ''} onclick="reviewsManager.goToPage(${currentPage - 1})">← Previous</button>`
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
          `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="reviewsManager.goToPage(${i})">${i}</button>`
        );
      }

      // Next button
      pages.push(
        `<button class="pagination-btn" ${!pagination.hasNext ? 'disabled' : ''} onclick="reviewsManager.goToPage(${currentPage + 1})">Next →</button>`
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
      if (starsElement && total === 0) {
        starsElement.style.opacity = '0.3';
      } else if (starsElement) {
        starsElement.style.opacity = '1';
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
        } catch (_) {
          // ignore network errors — fall through to redirect if still unauthenticated
        }
      }

      if (!this.currentUser) {
        this.showToast('Please sign in to write a review', 'error');
        window.location.href = this.getSignInRedirectUrl();
        return;
      }

      const modal = document.getElementById('review-modal');
      if (!modal) {
        this.createReviewModal();
      } else {
        modal.style.display = 'flex';
      }

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
        <div id="review-modal" class="review-modal-overlay">
          <div class="review-modal">
            <div class="review-modal-header">
              <h2 class="review-modal-title">Write a Review</h2>
              <p class="review-modal-subtitle">Share your experience with this supplier</p>
            </div>
            
            <form id="review-form" class="review-modal-body">
              <!-- Rating -->
              <div class="review-form-group">
                <label class="review-form-label required">Overall Rating</label>
                <div class="star-rating-input" id="star-rating-input">
                  <span class="star" data-rating="1">★</span>
                  <span class="star" data-rating="2">★</span>
                  <span class="star" data-rating="3">★</span>
                  <span class="star" data-rating="4">★</span>
                  <span class="star" data-rating="5">★</span>
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
            </form>

            <div class="review-modal-footer">
              <button type="button" class="btn-cancel" onclick="reviewsManager.closeReviewModal()">
                Cancel
              </button>
              <button type="submit" form="review-form" class="btn-submit-review" id="btn-submit-review">
                Submit Review
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHTML);

      // Close modal on overlay click
      const modal = document.getElementById('review-modal');
      modal.addEventListener('click', e => {
        if (e.target === modal) {
          this.closeReviewModal();
        }
      });
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

        star.addEventListener('click', () => {
          selectedRating = parseInt(star.dataset.rating);
          ratingInput.value = selectedRating;
          this.highlightStars(stars, selectedRating);
          description.textContent = descriptions[selectedRating];
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
     * Submit review
     */
    async submitReview() {
      const submitBtn = document.getElementById('btn-submit-review');
      const form = document.getElementById('review-form');

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
      submitBtn.textContent = 'Submitting...';

      try {
        const formData = new FormData(form);
        const data = {
          rating: parseInt(rating),
          title: formData.get('title'),
          comment: formData.get('comment'),
          recommend: document.getElementById('review-recommend').checked,
          eventType: formData.get('eventType'),
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
        modal.style.display = 'none';
        // Reset form
        const form = document.getElementById('review-form');
        if (form) {
          form.reset();
        }
      }
    },

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
      // Check if toast container exists
      let container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 10000;
        `;
        document.body.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.style.cssText = `
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        margin-bottom: 0.5rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        animation: slideIn 0.3s ease;
      `;
      toast.textContent = message;

      container.appendChild(toast);

      // Remove after 3 seconds
      setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    },
  };

  // Expose to global scope
  window.ReviewsManager = ReviewsManager;
  window.reviewsManager = ReviewsManager; // Instance for direct access
})();
