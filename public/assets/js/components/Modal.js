/**
 * Modal Dialog Component
 * Reusable modal dialog with customizable content
 */

class Modal {
  constructor() {
    this.modals = [];
    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById('modal-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'modal-styles';
    style.textContent = `
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(255, 255, 255, 0.75);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9998;
        animation: fadeIn 0.2s ease-out;
      }

      .modal-container {
        background-color: var(--color-card-bg, #ffffff);
        border-radius: 8px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        max-width: 90%;
        max-height: 90vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        animation: slideUp 0.3s ease-out;
      }

      .modal-header {
        padding: 20px 24px;
        border-bottom: 1px solid var(--color-border, #dee2e6);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .modal-title {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--color-text-primary, #212529);
      }

      .modal-close {
        background: none;
        border: none;
        font-size: 28px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background-color 0.2s ease;
        color: var(--color-text-secondary, #6c757d);
      }

      .modal-close:hover {

      .modal-body {
        padding: 24px;
        overflow-y: auto;
        flex: 1;
        color: var(--color-text-primary, #212529);
      }

      .modal-footer {
        padding: 16px 24px;
        border-top: 1px solid var(--color-border, #dee2e6);
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes slideUp {
        from {
          transform: translateY(50px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      .modal-overlay.closing {
        animation: fadeOut 0.2s ease-in forwards;
      }

      .modal-overlay.closing .modal-container {
        animation: slideDown 0.2s ease-in forwards;
      }

      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }

      @keyframes slideDown {
        from {
          transform: translateY(0);
          opacity: 1;
        }
        to {
          transform: translateY(50px);
          opacity: 0;
        }
      }

      @media (max-width: 768px) {
        .modal-container {
          max-width: 95%;
          max-height: 95vh;
        }

        .modal-header,
        .modal-body,
        .modal-footer {
          padding: 16px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  open(options) {
    const {
      title = '',
      content = '',
      footer = null,
      size = 'medium', // small, medium, large
      closeOnOverlay = true,
      showClose = true,
      onClose = null,
    } = options;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    // Create modal container
    const container = document.createElement('div');
    container.className = 'modal-container';

    // Set size
    const sizes = {
      small: '400px',
      medium: '600px',
      large: '800px',
    };
    container.style.width = sizes[size] || sizes.medium;

    // Create header
    if (title || showClose) {
      const header = document.createElement('div');
      header.className = 'modal-header';

      if (title) {
        const titleEl = document.createElement('h3');
        titleEl.className = 'modal-title';
        titleEl.textContent = title;
        header.appendChild(titleEl);
      }

      if (showClose) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close';
        closeBtn.innerHTML = '×';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.addEventListener('click', () => this.close(overlay, onClose));
        header.appendChild(closeBtn);
      }

      container.appendChild(header);
    }

    // Create body
    const body = document.createElement('div');
    body.className = 'modal-body';

    if (typeof content === 'string') {
      body.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      body.appendChild(content);
    }

    container.appendChild(body);

    // Create footer
    if (footer) {
      const footerEl = document.createElement('div');
      footerEl.className = 'modal-footer';

      if (typeof footer === 'string') {
        footerEl.innerHTML = footer;
      } else if (footer instanceof HTMLElement) {
        footerEl.appendChild(footer);
      } else if (Array.isArray(footer)) {
        footer.forEach(button => footerEl.appendChild(button));
      }

      container.appendChild(footerEl);
    }

    overlay.appendChild(container);

    // Close on overlay click
    if (closeOnOverlay) {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          this.close(overlay, onClose);
        }
      });
    }

    // Close on Escape key
    const escHandler = e => {
      if (e.key === 'Escape') {
        this.close(overlay, onClose);
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Add to DOM
    document.body.appendChild(overlay);
    this.modals.push(overlay);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    return overlay;
  }

  close(overlay, callback) {
    if (!overlay || !overlay.parentElement) {
      return;
    }

    overlay.classList.add('closing');

    setTimeout(() => {
      if (overlay.parentElement) {
        overlay.parentElement.removeChild(overlay);
      }

      const index = this.modals.indexOf(overlay);
      if (index > -1) {
        this.modals.splice(index, 1);
      }

      // Restore body scroll if no modals are open
      if (this.modals.length === 0) {
        document.body.style.overflow = '';
      }

      if (callback && typeof callback === 'function') {
        callback();
      }
    }, 200);
  }

  confirm(options) {
    const {
      title = 'Confirm',
      message = 'Are you sure?',
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      onConfirm = null,
      onCancel = null,
    } = options;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.gap = '12px';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = cancelText;

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.textContent = confirmText;

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    const overlay = this.open({
      title,
      content: `<p>${message}</p>`,
      footer,
      size: 'small',
      showClose: false,
    });

    cancelBtn.addEventListener('click', () => {
      this.close(overlay);
      if (onCancel) {
        onCancel();
      }
    });

    confirmBtn.addEventListener('click', () => {
      this.close(overlay);
      if (onConfirm) {
        onConfirm();
      }
    });
  }
}

// Create global instance
if (typeof window !== 'undefined') {
  window.modal = new Modal();
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Modal;
}
