/**
 * Auth Navigation System
 * Handles authentication state, logout, and cross-tab synchronization
 *
 * Features:
 * - Menu toggle for legacy header markup
 * - Auth state management with cache-busting
 * - Secure logout with verification
 * - Periodic auth state validation (30 seconds)
 * - Cross-tab logout synchronization
 * - Duplicate event handler prevention
 */
(function () {
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  ('use strict');

  // If the EF header system is present, do nothing.
  if (document.getElementById('ef-mobile-toggle') || document.getElementById('ef-mobile-menu')) {
    return;
  }

  const burger = document.getElementById('burger');
  const menu = document.querySelector('.nav-menu');
  const navAuth = document.getElementById('nav-auth');
  const navDashboard = document.getElementById('nav-dashboard');
  let navSignout = document.getElementById('nav-signout');

  // Track current auth state for change detection
  let currentUser = null;
  let periodicCheckInterval = null;

  // ============================================
  // Menu Toggle
  // ============================================
  function setMenuOpen(isOpen) {
    document.body.classList.toggle('nav-open', isOpen);
    if (menu) {
      menu.classList.toggle('nav-menu--open', isOpen);
    }
    if (burger) {
      burger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
  }

  function toggleMenu() {
    const isOpen =
      document.body.classList.contains('nav-open') ||
      (menu && menu.classList.contains('nav-menu--open'));
    setMenuOpen(!isOpen);
  }

  if (burger && menu) {
    burger.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    });

    document.addEventListener('click', e => {
      if (!document.body.classList.contains('nav-open')) {
        return;
      }
      const target = e.target;
      if (!target) {
        return;
      }
      if (menu.contains(target) || burger.contains(target)) {
        return;
      }
      setMenuOpen(false);
    });
  }

  // ============================================
  // Dashboard URL Helper
  // ============================================
  function dashboardUrlForUser(user) {
    if (!user || !user.role) {
      return '/dashboard';
    }
    if (user.role === 'admin') {
      return '/admin';
    }
    if (user.role === 'supplier') {
      return '/dashboard/supplier';
    }
    return '/dashboard/customer';
  }

  // ============================================
  // Auth State Management
  // ============================================
  function initAuthNav(user) {
    currentUser = user;
    if (user) {
      if (navAuth) {
        navAuth.style.display = 'none';
      }
      if (navDashboard) {
        navDashboard.style.display = '';
        navDashboard.href = dashboardUrlForUser(user);
      }
      if (navSignout) {
        navSignout.style.display = '';
      }
    } else {
      if (navAuth) {
        navAuth.style.display = '';
      }
      if (navDashboard) {
        navDashboard.style.display = 'none';
      }
      if (navSignout) {
        navSignout.style.display = 'none';
      }
    }
  }

  // ============================================
  // CSRF Token Fetching
  // ============================================
  async function fetchCsrfToken() {
    try {
      const resp = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      if (!resp.ok) {
        return null;
      }
      const data = await resp.json();
      if (data && data.csrfToken) {
        window.__CSRF_TOKEN__ = data.csrfToken;
        return data.csrfToken;
      }
    } catch (error) {
      console.warn('CSRF token fetch failed:', error.message);
    }
    return null;
  }

  // ============================================
  // Auth State Fetching with Cache Busting
  // ============================================
  async function me() {
    try {
      // Add cache-busting to /api/auth/me calls
      const resp = await fetch(`/api/v1/auth/me?_=${Date.now()}`, {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
      if (!resp.ok) {
        return null;
      }
      const data = await resp.json();
      return data && data.user ? data.user : null;
    } catch (error) {
      console.warn('Auth state check failed:', error.message);
      return null;
    }
  }

  // ============================================
  // Logout Handler (Complete Implementation)
  // ============================================
  async function handleLogout(e) {
    if (e) {
      e.preventDefault();
    }

    const token = window.__CSRF_TOKEN__ || (await fetchCsrfToken());

    // Perform logout request
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-CSRF-Token': token },
        });
      } catch (error) {
        console.warn('Logout request failed:', error.message);
      }
    }

    // Update navbar immediately to show logged-out state
    initAuthNav(null);

    // Clear local storage
    try {
      localStorage.removeItem('user');
      localStorage.removeItem('eventflow_onboarding_new');
      // Signal logout to other tabs
      localStorage.setItem('eventflow_logout', Date.now().toString());
    } catch (error) {
      console.warn('Storage clear failed:', error.message);
    }

    // Re-check auth state to verify logout completed
    const currentUser = await me();
    if (currentUser) {
      console.warn('Logout verification failed, retrying...');
      // Retry logout once
      if (token) {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-CSRF-Token': token },
          });
        } catch (_e) {
          // Ignore retry errors
        }
      }
    }

    // Redirect with cache busting
    window.location.href = `/?t=${Date.now()}`;
  }

  // ============================================
  // Event Listener Setup (Prevent Duplicates)
  // ============================================
  function setupLogoutHandler() {
    if (navSignout) {
      // Prevent duplicate event handlers using cloneNode
      const newSignout = navSignout.cloneNode(true);
      if (navSignout.parentNode) {
        navSignout.parentNode.replaceChild(newSignout, navSignout);
      }
      navSignout = newSignout;
      navSignout.addEventListener('click', handleLogout);
    }
  }

  // ============================================
  // Periodic Auth State Validation
  // ============================================
  function startPeriodicValidation() {
    // Clear any existing interval
    if (periodicCheckInterval) {
      clearInterval(periodicCheckInterval);
    }

    // Periodic auth state validation every 30 seconds
    periodicCheckInterval = setInterval(async () => {
      const user = await me();
      const wasLoggedIn = currentUser !== null;
      const isLoggedIn = user !== null;

      if (wasLoggedIn !== isLoggedIn) {
        if (isDevelopment) {
          console.log('Auth state changed, updating navbar');
        }
        updateAuthState(user);
      }
    }, 30000);
  }

  function updateAuthState(user) {
    initAuthNav(user);
    currentUser = user;
  }

  // ============================================
  // Cross-tab Auth State Synchronization
  // ============================================
  function setupCrossTabSync() {
    // Cross-tab auth state synchronization
    window.addEventListener('storage', e => {
      if (e.key === 'eventflow_logout') {
        if (isDevelopment) {
          console.log('Logout detected in another tab, syncing...');
        }
        initAuthNav(null);
        window.location.href = `/?t=${Date.now()}`;
      }
    });
  }

  // ============================================
  // Initialize
  // ============================================
  async function init() {
    const user = await me();
    initAuthNav(user);
    setupLogoutHandler();
    startPeriodicValidation();
    setupCrossTabSync();
  }

  init();
})();
