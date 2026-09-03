/**
 * P3-15: Recommended Suppliers Widget
 * Display recommended suppliers based on user preferences
 */

'use strict';
(function () {
  const RECOMMENDATION_LIMIT = 5;
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  /**
   * Escape HTML special characters to prevent XSS.
   * Supplier data (businessName, category, location) is user-controlled
   * and must be escaped before being inserted into innerHTML.
   */
  function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
      return '';
    }
    const div = document.createElement('div');
    div.textContent = unsafe;
    return div.innerHTML;
  }

  /**
   * Sanitize a URL to only allow http/https schemes (blocks javascript: URIs).
   */
  function safeSrc(url) {
    if (!url || typeof url !== 'string') {
      return '';
    }
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return url;
      }
    } catch (_) {
      // If URL is relative (no protocol), only allow if it doesn't start with a dangerous scheme
      const lower = url.toLowerCase().replace(/\s/g, '');
      if (
        !lower.startsWith('javascript:') &&
        !lower.startsWith('data:') &&
        !lower.startsWith('vbscript:')
      ) {
        return url;
      }
    }
    return '';
  }

  /**
   * Register a single global fallback handler so onerror attributes on
   * recommendation avatars don't need to embed raw HTML inline.
   *
   * Root cause of the broken-image bug:
   *   The previous implementation embedded the `fallback` div HTML directly
   *   inside onerror="...innerHTML='[fallback]'".  The fallback contains six
   *   double-quoted HTML attributes (class="..." style="...") which
   *   PREMATURELY CLOSED the outer onerror="..." attribute delimiter the moment
   *   the HTML parser hit the first " inside the fallback string.  This caused:
   *     - The onerror handler to be silently truncated (fallback never ran)
   *     - Orphaned attribute fragments rendered as visible text inside the card
   *     - A stray </div> from the malformed content closing the card's flex
   *       container, breaking the name + category layout below the image
   *
   *   Fix: store the initial letter in a data-rec-initial attribute; call a
   *   pre-registered global function from onerror so NO HTML is embedded inside
   *   any inline event handler.
   */
  function registerAvatarFallback() {
    if (window.__efRecAvatarFallback) {
      return;
    }
    window.__efRecAvatarFallback = function (img) {
      const wrap = img && img.closest && img.closest('.recommendation-avatar-wrap');
      if (!wrap) {
        return;
      }
      const initial = escapeHtml(wrap.dataset.recInitial || '?');
      const gradient = wrap.dataset.recGradient || 'linear-gradient(135deg,#13b6a2,#0b8073)';
      wrap.innerHTML =
        `<div class="recommendation-avatar recommendation-avatar--fallback"` +
        ` aria-hidden="true"` +
        ` style="width:48px;height:48px;border-radius:999px;` +
        `background:${gradient};` +
        `display:flex;align-items:center;justify-content:center;` +
        `color:white;font-weight:800;font-size: 1rem;` +
        `box-shadow:0 8px 18px rgba(19,182,162,.18);">${initial}</div>`;
    };
  }

  // Supplier avatar initials/color: shared with every other supplier avatar
  // placeholder on the site — see public/assets/js/utils/supplier-avatar.js.
  function recommendationAvatar(supplierOrName, logoSrc) {
    const name =
      supplierOrName && typeof supplierOrName === 'object' ? supplierOrName.name : supplierOrName;
    const initial = escapeHtml(window.EFSupplierAvatar.getSupplierInitials(name));
    const gradient = window.EFSupplierAvatar.getSupplierAvatarGradient(supplierOrName);
    const fallback =
      `<div class="recommendation-avatar recommendation-avatar--fallback"` +
      ` aria-hidden="true"` +
      ` style="width:48px;height:48px;border-radius:999px;` +
      `background:${gradient};` +
      `display:flex;align-items:center;justify-content:center;` +
      `color:white;font-weight:800;font-size: 1rem;` +
      `box-shadow:0 8px 18px rgba(19,182,162,.18);">${initial}</div>`;

    if (!logoSrc) {
      return fallback;
    }

    // Ensure the global handler is registered before the first img is rendered.
    registerAvatarFallback();

    // data-rec-initial/data-rec-gradient carry the fallback so the global
    // handler can build it without any HTML embedded in the onerror attribute.
    return (
      `<span class="recommendation-avatar-wrap"` +
      ` data-rec-initial="${initial}"` +
      ` data-rec-gradient="${escapeHtml(gradient)}"` +
      ` style="display:inline-flex;width:48px;height:48px;flex:0 0 48px;">` +
      `<img` +
      ` src="${escapeHtml(logoSrc)}"` +
      ` alt="${escapeHtml(name)}"` +
      ` class="recommendation-avatar"` +
      ` loading="lazy"` +
      ` style="width:48px;height:48px;border-radius:999px;object-fit:cover;` +
      `box-shadow:0 8px 18px rgba(15,23,42,.10);"` +
      ` onerror="window.__efRecAvatarFallback(this)"` +
      `>` +
      `</span>`
    );
  }

  /**
   * Initialize recommendations widget
   */
  async function initRecommendations() {
    const widget = document.getElementById('recommendations-widget');
    if (!widget) {
      return;
    }

    // Get user preferences from data attributes or localStorage
    const category = widget.dataset.category || localStorage.getItem('preferredCategory');
    const location = widget.dataset.location || localStorage.getItem('preferredLocation');
    const budget = widget.dataset.budget;
    const eventType = widget.dataset.eventType;

    try {
      const recommendations = await fetchRecommendations({
        category,
        location,
        budget,
        eventType,
      });

      renderRecommendations(widget, recommendations);
    } catch (error) {
      console.error('Error loading recommendations:', error);
      widget.style.display = 'none';
      widget.hidden = true;
    }
  }

  /**
   * Fetch recommendations from API
   */
  async function fetchRecommendations(params = {}) {
    const queryParams = new URLSearchParams();

    // The Phase 3 API accepts `eventType` (not `category`). Map the widget's
    // `category` data attribute to `eventType` since both carry event-type intent.
    if (params.category) {
      queryParams.append('eventType', params.category);
    }
    if (params.location) {
      queryParams.append('location', params.location);
    }
    if (params.budget) {
      queryParams.append('budget', params.budget);
    }
    if (params.eventType) {
      // eventType takes precedence over category when both are supplied
      queryParams.set('eventType', params.eventType);
    }
    queryParams.set('limit', String(RECOMMENDATION_LIMIT));

    // Use Phase 3 personalized discovery endpoint
    const response = await fetch(`/api/v2/search/personalized?${queryParams}`);

    if (!response.ok) {
      throw new Error('Failed to fetch recommendations');
    }

    const data = await response.json();
    // Phase 3 response shape: { success, data: { results, context } }
    return ((data.data && data.data.results) || []).slice(0, RECOMMENDATION_LIMIT);
  }

  /**
   * Render recommendations in widget
   */
  function renderRecommendations(widget, recommendations) {
    if (!recommendations || recommendations.length === 0) {
      widget.style.display = 'none';
      widget.hidden = true;
      return;
    }

    widget.innerHTML = `
      <div class="recommendations-header recommendations-widget__header">
        <h3 class="recommendations-title">Recommended for You</h3>
        <a href="/suppliers" class="recommendations-view-all">View All →</a>
      </div>
      <div class="recommendations-grid recommendations-grid--single-row" style="display:grid;grid-template-columns:repeat(${RECOMMENDATION_LIMIT},minmax(0,1fr));gap:1rem;align-items:stretch;overflow:hidden;">
        ${recommendations
          .slice(0, RECOMMENDATION_LIMIT)
          .map(supplier => {
            // Phase 3 API returns `name` (not `businessName`)
            const rawName = supplier.name || supplier.businessName || 'Supplier';
            const name = escapeHtml(rawName);
            const category = escapeHtml(supplier.category || '');
            const location = escapeHtml(
              typeof supplier.location === 'string' ? supplier.location : ''
            );
            const logoSrc = safeSrc(supplier.logo || '');
            const href = window.EventFlowSupplierLink
              ? window.EventFlowSupplierLink.supplierProfileHref(supplier)
              : supplier.publicProfilePath || '/suppliers';
            const ratingText = supplier.averageRating
              ? `⭐ ${Number(supplier.averageRating).toFixed(1)} (${supplier.reviewCount || 0} reviews)`
              : '';
            const rankingReason = supplier.rankingReason ? escapeHtml(supplier.rankingReason) : '';
            return `
          <a href="${href}" class="recommendation-card" aria-label="View ${name}" style="text-decoration:none;color:inherit;display:block;cursor:pointer;min-width:0;min-height:168px;border-radius:14px;padding:1rem;">
            <div class="recommendation-card__top" style="display:flex;align-items:center;gap:.78rem;margin-bottom:.82rem;min-width:0;">
              ${recommendationAvatar(supplier, logoSrc)}
              <div class="recommendation-card__identity" style="min-width:0;flex:1;">
                <h4 style="margin:0 0 .25rem;font-size: 1rem;font-weight:800;color:#1f2937;line-height:1.35;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${name}</h4>
                <p style="margin:0;font-size: 0.8125rem;color:#6b7280;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${category}</p>
              </div>
            </div>
            ${location ? `<p class="recommendation-card__meta" style="margin:0 0 .55rem;font-size: 0.8125rem;color:#667085;line-height:1.45;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">📍 ${location}</p>` : ''}
            ${ratingText ? `<p class="recommendation-card__meta" style="margin:0 0 .42rem;font-size: 0.8125rem;color:#667085;line-height:1.35;">${ratingText}</p>` : ''}
            ${rankingReason ? `<p class="recommendation-card__reason" style="margin:0;font-size: 0.75rem;color:#8a94a6;font-style:italic;line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${rankingReason}</p>` : ''}
          </a>
        `;
          })
          .join('')}
      </div>
    `;

    // Reveal the widget now that it has content
    widget.hidden = false;
    widget.style.display = '';

    if (isDevelopment) {
      console.log(
        `✓ Rendered ${Math.min(recommendations.length, RECOMMENDATION_LIMIT)} recommendations`
      );
    }
  }

  /**
   * Create and insert recommendations widget
   */
  function createRecommendationsWidget(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
      return;
    }

    const widget = document.createElement('div');
    widget.id = 'recommendations-widget';
    widget.className = 'recommendations-widget';

    if (options.category) {
      widget.dataset.category = options.category;
    }
    if (options.location) {
      widget.dataset.location = options.location;
    }
    if (options.budget) {
      widget.dataset.budget = options.budget;
    }
    if (options.eventType) {
      widget.dataset.eventType = options.eventType;
    }

    container.appendChild(widget);

    return initRecommendations();
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRecommendations);
  } else {
    initRecommendations();
  }

  // Export for use in other scripts
  if (typeof window !== 'undefined') {
    window.RecommendationsWidget = {
      init: initRecommendations,
      create: createRecommendationsWidget,
      fetch: fetchRecommendations,
    };
  }
})();
