/**
 * MessengerTrigger Component
 * Universal "Message" button trigger for any page
 * Handles [data-messenger-action] buttons across the entire site
 */

'use strict';

(function () {
  async function checkAuth() {
    try {
      if (window.AuthStateManager?.isAuthenticated?.()) {
        return true;
      }

      const response = await fetch('/api/v1/auth/me', {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      });
      if (!response.ok) {
        return false;
      }
      const data = await response.json().catch(() => null);
      return Boolean(data?.user);
    } catch (error) {
      console.error('Auth check failed:', error);
      return false;
    }
  }

  async function handleNewConversation(button) {
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) {
      const currentUrl = encodeURIComponent(window.location.href);
      window.location.href = `/auth?redirect=${currentUrl}`;
      return;
    }

    const params = new URLSearchParams();
    params.set('new', 'true');
    const recipientId = button.getAttribute('data-recipient-id');
    if (recipientId) params.set('recipientId', recipientId);
    const contextType = button.getAttribute('data-context-type');
    if (contextType) params.set('contextType', contextType);
    const contextId = button.getAttribute('data-context-id');
    if (contextId) params.set('contextId', contextId);
    const contextTitle = button.getAttribute('data-context-title');
    if (contextTitle) params.set('contextTitle', contextTitle);
    const prefill = button.getAttribute('data-prefill');
    if (prefill) params.set('prefill', prefill);
    window.location.href = `/messenger/?${params.toString()}`;
  }

  async function handleOpenConversation(button) {
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) {
      const currentUrl = encodeURIComponent(window.location.href);
      window.location.href = `/auth?redirect=${currentUrl}`;
      return;
    }

    const conversationId = button.getAttribute('data-conversation-id');
    if (!conversationId) {
      console.error('Missing data-conversation-id attribute');
      return;
    }
    window.location.href = `/messenger/?conversation=${encodeURIComponent(conversationId)}`;
  }

  function attachHandler(button) {
    if (button.hasAttribute('data-messenger-initialized')) return;
    button.setAttribute('data-messenger-initialized', 'true');
    const action = button.getAttribute('data-messenger-action');

    button.addEventListener('click', async event => {
      event.preventDefault();
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
      }
    });
  }

  function resolveSupplierRecipientId(supplier) {
    if (!supplier || typeof supplier !== 'object') return '';
    return String(
      supplier.messagingRecipientId ||
        supplier.ownerUserId ||
        supplier.userId ||
        supplier.ownerId ||
        supplier.accountId ||
        ''
    ).trim();
  }

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
    button.onclick = async event => {
      event?.preventDefault();
      if (!(await checkAuth())) {
        window.location.href = `/auth?redirect=${encodeURIComponent(window.location.href)}`;
        return;
      }
      window.QuickComposeV4.open(options);
    };
    button.setAttribute('data-supplier-compose-ready', 'true');
    return true;
  }

  function initializeButtons() {
    document.querySelectorAll('[data-messenger-action]').forEach(attachHandler);
  }

  function setupMutationObserver() {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          if (node.hasAttribute && node.hasAttribute('data-messenger-action')) {
            attachHandler(node);
          }
          if (node.querySelectorAll) {
            node.querySelectorAll('[data-messenger-action]').forEach(attachHandler);
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }

  let mutationObserver = null;

  function init() {
    initializeButtons();
    wireSupplierProfileQuickCompose(window.__supplierData);
    mutationObserver = setupMutationObserver();
  }

  function destroy() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
  }

  window.addEventListener('sp:dataReady', event => {
    wireSupplierProfileQuickCompose(event.detail?.supplier);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.MessengerTrigger = {
    init,
    initializeButtons,
    attachHandler,
    destroy,
    resolveSupplierRecipientId,
    wireSupplierProfileQuickCompose,
  };
})();
