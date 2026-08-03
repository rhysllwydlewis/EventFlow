(function () {
  'use strict';

  const COOKIE_NAME = 'eventflow_cookie_consent';
  const ATTRIBUTION_KEY = 'ef_attribution_v1';
  const GOOGLE_SIGNUP_PENDING_KEY = 'ef_google_signup_pending';
  const ATTRIBUTION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
  const FETCH_WRAPPED_FLAG = '__efAnalyticsSuccessObserver';
  const SENSITIVE_PATHS = [
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
  const CONSENT_GUARD_PATHS = SENSITIVE_PATHS.filter(prefix => prefix !== '/auth');
  const POSTHOG_URL_KEYS = [
    '$current_url',
    '$referrer',
    '$initial_current_url',
    '$initial_referrer',
    '$session_entry_url',
    '$session_entry_current_url',
    '$session_entry_referrer',
  ];
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

  function currentPath() {
    return window.location.pathname || '/';
  }

  function pathMatches(prefixes) {
    const path = currentPath();
    return prefixes.some(
      prefix =>
        path === prefix ||
        path.startsWith(`${prefix}/`) ||
        path.startsWith(`${prefix}-`) ||
        path.startsWith(`${prefix}.`)
    );
  }

  function hasAnalyticsConsent() {
    try {
      return Boolean(window.CookieConsent?.getConsent?.()?.analytics === true);
    } catch (_error) {
      return false;
    }
  }

  function clean(value, max = 160) {
    return String(value || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, max);
  }

  function safePath(value) {
    try {
      return new URL(value || '/', window.location.origin).pathname
        .replace(/\/{2,}/g, '/')
        .slice(0, 220);
    } catch (_error) {
      return '/';
    }
  }

  function domain(value) {
    const raw = clean(value, 300);
    if (!raw || raw === 'direct' || raw === 'internal') return raw || 'direct';
    try {
      return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
        .toLowerCase()
        .replace(/^www\./, '')
        .slice(0, 120);
    } catch (_error) {
      return 'direct';
    }
  }

  function externalReferrer() {
    if (!document.referrer) return 'direct';
    try {
      const referrer = domain(document.referrer);
      const current = domain(window.location.origin);
      return referrer === current ? 'internal' : referrer;
    } catch (_error) {
      return 'direct';
    }
  }

  function hostMatches(host, candidates) {
    return candidates.some(candidate => host === candidate || host.endsWith(`.${candidate}`));
  }

  function classifyChannel(medium, source, referrer) {
    const m = clean(medium, 80).toLowerCase();
    const s = domain(source);
    const r = domain(referrer);
    if (/^(cpc|ppc|paidsearch|paid_search|sem)$/.test(m)) return 'paid_search';
    if (/^(paid_social|paidsocial)$/.test(m)) return 'paid_social';
    if (/^(social|social-network|social_media)$/.test(m)) return 'organic_social';
    if (/^(email|newsletter)$/.test(m)) return 'email';
    if (/^(affiliate|partner)$/.test(m)) return 'partner';
    if (/^(display|banner|cpm)$/.test(m)) return 'display';
    if (/^(organic|seo)$/.test(m)) return 'organic_search';
    if (m === 'referral') return 'referral';
    if (hostMatches(s, SEARCH_HOSTS) || hostMatches(r, SEARCH_HOSTS)) return 'organic_search';
    if (hostMatches(s, SOCIAL_HOSTS) || hostMatches(r, SOCIAL_HOSTS)) return 'organic_social';
    if (!['direct', 'internal'].includes(r)) return 'referral';
    return 'direct';
  }

  function touch() {
    const params = new URLSearchParams(window.location.search || '');
    const utmSource = clean(params.get('utm_source'), 100);
    const utmMedium = clean(params.get('utm_medium'), 80);
    const referrerDomain = externalReferrer();
    return {
      channel: classifyChannel(utmMedium, utmSource, referrerDomain),
      referrerDomain,
      landingPath: safePath(window.location.href),
      utmSource,
      utmMedium,
      utmCampaign: clean(params.get('utm_campaign'), 120),
      utmContent: clean(params.get('utm_content'), 120),
      utmTerm: clean(params.get('utm_term'), 120),
      capturedAt: new Date().toISOString(),
    };
  }

  function readAttribution() {
    try {
      const value = JSON.parse(localStorage.getItem(ATTRIBUTION_KEY) || 'null');
      const capturedAt = Date.parse(value?.first?.capturedAt || 0);
      if (!capturedAt || Date.now() - capturedAt > ATTRIBUTION_TTL_MS) return null;
      return value;
    } catch (_error) {
      return null;
    }
  }

  function captureAttribution() {
    if (!hasAnalyticsConsent()) return readAttribution();
    const next = touch();
    const existing = readAttribution();
    const value = existing || { first: next, last: next };
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
      localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(value));
    } catch (_error) {
      // Storage is best-effort in restricted privacy modes.
    }
    return value;
  }

  function attributionProperties() {
    const value = captureAttribution();
    if (!value) return { attribution_available: false };
    const first = value.first || {};
    const last = value.last || {};
    return {
      attribution_available: true,
      first_channel: clean(first.channel, 40),
      first_referrer_domain: domain(first.referrerDomain),
      first_landing_path: safePath(first.landingPath),
      first_utm_source: clean(first.utmSource, 100),
      first_utm_medium: clean(first.utmMedium, 80),
      first_utm_campaign: clean(first.utmCampaign, 120),
      last_channel: clean(last.channel, 40),
      last_referrer_domain: domain(last.referrerDomain),
      last_landing_path: safePath(last.landingPath),
      last_utm_source: clean(last.utmSource, 100),
      last_utm_medium: clean(last.utmMedium, 80),
      last_utm_campaign: clean(last.utmCampaign, 120),
    };
  }

  function sanitizePostHogEvent(event) {
    const scrub = properties => {
      if (!properties || typeof properties !== 'object') return;
      POSTHOG_URL_KEYS.forEach(key => {
        if (typeof properties[key] === 'string') {
          properties[key] = properties[key].split(/[?#]/, 1)[0];
        }
      });
    };
    scrub(event?.properties);
    scrub(event?.$set);
    scrub(event?.$set_once);
    return event;
  }

  function runBeforeSendHooks(hooks, event) {
    const handlers = Array.isArray(hooks) ? hooks : typeof hooks === 'function' ? [hooks] : [];
    return handlers.reduce((result, handler) => (result ? handler(result) : result), event);
  }

  function privacyConfig(config) {
    const source = config && typeof config === 'object' ? config : {};
    const existingBeforeSend = source.before_send;
    return {
      ...source,
      person_profiles: 'identified_only',
      mask_personal_data_properties: true,
      disable_capture_url_hashes: true,
      before_send(event) {
        let result = event;
        try {
          result = runBeforeSendHooks(existingBeforeSend, result);
        } catch (_error) {
          // Third-party hooks must not bypass the final sanitiser.
        }
        return result ? sanitizePostHogEvent(result) : result;
      },
    };
  }

  function installSensitivePageConsentGuard() {
    if (
      !pathMatches(CONSENT_GUARD_PATHS) ||
      !window.CookieConsent ||
      typeof window.CookieConsent.getConsent !== 'function' ||
      window.CookieConsent.getConsent.__efSensitiveGuard
    ) {
      return;
    }
    const original = window.CookieConsent.getConsent.bind(window.CookieConsent);
    const guarded = function () {
      return { ...(original() || {}), essential: true, analytics: false };
    };
    guarded.__efSensitiveGuard = true;
    window.CookieConsent.getConsent = guarded;
  }

  function installPostHogStub() {
    if (window.posthog?.__SV) return;
    (function (doc, posthog) {
      window.posthog = posthog;
      posthog._i = [];
      posthog.init = function (token, config, name) {
        if (pathMatches(CONSENT_GUARD_PATHS) || posthog.__efInitQueued) return;
        posthog.__efInitQueued = true;
        const safeConfig = privacyConfig(config);
        const script = doc.createElement('script');
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.src = `${safeConfig.api_host.replace('.i.posthog.com', '-assets.i.posthog.com')}/static/array.js`;
        const firstScript = doc.getElementsByTagName('script')[0];
        firstScript.parentNode.insertBefore(script, firstScript);
        let instance = posthog;
        const instanceName = name || 'posthog';
        if (name) instance = posthog[name] = [];
        instance.people = instance.people || [];
        'capture identify reset opt_in_capturing opt_out_capturing startSessionRecording stopSessionRecording'
          .split(' ')
          .forEach(method => {
            instance[method] = function () {
              instance.push([method].concat(Array.prototype.slice.call(arguments)));
            };
          });
        posthog._i.push([token, safeConfig, instanceName]);
      };
      posthog.__SV = 1;
    })(document, window.posthog || []);
  }

  function identify(user, signupMethod) {
    if (!user?.id || user.role === 'admin' || typeof window.posthog?.identify !== 'function') return;
    window.posthog.identify(String(user.id), {
      role: clean(user.role, 40) || 'customer',
      signup_method: clean(signupMethod, 40) || undefined,
    });
  }

  function capturePostHog(name, properties) {
    if (!hasAnalyticsConsent() || typeof window.posthog?.capture !== 'function') return;
    try {
      window.posthog.capture(name, properties || {});
    } catch (_error) {
      // First-party analytics remains available if PostHog is blocked.
    }
  }

  async function initialisePostHog() {
    if (!hasAnalyticsConsent() || currentPath().startsWith('/admin')) return false;
    try {
      const response = await fetch('/api/v1/analytics/behaviour/config', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const config = response.ok ? await response.json() : null;
      const provider = config?.posthog;
      if (!provider?.enabled || !provider.projectKey) return false;
      installPostHogStub();
      const sensitive = pathMatches(SENSITIVE_PATHS);
      window.posthog.init(provider.projectKey, {
        api_host: provider.apiHost,
        ui_host: provider.uiHost,
        defaults: '2026-05-30',
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        person_profiles: 'identified_only',
        mask_personal_data_properties: true,
        disable_capture_url_hashes: true,
        before_send: sanitizePostHogEvent,
        opt_out_capturing_by_default: true,
        disable_session_recording: sensitive || !provider.sessionRecordingEnabled,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector:
            '.ph-sensitive, [data-analytics-sensitive], .message-content, .conversation-content, .email, #sensitive',
          maskCapturedNetworkRequestFn: request => {
            if (request?.name) request.name = request.name.split('?')[0];
            return request;
          },
        },
      });
      window.posthog.opt_in_capturing?.();
      if (!sensitive && provider.sessionRecordingEnabled) window.posthog.startSessionRecording?.();
      if (!sensitive) {
        capturePostHog('$pageview', {
          $current_url: `${window.location.origin}${currentPath()}`,
          $pathname: currentPath(),
          ...attributionProperties(),
        });
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function identifyCurrentUser() {
    try {
      const response = await fetch('/api/v1/auth/me', {
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = response.ok ? await response.json() : null;
      const user = payload?.user || null;
      if (!user || user.role === 'admin') return;
      identify(user);
      if (sessionStorage.getItem(GOOGLE_SIGNUP_PENDING_KEY) === '1') {
        capturePostHog('registration_completed', {
          conversion_type: 'registration',
          signup_method: 'google',
          user_role: clean(user.role, 40),
          ...attributionProperties(),
        });
        sessionStorage.removeItem(GOOGLE_SIGNUP_PENDING_KEY);
      }
    } catch (_error) {
      // Anonymous users and blocked requests need no action.
    }
  }

  function normalizedRequest(input, options) {
    let url = '';
    let method = options?.method || 'GET';
    try {
      if (typeof input === 'string' || input instanceof URL) {
        url = new URL(input, window.location.href).pathname;
      } else if (input?.url) {
        url = new URL(input.url, window.location.href).pathname;
        method = input.method || method;
      }
    } catch (_error) {
      url = '';
    }
    return { url, method: String(method).toUpperCase() };
  }

  async function handleSuccess(request, response) {
    if (!response?.ok) return;
    const register =
      request.method === 'POST' && /^\/api\/(?:v1\/)?auth\/register\/?$/.test(request.url);
    const login =
      request.method === 'POST' && /^\/api\/(?:v1\/)?auth\/login\/?$/.test(request.url);
    if (!register && !login) return;
    let payload = null;
    try {
      payload = await response.clone().json();
    } catch (_error) {
      return;
    }
    if (payload?.user) identify(payload.user, register ? 'email_password' : undefined);
    if (register) {
      const properties = {
        conversion_type: 'registration',
        signup_method: 'email_password',
        user_role: clean(payload?.user?.role, 40) || 'customer',
        ...attributionProperties(),
      };
      capturePostHog('registration_completed', properties);
      window.EFAnalytics?.track?.('registration_completed', {
        conversionType: 'registration',
        source: properties.first_channel || 'unknown',
      });
      window.EFAnalytics?.flush?.();
    }
  }

  function installFetchObserver() {
    if (typeof window.fetch !== 'function' || window.fetch[FETCH_WRAPPED_FLAG]) return;
    const original = window.fetch.bind(window);
    const wrapped = function (input, options) {
      const request = normalizedRequest(input, options);
      return original(input, options).then(response => {
        handleSuccess(request, response).catch(() => {});
        return response;
      });
    };
    wrapped[FETCH_WRAPPED_FLAG] = true;
    window.fetch = wrapped;
  }

  function writeFullConsent() {
    const value = encodeURIComponent(
      JSON.stringify({ v: 1, essential: true, functional: true, analytics: true })
    );
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE_NAME}=${value}; expires=${expires}; path=/; SameSite=Lax${secure}`;
    window.dispatchEvent(
      new CustomEvent('cookieConsentChanged', {
        detail: { accepted: true, essential: true, functional: true, analytics: true },
      })
    );
  }

  function upgradeConsentCopy(root) {
    const scope = root?.querySelectorAll ? root : document;
    scope.querySelectorAll('.cookie-consent-message p').forEach(element => {
      if (element.textContent?.includes('functional cookies')) {
        element.textContent =
          'We use essential cookies to make our site work. With your consent, analytics helps us understand visits, signup sources and improve EventFlow. You can change these choices at any time.';
      }
    });
  }

  installSensitivePageConsentGuard();
  installPostHogStub();

  document.addEventListener(
    'click',
    event => {
      const accept = event.target?.closest?.('#cookie-consent-accept, #cookie-prefs-accept-all');
      if (accept) {
        event.preventDefault();
        event.stopImmediatePropagation();
        writeFullConsent();
        const banner = accept.closest('#cookie-consent-banner');
        const dialog = accept.closest('#cookie-prefs-dialog');
        if (banner?.parentNode) banner.parentNode.removeChild(banner);
        else banner?.remove?.();
        if (dialog?.parentNode) dialog.parentNode.removeChild(dialog);
        else dialog?.remove?.();
      }
      if (event.target?.closest?.('#google-signup-button')) {
        try {
          sessionStorage.setItem(GOOGLE_SIGNUP_PENDING_KEY, '1');
        } catch (_error) {
          // Session attribution is best-effort.
        }
      }
    },
    true
  );

  window.EventFlowAttribution = {
    capture: captureAttribution,
    get: readAttribution,
    properties: attributionProperties,
  };

  function start() {
    upgradeConsentCopy(document);
    installFetchObserver();
    captureAttribution();
    initialisePostHog().then(identifyCurrentUser);
  }

  window.addEventListener('cookieConsentChanged', event => {
    if (event.detail?.analytics === true) start();
    else window.posthog?.opt_out_capturing?.();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
