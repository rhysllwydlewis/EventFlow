/**
 * EventFlow Components - Reusable UI component library
 * Provides Modal, Toast, Dropdown, Tooltip, and other UI components
 */

// Utility function to escape HTML to prevent XSS
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') {
    return '';
  }
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Modal Component
class Modal {
  constructor(options = {}) {
    this.title = options.title || '';
    this.content = options.content || '';
    this.onConfirm = options.onConfirm || null;
    this.onCancel = options.onCancel || null;
    this.confirmText = options.confirmText || 'Confirm';
    this.cancelText = options.cancelText || 'Cancel';
    this.showCancel = options.showCancel !== false;
    this.overlay = null;
    this.modal = null;
  }

  show() {
    this.render();
    document.body.appendChild(this.overlay);
    // Trigger reflow for animation
    this.overlay.offsetHeight;
    this.overlay.classList.add('active');

    // Focus trap
    this.trapFocus();

    // Close on overlay click
    this.overlay.addEventListener('click', e => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });
  }

  hide() {
    this.overlay.classList.remove('active');
    setTimeout(() => {
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
    }, 300);
  }

  render() {
    const overlayDiv = document.createElement('div');
    overlayDiv.className = 'modal-overlay active';
    overlayDiv.setAttribute('role', 'dialog');
    overlayDiv.setAttribute('aria-modal', 'true');

    const modalDiv = document.createElement('div');
    modalDiv.className = 'modal';

    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `
      <h2 class="modal-title">${escapeHtml(this.title)}</h2>
      <button class="ef-cta modal-close" aria-label="Close">&times;</button>
    `;

    const body = document.createElement('div');
    body.className = 'modal-body';
    if (typeof this.content === 'string') {
      body.innerHTML = this.content;
    } else {
      body.appendChild(this.content);
    }

    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    if (this.showCancel) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'cta ghost';
      cancelBtn.textContent = this.cancelText;
      cancelBtn.addEventListener('click', () => {
        if (this.onCancel) {
          this.onCancel();
        }
        this.hide();
      });
      footer.appendChild(cancelBtn);
    }

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'cta';
    confirmBtn.textContent = this.confirmText;
    confirmBtn.addEventListener('click', () => {
      if (this.onConfirm) {
        this.onConfirm();
      }
      this.hide();
    });
    footer.appendChild(confirmBtn);

    // Close button handler
    header.querySelector('.modal-close').addEventListener('click', () => {
      this.hide();
    });

    // Escape key handler
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        this.hide();
      }
    });

    modalDiv.appendChild(header);
    modalDiv.appendChild(body);
    modalDiv.appendChild(footer);
    overlayDiv.appendChild(modalDiv);

    this.overlay = overlayDiv;
    this.modal = modalDiv;
  }

  trapFocus() {
    const focusableElements = this.modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    this.modal.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    });

    firstElement.focus();
  }
}

// Toast Notification Component
class Toast {
  static getContainer() {
    if (!Toast.container) {
      Toast.container = document.createElement('div');
      Toast.container.className = 'toast-container';
      Toast.container.setAttribute('aria-live', 'polite');
      Toast.container.setAttribute('aria-atomic', 'true');
      document.body.appendChild(Toast.container);
    }
    return Toast.container;
  }

