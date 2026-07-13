(function () {
  'use strict';

  const ENDPOINT = '/api/v1/analytics/behaviour/collect';
  const CONFIG_ENDPOINT = '/api/v1/analytics/behaviour/config';
  const SESSION_KEY = 'ef_analytics_session_id';
  const MAX_QUEUE = 20;
  const FLUSH_DELAY_MS = 5000;
  const SENSITIVE_INTERACTION_PATHS = [
    '/messages',
    '/messenger',
    '/chat',
    '/checkout',
    '/payment',
    '/settings',
    '/guests',
  ];
  const REPLAY_EXCLUDED_PATHS = [
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
  ];

  const state = {
    started: false,
    consented: false,
    config: null,
    queue: [],
    flushTimer: null,
    heartbeatTimer: null,
    sessionId: null,
    activeStartedAt: null,
    pendingActiveMs: 0,
    scrollMilestones: new Set(),
    posthogStarted: false,
    clsValue: 0,
    lastInpValue: 0,
  };

  function currentPath() {
    return window.location.pathname.replace(/\/{2,}/g, '/') || '/';
  }

  function pathStartsWithAny(prefixes) {
    const path = currentPath();
    return prefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}.`));
  }

  function isAdminPath() {
    return currentPath() === '/admin' || currentPath().startsWith('/admin-');
  }

  function isSensitiveInteractionPath() {
    return pathStartsWithAny(SENSITIVE_INTERACTION_PATHS);
  }

  function isReplayExcludedPath() {
    return pathStartsWithAny(REPLAY_EXCLUDED_PATHS);
  }

  function hasAnalyticsConsent() {
    if (!window.CookieConsent || typeof window.CookieConsent.getConsent !== 'function') {
      return false;
    }
    try {
      const consent = window.CookieConsent.getConsent();
      return Boolean(consent && consent.analytics);
    } catch (_error) {
      return false;
    }
  }

  function generateSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    const random = Math.random().toString(36).slice(2);
    return `${Date.now().toString(36)}-${random}`;
  }

  function getSessionId() {
    if (state.sessionId) {
      return state.sessionId;
    }
    try {
      state.sessionId = window.sessionStorage.getItem(SESSION_KEY);
      if (!state.sessionId) {
        state.sessionId = generateSessionId();
        window.sessionStorage.setItem(SESSION_KEY, state.sessionId);
      }
    } catch (_error) {
      state.sessionId = generateSessionId();
    }
    return state.sessionId;
  }

  function clearSessionId() {
    state.sessionId = null;
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch (_error) {
      // Storage can be blocked by browser privacy settings.
    }
  }

  function pageType() {
    const path = currentPath();
    if (path === '/' || path === '/index.html' || path.startsWith('/home-v')) return 'home';
    if (path.startsWith('/suppliers')) return 'suppliers';
    if (path.startsWith('/supplier')) return 'supplier';
    if (path.startsWith('/package')) return 'package';
    if (path.startsWith('/marketplace')) return 'marketplace';
    if (path.startsWith('/guides')) return 'guides';
    if (path.startsWith('/articles/')) return 'article';
    if (path.startsWith('/pricing')) return 'pricing';
    if (path.startsWith('/auth')) return 'auth';
    if (path.startsWith('/dashboard')) return 'dashboard';
    if (path.startsWith('/plan')) return 'plan';
    return 'other';
  }

  function referrerDomain() {
    if (!document.referrer) {
      return 'direct';
    }
    try {
      const host = new URL(document.referrer).hostname.replace(/^www\./, '');
      return host === window.location.hostname.replace(/^www\./, '') ? 'internal' : host;
    } catch (_error) {
      return 'direct';
    }
  }

  function deviceType() {
    const width = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0);
    if (width <= 767) return 'mobile';
    if (width <= 1100) return 'tablet';
    return 'desktop';
  }

  function cleanIdentifier(value) {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim().slice(0, 120);
  }

  function baseEvent(event, properties) {
    return {
      event,
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

  function queueEvent(event, properties, options) {
    if (!state.consented || !state.started || isAdminPath()) {
      return false;
    }

    const payload = baseEvent(event, properties);
    state.queue.push(payload);
    if (state.queue.length > MAX_QUEUE) {
      state.queue.splice(0, state.queue.length - MAX_QUEUE);
    }

    if (state.posthogStarted && window.posthog && typeof window.posthog.capture === 'function') {
      try {
        window.posthog.capture(event, {
          page_path: payload.pagePath,
          page_type: payload.pageType,
          referrer_domain: payload.referrerDomain,
          device_type: payload.deviceType,
          ...(properties || {}),
        });
      } catch (_error) {
        // The first-party queue remains the source of truth if PostHog is unavailable.
      }
    }

    if (options && options.immediate) {
      flush(false);
    } else if (state.queue.length >= 10) {
      flush(false);
    } else {
      scheduleFlush();
    }
    return true;
  }

  function sendPayload(payload, useBeacon) {
    const body = JSON.stringify({ consent: true, events: payload });
    if (useBeacon && navigator.sendBeacon) {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        return navigator.sendBeacon(ENDPOINT, blob);
      } catch (_error) {
        // Fall back to fetch below.
      }
    }

    fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {
      // Analytics delivery is deliberately non-blocking.
    });
    return true;
  }

  function flush(useBeacon) {
    if (!state.consented || state.queue.length === 0) {
      return;
    }
    if (state.flushTimer) {
      window.clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    const payload = state.queue.splice(0, MAX_QUEUE);
    sendPayload(payload, Boolean(useBeacon));
    if (state.queue.length > 0) {
      scheduleFlush();
    }
  }

  function isActivelyViewing() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  function resumeActiveTimer() {
    if (!state.started || !state.consented || state.activeStartedAt !== null || !isActivelyViewing()) {
      return;
    }
    state.activeStartedAt = performance.now();
  }

  function pauseActiveTimer() {
    if (state.activeStartedAt === null) {
      return;
    }
    state.pendingActiveMs += Math.max(0, performance.now() - state.activeStartedAt);
    state.activeStartedAt = null;
  }

  function collectActiveDelta() {
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

  function sendEngagement(useBeacon) {
    const seconds = collectActiveDelta();
    if (seconds > 0) {
      queueEvent('page_engagement', { activeSeconds: seconds }, { immediate: false });
    }
    if (useBeacon) {
      flush(true);
    }
  }

  function bindEngagementTracking() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        pauseActiveTimer();
        sendEngagement(true);
      } else {
        resumeActiveTimer();
      }
    });
    window.addEventListener('focus', resumeActiveTimer);
    window.addEventListener('blur', () => {
      pauseActiveTimer();
      sendEngagement(false);
    });
    window.addEventListener('pagehide', () => {
      pauseActiveTimer();
      captureFinalVitals();
      sendEngagement(true);
    });
  }

  function bindScrollTracking() {
    let ticking = false;
    function calculate() {
      ticking = false;
      const root = document.documentElement;
      const scrollable = Math.max(root.scrollHeight - window.innerHeight, 1);
      const depth = Math.min(100, Math.round((window.scrollY / scrollable) * 100));
      [25, 50, 75, 100].forEach(milestone => {
        if (depth >= milestone && !state.scrollMilestones.has(milestone)) {
          state.scrollMilestones.add(milestone);
          queueEvent('scroll_depth', { scrollDepth: milestone });
        }
      });
    }
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(calculate);
        }
      },
      { passive: true }
    );
  }

  function closestActionElement(target) {
    return target && typeof target.closest === 'function'
      ? target.closest('a, button, [role="button"], input[type="submit"]')
      : null;
  }

  function inferResultType(url) {
    const path = url.pathname;
    if (path.startsWith('/supplier')) return 'supplier';
    if (path.startsWith('/package')) return 'package';
    if (path.startsWith('/marketplace')) return 'marketplace';
    return '';
  }

  function bindInteractionTracking() {
    document.addEventListener('click', event => {
      if (isSensitiveInteractionPath()) {
        return;
      }
      const element = closestActionElement(event.target);
      if (!element || element.closest('.ph-no-capture, [data-analytics-sensitive]')) {
        return;
      }

      const explicitEvent = cleanIdentifier(element.dataset && element.dataset.analyticsEvent);
      if (explicitEvent) {
        queueEvent(explicitEvent, {
          eventLabel: cleanIdentifier(element.dataset.analyticsLabel || element.textContent || ''),
          itemType: cleanIdentifier(element.dataset.analyticsItemType || ''),
          itemId: cleanIdentifier(element.dataset.analyticsItemId || ''),
          supplierId: cleanIdentifier(element.dataset.supplierId || ''),
          packageId: cleanIdentifier(element.dataset.packageId || ''),
          source: 'delegated_click',
        });
      }

      if (element.tagName === 'A' && element.href) {
        try {
          const url = new URL(element.href, window.location.href);
          if (url.origin !== window.location.origin) {
            queueEvent('outbound_click', {
              source: url.hostname.replace(/^www\./, ''),
              eventLabel: cleanIdentifier(element.textContent || ''),
            });
            return;
          }
          const resultType = inferResultType(url);
          if (resultType) {
            queueEvent('result_clicked', {
              resultType,
              source: pageType(),
              eventLabel: cleanIdentifier(element.textContent || ''),
            });
          }
        } catch (_error) {
          // Ignore malformed links.
        }
      }

      const text = String(element.textContent || element.value || '').trim().toLowerCase();
      if (/add to (my )?plan/.test(text)) {
        queueEvent('package_add_to_plan', {
          packageId: cleanIdentifier(element.dataset.packageId || ''),
          source: pageType(),
        });
      } else if (/shortlist|save supplier|save package/.test(text)) {
        queueEvent('shortlist_add', {
          itemType: pageType() === 'package' ? 'package' : 'supplier',
          itemId: cleanIdentifier(element.dataset.itemId || element.dataset.supplierId || ''),
          source: pageType(),
        });
      } else if (/request quote|send enquiry|contact supplier/.test(text)) {
        queueEvent('enquiry_started', { source: pageType() });
      } else if (/checkout|upgrade|subscribe/.test(text)) {
        queueEvent('checkout_started', { source: pageType() });
      }
    });

    document.addEventListener('submit', event => {
      const form = event.target;
      if (!form || form.closest('.ph-no-capture, [data-analytics-sensitive]')) {
        return;
      }
      const action = (() => {
        try {
          return new URL(form.action || window.location.href, window.location.href).pathname;
        } catch (_error) {
          return currentPath();
        }
      })();

      queueEvent('form_submit', {
        formId: cleanIdentifier(form.id || form.getAttribute('name') || ''),
        formAction: action,
        source: pageType(),
      });

      if (/search|supplier/.test(action) && (pageType() === 'home' || pageType() === 'suppliers')) {
        queueEvent('search_performed', { source: pageType() });
      }
      if (pageType() === 'auth') {
        queueEvent('registration_started', { source: 'auth_form' });
      }
    });
  }

  function trackMetric(metricName, metricValue, metricRating) {
    queueEvent('web_vital', {
      metricName,
      metricValue: Number(metricValue) || 0,
      metricRating: Number(metricRating) || 0,
    });
  }

  function bindPerformanceTracking() {
    if (typeof PerformanceObserver !== 'function') {
      return;
    }
    try {
      const lcpObserver = new PerformanceObserver(list => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) {
          trackMetric('LCP', Math.round(last.startTime), last.startTime <= 2500 ? 100 : last.startTime <= 4000 ? 50 : 0);
          lcpObserver.disconnect();
        }
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_error) {
      // Unsupported browser.
    }

    try {
      const clsObserver = new PerformanceObserver(list => {
        list.getEntries().forEach(entry => {
          if (!entry.hadRecentInput) {
            state.clsValue += entry.value;
          }
        });
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });
    } catch (_error) {
      // Unsupported browser.
    }

    try {
      const inpObserver = new PerformanceObserver(list => {
        list.getEntries().forEach(entry => {
          state.lastInpValue = Math.max(state.lastInpValue, entry.duration || 0);
        });
      });
      inpObserver.observe({ type: 'event', buffered: true, durationThreshold: 40 });
    } catch (_error) {
      // Unsupported browser.
    }

    window.addEventListener('load', () => {
      window.setTimeout(() => {
        const navigation = performance.getEntriesByType('navigation')[0];
        if (navigation) {
          trackMetric(
            'DOM_LOAD',
            Math.round(navigation.domContentLoadedEventEnd),
            navigation.domContentLoadedEventEnd <= 2000 ? 100 : 50
          );
        }
      }, 0);
    });
  }

  function captureFinalVitals() {
    if (state.clsValue > 0) {
      trackMetric('CLS', Math.round(state.clsValue * 1000) / 1000, state.clsValue <= 0.1 ? 100 : state.clsValue <= 0.25 ? 50 : 0);
      state.clsValue = 0;
    }
    if (state.lastInpValue > 0) {
      trackMetric('INP', Math.round(state.lastInpValue), state.lastInpValue <= 200 ? 100 : state.lastInpValue <= 500 ? 50 : 0);
      state.lastInpValue = 0;
    }
  }

  function bindErrorTracking() {
    window.addEventListener('error', event => {
      const sourcePath = (() => {
        try {
          return event.filename ? new URL(event.filename, window.location.href).pathname : '';
        } catch (_error) {
          return '';
        }
      })();
      queueEvent('client_error', {
        errorName: cleanIdentifier((event.error && event.error.name) || 'Error'),
        source: sourcePath,
        line: Number(event.lineno) || 0,
        column: Number(event.colno) || 0,
      });
    });
    window.addEventListener('unhandledrejection', event => {
      const reason = event.reason;
      queueEvent('client_error', {
        errorName: cleanIdentifier((reason && reason.name) || 'UnhandledRejection'),
        source: currentPath(),
      });
    });
  }

  function installPostHogStub() {
    if (window.posthog && window.posthog.__SV) {
      return;
    }
    (function (documentObject, posthog) {
      let methodNames;
      let index;
      let script;
      let firstScript;
      if (posthog.__SV) return;
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
        script = documentObject.createElement('script');
        script.type = 'text/javascript';
        script.crossOrigin = 'anonymous';
        script.async = true;
        script.src = `${config.api_host.replace('.i.posthog.com', '-assets.i.posthog.com')}/static/array.js`;
        firstScript = documentObject.getElementsByTagName('script')[0];
        firstScript.parentNode.insertBefore(script, firstScript);
        let instance = posthog;
        if (name !== undefined) {
          instance = posthog[name] = [];
        } else {
          name = 'posthog';
        }
        instance.people = instance.people || [];
        methodNames = 'init capture register register_once unregister identify reset set_config startSessionRecording stopSessionRecording opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing'.split(' ');
        for (index = 0; index < methodNames.length; index += 1) {
          addMethod(instance, methodNames[index]);
        }
        posthog._i.push([token, config, name]);
      };
      posthog.__SV = 1;
    })(document, window.posthog || []);
  }

  async function identifyPostHogUser() {
    if (!state.posthogStarted || !window.posthog || typeof window.posthog.identify !== 'function') {
      return;
    }
    try {
      const response = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
      if (!response.ok) return;
      const data = await response.json();
      const user = data && data.user;
      if (user && user.id) {
        window.posthog.identify(String(user.id), { role: user.role || 'customer' });
      }
    } catch (_error) {
      // Anonymous analytics continues without identification.
    }
  }

  function startPostHog(config) {
    if (
      state.posthogStarted ||
      !config ||
      !config.enabled ||
      !config.projectKey ||
      isReplayExcludedPath() && config.sessionRecordingEnabled
    ) {
      // On sensitive pages, skip the SDK entirely when replay is enabled to guarantee no snapshot is taken.
      return;
    }

    installPostHogStub();
    const replayAllowed = config.sessionRecordingEnabled && !isReplayExcludedPath();
    window.posthog.init(config.projectKey, {
      api_host: config.apiHost,
      ui_host: config.uiHost,
      defaults: '2026-05-30',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      person_profiles: 'identified_only',
      opt_out_capturing_by_default: true,
      disable_session_recording: !replayAllowed,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector:
          '.ph-sensitive, [data-analytics-sensitive], .message-content, .conversation-content, .email, #sensitive',
        maskCapturedNetworkRequestFn: request => {
          if (request && request.name) {
            request.name = request.name.split('?')[0];
          }
          return request;
        },
      },
    });
    state.posthogStarted = true;
    window.posthog.opt_in_capturing();
    identifyPostHogUser();
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

  function trackInitialPageEvents() {
    queueEvent('page_view', {});
    if (pageType() === 'supplier') {
      queueEvent('supplier_profile_view', { source: referrerDomain() });
    } else if (pageType() === 'package') {
      queueEvent('package_view', { source: referrerDomain() });
    } else if (pageType() === 'auth') {
      queueEvent('registration_started', { source: referrerDomain() });
    }
  }

  async function loadConfig() {
    if (state.config) {
      return state.config;
    }
    try {
      const response = await fetch(CONFIG_ENDPOINT, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Analytics configuration unavailable');
      }
      state.config = await response.json();
    } catch (_error) {
      state.config = { enabled: true, heartbeatSeconds: 15, posthog: { enabled: false } };
    }
    return state.config;
  }

  async function start() {
    if (state.started || isAdminPath() || !hasAnalyticsConsent()) {
      return;
    }
    state.consented = true;
    const config = await loadConfig();
    if (!config.enabled || !hasAnalyticsConsent()) {
      state.consented = false;
      return;
    }

    state.started = true;
    getSessionId();
    resumeActiveTimer();
    bindEngagementTracking();
    bindScrollTracking();
    bindInteractionTracking();
    bindPerformanceTracking();
    bindErrorTracking();
    trackInitialPageEvents();

    const heartbeatSeconds = Math.min(Math.max(Number(config.heartbeatSeconds) || 15, 10), 60);
    state.heartbeatTimer = window.setInterval(() => sendEngagement(false), heartbeatSeconds * 1000);
    startPostHog(config.posthog);
  }

  function stop() {
    state.consented = false;
    state.started = false;
    pauseActiveTimer();
    state.pendingActiveMs = 0;
    state.queue.length = 0;
    state.scrollMilestones.clear();
    if (state.flushTimer) {
      window.clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    if (state.heartbeatTimer) {
      window.clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    stopPostHog();
    clearSessionId();
  }

  function publicTrack(eventName, properties) {
    return queueEvent(cleanIdentifier(eventName), properties || {});
  }

  window.EFAnalytics = {
    track: publicTrack,
    flush: () => flush(false),
    hasAnalyticsConsent,
    start,
    stop,
  };

  window.addEventListener('cookieConsentChanged', event => {
    if (event && event.detail && event.detail.analytics) {
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