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
 *  - supplier-profile-packages-v2.js — premium package cards
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
      'https://event-flow.co.uk/assets/images/eventflow-og-image.png?v=3';
    // Reuse the page's own canonical URL (set server-side for the clean slug
    // route) rather than reconstructing a URL from an internal id — this
    // page is only ever reached through the canonical URL now that the
    // legacy query form 301-redirects before rendering.
    const canonicalLink = document.querySelector('link[rel="canonical"]');
    const url = (canonicalLink && canonicalLink.href) || window.location.href;

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

  // Map supplier categories to visual preset keys
  const CATEGORY_PRESETS = {
    wedding: 'wedding',
    weddings: 'wedding',
    'wedding planner': 'wedding',
    'event planner': 'wedding',
    planning: 'wedding',
    'wedding fayre': 'wedding',
    stationery: 'wedding',
    celebrant: 'wedding',
    photography: 'photography',
    photographer: 'photography',
    videography: 'photography',
    videographer: 'photography',
    catering: 'catering',
    caterer: 'catering',
    food: 'catering',
    cake: 'catering',
    music: 'music',
    'music/dj': 'music',
    dj: 'music',
    band: 'music',
    musicians: 'music',
    entertainment: 'entertainment',
    flowers: 'flowers',
    florist: 'flowers',
    floral: 'flowers',
    decor: 'flowers',
    venue: 'venue',
    venues: 'venue',
    transport: 'transport',
    cars: 'transport',
    chauffeur: 'transport',
    beauty: 'beauty',
    'hair & makeup': 'beauty',
    bridalwear: 'beauty',
    jewellery: 'beauty',
  };

  const PRESET_GRADIENTS_V2 = {
    'ef-teal': 'linear-gradient(135deg,#0B8073 0%,#13B6A2 100%)',
    midnight: 'linear-gradient(135deg,#1a1a2e 0%,#0f3460 100%)',
    'rose-gold': 'linear-gradient(135deg,#b76e79 0%,#f9c8c8 100%)',
    forest: 'linear-gradient(135deg,#1b4332 0%,#40916c 100%)',
    ocean: 'linear-gradient(135deg,#03045e 0%,#00b4d8 100%)',
    sunset: 'linear-gradient(135deg,#f77f00 0%,#d62828 100%)',
    purple: 'linear-gradient(135deg,#3d0066 0%,#a855f7 100%)',
    charcoal: 'linear-gradient(135deg,#1a1a1a 0%,#4a5568 100%)',
    blush: 'linear-gradient(135deg,#c2185b 0%,#ff80ab 100%)',
    champagne: 'linear-gradient(135deg,#9c7c38 0%,#e8d5a3 100%)',
  };

  const CATEGORY_ACCENT = {
    wedding: '#b76e79',
    photography: '#1a3a5c',
    catering: '#7f5539',
    music: '#6a0dad',
    entertainment: '#c2185b',
    flowers: '#386641',
    venue: '#4a5568',
    transport: '#1a6b8a',
    beauty: '#9d174d',
  };

  function _getInitials(name) {
    if (!name || typeof name !== 'string') {
      return '?';
    }
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return '?';
    }
    if (words.length === 1) {
      return words[0].charAt(0).toUpperCase();
    }
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
  }

  function _lightenHex(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, (num >> 16) + Math.round(2.55 * amount));
    const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(2.55 * amount));
    const b = Math.min(255, (num & 0xff) + Math.round(2.55 * amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  function renderHeroSection(supplier) {
    if (!supplier) {
      return;
    }

    // ── Avatar initials + optional profile photo ─────────────────────────────
    const avatarEl = document.getElementById('hero-avatar');
    const avatarInitialsEl = document.getElementById('hero-avatar-initials');
    const avatarImgEl = document.getElementById('hero-avatar-img');
    if (avatarEl && avatarInitialsEl) {
      avatarInitialsEl.textContent = _getInitials(supplier.name);
      // Accent colour: supplier theme → category → EF teal
      const catKey = (supplier.category || '').toLowerCase().trim();
      const catPreset = CATEGORY_PRESETS[catKey] || null;
      const accentColor =
        (supplier.themeColor && /^#[0-9A-F]{6}$/i.test(supplier.themeColor)
          ? supplier.themeColor
          : null) ||
        (catPreset ? CATEGORY_ACCENT[catPreset] : null) ||
        '#0B8073';
      // Always set gradient first — acts as loading placeholder and fallback
      avatarEl.style.background = `linear-gradient(135deg, ${accentColor} 0%, ${_lightenHex(accentColor, 30)} 100%)`;

      if (avatarImgEl && !avatarImgEl.src) {
        // The public profile hero avatar image is now owned exclusively by
        // public-supplier-avatar.js and its dedicated endpoint. This renderer
        // only maintains the placeholder/initials so the old general supplier
        // payload cannot overwrite or clear the canonical avatar pipeline.
        avatarImgEl.alt = '';
        avatarImgEl.hidden = true;
        avatarImgEl.style.display = '';
        avatarInitialsEl.style.display = '';
      }
    }

    // ── Hero banner / gradient ───────────────────────────────────────────────
    const heroBanner = document.getElementById('hero-banner');
    const bannerUrl = supplier.bannerUrl || supplier.coverImage || null;
    const heroSection = document.getElementById('supplier-hero');
    const heroMedia = heroSection ? heroSection.querySelector('.hero-media') : null;

    if (heroBanner) {
      const themeMode = ['automatic', 'preset', 'custom'].includes(supplier.themeMode)
        ? supplier.themeMode
        : null;
      const preset = supplier.heroPreset && PRESET_GRADIENTS_V2[supplier.heroPreset];
      const catKey = (supplier.category || '').toLowerCase().trim();
      const catPreset = CATEGORY_PRESETS[catKey];
      const validThemeColor =
        supplier.themeColor && /^#[0-9A-F]{6}$/i.test(supplier.themeColor)
          ? supplier.themeColor
          : null;

      heroSection?.removeAttribute('data-category-preset');
      heroMedia?.style.removeProperty('--supplier-theme');

      if (bannerUrl) {
        heroBanner.src = bannerUrl;
        heroBanner.alt = `${supplier.name} banner`;
        heroBanner.style.display = '';
        if (heroMedia) {
          heroMedia.style.backgroundImage = '';
        }
      } else {
        heroBanner.removeAttribute('src');
        heroBanner.style.display = 'none';
        if (heroMedia) {
          const usePreset = themeMode === 'preset' || (!themeMode && preset);
          const useCustom = themeMode === 'custom' || (!themeMode && !preset && validThemeColor);
          if (usePreset && preset) {
            heroMedia.style.backgroundImage = preset;
          } else if (useCustom && validThemeColor) {
            heroMedia.style.backgroundImage = '';
            heroMedia.style.setProperty('--supplier-theme', validThemeColor);
          } else if (catPreset && heroSection) {
            heroSection.setAttribute('data-category-preset', catPreset);
            heroMedia.style.backgroundImage = '';
          } else {
            heroMedia.style.backgroundImage = '';
          }
        }
      }
    }

    // ── Badges ───────────────────────────────────────────────────────────────
    const badgesContainer = document.getElementById('hero-badges');
    if (badgesContainer) {
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

    // ── Title + tier icon ────────────────────────────────────────────────────
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

    // ── Breadcrumb ───────────────────────────────────────────────────────────
    const breadcrumbName = document.getElementById('breadcrumb-supplier-name');
    if (breadcrumbName) {
      breadcrumbName.removeAttribute('aria-busy');
      breadcrumbName.textContent = supplier.name;
    }

    // ── Tagline ──────────────────────────────────────────────────────────────
    const heroTagline = document.getElementById('hero-tagline');
    if (heroTagline) {
      const tagText = supplier.tagline || '';
      heroTagline.textContent = tagText;
      heroTagline.style.display = tagText ? 'block' : 'none';
    }

    // ── Meta strip ───────────────────────────────────────────────────────────
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
          `<span class="meta-item meta-price"><svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="18" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="17" font-weight="700" fill="currentColor">£</text></svg>${escapeHtml(supplier.priceRange)}</span>`
        );
      }

      heroMeta.innerHTML = items.join('');
      heroMeta.style.display = items.length > 0 ? '' : 'none';
    }

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
      badges.push('<span class="badge badge-pro-plus" aria-label="Pro Plus">Pro Plus</span>');
    } else if (tier === 'pro') {
      badges.push('<span class="badge badge-pro" aria-label="Pro supplier">Pro</span>');
    } else {
      badges.push('<span class="badge badge-starter" aria-label="Starter plan">Starter</span>');
    }

    // Bot-sourced listings are published unclaimed until the real business
    // claims them (services/supplierBotClaim.service.js) -- surfacing that
    // here is the only signal on the hero that nobody has confirmed this
    // listing yet, so it outranks the honor badges below.
    if (badges.length < 3 && supplier.ownershipStatus === 'unclaimed') {
      badges.push(
        '<span class="badge badge-unclaimed" aria-label="Unclaimed listing">Unclaimed</span>'
      );
    }

    // Founding
    if (supplier.isFoundingSupplier || supplier.isFounding || supplier.founding) {
      badges.push(
        '<span class="badge badge-founding" aria-label="Founding supplier">Founding Supplier</span>'
      );
    }

    // Featured
    if (supplier.featured || supplier.featuredSupplier) {
      badges.push(
        '<span class="badge badge-featured" aria-label="Featured supplier">Featured</span>'
      );
    }

    // Email verified — an explicit, evidence-backed fact only. `supplier.verified`
    // historically means profile/business approval elsewhere in EventFlow and must
    // never be used as evidence the email address itself was verified.
    if (badges.length < 3 && (supplier.emailVerified || supplier.verifications?.email?.verified)) {
      badges.push(
        '<span class="badge badge-email-verified" aria-label="Email verified">Email verified</span>'
      );
    } else if (badges.length < 3 && (supplier.approved || supplier.profileApproved)) {
      // No real verification evidence — only fall back to the honest, conservative
      // "approved listing" claim (moderation/publication approval), never "Verified".
      badges.push(
        '<span class="badge badge-approved" aria-label="Approved listing">Approved listing</span>'
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
          window.NotificationDispatcher?.info(
            'This supplier cannot receive messages at this time.'
          );
          return;
        }

        // Gate behind auth — QuickComposeV4 checks internally but we also
        // guard here so logged-out users get the intent-aware redirect.
        const authState = window.EFAuth || window.__authState__;
        const isLoggedIn = authState
          ? authState.isAuthenticated || authState.loggedIn || authState.user
          : !!document.cookie.includes('ef_session');
        if (!isLoggedIn && !window.QuickComposeV4) {
          const returnTo = window.location.pathname + window.location.search;
          window.NotificationDispatcher?.info('Please log in to message this supplier');
          setTimeout(() => {
            window.location.href = `/auth?redirect=${encodeURIComponent(returnTo)}&intent=message`;
          }, 700);
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
            contextType: 'supplier_profile',
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
            window.NotificationDispatcher?.success('Saved to your shortlist!');
            btnSave.setAttribute('aria-pressed', 'true');
            btnSave.title = 'Saved to shortlist';
          } else if (response.status === 409) {
            window.NotificationDispatcher?.info('Already in your shortlist');
          } else if (response.status === 401 || response.status === 403) {
            // Not authenticated — redirect to auth with intent so user
            // is returned here after login
            window.NotificationDispatcher?.info('Please log in to save suppliers');
            const returnTo = window.location.pathname + window.location.search;
            setTimeout(() => {
              window.location.href = `/auth?redirect=${encodeURIComponent(returnTo)}&intent=save`;
            }, 700);
          } else {
            window.NotificationDispatcher?.error('Could not save — please try again');
          }
        } catch (_) {
          window.NotificationDispatcher?.error('Could not save — please try again');
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
          window.NotificationDispatcher?.success('Link copied to clipboard!');
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
    return !!(supplier.completedEvents || supplier.createdAt || supplier.avgResponseTime);
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
      ? supplier.photosGallery
          .filter(p => p && (typeof p === 'string' ? p : p.url))
          .map(p => {
            if (typeof p === 'string') {
              return { display: p, full: p };
            }
            // Use thumbnail for grid (fast load), full url for lightbox
            return {
              display: p.thumbnail || p.url || p.original || '',
              full: p.large || p.url || p.original || '',
            };
          })
          .filter(p => p.display)
      : [];

    // Show polished empty state if no photos uploaded yet
    // Per spec: only show gallery section when the supplier has photos.
    // For public viewers a "no photos yet" message adds no value and clutters sparse profiles.
    if (photos.length === 0) {
      container.style.display = 'none';
      return;
    }

    let galleryHtml = '';

    if (photos.length >= 3) {
      // Featured layout: large left + 2-col right
      const extra = photos.length > 5 ? photos.length - 5 : 0;
      const visible = photos.slice(0, 5);

      const thumbs = visible
        .slice(1)
        .map((photo, idx) => {
          const isLast = idx === 3 && extra > 0;
          return `
          <div class="sp-gallery__thumb" role="button" aria-label="Open gallery photo ${idx + 2}" tabindex="0" data-full-url="${escapeHtml(photo.full)}">
            <img loading="lazy" src="${escapeHtml(photo.display)}" alt="${escapeHtml(supplier.name)} — photo ${idx + 2}">
            ${isLast ? `<div class="sp-gallery__more-overlay">+${extra} more</div>` : `<div class="sp-gallery__overlay" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>`}
          </div>`;
        })
        .join('');

      galleryHtml = `
        <div class="sp-gallery">
          <div class="sp-gallery__featured" role="button" aria-label="Open main gallery photo" tabindex="0" data-full-url="${escapeHtml(visible[0].full)}">
            <img src="${escapeHtml(visible[0].display)}" alt="${escapeHtml(supplier.name)} — main photo">
            <div class="sp-gallery__overlay" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
          </div>
          ${thumbs}
        </div>`;
    } else {
      // Simple compact grid for 1-2 photos
      const items = photos
        .map(
          (photo, idx) => `
        <div class="sp-gallery__${idx === 0 ? 'featured' : 'thumb'}" role="button" aria-label="Open gallery photo ${idx + 1}" tabindex="0" data-full-url="${escapeHtml(photo.full)}">
          <img ${idx > 0 ? 'loading="lazy"' : ''} src="${escapeHtml(photo.display)}" alt="${escapeHtml(supplier.name)} — photo ${idx + 1}">
          <div class="sp-gallery__overlay" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
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
        if (window.ImageCarousel?.openWithImages) {
          // Pass full-size URLs to the carousel for best quality
          const fullUrls = photos.map(p => p.full || p.display);
          window.ImageCarousel.openWithImages(fullUrls, idx, supplierName);
        } else {
          // Graceful fallback: open the full-size image directly in a new tab
          const url =
            el.dataset.fullUrl || (el.querySelector('img') ? el.querySelector('img').src : '');
          if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
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
  // Package cards are intentionally rendered by supplier-profile-packages-v2.js.

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
                <button id="btn-write-review" class="ef-cta btn-write-review" aria-label="Write a review for ${supplierName}">✍️ Write a Review</button>
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

  async function _initReviewsManager(suppId) {
    // Fetch the current user so reviewsManager knows whether the visitor is signed in.
    // This prevents openReviewModal() from incorrectly redirecting logged-in users.
    let currentUser = null;
    try {
      const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        currentUser = (data && data.user) || null;
      }
    } catch (_) {
      // Network error — proceed with null (guest) user
    }

    const doInit = () => {
      try {
        window.reviewsManager.init(suppId, currentUser);
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
          <button class="ef-cta sp-cta-btn sp-cta-btn--primary" id="sidebar-btn-enquiry" aria-label="Message ${supplierName}">
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

    // Listing approval (moderation/publication) is a fact separate from any real
    // verification and must be labelled as such, never folded into "Verified".
    if (supplier.approved || supplier.profileApproved) {
      items.push(
        `<div class="sp-trust-item"><span class="sp-trust-icon" aria-hidden="true">✓</span><span>Listing approved</span></div>`
      );
    }
    if (supplier.emailVerified || supplier.verifications?.email?.verified) {
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
    // Deliberately does NOT promote supplier-entered `insurance` / `license` text
    // fields into an EventFlow trust claim — those are self-declared, never
    // confirmed by EventFlow. Only admin-confirmed `trustVerifications` (rendered
    // by supplier-profile-public-polish.js from the safe public API contract) may
    // claim insurance, DBS or licence facts.

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

    if (supplier.rating && supplier.reviewCount) {
      const ratingVal = Number(supplier.rating).toFixed(1);
      const reviewCount = Number(supplier.reviewCount);
      rows.push({
        icon: '⭐',
        label: 'Rating',
        value: `<span class="sp-detail-row__star">★</span> ${ratingVal} <span class="sp-detail-row__count">(${reviewCount} review${reviewCount !== 1 ? 's' : ''})</span>`,
      });
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
    } else {
      tierBadges.push('<span class="badge badge-starter" aria-label="Starter plan">Starter</span>');
    }
    if (tierBadges.length > 0) {
      sections.push(
        `<p class="sp-badges-group-label">Subscription</p><div class="sp-badges-row">${tierBadges.join('')}</div>`
      );
    }

    // Ownership — bot-sourced listings are published unclaimed until the real
    // business claims them (services/supplierBotClaim.service.js).
    if (supplier.ownershipStatus === 'unclaimed') {
      sections.push(
        `<p class="sp-badges-group-label">Ownership</p><div class="sp-badges-row"><span class="badge badge-unclaimed" aria-label="Unclaimed listing" title="This listing was added automatically and has not yet been claimed by the business.">Unclaimed</span></div>`
      );
    }

    // Earned badges (from badgeDetails, excluding tier/verif/founder)
    const SKIP_TYPES = new Set(['pro', 'pro-plus', 'founder', 'founding', 'verified', 'featured']);
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
        '<span class="badge badge-founding" aria-label="Founding supplier">Founding Supplier</span>'
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
    // Real, evidence-backed email verification only — `supplier.verified` is a
    // legacy alias for listing approval elsewhere and must not be read as proof
    // the email address was verified.
    if (supplier.emailVerified || supplier.verifications?.email?.verified) {
      verifyBadges.push(
        '<span class="badge badge-email-verified" aria-label="Email verified">Email</span>'
      );
    } else if (supplier.approved || supplier.profileApproved) {
      verifyBadges.push(
        '<span class="badge badge-approved" aria-label="Approved listing">Approved listing</span>'
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

    // The breadcrumb only clears its skeleton from renderHeroSection() on the
    // success path, so a failed load otherwise leaves its shimmer running
    // forever with no supplier name to fill it in.
    const breadcrumbName = document.getElementById('breadcrumb-supplier-name');
    if (breadcrumbName) {
      breadcrumbName.removeAttribute('aria-busy');
      breadcrumbName.textContent = 'Supplier not found';
    }

    const aboutSection = document.getElementById('sp-section-about');
    if (aboutSection) {
      aboutSection.innerHTML = `
        <div class="sp-error-state" role="status" aria-live="polite">
          <div class="sp-error-state__icon">⚠️</div>
          <div class="sp-error-state__title">Unable to load supplier</div>
          <div class="sp-error-state__desc">${escapeHtml(errorMessage || 'An unexpected error occurred.')}</div>
          <button class="ef-cta error-state-action sp-error-state__btn" id="retry-supplier-btn">Try Again</button>
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
      // Fetch supplier data only. Packages & Services are owned by
      // supplier-profile-packages-v2.js via /api/supplier-profile/:supplierId/package-cards.
      const supplierResp = await fetch(`/api/suppliers/${encodeURIComponent(supplierId)}`, {
        credentials: 'include',
      });

      // Supplier data is required
      if (!supplierResp.ok) {
        throw new Error('Failed to load supplier data');
      }

      supplierData = await supplierResp.json();

      // Expose to window so supplier-profile-owner-edit.js can read them
      window.__supplierData = supplierData;
      window.__supplierId = supplierId;

      // Render all sections
      updateMetaTags(supplierData);
      renderHeroSection(supplierData);
      renderAboutSection(supplierData);
      renderGallerySection(supplierData);
      // Do not render legacy package cards here; the V2 package-card module owns #supplier-package-cards-root.
      renderReviewsSection(supplierId, supplierData);
      renderSidebarSection(supplierData);
      renderBadgesSection(supplierData);
      // Expose rerender helpers so the owner-edit module can refresh
      // individual sections without a full page reload.
      window.__spRerender = {
        hero: () => renderHeroSection(supplierData),
        about: () => renderAboutSection(supplierData),
        gallery: () => renderGallerySection(supplierData),
        sidebar: () => renderSidebarSection(supplierData),
        badges: () => renderBadgesSection(supplierData),
        all: () => {
          renderHeroSection(supplierData);
          renderAboutSection(supplierData);
          renderGallerySection(supplierData);
          renderSidebarSection(supplierData);
          renderBadgesSection(supplierData);
          updateMetaTags(supplierData);
        },
      };

      // Signal to the edit overlay that data is ready
      window.dispatchEvent(new CustomEvent('sp:dataReady', { detail: { supplier: supplierData } }));
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