  static show(options = {}) {
    const {
      type = 'info',
      title = '',
      message = '',
      duration = 5000,
      dismissible = true,
    } = options;

    const container = this.getContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ',
    };

    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || icons.info}</div>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}
        <div class="toast-message">${escapeHtml(message)}</div>
      </div>
      ${dismissible ? '<button class="ef-cta toast-close" aria-label="Close">&times;</button>' : ''}
    `;

    container.appendChild(toast);

    // Trigger show animation
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    // Auto dismiss
    if (duration > 0) {
      setTimeout(() => {
        this.dismiss(toast);
      }, duration);
    }

    // Manual dismiss
    if (dismissible) {
      toast.querySelector('.toast-close').addEventListener('click', () => {
        this.dismiss(toast);
      });
    }

    return toast;
  }

  static dismiss(toast) {
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  static success(message, title = 'Success') {
    return this.show({ type: 'success', title, message });
  }

  static error(message, title = 'Error') {
    return this.show({ type: 'error', title, message });
  }

  static warning(message, title = 'Warning') {
    return this.show({ type: 'warning', title, message });
  }

  static info(message, title = '') {
    return this.show({ type: 'info', title, message });
  }
}

// Dropdown Component
class Dropdown {
  constructor(element) {
    this.element = element;
    this.menu = element.querySelector('.dropdown-menu');
    this.trigger = element.querySelector('[data-dropdown-trigger]');
    this.isOpen = false;

    this.trigger.addEventListener('click', e => {
      e.stopPropagation();
      this.toggle();
    });

    document.addEventListener('click', () => {
      if (this.isOpen) {
        this.close();
      }
    });

    this.menu.addEventListener('click', e => {
      e.stopPropagation();
    });
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this.element.classList.add('active');
    this.isOpen = true;
    this.trigger.setAttribute('aria-expanded', 'true');
  }

  close() {
    this.element.classList.remove('active');
    this.isOpen = false;
    this.trigger.setAttribute('aria-expanded', 'false');
  }
}

// Tabs Component
class Tabs {
  constructor(element) {
    this.element = element;
    this.tabs = element.querySelectorAll('.tab');
    this.contents = element.querySelectorAll('.tab-content');

    this.tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        this.activate(index);
      });
    });
  }

  activate(index) {
    this.tabs.forEach((tab, i) => {
      if (i === index) {
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
      } else {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
      }
    });

    this.contents.forEach((content, i) => {
      if (i === index) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  }
}

// Accordion Component
class Accordion {
  constructor(element) {
    this.element = element;
    this.items = element.querySelectorAll('.accordion-item');

    this.items.forEach(item => {
      const header = item.querySelector('.accordion-header');
      header.addEventListener('click', () => {
        this.toggle(item);
      });
    });
  }

  toggle(item) {
    const isActive = item.classList.contains('active');

    // Close all items
    this.items.forEach(i => {
      i.classList.remove('active');
      i.querySelector('.accordion-header').setAttribute('aria-expanded', 'false');
    });

    // Open clicked item if it was closed
    if (!isActive) {
      item.classList.add('active');
      item.querySelector('.accordion-header').setAttribute('aria-expanded', 'true');
    }
  }
}

// Ripple Effect
function createRipple(event) {
  const button = event.currentTarget;

  if (!button.classList.contains('ripple-container')) {
    button.classList.add('ripple-container');
  }

  const ripple = document.createElement('span');
  ripple.className = 'ripple';

  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = event.clientX - rect.left - size / 2;
  const y = event.clientY - rect.top - size / 2;

  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;

  button.appendChild(ripple);

  setTimeout(() => {
    ripple.remove();
  }, 600);
}

// Back to Top Button
function initBackToTop() {
  const button = document.querySelector('.back-to-top');
  if (!button) {
    const btn = document.createElement('button');
    btn.className = 'back-to-top';
    btn.innerHTML = '↑';
    btn.setAttribute('aria-label', 'Back to top');
    document.body.appendChild(btn);

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Throttle scroll event for better performance
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    if (scrollTimeout) {
      return; // Skip if already scheduled
    }

    scrollTimeout = setTimeout(() => {
      const btn = document.querySelector('.back-to-top');
      if (btn) {
        if (window.scrollY > 500) {
          btn.classList.add('visible');
        } else {
          btn.classList.remove('visible');
        }
      }
      scrollTimeout = null;
    }, 100); // Throttle to every 100ms
  });
}

function loadHomepageManagerAdminScript() {
  if (!/^\/admin-homepage\/?$/.test(window.location.pathname)) {
    return;
  }

  if (document.querySelector('script[src^="/assets/js/pages/admin-homepage-manager.js"]')) {
    return;
  }

  const script = document.createElement('script');
  script.src = '/assets/js/pages/admin-homepage-manager.js?v=1';
  script.defer = true;
  document.head.appendChild(script);
}

// Initialize components on DOM load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Initialize dropdowns
    document.querySelectorAll('.dropdown').forEach(el => new Dropdown(el));

    // Initialize tabs
    document.querySelectorAll('.tabs').forEach(el => new Tabs(el));

    // Initialize accordions
    document.querySelectorAll('.accordion').forEach(el => new Accordion(el));

    // Initialize back to top
    initBackToTop();

    // Add ripple effect to buttons
    document.querySelectorAll('.cta').forEach(button => {
      button.addEventListener('click', createRipple);
    });

    loadHomepageManagerAdminScript();
  });
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Modal, Toast, Dropdown, Tabs, Accordion, createRipple };
}
