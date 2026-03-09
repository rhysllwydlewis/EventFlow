/**
 * Shared utilities for EventFlow Admin Panel
 * Used across all admin pages for consistency
 */

const AdminShared = (function () {
  'use strict';

  // Debug flag - set to true to enable console logging
  // In production, set to false to reduce console spam
  const DEBUG = localStorage.getItem('ADMIN_DEBUG') === 'true';

  // Debug logging wrapper
  function debugLog(...args) {
    if (DEBUG) {
      console.log('[Admin]', ...args);
    }
  }

  function debugWarn(...args) {
    if (DEBUG) {
      console.warn('[Admin]', ...args);
    }
  }

  // Error logging (always show real errors)
  function debugError(...args) {
    console.error('[Admin]', ...args);
  }

  /**
   * Ensure modal styles are added to the document (only once)
   */
  function ensureModalStyles() {
    // Check if styles already exist
    if (document.getElementById('admin-modal-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'admin-modal-styles';
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .admin-modal-cancel:hover {
        background: #f3f4f6 !important;
      }
      .admin-modal-confirm:hover {
        opacity: 0.9;
      }
      .admin-modal-confirm:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `;
    document.head.appendChild(style);
  }

  // HTML escaping to prevent XSS
  function escapeHtml(unsafe) {
    if (!unsafe) {
      return '';
    }
    const div = document.createElement('div');
    div.textContent = String(unsafe);
    return div.innerHTML;
  }

  /**
   * Validation helpers
   */

  // Email validation regex (basic but comprehensive)
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Validate email format
  function validateEmail(email) {
    if (!email || typeof email !== 'string') {
      return 'Email is required';
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      return 'Please enter a valid email address';
    }
    return true;
  }

  // Validate password strength
  function validatePassword(password) {
    if (!password || typeof password !== 'string') {
      return 'Password is required';
    }
    if (password.length < 8) {
      return 'Password must be at least 8 characters long';
    }
    if (!/[A-Z]/.test(password)) {
      return 'Password must contain at least one uppercase letter';
    }
    if (!/[a-z]/.test(password)) {
      return 'Password must contain at least one lowercase letter';
    }
    if (!/[0-9]/.test(password)) {
      return 'Password must contain at least one number';
    }
    return true;
  }

  // Validate role (customer, supplier, admin)
  const VALID_ROLES = ['customer', 'supplier', 'admin'];

  /**
   * Validate user role
   * @param {string} role - The role to validate
   * @param {Array<string>} allowedRoles - Optional array of allowed roles (defaults to VALID_ROLES)
   * @returns {boolean|string} - true if valid, error message if invalid
   */
  function validateRole(role, allowedRoles = VALID_ROLES) {
    if (!role || typeof role !== 'string') {
      return 'Role is required';
    }
    const normalizedRole = role.toLowerCase().trim();
    if (!allowedRoles.includes(normalizedRole)) {
      return `Role must be one of: ${allowedRoles.join(', ')}`;
    }
    return true;
  }

  // Format dates consistently
  function formatDate(dateStr) {
    if (!dateStr) {
      return 'Never';
    }
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      return dateStr;
    }
  }

  // Format timestamps for relative time
  function formatTimestamp(timestamp) {
    if (!timestamp) {
      return 'Unknown';
    }
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 7) {
      return date.toLocaleDateString('en-GB');
    } else if (days > 0) {
      return `${days} day${days !== 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    } else {
      return 'Just now';
    }
  }

  // API wrapper with CSRF token support
  async function api(url, method = 'GET', body = null) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    };

    // Add CSRF token for state-changing requests
    if (['POST', 'PUT', 'DELETE'].includes(method.toUpperCase())) {
      if (window.__CSRF_TOKEN__) {
        opts.headers['X-CSRF-Token'] = window.__CSRF_TOKEN__;
      }
    }

    if (body) {
      opts.body = JSON.stringify(body);
    }

    const response = await fetch(url, opts);
    const contentType = response.headers.get('content-type');
    const isJson = contentType && contentType.includes('application/json');

    if (isJson) {
      const data = await response.json();
      if (!response.ok) {
        // Provide more specific error messages for common HTTP codes
        let errorMessage = data.error || `Request failed with status ${response.status}`;

        if (response.status === 404) {
          errorMessage = data.error || `Resource not found: ${url}`;
        } else if (response.status === 401) {
          errorMessage = 'Authentication required. Please log in again.';
          // Optionally redirect to login after a delay (with origin validation)
          setTimeout(() => {
            const currentPath = window.location.pathname;
            if (currentPath !== '/auth' && currentPath !== '/auth.html') {
              // Use relative path instead of full URL for security
              const returnPath =
                window.location.pathname + window.location.search + window.location.hash;
              const loginUrl = `/auth?redirect=${encodeURIComponent(returnPath)}`;
              // Ensure the redirect is to the same origin
              if (loginUrl.startsWith('/')) {
                window.location.href = loginUrl;
              }
            }
          }, 2000);
        } else if (response.status === 403) {
          errorMessage = 'Access denied. You do not have permission to perform this action.';
        } else if (response.status === 500) {
          errorMessage = 'Server error. Please try again later.';
        } else if (response.status === 503) {
          errorMessage = 'Service temporarily unavailable. The database may be connecting.';
        }

        throw new Error(errorMessage);
      }
      return data;
    } else {
      const text = await response.text();
      if (!response.ok) {
        const errorMessage = text || `Request failed with status ${response.status}`;
        throw new Error(errorMessage);
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        return { message: text };
      }
    }
  }

  /**
   * adminFetch - Enhanced fetch wrapper specifically for admin API calls
   * Handles auth failures, errors, and console logging consistently
   * @param {string} url - API endpoint URL
   * @param {Object} options - fetch options (method, body, etc.)
   * @returns {Promise<any>} Response data
   */
  async function adminFetch(url, options = {}) {
    const method = options.method || 'GET';
    const isWriteOperation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase());

    debugLog(`${method} ${url}`, options.body ? { body: options.body } : '');

    try {
      const opts = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        credentials: 'include',
      };

      // Add CSRF token for write operations
      if (isWriteOperation) {
        if (window.__CSRF_TOKEN__) {
          opts.headers['X-CSRF-Token'] = window.__CSRF_TOKEN__;
        } else {
          debugWarn(`CSRF token missing for ${method} ${url} - request may be rejected by server`);
        }
      }

      if (options.body) {
        opts.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      }

      const response = await fetch(url, opts);
      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');

      // Handle auth failures
      if (response.status === 401) {
        debugWarn('401 Unauthorized - redirecting to login');
        const currentPath = window.location.pathname;
        const redirectUrl = `/auth?redirect=${encodeURIComponent(currentPath)}`;
        window.location.href = redirectUrl;
        throw new Error('Authentication required');
      }

      if (response.status === 403) {
        debugWarn('403 Forbidden - insufficient permissions');
        showToast('You do not have permission to perform this action', 'error');
        throw new Error('Forbidden: Insufficient permissions');
      }

      // Parse response
      let data;
      if (isJson) {
        data = await response.json();
      } else {
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = { message: text };
        }
      }

      // Handle non-OK responses
      if (!response.ok) {
        const errorMessage =
          data.error || data.message || `Request failed with status ${response.status}`;

        // Log error based on status
        if (response.status >= 500) {
          debugError(`Server error (${response.status}):`, errorMessage);
        } else if (response.status === 404) {
          // 404s are often expected (e.g., checking if resource exists)
          debugLog(`Resource not found (404): ${url}`);
        } else {
          debugWarn(`Request failed (${response.status}):`, errorMessage);
        }

        throw new Error(errorMessage);
      }

      debugLog(`${method} ${url} - Success`, data);
      return data;
    } catch (error) {
      // Only log if not already logged above
      if (
        !error.message.includes('Authentication required') &&
        !error.message.includes('Forbidden')
      ) {
        debugError(`${method} ${url} - Error:`, error.message);
      }
      throw error;
    }
  }

  // Fetch CSRF token
  async function fetchCSRFToken() {
    try {
      const data = await fetch('/api/v1/csrf-token', { credentials: 'include' }).then(r =>
        r.json()
      );
      if (data && data.csrfToken) {
        window.__CSRF_TOKEN__ = data.csrfToken;
      }
    } catch (err) {
      console.warn('Could not fetch CSRF token:', err);
    }
  }

  // Show toast notification
  function showToast(message, type = 'info') {
    // If Toast library is available, use it
    if (typeof Toast !== 'undefined') {
      Toast[type](message);
      return;
    }

    // Fallback: create simple toast
    const toast = document.createElement('div');
    toast.className = `admin-toast admin-toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 1rem 1.5rem;
      background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      opacity: 0;
      transform: translateX(400px);
      transition: all 0.3s ease;
    `;
    document.body.appendChild(toast);

    // Trigger animation
    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    }, 10);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(400px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Show confirmation modal (better than browser confirm)
   * @param {Object} options - Configuration object
   * @param {string} options.title - Modal title
   * @param {string} options.message - Modal message
   * @param {string} options.confirmText - Confirm button text (default: 'Confirm')
   * @param {string} options.cancelText - Cancel button text (default: 'Cancel')
   * @param {string} options.type - Modal type: 'danger', 'warning', 'info' (default: 'info')
   * @returns {Promise<boolean>} Resolves to true if confirmed, false if cancelled
   */
  function showConfirmModal(options = {}) {
    const {
      title = 'Confirm Action',
      message = 'Are you sure you want to proceed?',
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      type = 'info',
    } = options;

    return new Promise(resolve => {
      // Store previously focused element for focus return
      const previouslyFocused = document.activeElement;

      // Lock body scroll
      const originalOverflow = document.body.style.overflow;
      const originalPaddingRight = document.body.style.paddingRight;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }

      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'admin-modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'modal-title');
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
        animation: fadeIn 0.2s ease;
      `;

      // Create modal dialog
      const dialog = document.createElement('div');
      dialog.className = 'admin-modal-dialog';
      dialog.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 1.5rem;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        animation: slideUp 0.3s ease;
      `;

      // Icon and color based on type
      const typeConfig = {
        danger: { icon: '⚠️', color: '#ef4444' },
        warning: { icon: '⚠️', color: '#f59e0b' },
        info: { icon: 'ℹ️', color: '#3b82f6' },
      };
      const config = typeConfig[type] || typeConfig.info;

      dialog.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 1.5rem;">
          <div style="font-size: 2rem; flex-shrink: 0;">${config.icon}</div>
          <div style="flex: 1;">
            <h3 id="modal-title" style="margin: 0 0 0.5rem 0; font-size: 1.25rem; font-weight: 600; color: #1f2937;">
              ${escapeHtml(title)}
            </h3>
            <p style="margin: 0; color: #6b7280; line-height: 1.5;">
              ${escapeHtml(message)}
            </p>
          </div>
        </div>
        <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
          <button class="admin-modal-cancel" style="
            padding: 0.5rem 1rem;
            border: 1px solid #d1d5db;
            background: white;
            color: #374151;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
            transition: all 0.2s;
          ">
            ${escapeHtml(cancelText)}
          </button>
          <button class="admin-modal-confirm" style="
            padding: 0.5rem 1rem;
            border: none;
            background: ${config.color};
            color: white;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
            transition: all 0.2s;
          ">
            ${escapeHtml(confirmText)}
          </button>
        </div>
      `;

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      // Ensure modal styles are loaded
      ensureModalStyles();

      // Handle button clicks
      const confirmBtn = dialog.querySelector('.admin-modal-confirm');
      const cancelBtn = dialog.querySelector('.admin-modal-cancel');

      // Focus first interactive element
      setTimeout(() => cancelBtn.focus(), 100);

      // Focus trap
      const focusableElements = dialog.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      const trapFocus = e => {
        if (e.key === 'Tab') {
          if (e.shiftKey && document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable.focus();
          } else if (!e.shiftKey && document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable.focus();
          }
        }
      };

      dialog.addEventListener('keydown', trapFocus);

      const cleanup = () => {
        overlay.style.animation = 'fadeOut 0.2s ease';
        setTimeout(() => {
          overlay.remove();
          // Restore body scroll
          document.body.style.overflow = originalOverflow;
          document.body.style.paddingRight = originalPaddingRight;
          // Return focus
          if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
            previouslyFocused.focus();
          }
        }, 200);
      };

      confirmBtn.addEventListener('click', () => {
        cleanup();
        resolve(true);
      });

      cancelBtn.addEventListener('click', () => {
        cleanup();
        resolve(false);
      });

      // Close on overlay click
      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          cleanup();
          resolve(false);
        }
      });

      // Close on Escape key
      const handleEscape = e => {
        if (e.key === 'Escape') {
          cleanup();
          resolve(false);
          document.removeEventListener('keydown', handleEscape);
        }
      };
      document.addEventListener('keydown', handleEscape);
    });
  }

  /**
   * Show input modal for collecting user input (better than browser prompt)
   * @param {Object} options - Configuration object
   * @param {string} options.title - Modal title
   * @param {string} options.message - Modal message/description
   * @param {string} options.label - Input field label
   * @param {string} options.placeholder - Input placeholder text
   * @param {string} options.initialValue - Initial input value (default: '')
   * @param {boolean} options.required - Whether input is required (default: true)
   * @param {Function} options.validateFn - Custom validation function (value) => boolean|string
   * @param {string} options.confirmText - Confirm button text (default: 'Confirm')
   * @param {string} options.cancelText - Cancel button text (default: 'Cancel')
   * @param {string} options.type - Input type: 'text' or 'textarea' (default: 'text')
   * @returns {Promise<{confirmed: boolean, value: string|null}>} Resolves with confirmation status and value
   */
  function showInputModal(options = {}) {
    const {
      title = 'Input Required',
      message = '',
      label = '',
      placeholder = '',
      initialValue = '',
      required = true,
      validateFn = null,
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      type = 'text',
    } = options;

    return new Promise(resolve => {
      // Store previously focused element for focus return
      const previouslyFocused = document.activeElement;

      // Lock body scroll
      const originalOverflow = document.body.style.overflow;
      const originalPaddingRight = document.body.style.paddingRight;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }

      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'admin-modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'modal-input-title');
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
        animation: fadeIn 0.2s ease;
      `;

      // Create modal dialog
      const dialog = document.createElement('div');
      dialog.className = 'admin-modal-dialog';
      dialog.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 1.5rem;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        animation: slideUp 0.3s ease;
      `;

      // Build modal content
      const messageHtml = message
        ? `<p style="margin: 0 0 1rem 0; color: #6b7280; line-height: 1.5;">${escapeHtml(message)}</p>`
        : '';
      const labelHtml = label
        ? `<label for="admin-input-field" style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #374151;">${escapeHtml(label)}</label>`
        : '';

      const inputElement =
        type === 'textarea'
          ? `<textarea id="admin-input-field" rows="4" placeholder="${escapeHtml(placeholder)}" style="
              width: 100%;
              padding: 0.5rem;
              border: 1px solid #d1d5db;
              border-radius: 6px;
              font-size: 0.875rem;
              font-family: inherit;
              resize: vertical;
            ">${escapeHtml(initialValue)}</textarea>`
          : `<input type="text" id="admin-input-field" value="${escapeHtml(initialValue)}" placeholder="${escapeHtml(placeholder)}" style="
              width: 100%;
              padding: 0.5rem;
              border: 1px solid #d1d5db;
              border-radius: 6px;
              font-size: 0.875rem;
            ">`;

      dialog.innerHTML = `
        <div style="margin-bottom: 1.5rem;">
          <h3 id="modal-input-title" style="margin: 0 0 0.5rem 0; font-size: 1.25rem; font-weight: 600; color: #1f2937;">
            ${escapeHtml(title)}
          </h3>
          ${messageHtml}
        </div>
        <div style="margin-bottom: 1rem;">
          ${labelHtml}
          ${inputElement}
          <div id="input-error" style="margin-top: 0.5rem; color: #ef4444; font-size: 0.875rem; display: none;"></div>
        </div>
        <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
          <button class="admin-modal-cancel" style="
            padding: 0.5rem 1rem;
            border: 1px solid #d1d5db;
            background: white;
            color: #374151;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
            transition: all 0.2s;
          ">
            ${escapeHtml(cancelText)}
          </button>
          <button class="admin-modal-confirm" style="
            padding: 0.5rem 1rem;
            border: none;
            background: #3b82f6;
            color: white;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
            transition: all 0.2s;
          ">
            ${escapeHtml(confirmText)}
          </button>
        </div>
      `;

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      // Ensure modal styles are loaded
      ensureModalStyles();

      // Get elements
      const inputField = dialog.querySelector('#admin-input-field');
      const errorDiv = dialog.querySelector('#input-error');
      const confirmBtn = dialog.querySelector('.admin-modal-confirm');
      const cancelBtn = dialog.querySelector('.admin-modal-cancel');

      // Focus input field
      setTimeout(() => inputField.focus(), 100);

      // Focus trap
      const focusableElements = dialog.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      const trapFocus = e => {
        if (e.key === 'Tab') {
          if (e.shiftKey && document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable.focus();
          } else if (!e.shiftKey && document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable.focus();
          }
        }
      };

      dialog.addEventListener('keydown', trapFocus);

      // Validation function
      const validateInput = () => {
        const value = inputField.value.trim();

        // Check required
        if (required && !value) {
          errorDiv.textContent = 'This field is required';
          errorDiv.style.display = 'block';
          confirmBtn.disabled = true;
          return false;
        }

        // Custom validation
        if (validateFn) {
          const validationResult = validateFn(value);
          if (validationResult !== true) {
            errorDiv.textContent =
              typeof validationResult === 'string' ? validationResult : 'Invalid input';
            errorDiv.style.display = 'block';
            confirmBtn.disabled = true;
            return false;
          }
        }

        // Valid
        errorDiv.style.display = 'none';
        confirmBtn.disabled = false;
        return true;
      };

      // Validate on input
      inputField.addEventListener('input', validateInput);

      // Initial validation
      if (required || validateFn) {
        validateInput();
      }

      const cleanup = () => {
        overlay.style.animation = 'fadeOut 0.2s ease';
        setTimeout(() => {
          overlay.remove();
          // Restore body scroll
          document.body.style.overflow = originalOverflow;
          document.body.style.paddingRight = originalPaddingRight;
          // Return focus
          if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
            previouslyFocused.focus();
          }
        }, 200);
      };

      // Handle confirm
      const handleConfirm = () => {
        if (validateInput()) {
          const value = inputField.value.trim();
          cleanup();
          resolve({ confirmed: true, value });
        }
      };

      confirmBtn.addEventListener('click', handleConfirm);

      // Handle cancel
      cancelBtn.addEventListener('click', () => {
        cleanup();
        resolve({ confirmed: false, value: null });
      });

      // Close on overlay click
      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          cleanup();
          resolve({ confirmed: false, value: null });
        }
      });

      // Close on Escape key
      const handleEscape = e => {
        if (e.key === 'Escape') {
          cleanup();
          resolve({ confirmed: false, value: null });
          document.removeEventListener('keydown', handleEscape);
        } else if (e.key === 'Enter' && !e.shiftKey && type === 'text') {
          // Submit on Enter for text inputs (but not textarea)
          e.preventDefault();
          handleConfirm();
        }
      };
      document.addEventListener('keydown', handleEscape);
    });
  }

  // Confirm dialog — uses showConfirmModal (no native dialog)
  function confirm(message) {
    return showConfirmModal({ title: 'Confirm', message: message, confirmText: 'OK' });
  }

  // Load badge counts for sidebar
  async function loadBadgeCounts() {
    try {
      const counts = await api('/api/admin/badge-counts');

      const elements = {
        newUsersCount: counts.newUsers || 0,
        pendingPhotosCount: counts.pendingPhotos || 0,
        openTicketsCount: counts.openTickets || 0,
      };

      for (const [id, count] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) {
          el.textContent = count > 0 ? count : '';
          el.style.display = count > 0 ? 'inline-block' : 'none';
        }
      }
    } catch (err) {
      console.error('Failed to load badge counts:', err);
    }
  }

  // Highlight active page in top navbar
  function highlightActivePage() {
    const currentPath = window.location.pathname;
    document.querySelectorAll('.admin-nav-btn').forEach(link => {
      const href = link.getAttribute('href');
      if (href === currentPath) {
        link.classList.add('active');
      }
    });
  }

  /**
   * Load the shared admin navbar partial into a placeholder element.
   * Usage: place <div id="admin-navbar"></div> in the page body and call
   * AdminShared.loadNavbar() (or it is called automatically during init).
   */
  function loadNavbar() {
    const placeholder = document.getElementById('admin-navbar');
    if (!placeholder) {
      return Promise.resolve();
    }
    return fetch('/partials/admin-navbar.html')
      .then(r => {
        return r.ok ? r.text() : Promise.reject(r.status);
      })
      .then(html => {
        placeholder.outerHTML = html;
      })
      .catch(err => {
        console.warn('[AdminShared] Could not load navbar partial:', err);
      });
  }

  // Initialize sidebar toggle for mobile
  function initSidebarToggle() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('adminSidebar');

    if (toggle && sidebar) {
      // Restore sidebar state from localStorage on mobile only
      const savedState = localStorage.getItem('adminSidebarOpen');
      if (savedState === 'true' && window.innerWidth <= 1024) {
        sidebar.classList.add('open');
      }

      // Toggle sidebar and save state
      toggle.addEventListener('click', e => {
        e.stopPropagation();
        sidebar.classList.toggle('open');
        const isOpen = sidebar.classList.contains('open');
        localStorage.setItem('adminSidebarOpen', isOpen);

        // Update ARIA attribute for accessibility
        toggle.setAttribute('aria-expanded', isOpen);
      });

      // Close sidebar when clicking outside on mobile
      document.addEventListener('click', e => {
        if (window.innerWidth <= 1024) {
          if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
            if (sidebar.classList.contains('open')) {
              sidebar.classList.remove('open');
              localStorage.setItem('adminSidebarOpen', 'false');
              toggle.setAttribute('aria-expanded', 'false');
            }
          }
        }
      });

      // Handle responsive changes - ensure sidebar state is correct
      window.addEventListener('resize', () => {
        if (window.innerWidth > 1024) {
          // On desktop, remove the 'open' class (sidebar is visible by default via CSS)
          if (sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
          }
        }
      });

      // Set initial ARIA state
      toggle.setAttribute('aria-expanded', sidebar.classList.contains('open'));
    }
  }

  // Generate unique ID
  function generateId(prefix = 'item') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  // Format file size
  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) {
      return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
  }

  // Debounce function for search
  function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Animated counter for stat cards
  function animateCounter(element, target, duration = 1000) {
    if (!element) {
      return;
    }

    const start = 0;
    const increment = target / (duration / 16); // 60fps
    let current = start;

    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        element.textContent = target;
        clearInterval(timer);
      } else {
        element.textContent = Math.floor(current);
      }
    }, 16);
  }

  // Enhanced Toast with action buttons
  function showEnhancedToast(message, type = 'info', options = {}) {
    const { action, actionLabel, duration = 5000 } = options;

    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'false');
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconMap = {
      success: '✓',
      error: '✗',
      warning: '⚠',
      info: 'ℹ',
    };

    toast.innerHTML = `
      <div class="toast-icon">${iconMap[type] || iconMap.info}</div>
      <div class="toast-content">
        <div class="toast-message">${escapeHtml(message)}</div>
        ${action && actionLabel ? `<button class="toast-action">${escapeHtml(actionLabel)}</button>` : ''}
      </div>
      <button class="toast-close">×</button>
    `;

    container.appendChild(toast);

    // Close button
    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        toast.remove();
      });
    }

    // Action button
    if (action && actionLabel) {
      const actionBtn = toast.querySelector('.toast-action');
      if (actionBtn) {
        actionBtn.addEventListener('click', () => {
          action();
          toast.remove();
        });
      }
    }

    // Auto dismiss
    if (duration > 0) {
      setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
  }

  // Keyboard shortcuts handler
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
      // Ctrl/Cmd + K - Command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openCommandPalette();
      }

      // Ctrl/Cmd + / - Show shortcuts help
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        showShortcutsHelp();
      }

      // R - Refresh current page
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !isInputFocused()) {
        e.preventDefault();
        window.location.reload();
      }

      // H - Go to dashboard home
      if (e.key === 'h' && !e.ctrlKey && !e.metaKey && !isInputFocused()) {
        e.preventDefault();
        window.location.href = '/admin';
      }

      // U - Go to users
      if (e.key === 'u' && !e.ctrlKey && !e.metaKey && !isInputFocused()) {
        e.preventDefault();
        window.location.href = '/admin-users';
      }

      // P - Go to packages
      if (e.key === 'p' && !e.ctrlKey && !e.metaKey && !isInputFocused()) {
        e.preventDefault();
        window.location.href = '/admin-packages';
      }

      // S - Go to settings
      if (e.key === 's' && !e.ctrlKey && !e.metaKey && !isInputFocused()) {
        e.preventDefault();
        window.location.href = '/admin-settings';
      }

      // Escape - Close modals
      if (e.key === 'Escape') {
        closeModals();
      }
    });
  }

  function isInputFocused() {
    const activeElement = document.activeElement;
    return (
      activeElement &&
      (activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable)
    );
  }

  function openCommandPalette() {
    // Check if command palette exists, if not create it
    let palette = document.getElementById('commandPalette');
    if (!palette) {
      palette = createCommandPalette();
    }
    palette.style.display = 'flex';
    const searchInput = palette.querySelector('.command-search');
    if (searchInput) {
      searchInput.focus();
    }
  }

  function createCommandPalette() {
    const palette = document.createElement('div');
    palette.id = 'commandPalette';
    palette.className = 'command-palette';
    palette.innerHTML = `
      <div class="command-palette-dialog">
        <input type="text" class="command-search" placeholder="Type a command or search..." />
        <div class="command-results">
          <div class="command-group">
            <div class="command-group-title">Navigation</div>
            <button class="command-item" data-action="dashboard">
              <span class="command-icon">📊</span>
              <span class="command-label">Dashboard</span>
              <span class="command-shortcut">H</span>
            </button>
            <button class="command-item" data-action="users">
              <span class="command-icon">👥</span>
              <span class="command-label">Users</span>
              <span class="command-shortcut">U</span>
            </button>
            <button class="command-item" data-action="packages">
              <span class="command-icon">📦</span>
              <span class="command-label">Packages</span>
              <span class="command-shortcut">P</span>
            </button>
            <button class="command-item" data-action="settings">
              <span class="command-icon">⚙️</span>
              <span class="command-label">Settings</span>
              <span class="command-shortcut">S</span>
            </button>
          </div>
          <div class="command-group">
            <div class="command-group-title">Actions</div>
            <button class="command-item" data-action="refresh">
              <span class="command-icon">🔄</span>
              <span class="command-label">Refresh Page</span>
              <span class="command-shortcut">R</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(palette);

    // Handle clicks
    palette.addEventListener('click', e => {
      if (e.target === palette) {
        palette.style.display = 'none';
      }
    });

    // Handle command selection
    palette.querySelectorAll('.command-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.getAttribute('data-action');
        executeCommand(action);
        palette.style.display = 'none';
      });
    });

    return palette;
  }

  function executeCommand(action) {
    const actions = {
      dashboard: () => (window.location.href = '/admin'),
      users: () => (window.location.href = '/admin-users'),
      packages: () => (window.location.href = '/admin-packages'),
      settings: () => (window.location.href = '/admin-settings'),
      refresh: () => window.location.reload(),
    };

    if (actions[action]) {
      actions[action]();
    }
  }

  function showShortcutsHelp() {
    const helpModal = document.createElement('div');
    helpModal.className = 'modal-overlay';
    helpModal.innerHTML = `
      <div class="modal-dialog" style="max-width: 500px;">
        <div class="modal-header">
          <h3 class="modal-title">Keyboard Shortcuts</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="shortcuts-list">
            <div class="shortcut-item">
              <span class="shortcut-keys"><kbd>Ctrl/Cmd</kbd> + <kbd>K</kbd></span>
              <span class="shortcut-desc">Open command palette</span>
            </div>
            <div class="shortcut-item">
              <span class="shortcut-keys"><kbd>Ctrl/Cmd</kbd> + <kbd>/</kbd></span>
              <span class="shortcut-desc">Show this help</span>
            </div>
            <div class="shortcut-item">
              <span class="shortcut-keys"><kbd>R</kbd></span>
              <span class="shortcut-desc">Refresh current page</span>
            </div>
            <div class="shortcut-item">
              <span class="shortcut-keys"><kbd>H</kbd></span>
              <span class="shortcut-desc">Go to dashboard</span>
            </div>
            <div class="shortcut-item">
              <span class="shortcut-keys"><kbd>U</kbd></span>
              <span class="shortcut-desc">Go to users</span>
            </div>
            <div class="shortcut-item">
              <span class="shortcut-keys"><kbd>P</kbd></span>
              <span class="shortcut-desc">Go to packages</span>
            </div>
            <div class="shortcut-item">
              <span class="shortcut-keys"><kbd>S</kbd></span>
              <span class="shortcut-desc">Go to settings</span>
            </div>
            <div class="shortcut-item">
              <span class="shortcut-keys"><kbd>Esc</kbd></span>
              <span class="shortcut-desc">Close modals</span>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(helpModal);

    helpModal.addEventListener('click', e => {
      if (e.target === helpModal) {
        helpModal.remove();
      }
    });
  }

  function closeModals() {
    // Close all modals with class 'modal-overlay'
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.style.display = 'none';
    });

    // Close command palette
    const palette = document.getElementById('commandPalette');
    if (palette) {
      palette.style.display = 'none';
    }
  }

  /**
   * List State Management Utilities
   * Helpers for consistent loading/error/empty states across admin list pages
   */

  /**
   * Show loading state in a container
   * @param {string|HTMLElement} container - Container selector or element
   * @param {Object} options - Configuration options
   * @param {number} options.rows - Number of skeleton rows (default: 5)
   * @param {number} options.cols - Number of skeleton columns (default: 6)
   * @param {string} options.message - Loading message (default: 'Loading...')
   */
  function showLoadingState(container, options = {}) {
    const { rows = 5, cols = 6, message = 'Loading...' } = options;
    const element = typeof container === 'string' ? document.querySelector(container) : container;

    if (!element) {
      debugWarn('showLoadingState: container not found');
      return;
    }

    // Create skeleton table rows
    const skeletonRows = Array.from({ length: rows }, () => {
      const cells = Array.from(
        { length: cols },
        () => '<td><div class="skeleton-line"></div></td>'
      ).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    element.innerHTML = `
      <tr>
        <td colspan="${cols}" style="text-align: center; padding: 20px;">
          <div class="loading-spinner"></div>
          <div style="margin-top: 10px; color: #6b7280;">${escapeHtml(message)}</div>
        </td>
      </tr>
      ${skeletonRows}
    `;

    // Add styles if not already present
    if (!document.getElementById('admin-list-states-styles')) {
      const style = document.createElement('style');
      style.id = 'admin-list-states-styles';
      style.textContent = `
        .skeleton-line {
          height: 16px;
          background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
          background-size: 200% 100%;
          animation: skeleton-loading 1.5s infinite;
          border-radius: 4px;
        }
        @keyframes skeleton-loading {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .loading-spinner {
          width: 40px;
          height: 40px;
          margin: 0 auto;
          border: 4px solid #f3f4f6;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spinner-rotate 0.8s linear infinite;
        }
        @keyframes spinner-rotate {
          to { transform: rotate(360deg); }
        }
        .error-state, .empty-state {
          text-align: center;
          padding: 60px 20px;
        }
        .error-state-icon, .empty-state-icon {
          font-size: 48px;
          margin-bottom: 16px;
        }
        .error-state-title, .empty-state-title {
          font-size: 20px;
          font-weight: 600;
          color: #1f2937;
          margin-bottom: 8px;
        }
        .error-state-message, .empty-state-message {
          color: #6b7280;
          margin-bottom: 20px;
        }
      `;
      document.head.appendChild(style);
    }
  }

  /**
   * Show error state in a container
   * @param {string|HTMLElement} container - Container selector or element
   * @param {Object} options - Configuration options
   * @param {string} options.message - Error message
   * @param {Function} options.onRetry - Retry callback function
   * @param {number} options.colspan - Number of columns to span (default: 6)
   */
  function showErrorState(container, options = {}) {
    const {
      message = 'Failed to load data. Please try again.',
      onRetry = null,
      colspan = 6,
    } = options;
    const element = typeof container === 'string' ? document.querySelector(container) : container;

    if (!element) {
      debugWarn('showErrorState: container not found');
      return;
    }

    const retryButtonHtml = onRetry
      ? `<button class="btn btn-primary" id="retry-btn" style="margin-top: 12px;">🔄 Retry</button>`
      : '';

    element.innerHTML = `
      <tr>
        <td colspan="${colspan}">
          <div class="error-state">
            <div class="error-state-icon">⚠️</div>
            <div class="error-state-title">Error Loading Data</div>
            <div class="error-state-message">${escapeHtml(message)}</div>
            ${retryButtonHtml}
          </div>
        </td>
      </tr>
    `;

    if (onRetry) {
      const retryBtn = element.querySelector('#retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', async () => {
          retryBtn.disabled = true;
          retryBtn.textContent = 'Retrying...';
          try {
            await onRetry();
          } catch (error) {
            debugError('Retry failed:', error);
            retryBtn.disabled = false;
            retryBtn.textContent = '🔄 Retry';
          }
        });
      }
    }
  }

  /**
   * Show empty state in a container
   * @param {string|HTMLElement} container - Container selector or element
   * @param {Object} options - Configuration options
   * @param {string} options.message - Empty state message
   * @param {string} options.icon - Icon to display (default: '📭')
   * @param {string} options.actionLabel - Optional action button label
   * @param {Function} options.onAction - Optional action button callback
   * @param {number} options.colspan - Number of columns to span (default: 6)
   */
  function showEmptyState(container, options = {}) {
    const {
      message = 'No items found',
      icon = '📭',
      actionLabel = null,
      onAction = null,
      colspan = 6,
    } = options;
    const element = typeof container === 'string' ? document.querySelector(container) : container;

    if (!element) {
      debugWarn('showEmptyState: container not found');
      return;
    }

    const actionButtonHtml =
      actionLabel && onAction
        ? `<button class="btn btn-primary" id="empty-action-btn" style="margin-top: 12px;">${escapeHtml(actionLabel)}</button>`
        : '';

    element.innerHTML = `
      <tr>
        <td colspan="${colspan}">
          <div class="empty-state">
            <div class="empty-state-icon">${icon}</div>
            <div class="empty-state-title">No Results</div>
            <div class="empty-state-message">${escapeHtml(message)}</div>
            ${actionButtonHtml}
          </div>
        </td>
      </tr>
    `;

    if (actionLabel && onAction) {
      const actionBtn = element.querySelector('#empty-action-btn');
      if (actionBtn) {
        actionBtn.addEventListener('click', onAction);
      }
    }
  }

  /**
   * Disable a button and show loading state
   * @param {HTMLElement} button - Button element
   * @param {string} loadingText - Text to show while loading (default: 'Loading...')
   * @returns {Function} Function to re-enable the button
   */
  function disableButton(button, loadingText = 'Loading...') {
    if (!button) {
      debugWarn('disableButton: button not found');
      return () => {};
    }

    const originalText = button.textContent;
    const originalDisabled = button.disabled;

    button.disabled = true;
    button.textContent = loadingText;
    button.style.opacity = '0.6';
    button.style.cursor = 'not-allowed';

    // Return a function to re-enable
    return () => {
      button.disabled = originalDisabled;
      button.textContent = originalText;
      button.style.opacity = '';
      button.style.cursor = '';
    };
  }

  /**
   * Safe action wrapper - prevents double-clicks and shows loading state
   * @param {HTMLElement} button - Button element
   * @param {Function} action - Async action to perform
   * @param {Object} options - Configuration options
   * @param {string} options.loadingText - Loading button text
   * @param {string} options.successMessage - Success toast message
   * @param {string} options.errorMessage - Error toast message prefix
   */
  async function safeAction(button, action, options = {}) {
    const {
      loadingText = 'Processing...',
      successMessage = null,
      errorMessage = 'Action failed',
    } = options;

    if (!button) {
      debugWarn('safeAction: button not found');
      return;
    }

    // Prevent double-clicks
    if (button.disabled) {
      return;
    }

    const restore = disableButton(button, loadingText);

    try {
      const result = await action();

      if (successMessage) {
        showToast(successMessage, 'success');
      }

      return result;
    } catch (error) {
      debugError('Action failed:', error);
      const errorMsg = error.message || errorMessage;
      showToast(errorMsg, 'error');
      throw error;
    } finally {
      restore();
    }
  }

  /**
   * Fetch with timeout protection
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @param {number} timeoutMs - Timeout in milliseconds (default: 10000)
   * @returns {Promise} Response from fetch
   */
  async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }
  }

  /**
   * Enhanced adminFetch with timeout and retry logic
   * @param {string} url - API endpoint URL
   * @param {Object} options - fetch options (method, body, timeout, retries)
   * @returns {Promise<any>} Response data
   */
  async function adminFetchWithTimeout(url, options = {}) {
    const method = options.method || 'GET';
    const isWriteOperation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase());
    const timeoutMs = options.timeout || 10000; // Default 10 second timeout
    const maxRetries = options.retries || 0; // Default no retries

    // Retry configuration constants
    const RETRY_BASE_DELAY_MS = 1000; // 1 second base delay
    const RETRY_BACKOFF_FACTOR = 2; // Exponential backoff factor
    const RETRY_MAX_DELAY_MS = 5000; // Max 5 second delay between retries

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        debugLog(`Retry attempt ${attempt}/${maxRetries} for ${method} ${url}`);
        // Wait before retry (exponential backoff with cap)
        const delay = Math.min(
          RETRY_BASE_DELAY_MS * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1),
          RETRY_MAX_DELAY_MS
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      try {
        debugLog(`${method} ${url}`, options.body ? { body: options.body } : '');

        const opts = {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
          credentials: 'include',
        };

        // Add CSRF token for write operations
        if (isWriteOperation) {
          if (window.__CSRF_TOKEN__) {
            opts.headers['X-CSRF-Token'] = window.__CSRF_TOKEN__;
          } else {
            debugWarn(
              `CSRF token missing for ${method} ${url} - request may be rejected by server`
            );
          }
        }

        if (options.body) {
          opts.body =
            typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        }

        const response = await fetchWithTimeout(url, opts, timeoutMs);
        const contentType = response.headers.get('content-type');
        // Add null/undefined check before calling indexOf/includes
        const isJson =
          contentType &&
          typeof contentType === 'string' &&
          contentType.includes('application/json');

        // Handle auth failures
        if (response.status === 401) {
          debugWarn('401 Unauthorized - redirecting to login');
          const currentPath = window.location.pathname;
          const redirectUrl = `/auth?redirect=${encodeURIComponent(currentPath)}`;
          window.location.href = redirectUrl;
          throw new Error('Authentication required');
        }

        if (response.status === 403) {
          debugWarn('403 Forbidden - insufficient permissions');
          showToast('You do not have permission to perform this action', 'error');
          throw new Error('Forbidden: Insufficient permissions');
        }

        // Parse response
        let data;
        if (isJson) {
          data = await response.json();
        } else {
          const text = await response.text();
          try {
            data = JSON.parse(text);
          } catch {
            data = { message: text };
          }
        }

        // Handle non-OK responses
        if (!response.ok) {
          // Special case: 424 Failed Dependency is used by some endpoints
          // (e.g., Pexels test) to indicate a valid response about unavailable dependencies
          // Return the data instead of throwing an error
          if (response.status === 424 && data && typeof data === 'object') {
            debugLog(`Failed dependency (424): ${url}`, data);
            return data;
          }

          const errorMessage =
            data.error || data.message || `Request failed with status ${response.status}`;

          // Log error based on status
          if (response.status >= 500) {
            debugError(`Server error (${response.status}):`, errorMessage);
          } else if (response.status === 404) {
            debugLog(`Resource not found (404): ${url}`);
          } else if (response.status === 504) {
            debugError(`Gateway timeout (504):`, errorMessage);
          } else {
            debugWarn(`Request failed (${response.status}):`, errorMessage);
          }

          // Create detailed error with response data
          const error = new Error(errorMessage);
          error.status = response.status;
          error.data = data;
          throw error;
        }

        debugLog(`${method} ${url} - Success`, data);
        return data;
      } catch (error) {
        lastError = error;

        // Don't retry on auth errors or client errors (4xx except 408 and 429)
        if (
          error.message.includes('Authentication required') ||
          error.message.includes('Forbidden') ||
          (error.status >= 400 &&
            error.status < 500 &&
            error.status !== 408 &&
            error.status !== 429)
        ) {
          throw error;
        }

        // If this is the last attempt or we're not retrying, throw
        if (attempt === maxRetries) {
          throw error;
        }

        // Otherwise, continue to retry
        debugWarn(`Request failed, will retry: ${error.message}`);
      }
    }

    throw lastError;
  }

  // Initialize admin page
  function init() {
    fetchCSRFToken();
    highlightActivePage();
    loadBadgeCounts();
    initKeyboardShortcuts();
    initSidebarToggle();
    populateVersionLabel();

    // Refresh badge counts every 60 seconds
    setInterval(loadBadgeCounts, 60000);
  }

  // Populate the #ef-version-label span in the page footer
  async function populateVersionLabel() {
    const label = document.getElementById('ef-version-label');
    if (!label) {
      return;
    }
    try {
      const r = await fetch('/api/v1/meta', { credentials: 'include' });
      if (!r.ok) {
        label.textContent = 'unknown';
        return;
      }
      const data = await r.json();
      label.textContent = data && data.version ? data.version : 'dev';
    } catch (_err) {
      label.textContent = 'offline';
    }
  }

  // Public API
  return {
    // Debug utilities
    DEBUG,
    debugLog,
    debugWarn,
    debugError,
    // Core utilities
    escapeHtml,
    formatDate,
    formatTimestamp,
    formatFileSize,
    // Validation helpers
    validateEmail,
    validatePassword,
    validateRole,
    VALID_ROLES,
    // API wrappers
    api,
    adminFetch,
    adminFetchWithTimeout,
    fetchWithTimeout,
    fetchCSRFToken,
    // UI utilities
    showToast,
    showEnhancedToast,
    showConfirmModal,
    showInputModal,
    confirm,
    // List state management
    showLoadingState,
    showErrorState,
    showEmptyState,
    disableButton,
    safeAction,
    // Data loading
    loadBadgeCounts,
    // Navigation
    highlightActivePage,
    loadNavbar,
    // Helpers
    generateId,
    debounce,
    animateCounter,
    // Keyboard shortcuts
    initKeyboardShortcuts,
    openCommandPalette,
    closeModals,
    // Initialization
    init,
  };
})();

// Auto-initialize if DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => AdminShared.init());
} else {
  AdminShared.init();
}

// Expose on window so that ES module scripts (type="module") can access
// window.AdminShared.api() — const declarations are not added to window automatically.
if (typeof window !== 'undefined') {
  window.AdminShared = AdminShared;
}

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdminShared;
}
