(function () {
  'use strict';

  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const ROLE_POLISH_CSS = '/assets/css/auth-google-signup.css?v=18.4.2';
  const GOOGLE_LOGIN_PATH = '/api/auth/callback/google';
  const PRODUCTION_ORIGIN = 'https://event-flow.co.uk';
  const GOOGLE_SIGNUP_RERENDER_DELAY = 160;
  const GOOGLE_BUTTON_MIN_WIDTH = 220;
  const GOOGLE_BUTTON_MAX_WIDTH = 320;

  function getGoogleLoginUri() {
    const origin =
      window.location.hostname === 'event-flow.co.uk' ? window.location.origin : PRODUCTION_ORIGIN;
    return `${origin}${GOOGLE_LOGIN_PATH}`;
  }

  function setStatus(message, type) {
    const status = document.getElementById('auth-status');
    if (!status) {
      return;
    }

    const statusType = type || 'info';
    status.textContent = message || '';
    status.dataset.type = statusType;
    status.classList.remove(
      'is-visible',
      'is-info',
      'is-success',
      'is-warning',
      'is-error',
      'auth-status--2fa'
    );
    status.style.display = '';

    if (message) {
      status.classList.add('is-visible', `is-${statusType}`);
    }
  }

  function setGoogleButtonsBusy(isBusy) {
    document.querySelectorAll('.auth-google-button').forEach(el => {
      if (isBusy) {
        el.classList.add('is-loading');
        el.setAttribute('aria-busy', 'true');
      } else {
        el.classList.remove('is-loading');
        el.removeAttribute('aria-busy');
      }
    });
  }

  function showGoogleUnavailable(message) {
    setGoogleButtonsBusy(false);
    const fallback = message || 'Google sign-in not configured. Please use email login for now.';
    document.querySelectorAll('.auth-google-button').forEach(el => {
      el.classList.add('auth-google-button--unavailable');
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.textContent = fallback;
    });
    setStatus(fallback, 'warning');
  }

  function setGoogleAuthContext(context) {
    if (context === 'signup' || context === 'signin') {
      window.__eventflowGoogleAuthContext = context;
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
      redirect?.startsWith('/') &&
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

  function getGoogleButtonState(context) {
    const params = new URLSearchParams(window.location.search);
    const normalizedContext = context === 'signup' ? 'signup' : 'signin';
    const state = {
      context: normalizedContext,
      returnTo: getSafeReturnPath(),
      plan: params.get('plan') || '',
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

    return encodeState(state);
  }

  function showGoogleRedirectErrorFromQuery() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'error') {
      setStatus(
        'Google sign-in could not be completed. Please try again or use email login.',
        'error'
      );
    }
    if (params.get('google') === 'callback_requires_post') {
      setStatus(
        'Google sign-in callback must be opened by Google. Please use the sign-in button.',
        'warning'
      );
    }
    if (params.get('google') === '2fa_required') {
      setStatus(
        'This Google-linked account requires two-factor login. Please use email login to complete 2FA.',
        'warning'
      );
    }
  }

  function loadGoogleScript() {
    if (window.google?.accounts?.id) {
      return Promise.resolve();
    }

    if (window.__eventflowGoogleScriptPromise) {
      return window.__eventflowGoogleScriptPromise;
    }

    window.__eventflowGoogleScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
      const script = existing || document.createElement('script');
      const timeout = setTimeout(() => {
        reject(new Error('Google Identity Services script timed out'));
      }, 8000);

      const handleLoad = () => {
        clearTimeout(timeout);
        resolve();
      };
      const handleError = () => {
        clearTimeout(timeout);
        reject(new Error('Google Identity Services script failed to load'));
      };

      script.addEventListener('load', handleLoad, { once: true });
      script.addEventListener('error', handleError, { once: true });

      if (!existing) {
        script.src = GIS_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    }).finally(() => {
      window.__eventflowGoogleScriptPromise = null;
    });

    return window.__eventflowGoogleScriptPromise;
  }

  function ensureRolePolishStylesheet() {
    if (document.querySelector(`link[href="${ROLE_POLISH_CSS}"]`)) {
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = ROLE_POLISH_CSS;
    document.head.appendChild(link);
  }

  function syncRolePickerState() {
    const rolePicker = document.querySelector('.auth-role-picker, .role-toggle');
    const role = getSelectedSignupRole();
    const roleInput = document.getElementById('reg-role');
    const supplierFields = document.getElementById('supplier-fields');

    if (roleInput) {
      roleInput.value = role;
    }
    if (supplierFields) {
      supplierFields.style.display = role === 'supplier' ? '' : 'none';
    }
    if (rolePicker) {
      rolePicker.classList.toggle('is-customer-selected', role === 'customer');
      rolePicker.classList.toggle('is-supplier-selected', role === 'supplier');
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

  function syncSignupGoogleReadiness(showMessage) {
    syncRolePickerState();

    const signUpContainer = document.getElementById('google-signup-button');
    const note = document.querySelector('#panel-create .auth-google-note');
    const readiness = getSupplierReadiness();

    if (signUpContainer) {
      signUpContainer.classList.toggle('auth-google-button--disabled', !readiness.ready);
      signUpContainer.setAttribute('aria-disabled', readiness.ready ? 'false' : 'true');
    }

    if (note) {
      note.classList.remove('is-ready', 'is-warning');
      if (readiness.role === 'supplier') {
        if (readiness.ready) {
          note.textContent =
            'Supplier Google signup is ready — we’ll create your supplier account and send you to the supplier dashboard.';
          note.classList.add('is-ready');
        } else {
          note.textContent = `Supplier Google signup needs your ${readiness.missing.join(' and ')} before continuing.`;
          note.classList.add('is-warning');
        }
      } else {
        note.textContent =
          'Creating a customer account with Google is quick and free. Choose Supplier first if you are registering a business.';
      }
    }

    if (!readiness.ready && showMessage) {
      setStatus(
        `Please add your ${readiness.missing.join(' and ')} before continuing with Google as a supplier.`,
        'warning'
      );
    }

    return readiness.ready;
  }

  function getVisibleWidth(element) {
    if (!element) {
      return 0;
    }

    const rectWidth = Math.floor(element.getBoundingClientRect?.().width || 0);
    return rectWidth || Math.floor(element.clientWidth || element.offsetWidth || 0);
  }

  function getContentWidth(element) {
    const width = getVisibleWidth(element);
    if (!width || typeof window.getComputedStyle !== 'function') {
      return width;
    }

    const styles = window.getComputedStyle(element);
    const horizontalInsets =
      (Number.parseFloat(styles.paddingLeft || '0') || 0) +
      (Number.parseFloat(styles.paddingRight || '0') || 0) +
      (Number.parseFloat(styles.borderLeftWidth || '0') || 0) +
      (Number.parseFloat(styles.borderRightWidth || '0') || 0);
    return Math.max(0, Math.floor(width - horizontalInsets));
  }

  function getGoogleButtonWidth(container) {
    const googleBlock = container.closest('.auth-google');
    const card = container.closest('.auth-card');
    const measuredWidth = [getContentWidth(googleBlock), getContentWidth(card)].find(
      width => width > 0
    );
    const availableWidth = Math.max(
      GOOGLE_BUTTON_MIN_WIDTH,
      measuredWidth || GOOGLE_BUTTON_MAX_WIDTH
    );

    return Math.min(GOOGLE_BUTTON_MAX_WIDTH, availableWidth);
  }

  function renderGoogleButton(container, context, baseRenderOptions) {
    if (!container || !window.google?.accounts?.id) {
      return;
    }

    const buttonWidth = getGoogleButtonWidth(container);

    container.innerHTML = '';
    container.style.width = `${buttonWidth}px`;
    container.style.maxWidth = '100%';
    window.google.accounts.id.renderButton(container, {
      ...baseRenderOptions,
      width: buttonWidth,
      text: context === 'signup' ? 'signup_with' : 'signin_with',
      state: getGoogleButtonState(context),
    });
    container.classList.add('is-ready');
    document.dispatchEvent(
      new CustomEvent('eventflow:google-button-rendered', { detail: { context, buttonWidth } })
    );
  }

  function isGoogleContainerVisible(container) {
    const panel = container?.closest('.auth-tab-panel');
    return Boolean(container && (!panel || !panel.hidden));
  }

  function rerenderVisibleGoogleButtons(signInContainer, signUpContainer, renderOptions) {
    if (signInContainer && isGoogleContainerVisible(signInContainer)) {
      renderGoogleButton(signInContainer, 'signin', renderOptions);
    }

    if (signUpContainer && isGoogleContainerVisible(signUpContainer)) {
      syncSignupGoogleReadiness(false);
      renderGoogleButton(signUpContainer, 'signup', renderOptions);
      syncSignupGoogleReadiness(false);
    }
  }

  async function initGoogleAuth() {
    showGoogleRedirectErrorFromQuery();
    ensureRolePolishStylesheet();
    syncSignupGoogleReadiness(false);

    const signInContainer = document.getElementById('google-signin-button');
    const signUpContainer = document.getElementById('google-signup-button');
    if (!signInContainer && !signUpContainer) {
      return;
    }

    setGoogleButtonsBusy(true);

    let config = {};
    try {
      const res = await fetch('/api/v1/config?googleAuth=1', {
        credentials: 'include',
        cache: 'no-store',
      });
      config = await res.json();
    } catch {
      setGoogleButtonsBusy(false);
      setStatus('Google sign-in configuration could not be loaded.', 'error');
      return;
    }

    if (!config.googleClientId) {
      showGoogleUnavailable('Google sign-in not configured. Please use email login for now.');
      return;
    }

    try {
      await loadGoogleScript();
    } catch {
      setGoogleButtonsBusy(false);
      setStatus('Google sign-in could not be loaded. Please refresh and try again.', 'error');
      return;
    }

    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      setGoogleButtonsBusy(false);
      setStatus('Google sign-in is unavailable in this browser.', 'error');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      login_uri: getGoogleLoginUri(),
      ux_mode: 'redirect',
      use_fedcm_for_prompt: false,
      use_fedcm_for_button: false,
    });

    const renderOptions = {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
    };

    if (signInContainer) {
      ['pointerenter', 'pointerdown', 'touchstart', 'click', 'focusin'].forEach(eventName => {
        signInContainer.addEventListener(eventName, () => {
          setGoogleAuthContext('signin');
        });
      });
      renderGoogleButton(signInContainer, 'signin', renderOptions);
    }

    if (signUpContainer) {
      let rerenderTimer = null;
      const rerenderSignupButton = () => {
        window.clearTimeout(rerenderTimer);
        rerenderTimer = window.setTimeout(() => {
          syncSignupGoogleReadiness(false);
          renderGoogleButton(signUpContainer, 'signup', renderOptions);
          syncSignupGoogleReadiness(false);
        }, GOOGLE_SIGNUP_RERENDER_DELAY);
      };

      ['pointerenter', 'pointerdown', 'touchstart', 'click', 'focusin'].forEach(eventName => {
        signUpContainer.addEventListener(eventName, event => {
          setGoogleAuthContext('signup');
          if (!syncSignupGoogleReadiness(true)) {
            event.preventDefault();
            event.stopPropagation();
          }
        });
      });

      document
        .querySelectorAll(
          '#reg-role, #reg-location, #reg-postcode, #reg-company, #reg-jobtitle, #reg-website, #reg-instagram, #reg-facebook, #reg-twitter, #reg-linkedin'
        )
        .forEach(el => {
          el.addEventListener('input', rerenderSignupButton);
          el.addEventListener('change', rerenderSignupButton);
        });

      document
        .querySelectorAll('.auth-role-picker [data-role], .role-toggle [data-role]')
        .forEach(btn => {
          btn.addEventListener('click', () => {
            window.setTimeout(rerenderSignupButton, 0);
          });
        });

      if (isGoogleContainerVisible(signUpContainer)) {
        renderGoogleButton(signUpContainer, 'signup', renderOptions);
      }
      syncSignupGoogleReadiness(false);
    }

    let layoutSyncTimer = null;
    const scheduleGoogleLayoutSync = () => {
      window.clearTimeout(layoutSyncTimer);
      layoutSyncTimer = window.setTimeout(() => {
        window.requestAnimationFrame(() => {
          rerenderVisibleGoogleButtons(signInContainer, signUpContainer, renderOptions);
        });
      }, 80);
    };

    document.addEventListener('eventflow:auth-tab-change', scheduleGoogleLayoutSync);
    window.addEventListener('resize', scheduleGoogleLayoutSync, { passive: true });
    setGoogleButtonsBusy(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGoogleAuth);
  } else {
    initGoogleAuth();
  }
})();
