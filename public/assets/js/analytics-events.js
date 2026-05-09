(function () {
  'use strict';

  function hasAnalyticsConsent() {
    if (!window.CookieConsent || typeof window.CookieConsent.getConsent !== 'function') {
      return false;
    }
    try {
      const consent = window.CookieConsent.getConsent();
      return !!(consent && consent.analytics);
    } catch (_) {
      return false;
    }
  }

  function normalizeParams(params) {
    const clean = {};
    Object.keys(params || {}).forEach(key => {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') {
        clean[key] = value;
      }
    });
    clean.page_path = clean.page_path || window.location.pathname;
    return clean;
  }

  function track(eventName, params) {
    if (!eventName || !hasAnalyticsConsent()) {
      return false;
    }

    const payload = normalizeParams(params);
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, payload);
    } else {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: eventName, ...payload });
    }
    return true;
  }

  function getGuideSlug() {
    return window.location.pathname.replace(/^\/articles\//, '').replace(/\.html$/, '');
  }

  async function copyShareUrl(button) {
    const url = button.dataset.shareUrl || window.location.href;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(url);
      }
      const feedbackWidget = button.closest('[data-guide-feedback]');
      const status = feedbackWidget && feedbackWidget.querySelector('[data-feedback-status]');
      if (status) {
        status.textContent = 'Link copied to your clipboard.';
      }
    } catch (_) {
      window.prompt('Copy this guide link:', url);
    }
  }

  function bindDelegatedEvents() {
    document.addEventListener('click', event => {
      const tocLink = event.target.closest('.article-toc a[href^="#"]');
      if (tocLink) {
        track('toc_click', {
          guide_slug: getGuideSlug(),
          toc_target: tocLink.getAttribute('href'),
          link_text: tocLink.textContent.trim(),
        });
      }

      const shareLink = event.target.closest('[data-share-channel]');
      if (shareLink) {
        if (shareLink.dataset.shareChannel === 'copy') {
          event.preventDefault();
          copyShareUrl(shareLink);
        }
        track('share_click', {
          guide_slug: getGuideSlug(),
          channel: shareLink.dataset.shareChannel,
        });
      }
    });
  }

  window.EFAnalytics = { track, hasAnalyticsConsent };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDelegatedEvents);
  } else {
    bindDelegatedEvents();
  }
})();
