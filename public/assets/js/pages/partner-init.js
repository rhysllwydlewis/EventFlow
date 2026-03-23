/**
 * Partner Portal — Entry page (login + signup)
 * Handles tab switching, form submissions, and auth redirect.
 */
(function () {
  'use strict';

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

  function getCsrfToken() {
    return fetch('/api/v1/csrf', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { csrfToken: '' }))
      .then(d => d.csrfToken || '')
      .catch(() => '');
  }

  function setButtonLoading(btn, loading) {
    const span = btn.querySelector('.btn-text');
    btn.disabled = loading;
    if (span) {
      span.textContent = loading ? 'Please wait…' : btn.dataset.defaultText || span.textContent;
    }
  }

  // ── Redirect if already logged in as partner ─────────────────────────────────

  async function checkAlreadyLoggedIn() {
    try {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data && (data.role === 'partner' || (data.user && data.user.role === 'partner'))) {
          window.location.replace('/partner/dashboard');
        }
        // Admin can access dashboard directly too
        if (data && (data.role === 'admin' || (data.user && data.user.role === 'admin'))) {
          window.location.replace('/partner/dashboard');
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

      const email = form.querySelector('#login-email').value.trim();
      const password = form.querySelector('#login-password').value;

      if (!email || !password) {
        showStatus(status, 'Please enter your email and password.', 'error');
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
          showStatus(status, data.error || data.message || 'Login failed. Please check your credentials.', 'error');
          return;
        }

        const role = data.user?.role || data.role;
        if (role !== 'partner' && role !== 'admin') {
          showStatus(status, 'This account is not a partner account. Please use the main login page.', 'error');
          return;
        }

        // Success — redirect to dashboard
        window.location.replace('/partner/dashboard');
      } catch (err) {
        showStatus(status, 'Network error. Please try again.', 'error');
      } finally {
        setButtonLoading(btn, false);
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
    checkAlreadyLoggedIn();
    initTabs();
    initLoginForm();
    initSignupForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
