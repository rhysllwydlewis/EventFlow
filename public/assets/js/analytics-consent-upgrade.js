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
    '/verify',
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
  const POSTHOG_URL_PROPERTY_KEYS = new Set([
    '$current_url',
    '$referrer',
    '$initial_current_url',
    '$initial_referrer',
    '$session_entry_url',
    '$session_entry_current_url',
    '$session_entry_referrer',
  ]);

  let capturedPostHogPage = '';
  let capturedPostHogPageleave = false;
  let posthogPageviewStartedAt = 0;
  let posthogPageviewTimer = null;

  function currentPath() {
    return window.location.pathname || '/';
  }

  function pathMatches(prefixes) {
    const pagePath = currentPath();
    return prefixes.some(
      prefix =>
        pagePath === prefix ||
        pagePath.startsWith(`${prefix}/`) ||
        pagePath.startsWith(`${prefix}-`) ||
        pagePath.startsWith(`${prefix}.`)
    );
  }

  function isSensitiveAnalyticsPage() {
    return pathMatches(POSTHOG_EXCLUDED_PAGE_PREFIXES);
  }

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

  function closeConsentUi(target) {
    const banner = target && target.closest ? target.closest('#cookie-consent-banner') : null;
    if (banner && banner.parentNode) {
      banner.parentNode.removeChild(banner);
    }

    const dialog = target && target.closest ? target.closest('#cookie-prefs-dialog') : null;
    if (dialog && dialog.parentNode) {
      dialog.parentNode.removeChild(dialog);
    }
    if (dialog && document.body) {
      document.body.classList.remove('cookie-prefs-open');
    }
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

  function queryFreePageUrl() {
    return `${window.location.origin}${currentPath()}`;
  }

  function stripQueryAndHash(value) {
    if (typeof value !== 'string') {
      return value;
    }
    return value.split(/[?#]/, 1)[0];
  }

  function sanitizeUrlProperties(properties) {
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      return properties;
    }

    Object.keys(properties).forEach(key => {
      if (POSTHOG_URL_PROPERTY_KEYS.has(key)) {
        properties[key] = stripQueryAndHash(properties[key]);
      }
    });
    return properties;
  }

  function sanitizePostHogEvent(event) {
    if (!event || typeof event !== 'object') {
      return event;
    }
    sanitizeUrlProperties(event.properties);
    sanitizeUrlProperties(event.$set);
    sanitizeUrlProperties(event.$set_once);
    return event;
  }

  function runBeforeSendHooks(hooks, event) {
    const handlers = Array.isArray(hooks) ? hooks : typeof hooks === 'function' ? [hooks] : [];
    let result = event;
    handlers.forEach(handler => {
      if (result) {
        result = handler(result);
      }
    });
    return result;
  }

  function withPostHogPrivacy(config) {
    const source = config && typeof config === 'object' ? config : {};
    const existingBeforeSend = source.before_send;
    return {
      ...source,
      mask_personal_data_properties: true,
      disable_capture_url_hashes: true,
      before_send: function (event) {
        let result = event;
        try {
          result = runBeforeSendHooks(existingBeforeSend, result);
        } catch (_error) {
          // A third-party hook must not bypass EventFlow's final privacy sanitiser.
        }
        return result ? sanitizePostHogEvent(result) : result;
      },
    };
  }

  function installSensitivePageConsentGuard() {
    if (
      !isSensitiveAnalyticsPage() ||
      !window.CookieConsent ||
      typeof window.CookieConsent.getConsent !== 'function' ||
      window.CookieConsent.getConsent.__efSensitiveGuard
    ) {
      return;
    }

    const originalGetConsent = window.CookieConsent.getConsent.bind(window.CookieConsent);
    const guardedGetConsent = function () {
      const consent = originalGetConsent() || {};
      return { ...consent, essential: true, analytics: false };
    };
    guardedGetConsent.__efSensitiveGuard = true;
    window.CookieConsent.getConsent = guardedGetConsent;
  }

  function installPrivacyAwarePostHogStub() {
    if (window.posthog && window.posthog.__SV) {
      return;
    }

    (function (documentObject, posthog) {
      if (posthog.__SV) return;
      window.posthog = posthog;
      posthog._i = [];
      posthog.init = function (token, config, name) {
        if (isSensitiveAnalyticsPage()) {
          return;
        }

        function addMethod(target, method) {
          const parts = method.split('.');
          if (parts.length === 2) {
            target = target[parts[0]];
            method = parts[1];
          }
          target[method] = function () {
            target.push([method].concat(Array.prototype.slice.call(arguments, 0)));
          };
        }

        const privacyConfig = withPostHogPrivacy(config);
        const script = documentObject.createElement('script');
        script.type = 'text/javascript';
        script.crossOrigin = 'anonymous';
        script.async = true;
        script.src = `${privacyConfig.api_host.replace(
          '.i.posthog.com',
          '-assets.i.posthog.com'
        )}/static/array.js`;
        const firstScript = documentObject.getElementsByTagName('script')[0];
        firstScript.parentNode.insertBefore(script, firstScript);

        let instance = posthog;
        let instanceName = name;
        if (instanceName !== undefined) {
          instance = posthog[instanceName] = [];
        } else {
          instanceName = 'posthog';
        }
        instance.people = instance.people || [];
        const methods =
          'init capture reset opt_in_capturing opt_out_capturing stopSessionRecording'.split(' ');
        methods.forEach(function (method) {
          addMethod(instance, method);
        });
        posthog._i.push([token, privacyConfig, instanceName]);
      };
      posthog.__SV = 1;
    })(document, window.posthog || []);
  }

  function clearPostHogPageviewTimer() {
    if (posthogPageviewTimer) {
      window.clearTimeout(posthogPageviewTimer);
      posthogPageviewTimer = null;
    }
  }

  function postHogIsInitialised() {
    if (!window.posthog || typeof window.posthog.capture !== 'function') {
      return false;
    }
    if (window.posthog.__loaded) {
      return true;
    }
    return Array.isArray(window.posthog._i) && window.posthog._i.length > 0;
  }

  function capturePostHogPageleave() {
    if (
      capturedPostHogPageleave ||
      !capturedPostHogPage ||
      !hasAnalyticsConsent() ||
      isSensitiveAnalyticsPage() ||
      !postHogIsInitialised()
    ) {
      return;
    }

    const currentUrl = queryFreePageUrl();
    if (capturedPostHogPage !== currentUrl) {
      return;
    }

    try {
      window.posthog.capture(
        '$pageleave',
        {
          $current_url: currentUrl,
          $pathname: currentPath(),
        },
        { transport: 'sendBeacon' }
      );
      capturedPostHogPageleave = true;
    } catch (_error) {
      // Analytics delivery must never interfere with navigation or page shutdown.
    }
  }

  function tryCapturePostHogPageview() {
    if (!hasAnalyticsConsent() || isSensitiveAnalyticsPage()) {
      clearPostHogPageviewTimer();
      return;
    }

    const currentUrl = queryFreePageUrl();
    if (capturedPostHogPage === currentUrl) {
      clearPostHogPageviewTimer();
      return;
    }

    if (postHogIsInitialised()) {
      try {
        window.posthog.capture('$pageview', {
          $current_url: currentUrl,
          $pathname: currentPath(),
        });
        capturedPostHogPage = currentUrl;
        capturedPostHogPageleave = false;
      } catch (_error) {
        // The polling timeout below permits a later retry.
      }
      clearPostHogPageviewTimer();
      return;
    }

    if (Date.now() - posthogPageviewStartedAt >= POSTHOG_PAGEVIEW_TIMEOUT_MS) {
      clearPostHogPageviewTimer();
      return;
    }

    posthogPageviewTimer = window.setTimeout(tryCapturePostHogPageview, POSTHOG_PAGEVIEW_POLL_MS);
  }

  function queuePostHogPageview() {
    clearPostHogPageviewTimer();
    if (!hasAnalyticsConsent() || isSensitiveAnalyticsPage()) {
      return;
    }
    posthogPageviewStartedAt = Date.now();
    tryCapturePostHogPageview();
  }

  function handleAnalyticsConsentChange(event) {
    if (event && event.detail && event.detail.analytics === true && !isSensitiveAnalyticsPage()) {
      queuePostHogPageview();
      return;
    }
    capturedPostHogPage = '';
    capturedPostHogPageleave = false;
    clearPostHogPageviewTimer();
  }

  function handlePostHogPageShow(event) {
    if (!event || event.persisted !== true) {
      return;
    }
    capturedPostHogPageleave = false;
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
        properties: { conversionType: 'registration', source: 'server_response' },
      };
    }
    if (request.method === 'POST' && /^\/api\/(?:v1\/)?quote-requests\/?$/.test(request.url)) {
      return {
        event: 'quote_request_submitted',
        properties: { conversionType: 'quote_request', source: 'server_response' },
      };
    }
    if (request.method === 'POST' && /^\/api\/(?:v1\/)?me\/packages\/?$/.test(request.url)) {
      return {
        event: 'package_created',
        properties: { conversionType: 'package_created', source: 'server_response' },
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

  installSensitivePageConsentGuard();
  installPrivacyAwarePostHogStub();

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

      // The legacy consent component still writes analytics:false for Accept All.
      // Stop that target listener and apply one canonical full-consent decision instead.
      event.preventDefault();
      event.stopImmediatePropagation();
      writeFullConsent();
      closeConsentUi(target);
    },
    true
  );

  window.addEventListener('cookieConsentChanged', handleAnalyticsConsentChange);
  window.addEventListener('pagehide', capturePostHogPageleave);
  window.addEventListener('pageshow', handlePostHogPageShow);

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
