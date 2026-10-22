/**
 * P3-14: Keyboard Shortcuts
 * Global keyboard shortcuts for improved navigation and UX
 */

'use strict';
(function () {
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // Detect if Mac or Windows for correct key display
  const isMac = (navigator.platform || '').toUpperCase().indexOf('MAC') >= 0;
  const modifierKey = isMac ? 'Cmd' : 'Ctrl';
  const modifierKeyCode = isMac ? 'Meta' : 'Control';

  // Shortcuts configuration
  const shortcuts = {
    search: {
      key: 'k',
      modifier: modifierKeyCode,
      action: openSearch,
      description: 'Open search',
      display: `${modifierKey}+K`,
    },
    help: {
      key: '/',
      modifier: modifierKeyCode,
      action: openHelp,
      description: 'Open keyboard shortcuts',
      display: `${modifierKey}+/`,
    },
    escape: {
      key: 'Escape',
      modifier: null,
      action: closeModals,
      description: 'Close modals',
      display: 'Esc',
    },
  };

  /**
   * Initialize keyboard shortcuts
   */
  function init() {
    document.addEventListener('keydown', handleKeyDown);
    createHelpModal();
    if (isDevelopment) {
      console.log('✓ Keyboard shortcuts initialized');
    }
  }

  /**
   * Handle keydown events
   */
  function handleKeyDown(e) {
    // Don't trigger shortcuts when typing in inputs
    const activeElement = document.activeElement;
    const isInput =
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable;

    // Check each shortcut
    Object.values(shortcuts).forEach(shortcut => {
      // Map modifier key names to correct event properties
      const modifierKeyMap = {
        Meta: 'metaKey',
        Control: 'ctrlKey',
        Alt: 'altKey',
        Shift: 'shiftKey',
      };

      const modifierMatch = shortcut.modifier
        ? e.key === shortcut.key && e[modifierKeyMap[shortcut.modifier]]
        : e.key === shortcut.key;

      if (modifierMatch) {
        // Special handling for search - allow from anywhere
        if (shortcut.action === openSearch && shortcut.modifier) {
          e.preventDefault();
          shortcut.action();
          return;
        }

        // For other shortcuts, don't trigger when in inputs
        if (!isInput) {
          // Escape belongs to whatever is open. A native <dialog> closes itself on Escape, and
          // cancelling the key here left it open; with nothing of ours open, the key is not ours.
          if (shortcut.action === closeModals && (hasNativeDialogOpen() || !openModals().length)) {
            return;
          }
          e.preventDefault();
          shortcut.action();
        }
      }
    });
  }

  /**
   * Open search
   */
  function openSearch() {
    // Try to find search input
    const searchInput = document.querySelector(
      '#search-input, .search-input, input[type="search"], #ef-search-input'
    );

    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    } else {
      // If on a page without search, redirect to search page
      window.location.href = '/suppliers';
    }
  }

  /**
   * Open help modal with keyboard shortcuts
   */
  function openHelp() {
    const modal = document.getElementById('keyboard-shortcuts-modal');
    if (modal) {
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
  }

  /** True while a native modal <dialog> is showing; it handles Escape itself. */
  function hasNativeDialogOpen() {
    return Boolean(document.querySelector('dialog[open]'));
  }

  /**
   * The modals this script can close: visible `.modal` and role="dialog" elements. The mobile
   * navigation is also marked role="dialog" but is closed by its own Escape handling, and hiding it
   * here left its inline style behind.
   */
  function openModals() {
    return Array.from(
      document.querySelectorAll('.modal, [role="dialog"], #keyboard-shortcuts-modal')
    ).filter(
      modal =>
        modal.id !== 'ef-mobile-menu' &&
        !modal.classList.contains('ef-mobile-menu') &&
        modal.getAttribute('aria-hidden') !== 'true' &&
        window.getComputedStyle(modal).display !== 'none'
    );
  }

  /**
   * Close all open modals
   */
  function closeModals() {
    openModals().forEach(modal => {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    });

    document.body.style.overflow = '';
  }

  /**
   * Create keyboard shortcuts help modal
   */
  function createHelpModal() {
    // Check if modal already exists
    if (document.getElementById('keyboard-shortcuts-modal')) {
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'keyboard-shortcuts-modal';
    modal.className = 'modal keyboard-shortcuts-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-labelledby', 'shortcuts-title');
    modal.setAttribute('aria-hidden', 'true');
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content keyboard-shortcuts-content">
        <div class="modal-header">
          <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
          <button 
            type="button" 
            class="ef-cta modal-close" 
            aria-label="Close dialog"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div class="modal-body">
          <div class="shortcuts-list">
            ${Object.values(shortcuts)
              .map(
                shortcut => `
              <div class="shortcut-item">
                <span class="shortcut-description">${shortcut.description}</span>
                <kbd class="shortcut-key">${shortcut.display}</kbd>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Add event listeners for close functionality
    const overlay = modal.querySelector('.modal-overlay');
    const closeBtn = modal.querySelector('.modal-close');

    const closeHelpModal = () => {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    };

    if (overlay) {
      overlay.addEventListener('click', closeHelpModal);
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', closeHelpModal);
    }

    // Close on escape
    modal.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeModals();
      }
    });
  }

  /**
   * Add shortcut hint to an element
   */
  function addShortcutHint(element, shortcutKey) {
    if (!element || !shortcuts[shortcutKey]) {
      return;
    }

    const hint = document.createElement('span');
    hint.className = 'keyboard-shortcut-hint';
    hint.textContent = shortcuts[shortcutKey].display;
    hint.setAttribute('aria-label', `Keyboard shortcut: ${shortcuts[shortcutKey].display}`);

    element.appendChild(hint);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export for use in other scripts
  if (typeof window !== 'undefined') {
    window.KeyboardShortcuts = {
      init,
      addShortcutHint,
      openSearch,
      openHelp,
      closeModals,
    };
  }
})();
