/**
 * Partner Portal — entry page (login + signup).
 */
'use strict';
(function () {
  let csrfToken = '';
  let partnerCaptchaPayload = null;

  async function fetchCsrfToken() {
    if (csrfToken) {
      return csrfToken;
    }
    try {
      const response = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        csrfToken = data.csrfToken || data.token || '';
      }
    } catch (_) {
      // The submit handlers surface a useful network error if a later request fails.
    }
    return csrfToken;
  }

  function showStatus(element, message, type) {
    if (!element) {
      return;
    }
    element.textContent = message;
    element.className = `partner-status ${type}`;
  }

  function clearStatus(element) {
    if (!element) {
      return;
    }
    element.textContent = '';
    element.style.display = '';
    element.className = 'partner-status';
  }

  function setButtonLoading(button, loading) {
    if (!button) {
      return;
    }
    const label = button.querySelector('.btn-text');
    button.disabled = loading;
    if (label) {
      label.textContent = loading
        ? 'Please wait…'
        : button.dataset.defaultText || label.textContent;
    }
  }

  function getSafeRedirect() {
    const raw = new URLSearchParams(window.location.search).get('redirect');
    if (!raw) {
      return null;
    }
    try {
      const parsed = new URL(raw, window.location.origin);
      if (parsed.origin !== window.location.origin) {
        return null;
      }
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch (_) {
      return null;
    }
  }

  async function checkAlreadyLoggedIn() {
    try {
      const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const role = data?.user?.role || data?.role;
      if (role === 'partner') {
        window.location.replace(getSafeRedirect() || '/partner/dashboard');
      } else if (role === 'admin') {
        window.location.replace('/admin-partners');
      }
    } catch (_) {
      // An anonymous visitor should remain on the page.
    }
  }

  function initTabs() {
    const signInTab = document.getElementById('tab-signin');
    const signUpTab = document.getElementById('tab-signup');
    const signInPanel = document.getElementById('panel-signin');
    const signUpPanel = document.getElementById('panel-signup');
    if (!signInTab || !signUpTab || !signInPanel || !signUpPanel) {
      return;
    }

    function activate(activeTab, inactiveTab, activePanel, inactivePanel) {
      activeTab.classList.add('active');
      activeTab.setAttribute('aria-selected', 'true');
      inactiveTab.classList.remove('active');
      inactiveTab.setAttribute('aria-selected', 'false');
      activePanel.classList.add('active');
      activePanel.removeAttribute('hidden');
      inactivePanel.classList.remove('active');
      inactivePanel.setAttribute('hidden', '');
      activePanel.querySelector('input, select, textarea')?.focus();
    }

    signInTab.addEventListener('click', () =>
      activate(signInTab, signUpTab, signInPanel, signUpPanel)
    );
    signUpTab.addEventListener('click', () =>
      activate(signUpTab, signInTab, signUpPanel, signInPanel)
    );

    [signInTab, signUpTab].forEach(tab => {
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          return;
        }
        event.preventDefault();
        (tab === signInTab ? signUpTab : signInTab).click();
      });
    });

    if (new URLSearchParams(window.location.search).get('signup') === '1') {
      signUpTab.click();
    }
  }

  const EYE_ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function initPasswordToggles() {
    document.querySelectorAll('.partner-pw-toggle').forEach(button => {
      const input = document.getElementById(button.dataset.target || '');
      if (!input) {
        return;
      }
      button.addEventListener('click', () => {
        const showing = input.type === 'password';
        input.type = showing ? 'text' : 'password';
        button.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
        button.innerHTML = showing ? EYE_OFF_ICON : EYE_ICON;
      });
    });
  }

  function initCapsLockHints() {
    [
      ['login-password', 'login-capslock'],
      ['reg-password', 'reg-capslock'],
    ].forEach(([inputId, hintId]) => {
      const input = document.getElementById(inputId);
      const hint = document.getElementById(hintId);
      if (!input || !hint) {
        return;
      }
      const update = event => {
        if (event.getModifierState?.('CapsLock')) {
          hint.removeAttribute('hidden');
        } else {
          hint.setAttribute('hidden', '');
        }
      };
      input.addEventListener('keydown', update);
      input.addEventListener('keyup', update);
    });
  }

  function setFieldError(input, error, message) {
    if (error) {
      error.textContent = message;
    }
    input?.classList.add('partner-input--error');
  }

  function clearFieldError(input, error) {
    if (error) {
      error.textContent = '';
    }
    input?.classList.remove('partner-input--error');
  }

  function initLoginForm() {
    const form = document.getElementById('partner-login-form');
    const status = document.getElementById('login-status');
    const button = document.getElementById('login-btn');
    if (!form || !button) {
      return;
    }
    button.dataset.defaultText = 'Log in to dashboard';

    form.addEventListener('submit', async event => {
      event.preventDefault();
      clearStatus(status);
      const emailInput = form.querySelector('#login-email');
      const passwordInput = form.querySelector('#login-password');
      const emailError = document.getElementById('login-email-error');
      const passwordError = document.getElementById('login-password-error');
      const email = emailInput?.value.trim() || '';
      const password = passwordInput?.value || '';
      clearFieldError(emailInput, emailError);
      clearFieldError(passwordInput, passwordError);

      let invalid = false;
      if (!email) {
        setFieldError(emailInput, emailError, 'Email address is required.');
        invalid = true;
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setFieldError(emailInput, emailError, 'Please enter a valid email address.');
        invalid = true;
      }
      if (!password) {
        setFieldError(passwordInput, passwordError, 'Password is required.');
        invalid = true;
      }
      if (invalid) {
        form.querySelector('.partner-input--error')?.focus();
        return;
      }

      setButtonLoading(button, true);
      try {
        const response = await fetch('/api/v1/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': await fetchCsrfToken(),
          },
          body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (!response.ok) {
          showStatus(status, data.error || data.message || 'Login failed.', 'error');
          return;
        }
        const role = data?.user?.role || data?.role;
        if (role === 'admin') {
          window.location.replace('/admin-partners');
          return;
        }
        if (role !== 'partner') {
          showStatus(status, 'This account is not a partner account.', 'error');
          return;
        }
        window.location.replace(getSafeRedirect() || '/partner/dashboard');
      } catch (_) {
        showStatus(status, 'Network error. Please try again.', 'error');
      } finally {
        setButtonLoading(button, false);
      }
    });
  }

  function initForgotPassword() {
    const link = document.getElementById('partner-forgot-link');
    const form = document.getElementById('partner-login-form');
    const status = document.getElementById('login-status');
    if (!link || !form) {
      return;
    }

    link.addEventListener('click', async event => {
      event.preventDefault();
      const emailInput = form.querySelector('#login-email');
      const email = emailInput?.value.trim() || '';
      if (!email) {
        showStatus(status, 'Enter your email address above first, then try again.', 'info');
        emailInput?.focus();
        return;
      }
      showStatus(status, 'Sending reset instructions…', 'info');
      try {
        await fetch('/api/v1/auth/forgot', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': await fetchCsrfToken(),
          },
          body: JSON.stringify({ email }),
        });
        showStatus(
          status,
          "If that email is registered, we'll send password reset instructions.",
          'success'
        );
      } catch (_) {
        showStatus(status, 'Network error. Please try again.', 'error');
      }
    });
  }

  function readAltchaPayload(widget) {
    if (!widget) {
      return null;
    }
    try {
      const shadowInput = widget.shadowRoot?.querySelector('input[name="altcha"]');
      if (shadowInput?.value) {
        return shadowInput.value;
      }
    } catch (_) {
      // Shadow DOM access is best effort; the component value is the standard fallback.
    }
    return widget.value || null;
  }

  function initPartnerAltcha() {
    const widget = document.getElementById('partner-reg-altcha-widget');
    if (!widget) {
      return;
    }

    widget.addEventListener('statechange', event => {
      if (event.detail?.state === 'verified') {
        partnerCaptchaPayload = event.detail.payload || readAltchaPayload(widget);
      } else {
        partnerCaptchaPayload = null;
      }
    });

    partnerCaptchaPayload = readAltchaPayload(widget);
  }

  function initSignupForm() {
    const form = document.getElementById('partner-signup-form');
    const status = document.getElementById('signup-status');
    const button = document.getElementById('signup-btn');
    if (!form || !button) {
      return;
    }
    button.dataset.defaultText = 'Create partner account';

    form.addEventListener('submit', async event => {
      event.preventDefault();
      clearStatus(status);
      const firstName = form.querySelector('#reg-firstname')?.value.trim() || '';
      const lastName = form.querySelector('#reg-lastname')?.value.trim() || '';
      const email = form.querySelector('#reg-email')?.value.trim() || '';
      const password = form.querySelector('#reg-password')?.value || '';
      const location = form.querySelector('#reg-location')?.value.trim() || '';
      const company = form.querySelector('#reg-company')?.value.trim() || '';
      const altchaWidget = document.getElementById('partner-reg-altcha-widget');
      const captchaToken = partnerCaptchaPayload || readAltchaPayload(altchaWidget);

      if (!firstName || !lastName) {
        showStatus(status, 'First and last name are required.', 'error');
        return;
      }
      if (!email) {
        showStatus(status, 'Email address is required.', 'error');
        return;
      }
      if (!password || password.length < 8) {
        showStatus(status, 'Password must be at least 8 characters.', 'error');
        return;
      }
      if (!location) {
        showStatus(status, 'Location is required.', 'error');
        return;
      }
      if (!captchaToken) {
        showStatus(
          status,
          'Please complete the verification challenge before creating your account.',
          'error'
        );
        return;
      }

      setButtonLoading(button, true);
      try {
        const response = await fetch('/api/v1/partner/register', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': await fetchCsrfToken(),
          },
          body: JSON.stringify({
            firstName,
            lastName,
            email,
            password,
            location,
            company,
            captchaToken,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          showStatus(status, data.error || 'Registration failed. Please try again.', 'error');
          return;
        }
        if (data.requiresVerification) {
          showStatus(
            status,
            data.message || 'Account created. Check your email before logging in.',
            'success'
          );
          form.reset();
          partnerCaptchaPayload = null;
          return;
        }
        showStatus(status, '✓ Account created! You can now log in.', 'success');
      } catch (_) {
        showStatus(status, 'Network error. Please try again.', 'error');
      } finally {
        setButtonLoading(button, false);
      }
    });
  }

  function init() {
    fetchCsrfToken();
    checkAlreadyLoggedIn();
    initTabs();
    initPasswordToggles();
    initCapsLockHints();
    initLoginForm();
    initForgotPassword();
    initPartnerAltcha();
    initSignupForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
