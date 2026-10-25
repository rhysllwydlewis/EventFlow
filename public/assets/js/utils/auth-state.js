/**
 * Centralized Auth State Manager
 * Manages authentication state and shares one /api/v1/auth/me check between the scripts on a page.
 * Also owns the two rules about what this browser keeps for a signed-in person: the device-only
 * figures are forgotten when a different account signs in (scopeDeviceData), and remembered
 * choices follow the cookie choice (mayKeepFunctionalStorage, the one place that decides it).
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

  // Figures this browser keeps for whoever is signed in (a budget typed on the dashboard, the ids
  // of saved suppliers). They are not stored per account, so when a different person signs in on the
  // same browser they would otherwise see, and even save to their own plan, the previous person's.
  const DEVICE_DATA_KEYS = [
    'eventflow_custom_budget',
    'eventflow_saved_suppliers',
    // The budget page's device-only budget (and the older page's), and what was imported from it.
    'ef_budget_v2',
    'ef_budget',
    'ef_budget_imported',
    // The plan last picked on the budget and guest pages, and a dismissed account-type notice.
    'ef_customer_plan',
    'ef_account_type_notice_dismissed',
  ];
  const DEVICE_DATA_OWNER_KEY = 'eventflow_device_data_owner';

  /**
   * Forgets the device-only figures left by a different account, then records the current one as
   * their owner. Safe to call more than once.
   * @param {{id?: string}|null} user - The signed-in user
   */
  function scopeDeviceData(user) {
    const id = user?.id ? String(user.id) : '';
    if (!id) {
      return;
    }
    try {
      const owner = localStorage.getItem(DEVICE_DATA_OWNER_KEY);
      if (owner && owner !== id) {
        DEVICE_DATA_KEYS.forEach(key => localStorage.removeItem(key));
      }
      localStorage.setItem(DEVICE_DATA_OWNER_KEY, id);
    } catch {
      // Ignore storage errors in private browsing / restricted storage modes.
    }
  }

  /**
   * Whether this browser may keep a remembered choice (a dismissed notice, the plan last picked) or a
   * cached copy of server data. It follows the visitor's cookie choice: functional storage must have
   * been accepted. This is the one place that decides it; every page script asks here.
   *
   * - The consent library has loaded: its answer is used. Before a choice is made it says no.
   * - The page has no cookie banner at all: there is no choice to follow, so yes.
   * - The page includes the banner script but it has not run yet (it is loaded last, with `defer`,
   *   and start-up code can get here first): the visitor has not been asked, so no. Nothing is lost
   *   by that: the choice simply is not remembered until they accept, which is what a first-time
   *   visitor gets from the library itself.
   * Anything unexpected also says no.
   * @returns {boolean} True when it may be kept.
   */
  function mayKeepFunctionalStorage() {
    try {
      const consent = window.CookieConsent;
      if (consent && typeof consent.getConsent === 'function') {
        return consent.getConsent()?.functional === true;
      }
      return !document.querySelector('script[src*="cookie-consent"]');
    } catch {
      return false;
    }
  }

  /** Forget the signed-in user on this device (storage may be blocked or unavailable). */
  function clearAuthState() {
    try {
      localStorage.removeItem(STORAGE_KEYS.USER);
      localStorage.removeItem(STORAGE_KEYS.ONBOARDING);
      sessionStorage.clear();
    } catch {
      // Ignore storage errors in private browsing / restricted storage modes.
    }
  }

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
          scopeDeviceData(user);
          this._setState(AUTH_STATES.AUTHENTICATED, user);
          return { state: this.state, user };
        }
        if (response.status === 401 || response.status === 403) {
          clearAuthState();
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

    /**
     * Resolves once the sign-in check has finished, which is also when scopeDeviceData has run for
     * a signed-in user, or after maxWaitMs if the check hangs. Scripts that read device-only data
     * (a budget kept on this device, the plan last picked) wait for this first: otherwise the
     * previous account's figures can be read before they are cleared. It never rejects.
     * @param {number} [maxWaitMs] - The longest to wait
     * @returns {Promise<boolean>} True when the check finished, false when it timed out
     */
    whenReady(maxWaitMs = 8000) {
      const finished = this.init().then(
        () => true,
        () => false
      );
      const timedOut = new Promise(resolve => {
        window.setTimeout(() => resolve(false), maxWaitMs);
      });
      return Promise.race([finished, timedOut]);
    }

    refresh() {
      this.initialized = false;
      this.initPromise = null;
      return this.init();
    }

    logout() {
      clearAuthState();
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
    authManager.scopeDeviceData = scopeDeviceData;
    authManager.mayKeepFunctionalStorage = mayKeepFunctionalStorage;
    window.efMayKeepFunctionalStorage = mayKeepFunctionalStorage;
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
