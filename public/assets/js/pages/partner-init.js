/**
 * Partner Portal — Entry page (login + signup)
 * Handles tab switching, form submissions, and auth redirect.
 */
(function () {
  'use strict';

  // ── CSRF token — fetched once on page load, reused for all submissions ────────
  // Pre-fetching on page load ensures the csrf cookie is set in the browser before
  // any form POST is attempted, preventing "CSRF token missing" errors.

  let _csrfToken = '';

  async function prefetchCsrfToken() {
    try {
      const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        _csrfToken = data.csrfToken || data.token || '';
      }
    } catch (_) {
      // Non-fatal — forms will attempt a fresh fetch if token is empty
    }
  }

  async function getCsrfToken() {
    if (_csrfToken) {
      return _csrfToken;
    }
    // Fallback: fetch now (e.g. if page-load pre-fetch failed)
    try {
      const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        _csrfToken = data.csrfToken || data.token || '';
      }
    } catch (_) {
      // ignore
    }
    return _csrfToken;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function showStatus(el, msg, type) {
    el.textContent = msg;
    el.className = `partner-status ${type}`;
  }

  function clearStatus(el) {
    el.textContent = '';
    el.style.display = '';
    el.className = 'partner-status';
  }

  function setButtonLoading(btn, loading) {
    const span = btn.querySelector('.btn-text');
    btn.disabled = loading;
    if (span) {
      span.textContent = loading ? 'Please wait…' : btn.dataset.defaultText || span.textContent;
    }
  }

  // ── Safe redirect helper ──────────────────────────────────────────────────────
  // Validates a redirect query param to ensure it is a safe same-origin relative path.
  // Prevents open redirect attacks by parsing with the URL API and checking origin.

  function getSafeRedirect() {
    const params = new URLSearchParams(window.location.search);
    const redir = params.get('redirect');
    if (!redir) {
      return null;
    }
    try {
      // Resolve the redirect against our own origin — this normalises protocol-relative
      // or absolute URLs so the origin check below can catch them reliably.
      const parsed = new URL(redir, window.location.origin);
      // Reject if it would navigate away from the current origin
      if (parsed.origin !== window.location.origin) {
        return null;
      }
      // Return only pathname + search + hash; never scheme or host
      return parsed.pathname + parsed.search + parsed.hash;
    } catch (_) {
      // URL parsing failed — not a valid path
      return null;
    }
  }

  // ── Redirect if already logged in as partner ─────────────────────────────────

  async function checkAlreadyLoggedIn() {
    try {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const role = (data && data.user && data.user.role) || (data && data.role);
        if (role === 'partner') {
          const safeRedirect = getSafeRedirect();
          window.location.replace(safeRedirect || '/partner/dashboard');
        }
        // Admins have their own partners overview — don't send them to the partner portal
        if (role === 'admin') {
          window.location.replace('/admin-partners');
        }
      }
    } catch (_) {
      // Not logged in, stay on page
    }
  }

  // ── Tab switching ─────────────────────────────────────────────────────────────

  function initTabs() {
    const tabSignin = document.getElementById('tab-signin');
    const tabSignup = document.getElementById('tab-signup');
    const panelSignin = document.getElementById('panel-signin');
    const panelSignup = document.getElementById('panel-signup');

    if (!tabSignin || !tabSignup) {
      return;
    }

    function switchTab(active, inactive, activePanel, inactivePanel) {
      active.classList.add('active');
      active.setAttribute('aria-selected', 'true');
      inactive.classList.remove('active');
      inactive.setAttribute('aria-selected', 'false');
      activePanel.classList.add('active');
      activePanel.removeAttribute('hidden');
      inactivePanel.classList.remove('active');
      inactivePanel.setAttribute('hidden', '');
      // Move focus to the first focusable input in the newly active panel
      const firstInput = activePanel.querySelector('input, select, textarea');
      if (firstInput) {
        firstInput.focus();
      }
    }

    tabSignin.addEventListener('click', () => {
      switchTab(tabSignin, tabSignup, panelSignin, panelSignup);
    });

    tabSignup.addEventListener('click', () => {
      switchTab(tabSignup, tabSignin, panelSignup, panelSignin);
    });

    // Keyboard navigation
    [tabSignin, tabSignup].forEach(tab => {
      tab.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          if (tab === tabSignin) {
            tabSignup.focus();
            tabSignup.click();
          } else {
            tabSignin.focus();
            tabSignin.click();
          }
        }
      });
    });

    // Auto-switch to signup if ?signup param in URL
    if (new URLSearchParams(window.location.search).get('signup') === '1') {
      tabSignup.click();
    }
  }

  // ── Password show/hide toggles ────────────────────────────────────────────────

  // SVG icons for the toggle button
  const EYE_ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function initPasswordToggles() {
    document.querySelectorAll('.partner-pw-toggle').forEach(btn => {
      const targetId = btn.dataset.target;
      if (!targetId) {
        return;
      }
      const input = document.getElementById(targetId);
      if (!input) {
        return;
      }

      btn.addEventListener('click', () => {
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
        btn.innerHTML = isPassword ? EYE_OFF_ICON : EYE_ICON;
      });
    });
  }

  // ── Caps-lock hints ───────────────────────────────────────────────────────────

  function initCapsLockHints() {
    [
      { inputId: 'login-password', hintId: 'login-capslock' },
      { inputId: 'reg-password', hintId: 'reg-capslock' },
    ].forEach(({ inputId, hintId }) => {
      const input = document.getElementById(inputId);
      const hint = document.getElementById(hintId);
      if (!input || !hint) {
        return;
      }

      function handleCapsLock(e) {
        if (e.getModifierState) {
          const capsOn = e.getModifierState('CapsLock');
          if (capsOn) {
            hint.removeAttribute('hidden');
          } else {
            hint.setAttribute('hidden', '');
          }
        }
      }

      input.addEventListener('keydown', handleCapsLock);
      input.addEventListener('keyup', handleCapsLock);
    });
  }

  // ── Per-field validation helpers ──────────────────────────────────────────────

  function setFieldError(inputEl, errorEl, msg) {
    if (errorEl) {
      errorEl.textContent = msg;
    }
    if (inputEl) {
      inputEl.classList.add('partner-input--error');
    }
  }

  function clearFieldError(inputEl, errorEl) {
    if (errorEl) {
      errorEl.textContent = '';
    }
    if (inputEl) {
      inputEl.classList.remove('partner-input--error');
    }
  }

  // ── Login form ────────────────────────────────────────────────────────────────

  function initLoginForm() {
    const form = document.getElementById('partner-login-form');
    const status = document.getElementById('login-status');
    const btn = document.getElementById('login-btn');
    if (!form) {
      return;
    }

    btn.dataset.defaultText = 'Log in to dashboard';

    form.addEventListener('submit', async e => {
      e.preventDefault();
      clearStatus(status);

      const emailEl = form.querySelector('#login-email');
      const passwordEl = form.querySelector('#login-password');
      const emailErrorEl = document.getElementById('login-email-error');
      const passwordErrorEl = document.getElementById('login-password-error');

      const email = emailEl ? emailEl.value.trim() : '';
      const password = passwordEl ? passwordEl.value : '';

      // Clear previous field errors
      clearFieldError(emailEl, emailErrorEl);
      clearFieldError(passwordEl, passwordErrorEl);

      // Field-level validation
      let hasFieldError = false;

      if (!email) {
        setFieldError(emailEl, emailErrorEl, 'Email address is required.');
        hasFieldError = true;
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+/.test(email)) {
        setFieldError(emailEl, emailErrorEl, 'Please enter a valid email address.');
        hasFieldError = true;
      }

      if (!password) {
        setFieldError(passwordEl, passwordErrorEl, 'Password is required.');
        hasFieldError = true;
      }

      if (hasFieldError) {
        // Focus the first field with an error
        const firstErrorInput = form.querySelector('.partner-input--error');
        if (firstErrorInput) {
          firstErrorInput.focus();
        }
        return;
      }

      setButtonLoading(btn, true);

      try {
        const csrfToken = await getCsrfToken();
        const res = await fetch('/api/v1/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({ email, password }),
        });

        const data = await res.json();

        if (!res.ok) {
          showStatus(
            status,
            data.error || data.message || 'Login failed. Please check your credentials.',
            'error'
          );
          return;
        }

        const role = data.user?.role || data.role;
        if (role !== 'partner' && role !== 'admin') {
          showStatus(
            status,
            'This account is not a partner account. Please use the main login page.',
            'error'
          );
          return;
        }

        // Admins have their own partners dashboard
        if (role === 'admin') {
          window.location.replace('/admin-partners');
          return;
        }

        // Partner — honour safe redirect param or fall back to dashboard
        const safeRedirect = getSafeRedirect();
        window.location.replace(safeRedirect || '/partner/dashboard');
      } catch (err) {
        showStatus(status, 'Network error. Please try again.', 'error');
      } finally {
        setButtonLoading(btn, false);
      }
    });
  }

  // ── Forgot password ───────────────────────────────────────────────────────────

  function initForgotPassword() {
    const link = document.getElementById('partner-forgot-link');
    const form = document.getElementById('partner-login-form');
    const status = document.getElementById('login-status');
    if (!link) {
      return;
    }

    link.addEventListener('click', async e => {
      e.preventDefault();
      clearStatus(status);

      const emailInput = form ? form.querySelector('#login-email') : null;
      const email = emailInput ? emailInput.value.trim() : '';
      if (!email) {
        showStatus(
          status,
          'Enter your email address above first, then click "Forgot password?" to receive reset instructions.',
          'info'
        );
        if (emailInput) {
          emailInput.focus();
        }
        return;
      }

      showStatus(status, 'Sending reset instructions…', 'info');
      try {
        const csrfToken = await getCsrfToken();
        await fetch('/api/v1/auth/forgot', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({ email }),
        });
        // Always show the same message regardless of whether email was found
        // (prevents user enumeration)
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

  // ── Signup form ───────────────────────────────────────────────────────────────

  function initSignupForm() {
    const form = document.getElementById('partner-signup-form');
    const status = document.getElementById('signup-status');
    const btn = document.getElementById('signup-btn');
    if (!form) {
      return;
    }

    btn.dataset.defaultText = 'Create partner account';

    form.addEventListener('submit', async e => {
      e.preventDefault();
      clearStatus(status);

      const firstName = form.querySelector('#reg-firstname').value.trim();
      const lastName = form.querySelector('#reg-lastname').value.trim();
      const email = form.querySelector('#reg-email').value.trim();
      const password = form.querySelector('#reg-password').value;
      const location = form.querySelector('#reg-location').value.trim();
      const company = form.querySelector('#reg-company').value.trim();

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

      setButtonLoading(btn, true);

      try {
        const csrfToken = await getCsrfToken();
        const res = await fetch('/api/v1/partner/register', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({ firstName, lastName, email, password, location, company }),
        });

        const data = await res.json();

        if (!res.ok) {
          showStatus(status, data.error || 'Registration failed. Please try again.', 'error');
          return;
        }

        showStatus(status, '✓ Account created! Redirecting to your dashboard…', 'success');
        setTimeout(() => window.location.replace('/partner/dashboard'), 800);
      } catch (err) {
        showStatus(status, 'Network error. Please try again.', 'error');
      } finally {
        setButtonLoading(btn, false);
      }
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  function init() {
    // Pre-fetch CSRF token immediately so cookie is set before any form submit
    prefetchCsrfToken();
    checkAlreadyLoggedIn();
    initTabs();
    initPasswordToggles();
    initCapsLockHints();
    initLoginForm();
    initForgotPassword();
    initSignupForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
