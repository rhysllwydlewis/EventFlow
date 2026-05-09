(function () {
  'use strict';

  if (window.__eventflowGoogleAuthInitStarted) {
    return;
  }
  window.__eventflowGoogleAuthInitStarted = true;

  const GIS_SRC = 'https://accounts.google.com/gsi/client';

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
    status.textContent = message || '';
    status.dataset.type = type || 'info';
    status.style.display = message ? 'block' : 'none';
  }

  function createGoogleShell(id, label, includeSupplierNote) {
    const wrapper = document.createElement('div');
    wrapper.className = 'auth-google';

    const button = document.createElement('div');
    button.id = id;
    button.className = 'auth-google-button';
    button.setAttribute('aria-label', label);
    button.innerHTML =
      '<button type="button" class="auth-google-placeholder" disabled>Continue with Google</button>';
    wrapper.appendChild(button);

    if (includeSupplierNote) {
      const note = document.createElement('p');
      note.className = 'auth-google-note small';
      note.textContent =
        'For supplier accounts, choose Supplier and fill in the business fields before using Google.';
      wrapper.appendChild(note);
    }

    const divider = document.createElement('div');
    divider.className = 'auth-divider';
    divider.innerHTML = '<span>or use email</span>';
    wrapper.appendChild(divider);
    return wrapper;
  }

  function insertBeforeFirstField(form, shell) {
    if (!form) {
      return;
    }
    const loadingOverlay = form.querySelector('.auth-loading-overlay');
    const target = loadingOverlay ? loadingOverlay.nextSibling : form.firstChild;
    form.insertBefore(shell, target);
  }

  function ensureGoogleContainers() {
    if (!document.getElementById('google-signin-button')) {
      insertBeforeFirstField(
        document.getElementById('login-form'),
        createGoogleShell('google-signin-button', 'Sign in with Google', false)
      );
    }

    if (!document.getElementById('google-signup-button')) {
      insertBeforeFirstField(
        document.getElementById('register-form'),
        createGoogleShell('google-signup-button', 'Sign up with Google', true)
      );
    }
  }

  function renderGoogleUnavailable(message) {
    document.querySelectorAll('.auth-google-button').forEach(container => {
      container.innerHTML = '';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'auth-google-placeholder auth-google-placeholder--unavailable';
      button.disabled = true;
      button.textContent = message || 'Google sign-in unavailable';
      container.appendChild(button);
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
    status.style.display = 'block';
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
      setStatus('Google did not return a sign-in credential. Please try again.', 'error');
      return;
    }

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
    }
  }

  function loadGoogleScript() {
    if (document.querySelector(`script[src="${GIS_SRC}"]`)) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function initGoogleAuth() {
    ensureGoogleContainers();

    const signInContainer = document.getElementById('google-signin-button');
    const signUpContainer = document.getElementById('google-signup-button');
    if (!signInContainer && !signUpContainer) {
      return;
    }

    let config = {};
    try {
      const res = await fetch(`/api/v1/config?googleAuth=1&_=${Date.now()}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      config = await res.json();
    } catch (_) {
      setStatus('Google sign-in configuration could not be loaded.', 'error');
      return;
    }

    if (!config.googleClientId) {
      renderGoogleUnavailable('Google sign-in not configured');
      setStatus('Google sign-in is not configured yet. Please contact EventFlow support.', 'error');
      return;
    }

    try {
      await loadGoogleScript();
    } catch (_) {
      renderGoogleUnavailable('Google sign-in unavailable');
      setStatus('Google sign-in could not be loaded. Please refresh and try again.', 'error');
      return;
    }

    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      renderGoogleUnavailable('Google sign-in unavailable');
      setStatus('Google sign-in is unavailable in this browser.', 'error');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: response =>
        submitGoogleCredential(response, window.__eventflowGoogleAuthContext || 'signin'),
      use_fedcm_for_prompt: true,
    });

    const renderOptions = {
      theme: 'outline',
      size: 'large',
      width: Math.min(360, signInContainer?.offsetWidth || signUpContainer?.offsetWidth || 320),
      shape: 'pill',
    };

    if (signInContainer) {
      signInContainer.innerHTML = '';
      ['pointerdown', 'click', 'focusin'].forEach(eventName => {
        signInContainer.addEventListener(eventName, () => {
          window.__eventflowGoogleAuthContext = 'signin';
        });
      });
      window.google.accounts.id.renderButton(signInContainer, {
        ...renderOptions,
        text: 'signin_with',
      });
    }

    if (signUpContainer) {
      signUpContainer.innerHTML = '';
      ['pointerdown', 'click', 'focusin'].forEach(eventName => {
        signUpContainer.addEventListener(eventName, () => {
          window.__eventflowGoogleAuthContext = 'signup';
        });
      });
      window.google.accounts.id.renderButton(signUpContainer, {
        ...renderOptions,
        text: 'signup_with',
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGoogleAuth);
  } else {
    initGoogleAuth();
  }
})();
