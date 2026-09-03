'use strict';
(function () {
  const knownImageReplacements = [
    {
      brokenFragment: '/photos/1580913/pexels-photo-1580913.jpeg',
      replacement:
        'https://images.pexels.com/photos/1046744/pexels-photo-1046744.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
    },
  ];

  function findReplacementImage(src) {
    if (!src) {
      return '';
    }
    const match = knownImageReplacements.find(item => src.includes(item.brokenFragment));
    return match ? match.replacement : '';
  }

  function replaceKnownBrokenImage(img) {
    if (!img || img.tagName !== 'IMG' || img.dataset.efKnownImageReplacementApplied === 'true') {
      return;
    }

    const replacement = findReplacementImage(img.currentSrc || img.src || img.getAttribute('src'));
    if (!replacement) {
      return;
    }

    img.dataset.efKnownImageReplacementApplied = 'true';
    img.removeAttribute('srcset');
    img.src = replacement;
  }

  function scanKnownBrokenImages(root) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return;
    }
    root.querySelectorAll('img').forEach(replaceKnownBrokenImage);
  }

  function bindKnownImageReplacements() {
    scanKnownBrokenImages(document);

    document.addEventListener(
      'error',
      event => {
        replaceKnownBrokenImage(event.target);
      },
      true
    );

    if (typeof MutationObserver !== 'function' || !document.body) {
      return;
    }

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node && node.tagName === 'IMG') {
            replaceKnownBrokenImage(node);
          } else {
            scanKnownBrokenImages(node);
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
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
    bindKnownImageReplacements();
    bindDelegatedEvents();
  }

  window.EFAnalytics = { track, hasAnalyticsConsent };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
