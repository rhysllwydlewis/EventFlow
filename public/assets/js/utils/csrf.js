/**
 * CSRF Token Utility
 * Provides helper functions for CSRF token management
 */

/**
 * Get CSRF token from cookie
 * @returns {string|null} The CSRF token or null if not found
 */
function getCsrfToken() {
  // Cookie is authoritative (server-controlled) when present.
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'csrf') {
      const token = decodeURIComponent(value || '');
      if (token) {
        // Keep globals synchronized for legacy callers
        window.__CSRF_TOKEN__ = token;
        window.csrfToken = token;
        return token;
      }
    }
  }

  // Fallback to global variable
  if (window.__CSRF_TOKEN__) {
    return window.__CSRF_TOKEN__;
  }

  if (window.csrfToken) {
    return window.csrfToken;
  }

  return null;
}

let csrfPromise = null;

/**
 * Ensure a CSRF token is available by reading cookie/global state first,
 * then fetching a fresh token from the server if needed.
 * @returns {Promise<string>} CSRF token
 */
function ensureCsrfToken(forceRefresh = false) {
  if (!forceRefresh) {
    const existing = getCsrfToken();
    if (existing) {
      window.__CSRF_TOKEN__ = existing;
      window.csrfToken = existing;
      return existing;
    }
  }

  if (forceRefresh) {
    window.__CSRF_TOKEN__ = null;
    window.csrfToken = null;
  }

  if (!csrfPromise) {
    csrfPromise = fetch('/api/v1/csrf-token', {
      credentials: 'include',
    })
      .then(async response => {
        if (!response.ok) {
          throw new Error('Failed to fetch CSRF token');
        }

        const data = await response.json();
        const token = data?.csrfToken;
        if (!token) {
          throw new Error('CSRF token missing from response');
        }

        window.__CSRF_TOKEN__ = token;
        window.csrfToken = token;
        return token;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }

  return csrfPromise;
}

/**
 * Add CSRF token to fetch options
 * @param {Object} options - Fetch options object
 * @returns {Object} Modified options with CSRF header
 */
function addCsrfToken(options = {}) {
  const token = getCsrfToken();

  if (!token) {
    console.warn('CSRF token not found');
    return options;
  }

  return {
    ...options,
    headers: {
      ...options.headers,
      'X-CSRF-Token': token,
    },
  };
}

/**
 * Fetch with automatic CSRF token inclusion
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise} Fetch promise
 */
async function fetchWithCsrf(url, options = {}) {
  // Only add CSRF for state-changing methods
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const token = await ensureCsrfToken();
    // eslint-disable-next-line no-param-reassign
    options = {
      ...options,
      headers: {
        ...(options.headers || {}),
        'X-CSRF-Token': token,
      },
    };
  }

  return fetch(url, options);
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getCsrfToken, addCsrfToken, ensureCsrfToken, fetchWithCsrf };
}

// Make available globally for non-module code
window.getCsrfToken = getCsrfToken;
window.addCsrfToken = addCsrfToken;
window.ensureCsrfToken = ensureCsrfToken;
window.fetchWithCsrf = fetchWithCsrf;
