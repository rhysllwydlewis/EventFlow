(() => {
  'use strict';

  const body = document.body;
  const authLink = document.getElementById('hv2-auth-link');
  const dashboardLinks = document.querySelectorAll('[data-hv2-dashboard-link]');
  const logoutLinks = document.querySelectorAll('[data-hv2-logout]');
  const notificationButton = document.getElementById('hv2-notification-btn');
  const notificationDropdown = document.getElementById('hv2-notification-dropdown');
  const cookiePrefsButton = document.getElementById('hv2-cookie-prefs-btn');
  const bottomMenuButton = document.getElementById('hv2-bottom-menu');
  const menuButton = document.querySelector('.hv2-menu');
  const mobileNav = document.getElementById('hv2-mobile-nav');
  const newsletterForm = document.getElementById('hv2-newsletter-form');
  const newsletterFeedback = document.getElementById('hv2-newsletter-feedback');

  function getDashboardUrl(user) {
    const role = String(user?.role || user?.accountType || '').toLowerCase();

    if (role.includes('supplier')) {
      return '/dashboard/supplier';
    }

    if (role.includes('admin')) {
      return '/admin';
    }

    return '/dashboard/customer';
  }

  async function getCsrfToken() {
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }

    try {
      const response = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      if (!response.ok) {
        return '';
      }

      const data = await response.json();
      const token = data.csrfToken || data.token || '';
      window.__CSRF_TOKEN__ = token;
      return token;
    } catch {
      return '';
    }
  }

  function setAuthenticatedState(user) {
    const isAuthenticated = Boolean(user);
    body.classList.toggle('hv2-user-authenticated', isAuthenticated);

    if (authLink) {
      authLink.textContent = isAuthenticated ? 'Account' : 'Sign in';
      authLink.href = isAuthenticated ? getDashboardUrl(user) : '/auth';
    }

    dashboardLinks.forEach(link => {
      link.href = getDashboardUrl(user);
    });
  }

  async function initialiseAuthAwareNav() {
    setAuthenticatedState(null);

    if (!window.AuthStateManager || typeof window.AuthStateManager.init !== 'function') {
      return;
    }

    try {
      const result = await window.AuthStateManager.init();
      setAuthenticatedState(result?.user || null);
      window.AuthStateManager.subscribe(({ user }) => setAuthenticatedState(user));
    } catch {
      setAuthenticatedState(null);
    }
  }

  function closeNotifications() {
    if (!notificationButton || !notificationDropdown) {
      return;
    }

    notificationButton.setAttribute('aria-expanded', 'false');
    notificationDropdown.hidden = true;
  }

  function initialiseNotifications() {
    if (!notificationButton || !notificationDropdown) {
      return;
    }

    notificationButton.addEventListener('click', () => {
      const isOpen = notificationButton.getAttribute('aria-expanded') === 'true';
      notificationButton.setAttribute('aria-expanded', String(!isOpen));
      notificationDropdown.hidden = isOpen;
    });

    document.addEventListener('click', event => {
      if (
        !notificationDropdown.hidden &&
        !notificationDropdown.contains(event.target) &&
        event.target !== notificationButton &&
        !notificationButton.contains(event.target)
      ) {
        closeNotifications();
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeNotifications();
      }
    });
  }

  async function logout() {
    const csrfToken = await getCsrfToken();

    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
      });
    } catch {
      // Still clear local auth state and send the user home.
    }

    try {
      window.AuthStateManager?.logout?.();
    } catch {
      // ignore
    }

    window.location.href = `/?t=${Date.now()}`;
  }

  function initialiseLogout() {
    logoutLinks.forEach(link => {
      link.addEventListener('click', event => {
        event.preventDefault();
        logout();
      });
    });
  }

  function initialiseCookiePreferences() {
    if (!cookiePrefsButton) {
      return;
    }

    cookiePrefsButton.addEventListener('click', event => {
      event.preventDefault();

      if (window.CookieConsent && typeof window.CookieConsent.openPreferences === 'function') {
        window.CookieConsent.openPreferences(event);
        return;
      }

      window.location.href = '/legal#cookies';
    });
  }

  function initialiseBottomMenu() {
    if (!bottomMenuButton || !menuButton || !mobileNav) {
      return;
    }

    bottomMenuButton.addEventListener('click', () => {
      const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', String(!isOpen));
      menuButton.setAttribute('aria-label', isOpen ? 'Open navigation menu' : 'Close navigation menu');
      mobileNav.hidden = isOpen;
      bottomMenuButton.setAttribute('aria-expanded', String(!isOpen));
    });
  }

  function initialiseNewsletter() {
    if (!newsletterForm || !newsletterFeedback) {
      return;
    }

    newsletterForm.addEventListener('submit', async event => {
      event.preventDefault();
      const submitButton = newsletterForm.querySelector('button[type="submit"]');
      const formData = new FormData(newsletterForm);
      const email = String(formData.get('email') || '').trim();

      newsletterFeedback.textContent = '';

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        newsletterFeedback.textContent = 'Please enter a valid email address.';
        return;
      }

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');
      }

      newsletterFeedback.textContent = 'Sending confirmation email...';

      try {
        const csrfToken = await getCsrfToken();
        const response = await fetch('/api/newsletter/subscribe', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: JSON.stringify({ email, source: 'home-v2' }),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || data.message || 'Subscription failed');
        }

        newsletterForm.reset();
        newsletterFeedback.textContent =
          data.message || 'Please check your email to confirm your subscription.';
      } catch (error) {
        newsletterFeedback.textContent =
          error && error.message
            ? error.message
            : 'Could not subscribe right now. Please try again.';
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.removeAttribute('aria-busy');
        }
      }
    });
  }

  initialiseAuthAwareNav();
  initialiseNotifications();
  initialiseLogout();
  initialiseCookiePreferences();
  initialiseBottomMenu();
  initialiseNewsletter();
})();
