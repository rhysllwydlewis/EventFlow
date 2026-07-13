(function () {
  'use strict';

  const COOKIE_NAME = 'eventflow_cookie_consent';
  const EXPIRY_DAYS = 365;
  const FETCH_WRAPPED_FLAG = '__efAnalyticsSuccessObserver';
  const POSTHOG_PAGEVIEW_POLL_MS = 200;
  const POSTHOG_PAGEVIEW_TIMEOUT_MS = 15 * 1000;
  const POSTHOG_EXCLUDED_PAGE_PREFIXES = [
    '/admin',
    '/auth',
    '/reset-password',
    '/checkout',
    '/payment',
    '/messages',
    '/messenger',
    '/chat',
    '/dashboard',
    '/settings',
    '/plan',
    '/guests',
    '/supplier/profile-customization',
    '/supplier/subscription',
    '/supplier/marketplace-new-listing',
  ];

  let capturedPostHogPage = '';
  let posthogPageviewStartedAt = 0;
  let posthogPageviewTimer = null;

  function writeFullConsent() {
    const value = encodeURIComponent(
      JSON.stringify({
        v: 1,
        essential: true,
        functional: true,
        analytics: true,
      })
    );
    const expires = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toUTCString();
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE_NAME}=${value}; expires=${expires}; path=/; SameSite=Lax${secure}`;
    window.dispatchEvent(
      new CustomEvent('cookieConsentChanged', {
        detail: {
          accepted: true,
          essential: true,
          functional: true,
          analytics: true,
        },
      })
    );
  }

  function hasAnalyticsConsent() {
    if (!window.CookieConsent || typeof window.CookieConsent.getConsent !== 'function') {
      return false;
    }
    try {
      const consent = window.CookieConsent.getConsent();
      return Boolean(consent && consent.analytics === true);
    } catch (_error) {
      return false;
    }
  }

  function isPostHogPageviewExcluded() {
    const pagePath = window.location.pathname || '/';
    return POSTHOG_EXCLUDED_PAGE_PREFIXES.some(
      prefix =>
        pagePath === prefix ||
        pagePath.startsWith(`${prefix}/`) ||
        pagePath.startsWith(`${prefix}-`) ||
        pagePath.startsWith(`${prefix}.`)
    );
  }

  function queryFreePageUrl() {
    return `${window.location.origin}${window.location.pathname || '/'}`;
  }

  function clearPostHogPageviewTimer() {
    if (posthogPageviewTimer) {
      window.clearTimeout(posthogPageviewTimer);
      posthogPageviewTimer = null;
    }
  }

  function tryCapturePostHogPageview() {
    if (!hasAnalyticsConsent() || isPostHogPageviewExcluded()) {
      clearPostHogPageviewTimer();
      return;
    }

    const currentUrl = queryFreePageUrl();
    if (capturedPostHogPage === currentUrl) {
      clearPostHogPageviewTimer();
      return;
    }

    if (window.posthog && typeof window.posthog.capture === 'function') {
      window.posthog.capture('$pageview', {
        $current_url: currentUrl,
        $pathname: window.location.pathname || '/',
      });
      capturedPostHogPage = currentUrl;
      clearPostHogPageviewTimer();
      return;
    }

    if (Date.now() - posthogPageviewStartedAt >= POSTHOG_PAGEVIEW_TIMEOUT_MS) {
      clearPostHogPageviewTimer();
      return;
    }

    posthogPageviewTimer = window.setTimeout(
      tryCapturePostHogPageview,
      POSTHOG_PAGEVIEW_POLL_MS
    );
  }

  function queuePostHogPageview() {
    clearPostHogPageviewTimer();
    if (!hasAnalyticsConsent() || isPostHogPageviewExcluded()) {
      return;
    }
    posthogPageviewStartedAt = Date.now();
    tryCapturePostHogPageview();
  }

  function handleAnalyticsConsentChange(event) {
    if (event && event.detail && event.detail.analytics === true) {
      queuePostHogPageview();
      return;
    }
    capturedPostHogPage = '';
    clearPostHogPageviewTimer();
  }

  function upgradeConsentCopy(root) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    scope.querySelectorAll('.cookie-consent-message p').forEach(paragraph => {
      if (paragraph.textContent && paragraph.textContent.includes('functional cookies')) {
        paragraph.textContent =
          'We use essential cookies to make our site work. With your consent, we also use functional cookies to remember preferences and analytics cookies to understand page engagement and improve EventFlow. You can change these choices at any time.';
      }
    });
    scope.querySelectorAll('.cookie-prefs-category-desc').forEach(description => {
      if (description.textContent && description.textContent.includes('Currently unused')) {
        description.textContent =
          'Help us understand page engagement, journeys and website performance. Analytics only runs after you consent.';
      }
    });
  }

  function normalizedRequest(input, options) {
    let url = '';
    let method = 'GET';
    try {
      if (typeof input === 'string' || input instanceof URL) {
        url = new URL(input, window.location.href).pathname;
      } else if (input && input.url) {
        url = new URL(input.url, window.location.href).pathname;
        method = input.method || method;
      }
    } catch (_error) {
      url = '';
    }
    if (options && options.method) {
      method = options.method;
    }
    return { url, method: String(method || 'GET').toUpperCase() };
  }

  function successfulEventFor(request) {
    if (request.method === 'POST' && /^\/api\/(?:v1\/)?auth\/register\/?$/.test(request.url)) {
      return {
        event: 'registration_completed',
        properties: {
          conversionType: 'registration',
          source: 'server_response',
        },
      };
    }
    if (request.method === 'POST' && /^\/api\/(?:v1\/)?quote-requests\/?$/.test(request.url)) {
      return {
        event: 'quote_request_submitted',
        properties: {
          conversionType: 'quote_request',
          source: 'server_response',
        },
      };
    }
    if (request.method === 'POST' && /^\/api\/(?:v1\/)?me\/packages\/?$/.test(request.url)) {
      return {
        event: 'package_created',
        properties: {
          conversionType: 'package_created',
          source: 'server_response',
        },
      };
    }
    return null;
  }

  function installSuccessfulConversionObserver() {
    if (typeof window.fetch !== 'function' || window.fetch[FETCH_WRAPPED_FLAG]) {
      return;
    }

    const originalFetch = window.fetch.bind(window);
    const wrappedFetch = function (input, options) {
      const request = normalizedRequest(input, options);
      return originalFetch(input, options).then(response => {
        const conversion = response.ok ? successfulEventFor(request) : null;
        if (conversion && window.EFAnalytics && typeof window.EFAnalytics.track === 'function') {
          window.EFAnalytics.track(conversion.event, conversion.properties);
        }
        return response;
      });
    };
    wrappedFetch[FETCH_WRAPPED_FLAG] = true;
    window.fetch = wrappedFetch;
  }

  document.addEventListener(
    'click',
    event => {
      const target =
        event.target && event.target.closest
          ? event.target.closest('#cookie-consent-accept, #cookie-prefs-accept-all')
          : null;
      if (!target) {
        return;
      }
      // The legacy handler runs during the same click and writes analytics:false.
      // Apply the corrected full-consent value immediately afterwards.
      window.setTimeout(writeFullConsent, 0);
    },
    true
  );

  window.addEventListener('cookieConsentChanged', handleAnalyticsConsentChange);

  function init() {
    upgradeConsentCopy(document);
    installSuccessfulConversionObserver();
    queuePostHogPageview();
    if (typeof MutationObserver !== 'function' || !document.body) {
      return;
    }
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node && node.nodeType === 1) {
            upgradeConsentCopy(node);
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
