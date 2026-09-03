/**
 * Enhanced Authentication Helper Utilities
 * Provides improved UX for auth flows with rate limiting, better errors, and api-client integration
 */

'use strict';
(function () {
  // Rate limit state
  let rateLimitUntil = null;
  let rateLimitTimer = null;

  /**
   * Show auth status message with proper styling
   */
  function showAuthStatus(element, message, type = 'info') {
    if (!element) {
      return;
    }

    element.textContent = message;
    element.className = `auth-status is-visible is-${type}`;
    element.setAttribute('role', type === 'error' ? 'alert' : 'status');
    element.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  }

  /**
   * Hide auth status message
   */
  function hideAuthStatus(element) {
    if (!element) {
      return;
    }

    element.className = 'auth-status';
    element.textContent = '';
  }

  /**
   * Show loading overlay on form
   */
  function showLoading(form) {
    if (!form) {
      return;
    }

    let overlay = form.querySelector('.auth-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'auth-loading-overlay';
      overlay.innerHTML =
        '<div class="auth-spinner" role="status"><span class="auth-sr-only">Loading...</span></div>';
      form.style.position = 'relative';
      form.appendChild(overlay);
    }
    overlay.classList.add('is-active');

    // Disable form inputs
    const inputs = form.querySelectorAll('input, button');
    inputs.forEach(input => {
      input.disabled = true;
    });
  }

  /**
   * Hide loading overlay on form
   */
  function hideLoading(form) {
    if (!form) {
      return;
    }

    const overlay = form.querySelector('.auth-loading-overlay');
    if (overlay) {
      overlay.classList.remove('is-active');
    }

    // Re-enable form inputs
    const inputs = form.querySelectorAll('input, button');
    inputs.forEach(input => {
      input.disabled = false;
    });
  }

  /**
   * Check if we're currently rate limited
   */
  function isRateLimited() {
    if (!rateLimitUntil) {
      return false;
    }
    return Date.now() < rateLimitUntil;
  }

  /**
   * Set rate limit with timer
   */
  function setRateLimit(seconds) {
    rateLimitUntil = Date.now() + seconds * 1000;
    return seconds;
  }

  /**
   * Show rate limit message with countdown
   */
  function showRateLimitMessage(container, _seconds) {
    if (!container) {
      return;
    }

    // Create or get rate limit element
    let rateLimitEl = container.querySelector('.auth-rate-limit');
    if (!rateLimitEl) {
      rateLimitEl = document.createElement('div');
      rateLimitEl.className = 'auth-rate-limit';
      rateLimitEl.innerHTML = `
        <div class="auth-rate-limit-text">Too many attempts. Please wait:</div>
        <div class="auth-rate-limit-timer">0:00</div>
      `;
      container.insertBefore(rateLimitEl, container.firstChild);
    }

    rateLimitEl.classList.add('is-visible');
    const timerEl = rateLimitEl.querySelector('.auth-rate-limit-timer');

    // Update countdown
    function updateTimer() {
      if (!isRateLimited()) {
        rateLimitEl.classList.remove('is-visible');
        if (rateLimitTimer) {
          clearInterval(rateLimitTimer);
          rateLimitTimer = null;
        }
        return;
      }

      const remaining = Math.ceil((rateLimitUntil - Date.now()) / 1000);
      const minutes = Math.floor(remaining / 60);
      const secs = remaining % 60;
      timerEl.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    updateTimer();
    if (rateLimitTimer) {
      clearInterval(rateLimitTimer);
    }
    rateLimitTimer = setInterval(updateTimer, 1000);
  }

  /**
   * Show connection error with retry button
   */
  function showConnectionError(container, retryCallback) {
    if (!container) {
      return;
    }

    let errorEl = container.querySelector('.auth-connection-error');
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.className = 'auth-connection-error';
      errorEl.innerHTML = `
        <div class="auth-connection-error-text">
          Unable to connect. Please check your internet connection.
        </div>
        <button type="button" class="ef-cta auth-retry-btn">Retry</button>
      `;
      container.insertBefore(errorEl, container.firstChild);

      const retryBtn = errorEl.querySelector('.auth-retry-btn');
      if (retryBtn && retryCallback) {
        retryBtn.addEventListener('click', () => {
          retryBtn.disabled = true;
          retryBtn.textContent = 'Retrying...';
          retryCallback().finally(() => {
            errorEl.classList.remove('is-visible');
          });
        });
      }
    }

    errorEl.classList.add('is-visible');
  }

  /**
   * Hide connection error
   */
  function hideConnectionError(container) {
    if (!container) {
      return;
    }

    const errorEl = container.querySelector('.auth-connection-error');
    if (errorEl) {
      errorEl.classList.remove('is-visible');
    }
  }

  /**
   * Enhanced error message based on status code
   */
  function getErrorMessage(status, defaultMessage, responseError) {
    switch (status) {
      case 400:
        return responseError || 'Please check your input and try again.';
      case 401:
        return 'Invalid email or password. Please check your credentials.';
      case 403:
        if (responseError && responseError.toLowerCase().includes('verify')) {
          return 'Please verify your email address before signing in.';
        }
        return 'Access denied. Please contact support if this persists.';
      case 404:
        return 'Account not found. Please check your email or create an account.';
      case 429:
        return 'Too many attempts. Please wait a few minutes and try again.';
      case 500:
      case 502:
      case 503:
        return 'Server error. Please try again in a moment.';
      default:
        return defaultMessage || 'An error occurred. Please try again.';
    }
  }

  /**
   * Handle API response with improved error handling
   */
  async function handleAuthResponse(response, statusElement) {
    let data = {};
    try {
      data = await response.json();
    } catch (e) {
      console.warn('Failed to parse response JSON:', e);
    }

    if (!response.ok) {
      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const seconds = retryAfter ? parseInt(retryAfter, 10) : 60;
        setRateLimit(seconds);

        if (statusElement) {
          const container = statusElement.closest('form') || statusElement.parentElement;
          showRateLimitMessage(container, seconds);
        }
      }

      const errorMsg = getErrorMessage(response.status, null, data.error);
      throw new Error(errorMsg);
    }

    return data;
  }

  /**
   * Make authenticated API request with api-client
   */
  async function makeAuthRequest(endpoint, body, statusElement) {
    if (!window.apiClient) {
      throw new Error('API client not loaded. Please refresh the page.');
    }

    // Check rate limit before making request
    if (isRateLimited()) {
      const remaining = Math.ceil((rateLimitUntil - Date.now()) / 1000);
      throw new Error(`Please wait ${remaining} seconds before trying again.`);
    }

    try {
      const response = await window.apiClient.post(endpoint, body);
      return await handleAuthResponse(response, statusElement);
    } catch (error) {
      // Check if it's a network error
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        throw new Error('CONNECTION_ERROR');
      }
      throw error;
    }
  }

  /**
   * Enhanced login with api-client
   */
  function enhancedLogin(email, password, remember = false) {
    return makeAuthRequest('auth/login', { email, password, remember });
  }

  /**
   * Enhanced registration with api-client
   */
  function enhancedRegister(formData) {
    return makeAuthRequest('auth/register', formData);
  }

  /**
   * Enhanced forgot password with api-client
   */
  function enhancedForgotPassword(email) {
    return makeAuthRequest('auth/forgot', { email });
  }

  /**
   * Enhanced resend verification with api-client
   */
  function enhancedResendVerification(email) {
    return makeAuthRequest('auth/resend-verification', { email });
  }

  /**
   * Auto-focus first field with error or first empty field
   */
  function autoFocusForm(form) {
    if (!form) {
      return;
    }

    // Find first field with error
    const fieldWithError = form.querySelector('.has-error, [aria-invalid="true"]');
    if (fieldWithError) {
      fieldWithError.focus();
      return;
    }

    // Find first empty required field
    const emptyRequired = form.querySelector('input[required]:not([value])');
    if (emptyRequired) {
      emptyRequired.focus();
      return;
    }

    // Focus first input
    const firstInput = form.querySelector('input');
    if (firstInput) {
      firstInput.focus();
    }
  }

  // Export to global scope
  window.authHelpers = {
    showAuthStatus,
    hideAuthStatus,
    showLoading,
    hideLoading,
    isRateLimited,
    setRateLimit,
    showRateLimitMessage,
    showConnectionError,
    hideConnectionError,
    getErrorMessage,
    handleAuthResponse,
    makeAuthRequest,
    enhancedLogin,
    enhancedRegister,
    enhancedForgotPassword,
    enhancedResendVerification,
    autoFocusForm,
  };
})();
