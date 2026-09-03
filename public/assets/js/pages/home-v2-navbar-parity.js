// Align homepage V2 navbar behaviour with the shared/V3 navbar without touching V2 page content.
'use strict';
(() => {
  const body = document.body;
  const header = document.querySelector('.hv2-header');
  const authLink = document.getElementById('hv2-auth-link');
  const mobileLoginLinks = document.querySelectorAll('.hv2-mobile-login');
  const dashboardLinks = document.querySelectorAll('[data-hv2-dashboard-link]');
  const logoutLinks = document.querySelectorAll('[data-hv2-logout]');
  const navLinks = document.querySelectorAll('.hv2-nav a, .hv2-mobile-nav a, .hv2-bottom-link');

  function loadMobileSignupCta() {
    if (!document.getElementById('ef-home-mobile-signup-css')) {
      const stylesheet = document.createElement('link');
      stylesheet.id = 'ef-home-mobile-signup-css';
      stylesheet.rel = 'stylesheet';
      stylesheet.href = '/assets/css/home-mobile-signup.css?v=1.2.0';
      document.head.appendChild(stylesheet);
    }

    if (document.querySelector('script[data-ef-home-mobile-signup]')) {
      return;
    }

    const script = document.createElement('script');
    script.src = '/assets/js/components/home-mobile-signup.js?v=1.2.0';
    script.async = true;
    script.dataset.efHomeMobileSignup = 'true';
    document.head.appendChild(script);
  }

  function normalisePath(value) {
    return (value || '/').replace(/index\.html?$/i, '').replace(/\/$/, '') || '/';
  }

  function setCurrentPage() {
    const currentPath = normalisePath(window.location.pathname);

    navLinks.forEach(link => {
      const href = (link.getAttribute('href') || '').trim();
      if (!href || href === '#' || href.toLowerCase().startsWith('javascript:')) {
        return;
      }

      const linkPath = normalisePath(new URL(link.href, window.location.origin).pathname);
      if (
        linkPath === currentPath ||
        (linkPath !== '/' && currentPath.startsWith(`${linkPath}/`))
      ) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  function setScrolledState() {
    if (header) {
      header.classList.toggle('is-scrolled', window.scrollY > 50);
    }
  }

  function getDashboardUrl(user) {
    const role = String(user?.role || user?.accountType || '').toLowerCase();

    if (role.includes('admin')) {
      return '/admin';
    }

    if (role.includes('supplier')) {
      return '/dashboard/supplier';
    }

    return '/dashboard/customer';
  }

  async function getCsrfToken() {
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }

    try {
      const response = await fetch('/api/v1/csrf-token', {
        credentials: 'include',
      });
      if (!response.ok) {
        return '';
      }
      const data = await response.json();
      window.__CSRF_TOKEN__ = data.csrfToken || data.token || '';
      return window.__CSRF_TOKEN__;
    } catch {
      return '';
    }
  }

  async function logout(event) {
    if (event) {
      event.preventDefault();
    }

    const csrfToken = await getCsrfToken();

    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
      });
    } catch {
      // Keep local sign-out and redirect behaviour even if the endpoint is temporarily unavailable.
    }

    try {
      window.AuthStateManager?.logout?.();
    } catch {
      // Ignore local auth-state failures.
    }

    window.location.href = `/?t=${Date.now()}`;
  }

  function applyAuthState(user) {
    const isAuthenticated = Boolean(user);
    const dashboardUrl = getDashboardUrl(user);

    body.classList.toggle('hv2-user-authenticated', isAuthenticated);

    dashboardLinks.forEach(link => {
      link.href = dashboardUrl;
    });

    mobileLoginLinks.forEach(link => {
      link.textContent = 'Log in';
      link.href = '/auth';
    });

    logoutLinks.forEach(link => {
      link.removeEventListener('click', logout);
      link.addEventListener('click', logout);
    });

    if (!authLink) {
      return;
    }

    authLink.textContent = isAuthenticated ? 'Log out' : 'Log in';
    authLink.href = isAuthenticated ? '#' : '/auth';
    authLink.classList.toggle('hv2-auth-link--logout', isAuthenticated);
    authLink.onclick = isAuthenticated ? logout : null;
  }

  function initialiseAuth() {
    applyAuthState(null);

    if (!window.AuthStateManager || typeof window.AuthStateManager.init !== 'function') {
      return;
    }

    window.AuthStateManager.init()
      .then(result => {
        applyAuthState(result?.user || null);
        window.AuthStateManager.subscribe?.(({ user }) => applyAuthState(user));
      })
      .catch(() => applyAuthState(null));
  }

  loadMobileSignupCta();
  setCurrentPage();
  setScrolledState();
  window.addEventListener('scroll', setScrolledState, { passive: true });
  initialiseAuth();
})();
