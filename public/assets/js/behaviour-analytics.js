'use strict';
(function () {
  const COLLECT_ENDPOINT = '/api/v1/analytics/behaviour/collect';
  const CONFIG_ENDPOINT = '/api/v1/analytics/behaviour/config';
  const SESSION_KEY = 'ef_analytics_session_id';
  const MAX_QUEUE_SIZE = 20;
  const FLUSH_DELAY_MS = 5000;
  const SCROLL_MILESTONES = [25, 50, 75, 100];

  const EXCLUDED_PAGE_PREFIXES = [
    '/admin',
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

  const SENSITIVE_INTERACTION_PREFIXES = ['/auth', '/reset-password', ...EXCLUDED_PAGE_PREFIXES];

  const state = {
    activeStartedAt: null,
    bindingsInstalled: false,
    config: null,
    consented: false,
    flushTimer: null,
    heartbeatTimer: null,
    pendingActiveMs: 0,
    posthogStarted: false,
    queue: [],
    scrollMilestones: new Set(),
    sessionId: null,
    started: false,
    starting: false,
  };

  function currentPath() {
    return window.location.pathname.replace(/\/{2,}/g, '/') || '/';
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

  function isExcludedPage() {
    return pathMatches(EXCLUDED_PAGE_PREFIXES);
  }

  function isSensitiveInteractionPage() {
    return pathMatches(SENSITIVE_INTERACTION_PREFIXES);
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

  function createSecureSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    // Analytics-only fallback for browsers without Web Crypto; never used for authentication.
    return `limited-${Date.now().toString(36)}-${performance.timeOrigin.toString(36)}`;
  }

  function getSessionId() {
    if (state.sessionId) {
      return state.sessionId;
    }
    try {
      state.sessionId = window.sessionStorage.getItem(SESSION_KEY);
      if (!state.sessionId) {
        state.sessionId = createSecureSessionId();
        window.sessionStorage.setItem(SESSION_KEY, state.sessionId);
      }
    } catch (_error) {
      state.sessionId = createSecureSessionId();
    }
    return state.sessionId;
  }

  function clearSessionId() {
    state.sessionId = null;
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch (_error) {
      // Browser storage can be unavailable in restricted privacy modes.
    }
  }

  function pageType() {
    const pagePath = currentPath();
    if (pagePath === '/' || pagePath === '/index.html' || pagePath.startsWith('/home-v')) {
      return 'home';
    }
    if (pagePath.startsWith('/suppliers')) {
      return 'suppliers';
    }
    if (pagePath.startsWith('/supplier')) {
      return 'supplier';
    }
    if (pagePath.startsWith('/package')) {
      return 'package';
    }
    if (pagePath.startsWith('/marketplace')) {
      return 'marketplace';
    }
    if (pagePath.startsWith('/guides')) {
      return 'guides';
    }
    if (pagePath.startsWith('/articles/')) {
      return 'article';
    }
    if (pagePath.startsWith('/pricing')) {
      return 'pricing';
    }
    if (pagePath.startsWith('/auth')) {
      return 'auth';
    }
    return 'other';
  }

  function referrerDomain() {
    if (!document.referrer) {
      return 'direct';
    }
    try {
      const host = new URL(document.referrer).hostname.replace(/^www\./, '');
      const currentHost = window.location.hostname.replace(/^www\./, '');
      return host === currentHost ? 'internal' : host;
    } catch (_error) {
      return 'direct';
    }
  }

  function deviceType() {
    const width = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0);
    if (width <= 767) {
      return 'mobile';
    }
    if (width <= 1100) {
      return 'tablet';
    }
    return 'desktop';
  }

  function cleanIdentifier(value) {
    return typeof value === 'string' ? value.trim().slice(0, 120) : '';
  }

  function decodeIdentifier(value) {
    try {
      return decodeURIComponent(value || '');
    } catch (_error) {
      return value || '';
    }
  }

  function currentPageSupplierId() {
    // Canonical /supplier/name--token profile URLs carry no ?id= query string
    // at all -- the real id is only available via the stable
    // window.EventFlowSupplierRoute API that supplier-route-context.js
    // exposes (see public-supplier-avatar.js for the original fix of this
    // same class of bug). Falling back to the query string keeps this
    // working for any non-canonical URL (e.g. supplier.html?id=...).
    const routeId = window.EventFlowSupplierRoute?.getSupplierId?.();
    if (routeId) {
      return routeId;
    }
    return new URLSearchParams(window.location.search || '').get('id') || '';
  }

  function currentEntityContext() {
    const type = pageType();
    const params = new URLSearchParams(window.location.search || '');
    if (type === 'supplier') {
      return { supplierId: cleanIdentifier(currentPageSupplierId()) };
    }
    if (type === 'package') {
      let packageId = params.get('id') || params.get('packageId') || params.get('slug') || '';
      if (!packageId && currentPath().startsWith('/package/')) {
        packageId = decodeIdentifier(currentPath().slice('/package/'.length).split('/')[0]);
      }
      return { packageId: cleanIdentifier(packageId) };
    }
    return {};
  }

  function elementEntityContext(element) {
    const current = currentEntityContext();
    const supplierNode =
      element && typeof element.closest === 'function'
        ? element.closest('[data-supplier-id]')
        : null;
    const packageNode =
      element && typeof element.closest === 'function'
        ? element.closest('[data-package-id]')
        : null;
    return {
      supplierId: cleanIdentifier(
        element?.dataset?.supplierId ||
          supplierNode?.dataset?.supplierId ||
          current.supplierId ||
          ''
      ),
      packageId: cleanIdentifier(
        element?.dataset?.packageId || packageNode?.dataset?.packageId || current.packageId || ''
      ),
    };
  }

  function linkEntityContext(url, type, element) {
    if (type === 'supplier') {
      // Supplier card/profile links use the canonical /supplier/name--token
      // slug, which never carries an ?id= query string -- the token is a
      // one-way hash, not the raw id. Cards render their real id straight
      // onto the link (or an ancestor) as data-supplier-id, so prefer that
      // before falling back to the query string for any legacy link shape.
      const supplierNode =
        element && typeof element.closest === 'function'
          ? element.closest('[data-supplier-id]')
          : null;
      const supplierId =
        element?.dataset?.supplierId ||
        supplierNode?.dataset?.supplierId ||
        url.searchParams.get('id') ||
        '';
      return {
        supplierId: cleanIdentifier(supplierId),
      };
    }
    let packageId =
      url.searchParams.get('id') ||
      url.searchParams.get('packageId') ||
      url.searchParams.get('slug') ||
      '';
    if (!packageId && url.pathname.startsWith('/package/')) {
      packageId = decodeIdentifier(url.pathname.slice('/package/'.length).split('/')[0]);
    }
    return { packageId: cleanIdentifier(packageId) };
  }

  function buildEvent(eventName, properties) {
    return {
      event: eventName,
      sessionId: getSessionId(),
      pagePath: currentPath(),
      pageType: pageType(),
      referrerDomain: referrerDomain(),
      deviceType: deviceType(),
      timestamp: new Date().toISOString(),
      properties: properties || {},
    };
  }

  function scheduleFlush() {
    if (state.flushTimer || state.queue.length === 0) {
      return;
    }
    state.flushTimer = window.setTimeout(() => {
      state.flushTimer = null;
      flush(false);
    }, FLUSH_DELAY_MS);
  }

  function sendBatch(batch, useBeacon) {
    if (!hasAnalyticsConsent() || batch.length === 0) {
      return;
    }

    const body = JSON.stringify({ consent: true, events: batch });
    if (useBeacon && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(COLLECT_ENDPOINT, blob)) {
          return;
        }
      } catch (_error) {
        // Fall through to fetch with keepalive.
      }
    }

    fetch(COLLECT_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {
      // Analytics delivery must never affect the website experience.
    });
  }

  function flush(useBeacon) {
    if (!state.consented || !hasAnalyticsConsent() || state.queue.length === 0) {
      return;
    }
    if (state.flushTimer) {
      window.clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    const batch = state.queue.splice(0, MAX_QUEUE_SIZE);
    sendBatch(batch, Boolean(useBeacon));
    if (state.queue.length > 0) {
      scheduleFlush();
    }
  }

  function capturePostHog(eventName, event) {
    if (!state.posthogStarted || !window.posthog || typeof window.posthog.capture !== 'function') {
      return;
    }
    try {
      window.posthog.capture(eventName, {
        page_path: event.pagePath,
        page_type: event.pageType,
        referrer_domain: event.referrerDomain,
        device_type: event.deviceType,
        ...(event.properties || {}),
      });
    } catch (_error) {
      // First-party analytics remains available if PostHog is blocked.
    }
  }

  function track(eventName, properties, options) {
    if (!state.started || !state.consented || !hasAnalyticsConsent() || isExcludedPage()) {
      return false;
    }

    const cleanName = cleanIdentifier(eventName);
    if (!cleanName) {
      return false;
    }

    const analyticsEvent = buildEvent(cleanName, properties);
    state.queue.push(analyticsEvent);
    if (state.queue.length > MAX_QUEUE_SIZE) {
      state.queue.splice(0, state.queue.length - MAX_QUEUE_SIZE);
    }
    capturePostHog(cleanName, analyticsEvent);

    if (options && options.immediate) {
      flush(false);
    } else if (state.queue.length >= 10) {
      flush(false);
    } else {
      scheduleFlush();
    }
    return true;
  }

  function isActivelyViewing() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  function resumeActiveTimer() {
    if (!state.started || !state.consented || state.activeStartedAt !== null) {
      return;
    }
    if (isActivelyViewing()) {
      state.activeStartedAt = performance.now();
    }
  }

  function pauseActiveTimer() {
    if (state.activeStartedAt === null) {
      return;
    }
    state.pendingActiveMs += Math.max(0, performance.now() - state.activeStartedAt);
    state.activeStartedAt = null;
  }

  function collectActiveSeconds() {
    if (state.activeStartedAt !== null) {
      const now = performance.now();
      state.pendingActiveMs += Math.max(0, now - state.activeStartedAt);
      state.activeStartedAt = now;
    }
    const seconds = Math.floor(state.pendingActiveMs / 1000);
    if (seconds > 0) {
      state.pendingActiveMs -= seconds * 1000;
    }
    return seconds;
  }

  function reportEngagement(useBeacon) {
    const seconds = collectActiveSeconds();
    if (seconds > 0) {
      track('page_engagement', { activeSeconds: seconds });
    }
    if (useBeacon) {
      flush(true);
    }
  }

  function bindEngagementTracking() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        pauseActiveTimer();
        reportEngagement(true);
      } else {
        resumeActiveTimer();
      }
    });
    window.addEventListener('focus', resumeActiveTimer);
    window.addEventListener('blur', () => {
      pauseActiveTimer();
      reportEngagement(false);
    });
    window.addEventListener('pagehide', () => {
      pauseActiveTimer();
      reportEngagement(true);
    });
  }

  function bindScrollTracking() {
    let scheduled = false;
    window.addEventListener(
      'scroll',
      () => {
        if (scheduled || isExcludedPage()) {
          return;
        }
        scheduled = true;
        window.requestAnimationFrame(() => {
          scheduled = false;
          const root = document.documentElement;
          const scrollable = Math.max(root.scrollHeight - window.innerHeight, 1);
          const depth = Math.min(100, Math.round((window.scrollY / scrollable) * 100));
          SCROLL_MILESTONES.forEach(milestone => {
            if (depth >= milestone && !state.scrollMilestones.has(milestone)) {
              state.scrollMilestones.add(milestone);
              track('scroll_depth', { scrollDepth: milestone });
            }
          });
        });
      },
      { passive: true }
    );
  }

  function actionElement(target) {
    return target && typeof target.closest === 'function'
      ? target.closest('a, button, [role="button"], input[type="submit"]')
      : null;
  }

  function bindInteractionTracking() {
    document.addEventListener('click', event => {
      if (isSensitiveInteractionPage()) {
        return;
      }
      const element = actionElement(event.target);
      if (!element || element.closest('.ph-no-capture, [data-analytics-sensitive]')) {
        return;
      }

      const entityContext = elementEntityContext(element);
      const explicitEvent = cleanIdentifier(element.dataset && element.dataset.analyticsEvent);
      if (explicitEvent) {
        track(explicitEvent, {
          eventLabel: cleanIdentifier(element.dataset.analyticsLabel || ''),
          itemType: cleanIdentifier(element.dataset.analyticsItemType || ''),
          itemId: cleanIdentifier(element.dataset.analyticsItemId || ''),
          supplierId: entityContext.supplierId,
          packageId: entityContext.packageId,
          source: 'delegated_click',
        });
      }

      const text = String(element.textContent || element.value || '')
        .trim()
        .toLowerCase();
      if (/add to (my )?plan/.test(text)) {
        track('package_add_to_plan', {
          packageId: entityContext.packageId,
          supplierId: entityContext.supplierId,
          source: pageType(),
        });
      } else if (/shortlist|save supplier|save package/.test(text)) {
        const itemType = pageType() === 'package' ? 'package' : 'supplier';
        track('shortlist_add', {
          itemType,
          itemId: cleanIdentifier(
            element.dataset.itemId ||
              (itemType === 'package' ? entityContext.packageId : entityContext.supplierId) ||
              ''
          ),
          supplierId: entityContext.supplierId,
          packageId: entityContext.packageId,
          source: pageType(),
        });
      } else if (/request quote|send enquiry|contact supplier/.test(text)) {
        track('enquiry_started', { ...entityContext, source: pageType() });
      } else if (/checkout|upgrade|subscribe/.test(text)) {
        track('checkout_started', { source: pageType() });
      }

      if (element.tagName !== 'A' || !element.href) {
        return;
      }
      try {
        const url = new URL(element.href, window.location.href);
        if (url.origin !== window.location.origin) {
          track('outbound_click', { source: url.hostname.replace(/^www\./, '') });
        } else if (url.pathname.startsWith('/supplier')) {
          const linkContext = linkEntityContext(url, 'supplier', element);
          track('result_clicked', {
            resultType: 'supplier',
            resultId: linkContext.supplierId,
            supplierId: linkContext.supplierId,
            source: pageType(),
          });
        } else if (url.pathname.startsWith('/package')) {
          const linkContext = linkEntityContext(url, 'package');
          track('result_clicked', {
            resultType: 'package',
            resultId: linkContext.packageId,
            packageId: linkContext.packageId,
            source: pageType(),
          });
        }
      } catch (_error) {
        // Ignore malformed links.
      }
    });

    document.addEventListener('submit', event => {
      if (isSensitiveInteractionPage()) {
        return;
      }
      const form = event.target;
      if (!form || form.closest('.ph-no-capture, [data-analytics-sensitive]')) {
        return;
      }

      let action = currentPath();
      try {
        action = new URL(form.action || window.location.href, window.location.href).pathname;
      } catch (_error) {
        // Keep the current path.
      }

      track('form_submit', {
        formId: cleanIdentifier(form.id || form.getAttribute('name') || ''),
        formAction: action,
        source: pageType(),
      });
      if (/search|supplier/.test(action) && ['home', 'suppliers'].includes(pageType())) {
        track('search_performed', { source: pageType() });
      }
    });
  }

  function bindErrorTracking() {
    window.addEventListener('error', event => {
      let source = '';
      try {
        source = event.filename ? new URL(event.filename, window.location.href).pathname : '';
      } catch (_error) {
        source = '';
      }
      track('client_error', {
        errorName: cleanIdentifier((event.error && event.error.name) || 'Error'),
        source,
        line: Number(event.lineno) || 0,
        column: Number(event.colno) || 0,
      });
    });
    window.addEventListener('unhandledrejection', event => {
      track('client_error', {
        errorName: cleanIdentifier((event.reason && event.reason.name) || 'UnhandledRejection'),
        source: currentPath(),
      });
    });
  }

  function bindPerformanceTracking() {
    if (typeof PerformanceObserver !== 'function') {
      return;
    }
    try {
      const observer = new PerformanceObserver(list => {
        const entries = list.getEntries();
        const latest = entries[entries.length - 1];
        if (latest) {
          track('web_vital', {
            metricName: 'LCP',
            metricValue: Math.round(latest.startTime),
            metricRating: latest.startTime <= 2500 ? 100 : latest.startTime <= 4000 ? 50 : 0,
          });
          observer.disconnect();
        }
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_error) {
      // The metric is not supported in this browser.
    }
  }

  function installPostHogStub() {
    if (window.posthog && window.posthog.__SV) {
      return;
    }
    (function (documentObject, posthog) {
      if (posthog.__SV) {
        return;
      }
      window.posthog = posthog;
      posthog._i = [];
      posthog.init = function (token, config, name) {
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

        const script = documentObject.createElement('script');
        script.type = 'text/javascript';
        script.crossOrigin = 'anonymous';
        script.async = true;
        script.src = `${config.api_host.replace(
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
        methods.forEach(method => {
          addMethod(instance, method);
        });
        posthog._i.push([token, config, instanceName]);
      };
      posthog.__SV = 1;
    })(document, window.posthog || []);
  }

  function sanitizePostHogProviderEvent(event) {
    if (!event || typeof event !== 'object') {
      return event;
    }

    const properties = event.properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      return event;
    }

    // This integration is deliberately personless, so the provider flag must remain boolean false.
    properties.$process_person_profile = false;

    Object.keys(properties).forEach(key => {
      if (!key.startsWith('$web_vitals_') || !key.endsWith('_event')) {
        return;
      }
      const metric = properties[key];
      if (!metric || typeof metric !== 'object' || Array.isArray(metric)) {
        return;
      }
      if (typeof metric.$current_url === 'string') {
        metric.$current_url = metric.$current_url.split(/[?#]/, 1)[0];
      }
    });

    return event;
  }

  function startPostHog(config) {
    if (
      state.posthogStarted ||
      !config ||
      !config.enabled ||
      !config.projectKey ||
      isSensitiveInteractionPage()
    ) {
      return;
    }

    installPostHogStub();
    const replayAllowed = config.sessionRecordingEnabled && !isSensitiveInteractionPage();
    window.posthog.init(config.projectKey, {
      api_host: config.apiHost,
      ui_host: config.uiHost,
      defaults: '2026-05-30',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: {
        web_vitals: true,
        web_vitals_attribution: false,
      },
      person_profiles: 'never',
      before_send: sanitizePostHogProviderEvent,
      opt_out_capturing_by_default: true,
      disable_session_recording: !replayAllowed,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector:
          '.ph-sensitive, [data-analytics-sensitive], .message-content, .conversation-content, .email, #sensitive',
        maskCapturedNetworkRequestFn: function (request) {
          if (request && request.name) {
            request.name = request.name.split('?')[0];
          }
          return request;
        },
      },
    });
    state.posthogStarted = true;
    window.posthog.opt_in_capturing();
  }

  function stopPostHog() {
    if (!window.posthog) {
      state.posthogStarted = false;
      return;
    }
    try {
      if (typeof window.posthog.opt_out_capturing === 'function') {
        window.posthog.opt_out_capturing();
      }
      if (typeof window.posthog.stopSessionRecording === 'function') {
        window.posthog.stopSessionRecording();
      }
      if (typeof window.posthog.reset === 'function') {
        window.posthog.reset();
      }
    } catch (_error) {
      // Best-effort provider shutdown.
    }
    state.posthogStarted = false;
  }

  function installBindings() {
    if (state.bindingsInstalled) {
      return;
    }
    bindEngagementTracking();
    bindScrollTracking();
    bindInteractionTracking();
    bindErrorTracking();
    bindPerformanceTracking();
    state.bindingsInstalled = true;
  }

  function trackInitialPageEvents() {
    const entityContext = currentEntityContext();
    track('page_view', {});
    if (pageType() === 'supplier') {
      track('supplier_profile_view', { ...entityContext, source: referrerDomain() });
    } else if (pageType() === 'package') {
      track('package_view', { ...entityContext, source: referrerDomain() });
    }
  }

  function loadConfig() {
    if (state.config) {
      return Promise.resolve(state.config);
    }
    return fetch(CONFIG_ENDPOINT, { credentials: 'same-origin', cache: 'no-store' })
      .then(response => {
        if (!response.ok) {
          throw new Error('Analytics configuration unavailable');
        }
        return response.json();
      })
      .catch(() => {
        return {
          enabled: true,
          heartbeatSeconds: 15,
          posthog: { enabled: false },
        };
      })
      .then(config => {
        state.config = config;
        return config;
      });
  }

  function start() {
    if (state.started || state.starting || isExcludedPage() || !hasAnalyticsConsent()) {
      return Promise.resolve();
    }

    state.starting = true;
    state.consented = true;

    return loadConfig()
      .then(config => {
        if (!config.enabled || !hasAnalyticsConsent() || isExcludedPage()) {
          state.consented = false;
          return;
        }

        state.started = true;
        getSessionId();
        installBindings();
        resumeActiveTimer();
        trackInitialPageEvents();

        const seconds = Math.min(Math.max(Number(config.heartbeatSeconds) || 15, 10), 60);
        if (state.heartbeatTimer) {
          window.clearInterval(state.heartbeatTimer);
        }
        state.heartbeatTimer = window.setInterval(() => {
          reportEngagement(false);
        }, seconds * 1000);
        startPostHog(config.posthog);
      })
      .finally(() => {
        state.starting = false;
      });
  }

  function stop() {
    pauseActiveTimer();
    state.consented = false;
    state.started = false;
    state.starting = false;
    state.pendingActiveMs = 0;
    state.queue.length = 0;
    state.scrollMilestones.clear();
    if (state.flushTimer) {
      window.clearTimeout(state.flushTimer);
    }
    if (state.heartbeatTimer) {
      window.clearInterval(state.heartbeatTimer);
    }
    state.flushTimer = null;
    state.heartbeatTimer = null;
    stopPostHog();
    clearSessionId();
  }

  window.EFAnalytics = {
    track: function (eventName, properties) {
      return track(eventName, properties || {});
    },
    flush: function () {
      flush(false);
    },
    hasAnalyticsConsent,
    start,
    stop,
  };

  window.addEventListener('cookieConsentChanged', event => {
    if (event && event.detail && event.detail.analytics === true) {
      start();
    } else {
      stop();
    }
  });

  function init() {
    if (hasAnalyticsConsent()) {
      start();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
