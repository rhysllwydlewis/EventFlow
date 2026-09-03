'use strict';
(function () {
  const COOKIE_NAME = 'eventflow_cookie_consent';
  const EXPIRY_DAYS = 365;
  const FETCH_WRAPPED_FLAG = '__efAnalyticsSuccessObserver';
  const ATTRIBUTION_KEY = 'ef_attribution_v1';
  const ATTRIBUTION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
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
  const POSTHOG_PROVIDER_BLOCKED_PREFIXES = POSTHOG_EXCLUDED_PAGE_PREFIXES.filter(
    prefix => prefix !== '/auth'
  );
  const POSTHOG_URL_PROPERTY_KEYS = new Set([
    '$current_url',
    '$referrer',
    '$initial_current_url',
    '$initial_referrer',
    '$session_entry_url',
    '$session_entry_current_url',
    '$session_entry_referrer',
  ]);
  const SEARCH_HOSTS = [
    'google.com',
    'google.co.uk',
    'bing.com',
    'duckduckgo.com',
    'search.yahoo.com',
    'ecosia.org',
  ];
  const SOCIAL_HOSTS = [
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    't.co',
    'twitter.com',
    'x.com',
    'tiktok.com',
    'pinterest.com',
    'youtube.com',
    'reddit.com',
    'whatsapp.com',
  ];
  const SEARCH_SOURCE_TOKENS = new Set(['google', 'bing', 'duckduckgo', 'yahoo', 'ecosia']);
  const SOCIAL_SOURCE_TOKENS = new Set([
    'facebook',
    'instagram',
    'linkedin',
    'twitter',
    'x',
    'tiktok',
    'pinterest',
    'youtube',
    'reddit',
    'whatsapp',
  ]);
  const PAID_SEARCH_CLICK_PARAMS = ['gclid', 'gbraid', 'wbraid', 'msclkid'];
  const PAID_SOCIAL_CLICK_PARAMS = ['fbclid', 'ttclid', 'li_fat_id'];

  let capturedPostHogPage = '';
  let capturedPostHogPageleave = false;
  let posthogPageviewStartedAt = 0;
  let posthogPageviewTimer = null;
  let authPostHogStarted = false;
  let initialAttributionTouch = null;

  function currentPath() {
    return window.location.pathname || '/';
  }

  function isAuthPage() {
    const pagePath = currentPath();
    return (
      pagePath === '/auth' ||
      pagePath.startsWith('/auth/') ||
      pagePath.startsWith('/auth-') ||
      pagePath.startsWith('/auth.')
    );
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

  function isProviderBlockedPage() {
    return pathMatches(POSTHOG_PROVIDER_BLOCKED_PREFIXES);
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
    const banner = target?.closest?.('#cookie-consent-banner');
    banner?.parentNode?.removeChild?.(banner);

    const dialog = target?.closest?.('#cookie-prefs-dialog');
    dialog?.parentNode?.removeChild?.(dialog);
    if (dialog) {
      document.body?.classList.remove('cookie-prefs-open');
    }
  }

  function hasAnalyticsConsent() {
    if (typeof window.CookieConsent?.getConsent !== 'function') {
      return false;
    }
    try {
      const consent = window.CookieConsent.getConsent();
      return consent?.analytics === true;
    } catch {
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

  function cleanAttributionValue(value, maxLength) {
    const source = String(value || '');
    let result = '';
    for (let index = 0; index < source.length; index += 1) {
      const code = source.charCodeAt(index);
      result += code >= 32 && code !== 127 ? source[index] : ' ';
    }
    return result.trim().slice(0, maxLength || 120);
  }

  function safePath(value) {
    try {
      return new URL(value || '/', window.location.origin).pathname
        .replace(/\/{2,}/g, '/')
        .slice(0, 220);
    } catch {
      return '/';
    }
  }

  function normalizedDomain(value) {
    const raw = cleanAttributionValue(value, 300);
    if (!raw || raw === 'direct' || raw === 'internal') {
      return raw || 'direct';
    }
    try {
      return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
        .toLowerCase()
        .replace(/^www\./, '')
        .slice(0, 120);
    } catch {
      return 'direct';
    }
  }

  function externalReferrerDomain() {
    if (!document.referrer) {
      return 'direct';
    }
    try {
      const referrer = normalizedDomain(document.referrer);
      const current = normalizedDomain(window.location.origin);
      return referrer === current ? 'internal' : referrer;
    } catch {
      return 'direct';
    }
  }

  function hostMatches(host, candidates) {
    return candidates.some(candidate => host === candidate || host.endsWith(`.${candidate}`));
  }

  function classifyChannel(medium, source, referrer, signals = {}) {
    const normalizedMedium = cleanAttributionValue(medium, 80).toLowerCase();
    const sourceToken = cleanAttributionValue(source, 100).toLowerCase();
    const normalizedSource = normalizedDomain(source);
    const normalizedReferrer = normalizedDomain(referrer);

    if (signals.paidSearch) {
      return 'paid_search';
    }
    if (signals.paidSocial) {
      return 'paid_social';
    }
    if (signals.partnerReference) {
      return 'partner';
    }
    if (/^(cpc|ppc|paidsearch|paid_search|sem)$/.test(normalizedMedium)) {
      return 'paid_search';
    }
    if (/^(paid_social|paidsocial)$/.test(normalizedMedium)) {
      return 'paid_social';
    }
    if (/^(social|social-network|social_media)$/.test(normalizedMedium)) {
      return 'organic_social';
    }
    if (/^(email|newsletter)$/.test(normalizedMedium)) {
      return 'email';
    }
    if (/^(affiliate|partner)$/.test(normalizedMedium)) {
      return 'partner';
    }
    if (/^(display|banner|cpm)$/.test(normalizedMedium)) {
      return 'display';
    }
    if (/^(organic|seo)$/.test(normalizedMedium)) {
      return 'organic_search';
    }
    if (normalizedMedium === 'referral') {
      return 'referral';
    }
    if (
      SEARCH_SOURCE_TOKENS.has(sourceToken) ||
      hostMatches(normalizedSource, SEARCH_HOSTS) ||
      hostMatches(normalizedReferrer, SEARCH_HOSTS)
    ) {
      return 'organic_search';
    }
    if (
      SOCIAL_SOURCE_TOKENS.has(sourceToken) ||
      hostMatches(normalizedSource, SOCIAL_HOSTS) ||
      hostMatches(normalizedReferrer, SOCIAL_HOSTS)
    ) {
      return 'organic_social';
    }
    if (!['direct', 'internal'].includes(normalizedReferrer)) {
      return 'referral';
    }
    return 'direct';
  }

  function buildAttributionTouch() {
    const params = new URLSearchParams(window.location.search || '');
    const utmSource = cleanAttributionValue(params.get('utm_source'), 100);
    const utmMedium = cleanAttributionValue(params.get('utm_medium'), 80);
    const partnerReference = cleanAttributionValue(params.get('ref') || params.get('partner'), 80);
    const referrerDomain = externalReferrerDomain();
    const signals = {
      paidSearch: PAID_SEARCH_CLICK_PARAMS.some(key => params.has(key)),
      paidSocial: PAID_SOCIAL_CLICK_PARAMS.some(key => params.has(key)),
      partnerReference,
    };
    return {
      channel: classifyChannel(utmMedium, utmSource, referrerDomain, signals),
      referrerDomain,
      landingPath: safePath(window.location.href),
      utmSource,
      utmMedium,
      utmCampaign: cleanAttributionValue(params.get('utm_campaign'), 120),
      partnerReference,
      capturedAt: new Date().toISOString(),
    };
  }

  function clearAttribution() {
    initialAttributionTouch = null;
    try {
      window.localStorage.removeItem(ATTRIBUTION_KEY);
    } catch {
      // Storage cleanup is best-effort in restricted privacy modes.
    }
  }

  function readAttribution() {
    try {
      const value = JSON.parse(window.localStorage.getItem(ATTRIBUTION_KEY) || 'null');
      const capturedAt = Date.parse(value?.first?.capturedAt);
      if (!capturedAt || Date.now() - capturedAt > ATTRIBUTION_TTL_MS) {
        window.localStorage.removeItem(ATTRIBUTION_KEY);
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }

  function captureAttribution() {
    if (!hasAnalyticsConsent()) {
      return readAttribution();
    }

    const next = buildAttributionTouch();
    const existing = readAttribution();
    const first = initialAttributionTouch || next;
    const value = existing || { first, last: next };
    if (
      !existing ||
      next.utmSource ||
      next.utmMedium ||
      next.utmCampaign ||
      !['direct', 'internal'].includes(next.referrerDomain)
    ) {
      value.last = next;
    }
    value.updatedAt = next.capturedAt;

    try {
      window.localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(value));
    } catch {
      // Storage is best-effort in restricted privacy modes.
    }
    return value;
  }

  function attributionProperties() {
    const value = captureAttribution();
    if (!value) {
      return { attribution_available: false };
    }

    const first = value.first || {};
    const last = value.last || {};
    return {
      attribution_available: true,
      first_channel: cleanAttributionValue(first.channel, 40),
      first_referrer_domain: normalizedDomain(first.referrerDomain),
      first_landing_path: safePath(first.landingPath),
      first_utm_source: cleanAttributionValue(first.utmSource, 100),
      first_utm_medium: cleanAttributionValue(first.utmMedium, 80),
      first_utm_campaign: cleanAttributionValue(first.utmCampaign, 120),
      first_partner_reference: cleanAttributionValue(first.partnerReference, 80),
      last_channel: cleanAttributionValue(last.channel, 40),
      last_referrer_domain: normalizedDomain(last.referrerDomain),
      last_landing_path: safePath(last.landingPath),
      last_utm_source: cleanAttributionValue(last.utmSource, 100),
      last_utm_medium: cleanAttributionValue(last.utmMedium, 80),
      last_utm_campaign: cleanAttributionValue(last.utmCampaign, 120),
      last_partner_reference: cleanAttributionValue(last.partnerReference, 80),
    };
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
    let handlers = [];
    if (Array.isArray(hooks)) {
      handlers = hooks;
    } else if (typeof hooks === 'function') {
      handlers = [hooks];
    }
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
      before_send: event => {
        let result = event;
        try {
          result = runBeforeSendHooks(existingBeforeSend, result);
        } catch {
          // A third-party hook must not bypass EventFlow's final privacy sanitiser.
        }
        return result ? sanitizePostHogEvent(result) : result;
      },
    };
  }

  function installSensitivePageConsentGuard() {
    if (
      !isProviderBlockedPage() ||
      typeof window.CookieConsent?.getConsent !== 'function' ||
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
    if (window.posthog?.__SV) {
      return;
    }

    (function (documentObject, posthog) {
      if (posthog.__SV) {
        return;
      }
      window.posthog = posthog;
      posthog._i = [];
      posthog.init = function (token, config, name) {
        if (isProviderBlockedPage()) {
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
          'init capture identify reset opt_in_capturing opt_out_capturing startSessionRecording stopSessionRecording'.split(
            ' '
          );
        methods.forEach(method => {
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
    if (typeof window.posthog?.capture !== 'function') {
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
    } catch {
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
          ...attributionProperties(),
        });
        capturedPostHogPage = currentUrl;
        capturedPostHogPageleave = false;
      } catch {
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
    if (event?.detail?.analytics === true) {
      captureAttribution();
      if (isAuthPage()) {
        startAuthPostHog();
      }
      if (!isSensitiveAnalyticsPage()) {
        queuePostHogPageview();
      }
      return;
    }
    capturedPostHogPage = '';
    capturedPostHogPageleave = false;
    authPostHogStarted = false;
    clearPostHogPageviewTimer();
    clearAttribution();
  }

  function handlePostHogPageShow(event) {
    if (event?.persisted !== true) {
      return;
    }
    capturedPostHogPageleave = false;
  }

  function upgradeConsentCopy(root) {
    const scope = typeof root?.querySelectorAll === 'function' ? root : document;
    scope.querySelectorAll('.cookie-consent-message p').forEach(paragraph => {
      if (paragraph.textContent?.includes('functional cookies')) {
        paragraph.textContent =
          'We use essential cookies to make our site work. With your consent, analytics helps us understand visits, signup sources and improve EventFlow. You can change these choices at any time.';
      }
    });
    scope.querySelectorAll('.cookie-prefs-category-desc').forEach(description => {
      if (description.textContent?.includes('Currently unused')) {
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
      } else if (input?.url) {
        url = new URL(input.url, window.location.href).pathname;
        method = input.method || method;
      }
    } catch {
      url = '';
    }
    if (options?.method) {
      method = options.method;
    }
    return { url, method: String(method || 'GET').toUpperCase() };
  }

  function successfulEventFor(request) {
    if (request.method === 'POST' && /^\/api\/(?:v1\/)?auth\/register\/?$/.test(request.url)) {
      const attribution = attributionProperties();
      return {
        event: 'registration_completed',
        properties: {
          conversionType: 'registration',
          signup_method: 'email_password',
          source: attribution.first_channel || 'unknown',
          ...attribution,
        },
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

  function identifyRegisteredUser(response) {
    if (!response?.ok || typeof window.posthog?.identify !== 'function') {
      return Promise.resolve(false);
    }
    return response
      .clone()
      .json()
      .then(payload => {
        const user = payload?.user;
        if (!user?.id || user.role === 'admin') {
          return false;
        }
        window.posthog.identify(String(user.id), {
          role: cleanAttributionValue(user.role, 40) || 'customer',
          signup_method: 'email_password',
        });
        return true;
      })
      .catch(() => false);
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
        if (conversion && typeof window.EFAnalytics?.track === 'function') {
          window.EFAnalytics.track(conversion.event, conversion.properties, { immediate: true });
        }
        if (
          conversion?.event === 'registration_completed' &&
          typeof window.posthog?.capture === 'function'
        ) {
          const captureRegistration = () =>
            window.posthog.capture(conversion.event, conversion.properties);
          identifyRegisteredUser(response).then(captureRegistration, captureRegistration);
        }
        return response;
      });
    };
    wrappedFetch[FETCH_WRAPPED_FLAG] = true;
    window.fetch = wrappedFetch;
  }

  function startAuthPostHog() {
    if (authPostHogStarted || !hasAnalyticsConsent() || !isAuthPage()) {
      return;
    }
    authPostHogStarted = true;
    window
      .fetch('/api/v1/analytics/behaviour/config', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      .then(response => (response.ok ? response.json() : null))
      .then(config => {
        const provider = config?.posthog;
        if (!provider || !provider.enabled || !provider.projectKey) {
          return;
        }
        window.posthog.init(provider.projectKey, {
          api_host: provider.apiHost,
          ui_host: provider.uiHost,
          defaults: '2026-05-30',
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: false,
          person_profiles: 'identified_only',
          opt_out_capturing_by_default: true,
          disable_session_recording: true,
          session_recording: {
            maskAllInputs: true,
            maskTextSelector:
              '.ph-sensitive, [data-analytics-sensitive], .message-content, .conversation-content, .email, #sensitive',
          },
        });
        window.posthog.opt_in_capturing();
      })
      .catch(() => {
        authPostHogStarted = false;
      });
  }

  installSensitivePageConsentGuard();
  installPrivacyAwarePostHogStub();

  document.addEventListener(
    'click',
    event => {
      const target = event.target?.closest?.('#cookie-consent-accept, #cookie-prefs-accept-all');
      if (!target) {
        return;
      }

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

  window.EventFlowAttribution = {
    capture: captureAttribution,
    clear: clearAttribution,
    get: readAttribution,
    properties: attributionProperties,
  };

  function init() {
    upgradeConsentCopy(document);
    installSuccessfulConversionObserver();
    initialAttributionTouch = buildAttributionTouch();
    captureAttribution();
    startAuthPostHog();
    queuePostHogPageview();
    if (typeof MutationObserver !== 'function' || !document.body) {
      return;
    }
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node?.nodeType === 1) {
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
