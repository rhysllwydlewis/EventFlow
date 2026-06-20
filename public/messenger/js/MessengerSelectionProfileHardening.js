/**
 * MessengerSelectionProfileHardening
 *
 * Focused post-load hardening for the Messenger v4 selection flow.  This keeps
 * newly-created conversations on the selected supplier, reloads the chat pane
 * when the active id is stale/blank, and makes supplier header links use real
 * supplier profile IDs instead of account user IDs.
 */

'use strict';

(function () {
  function clean(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function conversationIdOf(value) {
    if (!value) {
      return '';
    }
    const id = clean(value._id || value.id || value.conversationId || value);
    return id;
  }

  function safeSupplierProfileId(participant, conversation) {
    return clean(
      participant?.supplierProfileId ||
        participant?.supplierId ||
        participant?.profileId ||
        participant?.supplierProfile?.id ||
        (conversation?.context?.type === 'supplier_profile' ? conversation.context.referenceId : '') ||
        conversation?.metadata?.supplierProfileId
    );
  }

  function updateUrlConversation(conversationId) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('conversation', conversationId);
      window.history.replaceState({}, '', url.toString());
    } catch {
      // Non-critical.  Selection should still work if history is unavailable.
    }
  }

  function patchMessengerApp() {
    const App = window.MessengerAppV4;
    if (!App || App.prototype.__selectionProfileHardeningPatched) {
      return;
    }

    const originalSelectConversation = App.prototype.selectConversation;
    App.prototype.selectConversation = async function hardenedSelectConversation(id, options = {}) {
      const conversationId = conversationIdOf(id);
      if (!conversationId) {
        return;
      }

      const headerVisible = this.chatView?.headerEl && this.chatView.headerEl.style.display !== 'none';
      const composerReady = this.composer?.options?.conversationId === conversationId;
      const chatReady = this.chatView?.conversationId === conversationId && headerVisible && composerReady;
      if (this._activeConversationId === conversationId && chatReady && !options.force) {
        this.composer?.focus?.();
        updateUrlConversation(conversationId);
        return;
      }

      // If state says this conversation is active but the pane is blank/stale, let the
      // original method run by clearing the early-return condition.
      if (this._activeConversationId === conversationId && (!chatReady || options.force)) {
        this._activeConversationId = null;
      }

      if (!this.state.conversations?.some(conv => conversationIdOf(conv) === conversationId)) {
        try {
          const data = await this.api.getConversation(conversationId);
          const fetched = data.conversation || data;
          if (fetched && conversationIdOf(fetched)) {
            this.state.updateConversation(fetched);
          }
        } catch (err) {
          console.warn('[MessengerSelectionHardening] Unable to prefetch conversation', err);
        }
      }

      await originalSelectConversation.call(this, conversationId);
      updateUrlConversation(conversationId);
    };

    App.prototype.createConversation = async function hardenedCreateConversation(
      participantIds,
      contextOrType = 'direct',
      options = {}
    ) {
      try {
        const { type, context } = App._resolveTypeAndContext(contextOrType);
        const data = await this.api.createConversation({
          type,
          participantIds,
          context,
          metadata: options.metadata || {},
        });
        const conversation = data.conversation || data;
        const conversationId = conversationIdOf(conversation);
        if (conversationId) {
          this.state.updateConversation(conversation);
          await this._loadConversations().catch(err => {
            console.warn('[MessengerSelectionHardening] Conversation list refresh failed', err);
          });
          await this.selectConversation(conversationId, { force: true });
          return conversation;
        }
      } catch (err) {
        console.error('[MessengerAppV4] createConversation failed:', err);
        if (typeof window.showToast === 'function') {
          window.showToast(
            err?.message || 'Failed to start conversation. Please try again.',
            'error'
          );
        }
        if (options.throwOnError) {
          throw err;
        }
      }
      return null;
    };

    App.prototype.__selectionProfileHardeningPatched = true;
  }

  function patchChatView() {
    const ChatView = window.ChatViewV4;
    if (!ChatView || ChatView.prototype.__profileLinkHardeningPatched) {
      return;
    }

    const originalRenderHeader = ChatView.prototype._renderHeader;
    ChatView.prototype._renderHeader = function hardenedRenderHeader(conversation) {
      originalRenderHeader.call(this, conversation);

      const currentUser = this.state.currentUser || {};
      const currentUserId = clean(currentUser.id || currentUser._id);
      const other = (conversation.participants || []).find(
        participant => clean(participant.userId || participant.id) !== currentUserId
      );
      const supplierProfileId = safeSupplierProfileId(other, conversation);
      const profileLink = this.container.querySelector('#v4HeaderProfileLink');
      if (!profileLink) {
        return;
      }
      if (supplierProfileId) {
        profileLink.href = `/supplier?id=${encodeURIComponent(supplierProfileId)}`;
        profileLink.style.cursor = '';
        profileLink.setAttribute('aria-label', 'View supplier profile');
        profileLink.setAttribute('title', 'View supplier profile');
      } else {
        profileLink.removeAttribute('href');
        profileLink.style.cursor = 'default';
        profileLink.setAttribute('aria-label', 'Conversation header');
        profileLink.removeAttribute('title');
      }
    };

    ChatView.prototype.__profileLinkHardeningPatched = true;
  }

  patchMessengerApp();
  patchChatView();
})();
