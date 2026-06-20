/**
 * MessengerDeleteArchiveLifecycle
 *
 * Client-side hardening for the separate Archive and Delete actions. Archive is
 * reversible. Delete is a per-user removal from Messenger views.
 */

'use strict';

(function () {
  function setDeleteButtonCopy() {
    const button = document.querySelector('#v4DeleteConvBtn');
    if (!button) {
      return;
    }
    button.setAttribute('aria-label', 'Delete conversation');
    button.setAttribute('title', 'Delete conversation');
  }

  function resetActiveConversation(app, conversationId) {
    if (!app) {
      return;
    }
    if (app._activeConversationId === conversationId) {
      app._activeConversationId = null;
      app.state?.setActiveConversation?.(null);
      app.chatView?.reset?.();
      if (app.composer) {
        app.composer.options.conversationId = null;
      }
      app.socket?.leaveConversation?.(conversationId);
      app.contextBanner?.hide?.();
      app.handleMobilePanel?.('sidebar');
    }
  }

  async function handleDeleteConversation(event) {
    const { id } = event.detail || {};
    if (!id) {
      return;
    }
    event.preventDefault?.();
    event.stopImmediatePropagation?.();

    const title = 'Delete conversation';
    const body =
      'Delete this conversation from your Messenger? This removes it from your inbox and archive. Other participants may still keep their copy.';
    const cta = 'Delete';
    let confirmed;
    if (window.MessengerModals?.showConfirm) {
      confirmed = await window.MessengerModals.showConfirm(title, body, cta, 'Cancel');
    } else {
      // eslint-disable-next-line no-alert
      confirmed = window.confirm(body);
    }
    if (!confirmed) {
      return;
    }

    const app = window.messengerAppV4;
    try {
      await app?.api?.deleteConversation?.(id);
      if (app?.state?.conversations) {
        app.state.setConversations(app.state.conversations.filter(conv => conv._id !== id));
      }
      resetActiveConversation(app, id);
      if (typeof window.showToast === 'function') {
        window.showToast('Conversation deleted from your Messenger.', 'success');
      }
    } catch (error) {
      console.error('[MessengerDeleteArchiveLifecycle] Delete conversation failed:', error);
      if (typeof window.showToast === 'function') {
        window.showToast('Could not delete this conversation. Please try again.', 'error');
      }
    }
  }

  function init() {
    setDeleteButtonCopy();
    // Capture phase runs before the existing MessengerAppV4 bubble listener, so
    // this replaces the older remove-from-inbox behaviour without double calls.
    window.addEventListener('messenger:delete-conversation', handleDeleteConversation, true);
    window.addEventListener('messenger:conversation-selected', () => {
      window.requestAnimationFrame(setDeleteButtonCopy);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
