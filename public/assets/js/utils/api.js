/**
 * API Utility Functions
 * Centralized API calls with error handling, retry logic, and timeout
 */

class API {
  constructor(baseURL = '', options = {}) {
    this.baseURL = baseURL;
    this.options = {
      timeout: 30000, // 30 seconds default
      retryAttempts: 2,
      retryDelay: 1000,
      retryStatusCodes: [408, 429, 500, 502, 503, 504],
      ...options,
    };
  }

  /**
   * Make a fetch request with error handling, retry logic, and timeout
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} - Response data
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;

    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    };

    const config = { ...defaultOptions, ...options };

    // Merge headers
    if (options.headers) {
      config.headers = { ...defaultOptions.headers, ...options.headers };
    }

    // Retry logic
    let lastError;
    for (let attempt = 0; attempt <= this.options.retryAttempts; attempt++) {
      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

        config.signal = controller.signal;

        const response = await fetch(url, config);
        clearTimeout(timeoutId);

        // Check if response is ok
        if (!response.ok) {
          // Check if we should retry
          if (
            attempt < this.options.retryAttempts &&
            this.options.retryStatusCodes.includes(response.status)
          ) {
            await this.delay(this.options.retryDelay * (attempt + 1));
            continue;
          }

          const error = await response.json().catch(() => ({
            error: `HTTP ${response.status}: ${response.statusText}`,
          }));
          throw new Error(error.error || error.message || 'Request failed');
        }

        // Parse JSON response
        const data = await response.json();
        return data;
      } catch (error) {
        lastError = error;

        // Handle timeout
        if (error.name === 'AbortError') {
          console.error('Request timeout:', url);
          if (attempt < this.options.retryAttempts) {
            // Exponential backoff: 1s, 2s, 4s
            await this.delay(this.options.retryDelay * Math.pow(2, attempt));
            continue;
          }
          throw new Error('Request timeout. Please try again.');
        }

        // Handle network errors
        if (error.message === 'Failed to fetch' || error.message.includes('NetworkError')) {
          console.error('Network error:', url);
          if (attempt < this.options.retryAttempts) {
            // Exponential backoff: 1s, 2s, 4s
            await this.delay(this.options.retryDelay * Math.pow(2, attempt));
            continue;
          }
          throw new Error('Network error. Please check your connection and try again.');
        }

        // If not retryable, throw immediately
        if (attempt >= this.options.retryAttempts) {
          console.error('API request failed:', error);
          throw error;
        }
      }
    }

    throw lastError;
  }

  /**
   * Delay helper for retry logic
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * GET request
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} - Response data
   */
  get(endpoint, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const url = queryString ? `${endpoint}?${queryString}` : endpoint;

    return this.request(url, { method: 'GET' });
  }

  /**
   * POST request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request body
   * @returns {Promise<Object>} - Response data
   */
  post(endpoint, data = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * PUT request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request body
   * @returns {Promise<Object>} - Response data
   */
  put(endpoint, data = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * DELETE request
   * @param {string} endpoint - API endpoint
   * @returns {Promise<Object>} - Response data
   */
  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }

  /**
   * Upload file(s)
   * @param {string} endpoint - API endpoint
   * @param {FormData} formData - Form data with file(s)
   * @returns {Promise<Object>} - Response data
   */
  upload(endpoint, formData) {
    return this.request(endpoint, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    });
  }
}

// Create global instance
if (typeof window !== 'undefined') {
  window.api = new API('/api');
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
}
