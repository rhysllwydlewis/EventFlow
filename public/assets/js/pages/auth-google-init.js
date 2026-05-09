(function () {
  'use strict';

  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const GOOGLE_LOGIN_PATH = '/api/auth/callback/google';
  const PRODUCTION_ORIGIN = 'https://event-flow.co.uk';

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

  function getGoogleAuthContext() {
    const explicitContext = window.__eventflowGoogleAuthContext;
    if (explicitContext === 'signup' || explicitContext === 'signin') {
      return explicitContext;
    }

    const createPanel = document.getElementById('panel-create');
    const createTab = document.getElementById('tab-create');
    const createPanelActive = createPanel && createPanel.hidden === false;
    const createTabActive = createTab && createTab.getAttribute('aria-selected') === 'true';
    const query = new URLSearchParams(window.location.search);

    if (
      createPanelActive ||
      createTabActive ||
      window.location.hash === '#create' ||
      query.get('tab') === 'create'
    ) {
      return 'signup';
    }

    return 'signin';
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
    } catch (_) {
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
      !redirect.includes('\\')
    ) {
      return redirect;
    }
    return '';
  }

  function getGoogleButtonState(context) {
    const params = new URLSearchParams(window.location.search);
    const state = {
      context: context === 'signup' ? 'signup' : 'signin',
      returnTo: getSafeReturnPath(),
      plan: params.get('plan') || '',
    };
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

  async function initGoogleAuth() {
    showGoogleRedirectErrorFromQuery();

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
    } catch (_) {
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
    } catch (_) {
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
      width: Math.min(360, signInContainer?.offsetWidth || signUpContainer?.offsetWidth || 320),
      shape: 'pill',
    };

    if (signInContainer) {
      ['pointerenter', 'pointerdown', 'touchstart', 'click', 'focusin'].forEach(eventName => {
        signInContainer.addEventListener(eventName, () => {
          setGoogleAuthContext('signin');
        });
      });
      window.google.accounts.id.renderButton(signInContainer, {
        ...renderOptions,
        text: 'signin_with',
        state: getGoogleButtonState('signin'),
      });
      signInContainer.classList.add('is-ready');
    }

    if (signUpContainer) {
      ['pointerenter', 'pointerdown', 'touchstart', 'click', 'focusin'].forEach(eventName => {
        signUpContainer.addEventListener(eventName, () => {
          setGoogleAuthContext('signup');
        });
      });
      window.google.accounts.id.renderButton(signUpContainer, {
        ...renderOptions,
        text: 'signup_with',
        state: getGoogleButtonState('signup'),
      });
      signUpContainer.classList.add('is-ready');
    }

    setGoogleButtonsBusy(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGoogleAuth);
  } else {
    initGoogleAuth();
  }
})();
