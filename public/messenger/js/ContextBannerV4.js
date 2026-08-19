/**
 * ContextBannerV4 Component
 * Displays a gradient glass card banner showing conversation context
 * (package / supplier / marketplace) above the chat area.
 * BEM prefix: messenger-v4__
 */

'use strict';

class ContextBannerV4 {
  constructor(container) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this._currentContext = null;
    this.init();
  }

  init() {
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render() {
    this.container.innerHTML = `
      <div class="messenger-v4__context-banner" id="v4ContextBanner" role="complementary" aria-label="Conversation context" style="display:none">
        <div class="messenger-v4__context-banner-inner">
          <div class="messenger-v4__context-banner-left">
            <span class="messenger-v4__context-banner-icon" id="v4BannerIcon" aria-hidden="true"></span>
            <div class="messenger-v4__context-banner-text">
              <span class="messenger-v4__context-banner-title" id="v4BannerTitle"></span>
              <span class="messenger-v4__context-banner-subtitle" id="v4BannerSubtitle"></span>
            </div>
          </div>
          <div class="messenger-v4__context-banner-right">
            <img class="messenger-v4__context-banner-thumb" id="v4BannerThumb" alt="" style="display:none" />
            <a class="messenger-v4__context-banner-link" id="v4BannerLink" target="_blank" rel="noopener noreferrer" aria-label="View context">View →</a>
          </div>
        </div>
      </div>`;

    this.bannerEl = this.container.querySelector('#v4ContextBanner');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Show the context banner with the given context data.
   *
   * Accepts either the canonical conversation-context schema:
   *   { type, referenceId, referenceTitle, referenceImage }
   * or the legacy shape used by older call sites:
   *   { type, title, subtitle, url, imageUrl }
   *
   * Canonical types ("package", "supplier_profile", "marketplace_listing",
   * "find_a_supplier") are mapped to icons + human labels here so banners
   * render correctly regardless of entry point.
   */
  show(context) {
    if (!context) {
      return;
    }
    this._currentContext = context;

    // Accept both canonical and legacy aliases.
    const rawType = context.type || 'direct';
    const aliasMap = {
      supplier: 'supplier_profile',
      marketplace: 'marketplace_listing',
    };
    const canonicalType = aliasMap[rawType] || rawType;

    const iconMap = {
      package: '📦',
      supplier_profile: '🏢',
      marketplace_listing: '🛒',
      find_a_supplier: '🔎',
    };
    const subtitleMap = {
      package: 'Package enquiry',
      supplier_profile: 'Supplier profile',
      marketplace_listing: 'Marketplace listing',
      find_a_supplier: 'Find a supplier',
    };
    const icon = iconMap[canonicalType] || '💬';

    // Title: prefer canonical `referenceTitle`, fall back to legacy `title`.
    const isPresent = v => v !== null && v !== undefined && v !== '';
    const title = isPresent(context.referenceTitle) ? context.referenceTitle : context.title || '';
    const subtitle = isPresent(context.subtitle)
      ? context.subtitle
      : subtitleMap[canonicalType] || '';
    const imageUrl = isPresent(context.referenceImage)
      ? context.referenceImage
      : context.imageUrl || null;

    this.bannerEl.querySelector('#v4BannerIcon').textContent = icon;
    this.bannerEl.querySelector('#v4BannerTitle').textContent = title;
    this.bannerEl.querySelector('#v4BannerSubtitle').textContent = subtitle;

    // Update the "View" link.
    // Priority: (1) explicit context.url, (2) derived from referenceId + type,
    // (3) hidden.  The _safeUrl helper blocks javascript:/data:/vbscript: —
    // it must NOT HTML-encode the URL because the value is assigned to .href
    // (a DOM property), not interpolated into innerHTML.
    const link = this.bannerEl.querySelector('#v4BannerLink');
    const derivedUrl = this._deriveUrl(canonicalType, context);
    const rawUrl = context.url || derivedUrl || null;
    if (rawUrl) {
      const safeHref = this._safeUrl(rawUrl);
      if (safeHref !== '#') {
        link.href = safeHref;
        link.style.display = 'inline-flex';
      } else {
        link.style.display = 'none';
      }
    } else {
      link.style.display = 'none';
    }

    // Show thumbnail if provided — only allow relative paths (same-origin)
    const thumb = this.bannerEl.querySelector('#v4BannerThumb');
    if (imageUrl && /^\//.test(imageUrl)) {
      thumb.src = imageUrl;
      thumb.alt = this.escape(title || 'Context image');
      thumb.style.display = 'block';
    } else {
      thumb.style.display = 'none';
      thumb.src = '';
    }

    // Apply type modifier class for gradient theming
    this.bannerEl.className = `messenger-v4__context-banner messenger-v4__context-banner--${this.escape(canonicalType)}`;
    this.bannerEl.style.display = '';

    // Announce to screen readers
    this.bannerEl.setAttribute('aria-label', `${icon} ${title} conversation context`);
  }

  /** Hide the context banner. */
  hide() {
    this._currentContext = null;
    if (this.bannerEl) {
      this.bannerEl.style.display = 'none';
    }
  }

  /** Returns the currently displayed context, or null. */
  getContext() {
    return this._currentContext;
  }

  escape(str) {
    if (str === null || str === undefined) {
      return '';
    }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Block javascript: / data: / vbscript: href values. Returns '#' for unsafe URLs.
   *  The returned value is safe to assign to element.href — it is NOT HTML-encoded
   *  because .href is a DOM property assignment, not an innerHTML insertion.
   */
  _safeUrl(url) {
    if (!url || typeof url !== 'string') {
      return '#';
    }
    const trimmed = url.trim();
    if (/^(javascript|data|vbscript):/i.test(trimmed)) {
      return '#';
    }
    return trimmed;
  }

  /**
   * Derive a relative "View" URL from the canonical context type + referenceId.
   * Returns null when no useful path can be inferred.
   * @param {string} canonicalType
   * @param {Object} context
   * @returns {string|null}
   */
  _deriveUrl(canonicalType, context) {
    const refId = context.referenceId || context.id || null;
    if (!refId) {
      return null;
    }
    const id = encodeURIComponent(String(refId));
    // These URLs must match the live server routes. See server.js:
    // Supplier profiles require an API-provided canonical path and are not
    // derived from an internal reference id here.
    //   • /package?id=<id>     (app.get('/package', …))
    //   • /marketplace?listing=<id>  (public/assets/js/marketplace.js openListingFromQuery)
    //   • /find-a-supplier?id=<id>
    // Using path segments (e.g. /marketplace/<id>) 404s.
    const urlMap = {
      package: `/package?id=${id}`,
      marketplace_listing: `/marketplace?listing=${id}`,
      find_a_supplier: `/find-a-supplier?id=${id}`,
    };
    return urlMap[canonicalType] || null;
  }
}

if (typeof window !== 'undefined') {
  window.ContextBannerV4 = ContextBannerV4;
}
