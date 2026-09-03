/**
 * Enhanced CSRF Handler for EventFlow
 * Centralized CSRF token management with retry logic
 *
 * Features:
 * - Automatic token fetching with retry
 * - Cookie-first fallback strategy
 * - Fetch wrapper with built-in CSRF injection
 * - Exponential backoff for failed requests
 * - Singleton pattern for global access
 */

class CSRFHandler {
  constructor() {
    this.token = null;
    this.tokenPromise = null;
    this.retryAttempts = 3;
    this.retryDelay = 1000; // Initial delay in ms
  }

  /**
   * Get CSRF token from cookie
   * @returns {string|null} The CSRF token or null if not found
   */
  getTokenFromCookie() {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      // Handle cookies with '=' in their values by only splitting on first '='
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) {
        continue;
      }

      const name = trimmed.substring(0, eqIndex);
      const value = trimmed.substring(eqIndex + 1);

      if (name === 'csrf') {
        const token = decodeURIComponent(value || '');
        if (token) {
          return token;
        }
      }
    }
    return null;
  }

  /**
   * Ensure a CSRF token is available
   * @param {boolean} forceRefresh - Force fetching a new token
   * @returns {Promise<string>} CSRF token
   */
  ensureToken(forceRefresh = false) {
    // Check cookie first
    if (!forceRefresh) {
      const cookieToken = this.getTokenFromCookie();
      if (cookieToken) {
        this.token = cookieToken;
        window.__CSRF_TOKEN__ = cookieToken;
        window.csrfToken = cookieToken;
        return cookieToken;
      }

      // Check cached token
      if (this.token) {
        window.__CSRF_TOKEN__ = this.token;
        window.csrfToken = this.token;
        return this.token;
      }

      // Check global variables
      if (window.__CSRF_TOKEN__) {
        this.token = window.__CSRF_TOKEN__;
        return this.token;
      }
    }

    // If force refresh or no token found, fetch from server
    if (forceRefresh) {
      this.token = null;
      this.tokenPromise = null;
      window.__CSRF_TOKEN__ = null;
      window.csrfToken = null;
    }

    // Avoid duplicate fetches
    if (!this.tokenPromise) {
      this.tokenPromise = this._fetchTokenWithRetry();
    }

    return this.tokenPromise;
  }

  /**
   * Fetch CSRF token from server with retry logic
   * @private
   * @returns {Promise<string>} CSRF token
   */
  async _fetchTokenWithRetry() {
    let lastError = null;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await fetch('/api/v1/csrf-token', {
          credentials: 'include',
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`CSRF token fetch failed: ${response.status}`);
        }

        const data = await response.json();
        const token = data?.csrfToken || data?.token;

        if (!token) {
          throw new Error('CSRF token missing from response');
        }

        // Cache token
        this.token = token;
        window.__CSRF_TOKEN__ = token;
        window.csrfToken = token;

        // Clear promise
        this.tokenPromise = null;

        return token;
      } catch (error) {
        lastError = error;

        if (attempt < this.retryAttempts) {
          // Exponential backoff: wait longer each attempt
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    this.tokenPromise = null;
    throw new Error(
      `Failed to fetch CSRF token after ${this.retryAttempts} attempts: ${lastError?.message}`
    );
  }

  /**
   * Add CSRF token to fetch options
   * @param {Object} options - Fetch options
   * @returns {Object} Modified options with CSRF header
   */
  addTokenToOptions(options = {}) {
    const method = (options.method || 'GET').toUpperCase();

    // Only add CSRF for state-changing methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return options;
    }

    const token = this.token || this.getTokenFromCookie() || window.__CSRF_TOKEN__;

    if (!token) {
      console.warn('CSRF token not available for request');
      return options;
    }

    return {
      ...options,
      headers: {
        ...(options.headers || {}),
        'X-CSRF-Token': token,
      },
    };
  }

  /**
   * Fetch with automatic CSRF token handling and retry on CSRF errors
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>} Fetch response
   */
  async fetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();

    // Ensure token is available for state-changing methods
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      await this.ensureToken();
    }

    // Add CSRF token to headers
    const optionsWithToken = this.addTokenToOptions(options);

    // Add credentials if not specified
    if (!optionsWithToken.credentials) {
      optionsWithToken.credentials = 'include';
    }

    try {
      const response = await fetch(url, optionsWithToken);

      // If 403 and potentially a CSRF error, try refreshing token once
      if (response.status === 403) {
        const responseClone = response.clone();
        try {
          const errorData = await responseClone.json();
          const errorMessage = errorData?.error || errorData?.message || '';

          // Check if it's a CSRF error
          if (
            typeof errorMessage === 'string' &&
            (errorMessage.toLowerCase().includes('csrf') ||
              errorMessage.toLowerCase().includes('token'))
          ) {
            // Refresh token and retry once
            await this.ensureToken(true);
            const retryOptions = this.addTokenToOptions(options);
            if (!retryOptions.credentials) {
              retryOptions.credentials = 'include';
            }
            return fetch(url, retryOptions);
          }
        } catch (parseError) {
          // If we can't parse response, just return original
        }
      }

      return response;
    } catch (error) {
      console.error('Fetch error:', error);
      throw error;
    }
  }
}

// Create global singleton instance
if (typeof window !== 'undefined') {
  window.csrfHandler = new CSRFHandler();

  // Provide backward-compatible global function
  window.ensureCsrfToken = forceRefresh => window.csrfHandler.ensureToken(forceRefresh);
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CSRFHandler;
}
