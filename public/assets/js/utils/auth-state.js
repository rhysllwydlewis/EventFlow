/**
 * Centralized Auth State Manager
 * Manages authentication state and prevents unnecessary API calls
 * Only calls /api/auth/me when a token/session is present
 */

'use strict';
(function () {
  // Auth state constants
  const AUTH_STATES = {
    LOADING: 'loading',
    AUTHENTICATED: 'authenticated',
    UNAUTHENTICATED: 'unauthenticated',
  };

  // Storage keys - these match keys used throughout the app
  const STORAGE_KEYS = {
    USER: 'user',
    ONBOARDING: 'eventflow_onboarding_new',
  };

  const SESSION_COOKIE_NAME = 'connect.sid'; // Express session cookie name

  class AuthStateManager {
    constructor() {
      this.state = AUTH_STATES.LOADING;
      this.user = null;
      this.listeners = [];
      this.initialized = false;
      this.initPromise = null;
    }

    async init() {
      if (this.initPromise) {
        return this.initPromise;
      }
      if (this.initialized) {
        return { state: this.state, user: this.user };
      }
      this.initPromise = this._initializeAuthState();
      try {
        const result = await this.initPromise;
        this.initialized = true;
        return result;
      } finally {
        this.initPromise = null;
      }
    }

    async _initializeAuthState() {
      try {
        const response = await fetch('/api/v1/auth/me', {
          credentials: 'include',
          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        });
        if (response.ok) {
          const data = await response.json();
          const user = data.user || null;
          this._setState(AUTH_STATES.AUTHENTICATED, user);
          return { state: this.state, user };
        }
        if (response.status === 401 || response.status === 403) {
          this._clearAuthState();
          this._setState(AUTH_STATES.UNAUTHENTICATED, null);
          return { state: this.state, user: null };
        }
        if (window.location.hostname === 'localhost') {
          console.warn('Auth check failed with status:', response.status);
        }
        this._setState(AUTH_STATES.UNAUTHENTICATED, null);
        return { state: this.state, user: null };
      } catch (error) {
        if (window.location.hostname === 'localhost') {
          console.error('Auth check failed:', error);
        }
        this._setState(AUTH_STATES.UNAUTHENTICATED, null);
        return { state: this.state, user: null };
      }
    }

    _hasSessionCookie() {
      const cookies = document.cookie.split(';');
      return cookies.some(cookie => {
        const trimmed = cookie.trim();
        return (
          trimmed.startsWith(`${SESSION_COOKIE_NAME}=`) ||
          trimmed.startsWith('token=') ||
          trimmed.startsWith('auth=')
        );
      });
    }

    _clearAuthState() {
      try {
        localStorage.removeItem(STORAGE_KEYS.USER);
        localStorage.removeItem(STORAGE_KEYS.ONBOARDING);
        sessionStorage.clear();
      } catch (e) {
        // Ignore storage errors in private browsing / restricted storage modes.
      }
    }

    _setState(state, user) {
      const previousState = this.state;
      this.state = state;
      this.user = user;
      if (previousState !== state) {
        this._notifyListeners();
      }
    }

    _notifyListeners() {
      this.listeners.forEach(listener => {
        try {
          listener({ state: this.state, user: this.user });
        } catch (e) {
          if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
            console.error('Error in auth state listener:', e);
          }
        }
      });
    }

    getState() {
      return this.state;
    }
    getUser() {
      return this.user;
    }
    isAuthenticated() {
      return this.state === AUTH_STATES.AUTHENTICATED && this.user !== null;
    }
    isLoading() {
      return this.state === AUTH_STATES.LOADING;
    }

    subscribe(callback) {
      this.listeners.push(callback);
      return () => {
        this.listeners = this.listeners.filter(l => l !== callback);
      };
    }

    onchange(callback) {
      const wrappedCallback = stateObj => {
        const user =
          stateObj && typeof stateObj === 'object' && 'user' in stateObj ? stateObj.user : stateObj;
        callback(user);
      };
      try {
        wrappedCallback({ state: this.state, user: this.user });
      } catch (e) {
        if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
          console.error('Error in auth state onchange callback:', e);
        }
      }
      this.listeners.push(wrappedCallback);
      return () => {
        this.listeners = this.listeners.filter(l => l !== wrappedCallback);
      };
    }

    refresh() {
      this.initialized = false;
      this.initPromise = null;
      return this.init();
    }

    logout() {
      this._clearAuthState();
      this._setState(AUTH_STATES.UNAUTHENTICATED, null);
    }

    setUser(user) {
      if (user) {
        this._setState(AUTH_STATES.AUTHENTICATED, user);
      } else {
        this._setState(AUTH_STATES.UNAUTHENTICATED, null);
      }
    }
  }

  if (typeof window !== 'undefined') {
    const authManager = new AuthStateManager();
    window.AuthStateManager = authManager;
    window.AUTH_STATES = AUTH_STATES;
    window.__authState = authManager;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => authManager.init());
    } else {
      authManager.init();
    }
    window.addEventListener('auth-state-changed', event => {
      if (event.detail && event.detail.user !== undefined) {
        authManager.setUser(event.detail.user);
      }
    });
    const originalNotify = authManager._notifyListeners.bind(authManager);
    authManager._notifyListeners = function () {
      originalNotify();
      window.dispatchEvent(
        new CustomEvent('__auth-state-updated', { detail: { user: this.user } })
      );
    };
  }
})();

(function loadWeddingDashboardEnhancementAssets() {
  const customerDashboardPaths = ['/dashboard/customer', '/dashboard-customer.html'];
  if (!customerDashboardPaths.includes(window.location.pathname)) {
    return;
  }

  const cssAssets = [
    [
      'wedding-dashboard-modal-polish-css',
      '/assets/css/wedding-dashboard-modal-polish.css?v=1.0.1',
    ],
    ['wedding-password-protection-css', '/assets/css/wedding-password-protection.css?v=1.0.1'],
    ['wedding-publish-mop-up-css', '/assets/css/wedding-publish-mop-up.css?v=1.0.0'],
    ['wedding-theme-media-css', '/assets/css/wedding-theme-media.css?v=1.0.0'],
    ['wedding-theme-media-polish-css', '/assets/css/wedding-theme-media-polish.css?v=1.0.0'],
    ['wedding-mobile-stabilisation-css', '/assets/css/wedding-mobile-stabilisation.css?v=1.0.0'],
    ['wedding-compact-polish-css', '/assets/css/wedding-compact-polish.css?v=1.0.0'],
  ];
  cssAssets.forEach(([id, href]) => {
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
  });

  const jsAssets = [
    [
      'wedding-dashboard-modal-polish-js',
      '/assets/js/pages/wedding-dashboard-modal-polish.js?v=1.0.1',
    ],
    ['wedding-password-dashboard-js', '/assets/js/pages/wedding-password-dashboard.js?v=1.0.1'],
    ['wedding-publish-mop-up-js', '/assets/js/pages/wedding-publish-mop-up.js?v=1.0.0'],
    ['wedding-theme-media-js', '/assets/js/pages/wedding-theme-media-customiser.js?v=1.0.0'],
    ['wedding-mongodb-authority-js', '/assets/js/pages/wedding-mongodb-authority.js?v=1.0.0'],
  ];
  jsAssets.forEach(([id, src]) => {
    if (!document.getElementById(id)) {
      const script = document.createElement('script');
      script.id = id;
      script.src = src;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
})();
