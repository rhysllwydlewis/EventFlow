/**
 * Shortlist Drawer Component
 * Displays saved suppliers and listings with actions
 */

import shortlistManager from '../utils/shortlist-manager.js';

class ShortlistDrawer {
  constructor() {
    this.isOpen = false;
    this.container = null;
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
    button.id = 'shortlist-float-btn';
    button.className = 'shortlist-float-btn';
    button.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
      </svg>
      <span class="shortlist-badge" id="shortlist-badge">0</span>
    `;
    button.setAttribute('aria-label', 'View shortlist');
    button.addEventListener('click', () => this.toggle());

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
      <div class="shortlist-panel">
        <div class="shortlist-header">
          <h2>Shortlist</h2>
          <button class="shortlist-close-btn" aria-label="Close shortlist">
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
          <button class="btn btn-secondary" id="clear-shortlist-btn">Clear all</button>
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

    // ESC key to close
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
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
  }

  /**
   * Render shortlist items
   */
  render() {
    const content = this.container.querySelector('#shortlist-content');
    const items = shortlistManager.getItems();

    if (items.length === 0) {
      content.innerHTML = `
        <div class="shortlist-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
          <p>Your shortlist is empty</p>
          <small>Save listings to your shortlist so you can compare them later</small>
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
    const imageUrl = item.imageUrl || '/assets/images/marketplace-placeholder.svg';
    const priceHint = item.priceHint || 'Contact for quote';
    const rating = item.rating ? `⭐ ${item.rating}` : '';

    return `
      <div class="shortlist-item">
        <img 
          src="${imageUrl}" 
          alt="${item.name}" 
          class="shortlist-item-image" 
          data-fallback-src="/assets/images/marketplace-placeholder.svg"
        />
        <div class="shortlist-item-info">
          <h3 class="shortlist-item-name">${item.name}</h3>
          <p class="shortlist-item-meta">
            ${item.category || ''} ${item.category && item.location ? '•' : ''} ${item.location || ''}
          </p>
          <p class="shortlist-item-price">${priceHint} ${rating}</p>
        </div>
        <button
          class="shortlist-item-remove"
          data-type="${item.type}" 
          data-id="${item.id}"
          aria-label="Remove ${item.name} from shortlist"
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
        <div class="confirm-dialog">
          <h3 class="confirm-dialog-title">${title}</h3>
          <p class="confirm-dialog-message">${message}</p>
          <div class="confirm-dialog-actions">
            <button class="btn btn-secondary confirm-cancel">Cancel</button>
            <button class="btn btn-primary confirm-ok">Confirm</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Focus first button
      const cancelBtn = overlay.querySelector('.confirm-cancel');
      const okBtn = overlay.querySelector('.confirm-ok');

      cancelBtn.focus();

      // Handle button clicks
      cancelBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(false);
      });

      okBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(true);
      });

      // Handle ESC key
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          document.body.removeChild(overlay);
          resolve(false);
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
  }

  /**
   * Close drawer
   */
  close() {
    this.isOpen = false;
    this.container.classList.remove('open');
    document.body.style.overflow = '';
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
