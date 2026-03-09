/**
 * EventFlow Navigation - Gold Standard JavaScript
 * Completely rebuilt from scratch with modern, accessible interactions
 */

(function () {
  'use strict';

  // Debug flag - set to false to disable console logs
  const DEBUG = false;

  // ==========================================
  // STATE MANAGEMENT
  // ==========================================

  const state = {
    isInitialized: false,
    isMobileMenuOpen: false,
    csrfToken: null,
    user: null,
    lastScrollY: 0,
    scrollThreshold: 10,
  };

  // ==========================================
  // DOM REFERENCES
  // ==========================================

  let elements = {};

  function initElements() {
    elements = {
      // Header
      header: document.querySelector('.ef-header'),

      // Mobile toggle
      mobileToggle: document.getElementById('ef-mobile-toggle'),
      mobileMenu: document.getElementById('ef-mobile-menu'),
      bottomMenu: document.getElementById('ef-bottom-menu'),

      // Auth elements
      authLink: document.getElementById('ef-auth-link'),
      dashboardLink: document.getElementById('ef-dashboard-link'),
      mobileAuth: document.getElementById('ef-mobile-auth'),
      mobileDashboard: document.getElementById('ef-mobile-dashboard'),
      mobileSettings: document.getElementById('ef-mobile-settings'),
      mobileLogout: document.getElementById('ef-mobile-logout'),
      bottomDashboard: document.getElementById('ef-bottom-dashboard'),
      bottomAlerts: document.getElementById('ef-bottom-alerts'),
      bottomSettings: document.getElementById('ef-bottom-settings'),

      // Notifications
      notificationBtn: document.getElementById('ef-notification-btn'),
      notificationBadge: document.getElementById('ef-notification-badge'),
      bottomDashboardBadge: document.getElementById('ef-bottom-dashboard-badge'),
    };

    // Log warning if critical elements are missing
    if (!elements.header) {
      if (DEBUG) {
        console.warn('EventFlow navbar: .ef-header element not found');
      }
    }
  }

  // ==========================================
  // CSRF TOKEN
  // ==========================================

  async function initCsrfToken() {
    try {
      const response = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        state.csrfToken = data.csrfToken;
        window.__CSRF_TOKEN__ = data.csrfToken;
      }
    } catch (error) {
      if (DEBUG) {
        console.warn('Failed to fetch CSRF token:', error);
      }
    }
  }

  // ==========================================
  // MOBILE MENU
  // ==========================================

  // NOTE: Mobile menu functionality moved to burger-menu.js
  // Legacy mobile menu code removed - now handled by standalone burger-menu.js component

  // ==========================================
  // SCROLL BEHAVIOR
  // ==========================================

  function initScrollBehavior() {
    if (!elements.header) {
      return;
    }

    let ticking = false;

    const updateHeaderOnScroll = () => {
      const currentScrollY = window.scrollY;

      if (currentScrollY > 50) {
        elements.header.classList.add('scrolled');
      } else {
        elements.header.classList.remove('scrolled');
      }

      state.lastScrollY = currentScrollY;
      ticking = false;
    };

    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          window.requestAnimationFrame(updateHeaderOnScroll);
          ticking = true;
        }
      },
      { passive: true }
    );

    // Initial check
    updateHeaderOnScroll();
  }

  // ==========================================
  // AUTH STATE MANAGEMENT
  // ==========================================

  function getAuthState() {
    return window.__authState || window.AuthStateManager;
  }

  async function logout() {
    // Clear local storage
    try {
      localStorage.removeItem('user');
      localStorage.removeItem('eventflow_onboarding_new');
      sessionStorage.clear();
    } catch (error) {
      if (DEBUG) {
        console.warn('Failed to clear storage:', error);
      }
    }

    // Call logout API
    if (state.csrfToken) {
      try {
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          headers: {
            'X-CSRF-Token': state.csrfToken,
          },
          credentials: 'include',
        });
      } catch (error) {
        if (DEBUG) {
          console.warn('Logout API failed:', error);
        }
      }
    }

    // Update centralized auth state
    const authState = getAuthState();
    if (authState) {
      authState.logout();
    }

    // Redirect to home
    window.location.href = `/?t=${Date.now()}`;
  }

  function updateAuthUI(user) {
    state.user = user;

    // Get bottom nav element
    const bottomNav = document.querySelector('.ef-bottom-nav');

    if (user) {
      // User is logged in
      const dashboardUrl =
        user.role === 'admin'
          ? '/admin'
          : user.role === 'supplier'
            ? '/dashboard/supplier'
            : '/dashboard/customer';

      // Add logged-in class to bottom nav for compact styling
      if (bottomNav) {
        bottomNav.classList.add('logged-in');
      }

      // Update desktop auth link to logout
      if (elements.authLink) {
        elements.authLink.textContent = 'Log out';
        elements.authLink.href = '#';
        elements.authLink.classList.remove('ef-btn-primary');
        elements.authLink.classList.add('ef-btn-secondary');
        // Remove old click handlers and add new one
        const newAuthLink = elements.authLink.cloneNode(true);
        elements.authLink.parentNode.replaceChild(newAuthLink, elements.authLink);
        elements.authLink = newAuthLink;
        elements.authLink.addEventListener('click', e => {
          e.preventDefault();
          logout();
        });
      }

      // Show dashboard link
      if (elements.dashboardLink) {
        elements.dashboardLink.href = dashboardUrl;
        elements.dashboardLink.style.display = '';
      }

      // Update mobile auth to logout
      if (elements.mobileAuth) {
        elements.mobileAuth.textContent = 'Log in';
        elements.mobileAuth.style.display = 'none';
      }

      // Show mobile dashboard
      if (elements.mobileDashboard) {
        elements.mobileDashboard.href = dashboardUrl;
        elements.mobileDashboard.style.display = '';
      }

      // Show mobile settings
      if (elements.mobileSettings) {
        elements.mobileSettings.style.display = '';
      }

      // Show mobile logout
      if (elements.mobileLogout) {
        elements.mobileLogout.style.display = '';
        // Remove old click handlers and add new one
        const newMobileLogout = elements.mobileLogout.cloneNode(true);
        elements.mobileLogout.parentNode.replaceChild(newMobileLogout, elements.mobileLogout);
        elements.mobileLogout = newMobileLogout;
        elements.mobileLogout.addEventListener('click', e => {
          e.preventDefault();
          logout();
        });
      }

      // Show bottom dashboard with badge (replaces alerts)
      if (elements.bottomDashboard) {
        elements.bottomDashboard.href = dashboardUrl;
        elements.bottomDashboard.style.display = 'flex';
      }

      // Show bottom settings link when logged in
      if (elements.bottomSettings) {
        elements.bottomSettings.style.display = 'flex';
      }

      // Hide bottom alerts button when logged in
      if (elements.bottomAlerts) {
        elements.bottomAlerts.style.display = 'none';
      }

      // Re-run active-page highlighting now that dashboard href is resolved
      setCurrentPage();

      // Show notification bell ONLY when logged in (desktop)
      // Re-query DOM to ensure fresh reference
      const btn = document.getElementById('ef-notification-btn');
      if (btn) {
        btn.style.display = 'flex';
      }
    } else {
      // User is logged out

      // Remove logged-in class from bottom nav
      if (bottomNav) {
        bottomNav.classList.remove('logged-in');
      }

      // Update desktop auth link
      if (elements.authLink) {
        elements.authLink.textContent = 'Log in';
        elements.authLink.href = '/auth';
        elements.authLink.classList.remove('ef-btn-secondary');
        elements.authLink.classList.add('ef-btn-primary');
        const newAuthLink = elements.authLink.cloneNode(true);
        elements.authLink.parentNode.replaceChild(newAuthLink, elements.authLink);
        elements.authLink = newAuthLink;
      }

      // Hide dashboard link
      if (elements.dashboardLink) {
        elements.dashboardLink.style.display = 'none';
      }

      // Show mobile auth
      if (elements.mobileAuth) {
        elements.mobileAuth.textContent = 'Log in';
        elements.mobileAuth.href = '/auth';
        elements.mobileAuth.style.display = '';
      }

      // Hide mobile dashboard and logout
      if (elements.mobileDashboard) {
        elements.mobileDashboard.style.display = 'none';
      }
      if (elements.mobileSettings) {
        elements.mobileSettings.style.display = 'none';
      }
      if (elements.mobileLogout) {
        elements.mobileLogout.style.display = 'none';
      }

      // Hide bottom dashboard
      if (elements.bottomDashboard) {
        elements.bottomDashboard.style.display = 'none';
      }

      // Hide bottom settings link when logged out
      if (elements.bottomSettings) {
        elements.bottomSettings.style.display = 'none';
      }

      // Show bottom alerts button when logged out
      if (elements.bottomAlerts) {
        elements.bottomAlerts.style.display = 'flex';
      }

      // Hide notification bell
      // Re-query DOM to ensure fresh reference
      const btn = document.getElementById('ef-notification-btn');
      if (btn) {
        btn.style.display = 'none';
      }
    }
  }

  // ==========================================
  // CURRENT PAGE INDICATOR
  // ==========================================

  function setCurrentPage() {
    const normalizePath = path => {
      if (!path) {
        return '/';
      }

      const normalized = path.replace(/index\.html?$/i, '').replace(/\/$/, '');

      return normalized || '/';
    };

    const currentPath = normalizePath(window.location.pathname);

    const pathMatches = (linkPath, linkElement) => {
      if (linkPath === currentPath) {
        return true;
      }

      // Keep key nav sections highlighted on nested routes (e.g. blog post under /blog/*)
      if (linkElement && linkPath !== '/' && currentPath.startsWith(`${linkPath}/`)) {
        return true;
      }

      return false;
    };

    // Desktop nav
    const desktopLinks = document.querySelectorAll('.ef-nav-link');
    desktopLinks.forEach(link => {
      const linkPath = normalizePath(new URL(link.href).pathname);
      if (pathMatches(linkPath, link)) {
        link.setAttribute('aria-current', 'page');
      }
    });

    // Mobile nav
    const mobileLinks = document.querySelectorAll('.ef-mobile-link');
    mobileLinks.forEach(link => {
      if (link.href) {
        const linkPath = normalizePath(new URL(link.href).pathname);
        if (pathMatches(linkPath, link)) {
          link.setAttribute('aria-current', 'page');
        }
      }
    });

    // Bottom nav
    const bottomLinks = document.querySelectorAll('.ef-bottom-link');
    bottomLinks.forEach(link => {
      if (link.href) {
        const linkPath = normalizePath(new URL(link.href).pathname);
        if (pathMatches(linkPath, link)) {
          link.setAttribute('aria-current', 'page');
        }
      }
    });
  }

  // ==========================================
  // KEYBOARD NAVIGATION
  // ==========================================

  function initKeyboardNav() {
    // Track if user is using keyboard
    document.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        document.body.classList.add('keyboard-nav');
      }
    });

    document.addEventListener('mousedown', () => {
      document.body.classList.remove('keyboard-nav');
    });
  }

  // ==========================================
  // NOTIFICATION SYNC
  // ==========================================

  function initNotificationSync() {
    // Sync click handler for bottom dashboard button
    if (elements.bottomDashboard) {
      elements.bottomDashboard.addEventListener('click', e => {
        if (state.user) {
          e.preventDefault();
          const dashboardUrl =
            state.user.role === 'admin'
              ? '/admin'
              : state.user.role === 'supplier'
                ? '/dashboard/supplier'
                : '/dashboard/customer';
          window.location.href = `${dashboardUrl}#notifications`;
        }
      });
    }

    // Listen for notification updates from other components
    window.addEventListener('notifications-updated', e => {
      const count = e.detail?.count || 0;

      // Update desktop notification badge
      if (elements.notificationBadge) {
        elements.notificationBadge.textContent = count;
        elements.notificationBadge.style.display = count > 0 ? 'flex' : 'none';
      }

      // Update bottom dashboard badge
      if (elements.bottomDashboardBadge) {
        elements.bottomDashboardBadge.textContent = count;
        elements.bottomDashboardBadge.style.display = count > 0 ? 'flex' : 'none';
      }
    });
  }

  // ==========================================
  // INITIALIZATION
  // ==========================================

  async function init() {
    if (state.isInitialized) {
      return;
    }
    state.isInitialized = true;

    try {
      // Initialize DOM references
      initElements();

      // Initialize features
      // NOTE: Mobile menu is now handled by burger-menu.js
      // initMobileMenu(); // DISABLED - using standalone burger-menu.js instead
      initScrollBehavior();
      initKeyboardNav();
      initNotificationSync();
      setCurrentPage();

      // Fetch CSRF token
      await initCsrfToken();

      // Setup auth state listener
      const authState = getAuthState();
      if (authState) {
        // Wait for auth state to initialize before setting up listener
        await authState.init();

        // Setup listener - this will call updateAuthUI immediately with current state
        authState.onchange(updateAuthUI);
      } else {
        // Fallback: If auth state manager not available, assume logged out
        if (DEBUG) {
          console.warn('EventFlow navbar: Auth state manager not found, using fallback');
        }
        updateAuthUI(null);
      }

      // Expose logout globally
      window.__eventflow_logout = logout;
      window.addEventListener('logout-requested', logout);

      // Watch for auth changes in other tabs
      window.addEventListener('storage', async event => {
        if (event.key === 'user') {
          if (authState) {
            await authState.refresh();
          }
        }
      });

      if (DEBUG) {
        console.log('EventFlow Navigation initialized');
      }
    } catch (error) {
      console.error('EventFlow navbar initialization failed:', error);
      // Still try to show basic navbar even if auth fails
      updateAuthUI(null);
    }
  }

  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
