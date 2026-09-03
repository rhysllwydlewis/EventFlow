/**
 * Global Error Handler
 * Catches all unhandled errors and promise rejections
 * Logs to console/Sentry and shows user-friendly messages
 */

'use strict';
(function () {
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // Track errors to prevent flooding
  const recentErrors = new Set();
  const ERROR_COOLDOWN = 5000; // 5 seconds

  function isAbortLikeError(error) {
    const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
    return error?.name === 'AbortError' || message.includes('aborted');
  }

  function getRequestUrl(input) {
    if (typeof input === 'string') {
      return input;
    }
    if (input instanceof URL) {
      return input.href;
    }
    return (input && input.url) || '';
  }

  function getRequestPath(input) {
    const requestUrl = getRequestUrl(input);
    try {
      return new URL(requestUrl, window.location.origin).pathname;
    } catch (_error) {
      return String(requestUrl).split('?')[0];
    }
  }

  function isPhotoAssetRequest(input) {
    return /^\/api\/(?:v1\/)?photos\/[^/]+$/i.test(getRequestPath(input));
  }

  const NAVIGATION_FLAG_KEY = '__EF_NAVIGATING_AWAY__';
  const NAVIGATION_SUPPRESSION_WINDOW_MS = 3000;
  let navigationSuppressionUntil = 0;

  function isNavigationInProgress() {
    const now = Date.now();
    return Boolean(window[NAVIGATION_FLAG_KEY]) || now < navigationSuppressionUntil;
  }

  function markNavigationSuppressionWindow() {
    navigationSuppressionUntil = Date.now() + NAVIGATION_SUPPRESSION_WINDOW_MS;
    window[NAVIGATION_FLAG_KEY] = true;
    window.setTimeout(() => {
      if (Date.now() >= navigationSuppressionUntil) {
        window[NAVIGATION_FLAG_KEY] = false;
      }
    }, NAVIGATION_SUPPRESSION_WINDOW_MS + 50);
  }

  function setupNavigationTracking() {
    const mark = () => {
      markNavigationSuppressionWindow();
    };

    window.addEventListener('beforeunload', mark);
    document.addEventListener(
      'click',
      event => {
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (!link) {
          return;
        }

        const href = link.getAttribute('href') || '';
        if (!href || href === '#' || href.startsWith('javascript:')) {
          return;
        }

        if (link.target && link.target !== '_self') {
          return;
        }

        mark();
      },
      true
    );

    window.addEventListener('popstate', mark);
    window.addEventListener('hashchange', mark);
  }

  /**
   * Log error to console and external service
   */
  function logError(error, context = {}) {
    const errorKey = `${error.message}-${error.stack?.substring(0, 50)}`;

    // Prevent duplicate error notifications
    if (recentErrors.has(errorKey)) {
      return;
    }

    recentErrors.add(errorKey);
    setTimeout(() => recentErrors.delete(errorKey), ERROR_COOLDOWN);

    // Console logging
    console.error('🚨 Global Error Caught:', {
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
    });

    // Send to Sentry if configured
    if (window.Sentry && window.Sentry.captureException) {
      window.Sentry.captureException(error, {
        tags: context,
        level: 'error',
      });
    }
  }

  /**
   * Check if an error message is benign and should be ignored
   */
  function isBenignError(errorMessage) {
    if (typeof errorMessage !== 'string') {
      return false;
    }
    // List of benign errors to ignore
    const benignPatterns = [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      // Module syntax errors (e.g. missing named export) – logged but not shown to users
      'does not provide an export named',
      'The requested module',
    ];
    return benignPatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Show error notification using available notification system
   */
  function notifyError(message) {
    const errorMessage = typeof message === 'string' ? message : 'An unexpected error occurred';

    // Use EventFlowNotifications if available (PR #431)
    if (
      window.EventFlowNotifications &&
      typeof window.EventFlowNotifications.error === 'function'
    ) {
      window.EventFlowNotifications.error(errorMessage);
    } else if (window.Toast && typeof window.Toast.error === 'function') {
      // Fallback to old Toast system
      window.Toast.error(errorMessage, 'Error');
    } else {
      // Final fallback to console.warn (no alerts in production)
      console.warn('⚠️ Error notification:', errorMessage);
    }
  }

  /**
   * Show user-friendly error message
   */
  function showUserError(message) {
    const errorMessage =
      typeof message === 'string' ? message : message?.message || 'An unexpected error occurred';

    const displayMessage = isDevelopment
      ? errorMessage
      : 'Something went wrong. Please refresh the page or contact support.';

    notifyError(displayMessage);
  }

  /**
   * Parse error message from API response
   */
  async function parseErrorMessage(response, defaultMessage) {
    const contentType = response.headers && response.headers.get('content-type');
    if (!contentType || !contentType.toLowerCase().includes('application/json')) {
      try {
        const text = await response.text();
        return text ? text.slice(0, 180) : defaultMessage;
      } catch (_error) {
        return defaultMessage;
      }
    }

    try {
      const data = await response.json();
      return data.error || data.message || defaultMessage;
    } catch (_parseError) {
      return defaultMessage;
    }
  }

  /**
   * Setup global fetch interceptor for automatic error handling
   *
   * Monkey-patches window.fetch to automatically handle and log all API errors.
   *
   * Behavior:
   * - Successful responses (response.ok) are returned immediately without modification
   * - Failed responses (4xx, 5xx) trigger automatic error logging and user notification,
   *   then return the original response for further handling by calling code
   * - Network errors trigger automatic logging and notification, then are re-thrown
   *
   * Note: For failed API responses, both this interceptor AND the calling code may
   * display notifications. Calling code should check if automatic notification
   * is sufficient before showing additional error messages.
   */
  function setupFetchInterceptor() {
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
      try {
        const response = await originalFetch.apply(this, args);

        // Handle successful responses
        if (response.ok) {
          return response;
        }

        const requestUrl = getRequestUrl(args[0]);
        const isPhotoAssetFailure = isPhotoAssetRequest(args[0]);
        const defaultMessage = `Request failed with status ${response.status}`;

        // Image asset failures are handled visually by <img> fallback logic. Do not
        // turn one broken image into a global application error toast.
        if (isPhotoAssetFailure) {
          return response;
        }

        // Handle API errors (4xx, 5xx)
        // Clone response to allow error parsing without consuming the original
        const clonedResponse = response.clone();
        const errorMessage = await parseErrorMessage(clonedResponse, defaultMessage);

        // Log the error
        logError(new Error(errorMessage), {
          type: 'api_error',
          status: response.status,
          url: requestUrl,
        });

        // Suppress user notification for benign 404s (uploads, images, analytics)
        const isBenign404 =
          response.status === 404 &&
          (requestUrl.indexOf('/uploads/') !== -1 ||
            requestUrl.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|css|js)(\?|$)/) ||
            requestUrl.indexOf('/api/analytics') !== -1);
        // Suppress user notification for expected 401/403 (unauthenticated/forbidden).
        // These are expected on public pages and should not surface as error toasts.
        const isExpectedAuthError = response.status === 401 || response.status === 403;
        if (!isBenign404 && !isExpectedAuthError && !isNavigationInProgress()) {
          notifyError(errorMessage);
        }

        // Return original response so calling code can still handle it
        return response;
      } catch (error) {
        // Ignore aborted fetches caused by page navigation/cancellation.
        // These are expected when users click nav links and should not show error toasts.
        if (isAbortLikeError(error)) {
          if (isDevelopment) {
            console.debug('Ignoring aborted fetch request:', args[0]);
          }
          throw error;
        }

        // Handle network errors
        logError(error, {
          type: 'network_error',
          url: args[0],
        });

        // Show user notification for network errors
        const networkMessage = 'Network error. Please check your connection and try again.';
        notifyError(networkMessage);

        // Re-throw so calling code knows it failed
        throw error;
      }
    };

    console.log('✅ Fetch interceptor initialized');
  }

  /**
   * Handle global JavaScript errors
   */
  window.addEventListener('error', event => {
    const error = event.error || new Error(event.message);
    const errorMessage = error.message || 'Unknown error';

    // Ignore benign errors
    if (isBenignError(errorMessage) || isAbortLikeError(error)) {
      return;
    }

    if (isNavigationInProgress()) {
      if (isDevelopment) {
        console.debug('Suppressed global error during navigation:', errorMessage);
      }
      return;
    }

    logError(error, {
      type: 'global_error',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });

    // Show user notification (in dev mode, show actual error for debugging)
    showUserError(isDevelopment ? errorMessage : 'An unexpected error occurred');

    // Prevent default browser error handling (only in production for better UX)
    // In development, preserve full debugging capabilities
    if (!isDevelopment) {
      event.preventDefault();
    }
  });

  /**
   * Handle unhandled promise rejections
   */
  window.addEventListener('unhandledrejection', event => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    const errorMessage = error.message || 'Unknown error';

    // Ignore benign errors
    if (isBenignError(errorMessage) || isAbortLikeError(error)) {
      return;
    }

    if (isNavigationInProgress()) {
      if (isDevelopment) {
        console.debug('Suppressed promise rejection during navigation:', errorMessage);
      }
      return;
    }

    logError(error, {
      type: 'unhandled_promise_rejection',
      promise: event.promise,
    });

    // Show user notification (in dev mode, show actual error for debugging)
    showUserError(isDevelopment ? errorMessage : 'An unexpected error occurred');

    // Prevent default browser error handling (only in production for better UX)
    // In development, preserve full debugging capabilities
    if (!isDevelopment) {
      event.preventDefault();
    }
  });

  /**
   * Expose manual error reporting
   */
  window.reportError = function (error, context) {
    logError(error, { ...context, type: 'manual_report' });
  };

  setupNavigationTracking();

  // Initialize fetch interceptor
  setupFetchInterceptor();

  console.log('✅ Global error handler initialized');
})();
