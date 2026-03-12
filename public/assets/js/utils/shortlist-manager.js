/**
 * Shortlist Manager
 * Manages shortlist state with server sync.
 * Guest/unauthenticated mode is intentionally disabled — shortlist requires login.
 */

class ShortlistManager {
  constructor() {
    this.items = [];
    this.listeners = [];
    this.isAuthenticated = false;
    this.isSyncing = false;
    this.init();
  }

  normalizeKey(value) {
    return String(value);
  }

  /**
   * Get CSRF token from cookie
   */
  getCsrfToken() {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'csrf') {
        return value;
      }
    }
    return null;
  }

  /**
   * Add CSRF token to fetch options
   */
  addCsrfHeaders(headers = {}) {
    const token = this.getCsrfToken();
    return token ? { ...headers, 'X-CSRF-Token': token } : headers;
  }

  /**
   * Initialize shortlist manager
   */
  async init() {
    // Check authentication
    this.isAuthenticated = await this.checkAuth();

    if (this.isAuthenticated) {
      // Load from server
      await this.loadFromServer();
    } else {
      // Guest mode is disabled: clear any stale localStorage data and start empty
      this._clearLocalStorage();
      this.items = [];
      this.notifyListeners();
    }
  }

  /**
   * Check if user is authenticated
   */
  async checkAuth() {
    try {
      const response = await fetch('/api/v1/auth/me', {
        credentials: 'include',
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Load shortlist from server
   */
  async loadFromServer() {
    try {
      const response = await fetch('/api/v1/shortlist', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        this.items = data.data.items || [];

        this.notifyListeners();
      } else if (response.status === 401) {
        // Session expired or revoked — treat as unauthenticated
        this.isAuthenticated = false;
        this.items = [];
        this._clearLocalStorage();
        this.notifyListeners();
      }
    } catch (error) {
      console.error('Failed to load shortlist from server:', error);
      this.items = [];
      this.notifyListeners();
    }
  }

  /**
   * Clear stale localStorage shortlist keys (backward-compatibility cleanup).
   * @private
   */
  _clearLocalStorage() {
    try {
      localStorage.removeItem('eventflow_shortlist');
      localStorage.removeItem('eventflow_shortlist_merged');
    } catch (_e) {
      // Ignore storage errors
    }
  }

  /**
   * Add item to shortlist
   */
  async addItem(item) {
    if (!this.isAuthenticated) {
      return { success: false, requiresAuth: true };
    }

    const normalizedType = this.normalizeKey(item.type);
    const normalizedId = this.normalizeKey(item.id);

    // Check if already exists
    const exists = this.items.some(
      i => this.normalizeKey(i.type) === normalizedType && this.normalizeKey(i.id) === normalizedId
    );
    if (exists) {
      return { success: false, error: 'Item already in shortlist' };
    }

    // Add to local state
    this.items.push({
      ...item,
      type: normalizedType,
      id: normalizedId,
      addedAt: new Date().toISOString(),
    });

    // Sync to server
    try {
      const response = await fetch('/api/v1/shortlist', {
        method: 'POST',
        headers: this.addCsrfHeaders({
          'Content-Type': 'application/json',
        }),
        credentials: 'include',
        body: JSON.stringify(item),
      });

      if (!response.ok) {
        // Rollback on server error
        this.items = this.items.filter(
          i =>
            !(
              this.normalizeKey(i.type) === normalizedType &&
              this.normalizeKey(i.id) === normalizedId
            )
        );
        return { success: false, error: 'Failed to sync to server' };
      }
    } catch (error) {
      console.error('Failed to sync shortlist add to server:', error);
    }

    this.notifyListeners();
    return { success: true };
  }

  /**
   * Remove item from shortlist
   */
  async removeItem(type, id) {
    if (!this.isAuthenticated) {
      return { success: false, requiresAuth: true };
    }

    const normalizedType = this.normalizeKey(type);
    const normalizedId = this.normalizeKey(id);

    // Remove from local state
    this.items = this.items.filter(
      i =>
        !(this.normalizeKey(i.type) === normalizedType && this.normalizeKey(i.id) === normalizedId)
    );

    // Sync to server
    try {
      await fetch(`/api/v1/shortlist/${type}/${id}`, {
        method: 'DELETE',
        headers: this.addCsrfHeaders({}),
        credentials: 'include',
      });
    } catch (error) {
      console.error('Failed to sync shortlist remove to server:', error);
    }

    this.notifyListeners();
    return { success: true };
  }

  /**
   * Clear entire shortlist
   */
  async clearAll() {
    this.items = [];

    if (this.isAuthenticated) {
      try {
        await fetch('/api/v1/shortlist', {
          method: 'DELETE',
          headers: this.addCsrfHeaders({}),
          credentials: 'include',
        });
      } catch (error) {
        console.error('Failed to sync shortlist clear to server:', error);
      }
    }

    this.notifyListeners();
    return { success: true };
  }

  /**
   * Check if item is in shortlist
   */
  hasItem(type, id) {
    if (!this.isAuthenticated) {
      return false;
    }
    const normalizedType = this.normalizeKey(type);
    const normalizedId = this.normalizeKey(id);
    return this.items.some(
      i => this.normalizeKey(i.type) === normalizedType && this.normalizeKey(i.id) === normalizedId
    );
  }

  /**
   * Get all items
   */
  getItems() {
    return [...this.items];
  }

  /**
   * Get items count
   */
  getCount() {
    return this.items.length;
  }

  /**
   * Register change listener
   */
  onChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  /**
   * Notify all listeners of changes
   */
  notifyListeners() {
    this.listeners.forEach(callback => {
      try {
        callback(this.items);
      } catch (error) {
        console.error('Shortlist listener error:', error);
      }
    });
  }
}

// Export singleton instance
const shortlistManager = new ShortlistManager();
if (typeof window !== 'undefined') {
  window.shortlistManager = shortlistManager;
}
export default shortlistManager;
