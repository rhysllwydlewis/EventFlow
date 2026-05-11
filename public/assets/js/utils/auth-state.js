/**
 * Centralized Auth State Manager
 * Manages authentication state and prevents unnecessary API calls
 * Only calls /api/auth/me when a token/session is present
 */

(function () {
  'use strict';

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

    /**
     * Initialize auth state - call this once on page load
     * @returns {Promise<Object>} User object or null
     */
    async init() {
      // Return existing promise if already initializing
      if (this.initPromise) {
        return this.initPromise;
      }

      // Return immediately if already initialized
      if (this.initialized) {
        return { state: this.state, user: this.user };
      }

      // Create initialization promise
      this.initPromise = this._initializeAuthState();

      try {
        const result = await this.initPromise;
        this.initialized = true;
        return result;
      } finally {
        this.initPromise = null;
      }
    }

    /**
     * Internal initialization logic
     * @private
     */
    async _initializeAuthState() {
      // Always check with server - don't rely on client-side cookie detection
      // since HttpOnly cookies (which are more secure) can't be read by JavaScript.
      // Note: This makes an API call on every initialization for security,
      // trading a small performance cost for proper HttpOnly cookie support.
      try {
        const response = await fetch('/api/v1/auth/me', {
          credentials: 'include',
          headers: {
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          },
        });

        if (response.ok) {
          const data = await response.json();
          const user = data.user || null;
          this._setState(AUTH_STATES.AUTHENTICATED, user);
          return { state: this.state, user };
        } else if (response.status === 401 || response.status === 403) {
          // Session expired or invalid - clear it
          this._clearAuthState();
          this._setState(AUTH_STATES.UNAUTHENTICATED, null);
          return { state: this.state, user: null };
        } else {
          // Other error - treat as unauthenticated
          // Only log non-auth errors in development
          if (
            window.location.hostname === 'localhost' &&
            response.status !== 401 &&
            response.status !== 403
          ) {
            console.warn('Auth check failed with status:', response.status);
          }
          this._setState(AUTH_STATES.UNAUTHENTICATED, null);
          return { state: this.state, user: null };
        }
      } catch (error) {
        // Network error - treat as unauthenticated
        // Only log in development mode
        if (window.location.hostname === 'localhost') {
          console.error('Auth check failed:', error);
        }
        this._setState(AUTH_STATES.UNAUTHENTICATED, null);
        return { state: this.state, user: null };
      }
    }

    /**
     * Check if session cookie exists
     * @private
     * @returns {boolean}
     */
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

    /**
     * Clear auth state from storage
     * @private
     */
    _clearAuthState() {
      try {
        localStorage.removeItem(STORAGE_KEYS.USER);
        localStorage.removeItem(STORAGE_KEYS.ONBOARDING);
        sessionStorage.clear();
      } catch (e) {
        // Ignore storage errors
      }
    }

    /**
     * Set auth state and notify listeners
     * @private
     */
    _setState(state, user) {
      const previousState = this.state;
      this.state = state;
      this.user = user;

      // Only notify if state actually changed
      if (previousState !== state) {
        this._notifyListeners();
      }
    }

    /**
     * Notify all listeners of state change
     * @private
     */
    _notifyListeners() {
      this.listeners.forEach(listener => {
        try {
          listener({ state: this.state, user: this.user });
        } catch (e) {
          // Only log errors in development
          if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
            console.error('Error in auth state listener:', e);
          }
        }
      });
    }

    /**
     * Get current auth state
     * @returns {string} One of AUTH_STATES
     */
    getState() {
      return this.state;
    }

    /**
     * Get current user
     * @returns {Object|null}
     */
    getUser() {
      return this.user;
    }

    /**
     * Check if user is authenticated
     * @returns {boolean}
     */
    isAuthenticated() {
      return this.state === AUTH_STATES.AUTHENTICATED && this.user !== null;
    }

    /**
     * Check if auth state is loading
     * @returns {boolean}
     */
    isLoading() {
      return this.state === AUTH_STATES.LOADING;
    }

    /**
     * Subscribe to auth state changes
     * @param {Function} callback - Callback function
     * @returns {Function} Unsubscribe function
     */
    subscribe(callback) {
      this.listeners.push(callback);

      // Return unsubscribe function
      return () => {
        this.listeners = this.listeners.filter(l => l !== callback);
      };
    }

    /**
     * Subscribe to auth state changes and call immediately with current state
     * Alias for subscribe that calls the callback immediately
     * @param {Function} callback - Callback function (receives user object)
     * @returns {Function} Unsubscribe function
     */
    onchange(callback) {
      // Wrap the callback to extract user from state object
      const wrappedCallback = stateObj => {
        const user =
          stateObj && typeof stateObj === 'object' && 'user' in stateObj ? stateObj.user : stateObj;
        callback(user);
      };

      // Call immediately with current user state
      try {
        wrappedCallback({ state: this.state, user: this.user });
      } catch (e) {
        if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
          console.error('Error in auth state onchange callback:', e);
        }
      }

      // Subscribe for future changes
      this.listeners.push(wrappedCallback);

      // Return unsubscribe function
      return () => {
        this.listeners = this.listeners.filter(l => l !== wrappedCallback);
      };
    }

    /**
     * Refresh auth state (e.g., after login/logout)
     * @returns {Promise<Object>}
     */
    async refresh() {
      this.initialized = false;
      this.initPromise = null;
      return this.init();
    }

    /**
     * Mark user as logged out
     */
    logout() {
      this._clearAuthState();
      this._setState(AUTH_STATES.UNAUTHENTICATED, null);
    }

    /**
     * Set user directly (for compatibility)
     */
    setUser(user) {
      if (user) {
        this._setState(AUTH_STATES.AUTHENTICATED, user);
      } else {
        this._setState(AUTH_STATES.UNAUTHENTICATED, null);
      }
    }
  }

  // Export as singleton
  if (typeof window !== 'undefined') {
    const authManager = new AuthStateManager();
    window.AuthStateManager = authManager;
    window.AUTH_STATES = AUTH_STATES;
    // Also expose as __authState for compatibility
    window.__authState = authManager;

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        authManager.init();
      });
    } else {
      authManager.init();
    }

    // Listen for legacy auth-state-changed event
    window.addEventListener('auth-state-changed', event => {
      if (event.detail && event.detail.user !== undefined) {
        authManager.setUser(event.detail.user);
      }
    });

    // Dispatch __auth-state-updated for compatibility
    const originalNotify = authManager._notifyListeners.bind(authManager);
    authManager._notifyListeners = function () {
      originalNotify();
      window.dispatchEvent(
        new CustomEvent('__auth-state-updated', {
          detail: { user: this.user },
        })
      );
    };
  }
})();

(function loadWeddingDashboardModalPolish() {
  'use strict';

  const customerDashboardPaths = ['/dashboard/customer', '/dashboard-customer.html'];
  if (!customerDashboardPaths.includes(window.location.pathname)) {
    return;
  }

  const cssId = 'wedding-dashboard-modal-polish-css';
  if (!document.getElementById(cssId)) {
    const link = document.createElement('link');
    link.id = cssId;
    link.rel = 'stylesheet';
    link.href = '/assets/css/wedding-dashboard-modal-polish.css?v=1.0.1';
    document.head.appendChild(link);
  }

  const jsId = 'wedding-dashboard-modal-polish-js';
  if (!document.getElementById(jsId)) {
    const script = document.createElement('script');
    script.id = jsId;
    script.src = '/assets/js/pages/wedding-dashboard-modal-polish.js?v=1.0.1';
    script.defer = true;
    document.head.appendChild(script);
  }
})();
