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
   * Markup for a supplier's avatar: their logo when there is one, otherwise the initials badge.
   * Initials are shared with every other supplier avatar placeholder on the site — see
   * public/assets/js/utils/supplier-avatar.js.
   */
  function recommendationAvatar(supplierOrName, logoSrc) {
    const name =
      supplierOrName && typeof supplierOrName === 'object' ? supplierOrName.name : supplierOrName;
    const initial = escapeHtml(window.EFSupplierAvatar.getSupplierInitials(name));
    const fallback = `<span class="recommendation-avatar recommendation-avatar--fallback" aria-hidden="true">${initial}</span>`;

    if (!logoSrc) {
      return fallback;
    }

    // A logo that fails to load is swapped for the initials in renderRecommendations().
    return (
      `<span class="recommendation-avatar-wrap" data-rec-initial="${initial}">` +
      `<img src="${escapeHtml(logoSrc)}" alt="" class="recommendation-avatar" loading="lazy">` +
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
        <h2 class="recommendations-title">Suggested for you</h2>
        <a href="/suppliers" class="recommendations-view-all">See all</a>
      </div>
      <div class="recommendations-grid">
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
              ? `${Number(supplier.averageRating).toFixed(1)} rating (${supplier.reviewCount || 0} reviews)`
              : '';
            const rankingReason = supplier.rankingReason ? escapeHtml(supplier.rankingReason) : '';
            return `
          <a href="${href}" class="recommendation-card" aria-label="View ${name}">
            <div class="recommendation-card__top">
              ${recommendationAvatar(supplier, logoSrc)}
              <div class="recommendation-card__identity">
                <h3 class="recommendation-card__name">${name}</h3>
                ${category ? `<p class="recommendation-card__category">${category}</p>` : ''}
              </div>
            </div>
            ${location ? `<p class="recommendation-card__meta">${location}</p>` : ''}
            ${ratingText ? `<p class="recommendation-card__meta">${ratingText}</p>` : ''}
            ${rankingReason ? `<p class="recommendation-card__reason">${rankingReason}</p>` : ''}
          </a>
        `;
          })
          .join('')}
      </div>
    `;

    widget.querySelectorAll('.recommendation-avatar-wrap img').forEach(img => {
      img.addEventListener(
        'error',
        () => {
          const wrap = img.closest('.recommendation-avatar-wrap');
          if (wrap) {
            wrap.innerHTML = `<span class="recommendation-avatar recommendation-avatar--fallback" aria-hidden="true">${wrap.dataset.recInitial || '?'}</span>`;
          }
        },
        { once: true }
      );
    });

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

  // The widget does not start itself: the customer dashboard calls init() once it knows
  // which plan to tailor suggestions to, so it makes exactly one request.

  // Export for use in other scripts
  if (typeof window !== 'undefined') {
    window.RecommendationsWidget = {
      init: initRecommendations,
      create: createRecommendationsWidget,
      fetch: fetchRecommendations,
    };
  }
})();
