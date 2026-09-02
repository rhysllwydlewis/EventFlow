'use strict';
(function () {
  // Sign in with Apple requires a paid Apple Developer Program membership
  // (£79/$99 per year) to enrol a Services ID. The integration is fully built
  // and left in place, but is switched off here until that enrolment happens.
  // To re-enable: set this to true and configure APPLE_CLIENT_ID (see
  // docs/APPLE_SIGN_IN_WITH_APPLE.md).
  const APPLE_SIGNIN_ENABLED = false;

  const APPLE_JS_SRC =
    'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
  const APPLE_LOGIN_PATH = '/api/auth/callback/apple';
  const APPLE_NONCE_PATH = '/api/auth/apple/nonce';
  const PRODUCTION_ORIGIN = 'https://event-flow.co.uk';

  function getAppleLoginUri() {
    const origin =
      window.location.hostname === 'event-flow.co.uk' ? window.location.origin : PRODUCTION_ORIGIN;
    return `${origin}${APPLE_LOGIN_PATH}`;
  }

  function setStatus(message, type) {
    const status = document.getElementById('auth-status');
    if (!status) {
      return;
    }

    const statusType = type || 'info';
    status.textContent = message || '';
    status.dataset.type = statusType;
    status.classList.remove('is-visible', 'is-info', 'is-success', 'is-warning', 'is-error');
    status.style.display = '';

    if (message) {
      status.classList.add('is-visible', `is-${statusType}`);
    }
  }

  function encodeState(payload) {
    try {
      const json = JSON.stringify(payload || {});
      return btoa(unescape(encodeURIComponent(json)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
    } catch {
      return '';
    }
  }

  function hasControlCharacter(value) {
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code <= 0x1f || code === 0x7f) {
        return true;
      }
    }
    return false;
  }

  function getSafeReturnPath() {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect') || params.get('return') || '';
    if (
      redirect &&
      redirect.startsWith('/') &&
      !redirect.startsWith('//') &&
      !redirect.includes('\\') &&
      !hasControlCharacter(redirect)
    ) {
      return redirect;
    }
    return '';
  }

  function cleanValue(value, maxLength) {
    return String(value || '')
      .trim()
      .slice(0, maxLength || 120);
  }

  function getInputValue(id, maxLength) {
    const el = document.getElementById(id);
    return cleanValue(el?.value, maxLength);
  }

  function getSelectedSignupRole() {
    const roleInput = document.getElementById('reg-role');
    if (roleInput?.value === 'supplier' || roleInput?.value === 'customer') {
      return roleInput.value;
    }

    const selectedRole = document.querySelector(
      '.auth-role-picker [aria-checked="true"][data-role], .role-toggle [aria-checked="true"][data-role]'
    );
    return selectedRole?.dataset.role === 'supplier' ? 'supplier' : 'customer';
  }

  function getSignupFormSnapshot() {
    const role = getSelectedSignupRole();
    const snapshot = {
      role,
      location: getInputValue('reg-location', 100),
      postcode: getInputValue('reg-postcode', 10),
      company: getInputValue('reg-company', 100),
      jobTitle: getInputValue('reg-jobtitle', 100),
      website: getInputValue('reg-website', 180),
      socials: {
        instagram: getInputValue('reg-instagram', 180),
        facebook: getInputValue('reg-facebook', 180),
        twitter: getInputValue('reg-twitter', 180),
        linkedin: getInputValue('reg-linkedin', 180),
      },
    };

    const params = new URLSearchParams(window.location.search);
    const ref = cleanValue(params.get('ref') || params.get('partner') || '', 80);
    if (ref) {
      snapshot.ref = ref;
    }

    return snapshot;
  }

  function getConsentedAttributionState() {
    try {
      if (typeof window.EventFlowAttribution?.properties !== 'function') {
        return null;
      }
      const attribution = window.EventFlowAttribution.properties();
      return attribution?.attribution_available === true ? attribution : null;
    } catch {
      return null;
    }
  }

  function getAnalyticsSessionId() {
    try {
      return cleanValue(window.sessionStorage.getItem('ef_analytics_session_id'), 120);
    } catch {
      return '';
    }
  }

  function getSupplierReadiness() {
    const snapshot = getSignupFormSnapshot();
    if (snapshot.role !== 'supplier') {
      return { ready: true, role: snapshot.role, missing: [] };
    }

    const missing = [];
    if (!snapshot.location) {
      missing.push('location');
    }
    if (!snapshot.company) {
      missing.push('company name');
    }

    return { ready: missing.length === 0, role: snapshot.role, missing };
  }

  function syncAppleSignupButtonReadiness() {
    const button = document.getElementById('apple-signup-button');
    if (!button) {
      return;
    }
    const readiness = getSupplierReadiness();
    button.classList.toggle('auth-apple-button--disabled', !readiness.ready);
    button.setAttribute('aria-disabled', readiness.ready ? 'false' : 'true');
  }

  function buildAppleState(context, csrf) {
    const params = new URLSearchParams(window.location.search);
    const normalizedContext = context === 'signup' ? 'signup' : 'signin';
    const state = {
      context: normalizedContext,
      returnTo: getSafeReturnPath(),
      plan: params.get('plan') || '',
      csrf,
    };

    if (normalizedContext === 'signup') {
      Object.assign(state, getSignupFormSnapshot());
      const attribution = getConsentedAttributionState();
      const analyticsSessionId = getAnalyticsSessionId();
      if (attribution && analyticsSessionId) {
        state.attribution = attribution;
        state.analyticsSessionId = analyticsSessionId;
      }
      if (!state.returnTo) {
        state.returnTo = state.role === 'supplier' ? '/dashboard/supplier' : '/dashboard/customer';
      }
    }

    return state;
  }

  function showAppleRedirectErrorFromQuery() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('apple') !== 'error') {
      if (params.get('apple') === 'callback_requires_post') {
        setStatus(
          'Apple sign-in callback must be opened by Apple. Please use the sign-in button.',
          'warning'
        );
      }
      if (params.get('apple') === '2fa_required') {
        setStatus(
          'This Apple-linked account requires two-factor login. Please use email login to complete 2FA.',
          'warning'
        );
      }
      return;
    }

    const reason = params.get('reason') || '';
    if (reason === 'user_cancelled_authorize') {
      setStatus('Apple sign-in was cancelled.', 'info');
      return;
    }
    setStatus(
      'Apple sign-in could not be completed. Please try again or use email login.',
      'error'
    );
  }

  function loadAppleScript() {
    if (window.AppleID?.auth) {
      return Promise.resolve();
    }

    if (window.__eventflowAppleScriptPromise) {
      return window.__eventflowAppleScriptPromise;
    }

    window.__eventflowAppleScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${APPLE_JS_SRC}"]`);
      const script = existing || document.createElement('script');
      const timeout = setTimeout(() => {
        reject(new Error('Sign in with Apple script timed out'));
      }, 8000);

      const handleLoad = () => {
        clearTimeout(timeout);
        resolve();
      };
      const handleError = () => {
        clearTimeout(timeout);
        reject(new Error('Sign in with Apple script failed to load'));
      };

      script.addEventListener('load', handleLoad, { once: true });
      script.addEventListener('error', handleError, { once: true });

      if (!existing) {
        script.src = APPLE_JS_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    }).finally(() => {
      window.__eventflowAppleScriptPromise = null;
    });

    return window.__eventflowAppleScriptPromise;
  }

  async function fetchAppleNonce() {
    const res = await fetch(APPLE_NONCE_PATH, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error('Failed to obtain Apple sign-in nonce');
    }
    const data = await res.json();
    if (!data || !data.nonce) {
      throw new Error('Apple sign-in nonce missing from response');
    }
    return data.nonce;
  }

  function bindAppleButton(button, clientId, context) {
    if (!button) {
      return;
    }

    button.addEventListener('click', async () => {
      if (button.getAttribute('aria-busy') === 'true') {
        return;
      }

      if (context === 'signup') {
        const readiness = getSupplierReadiness();
        if (!readiness.ready) {
          setStatus(
            `Please add your ${readiness.missing.join(' and ')} before continuing with Apple as a supplier.`,
            'warning'
          );
          return;
        }
      }

      button.setAttribute('aria-busy', 'true');
      setStatus('', 'info');

      try {
        const nonce = await fetchAppleNonce();
        const state = buildAppleState(context, nonce);

        window.AppleID.auth.init({
          clientId,
          scope: 'name email',
          redirectURI: getAppleLoginUri(),
          state: encodeState(state),
          nonce,
          usePopup: false,
        });

        await window.AppleID.auth.signIn();
      } catch (error) {
        button.removeAttribute('aria-busy');
        setStatus(
          'Apple sign-in could not be started. Please try again or use email login.',
          'error'
        );
      }
    });
  }

  async function initAppleAuth() {
    if (!APPLE_SIGNIN_ENABLED) {
      return;
    }

    showAppleRedirectErrorFromQuery();

    const signInWrap = document.getElementById('apple-signin-wrap');
    const signUpWrap = document.getElementById('apple-signup-wrap');
    if (!signInWrap && !signUpWrap) {
      return;
    }

    let config = {};
    try {
      const res = await fetch('/api/v1/config?appleAuth=1', {
        credentials: 'include',
        cache: 'no-store',
      });
      config = await res.json();
    } catch {
      return;
    }

    if (!config.appleClientId) {
      return;
    }

    try {
      await loadAppleScript();
    } catch {
      return;
    }

    if (!window.AppleID?.auth) {
      return;
    }

    if (signInWrap) {
      signInWrap.hidden = false;
      bindAppleButton(
        document.getElementById('apple-signin-button'),
        config.appleClientId,
        'signin'
      );
    }

    if (signUpWrap) {
      signUpWrap.hidden = false;
      bindAppleButton(
        document.getElementById('apple-signup-button'),
        config.appleClientId,
        'signup'
      );
      syncAppleSignupButtonReadiness();

      document
        .querySelectorAll(
          '#reg-role, #reg-location, #reg-postcode, #reg-company, #reg-jobtitle, #reg-website, #reg-instagram, #reg-facebook, #reg-twitter, #reg-linkedin'
        )
        .forEach(el => {
          el.addEventListener('input', syncAppleSignupButtonReadiness);
          el.addEventListener('change', syncAppleSignupButtonReadiness);
        });

      document
        .querySelectorAll('.auth-role-picker [data-role], .role-toggle [data-role]')
        .forEach(btn => {
          btn.addEventListener('click', () => {
            window.setTimeout(syncAppleSignupButtonReadiness, 0);
          });
        });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAppleAuth);
  } else {
    initAppleAuth();
  }
})();
