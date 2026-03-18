/**
 * Toast Notification System
 * Modern toast/snackbar notifications for user feedback
 */

class Toast {
  constructor() {
    this.container = null;
    this.init();
  }

  init() {
    // Create container if it doesn't exist
    if (!document.getElementById('toast-container')) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    } else {
      this.container = document.getElementById('toast-container');
    }

    // Add styles if not already present
    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById('toast-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
      .toast-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        max-width: 400px;
      }

      .toast {

      .toast.removing {
        animation: slideOut 0.3s ease-in forwards;
      }

      .toast-icon {
        font-size: 24px;
        margin-right: 12px;
        flex-shrink: 0;
      }

      .toast-content {
        flex: 1;
      }

      .toast-title {
        font-weight: 600;
        margin-bottom: 4px;
        font-size: 14px;
      }

      .toast-message {

      .toast-close {
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        margin-left: 12px;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background-color 0.2s ease;
        flex-shrink: 0;
      }

      .toast-close:hover {

      .toast-success {
        border-left: 4px solid #28a745;
      }

      .toast-error {
        border-left: 4px solid #dc3545;
      }

      .toast-warning {
        border-left: 4px solid #ffc107;
      }

      .toast-info {
        border-left: 4px solid #17a2b8;
      }

      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }

      @media (max-width: 480px) {
        .toast-container {
          top: 10px;
          right: 10px;
          left: 10px;
          max-width: none;
        }

        .toast {
          min-width: auto;
          max-width: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  show(options) {
    const {
      type = 'info',
      title = '',
      message = '',
      duration = 5000,
      dismissible = true,
    } = options;

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    // Icon based on type
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ',
    };

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = icons[type] || icons.info;
    toast.appendChild(icon);

    // Content
    const content = document.createElement('div');
    content.className = 'toast-content';

    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'toast-title';
      titleEl.textContent = title;
      content.appendChild(titleEl);
    }

    if (message) {
      const messageEl = document.createElement('div');
      messageEl.className = 'toast-message';
      messageEl.textContent = message;
      content.appendChild(messageEl);
    }

    toast.appendChild(content);

    // Close button
    if (dismissible) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'toast-close';
      closeBtn.innerHTML = '×';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.addEventListener('click', () => this.remove(toast));
      toast.appendChild(closeBtn);
    }

    // Add to container
    this.container.appendChild(toast);

    // Auto remove after duration
    if (duration > 0) {
      setTimeout(() => {
        this.remove(toast);
      }, duration);
    }

    return toast;
  }

  remove(toast) {
    if (!toast || !toast.parentElement) {
      return;
    }

    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, 300);
  }

  // Convenience methods
  success(message, title = 'Success') {
    return this.show({ type: 'success', title, message });
  }

  error(message, title = 'Error') {
    return this.show({ type: 'error', title, message });
  }

  warning(message, title = 'Warning') {
    return this.show({ type: 'warning', title, message });
  }

  info(message, title = 'Info') {
    return this.show({ type: 'info', title, message });
  }
}

// Create global instance
if (typeof window !== 'undefined') {
  window.toast = new Toast();
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Toast;
}
