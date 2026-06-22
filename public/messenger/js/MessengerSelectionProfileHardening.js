/**
 * MessengerSelectionProfileHardening
 *
 * Focused post-load hardening for the Messenger v4 selection flow. This keeps
 * newly-created conversations on the selected supplier, reloads the chat pane
 * when the active id is stale/blank, and makes supplier header links use real
 * supplier profile IDs instead of account user IDs.
 */

'use strict';

(function () {
  const supplierProfileCache = new Map();

  function clean(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function conversationIdOf(value) {
    if (!value) {
      return '';
    }
    return clean(value._id || value.id || value.conversationId || value);
  }

  function safeSupplierProfileId(participant, conversation) {
    return clean(
      participant?.supplierProfileId ||
        participant?.supplierId ||
        participant?.profileId ||
        participant?.supplierProfile?.id ||
        (conversation?.context?.type === 'supplier_profile'
          ? conversation.context.referenceId
          : '') ||
        conversation?.metadata?.supplierProfileId
    );
  }

  function updateUrlConversation(conversationId) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('conversation', conversationId);
      window.history.replaceState({}, '', url.toString());
    } catch {
      // Non-critical. Selection should still work if history is unavailable.
    }
  }

  function resolveTypeAndContext(contextOrType) {
    const contextTypeToConversationType = {
      package: 'enquiry',
      supplier_profile: 'direct',
      marketplace_listing: 'marketplace',
      find_a_supplier: 'direct',
    };
    const legacyContextAlias = {
      supplier: 'supplier_profile',
      marketplace: 'marketplace_listing',
    };
    const conversationTypes = new Set([
      'direct',
      'marketplace',
      'enquiry',
      'supplier_network',
      'support',
    ]);

    if (typeof contextOrType === 'string') {
      const value = contextOrType.trim();
      if (!value || value === 'direct') {
        return { type: 'direct', context: null };
      }
      if (conversationTypes.has(value)) {
        return { type: value, context: null };
      }
      const canonical = legacyContextAlias[value] || value;
      if (contextTypeToConversationType[canonical]) {
        return { type: contextTypeToConversationType[canonical], context: { type: canonical } };
      }
      return { type: 'direct', context: null };
    }

    if (contextOrType && typeof contextOrType === 'object') {
      const rawType = contextOrType.type || null;
      const canonical = rawType ? legacyContextAlias[rawType] || rawType : null;
      if (canonical && contextTypeToConversationType[canonical]) {
        const context = { type: canonical };
        if (contextOrType.referenceId !== undefined && contextOrType.referenceId !== null) {
          context.referenceId = String(contextOrType.referenceId);
        }
        if (contextOrType.referenceTitle !== undefined && contextOrType.referenceTitle !== null) {
          context.referenceTitle = String(contextOrType.referenceTitle);
        }
        if (contextOrType.referenceImage !== undefined && contextOrType.referenceImage !== null) {
          context.referenceImage = String(contextOrType.referenceImage);
        }
        return { type: contextTypeToConversationType[canonical], context };
      }
      if (canonical && conversationTypes.has(canonical)) {
        return { type: canonical, context: null };
      }
    }

    return { type: 'direct', context: null };
  }

  function patchMessengerAppInstance() {
    const app = window.messengerAppV4;
    if (!app || app.__selectionProfileHardeningPatched) {
      return false;
    }
    if (
      typeof app.selectConversation !== 'function' ||
      typeof app.createConversation !== 'function'
    ) {
      return false;
    }

    const originalSelectConversation = app.selectConversation.bind(app);

    app.selectConversation = async function hardenedSelectConversation(id, options = {}) {
      const conversationId = conversationIdOf(id);
      if (!conversationId) {
        return;
      }

      const headerVisible =
        app.chatView?.headerEl && app.chatView.headerEl.style.display !== 'none';
      const composerReady = app.composer?.options?.conversationId === conversationId;
      const chatReady =
        app.chatView?.conversationId === conversationId && headerVisible && composerReady;
      if (app._activeConversationId === conversationId && chatReady && !options.force) {
        app.composer?.focus?.();
        updateUrlConversation(conversationId);
        return;
      }

      if (app._activeConversationId === conversationId && (!chatReady || options.force)) {
        app._activeConversationId = null;
      }

      if (!app.state.conversations?.some(conv => conversationIdOf(conv) === conversationId)) {
        try {
          const data = await app.api.getConversation(conversationId);
          const fetched = data.conversation || data;
          if (fetched && conversationIdOf(fetched)) {
            app.state.updateConversation(fetched);
          }
        } catch (err) {
          console.warn('[MessengerSelectionHardening] Unable to prefetch conversation', err);
        }
      }

      await originalSelectConversation(conversationId);
      updateUrlConversation(conversationId);
    };

    app.createConversation = async function hardenedCreateConversation(
      participantIds,
      contextOrType = 'direct',
      options = {}
    ) {
      try {
        const { type, context } = resolveTypeAndContext(contextOrType);
        const data = await app.api.createConversation({
          type,
          participantIds,
          context,
          metadata: options.metadata || {},
        });
        const conversation = data.conversation || data;
        const conversationId = conversationIdOf(conversation);
        if (conversationId) {
          app.state.updateConversation(conversation);
          await app._loadConversations().catch(err => {
            console.warn('[MessengerSelectionHardening] Conversation list refresh failed', err);
          });
          await app.selectConversation(conversationId, { force: true });
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

    app.__selectionProfileHardeningPatched = true;
    return true;
  }

  async function lookupSupplierProfileIdForParticipant(participant) {
    const userId = clean(participant?.userId || participant?.id);
    if (!userId) {
      return '';
    }
    if (supplierProfileCache.has(userId)) {
      return supplierProfileCache.get(userId);
    }
    try {
      const response = await fetch('/api/suppliers', { credentials: 'include' });
      if (!response.ok) {
        supplierProfileCache.set(userId, '');
        return '';
      }
      const payload = await response.json();
      const suppliers = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload)
          ? payload
          : [];
      const match = suppliers.find(supplier =>
        [
          supplier.ownerUserId,
          supplier.messagingRecipientId,
          supplier.userId,
          supplier.createdByUserId,
          supplier.accountId,
        ]
          .map(clean)
          .filter(Boolean)
          .includes(userId)
      );
      const profileId = clean(match?.id || match?.supplierId || match?._id);
      supplierProfileCache.set(userId, profileId);
      return profileId;
    } catch {
      supplierProfileCache.set(userId, '');
      return '';
    }
  }

  function setSupplierProfileLink(profileLink, supplierProfileId) {
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
  }

  function patchChatView() {
    const ChatView = window.ChatViewV4;
    if (!ChatView || ChatView.prototype.__profileLinkHardeningPatched) {
      return false;
    }

    const originalRenderHeader = ChatView.prototype._renderHeader;
    ChatView.prototype._renderHeader = function hardenedRenderHeader(conversation) {
      originalRenderHeader.call(this, conversation);

      const currentUser = this.state.currentUser || {};
      const currentUserId = clean(currentUser.id || currentUser._id);
      const other = (conversation.participants || []).find(
        participant => clean(participant.userId || participant.id) !== currentUserId
      );
      const profileLink = this.container.querySelector('#v4HeaderProfileLink');
      if (!profileLink) {
        return;
      }

      const immediateProfileId = safeSupplierProfileId(other, conversation);
      setSupplierProfileLink(profileLink, immediateProfileId);

      if (!immediateProfileId && clean(other?.role).toLowerCase() === 'supplier') {
        const expectedConversationId = this.conversationId;
        lookupSupplierProfileIdForParticipant(other).then(profileId => {
          if (profileId && this.conversationId === expectedConversationId) {
            setSupplierProfileLink(profileLink, profileId);
          }
        });
      }
    };

    ChatView.prototype.__profileLinkHardeningPatched = true;
    return true;
  }

  function patchNowOrAfterBoot() {
    patchChatView();
    if (patchMessengerAppInstance()) {
      return;
    }
    const retry = () => {
      patchChatView();
      patchMessengerAppInstance();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(retry, 0), { once: true });
    }
    setTimeout(retry, 250);
  }

  patchNowOrAfterBoot();
})();
