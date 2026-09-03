'use strict';
(function () {
  // Keep in sync with GRAPH_API_VERSION in services/facebookAuth.service.js.
  const FACEBOOK_OAUTH_DIALOG = 'https://www.facebook.com/v23.0/dialog/oauth';
  const FACEBOOK_LOGIN_PATH = '/api/auth/callback/facebook';
  const FACEBOOK_CSRF_PATH = '/api/auth/facebook/csrf';
  const PRODUCTION_ORIGIN = 'https://event-flow.co.uk';

  function getFacebookLoginUri() {
    const origin =
      window.location.hostname === 'event-flow.co.uk' ? window.location.origin : PRODUCTION_ORIGIN;
    return `${origin}${FACEBOOK_LOGIN_PATH}`;
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

  function hasControlCharacter(value) {
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code <= 0x1f || code === 0x7f) {
        return true;
      }
    }
    return false;
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

  function syncFacebookSignupButtonReadiness() {
    const button = document.getElementById('facebook-signup-button');
    if (!button) {
      return;
    }
    const readiness = getSupplierReadiness();
    button.classList.toggle('auth-facebook-button--disabled', !readiness.ready);
    button.setAttribute('aria-disabled', readiness.ready ? 'false' : 'true');
  }

  function buildFacebookState(context, csrf) {
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

  function showFacebookRedirectErrorFromQuery() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('facebook') !== 'error') {
      if (params.get('facebook') === '2fa_required') {
        setStatus(
          'This Facebook-linked account requires two-factor login. Please use email login to complete 2FA.',
          'warning'
        );
      }
      return;
    }

    const reason = params.get('reason') || '';
    if (reason === 'user_denied') {
      setStatus('Facebook sign-in was cancelled.', 'info');
      return;
    }
    if (reason === 'facebook_403') {
      setStatus(
        'Facebook did not share an email address. Please allow email access on Facebook, or use another sign-in method.',
        'warning'
      );
      return;
    }
    setStatus(
      'Facebook sign-in could not be completed. Please try again or use email login.',
      'error'
    );
  }

  async function fetchFacebookCsrf() {
    const res = await fetch(FACEBOOK_CSRF_PATH, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error('Failed to obtain Facebook sign-in CSRF token');
    }
    const data = await res.json();
    if (!data || !data.csrf) {
      throw new Error('Facebook sign-in CSRF token missing from response');
    }
    return data.csrf;
  }

  function bindFacebookButton(button, appId, context) {
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
            `Please add your ${readiness.missing.join(' and ')} before continuing with Facebook as a supplier.`,
            'warning'
          );
          return;
        }
      }

      button.setAttribute('aria-busy', 'true');
      setStatus('', 'info');

      try {
        const csrf = await fetchFacebookCsrf();
        const state = buildFacebookState(context, csrf);
        const params = new URLSearchParams({
          client_id: appId,
          redirect_uri: getFacebookLoginUri(),
          state: encodeState(state),
          scope: 'email',
          response_type: 'code',
        });
        window.location.href = `${FACEBOOK_OAUTH_DIALOG}?${params.toString()}`;
      } catch {
        button.removeAttribute('aria-busy');
        setStatus(
          'Facebook sign-in could not be started. Please try again or use email login.',
          'error'
        );
      }
    });
  }

  async function initFacebookAuth() {
    showFacebookRedirectErrorFromQuery();

    const signInWrap = document.getElementById('facebook-signin-wrap');
    const signUpWrap = document.getElementById('facebook-signup-wrap');
    if (!signInWrap && !signUpWrap) {
      return;
    }

    let config = {};
    try {
      const res = await fetch('/api/v1/config?facebookAuth=1', {
        credentials: 'include',
        cache: 'no-store',
      });
      config = await res.json();
    } catch {
      return;
    }

    if (!config.facebookAppId) {
      return;
    }

    if (signInWrap) {
      signInWrap.hidden = false;
      bindFacebookButton(
        document.getElementById('facebook-signin-button'),
        config.facebookAppId,
        'signin'
      );
    }

    if (signUpWrap) {
      signUpWrap.hidden = false;
      bindFacebookButton(
        document.getElementById('facebook-signup-button'),
        config.facebookAppId,
        'signup'
      );
      syncFacebookSignupButtonReadiness();

      document
        .querySelectorAll(
          '#reg-role, #reg-location, #reg-postcode, #reg-company, #reg-jobtitle, #reg-website, #reg-instagram, #reg-facebook, #reg-twitter, #reg-linkedin'
        )
        .forEach(el => {
          el.addEventListener('input', syncFacebookSignupButtonReadiness);
          el.addEventListener('change', syncFacebookSignupButtonReadiness);
        });

      document
        .querySelectorAll('.auth-role-picker [data-role], .role-toggle [data-role]')
        .forEach(btn => {
          btn.addEventListener('click', () => {
            window.setTimeout(syncFacebookSignupButtonReadiness, 0);
          });
        });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFacebookAuth);
  } else {
    initFacebookAuth();
  }
})();
