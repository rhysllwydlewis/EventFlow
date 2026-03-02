/**
 * Supplier Profile Page - Reviews and Package Cards
 * Handles reviews loading and package card interactions
 * Phase 1: Added hero section rendering and SEO meta tags
 * Phase 5: Converted to ES module — imports verification-badges directly
 */

import { renderVerificationBadges, renderTierIcon } from '/assets/js/utils/verification-badges.js';

(function () {
  'use strict';

  let supplierId = null;
  let supplierData = null;

  /**
   * Update SEO meta tags dynamically based on supplier data
   * @param {Object} supplier - Supplier data
   *
   * NOTE: These meta tags are updated client-side via JavaScript. Search engines and
   * social media link preview crawlers (Facebook, Twitter/X, Slack, etc.) do NOT
   * execute JavaScript, so they will always see the generic default meta values from
   * the static HTML. For proper SEO and social sharing previews, server-side rendering
   * (SSR) or a prerender service is required to inject per-supplier meta tags into the
   * HTML response before it reaches the client.
   */
  function updateMetaTags(supplier) {
    if (!supplier) {
      return;
    }

    const title = `${supplier.name} — EventFlow`;
    const description =
      supplier.metaDescription ||
      supplier.description ||
      `View ${supplier.name} on EventFlow - the UK's leading event planning platform.`;
    const image =
      supplier.openGraphImage ||
      supplier.coverImage ||
      supplier.logo ||
      'https://event-flow.co.uk/assets/images/eventflow-og-image.jpg';
    const url = `https://event-flow.co.uk/supplier.html?id=${supplier.id}`;

    // Update page title
    document.title = title;
    const pageTitle = document.getElementById('page-title');
    if (pageTitle) {
      pageTitle.textContent = title;
    }

    // Update meta description
    const metaDesc = document.getElementById('meta-description');
    if (metaDesc) {
      metaDesc.setAttribute('content', description);
    }

    // Update Open Graph tags
    const ogTitle = document.getElementById('og-title');
    if (ogTitle) {
      ogTitle.setAttribute('content', title);
    }

    const ogDesc = document.getElementById('og-description');
    if (ogDesc) {
      ogDesc.setAttribute('content', description);
    }

    const ogImage = document.getElementById('og-image');
    if (ogImage) {
      ogImage.setAttribute('content', image);
    }

    const ogUrl = document.getElementById('og-url');
    if (ogUrl) {
      ogUrl.setAttribute('content', url);
    }

    // Update Twitter Card tags
    const twitterTitle = document.getElementById('twitter-title');
    if (twitterTitle) {
      twitterTitle.setAttribute('content', title);
    }

    const twitterDesc = document.getElementById('twitter-description');
    if (twitterDesc) {
      twitterDesc.setAttribute('content', description);
    }

    const twitterImage = document.getElementById('twitter-image');
    if (twitterImage) {
      twitterImage.setAttribute('content', image);
    }

    const twitterUrl = document.getElementById('twitter-url');
    if (twitterUrl) {
      twitterUrl.setAttribute('content', url);
    }
  }

  /**
   * Render hero section with supplier data
   * @param {Object} supplier - Supplier data
   */
  function renderHeroSection(supplier) {
    if (!supplier) {
      return;
    }

    // Update banner image
    const heroBanner = document.getElementById('hero-banner');
    if (heroBanner && supplier.coverImage) {
      heroBanner.src = supplier.coverImage;
      heroBanner.alt = `${supplier.name} banner`;
    }

    // Render badges using verification-badges utility (imported at module scope above)
    const badgesContainer = document.getElementById('hero-badges');
    if (badgesContainer) {
      if (typeof renderVerificationBadges !== 'undefined') {
        // Use the utility function if available
        badgesContainer.innerHTML = renderVerificationBadges(supplier, { size: 'normal' });
      } else {
        // Fallback to inline rendering
        const badges = [];

        // Founding Supplier
        if (supplier.isFoundingSupplier || supplier.isFounding) {
          badges.push(
            '<span class="badge badge-founding" aria-label="Founding supplier" title="Founding Supplier - Original member since 2024">⭐ Founding</span>'
          );
        }

        // Pro+ Badge
        if (supplier.subscription?.tier === 'pro_plus' || supplier.proPlan === 'Pro+') {
          badges.push(
            '<span class="badge badge-pro-plus" aria-label="Pro Plus supplier" title="Pro Plus - Premium features">Pro+</span>'
          );
        }
        // Pro Badge
        else if (supplier.isPro || supplier.subscription?.tier === 'pro') {
          const now = new Date();
          const proExpiry = supplier.proExpiresAt ? new Date(supplier.proExpiresAt) : null;
          const isProActive = !proExpiry || proExpiry > now;

          if (isProActive) {
            badges.push(
              '<span class="badge badge-pro" aria-label="Pro supplier" title="Pro - Enhanced features">✨ Pro</span>'
            );
          }
        }

        // Email Verified
        if (
          supplier.emailVerified ||
          supplier.verifications?.email?.verified ||
          supplier.verified
        ) {
          badges.push(
            '<span class="badge badge-email-verified" aria-label="Email verified" title="Email address verified">✓ Email</span>'
          );
        }

        // Phone Verified
        if (supplier.phoneVerified || supplier.verifications?.phone?.verified) {
          badges.push(
            '<span class="badge badge-phone-verified" aria-label="Phone verified" title="Phone number verified">✓ Phone</span>'
          );
        }

        // Business Verified
        if (supplier.businessVerified || supplier.verifications?.business?.verified) {
          badges.push(
            '<span class="badge badge-business-verified" aria-label="Business verified" title="Business documents verified">✓ Business</span>'
          );
        }

        badgesContainer.innerHTML = badges.join('');
      }
    }

    // Update title with inline tier icon
    const heroTitle = document.getElementById('hero-title');
    if (heroTitle) {
      heroTitle.removeAttribute('aria-busy');
      heroTitle.textContent = supplier.name;
      const tierIconEl = document.getElementById('hero-tier-icon');
      if (tierIconEl) {
        // Prefer shared EFTierIcon helper (tier-icon.js), fall back to module-imported renderTierIcon
        const iconFn =
          (typeof EFTierIcon !== 'undefined' && EFTierIcon.render) ||
          (typeof renderTierIcon !== 'undefined' && renderTierIcon);
        if (iconFn) {
          tierIconEl.innerHTML = iconFn(supplier);
        }
      }
    }

    // Update breadcrumb
    const breadcrumbName = document.getElementById('breadcrumb-supplier-name');
    if (breadcrumbName) {
      breadcrumbName.removeAttribute('aria-busy');
      breadcrumbName.textContent = supplier.name;
    }

    // Update tagline
    const heroTagline = document.getElementById('hero-tagline');
    if (heroTagline) {
      heroTagline.textContent = supplier.tagline || supplier.description?.substring(0, 150) || '';
      heroTagline.style.display = heroTagline.textContent ? 'block' : 'none';
    }

    // Render meta information
    const heroMeta = document.getElementById('hero-meta');
    if (heroMeta) {
      const metaItems = [];

      // Rating
      if (supplier.rating && supplier.reviewCount) {
        const rating = Number(supplier.rating).toFixed(1);
        const reviewCount = Number(supplier.reviewCount);
        metaItems.push(`
          <div class="meta-item meta-rating">
            <span class="star-icon" aria-hidden="true">⭐</span>
            <span>${rating} (${reviewCount} reviews)</span>
          </div>
        `);
      }

      // Location
      if (supplier.location) {
        const location = escapeHtml(supplier.location);
        const postcode = supplier.postcode ? escapeHtml(supplier.postcode) : '';
        metaItems.push(`
          <div class="meta-item meta-location">
            <span aria-hidden="true">📍</span>
            <span>${location}${postcode ? `, ${postcode}` : ''}</span>
          </div>
        `);
      }

      // Price range
      if (supplier.priceRange) {
        const priceRange = escapeHtml(supplier.priceRange);
        metaItems.push(`
          <div class="meta-item meta-price">
            <span aria-hidden="true">💰</span>
            <span>${priceRange}</span>
          </div>
        `);
      }

      heroMeta.innerHTML = metaItems.join('');
    }

    // Setup CTA buttons
    const btnEnquiry = document.getElementById('btn-enquiry');
    if (btnEnquiry) {
      btnEnquiry.onclick = () => {
        const recipientId = supplier.ownerUserId;
        if (!recipientId) {
          if (window.EventFlowNotifications) {
            window.EventFlowNotifications.info(
              'This supplier cannot receive messages at this time.'
            );
          }
          return;
        }
        // Sanitize supplier name for safe use in prefill message
        // Remove potentially harmful characters while preserving readability
        const supplierName =
          (supplier.name || 'Supplier').replace(/[<>'"&]/g, '').trim() || 'Supplier';

        // Use QuickComposeV4 slide-up panel if available
        if (window.QuickComposeV4) {
          window.QuickComposeV4.open({
            recipientId: recipientId,
            contextType: 'supplier_profile',
            contextId: supplier.id,
            contextTitle: supplier.name,
            prefill: `Hi ${supplierName}! I'd like to enquire about your services.`,
          });
          return;
        }

        // Fallback: navigate to messenger
        const params = new URLSearchParams({
          new: 'true',
          recipientId: recipientId,
          contextType: 'supplier',
          contextId: supplier.id,
          contextTitle: supplier.name,
          prefill: `Hi ${supplierName}! I'd like to enquire about your services.`,
        });
        window.location.href = `/messenger/?${params.toString()}`;
      };
    }

    // Setup message button
    const btnMessage = document.getElementById('btn-message-supplier');
    if (btnMessage && supplier.ownerUserId) {
      btnMessage.setAttribute('data-quick-compose', 'true');
      btnMessage.setAttribute('data-recipient-id', supplier.ownerUserId);
      btnMessage.setAttribute('data-context-type', 'supplier_profile');
      btnMessage.setAttribute('data-context-id', supplier.id);
      btnMessage.setAttribute('data-context-title', supplier.name);
      // Remove legacy action attribute to avoid MessengerTrigger conflict
      btnMessage.removeAttribute('data-messenger-action');
      // Re-attach QuickComposeV4 handler once attributes are set
      if (window.QuickComposeV4 && typeof window.QuickComposeV4.attachAll === 'function') {
        window.QuickComposeV4.attachAll();
      }
    } else if (btnMessage) {
      btnMessage.style.display = 'none'; // Hide if no owner user ID
    }

    const btnCall = document.getElementById('btn-call');
    if (btnCall && supplier.phone) {
      btnCall.href = `tel:${supplier.phone}`;
      btnCall.style.display = 'inline-flex';
    } else if (btnCall) {
      btnCall.style.display = 'none';
    }

    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
      btnSave.onclick = async () => {
        try {
          const response = await fetch('/api/shortlist', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
            },
            credentials: 'include',
            body: JSON.stringify({
              type: 'supplier',
              id: supplier.id,
              name: supplier.name,
              imageUrl: supplier.profileImage || supplier.coverImage || null,
              category: supplier.category || null,
              location: supplier.location || null,
              priceHint: supplier.priceHint || supplier.price_display || null,
              rating: supplier.rating || null,
            }),
          });

          const data = await response.json();

          if (response.ok) {
            if (window.EventFlowNotifications) {
              window.EventFlowNotifications.success('Saved to your shortlist!');
            }
            btnSave.setAttribute('aria-pressed', 'true');
            btnSave.title = 'Saved to shortlist';
          } else if (response.status === 409 && data.error === 'Item already in shortlist') {
            if (window.EventFlowNotifications) {
              window.EventFlowNotifications.info('Already in your shortlist');
            }
          } else if (response.status === 401 || response.status === 403) {
            if (window.EventFlowNotifications) {
              window.EventFlowNotifications.info('Please sign in to save suppliers');
            }
          } else {
            if (window.EventFlowNotifications) {
              window.EventFlowNotifications.error('Could not save — please try again');
            }
          }
        } catch (err) {
          console.error('Save to shortlist error:', err);
          if (window.EventFlowNotifications) {
            window.EventFlowNotifications.error('Could not save — please try again');
          }
        }
      };
    }

    const btnShare = document.getElementById('btn-share');
    if (btnShare) {
      btnShare.onclick = async () => {
        const shareData = {
          title: supplier.name,
          text: supplier.description || `Check out ${supplier.name} on EventFlow`,
          url: window.location.href,
        };

        if (navigator.share) {
          try {
            await navigator.share(shareData);
          } catch (err) {
            if (err.name !== 'AbortError') {
              console.error('Error sharing:', err);
            }
          }
        } else {
          // Fallback: Copy to clipboard
          navigator.clipboard.writeText(window.location.href);
          if (window.EventFlowNotifications) {
            window.EventFlowNotifications.success('Link copied to clipboard!');
          }
        }
      };
    }
  }

  /**
   * Render the dedicated "Badges & Recognition" section on the profile page.
   * Uses a card layout (icon + name + description) for earned badges.
   * Groups: Subscription → Earned/Performance → Founding/Featured → Verification
   */
  function renderBadgesSection(supplier) {
    const container = document.getElementById('supplier-badges-section');
    if (!container || !supplier) {
      return;
    }

    const sections = [];

    // --- Group 1: Subscription tier badges ---
    const tier =
      typeof EFTierIcon !== 'undefined'
        ? EFTierIcon.resolve(supplier)
        : supplier.subscriptionTier ||
          supplier.subscription?.tier ||
          (supplier.isPro ? 'pro' : 'free');

    const tierBadgesHtml = [];
    if (tier === 'pro_plus') {
      tierBadgesHtml.push(
        '<span class="badge badge-pro-plus" title="Professional Plus — Premium subscription" aria-label="Pro Plus subscriber">Pro Plus</span>'
      );
    } else if (tier === 'pro') {
      tierBadgesHtml.push(
        '<span class="badge badge-pro" title="Professional — Enhanced subscription" aria-label="Pro subscriber">Pro</span>'
      );
    }

    if (tierBadgesHtml.length > 0) {
      sections.push(`
        <p class="badges-section__group-label">Subscription</p>
        <div class="profile-badges">${tierBadgesHtml.join('')}</div>
      `);
    }

    // --- Group 2: Earned / auto-awarded performance badges (from badgeDetails) ---
    const SKIP_TYPES = new Set(['pro', 'pro-plus', 'founder', 'verified', 'featured']);
    const earnedBadges = Array.isArray(supplier.badgeDetails)
      ? supplier.badgeDetails.filter(b => !SKIP_TYPES.has(b.type))
      : [];

    if (earnedBadges.length > 0) {
      const cards = earnedBadges
        .map(
          b => `
        <div class="badge-card">
          <div class="badge-card__icon" aria-hidden="true">${b.icon || '🏅'}</div>
          <div class="badge-card__body">
            <div class="badge-card__name">${escapeHtml(b.name)}</div>
            ${b.description ? `<div class="badge-card__desc">${escapeHtml(b.description)}</div>` : ''}
          </div>
        </div>
      `
        )
        .join('');

      sections.push(`
        <p class="badges-section__group-label">Earned Achievements</p>
        <div class="badge-cards-grid">${cards}</div>
      `);
    }

    // --- Group 3: Founding / Featured ---
    const honorBadges = [];
    if (supplier.isFoundingSupplier || supplier.isFounding || supplier.founding) {
      honorBadges.push(
        '<span class="badge badge-founding" title="Founding Supplier — One of our first partners" aria-label="Founding supplier">🏆 Founding</span>'
      );
    }
    if (supplier.featured || supplier.featuredSupplier) {
      honorBadges.push(
        '<span class="badge badge-featured" title="Featured Supplier" aria-label="Featured supplier">★ Featured</span>'
      );
    }
    if (honorBadges.length > 0) {
      sections.push(`
        <p class="badges-section__group-label">Recognition</p>
        <div class="profile-badges">${honorBadges.join('')}</div>
      `);
    }

    // --- Group 4: Verification badges ---
    const verifyBadges = [];
    if (supplier.emailVerified || supplier.verifications?.email?.verified || supplier.verified) {
      verifyBadges.push(
        '<span class="badge badge-email-verified" title="Email address verified" aria-label="Email verified">✓ Email</span>'
      );
    }
    if (supplier.phoneVerified || supplier.verifications?.phone?.verified) {
      verifyBadges.push(
        '<span class="badge badge-phone-verified" title="Phone number verified" aria-label="Phone verified">✓ Phone</span>'
      );
    }
    if (supplier.businessVerified || supplier.verifications?.business?.verified) {
      verifyBadges.push(
        '<span class="badge badge-business-verified" title="Business documents verified" aria-label="Business verified">✓ Business</span>'
      );
    }
    if (verifyBadges.length > 0) {
      sections.push(`
        <p class="badges-section__group-label">Verification</p>
        <div class="profile-badges">${verifyBadges.join('')}</div>
      `);
    }

    if (sections.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.innerHTML = `
      <div class="badges-section">
        <h2 class="badges-section__title">Badges &amp; Recognition</h2>
        ${sections.join('')}
      </div>
    `;
  }

  /**
   * Load supplier data and render hero
   */
  async function loadSupplierData() {
    if (!supplierId) {
      return;
    }

    try {
      const response = await fetch(`/api/suppliers/${supplierId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to load supplier data');
      }

      supplierData = await response.json();

      // Update meta tags
      updateMetaTags(supplierData);

      // Render hero section
      renderHeroSection(supplierData);

      // Render dedicated badges section
      renderBadgesSection(supplierData);
    } catch (error) {
      console.error('Error loading supplier data:', error);
      const heroTitle = document.getElementById('hero-title');
      if (heroTitle) {
        heroTitle.removeAttribute('aria-busy');
        heroTitle.textContent = 'Supplier Not Found';
      }
      const container = document.getElementById('supplier-container');
      if (container) {
        container.innerHTML = `
          <div class="error-state" role="status" aria-live="polite">
            <div class="error-state-icon">⚠️</div>
            <div class="error-state-title">Unable to load supplier</div>
            <div class="error-state-description">The supplier profile could not be loaded. Please try again.</div>
            <button class="error-state-action" id="retry-supplier-btn">Try Again</button>
          </div>
        `;
        const retryBtn = container.querySelector('#retry-supplier-btn');
        if (retryBtn) {
          retryBtn.addEventListener('click', loadSupplierData);
        }
      }
    }
  }

  /**
   * Initialize supplier profile page
   */
  function init() {
    const urlParams = new URLSearchParams(window.location.search);
    supplierId = urlParams.get('id');

    if (!supplierId) {
      console.warn('No supplier ID found');
      return;
    }

    // Validate supplierId format before making API calls (expected format: sup_xxxxx)
    if (!/^sup_[a-zA-Z0-9_-]+$/.test(supplierId)) {
      console.warn('Invalid supplier ID format:', supplierId);
      return;
    }

    loadSupplierData();
    loadReviews();
    initializePackageCards();
  }

  /**
   * Load reviews for supplier
   */
  async function loadReviews() {
    const reviewsContainer = document.getElementById('reviews-container');
    if (!reviewsContainer) {
      return;
    }

    showLoadingState(reviewsContainer);

    try {
      const response = await fetch(`/api/v1/reviews?supplierId=${supplierId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to load reviews');
      }

      const data = await response.json();
      const reviews = data.reviews || data.items || [];

      if (reviews.length === 0) {
        showEmptyState(reviewsContainer);
      } else {
        renderReviews(reviewsContainer, reviews);
      }
    } catch (error) {
      console.error('Error loading reviews:', error);
      showErrorState(reviewsContainer, error.message);
    }
  }

  /**
   * Show loading state
   */
  function showLoadingState(container) {
    container.setAttribute('aria-hidden', 'true');
    container.innerHTML = `
      <div class="skeleton-list-item"><div class="skeleton skeleton-avatar"></div><div style="flex:1"><div class="skeleton skeleton-text skeleton-text-medium" style="margin-bottom:0.25rem;"></div><div class="skeleton skeleton-text skeleton-text-short"></div></div></div>
      <div class="skeleton-list-item"><div class="skeleton skeleton-avatar"></div><div style="flex:1"><div class="skeleton skeleton-text skeleton-text-medium" style="margin-bottom:0.25rem;"></div><div class="skeleton skeleton-text skeleton-text-short"></div></div></div>
      <div class="skeleton-list-item"><div class="skeleton skeleton-avatar"></div><div style="flex:1"><div class="skeleton skeleton-text skeleton-text-medium" style="margin-bottom:0.25rem;"></div><div class="skeleton skeleton-text skeleton-text-short"></div></div></div>
    `;
  }

  /**
   * Show empty state
   */
  function showEmptyState(container) {
    container.removeAttribute('aria-hidden');
    container.innerHTML = `
      <div class="reviews-empty" style="text-align: center; padding: 3rem 1rem; color: var(--muted);">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 1rem; opacity: 0.5;">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
        <h3 style="margin-bottom: 0.5rem;">No reviews yet</h3>
        <p>Be the first to review this supplier</p>
      </div>
    `;
  }

  /**
   * Show error state with retry button
   */
  function showErrorState(container, errorMessage) {
    container.removeAttribute('aria-hidden');
    container.innerHTML = `
      <div class="reviews-error" style="text-align: center; padding: 3rem 1rem;">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 1rem; color: #ef4444; opacity: 0.8;">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h3 style="margin-bottom: 0.5rem; color: #ef4444;">Failed to load reviews</h3>
        <p style="color: var(--muted); margin-bottom: 1rem;">${escapeHtml(errorMessage || 'An unexpected error occurred.')}</p>
        <button id="retry-reviews-btn" class="btn btn-primary">Retry</button>
      </div>
    `;

    document.getElementById('retry-reviews-btn').addEventListener('click', loadReviews);
  }

  /**
   * Render reviews
   */
  function renderReviews(container, reviews) {
    container.removeAttribute('aria-hidden');
    const reviewsHTML = reviews
      .map((review, index) => {
        const rating = Math.max(1, Math.min(5, review.rating || 0));
        const starsHTML = generateStarRating(rating);

        return `
        <div class="review-card" style="padding: 1.5rem; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
            <div>
              <div class="review-stars" style="margin-bottom: 0.5rem;" aria-label="${rating} out of 5 stars">
                ${starsHTML}
              </div>
              <div style="font-weight: 500;">${escapeHtml(review.customerName || 'Anonymous')}</div>
              <div class="small" style="color: var(--muted);">${formatDate(review.createdAt)}</div>
            </div>
          </div>
          <div class="review-content" data-review-index="${index}"></div>
        </div>
      `;
      })
      .join('');

    container.innerHTML = `
      <div class="reviews-list">
        <h2 style="margin-bottom: 1.5rem;">Customer Reviews</h2>
        ${reviewsHTML}
      </div>
    `;

    reviews.forEach((review, index) => {
      const reviewElement = container.querySelector(`[data-review-index="${index}"]`);
      if (reviewElement) {
        reviewElement.textContent = review.comment || review.content || 'No comment provided';
      }
    });
  }

  /**
   * Generate star rating HTML
   */
  function generateStarRating(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

    let html = '';

    for (let i = 0; i < fullStars; i++) {
      html += '<span style="color: #fbbf24; font-size: 1.25rem;">★</span>';
    }

    if (hasHalfStar) {
      html += '<span style="color: #fbbf24; font-size: 1.25rem;">⯨</span>';
    }

    for (let i = 0; i < emptyStars; i++) {
      html += '<span style="color: #d1d5db; font-size: 1.25rem;">★</span>';
    }

    return html;
  }

  /**
   * Format date for display
   */
  function formatDate(date) {
    if (!date) {
      return '';
    }

    try {
      const d = new Date(date);
      const now = new Date();
      const diffTime = Math.abs(now - d);
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        return 'Today';
      }
      if (diffDays === 1) {
        return 'Yesterday';
      }
      if (diffDays < 7) {
        return `${diffDays} days ago`;
      }
      if (diffDays < 30) {
        return `${Math.floor(diffDays / 7)} weeks ago`;
      }
      if (diffDays < 365) {
        return `${Math.floor(diffDays / 30)} months ago`;
      }

      return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  /**
   * Initialize package card click handlers
   */
  function initializePackageCards() {
    const packageCards = document.querySelectorAll('[data-package-id]');

    packageCards.forEach(card => {
      const packageId = card.getAttribute('data-package-id');

      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `View details for package ${packageId}`);
      card.classList.add('package-card-interactive');

      card.addEventListener('click', () => handlePackageClick(packageId));

      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handlePackageClick(packageId);
        }
      });

      card.addEventListener('mouseenter', () => {
        card.classList.add('package-card-hover');
      });

      card.addEventListener('mouseleave', () => {
        card.classList.remove('package-card-hover');
      });
    });

    if (packageCards.length > 0) {
      addPackageCardStyles();
    }
  }

  /**
   * Handle package card click
   */
  function handlePackageClick(packageId) {
    window.location.href = `/package?id=${packageId}`;
  }

  /**
   * Add CSS styles for package cards
   */
  function addPackageCardStyles() {
    if (document.getElementById('package-card-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'package-card-styles';
    style.textContent = `
      .package-card-interactive {
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      
      .package-card-interactive:hover,
      .package-card-hover {
        transform: translateY(-4px);
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.12);
      }
      
      .package-card-interactive:focus {
        outline: 2px solid #0B8073;
        outline-offset: 2px;
      }
      
      .package-card-interactive:active {
        transform: translateY(-2px);
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
      return '';
    }

    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
