/**
 * EventFlow Toast Notification System
 * A lightweight toast notification system for success, error, warning, and info messages.
 * @version 1.0.0
 */
'use strict';

(function () {
  // Configuration
  const CONFIG = {
    defaultDuration: 5000,
    animationDuration: 300,
    maxToasts: 5,
    position: 'top-right',
  };

  // Toast container reference
  let toastContainer = null;

  /**
   * Initialize the toast container
   */
  function initContainer() {
    if (toastContainer) {
      return;
    }

    toastContainer = document.createElement('div');
    toastContainer.id = 'ef-toast-container';
    toastContainer.className = 'ef-toast-container';
    toastContainer.setAttribute('role', 'region');
    toastContainer.setAttribute('aria-label', 'Notifications');
    toastContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastContainer);
  }

  /**
   * Create a toast notification
   * @param {string} message - The message to display
   * @param {string} type - Type of toast: success, error, warning, info
   * @param {object} options - Additional options
   * @returns {HTMLElement} - The toast element
   */
  function createToast(message, type, options = {}) {
    initContainer();

    const duration = options.duration || CONFIG.defaultDuration;
    const id = `toast-${Date.now()}`;

    // Create toast element
    const toast = document.createElement('div');
    toast.id = id;
    toast.className = `ef-toast ef-toast--${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-atomic', 'true');

    // Toast icon
    const icons = {
      success:
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
      error:
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
      warning:
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      info: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
    };

    // Build toast content
    toast.innerHTML = `
      <div class="ef-toast__icon">${icons[type] || icons.info}</div>
      <div class="ef-toast__content">
        <span class="ef-toast__message">${escapeHtml(message)}</span>
      </div>
      <button class="ef-cta ef-toast__close" aria-label="Dismiss notification" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    `;

    // Close button functionality
    const closeBtn = toast.querySelector('.ef-toast__close');
    closeBtn.addEventListener('click', () => {
      dismissToast(toast);
    });

    // Add to container
    toastContainer.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('ef-toast--visible');
    });

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => {
        dismissToast(toast);
      }, duration);
    }

    // Limit max toasts
    enforceMaxToasts();

    // Announce to screen readers
    if (typeof window.announceToSR === 'function') {
      window.announceToSR(message);
    }

    return toast;
  }

  /**
   * Dismiss a toast notification
   * @param {HTMLElement} toast - The toast element to dismiss
   */
  function dismissToast(toast) {
    if (!toast || !toast.parentNode) {
      return;
    }

    toast.classList.remove('ef-toast--visible');
    toast.classList.add('ef-toast--hiding');

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, CONFIG.animationDuration);
  }

  /**
   * Enforce maximum number of toasts
   */
  function enforceMaxToasts() {
    if (!toastContainer) {
      return;
    }

    const toasts = toastContainer.querySelectorAll('.ef-toast');
    if (toasts.length > CONFIG.maxToasts) {
      const toRemove = toasts.length - CONFIG.maxToasts;
      for (let i = 0; i < toRemove; i++) {
        dismissToast(toasts[i]);
      }
    }
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} - Escaped text
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Clear all toasts
   */
  function clearAll() {
    if (!toastContainer) {
      return;
    }

    const toasts = toastContainer.querySelectorAll('.ef-toast');
    toasts.forEach(toast => {
      dismissToast(toast);
    });
  }

  // Public API
  const EFToast = {
    /**
     * Show a success toast
     * @param {string} message - The message to display
     * @param {object} options - Optional configuration
     */
    success: function (message, options) {
      return createToast(message, 'success', options);
    },

    /**
     * Show an error toast
     * @param {string} message - The message to display
     * @param {object} options - Optional configuration
     */
    error: function (message, options) {
      return createToast(message, 'error', options);
    },

    /**
     * Show a warning toast
     * @param {string} message - The message to display
     * @param {object} options - Optional configuration
     */
    warning: function (message, options) {
      return createToast(message, 'warning', options);
    },

    /**
     * Show an info toast
     * @param {string} message - The message to display
     * @param {object} options - Optional configuration
     */
    info: function (message, options) {
      return createToast(message, 'info', options);
    },

    /**
     * Show a custom toast
     * @param {string} message - The message to display
     * @param {string} type - Type: success, error, warning, info
     * @param {object} options - Optional configuration
     */
    show: function (message, type, options) {
      return createToast(message, type || 'info', options);
    },

    /**
     * Dismiss a specific toast
     * @param {HTMLElement} toast - The toast element
     */
    dismiss: function (toast) {
      dismissToast(toast);
    },

    /**
     * Clear all toasts
     */
    clearAll: clearAll,
  };

  // Expose globally
  window.EFToast = EFToast;

  // Initialize container on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContainer);
  } else {
    initContainer();
  }
})();
