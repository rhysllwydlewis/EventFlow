(function () {
  'use strict';

  const OUTDOOR_EVENTS_BROKEN_IMAGE_FRAGMENT = '/photos/1580913/pexels-photo-1580913.jpeg';
  const OUTDOOR_EVENTS_FALLBACK_IMAGE =
    'https://images.pexels.com/photos/1616113/pexels-photo-1616113.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1';

  function isOutdoorEventsBrokenImage(src) {
    return typeof src === 'string' && src.includes(OUTDOOR_EVENTS_BROKEN_IMAGE_FRAGMENT);
  }

  function applyOutdoorEventsImageFallback(img) {
    if (!img || img.dataset.outdoorEventsFallbackApplied === 'true') {
      return;
    }
    if (!isOutdoorEventsBrokenImage(img.currentSrc || img.src || img.getAttribute('src'))) {
      return;
    }
    img.dataset.outdoorEventsFallbackApplied = 'true';
    img.src = OUTDOOR_EVENTS_FALLBACK_IMAGE;
  }

  function bindOutdoorEventsImageFallback() {
    document
      .querySelectorAll(`img[src*="${OUTDOOR_EVENTS_BROKEN_IMAGE_FRAGMENT}"]`)
      .forEach(applyOutdoorEventsImageFallback);

    document.addEventListener(
      'error',
      event => {
        const target = event.target;
        if (target && target.tagName === 'IMG') {
          applyOutdoorEventsImageFallback(target);
        }
      },
      true
    );
  }

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
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(url);
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

  function init() {
    bindDelegatedEvents();
    bindOutdoorEventsImageFallback();
  }

  window.EFAnalytics = { track, hasAnalyticsConsent };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
