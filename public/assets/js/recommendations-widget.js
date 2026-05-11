/**
 * P3-15: Recommended Suppliers Widget
 * Display recommended suppliers based on user preferences
 */

(function () {
  'use strict';

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

  function recommendationAvatar(name, logoSrc) {
    const initial = escapeHtml(String(name || 'S').charAt(0).toUpperCase());
    const fallback = `<div class="recommendation-avatar recommendation-avatar--fallback" aria-hidden="true">${initial}</div>`;
    if (!logoSrc) {
      return fallback;
    }
    return `<span class="recommendation-avatar-wrap"><img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(name)}" class="recommendation-avatar" loading="lazy" onerror="this.closest('.recommendation-avatar-wrap').innerHTML='${fallback.replace(/'/g, '&apos;')}'"></span>`;
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
      <div class="recommendations-header">
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
            const supplierId =
              typeof supplier.id === 'string' || typeof supplier.id === 'number' ? supplier.id : '';
            const href = `/supplier?id=${encodeURIComponent(supplierId)}`;
            const ratingText = supplier.averageRating
              ? `⭐ ${Number(supplier.averageRating).toFixed(1)} (${supplier.reviewCount || 0} reviews)`
              : '';
            const rankingReason = supplier.rankingReason ? escapeHtml(supplier.rankingReason) : '';
            return `
          <a href="${href}" class="recommendation-card" aria-label="View ${name}" style="text-decoration:none;color:inherit;display:block;cursor:pointer;min-width:0;">
            <div class="recommendation-card__top">
              ${recommendationAvatar(rawName, logoSrc)}
              <div class="recommendation-card__identity">
                <h4>${name}</h4>
                <p>${category}</p>
              </div>
            </div>
            ${location ? `<p class="recommendation-card__meta">📍 ${location}</p>` : ''}
            ${ratingText ? `<p class="recommendation-card__meta">${ratingText}</p>` : ''}
            ${rankingReason ? `<p class="recommendation-card__reason">${rankingReason}</p>` : ''}
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
      console.log(`✓ Rendered ${Math.min(recommendations.length, RECOMMENDATION_LIMIT)} recommendations`);
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
