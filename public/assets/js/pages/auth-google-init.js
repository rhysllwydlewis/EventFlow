(function () {
  'use strict';

  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const GOOGLE_CANCEL_MESSAGE = 'Google sign-in was cancelled. Please try again or use email login.';

  function readCookie(name) {
    return document.cookie
      .split('; ')
      .find(row => row.startsWith(`${name}=`))
      ?.split('=')
      .slice(1)
      .join('=');
  }

  async function ensureCsrfToken() {
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    const cookieToken = readCookie('csrf') || readCookie('csrfToken');
    if (cookieToken) {
      window.__CSRF_TOKEN__ = decodeURIComponent(cookieToken);
      return window.__CSRF_TOKEN__;
    }
    const response = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    window.__CSRF_TOKEN__ = data.csrfToken || data.token || '';
    return window.__CSRF_TOKEN__;
  }

  async function getCsrfHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    return headers;
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

  function defaultDestinationForRole(role) {
    if (role === 'admin') {
      return '/admin';
    }
    if (role === 'supplier') {
      return '/dashboard/supplier';
    }
    return '/dashboard/customer';
  }

  function getDestination(user) {
    const role = user && user.role;
    let destination = defaultDestinationForRole(role);
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect') || params.get('return');
    const plan = params.get('plan');

    if (
      redirect &&
      typeof window.validateRedirectForRole === 'function' &&
      window.validateRedirectForRole(redirect, role)
    ) {
      destination = redirect;
    }

    if (plan && !destination.includes('plan=')) {
      destination += `${destination.includes('?') ? '&' : '?'}plan=${encodeURIComponent(plan)}`;
    }
    return destination;
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

  function getSignupProfileFields() {
    const role = document.getElementById('reg-role')?.value || 'customer';
    const ref = new URLSearchParams(window.location.search).get('ref') || undefined;
    return {
      role,
      location: document.getElementById('reg-location')?.value?.trim() || undefined,
      postcode: document.getElementById('reg-postcode')?.value?.trim() || undefined,
      company: document.getElementById('reg-company')?.value?.trim() || undefined,
      jobTitle: document.getElementById('reg-jobtitle')?.value?.trim() || undefined,
      ref,
    };
  }

  function renderTwoFactorPrompt(tempToken) {
    const status = document.getElementById('auth-status');
    if (!status) {
      return;
    }

    status.dataset.type = 'info';
    status.classList.remove('is-error', 'is-success', 'is-warning');
    status.classList.add('is-visible', 'is-info', 'auth-status--2fa');
    status.style.display = '';
    status.innerHTML = '';

    const label = document.createElement('label');
    label.className = 'auth-label';
    label.htmlFor = 'google-2fa-code';
    label.textContent = 'Enter your two-factor code';

    const input = document.createElement('input');
    input.id = 'google-2fa-code';
    input.className = 'auth-input';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'one-time-code';
    input.placeholder = '123456 or backup code';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ef-btn ef-btn-primary auth-google-2fa-submit';
    button.textContent = 'Verify and continue';

    const message = document.createElement('span');
    message.className = 'small auth-google-2fa-message';
    message.setAttribute('role', 'status');

    const submit = async () => {
      const code = input.value.trim();
      if (!code) {
        message.textContent = 'Enter your authenticator code or backup code.';
        return;
      }

      button.disabled = true;
      button.textContent = 'Verifying…';
      message.textContent = '';

      try {
        const payload = { tempToken, remember: true };
        if (/^\d{6}$/.test(code)) {
          payload.token = code;
        } else {
          payload.backupCode = code;
        }

        const res = await fetch('/api/v1/auth/login-2fa', {
          method: 'POST',
          headers: await getCsrfHeaders(),
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          message.textContent = data.error || 'Invalid two-factor code. Please try again.';
          return;
        }

        message.textContent = 'Verified. Redirecting…';
        window.location.href = getDestination(data.user || {});
      } catch (error) {
        console.error('Google 2FA verification error', error);
        message.textContent = 'Network error while verifying your code. Please try again.';
      } finally {
        button.disabled = false;
        button.textContent = 'Verify and continue';
      }
    };

    button.addEventListener('click', submit);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });

    status.append(label, input, button, message);
    input.focus();
  }

  async function submitGoogleCredential(response, context) {
    if (!response || !response.credential) {
      setGoogleButtonsBusy(false);
      setStatus(GOOGLE_CANCEL_MESSAGE, 'warning');
      return;
    }

    setGoogleButtonsBusy(true);
    setStatus('Signing in with Google…', 'info');

    const payload = {
      credential: response.credential,
      remember: true,
      ...(context === 'signup' ? getSignupProfileFields() : {}),
    };

    try {
      const res = await fetch('/api/v1/auth/google', {
        method: 'POST',
        headers: await getCsrfHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus(data.error || 'Google sign-in failed. Please try again.', 'error');
        return;
      }

      if (data.requires2FA) {
        renderTwoFactorPrompt(data.tempToken || '');
        return;
      }

      setStatus('Signed in with Google. Redirecting…', 'success');
      window.location.href = getDestination(data.user || {});
    } catch (error) {
      console.error('Google sign-in error', error);
      setStatus('Network error while signing in with Google. Please try again.', 'error');
    } finally {
      setGoogleButtonsBusy(false);
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
    const signInContainer = document.getElementById('google-signin-button');
    const signUpContainer = document.getElementById('google-signup-button');
    if (!signInContainer && !signUpContainer) {
      return;
    }

    setGoogleButtonsBusy(true);

    let config = {};
    try {
      const res = await fetch('/api/v1/config', { credentials: 'include' });
      config = await res.json();
    } catch (_) {
      setGoogleButtonsBusy(false);
      setStatus('Google sign-in configuration could not be loaded.', 'error');
      return;
    }

    if (!config.googleClientId) {
      setGoogleButtonsBusy(false);
      document.querySelectorAll('.auth-google').forEach(el => {
        el.hidden = true;
      });
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
      // Keep EventFlow on the Google Identity Services button flow. The app
      // receives an ID token in this callback and then POSTs it to
      // /api/v1/auth/google; it should not rely on /api/auth/callback/google.
      callback: response => submitGoogleCredential(response, getGoogleAuthContext()),
      ux_mode: 'popup',
      use_fedcm_for_prompt: false,
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
