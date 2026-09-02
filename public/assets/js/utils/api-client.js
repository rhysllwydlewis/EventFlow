/**
 * Centralized API client for consistent endpoint management
 * Makes it easy to change API versions or base URLs in future
 */

class APIClient {
  constructor(baseUrl = '/api/v1') {
    this.baseUrl = baseUrl;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
  }

  /**
   * Build full URL for endpoint
   * @param {string} path - API path (e.g., 'auth/login')
   * @returns {string} Full URL
   */
  url(path) {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return `${this.baseUrl}/${cleanPath}`;
  }

  /**
   * Make authenticated request
   * @param {string} path - API path
   * @param {Object} options - Fetch options
   * @returns {Promise}
   */
  async request(path, options = {}) {
    const url = this.url(path);
    const headers = {
      ...this.defaultHeaders,
      ...options.headers,
    };

    const method = (options.method || 'GET').toUpperCase();
    const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    if (isWriteMethod) {
      try {
        if (typeof window.ensureCsrfToken === 'function') {
          const token = await window.ensureCsrfToken();
          headers['X-CSRF-Token'] = token;
        } else if (window.csrfToken || window.__CSRF_TOKEN__) {
          headers['X-CSRF-Token'] = window.csrfToken || window.__CSRF_TOKEN__;
        }
      } catch (error) {
        console.warn('Unable to ensure CSRF token before API request:', error);
      }
    }

    const config = {
      ...options,
      method,
      headers,
      credentials: 'include', // Include cookies for auth
    };

    let response = await fetch(url, config);

    if (isWriteMethod && response.status === 403) {
      const data = await response
        .clone()
        .json()
        .catch(() => ({}));
      if (/csrf/i.test(data?.error || '')) {
        try {
          window.__CSRF_TOKEN__ = null;
          window.csrfToken = null;

          const token =
            typeof window.ensureCsrfToken === 'function'
              ? await window.ensureCsrfToken(true)
              : window.csrfToken || window.__CSRF_TOKEN__;
          if (token) {
            response = await fetch(url, {
              ...config,
              headers: {
                ...headers,
                'X-CSRF-Token': token,
              },
            });
          }
        } catch (error) {
          console.warn('Unable to refresh CSRF token after 403:', error);
        }
      }
    }

    return response;
  }

  /**
   * GET request
   */
  get(path, options = {}) {
    return this.request(path, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  post(path, body, options = {}) {
    return this.request(path, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * PUT request
   */
  put(path, body, options = {}) {
    return this.request(path, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  /**
   * DELETE request
   */
  delete(path, options = {}) {
    return this.request(path, { ...options, method: 'DELETE' });
  }
}

// Export singleton instance
window.apiClient = new APIClient('/api/v1');
