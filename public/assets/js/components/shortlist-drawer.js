/**
 * Shortlist Drawer Component
 * Displays saved suppliers and listings with actions
 */

import shortlistManager from '../utils/shortlist-manager.js';
import { escapeHtml } from '../utils/common-helpers.js';

class ShortlistDrawer {
  constructor() {
    this.isOpen = false;
    this.container = null;
    this.triggerElement = null;
    this.init();
  }

  /**
   * Initialize the drawer
   */
  init() {
    this.createDrawer();
    this.attachEventListeners();
    this.createFloatingButton();

    // Listen for shortlist changes
    shortlistManager.onChange(() => {
      this.updateCount();
      this.render();
    });

    // Initial render
    this.updateCount();
  }

  /**
   * Create floating shortlist button
   */
  createFloatingButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'shortlist-float-btn';
    button.className = 'shortlist-float-btn';
    button.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
      </svg>
      <span class="shortlist-badge" id="shortlist-badge">0</span>
    `;
    button.setAttribute('aria-label', 'View shortlist (0 items)');
    button.addEventListener('click', () => {
      this.triggerElement = button;
      this.toggle();
    });

    document.body.appendChild(button);
  }

  /**
   * Create drawer element
   */
  createDrawer() {
    const drawer = document.createElement('div');
    drawer.id = 'shortlist-drawer';
    drawer.className = 'shortlist-drawer';
    drawer.innerHTML = `
      <div class="shortlist-overlay"></div>
      <div class="shortlist-panel" role="dialog" aria-modal="true" aria-labelledby="shortlist-heading">
        <div class="shortlist-header">
          <h2 id="shortlist-heading">Shortlist</h2>
          <button class="ef-cta shortlist-close-btn" aria-label="Close shortlist">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="shortlist-content" id="shortlist-content">
          <!-- Items will be rendered here -->
        </div>
        <div class="shortlist-footer">
          <button class="ef-cta btn btn-secondary" id="clear-shortlist-btn">Clear all</button>
        </div>
      </div>
    `;

    document.body.appendChild(drawer);
    this.container = drawer;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Close button
    const closeBtn = this.container.querySelector('.shortlist-close-btn');
    closeBtn.addEventListener('click', () => this.close());

    // Overlay click
    const overlay = this.container.querySelector('.shortlist-overlay');
    overlay.addEventListener('click', () => this.close());

    // Clear all button
    const clearBtn = this.container.querySelector('#clear-shortlist-btn');
    clearBtn.addEventListener('click', () => this.clearAll());

    // ESC to close, Tab to stay trapped inside the panel while open
    document.addEventListener('keydown', e => {
      if (!this.isOpen) {
        return;
      }
      if (e.key === 'Escape') {
        this.close();
        return;
      }
      if (e.key === 'Tab') {
        this.trapFocus(e);
      }
    });
  }

  /**
   * Keep Tab/Shift+Tab focus cycling within the open panel
   */
  trapFocus(e) {
    const panel = this.container.querySelector('.shortlist-panel');
    const focusable = panel.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /**
   * Update shortlist count badge
   */
  updateCount() {
    const count = shortlistManager.getCount();
    const badge = document.getElementById('shortlist-badge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }

    const floatBtn = document.getElementById('shortlist-float-btn');
    if (floatBtn) {
      floatBtn.classList.toggle('has-items', count > 0);
      floatBtn.setAttribute(
        'aria-label',
        `View shortlist (${count} item${count === 1 ? '' : 's'})`
      );
    }
  }

  /**
   * Render shortlist items
   */
  render() {
    const content = this.container.querySelector('#shortlist-content');
    const items = shortlistManager.getItems();

    if (items.length === 0) {
      const helpText = shortlistManager.isAuthenticated
        ? 'Save listings to your shortlist so you can compare them later'
        : 'Log in to start saving suppliers and listings to your shortlist';
      content.innerHTML = `
        <div class="shortlist-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
          <p>Your shortlist is empty</p>
          <small>${helpText}</small>
        </div>
      `;
      return;
    }

    content.innerHTML = items.map(item => this.renderItem(item)).join('');

    // Attach remove buttons
    content.querySelectorAll('.shortlist-item-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        const type = e.currentTarget.dataset.type;
        const id = e.currentTarget.dataset.id;
        this.removeItem(type, id);
      });
    });
  }

  /**
   * Render single item
   */
  renderItem(item) {
    const imageUrl = escapeHtml(item.imageUrl || '/assets/images/marketplace-placeholder.svg');
    const name = escapeHtml(item.name);
    const category = escapeHtml(item.category || '');
    const location = escapeHtml(item.location || '');
    const priceHint = escapeHtml(item.priceHint || 'Contact for quote');
    const rating = item.rating ? `⭐ ${escapeHtml(String(item.rating))}` : '';
    // type/id are internal identifiers (hardcoded literals like 'listing'/'supplier' plus
    // server-issued record IDs) in every current caller, but escape them anyway — this
    // function's contract shouldn't silently depend on every future caller getting that
    // right. The browser decodes HTML entities back to the original string on attribute
    // parse, so reading these back via `.dataset.type`/`.dataset.id` is unaffected.
    const type = escapeHtml(item.type);
    const id = escapeHtml(item.id);

    return `
      <div class="shortlist-item">
        <img
          src="${imageUrl}"
          alt="${name}"
          class="shortlist-item-image"
          data-fallback-src="/assets/images/marketplace-placeholder.svg"
        />
        <div class="shortlist-item-info">
          <h3 class="shortlist-item-name">${name}</h3>
          <p class="shortlist-item-meta">
            ${category} ${category && location ? '•' : ''} ${location}
          </p>
          <p class="shortlist-item-price">${priceHint} ${rating}</p>
        </div>
        <button
          class="ef-cta shortlist-item-remove"
          data-type="${type}"
          data-id="${id}"
          aria-label="Remove ${name} from shortlist"
          title="Remove"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;
  }

  /**
   * Remove item from shortlist
   */
  async removeItem(type, id) {
    await shortlistManager.removeItem(type, id);
  }

  /**
   * Clear all items
   */
  async clearAll() {
    // Create accessible confirmation dialog
    const confirmed = await this.showConfirmDialog(
      'Clear Shortlist',
      'Are you sure you want to clear your entire shortlist?'
    );

    if (confirmed) {
      await shortlistManager.clearAll();
    }
  }

  /**
   * Show confirmation dialog (accessible alternative to confirm())
   */
  showConfirmDialog(title, message) {
    return new Promise(resolve => {
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'confirm-dialog-overlay';
      overlay.innerHTML = `
        <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
          <h3 class="confirm-dialog-title" id="confirm-dialog-title">${title}</h3>
          <p class="confirm-dialog-message">${message}</p>
          <div class="confirm-dialog-actions">
            <button class="ef-cta btn btn-secondary confirm-cancel">Cancel</button>
            <button class="ef-cta btn btn-primary confirm-ok">Confirm</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Focus first button
      const cancelBtn = overlay.querySelector('.confirm-cancel');
      const okBtn = overlay.querySelector('.confirm-ok');

      cancelBtn.focus();

      // Clicking the backdrop (not the dialog itself) cancels, matching the
      // shortlist drawer's overlay-click-to-close behavior
      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          document.body.removeChild(overlay);
          resolve(false);
        }
      });

      // Handle button clicks
      cancelBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(false);
      });

      okBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(true);
      });

      // Handle ESC and Tab — stop both reaching the shortlist drawer's own
      // document-level handler underneath, which would otherwise close the
      // drawer on ESC or hijack Tab into the drawer panel's focus trap
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          document.body.removeChild(overlay);
          resolve(false);
          return;
        }
        if (e.key === 'Tab') {
          e.stopPropagation();
          if (e.shiftKey && document.activeElement === cancelBtn) {
            e.preventDefault();
            okBtn.focus();
          } else if (!e.shiftKey && document.activeElement === okBtn) {
            e.preventDefault();
            cancelBtn.focus();
          }
        }
      });
    });
  }

  /**
   * Open drawer
   */
  open() {
    this.isOpen = true;
    this.container.classList.add('open');
    this.render();
    document.body.style.overflow = 'hidden';
    const closeBtn = this.container.querySelector('.shortlist-close-btn');
    if (closeBtn) {
      closeBtn.focus();
    }
  }

  /**
   * Close drawer
   */
  close() {
    this.isOpen = false;
    this.container.classList.remove('open');
    document.body.style.overflow = '';
    if (this.triggerElement) {
      this.triggerElement.focus();
    }
  }

  /**
   * Toggle drawer
   */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new ShortlistDrawer();
  });
} else {
  new ShortlistDrawer();
}

export default ShortlistDrawer;
