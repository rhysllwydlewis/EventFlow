/**
 * Supplier Profile Page — Authoritative Renderer
 *
 * This module is the single source of truth for rendering the public
 * supplier profile page (/supplier.html). It replaces the previous
 * split between app.js initSupplier() and this file.
 *
 * Rendering responsibilities:
 *  - updateMetaTags        — SEO meta (client-side best-effort)
 *  - renderHeroSection     — banner, badges, title, tagline, meta, CTAs
 *  - renderAboutSection    — description, stats, highlights, services, social, trust
 *  - renderGallerySection  — photo gallery (featured + thumbs)
 *  - renderPackagesSection — premium package cards
 *  - renderReviewsSection  — reviews widget scaffold + ReviewsManager init
 *  - renderSidebarSection  — CTA card, trust card, key details
 *  - renderBadgesSection   — badges & recognition (full-width bottom)
 */

import { renderVerificationBadges, renderTierIcon } from '/assets/js/utils/verification-badges.js';

(function () {
  'use strict';

  let supplierId = null;
  let supplierData = null;

  // ─── Utilities ──────────────────────────────────────────────────────────────

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

  /**
   * Format a relative date string
   */
  function formatDate(date) {
    if (!date) {
      return '';
    }
    try {
      const d = new Date(date);
      const now = new Date();
      const diffDays = Math.floor(Math.abs(now - d) / (1000 * 60 * 60 * 24));
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
      return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short' });
    } catch (_) {
      return '';
    }
  }

  /**
   * Clamp years-active to at least 1
   */
  function yearsActive(createdAt) {
    if (!createdAt) {
      return null;
    }
    const years = Math.floor(
      (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365.25)
    );
    return years >= 1 ? years : null;
  }

  /**
   * Show a skeleton loading state inside a container.
   * Sets aria-hidden=true while content is loading so screen readers skip
   * the placeholder items. Call container.removeAttribute('aria-hidden') after
   * real content is written in.
   * @param {HTMLElement} container
   * @param {number} [count=3] - number of skeleton items to render
   */
  function showLoadingState(container, count = 3) {
    if (!container) {
      return;
    }
    container.setAttribute('aria-hidden', 'true');
    const items = Array.from(
      { length: count },
      () => '<div class="skeleton-list-item"></div>'
    ).join('');
    container.innerHTML = `<div class="skeleton-list" aria-hidden="true">${items}</div>`;
  }

  /**
   * Render an array of review objects into list-item HTML.
   * Uses the index for stable key generation and aria-posinset attributes.
   * @param {Array} reviews
   * @returns {string} HTML string
   */
  function renderReviews(reviews) {
    if (!Array.isArray(reviews) || reviews.length === 0) {
      return '';
    }
    return reviews
      .map((review, index) => {
        const stars = generateStars(review.rating || 0);
        const author = escapeHtml(review.authorName || review.author || 'Anonymous');
        const body = escapeHtml(review.body || review.comment || '');
        const date = formatDate(review.date || review.createdAt);
        return `
          <div class="review-item" role="listitem" aria-posinset="${index + 1}" aria-setsize="${reviews.length}">
            <div class="review-header">
              <span class="review-author">${author}</span>
              <span class="review-stars" aria-label="${review.rating || 0} out of 5 stars">${stars}</span>
              ${date ? `<span class="review-date">${date}</span>` : ''}
            </div>
            ${body ? `<p class="review-body">${body}</p>` : ''}
          </div>
        `;
      })
      .join('');
  }

  /**
   * Generate star rating HTML using CSS classes
   */
  function generateStars(rating) {
    const full = Math.floor(rating);
    const empty = 5 - full;
    let html = '';
    for (let i = 0; i < full; i++) {
      html += '<span class="sp-star-full" aria-hidden="true">★</span>';
    }
    for (let i = 0; i < empty; i++) {
      html += '<span class="sp-star-empty" aria-hidden="true">★</span>';
    }
    return html;
  }

  // ─── Meta Tags ───────────────────────────────────────────────────────────────

  /**
   * Update SEO meta tags with supplier data (client-side best-effort).
   * NOTE: crawlers do not execute JS — server-side rendering is needed for
   * true SEO/social preview support.
   */
  function updateMetaTags(supplier) {
    if (!supplier) {
      return;
    }

    const title = `${supplier.name} — EventFlow`;
    const description =
      supplier.metaDescription ||
      supplier.description ||
      `View ${supplier.name} on EventFlow — the UK's leading event planning platform.`;
    const image =
      supplier.openGraphImage ||
      supplier.bannerUrl ||
      supplier.coverImage ||
      supplier.logo ||
      'https://event-flow.co.uk/assets/images/eventflow-og-image.png?v=2';
    const url = `https://event-flow.co.uk/supplier?id=${supplier.id}`;

    document.title = title;

    const setContent = (id, value) => {
      const el = document.getElementById(id);
      if (el) {
        el.setAttribute('content', value);
      }
    };
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = value;
      }
    };

    setText('page-title', title);
    setContent('meta-description', description);
    setContent('og-title', title);
    setContent('og-description', description);
    setContent('og-image', image);
    setContent('og-url', url);
    setContent('twitter-title', title);
    setContent('twitter-description', description);
    setContent('twitter-image', image);
    setContent('twitter-url', url);
  }

  // ─── Hero Section ────────────────────────────────────────────────────────────

  function renderHeroSection(supplier) {
    if (!supplier) {
      return;
    }

    // Banner image
    const heroBanner = document.getElementById('hero-banner');
    const bannerUrl = supplier.bannerUrl || supplier.coverImage || null;
    if (heroBanner) {
      if (bannerUrl) {
        heroBanner.src = bannerUrl;
        heroBanner.alt = `${supplier.name} banner`;
      } else {
        heroBanner.src = '/assets/images/placeholder-banner.svg';
        heroBanner.alt = `${supplier.name} banner`;
        // Apply brand theme tint
        const heroSection = document.getElementById('supplier-hero');
        if (heroSection && supplier.themeColor && /^#[0-9A-F]{6}$/i.test(supplier.themeColor)) {
          const heroMedia = heroSection.querySelector('.hero-media');
          if (heroMedia) {
            heroMedia.style.setProperty('--supplier-theme', supplier.themeColor);
          }
        }
      }
    }

    // Prioritized hero badges — show max 3 high-value badges only
    const badgesContainer = document.getElementById('hero-badges');
    if (badgesContainer) {
      // Use verification-badges utility if available
      if (typeof renderVerificationBadges === 'function') {
        badgesContainer.innerHTML = renderVerificationBadges(supplier, {
          size: 'normal',
          maxBadges: 3,
        });
      } else {
        const heroBadges = _buildHeroBadges(supplier);
        badgesContainer.innerHTML = heroBadges.slice(0, 3).join('');
      }
    }

    // Title + tier icon
    const heroTitle = document.getElementById('hero-title');
    if (heroTitle) {
      heroTitle.removeAttribute('aria-busy');
      heroTitle.textContent = supplier.name;
      const tierIconEl = document.getElementById('hero-tier-icon');
      if (tierIconEl) {
        const iconFn =
          (typeof EFTierIcon !== 'undefined' && EFTierIcon.render) ||
          (typeof renderTierIcon === 'function' && renderTierIcon);
        if (iconFn) {
          tierIconEl.innerHTML = iconFn(supplier);
        }
      }
    }

    // Breadcrumb
    const breadcrumbName = document.getElementById('breadcrumb-supplier-name');
    if (breadcrumbName) {
      breadcrumbName.removeAttribute('aria-busy');
      breadcrumbName.textContent = supplier.name;
    }

    // Tagline
    const heroTagline = document.getElementById('hero-tagline');
    if (heroTagline) {
      const tagText = supplier.tagline || '';
      heroTagline.textContent = tagText;
      heroTagline.style.display = tagText ? 'block' : 'none';
    }

    // Meta strip
    const heroMeta = document.getElementById('hero-meta');
    if (heroMeta) {
      const items = [];

      if (supplier.category) {
        items.push(
          `<span class="meta-item meta-category"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>${escapeHtml(supplier.category)}</span>`
        );
      }

      if (supplier.rating && supplier.reviewCount) {
        const r = Number(supplier.rating).toFixed(1);
        const rc = Number(supplier.reviewCount);
        items.push(
          `<span class="meta-item meta-rating"><span class="star-icon" aria-hidden="true">★</span>${r} <span class="meta-rating-count">(${rc})</span></span>`
        );
      }

      if (supplier.location) {
        const loc = escapeHtml(supplier.location);
        const pc = supplier.postcode ? `, ${escapeHtml(supplier.postcode)}` : '';
        items.push(
          `<span class="meta-item"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${loc}${pc}</span>`
        );
      }

      if (supplier.priceRange) {
        items.push(
          `<span class="meta-item meta-price"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>${escapeHtml(supplier.priceRange)}</span>`
        );
      }

      if (items.length > 0) {
        heroMeta.innerHTML = items.join('');
        heroMeta.style.display = '';
      } else {
        heroMeta.style.display = 'none';
      }
    }

    // Wire up CTA buttons
    _wireHeroCTAs(supplier);
  }

  /**
   * Build prioritized hero badge list (high-value first, max 3 shown)
   */
  function _buildHeroBadges(supplier) {
    const badges = [];

    // Tier — highest priority
    const tier = supplier.subscription?.tier || (supplier.isPro ? 'pro' : 'free');
    if (tier === 'pro_plus') {
      badges.push('<span class="badge badge-pro-plus" aria-label="Pro Plus">Pro+</span>');
    } else if (tier === 'pro') {
      badges.push('<span class="badge badge-pro" aria-label="Pro supplier">Pro</span>');
    }

    // Founding
    if (supplier.isFoundingSupplier || supplier.isFounding || supplier.founding) {
      badges.push(
        '<span class="badge badge-founding" aria-label="Founding supplier">Founding</span>'
      );
    }

    // Featured
    if (supplier.featured || supplier.featuredSupplier) {
      badges.push(
        '<span class="badge badge-featured" aria-label="Featured supplier">Featured</span>'
      );
    }

    // Verified (only if no other badge used the slot)
    if (
      badges.length < 3 &&
      (supplier.emailVerified || supplier.verifications?.email?.verified || supplier.verified)
    ) {
      badges.push(
        '<span class="badge badge-email-verified" aria-label="Verified">✓ Verified</span>'
      );
    }

    return badges;
  }

  /**
   * Wire up hero CTA button click handlers
   */
  function _wireHeroCTAs(supplier) {
    // Enquiry
    const btnEnquiry = document.getElementById('btn-enquiry');
    if (btnEnquiry) {
      btnEnquiry.onclick = () => {
        if (!supplier.ownerUserId) {
          window.EventFlowNotifications?.info(
            'This supplier cannot receive messages at this time.'
          );
          return;
        }
        const safeName = (supplier.name || 'Supplier').replace(/[<>'"&]/g, '').trim() || 'Supplier';
        if (window.QuickComposeV4) {
          window.QuickComposeV4.open({
            recipientId: supplier.ownerUserId,
            contextType: 'supplier_profile',
            contextId: supplier.id,
            contextTitle: supplier.name,
            prefill: `Hi ${safeName}! I'd like to enquire about your services.`,
          });
        } else {
          const params = new URLSearchParams({
            new: 'true',
            recipientId: supplier.ownerUserId,
            contextType: 'supplier',
            contextId: supplier.id,
            contextTitle: supplier.name,
            prefill: `Hi ${safeName}! I'd like to enquire about your services.`,
          });
          window.location.href = `/messenger/?${params.toString()}`;
        }
      };
    }

    // Call
    const btnCall = document.getElementById('btn-call');
    if (btnCall && supplier.phone) {
      btnCall.href = `tel:${supplier.phone}`;
      btnCall.style.display = 'inline-flex';
    } else if (btnCall) {
      btnCall.style.display = 'none';
    }

    // Save
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
            window.EventFlowNotifications?.success('Saved to your shortlist!');
            btnSave.setAttribute('aria-pressed', 'true');
            btnSave.title = 'Saved to shortlist';
          } else if (response.status === 409) {
            window.EventFlowNotifications?.info('Already in your shortlist');
          } else if (response.status === 401 || response.status === 403) {
            window.EventFlowNotifications?.info('Please sign in to save suppliers');
          } else {
            window.EventFlowNotifications?.error('Could not save — please try again');
          }
        } catch (_) {
          window.EventFlowNotifications?.error('Could not save — please try again');
        }
      };
    }

    // Share
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
          } catch (e) {
            if (e.name !== 'AbortError') {
              console.error(e);
            }
          }
        } else {
          await navigator.clipboard.writeText(window.location.href);
          window.EventFlowNotifications?.success('Link copied to clipboard!');
        }
      };
    }
  }

  // ─── About Section ───────────────────────────────────────────────────────────

  function renderAboutSection(supplier) {
    const container = document.getElementById('sp-section-about');
    if (!container) {
      return;
    }

    // Remove loading skeleton
    container.innerHTML = '';

    const hasDescription = !!(
      supplier.description_long ||
      supplier.description_short ||
      supplier.description
    );
    const hasHighlights = Array.isArray(supplier.highlights) && supplier.highlights.length > 0;
    const hasFeaturedServices =
      Array.isArray(supplier.featuredServices) && supplier.featuredServices.length > 0;
    const hasSocialLinks =
      supplier.socialLinks &&
      Object.keys(supplier.socialLinks).filter(k => supplier.socialLinks[k]).length > 0;
    const hasTrust = _hasTrustItems(supplier);
    const hasStats = _hasStats(supplier);

    // If nothing meaningful to show, hide the section
    if (!hasDescription && !hasHighlights && !hasFeaturedServices) {
      container.style.display = 'none';
      return;
    }

    // Stats strip
    const statsHtml = hasStats ? _renderStatsStrip(supplier) : '';

    // Highlights
    const highlightsHtml = hasHighlights ? _renderHighlights(supplier.highlights) : '';

    // Description
    const descText =
      supplier.description_long || supplier.description_short || supplier.description || '';
    const descHtml = descText ? `<p class="sp-about__description">${escapeHtml(descText)}</p>` : '';

    // About meta (phone, website, etc.)
    const metaParts = [];
    if (supplier.website) {
      metaParts.push(
        `<a href="${escapeHtml(supplier.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(supplier.website)}</a>`
      );
    }
    if (supplier.phone) {
      metaParts.push(
        `<a href="tel:${escapeHtml(supplier.phone)}">${escapeHtml(supplier.phone)}</a>`
      );
    }
    if (supplier.maxGuests) {
      metaParts.push(`Max ${escapeHtml(String(supplier.maxGuests))} guests`);
    }
    const aboutMetaHtml =
      metaParts.length > 0 ? `<p class="sp-about__meta">${metaParts.join(' · ')}</p>` : '';

    // Amenities
    const amenitiesHtml =
      Array.isArray(supplier.amenities) && supplier.amenities.length > 0
        ? `<div class="sp-services sp-services--amenities"><div class="sp-services__list">${supplier.amenities.map(a => `<span class="sp-service-tag">${escapeHtml(a)}</span>`).join('')}</div></div>`
        : '';

    // Featured services
    const servicesHtml = hasFeaturedServices
      ? _renderFeaturedServices(supplier.featuredServices)
      : '';

    // Social links
    const socialHtml = hasSocialLinks ? _renderSocialLinks(supplier.socialLinks) : '';

    // Assemble
    const html = `
      ${statsHtml}
      ${highlightsHtml}
      <div class="sp-card sp-fade-in">
        <h2 class="sp-card-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>
          About
        </h2>
        ${descHtml}
        ${aboutMetaHtml}
        ${amenitiesHtml}
        ${servicesHtml}
        ${socialHtml}
      </div>
    `;

    container.innerHTML = html;
    container.style.display = '';
    container.removeAttribute('aria-hidden');
  }

  function _hasTrustItems(supplier) {
    return !!(
      supplier.verifications?.email ||
      supplier.verifications?.phone ||
      supplier.verifications?.business ||
      supplier.emailVerified ||
      supplier.phoneVerified ||
      supplier.businessVerified ||
      supplier.insurance ||
      supplier.license
    );
  }

  function _hasStats(supplier) {
    return !!(
      supplier.completedEvents ||
      supplier.createdAt ||
      supplier.avgResponseTime ||
      supplier.reviewCount
    );
  }

  function _renderStatsStrip(supplier) {
    const items = [];

    if (supplier.completedEvents) {
      items.push(
        `<div class="sp-stat"><div class="sp-stat__value">${escapeHtml(String(supplier.completedEvents))}</div><div class="sp-stat__label">Events</div></div>`
      );
    }

    const yrs = yearsActive(supplier.createdAt);
    if (yrs) {
      items.push(
        `<div class="sp-stat"><div class="sp-stat__value">${yrs}</div><div class="sp-stat__label">Years Active</div></div>`
      );
    }

    if (supplier.avgResponseTime) {
      items.push(
        `<div class="sp-stat"><div class="sp-stat__value">${Math.round(supplier.avgResponseTime)}h</div><div class="sp-stat__label">Response</div></div>`
      );
    }

    if (supplier.reviewCount) {
      items.push(
        `<div class="sp-stat"><div class="sp-stat__value">${escapeHtml(String(supplier.reviewCount))}</div><div class="sp-stat__label">Reviews</div></div>`
      );
    }

    if (items.length === 0) {
      return '';
    }
    return `<div class="sp-stats sp-fade-in">${items.join('')}</div>`;
  }

  function _renderHighlights(highlights) {
    const items = highlights
      .map(
        h =>
          `<div class="sp-highlight-item"><span class="sp-highlight-check" aria-hidden="true">✓</span><span>${escapeHtml(h)}</span></div>`
      )
      .join('');
    return `
      <div class="sp-highlights sp-fade-in">
        <div class="sp-highlights__title">Key Highlights</div>
        <div class="sp-highlights__grid">${items}</div>
      </div>
    `;
  }

  function _renderFeaturedServices(services) {
    const tags = services.map(s => `<span class="sp-service-tag">${escapeHtml(s)}</span>`).join('');
    return `
      <div class="sp-services">
        <div class="sp-services__title">Featured Services</div>
        <div class="sp-services__list">${tags}</div>
      </div>
    `;
  }

  function _renderSocialLinks(socialLinks) {
    const platforms = {
      facebook: { label: 'Facebook', icon: '📘', cls: 'facebook' },
      instagram: { label: 'Instagram', icon: '📷', cls: 'instagram' },
      twitter: { label: 'Twitter/X', icon: '𝕏', cls: 'twitter' },
      linkedin: { label: 'LinkedIn', icon: '💼', cls: 'linkedin' },
      youtube: { label: 'YouTube', icon: '▶', cls: 'youtube' },
      tiktok: { label: 'TikTok', icon: '🎵', cls: 'tiktok' },
    };

    const links = Object.entries(platforms)
      .filter(([key]) => socialLinks[key])
      .map(([key, p]) => {
        const href = escapeHtml(socialLinks[key]);
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="sp-social-link sp-social-link--${p.cls}" aria-label="${p.label}">${p.icon} ${p.label}</a>`;
      });

    if (links.length === 0) {
      return '';
    }
    return `<div class="sp-social-links">${links.join('')}</div>`;
  }

  // ─── Gallery Section ─────────────────────────────────────────────────────────

  function renderGallerySection(supplier) {
    const container = document.getElementById('sp-section-gallery');
    if (!container) {
      return;
    }

    const photos = Array.isArray(supplier.photosGallery)
      ? supplier.photosGallery.map(p => (typeof p === 'string' ? p : p.url)).filter(Boolean)
      : [];

    // Show polished empty state if no photos uploaded yet
    if (photos.length === 0) {
      container.innerHTML = `
        <div class="sp-card sp-card--gallery sp-fade-in">
          <h2 class="sp-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            Photo Gallery
          </h2>
          <div class="sp-gallery-empty">
            <svg class="sp-gallery-empty__icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <p class="sp-gallery-empty__title">No photos uploaded yet</p>
            <p class="sp-gallery-empty__text">This supplier hasn't added any gallery photos yet. Check back soon, or contact them directly for more examples of their work.</p>
          </div>
        </div>
      `;
      container.style.display = '';
      return;
    }

    let galleryHtml = '';

    if (photos.length >= 3) {
      // Featured layout: large left + 2-col right
      const extra = photos.length > 5 ? photos.length - 5 : 0;
      const visible = photos.slice(0, 5);

      const thumbs = visible
        .slice(1)
        .map((url, idx) => {
          const isLast = idx === 3 && extra > 0;
          return `
          <div class="sp-gallery__thumb" role="img" aria-label="Gallery photo ${idx + 2}" tabindex="0">
            <img loading="lazy" src="${escapeHtml(url)}" alt="${escapeHtml(supplier.name)} — photo ${idx + 2}">
            ${isLast ? `<div class="sp-gallery__more-overlay">+${extra} more</div>` : `<div class="sp-gallery__overlay" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>`}
          </div>`;
        })
        .join('');

      galleryHtml = `
        <div class="sp-gallery">
          <div class="sp-gallery__featured" role="img" aria-label="Main gallery photo" tabindex="0">
            <img src="${escapeHtml(visible[0])}" alt="${escapeHtml(supplier.name)} — main photo">
            <div class="sp-gallery__overlay" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
          </div>
          ${thumbs}
        </div>`;
    } else {
      // Simple compact grid for 1-2 photos
      const items = photos
        .map(
          (url, idx) => `
        <div class="sp-gallery__${idx === 0 ? 'featured' : 'thumb'}" role="img" aria-label="Gallery photo ${idx + 1}" tabindex="0">
          <img ${idx > 0 ? 'loading="lazy"' : ''} src="${escapeHtml(url)}" alt="${escapeHtml(supplier.name)} — photo ${idx + 1}">
          <div class="sp-gallery__overlay" aria-hidden="true">🔍</div>
        </div>`
        )
        .join('');

      galleryHtml = `<div class="sp-gallery--compact">${items}</div>`;
    }

    container.innerHTML = `
      <div class="sp-card sp-card--gallery sp-fade-in">
        <h2 class="sp-card-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          Photo Gallery
        </h2>
        ${galleryHtml}
      </div>
    `;

    container.style.display = '';

    // Wire up gallery lightbox if image-carousel.js is available
    _initGalleryLightbox(container, photos, supplier.name);
  }

  function _initGalleryLightbox(container, photos, supplierName) {
    const thumbEls = container.querySelectorAll('.sp-gallery__featured, .sp-gallery__thumb');
    thumbEls.forEach((el, idx) => {
      el.addEventListener('click', () => {
        if (window.EFImageCarousel?.open) {
          window.EFImageCarousel.open(photos, idx);
        } else if (window.initImageCarousel) {
          window.initImageCarousel(photos, idx, supplierName);
        }
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
        }
      });
    });
  }

  // ─── Packages Section ────────────────────────────────────────────────────────

  function renderPackagesSection(packages) {
    const container = document.getElementById('sp-section-packages');
    if (!container) {
      return;
    }

    if (!packages || packages.length === 0) {
      container.style.display = 'none';
      return;
    }

    const cards = packages.map(p => _renderPackageCard(p)).join('');

    container.innerHTML = `
      <div class="sp-card sp-fade-in">
        <h2 class="sp-card-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><polyline points="16 3 12 7 8 3"/></svg>
          Packages &amp; Services
        </h2>
        <div class="sp-packages-grid">${cards}</div>
      </div>
    `;

    container.style.display = '';

    // Wire up package card click handlers
    container.querySelectorAll('[data-package-id]').forEach(card => {
      const pkgId = card.getAttribute('data-package-id');
      const pkgSlug = card.getAttribute('data-package-slug');

      card.addEventListener('click', () => {
        const dest = pkgSlug
          ? `/package/${encodeURIComponent(pkgSlug)}`
          : `/package?id=${encodeURIComponent(pkgId)}`;
        window.location.href = dest;
      });

      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });
    });
  }

  function _renderPackageCard(p) {
    const title = escapeHtml(p.title || p.name || 'Package');
    const desc = escapeHtml((p.description || p.description_short || '').substring(0, 160));
    const price = escapeHtml(p.price_display || p.priceDisplay || '');
    const imageUrl = p.image || p.imageUrl || '';
    const pkgId = escapeHtml(p.id || '');
    const pkgSlug = escapeHtml(p.slug || '');

    const imageHtml = imageUrl
      ? `<img class="sp-pkg-card__image" src="${escapeHtml(imageUrl)}" alt="${title}" loading="lazy">`
      : `<div class="sp-pkg-card__image-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`;

    return `
      <div class="sp-pkg-card"
           role="button"
           tabindex="0"
           data-package-id="${pkgId}"
           ${pkgSlug ? `data-package-slug="${pkgSlug}"` : ''}
           aria-label="View ${title} package">
        ${imageHtml}
        <div class="sp-pkg-card__body">
          <h3 class="sp-pkg-card__title">${title}</h3>
          ${desc ? `<p class="sp-pkg-card__desc">${desc}</p>` : ''}
          <div class="sp-pkg-card__footer">
            <span class="sp-pkg-card__price">${price || 'Contact for price'}</span>
            <span class="sp-pkg-card__cta">
              View
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </span>
          </div>
        </div>
      </div>
    `;
  }

  // ─── Reviews Section ─────────────────────────────────────────────────────────

  function renderReviewsSection(suppId, supplier) {
    const container = document.getElementById('sp-section-reviews');
    if (!container) {
      return;
    }

    const supplierName = escapeHtml(supplier ? supplier.name : 'this supplier');

    // Render the reviews widget HTML scaffold (consumed by reviews.js ReviewsManager)
    container.innerHTML = `
      <div class="sp-card sp-fade-in">
        <div class="reviews-widget" id="reviews-widget" role="region" aria-label="Customer reviews and ratings">
          <section class="reviews-section">
            <div class="review-summary">
              <div class="review-summary-score">
                <div class="review-average-rating sp-reviews-average" aria-label="Average rating">New</div>
                <div class="review-stars-large sp-reviews-stars-lg" aria-hidden="true">☆☆☆☆☆</div>
                <div class="review-count sp-reviews-count">No reviews yet</div>
              </div>
              <div class="review-summary-details">
                <div class="sp-reviews-header-row">
                  <h2>Customer Reviews &amp; Ratings</h2>
                </div>
                <div class="rating-distribution" aria-label="Rating distribution"></div>
                <div class="review-trust-section">
                  <div class="review-badges" id="supplier-badges" aria-label="Supplier badges"></div>
                </div>
              </div>
            </div>

            <div class="reviews-header">
              <h3 class="reviews-title">All Reviews</h3>
              <div class="review-actions">
                <button id="btn-write-review" class="btn-write-review" aria-label="Write a review for ${supplierName}">✍️ Write a Review</button>
              </div>
            </div>

            <div class="review-controls" role="search" aria-label="Filter and sort reviews">
              <div class="review-filter-group">
                <label class="review-filter-label" for="filter-min-rating">Rating:</label>
                <select id="filter-min-rating" class="review-filter-select" aria-label="Filter by minimum rating">
                  <option value="">All Ratings</option>
                  <option value="5">5 Stars</option>
                  <option value="4">4+ Stars</option>
                  <option value="3">3+ Stars</option>
                </select>
              </div>
              <div class="review-filter-group">
                <label class="review-filter-label" for="filter-sort-by">Sort By:</label>
                <select id="filter-sort-by" class="review-filter-select" aria-label="Sort reviews">
                  <option value="date">Most Recent</option>
                  <option value="rating">Highest Rating</option>
                  <option value="helpful">Most Helpful</option>
                </select>
              </div>
              <label class="review-verified-filter">
                <input type="checkbox" id="filter-verified" aria-label="Show only verified customers">
                <span>✓ Verified Customers Only</span>
              </label>
            </div>

            <div id="reviews-list" class="reviews-list" role="list" aria-live="polite" aria-label="Customer reviews">
              <div class="reviews-loading">
                <div class="loading-spinner" role="status" aria-label="Loading reviews"></div>
                <p class="reviews-loading__text">Loading reviews…</p>
              </div>
            </div>
            <div id="review-pagination" class="review-pagination" style="display:none;" role="navigation" aria-label="Review pagination"></div>
          </section>
        </div>
      </div>
    `;

    container.style.display = '';

    // Wire write-review scroll
    const writeBtn = container.querySelector('#btn-write-review');
    if (writeBtn) {
      writeBtn.addEventListener('click', () => {
        const widget = document.getElementById('reviews-widget');
        if (widget) {
          widget.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }

    // Initialize ReviewsManager (with retry for deferred reviews.js)
    _initReviewsManager(suppId);
  }

  function _initReviewsManager(suppId) {
    const doInit = () => {
      try {
        window.reviewsManager.init(suppId, null);
      } catch (e) {
        console.error('ReviewsManager init error:', e);
      }
    };

    if (window.reviewsManager) {
      doInit();
      return;
    }

    // Retry until reviews.js loads (it's deferred)
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (window.reviewsManager) {
        clearInterval(interval);
        doInit();
      } else if (attempts >= 30) {
        clearInterval(interval);
        const reviewsList = document.getElementById('reviews-list');
        if (reviewsList) {
          reviewsList.innerHTML =
            '<p class="sp-reviews-unavailable">Reviews temporarily unavailable.</p>';
        }
      }
    }, 100);
  }

  // ─── Sidebar Section ─────────────────────────────────────────────────────────

  function renderSidebarSection(supplier) {
    _renderSidebarEnquiry(supplier);
    _renderSidebarTrust(supplier);
    _renderSidebarDetails(supplier);
  }

  function _renderSidebarEnquiry(supplier) {
    const container = document.getElementById('sp-sidebar-enquiry');
    if (!container) {
      return;
    }

    const supplierName = escapeHtml(supplier.name || 'this supplier');

    container.innerHTML = `
      <div class="sp-cta-card">
        <div class="sp-cta-card__name">Get in touch with</div>
        <div class="sp-cta-card__title">${supplierName}</div>
        <div class="sp-cta-card__actions">
          <button class="sp-cta-btn sp-cta-btn--primary" id="sidebar-btn-enquiry" aria-label="Message ${supplierName}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Message
          </button>
        </div>
        <p class="sp-cta-card__note">Usually responds within 24 hours</p>
      </div>
    `;

    // Wire sidebar CTA button
    const sidebarEnquiry = document.getElementById('sidebar-btn-enquiry');
    if (sidebarEnquiry) {
      sidebarEnquiry.addEventListener('click', () => {
        const heroEnquiry = document.getElementById('btn-enquiry');
        if (heroEnquiry) {
          heroEnquiry.click();
        }
      });
    }
  }

  function _renderSidebarTrust(supplier) {
    const container = document.getElementById('sp-sidebar-trust');
    if (!container) {
      return;
    }

    const items = [];

    if (supplier.emailVerified || supplier.verifications?.email?.verified || supplier.verified) {
      items.push(
        `<div class="sp-trust-item"><span class="sp-trust-icon" aria-hidden="true">✓</span><span>Email verified</span></div>`
      );
    }
    if (supplier.phoneVerified || supplier.verifications?.phone?.verified) {
      items.push(
        `<div class="sp-trust-item"><span class="sp-trust-icon" aria-hidden="true">✓</span><span>Phone verified</span></div>`
      );
    }
    if (supplier.businessVerified || supplier.verifications?.business?.verified) {
      items.push(
        `<div class="sp-trust-item"><span class="sp-trust-icon" aria-hidden="true">✓</span><span>Business verified</span></div>`
      );
    }
    if (supplier.insurance) {
      items.push(
        `<div class="sp-trust-item"><span class="sp-trust-icon" aria-hidden="true">✓</span><span>Insured</span></div>`
      );
    }
    if (supplier.license) {
      items.push(
        `<div class="sp-trust-item"><span class="sp-trust-icon" aria-hidden="true">✓</span><span>Licensed</span></div>`
      );
    }

    if (items.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.innerHTML = `
      <div class="sp-trust-card">
        <div class="sp-trust-card__title">Trust &amp; Safety</div>
        <div class="sp-trust-list">${items.join('')}</div>
      </div>
    `;
    container.style.display = '';
  }

  function _renderSidebarDetails(supplier) {
    const container = document.getElementById('sp-sidebar-details');
    if (!container) {
      return;
    }

    const rows = [];

    if (supplier.category) {
      rows.push({ icon: '🏷️', label: 'Category', value: escapeHtml(supplier.category) });
    }

    if (supplier.location) {
      const loc = supplier.postcode
        ? `${escapeHtml(supplier.location)}, ${escapeHtml(supplier.postcode)}`
        : escapeHtml(supplier.location);
      rows.push({ icon: '📍', label: 'Location', value: loc });
    }

    if (supplier.priceRange) {
      rows.push({ icon: '💰', label: 'Price Range', value: escapeHtml(supplier.priceRange) });
    }

    const yrs = yearsActive(supplier.createdAt);
    if (yrs) {
      rows.push({ icon: '📅', label: 'Since', value: `${yrs} year${yrs !== 1 ? 's' : ''} active` });
    }

    if (supplier.avgResponseTime) {
      rows.push({
        icon: '⚡',
        label: 'Response',
        value: `~${Math.round(supplier.avgResponseTime)}h`,
      });
    }

    if (rows.length === 0) {
      container.style.display = 'none';
      return;
    }

    const rowsHtml = rows
      .map(
        r => `
        <div class="sp-detail-row">
          <span class="sp-detail-row__icon" aria-hidden="true">${r.icon}</span>
          <span class="sp-detail-row__label">${r.label}</span>
          <span class="sp-detail-row__value">${r.value}</span>
        </div>`
      )
      .join('');

    container.innerHTML = `
      <div class="sp-details-card">
        <div class="sp-details-card__title">Key Details</div>
        <div class="sp-details-list">${rowsHtml}</div>
      </div>
    `;
    container.style.display = '';
  }

  // ─── Badges Section ──────────────────────────────────────────────────────────

  function renderBadgesSection(supplier) {
    const container = document.getElementById('sp-section-badges');
    if (!container || !supplier) {
      return;
    }

    const sections = [];

    // Subscription tier
    const tier =
      typeof EFTierIcon !== 'undefined'
        ? EFTierIcon.resolve(supplier)
        : supplier.subscription?.tier || (supplier.isPro ? 'pro' : 'free');

    const tierBadges = [];
    if (tier === 'pro_plus') {
      tierBadges.push('<span class="badge badge-pro-plus" aria-label="Pro Plus">Pro Plus</span>');
    } else if (tier === 'pro') {
      tierBadges.push('<span class="badge badge-pro" aria-label="Pro">Pro</span>');
    }
    if (tierBadges.length > 0) {
      sections.push(
        `<p class="sp-badges-group-label">Subscription</p><div class="sp-badges-row">${tierBadges.join('')}</div>`
      );
    }

    // Earned badges (from badgeDetails, excluding tier/verif/founder)
    const SKIP_TYPES = new Set(['pro', 'pro-plus', 'founder', 'verified', 'featured']);
    const earned = Array.isArray(supplier.badgeDetails)
      ? supplier.badgeDetails.filter(b => !SKIP_TYPES.has(b.type))
      : [];
    if (earned.length > 0) {
      const cards = earned
        .map(
          b => `
          <div class="sp-badge-card">
            <div class="sp-badge-card__icon" aria-hidden="true">${b.icon || '🏅'}</div>
            <div class="sp-badge-card__body">
              <div class="sp-badge-card__name">${escapeHtml(b.name)}</div>
              ${b.description ? `<div class="sp-badge-card__desc">${escapeHtml(b.description)}</div>` : ''}
            </div>
          </div>`
        )
        .join('');
      sections.push(
        `<p class="sp-badges-group-label">Earned Achievements</p><div class="sp-badge-cards-grid">${cards}</div>`
      );
    }

    // Recognition: founding + featured
    const honorBadges = [];
    if (supplier.isFoundingSupplier || supplier.isFounding || supplier.founding) {
      honorBadges.push(
        '<span class="badge badge-founding" aria-label="Founding supplier">Founding</span>'
      );
    }
    if (supplier.featured || supplier.featuredSupplier) {
      honorBadges.push(
        '<span class="badge badge-featured" aria-label="Featured supplier">Featured</span>'
      );
    }
    if (honorBadges.length > 0) {
      sections.push(
        `<p class="sp-badges-group-label">Recognition</p><div class="sp-badges-row">${honorBadges.join('')}</div>`
      );
    }

    // Verification
    const verifyBadges = [];
    if (supplier.emailVerified || supplier.verifications?.email?.verified || supplier.verified) {
      verifyBadges.push(
        '<span class="badge badge-email-verified" aria-label="Email verified">Email</span>'
      );
    }
    if (supplier.phoneVerified || supplier.verifications?.phone?.verified) {
      verifyBadges.push(
        '<span class="badge badge-phone-verified" aria-label="Phone verified">Phone</span>'
      );
    }
    if (supplier.businessVerified || supplier.verifications?.business?.verified) {
      verifyBadges.push(
        '<span class="badge badge-business-verified" aria-label="Business verified">Business</span>'
      );
    }
    if (verifyBadges.length > 0) {
      sections.push(
        `<p class="sp-badges-group-label">Verification</p><div class="sp-badges-row">${verifyBadges.join('')}</div>`
      );
    }

    if (sections.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.innerHTML = `
      <div class="sp-card sp-badges-section sp-fade-in">
        <h2 class="sp-card-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>
          Badges &amp; Recognition
        </h2>
        ${sections.join('')}
      </div>
    `;
    container.style.display = '';
  }

  // ─── Error state ─────────────────────────────────────────────────────────────

  function showPageError(errorMessage) {
    const heroTitle = document.getElementById('hero-title');
    if (heroTitle) {
      heroTitle.removeAttribute('aria-busy');
      heroTitle.textContent = 'Supplier Not Found';
    }

    const aboutSection = document.getElementById('sp-section-about');
    if (aboutSection) {
      aboutSection.innerHTML = `
        <div class="sp-error-state" role="status" aria-live="polite">
          <div class="sp-error-state__icon">⚠️</div>
          <div class="sp-error-state__title">Unable to load supplier</div>
          <div class="sp-error-state__desc">${escapeHtml(errorMessage || 'An unexpected error occurred.')}</div>
          <button class="error-state-action sp-error-state__btn" id="retry-supplier-btn">Try Again</button>
        </div>
      `;
      const retryBtn = aboutSection.querySelector('#retry-supplier-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', loadAllData);
      }
    }
  }

  // ─── Data loading ─────────────────────────────────────────────────────────────

  async function loadAllData() {
    if (!supplierId) {
      return;
    }

    try {
      // Fetch supplier data and packages in parallel
      const [supplierResp, packagesResp] = await Promise.allSettled([
        fetch(`/api/suppliers/${encodeURIComponent(supplierId)}`, { credentials: 'include' }),
        fetch(`/api/suppliers/${encodeURIComponent(supplierId)}/packages`, {
          credentials: 'include',
        }),
      ]);

      // Supplier data is required
      if (supplierResp.status === 'rejected' || !supplierResp.value.ok) {
        throw new Error('Failed to load supplier data');
      }

      supplierData = await supplierResp.value.json();
      let packages = [];
      if (packagesResp.status === 'fulfilled' && packagesResp.value.ok) {
        try {
          const pkgData = await packagesResp.value.json();
          packages = pkgData.items || pkgData.packages || [];
        } catch (_) {
          // packages endpoint returned non-JSON (e.g. HTML fallback); use empty list
        }
      }

      // Render all sections
      updateMetaTags(supplierData);
      renderHeroSection(supplierData);
      renderAboutSection(supplierData);
      renderGallerySection(supplierData);
      renderPackagesSection(packages);
      renderReviewsSection(supplierId, supplierData);
      renderSidebarSection(supplierData);
      renderBadgesSection(supplierData);
    } catch (error) {
      console.error('Error loading supplier profile:', error);
      showPageError('This supplier profile could not be loaded. Please try again.');
    }
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  function init() {
    const params = new URLSearchParams(window.location.search);
    supplierId = params.get('id');

    if (!supplierId) {
      console.warn('[supplier-profile] No supplier ID in URL');
      return;
    }

    // Validate format — allow any alphanumeric/dash/underscore ID up to 128 chars
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(supplierId)) {
      console.warn('[supplier-profile] Invalid supplier ID format:', supplierId);
      return;
    }

    // Preview mode banner
    if (params.get('preview') === 'true') {
      const banner = document.getElementById('preview-mode-banner');
      if (banner) {
        banner.style.display = 'flex';
        document.body.style.paddingTop = '42px';
      }
    }

    loadAllData();
  }

  // ─── Boot ────────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
