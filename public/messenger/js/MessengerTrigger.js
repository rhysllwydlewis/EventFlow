/**
 * MessengerTrigger Component
 * Universal "Message" button trigger for any page
 * Handles [data-messenger-action] buttons across the entire site
 */

'use strict';

(function () {
  /**
   * Check if user is authenticated
   * @returns {Promise<boolean>}
   */
  async function checkAuth() {
    try {
      // Check AuthStateManager first (most reliable, set by auth-state.js)
      if (window.AuthStateManager?.isAuthenticated?.()) {
        return true;
      }

      // Fallback: fetch from API
      const response = await fetch('/api/v1/auth/me', {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
      });
      return response.ok;
    } catch (error) {
      console.error('Auth check failed:', error);
      return false;
    }
  }

  /**
   * Handle new conversation button click
   * @param {HTMLElement} button
   */
  async function handleNewConversation(button) {
    // Check authentication
    const isAuthenticated = await checkAuth();

    if (!isAuthenticated) {
      // Redirect to login with return URL
      const currentUrl = encodeURIComponent(window.location.href);
      window.location.href = `/auth?redirect=${currentUrl}`;
      return;
    }

    // Build messenger URL with query params
    const params = new URLSearchParams();
    params.set('new', 'true');

    const recipientId = button.getAttribute('data-recipient-id');
    if (recipientId) {
      params.set('recipientId', recipientId);
    }

    const contextType = button.getAttribute('data-context-type');
    if (contextType) {
      params.set('contextType', contextType);
    }

    const contextId = button.getAttribute('data-context-id');
    if (contextId) {
      params.set('contextId', contextId);
    }

    const contextTitle = button.getAttribute('data-context-title');
    if (contextTitle) {
      params.set('contextTitle', contextTitle);
    }

    const prefill = button.getAttribute('data-prefill');
    if (prefill) {
      params.set('prefill', prefill);
    }

    // Navigate to messenger
    window.location.href = `/messenger/?${params.toString()}`;
  }

  /**
   * Handle open conversation button click
   * @param {HTMLElement} button
   */
  async function handleOpenConversation(button) {
    // Check authentication
    const isAuthenticated = await checkAuth();

    if (!isAuthenticated) {
      // Redirect to login with return URL
      const currentUrl = encodeURIComponent(window.location.href);
      window.location.href = `/auth?redirect=${currentUrl}`;
      return;
    }

    const conversationId = button.getAttribute('data-conversation-id');
    if (!conversationId) {
      console.error('Missing data-conversation-id attribute');
      return;
    }

    // Navigate to specific conversation
    window.location.href = `/messenger/?conversation=${encodeURIComponent(conversationId)}`;
  }

  /**
   * Attach click handler to a messenger action button
   * @param {HTMLElement} button
   */
  function attachHandler(button) {
    // Avoid duplicate handlers
    if (button.hasAttribute('data-messenger-initialized')) {
      return;
    }
    button.setAttribute('data-messenger-initialized', 'true');

    const action = button.getAttribute('data-messenger-action');

    button.addEventListener('click', async e => {
      e.preventDefault();

      try {
        if (action === 'new-conversation') {
          await handleNewConversation(button);
        } else if (action === 'open-conversation') {
          await handleOpenConversation(button);
        } else {
          console.warn('Unknown messenger action:', action);
        }
      } catch (error) {
        console.error('Error handling messenger action:', error);
        // Silently fail - navigation errors shouldn't break the page
      }
    });
  }

  function resolveSupplierRecipientId(supplier) {
    if (!supplier || typeof supplier !== 'object') {
      return '';
    }
    return String(
      supplier.messagingRecipientId ||
        supplier.ownerUserId ||
        supplier.userId ||
        supplier.ownerId ||
        supplier.accountId ||
        ''
    ).trim();
  }

  /**
   * The safe public supplier API deliberately projects the account identifier as
   * `messagingRecipientId`, not `ownerUserId`. The profile renderer predates that
   * privacy boundary, so replace its legacy click handler once supplier data exists.
   * @param {Object} supplier
   * @returns {boolean}
   */
  function wireSupplierProfileQuickCompose(supplier) {
    const button = document.getElementById('btn-enquiry');
    const recipientId = resolveSupplierRecipientId(supplier);
    if (!button || !recipientId || typeof window.QuickComposeV4?.open !== 'function') {
      return false;
    }

    const supplierName = String(supplier.name || 'Supplier').trim() || 'Supplier';
    const safeName = supplierName.replace(/[<>'"&]/g, '').trim() || 'Supplier';
    const options = {
      recipientId,
      recipientName: supplierName,
      contextType: 'supplier_profile',
      contextId: String(supplier.id || ''),
      contextTitle: supplierName,
      prefill: `Hi ${safeName}! I'd like to enquire about your services.`,
    };

    button.dataset.recipientId = recipientId;
    button.dataset.contextType = options.contextType;
    button.dataset.contextId = options.contextId;
    button.dataset.contextTitle = options.contextTitle;
    button.dataset.prefill = options.prefill;
    button.onclick = event => {
      event?.preventDefault();
      window.QuickComposeV4.open(options);
    };
    button.setAttribute('data-supplier-compose-ready', 'true');
    return true;
  }

  /**
   * Initialize all messenger trigger buttons on the page
   */
  function initializeButtons() {
    const buttons = document.querySelectorAll('[data-messenger-action]');
    buttons.forEach(attachHandler);
  }

  /**
   * Set up MutationObserver to watch for dynamically added buttons
   */
  function setupMutationObserver() {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.hasAttribute && node.hasAttribute('data-messenger-action')) {
              attachHandler(node);
            }
            if (node.querySelectorAll) {
              const buttons = node.querySelectorAll('[data-messenger-action]');
              buttons.forEach(attachHandler);
            }
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return observer;
  }

  // Store observer reference for cleanup
  let mutationObserver = null;

  /**
   * Initialize MessengerTrigger on DOMContentLoaded
   */
  function init() {
    initializeButtons();
    wireSupplierProfileQuickCompose(window.__supplierData);
    mutationObserver = setupMutationObserver();
  }

  /**
   * Cleanup and disconnect observer
   */
  function destroy() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
  }

  window.addEventListener('sp:dataReady', event => {
    wireSupplierProfileQuickCompose(event.detail?.supplier);
  });

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export for manual initialization if needed
  window.MessengerTrigger = {
    init,
    initializeButtons,
    attachHandler,
    destroy,
    resolveSupplierRecipientId,
    wireSupplierProfileQuickCompose,
  };
})();
