/**
 * Error Boundary Component
 * Catches and handles JavaScript errors in components
 */

class ErrorBoundary {
  constructor(options = {}) {
    this.options = {
      fallbackUI: null,
      onError: null,
      showErrorDetails: !this.isProduction(),
      logErrors: true,
      ...options,
    };

    this.errors = [];
    this.init();
  }

  init() {
    // Global error handler
    window.addEventListener('error', event => {
      this.handleError(event.error, {
        type: 'error',
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    });

    // Promise rejection handler
    window.addEventListener('unhandledrejection', event => {
      this.handleError(event.reason, {
        type: 'unhandledrejection',
        promise: event.promise,
      });
    });
  }

  handleError(error, context = {}) {
    const errorInfo = {
      error,
      context,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    // Store error
    this.errors.push(errorInfo);

    // Log to console in development
    if (this.options.logErrors) {
      console.error('ErrorBoundary caught an error:', error);
      console.error('Context:', context);
    }

    // Call custom error handler if provided
    if (this.options.onError) {
      try {
        this.options.onError(errorInfo);
      } catch (handlerError) {
        console.error('Error handler threw an error:', handlerError);
      }
    }

    // Show fallback UI if provided
    if (this.options.fallbackUI) {
      this.showFallbackUI(errorInfo);
    }
  }

  showFallbackUI(errorInfo) {
    const fallbackContainer = document.createElement('div');
    fallbackContainer.className = 'error-boundary-fallback';
    fallbackContainer.setAttribute('role', 'alert');
    fallbackContainer.innerHTML = `
      <div class="error-boundary-content">
        <div class="error-icon">⚠️</div>
        <h2>Something went wrong</h2>
        <p>We're sorry, but something unexpected happened. Please try refreshing the page.</p>
        ${
          this.options.showErrorDetails
            ? `
          <details class="error-details">
            <summary>Error details</summary>
            <pre>${this.escapeHtml(errorInfo.error?.message || 'Unknown error')}</pre>
            <pre>${this.escapeHtml(errorInfo.error?.stack || '')}</pre>
          </details>
        `
            : ''
        }
        <div class="error-actions">
          <button class="cta" onclick="window.location.reload()">Refresh Page</button>
          <button class="cta secondary" onclick="window.history.back()">Go Back</button>
        </div>
      </div>
    `;

    // Inject styles if not already present
    this.injectStyles();

    // Replace the problematic component or show at top of page
    if (this.options.fallbackUI && typeof this.options.fallbackUI === 'string') {
      const targetElement = document.querySelector(this.options.fallbackUI);
      if (targetElement) {
        targetElement.innerHTML = '';
        targetElement.appendChild(fallbackContainer);
        return;
      }
    }

    // Show at top of page as fallback
    document.body.insertBefore(fallbackContainer, document.body.firstChild);
  }

  injectStyles() {
    if (document.getElementById('error-boundary-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'error-boundary-styles';
    style.textContent = `
      .error-boundary-fallback {

      .error-boundary-content {

      .error-icon {
        font-size: 64px;
        margin-bottom: 20px;
      }

      .error-boundary-content h2 {

      .error-boundary-content p {

      .error-details {

      .error-details summary {

      .error-details pre {

      .error-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
        flex-wrap: wrap;
      }
    `;
    document.head.appendChild(style);
  }

  escapeHtml(str) {
    if (!str) {
      return '';
    }
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  isProduction() {
    // Check for explicit environment variable first
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV) {
      return process.env.NODE_ENV === 'production';
    }

    // Check hostname for development patterns
    const hostname = window.location.hostname;
    const devPatterns = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      /^192\.168\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /\.local$/,
      /\.test$/,
      /^dev\./,
      /^staging\./,
    ];

    return !devPatterns.some(pattern => {
      if (typeof pattern === 'string') {
        return hostname === pattern;
      }
      return pattern.test(hostname);
    });
  }

  getErrors() {
    return this.errors;
  }

  clearErrors() {
    this.errors = [];
  }
}

// Wrap async functions with error handling
function withErrorHandler(fn, errorBoundary) {
  return async function (...args) {
    try {
      return await fn.apply(this, args);
    } catch (error) {
      if (errorBoundary) {
        errorBoundary.handleError(error, {
          type: 'async-function',
          functionName: fn.name,
        });
      } else {
        console.error('Error in async function:', error);
      }
      throw error;
    }
  };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ErrorBoundary, withErrorHandler };
}
