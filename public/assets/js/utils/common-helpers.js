/**
 * Common Helper Functions
 * Shared utilities used across multiple dashboard components
 */

const isDevelopment =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/**
 * Get the currently authenticated user
 * @returns {Promise<Object|null>} User object or null if not authenticated
 */
export async function getCurrentUser() {
  try {
    const response = await fetch('/api/v1/auth/me', {
      credentials: 'include',
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data.user || null;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML string
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

/**
 * Show a toast notification safely (checks if toast system exists)
 * @param {string} message - Message to display
 * @param {string} type - Type of notification (success, error, warning, info)
 */
export function showToast(message, type = 'info') {
  if (typeof EFToast !== 'undefined') {
    EFToast[type](message);
  } else if (typeof Toast !== 'undefined') {
    Toast[type](message);
  } else {
    // Fallback to alert for critical messages
    if (type === 'error') {
      alert(message);
    } else {
      if (isDevelopment) {
        console.log(`[${type.toUpperCase()}] ${message}`);
      }
    }
  }
}

/**
 * Create a modal close handler with proper cleanup support
 * @param {HTMLElement} modal - The modal element
 * @param {Array} cleanupCallbacks - Array to store cleanup functions
 * @param {HTMLElement} previouslyFocusedElement - Element to restore focus to
 * @returns {Function} Close function
 */
export function createModalCloseHandler(
  modal,
  cleanupCallbacks = [],
  previouslyFocusedElement = null
) {
  return () => {
    // Run all cleanup callbacks
    cleanupCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error in cleanup callback:', error);
      }
    });

    // Remove modal from DOM
    modal.remove();

    // Restore focus to the element that opened the modal
    if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === 'function') {
      previouslyFocusedElement.focus();
    }
  };
}

/**
 * Set up standard modal close handlers (button, overlay, escape key) and focus trap.
 * @param {HTMLElement} modal - The modal element
 * @param {Function} closeModal - The close function to call
 * @param {Array} cleanupCallbacks - Array to register cleanup functions
 */
export function setupModalCloseHandlers(modal, closeModal, cleanupCallbacks = []) {
  // Close button handler with defensive check
  const closeButton = modal.querySelector('.modal-close');
  if (closeButton) {
    closeButton.addEventListener('click', e => {
      e.stopPropagation();
      closeModal();
    });
  }

  // Close when clicking outside the modal
  modal.addEventListener('click', e => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Close modal with Escape key
  const handleEscapeKey = e => {
    if (e.key === 'Escape' || e.keyCode === 27) {
      closeModal();
    }
  };
  document.addEventListener('keydown', handleEscapeKey);

  // Focus trap: keep keyboard navigation inside the modal while it is open
  const focusTrapHandler = e => {
    if (e.key !== 'Tab') {
      return;
    }
    const focusable = Array.from(modal.querySelectorAll(FOCUSABLE_SELECTORS));
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  modal.addEventListener('keydown', focusTrapHandler);

  // Register cleanup for both document-level listener and focus trap
  cleanupCallbacks.push(() => {
    document.removeEventListener('keydown', handleEscapeKey);
    modal.removeEventListener('keydown', focusTrapHandler);
  });
}
