/**
 * EventFlow Navigation - Gold Standard JavaScript
 * Completely rebuilt from scratch with modern, accessible interactions
 */

'use strict';
(function () {
  // Load the visible website brand separately from favicon/PWA/search assets.
  // This keeps the supplied mark and supplied wordmark as independent assets.
  function ensureBrandStyles() {
    if (document.querySelector('link[data-eventflow-brand]')) {
      return;
    }

    const brandStyles = document.createElement('link');
    brandStyles.rel = 'stylesheet';
    brandStyles.href = '/assets/css/eventflow-brand.css?v=1.0.1';
    brandStyles.dataset.eventflowBrand = 'true';
    document.head.appendChild(brandStyles);
  }

  ensureBrandStyles();

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
  // DESKTOP ACCOUNT DISCLOSURE
  // ==========================================

  function setAccountMenuOpen(open, restoreFocus = false) {
    if (!elements.accountPanel) {
      return;
    }
    elements.accountPanel.hidden = !open;
    elements.accountToggle.setAttribute('aria-expanded', String(open));
    if (restoreFocus) {
      elements.accountToggle.focus();
    }
  }

  function updateAccountMenu(user) {
    const hasAccountMenu = Boolean(
      elements.accountMenu && ['customer', 'supplier'].includes(user?.role)
    );
    document.body.classList.toggle('ef-account-menu-enabled', hasAccountMenu);
    if (elements.accountMenu) {
      setAccountMenuOpen(false);
      elements.accountMenu.hidden = !hasAccountMenu;
    }
  }

  function initAccountMenu() {
    if (!elements.authLink || !elements.header) {
      return;
    }

    // Build the shared control once, rather than copying account markup into
    // every page. Only customer/supplier auth states reveal it.
    const menu = document.createElement('div');
    menu.className = 'ef-account-menu';
    menu.hidden = true;
    menu.innerHTML = `
      <button type="button" id="ef-account-toggle" class="ef-btn ef-btn-secondary ef-account-toggle" aria-expanded="false" aria-controls="ef-account-panel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>
        <span>Account</span>
        <svg class="ef-account-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div id="ef-account-panel" class="ef-account-panel" hidden>
        <a href="/settings" rel="nofollow" class="ef-account-item" id="ef-account-settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>Settings</span>
        </a>
        <button type="button" class="ef-account-item ef-account-logout" id="ef-account-logout">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M9 4H4v16h5M14 8l4 4-4 4M8 12h10"/></svg>
          <span>Log out</span>
        </button>
      </div>`;
    elements.authLink.before(menu);
    elements.accountMenu = menu;
    elements.accountToggle = menu.querySelector('#ef-account-toggle');
    elements.accountPanel = menu.querySelector('#ef-account-panel');

    elements.accountToggle.addEventListener('click', () => {
      setAccountMenuOpen(elements.accountPanel.hidden);
    });
    menu.querySelector('#ef-account-logout').addEventListener('click', () => {
      setAccountMenuOpen(false);
      logout();
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !elements.accountPanel.hidden) {
        event.preventDefault();
        event.stopPropagation();
        setAccountMenuOpen(false, true);
      }
    });
    menu.addEventListener('focusout', event => {
      if (!menu.contains(event.relatedTarget)) {
        setAccountMenuOpen(false);
      }
    });
    document.addEventListener('pointerdown', event => {
      if (!menu.contains(event.target)) {
        setAccountMenuOpen(false);
      }
    });

    // A disclosure must not remain open when its desktop trigger disappears.
    window.matchMedia('(min-width: 1280px)').addEventListener('change', event => {
      const hadFocus = menu.contains(document.activeElement);
      setAccountMenuOpen(false);
      if (!event.matches && hadFocus) {
        elements.mobileToggle?.focus();
      }
    });
  }

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

  function markNavigationInProgress() {
    window.__EF_NAVIGATING_AWAY__ = true;
  }

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

    // Call logout API. A click that lands before the page's own token fetch has
    // finished must not skip the request and redirect as if signed out: the
    // session cookie would survive and the next page would still be signed in.
    if (!state.csrfToken) {
      await initCsrfToken();
    }
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
    updateAccountMenu(user);

    // The signed-in header carries a notifications button, "Log out" and
    // "Dashboard" — roughly 190px more than the signed-out header — so the
    // width at which the desktop nav still fits differs by auth state. Expose
    // that state to CSS rather than letting the header overflow.
    document.body.classList.toggle('ef-signed-in', Boolean(user));

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

      // Show bottom dashboard with badge
      if (elements.bottomDashboard) {
        elements.bottomDashboard.href = dashboardUrl;
        elements.bottomDashboard.style.display = 'flex';
      }

      // Show bottom settings link when logged in
      if (elements.bottomSettings) {
        elements.bottomSettings.style.display = 'flex';
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

      // Keep key nav sections highlighted on nested routes (e.g. blog post under /guides/*)
      if (linkElement && linkPath !== '/' && currentPath.startsWith(`${linkPath}/`)) {
        return true;
      }

      return false;
    };

    const shouldEvaluateLink = link => {
      const href = (link.getAttribute('href') || '').trim();
      if (!href || href === '#' || href.toLowerCase().startsWith('javascript:')) {
        return false;
      }
      return true;
    };

    const applyCurrentPage = selector => {
      const links = document.querySelectorAll(selector);
      links.forEach(link => {
        link.removeAttribute('aria-current');

        if (!shouldEvaluateLink(link)) {
          return;
        }

        const linkPath = normalizePath(new URL(link.href).pathname);
        if (pathMatches(linkPath, link)) {
          link.setAttribute('aria-current', 'page');
        }
      });
    };

    // Desktop, mobile, and bottom nav
    applyCurrentPage('.ef-nav-link');
    applyCurrentPage('.ef-mobile-link');
    applyCurrentPage('.ef-bottom-link');
    applyCurrentPage('.ef-account-item');

    // Notification icon button uses button semantics, so set current state manually
    if (elements.notificationBtn) {
      const isNotificationsPage =
        currentPath === '/notifications' || currentPath === '/notifications.html';
      if (isNotificationsPage) {
        elements.notificationBtn.setAttribute('aria-current', 'page');
        elements.notificationBtn.setAttribute('aria-pressed', 'true');
      } else {
        elements.notificationBtn.removeAttribute('aria-current');
        elements.notificationBtn.removeAttribute('aria-pressed');
      }
    }
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
    const registerDashboardNav = element => {
      if (!element) {
        return;
      }

      element.addEventListener('click', () => {
        markNavigationInProgress();
      });
    };

    registerDashboardNav(elements.dashboardLink);
    registerDashboardNav(elements.mobileDashboard);

    if (elements.notificationBtn) {
      elements.notificationBtn.addEventListener('click', () => {
        const normalizedPath =
          window.location.pathname.replace(/index\.html?$/i, '').replace(/\/$/, '') || '/';
        const isNotificationsPage =
          normalizedPath === '/notifications' || normalizedPath === '/notifications.html';
        if (!isNotificationsPage) {
          elements.notificationBtn.setAttribute('aria-pressed', 'true');
        }
      });
    }

    // Sync click handler for bottom dashboard button
    if (elements.bottomDashboard) {
      elements.bottomDashboard.addEventListener('click', e => {
        if (state.user) {
          e.preventDefault();
          markNavigationInProgress();
          const dashboardUrl =
            state.user.role === 'admin'
              ? '/admin'
              : state.user.role === 'supplier'
                ? '/dashboard/supplier'
                : '/dashboard/customer';
          window.location.href = dashboardUrl;
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
      initAccountMenu();

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
