/**
 * MessengerAppV4 - Main Orchestrator
 * Wires together all v4 components via window CustomEvents.
 * Handles deep links, keyboard shortcuts, mobile panel switching,
 * and WebSocket event routing.
 */

// Global CSP-safe image error handler for messenger pages (capture phase).
// Mirrors the handler embedded in app.js to cover pages that load only messenger scripts.
'use strict';
(function () {
  function _handleImgError(e) {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') {
      return;
    }
    if (img.dataset.fallbackApplied) {
      return;
    }
    img.dataset.fallbackApplied = 'true';
    if (img.dataset.fallbackAction === 'attachment-error') {
      img.style.display = 'none';
      img.classList.add('messenger-v4__attachment-error');
      if (img.parentNode) {
        const w = document.createElement('span');
        w.className = 'messenger-v4__attachment-error-label';
        w.title = 'Image unavailable';
        const l = document.createElement('span');
        l.textContent = 'Image unavailable';
        const h = document.createElement('span');
        h.className = 'messenger-v4__attachment-error-hint';
        h.textContent = 'The file may have been removed';
        w.appendChild(l);
        w.appendChild(h);
        img.parentNode.appendChild(w);
      }
      return;
    }
    if (img.dataset.fallbackSrc) {
      img.src = img.dataset.fallbackSrc;
      return;
    }
    if ('fallbackHide' in img.dataset) {
      img.style.display = 'none';
      if ('fallbackShowNext' in img.dataset && img.nextElementSibling) {
        img.nextElementSibling.style.display = 'flex';
      }
    }
  }
  // Guard against double-registration in case app.js is also loaded on this page.
  if (!window.__imgFallbackRegistered) {
    window.__imgFallbackRegistered = true;
    document.addEventListener('error', _handleImgError, true);
  }
})();

class MessengerAppV4 {
  constructor() {
    // Core services (rely on global classes from existing scripts)
    this.api = null;
    this.state = null;
    this.socket = null;
    this.currentUser = null;

    // Component references
    this.conversationList = null;
    this.chatView = null;
    this.composer = null;
    this.contactPicker = null;
    this.contextBanner = null;
    this.typingIndicator = null;
    this.notificationBridge = null;

    // Track selected conversation
    this._activeConversationId = null;
    this.recon = window.ReconciliationFSM ? new window.ReconciliationFSM() : null;
    this._queuedLiveEvents = [];
    this._seenSeqByConv = new Map();
    this._seenClientMessageIds = new Map();
    this._deliveredQueue = new Map();
    this._deliveredFlushTimer = null;
    this._readUpToSeq = new Map();
    this._readDebounceTimer = null;
    this._visibleSeqByConv = new Map();
    this._readObserver = null;
    this._reconMetrics = {
      duplicateSeqDrops: 0,
      clientMessageIdReconciliations: 0,
      catchupGapSize: 0,
      timeToLiveMs: 0,
    };
    this._connectStartedAt = 0;
    this._telemetry = null;
    this._telemetryVisibilityHandler = null;
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async init() {
    try {
      // Instantiate core services
      this.api = new MessengerAPI();
      this.state = new MessengerState();

      // 1. Load current user
      this.currentUser = await this._loadCurrentUser();
      if (!this.currentUser) {
        window.location.href = '/auth';
        return;
      }
      this.state.setCurrentUser(this.currentUser);
      this._initTelemetry();

      // 2. Initialize all components
      this._initComponents();

      // 3. Connect WebSocket
      if (window.MessengerSocket) {
        this.socket = new MessengerSocket(this.state);
        this.recon?.transition('CONNECTING');
        this._connectStartedAt = Date.now();
        this.socket.connect(this._getCurrentUserId());
      }

      // 4. Load initial conversation list
      await this._loadConversations();
      this._loadBlockedUsers();

      // 5. Handle deep links (?conversation=X, ?new=1, ?contact=userId)
      this.handleDeepLink();

      // 6. Keyboard shortcuts
      this._setupKeyboardShortcuts();

      // 7. Responsive mode handling
      this._setupResponsive();

      // 8. Request notification permission (non-blocking)
      this.notificationBridge?.requestPermission();
      this._setupReadObserver();
    } catch (err) {
      console.error('[MessengerAppV4] init failed:', err);
      this._showGlobalError('Failed to load messenger. Please refresh the page.');
    }
  }

  // ---------------------------------------------------------------------------
  // Component initialization
  // ---------------------------------------------------------------------------

  _initComponents() {
    // Conversation list (sidebar)
    const listContainer = document.querySelector('[data-v4="conversation-list"]');
    if (listContainer && window.ConversationListV4) {
      this.conversationList = new ConversationListV4(listContainer, this.state, this.api);
    }

    // Chat view (main panel)
    const chatContainer = document.querySelector('[data-v4="chat-view"]');
    if (chatContainer && window.ChatViewV4) {
      this.chatView = new ChatViewV4(chatContainer, this.state, this.api);
    }

    // Message composer
    const composerContainer = document.querySelector('[data-v4="composer"]');
    if (composerContainer && window.MessageComposerV4) {
      this.composer = new MessageComposerV4(composerContainer, {
        onTyping: isTyping => this._broadcastTyping(isTyping),
        // Using onSend (awaited + throws on failure) instead of the legacy
        // 'composer:send' event lets the composer keep the user's typed
        // content when the send fails so it can be retried.
        onSend: payload => this._sendMessage(payload),
        maxLength: 5000,
      });
    }

    // Contact picker
    const pickerContainer = document.querySelector('[data-v4="contact-picker"]');
    if (pickerContainer && window.ContactPickerV4) {
      this.contactPicker = new ContactPickerV4(pickerContainer, this.api, {
        currentUserId: this._getCurrentUserId(),
        currentUserRole: this.state.currentUser?.role || null,
        onSelect: ({ contact, metadata }) =>
          this.createConversation([contact._id || contact.id], 'direct', {
            throwOnError: true,
            metadata: metadata || {},
          }),
      });
    } else {
      console.warn(
        '[MessengerAppV4] ContactPickerV4 not initialized: container or class missing.',
        { pickerContainer, ContactPickerV4: !!window.ContactPickerV4 }
      );
    }

    // Context banner
    const bannerContainer = document.querySelector('[data-v4="context-banner"]');
    if (bannerContainer && window.ContextBannerV4) {
      this.contextBanner = new ContextBannerV4(bannerContainer);
    }

    // Typing indicator
    const typingContainer = document.querySelector('[data-v4="typing-indicator"]');
    if (typingContainer && window.TypingIndicatorV4) {
      this.typingIndicator = new TypingIndicatorV4(typingContainer);
    }

    // Notification bridge
    if (window.NotificationBridgeV4) {
      this.notificationBridge = new NotificationBridgeV4({ titlePrefix: 'EventFlow' });
    }

    // Wire up global event bus
    this._setupEventBus();
  }

  // ---------------------------------------------------------------------------
  // Event bus (window CustomEvents)
  // ---------------------------------------------------------------------------

  _setupEventBus() {
    // Conversation selected (from list or deep link)
    window.addEventListener('messenger:conversation-selected', e => {
      const { id } = e.detail || {};
      if (id) {
        this.selectConversation(id);
      }
    });

    // New message from socket
    window.addEventListener('messenger:new-message', async e => {
      const { message, conversationId } = e.detail || {};
      if (!message) {
        return;
      }

      if (this.recon && this.recon.getState() === 'CATCHING_UP') {
        this._queuedLiveEvents.push({ message, conversationId });
        return;
      }
      if (this._isDuplicateMessage(conversationId, message)) {
        this._reconMetrics.duplicateSeqDrops++;
        this._recordTelemetry({ dupSeqDrops: 1 });
        this._logRecon('duplicate-drop', { conversationId, seq: message.seq });
        return;
      }

      // Update state
      this._upsertMessage(conversationId, message);
      this._trackLastSeenSeq(conversationId, message.seq);

      // Update conversation list (bubble last message to top).
      // If the conversation is not in state yet (e.g. it was archived and never
      // loaded, or it is brand-new), fetch it from the server so the message
      // appears in the correct inbox rather than being silently dropped.
      let conv = this.state.conversations.find(c => c._id === conversationId);
      if (!conv) {
        try {
          const data = await this.api.getConversation(conversationId);
          const fetched = data.conversation || data;
          if (fetched && fetched._id) {
            this.state.updateConversation(fetched);
            conv = this.state.conversations.find(c => c._id === conversationId);
          }
        } catch (err) {
          // Best-effort — proceed with whatever state we have. Log so archived-to-active
          // transition failures are diagnosable in production.
          console.warn(
            '[MessengerAppV4] Failed to fetch missing conversation',
            conversationId,
            err.message
          );
        }
      }
      if (conv) {
        conv.lastMessage = message;
        conv.updatedAt = message.createdAt || new Date().toISOString();
        this.state.updateConversation(conv);
      }

      // Desktop notification if conversation is not currently open
      if (conversationId !== this._activeConversationId) {
        const uid = this._getCurrentUserId();
        // Optimistically increment local unread count for the receiving participant
        if (uid && conv) {
          const me = conv.participants?.find(p => p.userId === uid);
          if (me && me.userId !== message.senderId) {
            me.unreadCount = (me.unreadCount || 0) + 1;
            this.state.updateConversation(conv);
          }
        }
        const unread = this.state.conversations.reduce((sum, c) => {
          const participant = c.participants?.find(p => p.userId === uid);
          return sum + (participant?.unreadCount || 0);
        }, 0);
        this.state.setUnreadCount(unread);
        window.dispatchEvent(
          new CustomEvent('messenger:unread-count', { detail: { count: unread } })
        );

        this.notificationBridge?.notify(
          message.senderName || 'New message',
          message.content || '📎 Attachment',
          { conversationId, tag: `msg-${conversationId}` }
        );
      }
    });

    // Composer send (legacy event-bus path).
    // The composer now prefers the direct `onSend` callback wired in
    // `_initializeComponents()` — when that callback is present the composer
    // does not dispatch 'composer:send'.  This listener remains only as a
    // compatibility shim for any older composer instances that still emit
    // the event, and intentionally does not re-throw to avoid double-sends.
    window.addEventListener('composer:send', async e => {
      const { message, files, replyTo, conversationId } = e.detail || {};
      try {
        await this._sendMessage({
          message,
          files,
          replyTo,
          conversationId: conversationId || this._activeConversationId,
        });
      } catch (err) {
        // The new `onSend` callback path already preserves composer state and
        // surfaces the error.  For the legacy event-bus path we can't recover
        // input (composer already reset optimistically), so at least notify
        // the user that the send failed.
        console.error('[MessengerAppV4] composer:send (legacy) failed:', err);
        if (typeof window.showToast === 'function') {
          window.showToast('Failed to send message. Please try again.', 'error');
        }
      }
    });

    // Contact picker selected → create conversation
    window.addEventListener('contactpicker:selected', async e => {
      const { contact, context } = e.detail || {};
      if (contact) {
        await this.createConversation([contact._id || contact.id], context);
      }
    });

    // Typing events — only react to other users' typing (from WebSocket via MessengerSocket).
    // The local composer fires 'messenger:typing' too, but without a userId field;
    // guard against showing the current user's own typing indicator.
    window.addEventListener('messenger:typing', e => {
      const { conversationId, isTyping, userName, userId } = e.detail || {};
      // Skip events with no userId — these are local composer broadcasts, not incoming WS events
      if (!userId) {
        return;
      }
      if (conversationId !== this._activeConversationId) {
        return;
      }
      if (isTyping) {
        this.typingIndicator?.show(userName || '');
        this.chatView?.showTyping(userName || '');
      } else {
        this.typingIndicator?.hide();
        this.chatView?.hideTyping();
      }
    });

    window.addEventListener('messenger:connected', async () => {
      this._hideGlobalError();
      const prev = this.recon?.getState();
      if (prev === 'DISCONNECTED') {
        this.recon?.transition('RECONNECTING');
      }
      this.recon?.transition('CATCHING_UP');
      this._connectStartedAt = Date.now();
      await this._catchUpAllConversations();
      this.recon?.transition('LIVE');
      this._reconMetrics.timeToLiveMs = Date.now() - this._connectStartedAt;
      this._recordTelemetry({ timeToLiveMs: this._reconMetrics.timeToLiveMs });
      this._logRecon('time-to-live', { ms: this._reconMetrics.timeToLiveMs });
      this._flushTelemetry('live');
      this.chatView?.setConnectionState?.('LIVE');
      this._replayQueuedLiveEvents();
    });
    window.addEventListener('messenger:disconnected', () => {
      this.recon?.transition('DISCONNECTED');
      this.chatView?.setConnectionState?.('DISCONNECTED');
    });

    window.addEventListener('messenger:message-rendered', e => {
      const { conversationId, message } = e.detail || {};
      if (!conversationId || !message) {
        return;
      }
      this._trackLastSeenSeq(conversationId, message.seq);
      this._enqueueDelivered(conversationId, message);
    });

    // Server denied a v4 room join (not a participant, invalid id, or not
    // authenticated).  Without this handler the user silently stops receiving
    // realtime updates for the selected conversation; surface a friendly
    // toast when the global helper is available so they know to reload.
    window.addEventListener('messenger:join-error', e => {
      const { error } = e.detail || {};
      if (typeof window.showToast !== 'function') {
        return;
      }
      if (error === 'forbidden') {
        window.showToast('You are not a participant in that conversation.', 'error');
      } else if (error === 'unauthenticated') {
        window.showToast('Please sign in again to receive live messages.', 'error');
      } else if (error === 'invalid_conversation_id') {
        window.showToast('That conversation link looks malformed.', 'error');
      } else {
        window.showToast('Could not subscribe to live updates for this conversation.', 'error');
      }
    });

    // Report/block from chat header or per-message context menu
    window.addEventListener('messenger:report-user', async e => {
      const { userId } = e.detail || {};
      await this._reportContent('user', userId, 'Report this user');
    });
    window.addEventListener('messenger:report-message', async e => {
      const { messageId, senderId } = e.detail || {};
      if (messageId) {
        await this._reportContent('message', messageId, 'Report this message');
      } else if (senderId) {
        await this._reportContent('user', senderId, 'Report this user');
      }
    });
    window.addEventListener('messenger:block-user', async e => {
      const { userId } = e.detail || {};
      await this._blockUser(userId);
    });
    window.addEventListener('messenger:unblock-user', async e => {
      const { userId } = e.detail || {};
      await this._unblockUser(userId);
    });

    // Pin/archive from list or chat header
    window.addEventListener('messenger:pin-conversation', async e => {
      const { id } = e.detail || {};
      if (id) {
        await this._togglePin(id);
      }
    });
    window.addEventListener('messenger:archive-conversation', async e => {
      const { id } = e.detail || {};
      if (!id) {
        return;
      }
      // Capture whether the conversation was archived BEFORE toggling so we
      // can decide whether to navigate back to the list. We only want to
      // auto-navigate away when archiving (moving out of the inbox); when
      // un-archiving from inside the archive, the user should stay in the
      // now-restored conversation.
      const uidBefore = this._getCurrentUserId();
      const convBefore = this.state.conversations.find(c => c._id === id);
      const meBefore = uidBefore
        ? convBefore?.participants?.find(p => p.userId === uidBefore)
        : null;
      const wasArchived = !!meBefore?.isArchived;
      await this._toggleArchive(id);
      // If the user just archived (not un-archived) the currently-open
      // conversation, navigate back to the list.
      if (!wasArchived && id === this._activeConversationId) {
        this._activeConversationId = null;
        this.state.setActiveConversation(null);
        this.chatView?.reset();
        if (this.composer) {
          this.composer.options.conversationId = null;
        }
        this.socket?.leaveConversation(id);
        this.contextBanner?.hide();
        this.handleMobilePanel('sidebar');
      } else if (wasArchived && id === this._activeConversationId) {
        // Un-archived while viewing: refresh the header so the Archive button
        // flips back to its default state without needing a reload.
        const convAfter = this.state.conversations.find(c => c._id === id);
        if (convAfter && this.chatView?._renderHeader) {
          this.chatView._renderHeader(convAfter);
        }
      }
    });

    // Remove from inbox
    window.addEventListener('messenger:delete-conversation', async e => {
      const { id } = e.detail || {};
      if (!id) {
        return;
      }
      // Detect if this conversation is already archived — deleting from the
      // Backend behaviour is archive/remove-from-inbox, not permanent deletion.
      const uid = this._getCurrentUserId();
      const convRef = this.state.conversations.find(c => c._id === id);
      const meRef = uid ? convRef?.participants?.find(p => p.userId === uid) : null;
      const isArchived = !!meRef?.isArchived;
      const confirmTitle = 'Remove from inbox';
      const confirmBody = isArchived
        ? 'Are you sure you want to remove this conversation from your inbox?'
        : 'Are you sure you want to remove this conversation from your inbox?';
      const confirmCta = 'Remove from inbox';
      let confirmed;
      if (window.MessengerModals?.showConfirm) {
        confirmed = await window.MessengerModals.showConfirm(
          confirmTitle,
          confirmBody,
          confirmCta,
          'Cancel'
        );
      } else {
        // eslint-disable-next-line no-alert
        confirmed = window.confirm(confirmBody);
      }
      if (!confirmed) {
        return;
      }
      try {
        await this.api.deleteConversation(id);
        this.state.setConversations(this.state.conversations.filter(c => c._id !== id));
        if (this._activeConversationId === id) {
          this._activeConversationId = null;
          this.state.setActiveConversation(null);
          this.chatView?.reset();
          if (this.composer) {
            this.composer.options.conversationId = null;
          }
          this.socket?.leaveConversation(id);
          this.contextBanner?.hide();
          this.handleMobilePanel('sidebar');
        }
      } catch (err) {
        console.error('[MessengerAppV4] Remove from inbox failed:', err);
      }
    });

    // Mark conversation as unread
    window.addEventListener('messenger:mark-unread', async e => {
      const { id } = e.detail || {};
      if (!id) {
        return;
      }
      try {
        await this.api.markAsUnread(id);
        // Optimistic: update local participant state so button updates immediately
        const uid = this._getCurrentUserId();
        if (uid) {
          const conv = this.state.conversations.find(c => c._id === id);
          if (conv) {
            const me = conv.participants?.find(p => p.userId === uid);
            if (me) {
              me.unreadCount = (me.unreadCount || 0) + 1;
              this.state.updateConversation(conv);
            }
          }
        }
        if (this.chatView && this._activeConversationId === id) {
          this.chatView._updateMarkUnreadBtn(true);
        }
        await this._loadConversations();
      } catch (err) {
        console.error('[MessengerAppV4] Mark as unread failed:', err);
      }
    });

    // Mark conversation as read (toggle counterpart to mark-unread)
    window.addEventListener('messenger:mark-read', async e => {
      const { id } = e.detail || {};
      if (!id) {
        return;
      }
      try {
        await this.api.markAsRead(id);
        // Optimistic: clear local unread count
        const uid = this._getCurrentUserId();
        if (uid) {
          const conv = this.state.conversations.find(c => c._id === id);
          if (conv) {
            const me = conv.participants?.find(p => p.userId === uid);
            if (me) {
              me.unreadCount = 0;
              this.state.updateConversation(conv);
              const totalUnread = this.state.conversations.reduce((sum, c) => {
                const p = c.participants?.find(q => q.userId === uid);
                return sum + (p?.unreadCount || 0);
              }, 0);
              this.state.setUnreadCount(totalUnread);
              window.dispatchEvent(
                new CustomEvent('messenger:unread-count', { detail: { count: totalUnread } })
              );
            }
          }
        }
        if (this.chatView && this._activeConversationId === id) {
          this.chatView._updateMarkUnreadBtn(false);
        }
        await this._loadConversations();
      } catch (err) {
        console.error('[MessengerAppV4] Mark as read failed:', err);
      }
    });

    // Open contact picker
    window.addEventListener('messenger:open-contact-picker', () => {
      if (this.contactPicker) {
        this.contactPicker.open();
      } else {
        console.warn('[MessengerAppV4] Contact picker is not available.');
        // Show a user-facing toast if the global helper is available
        if (typeof window.showToast === 'function') {
          window.showToast('Unable to open contact picker. Please refresh and try again.', 'error');
        }
      }
    });

    // Deep-link: open contact picker pre-targeted at a specific userId (from MessengerTrigger ?recipientId=)
    window.addEventListener('messenger:open-contact-by-id', async e => {
      const { userId, context, prefill } = e.detail || {};
      if (!userId) {
        return;
      }
      // Try to find and open an existing conversation with this user first
      const existing = this.state.conversations.find(c =>
        c.participants?.some(p => p.userId === userId)
      );
      if (existing) {
        await this.selectConversation(existing._id);
      } else {
        // No existing conversation — create one directly
        await this.createConversation([userId], context || 'direct');
      }
      // After conversation is open and composer is ready, apply prefill text
      if (prefill && this.composer?.textarea) {
        const ta = this.composer.textarea;
        ta.value = prefill;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.focus();
      }
    });

    // Mobile back
    window.addEventListener('messenger:mobile-back', () => {
      this._activeConversationId = null;
      this.state.setActiveConversation(null);
      this.handleMobilePanel('sidebar');
    });

    // Unread count → notification bridge
    window.addEventListener('messenger:unread-count', e => {
      const count = e.detail?.count ?? e.detail ?? 0;
      this.notificationBridge?.setUnreadCount(count);
    });

    // New conversation arrived via WebSocket (e.g., marketplace enquiry from another user)
    window.addEventListener('messenger:new-conversation', e => {
      const { conversation } = e.detail || {};
      if (conversation) {
        this.state.updateConversation(conversation);
      }
    });

    // Real-time message edit from another user's session
    window.addEventListener('messenger:message-edited', e => {
      const { messageId, content, editedAt } = e.detail || {};
      // Only update if we have a messageId and valid content from the server
      if (!messageId || !content || !this._activeConversationId) {
        return;
      }
      this.state.updateMessage(this._activeConversationId, messageId, {
        content,
        isEdited: true,
        editedAt,
      });
      // Patch the DOM bubble text if it's visible — use textContent (never innerHTML) to prevent XSS
      const el = this.chatView?.messagesEl?.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
      if (el) {
        const textEl = el.querySelector('.messenger-v4__message-text');
        if (textEl) {
          textEl.textContent = content;
        }
        // Add "(edited)" label if not already present; use createTextNode to stay safe
        if (!el.querySelector('.messenger-v4__edited-label')) {
          const bubble = el.querySelector('.messenger-v4__message-bubble');
          if (bubble) {
            const span = document.createElement('span');
            span.className = 'messenger-v4__edited-label';
            span.setAttribute('aria-label', 'Edited');
            span.textContent = '(edited)';
            bubble.appendChild(span);
          }
        }
      }
    });

    // Real-time message delete from another user's session
    window.addEventListener('messenger:message-deleted', e => {
      const { messageId } = e.detail || {};
      if (messageId && this._activeConversationId) {
        this.state.deleteMessage(this._activeConversationId, messageId);
        const el = this.chatView?.messagesEl?.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
        if (el) {
          el.remove();
        }
        // Reload conversation list so lastMessage preview stays accurate
        this._loadConversations().catch(() => {});
      }
    });

    // Real-time reaction update from another user's session
    window.addEventListener('messenger:reaction-updated', e => {
      const { messageId, reactions } = e.detail || {};
      if (messageId && this._activeConversationId) {
        this.state.updateMessage(this._activeConversationId, messageId, {
          reactions: reactions || [],
        });
        // Re-render the reactions bar in the DOM.
        // MessageBubbleV4.renderReactions() escapes all dynamic values (emoji, messageId, counts)
        // via MessageBubbleV4.escape() before building the HTML string, so innerHTML is safe here.
        const el = this.chatView?.messagesEl?.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
        if (el && window.MessageBubbleV4) {
          const existing = el.querySelector('.messenger-v4__reactions-bar');
          if (existing) {
            existing.remove();
          }
          if (reactions?.length) {
            const tmp = document.createElement('div');
            tmp.innerHTML = window.MessageBubbleV4.renderReactions(reactions, messageId);
            const bar = tmp.firstElementChild;
            if (bar) {
              el.querySelector('.messenger-v4__message-content')?.appendChild(bar);
            }
          }
        }
      }
    });

    // Conversation updated (pin/archive/mute change) — the route now emits the full
    // updated conversation object so participant-level fields (isPinned, isArchived,
    // isMuted, unreadCount) are updated correctly.
    window.addEventListener('messenger:conversation-updated', e => {
      const { conversationId, conversation } = e.detail || {};
      if (!conversationId) {
        return;
      }
      if (conversation) {
        // Full conversation received — replace directly so participant fields stay in sync
        this.state.updateConversation(conversation);
      }
    });

    // Another session deleted this conversation — remove from local state and reset chat if active
    window.addEventListener('messenger:conversation-deleted', e => {
      const { conversationId } = e.detail || {};
      if (!conversationId) {
        return;
      }
      this.state.setConversations(this.state.conversations.filter(c => c._id !== conversationId));
      if (this._activeConversationId === conversationId) {
        this._activeConversationId = null;
        this.state.setActiveConversation(null);
        this.chatView?.reset();
        if (this.composer) {
          this.composer.options.conversationId = null;
        }
        this.socket?.leaveConversation(conversationId);
        this.contextBanner?.hide();
        this.handleMobilePanel('sidebar');
      }
    });

    // Read receipt: another participant read the conversation → update sent message tick colours
    window.addEventListener('messenger:conversation-read', e => {
      const { conversationId, userId } = e.detail || {};
      if (!conversationId || conversationId !== this._activeConversationId) {
        return;
      }
      const uid = this._getCurrentUserId();
      // Only react when a different user (the recipient) has read — not our own echo
      if (userId === uid || !this.chatView?.messagesEl) {
        return;
      }
      this.chatView.messagesEl
        .querySelectorAll('.messenger-v4__message--sent .messenger-v4__read-receipt')
        .forEach(el => {
          // Static SVG only — no user input involved, not an XSS risk.
          // Using createElementNS would require 6+ lines; innerHTML is acceptable here.
          el.innerHTML =
            '<svg width="18" height="10" viewBox="0 0 18 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1,5 4,9 11,1"/><polyline points="7,5 10,9 17,1"/></svg>';
          el.classList.add('messenger-v4__read-receipt--read');
          el.setAttribute('aria-label', 'Read');
          el.title = 'Read';
        });
    });

    // Per-message delivery receipt from a recipient — flip the sender's
    // tick state without waiting for sinceSeq reconciliation.  Receipts for
    // other conversations still update internal message state so the tick
    // is correct when the conversation becomes active.
    window.addEventListener('messenger:message-delivered', e => {
      const { conversationId, userId, messageIds, deliveredAt } = e.detail || {};
      if (!conversationId || !Array.isArray(messageIds) || !userId) {
        return;
      }
      const uid = this._getCurrentUserId();
      if (userId === uid) {
        return; // our own receipt echo
      }
      const at = deliveredAt ? new Date(deliveredAt) : new Date();
      const convMessages =
        typeof this.state.getMessages === 'function'
          ? this.state.getMessages(conversationId) || []
          : [];
      const byId = new Map(convMessages.map(m => [String(m._id), m]));
      for (const id of messageIds) {
        const existing = byId.get(String(id)) || null;
        const prevDelivered = Array.isArray(existing?.deliveredTo) ? existing.deliveredTo : [];
        if (prevDelivered.some(d => d.userId === userId)) {
          continue;
        }
        const nextDelivered = prevDelivered.concat([{ userId, deliveredAt: at }]);
        this.state.updateMessage?.(conversationId, id, { deliveredTo: nextDelivered });
      }
      if (conversationId === this._activeConversationId && this.chatView?.messagesEl) {
        // Double-tick "delivered" glyph — matches MessageBubbleV4._ICON_CHECK_DOUBLE
        // so the visual swap here stays in lockstep with the initial render.
        // Keep this literal in sync with that module; both are static, no user
        // input is interpolated so innerHTML assignment is safe (no XSS risk).
        const doubleTickSvg =
          '<svg width="18" height="10" viewBox="0 0 18 10" fill="none" ' +
          'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
          'stroke-linejoin="round" aria-hidden="true">' +
          '<polyline points="1,5 4,9 11,1"/>' +
          '<polyline points="7,5 10,9 17,1"/></svg>';
        for (const id of messageIds) {
          const el = this.chatView.messagesEl.querySelector(
            `[data-id="${CSS.escape(String(id))}"]`
          );
          if (!el) {
            continue;
          }
          // Only flip sender-side receipts — a recipient should never see a
          // "delivered" tick on their own bubble.
          if (!el.classList.contains('messenger-v4__message--sent')) {
            continue;
          }
          const receipt = el.querySelector('.messenger-v4__read-receipt');
          if (!receipt || receipt.classList.contains('messenger-v4__read-receipt--read')) {
            continue;
          }
          if (!receipt.classList.contains('messenger-v4__read-receipt--delivered')) {
            receipt.classList.add('messenger-v4__read-receipt--delivered');
            receipt.innerHTML = doubleTickSvg;
          }
          receipt.setAttribute('aria-label', 'Delivered');
          receipt.title = 'Delivered';
        }
      }
    });

    // WebSocket connection failed after its normal retry budget — the socket
    // client keeps retrying slowly in the background (see MessengerSocket's
    // fallback retry loop), but also offer a manual retry so the user isn't
    // stuck waiting on a timer.
    window.addEventListener('messenger:connection-failed', () => {
      this._showConnectionFailedBanner();
    });

    // ---- Message action events (from context menu) ----

    // Reply: wire the message into the composer
    window.addEventListener('messenger:set-reply', e => {
      const { message } = e.detail || {};
      if (message) {
        this.composer?.setReplyTo(message);
      }
    });

    // Edit a message
    window.addEventListener('messenger:edit-message', async e => {
      const { messageId } = e.detail || {};
      if (!messageId) {
        return;
      }
      await this._editMessage(messageId);
    });

    // Delete a message
    window.addEventListener('messenger:delete-message', async e => {
      const { messageId } = e.detail || {};
      if (!messageId) {
        return;
      }
      await this._deleteMessage(messageId);
    });

    // Toggle emoji reaction
    window.addEventListener('messenger:react-message', async e => {
      const { messageId, emoji } = e.detail || {};
      if (!messageId) {
        return;
      }
      await this._reactToMessage(messageId, emoji);
    });
  }

  // ---------------------------------------------------------------------------
  // Public actions
  // ---------------------------------------------------------------------------

  /**
   * Select a conversation: update state, load chat, wire composer.
   * @param {string} id - Conversation ID
   */
  async selectConversation(id) {
    if (this._activeConversationId === id) {
      return;
    }

    // Leave previous WebSocket room, join the new one
    const prevId = this._activeConversationId;
    if (prevId && prevId !== id) {
      this.socket?.leaveConversation(prevId);
    }
    this._activeConversationId = id;
    this.state.setActiveConversation(id);
    this.socket?.joinConversation(id);

    // Update composer's conversationId
    if (this.composer) {
      this.composer.options.conversationId = id;
    }

    // Load chat
    if (this.chatView) {
      await this.chatView.loadConversation(id);
      this.chatView.setConnectionState?.(this.recon?.getState() || 'LIVE');
    }

    // Show context banner if applicable
    const conv = this.state.conversations.find(c => c._id === id);
    if (conv?.context?.type && this.contextBanner) {
      this.contextBanner.show(conv.context);
    } else {
      this.contextBanner?.hide();
    }

    // On mobile, switch to chat panel
    if (window.innerWidth <= 767) {
      this.handleMobilePanel('chat');
    }

    // Focus composer
    this.composer?.focus();

    // Mark as read via API (non-blocking) and update local state immediately
    const uid = this._getCurrentUserId();
    this.api
      .markAsRead(id)
      .then(() => {
        // Update local participant unreadCount so the badge clears immediately
        if (uid) {
          const conv = this.state.conversations.find(c => c._id === id);
          if (conv) {
            const participant = conv.participants?.find(p => p.userId === uid);
            if (participant && participant.unreadCount > 0) {
              participant.unreadCount = 0;
              this.state.updateConversation(conv);
              // Recalculate global unread count
              const totalUnread = this.state.conversations.reduce((sum, c) => {
                const me = c.participants?.find(p => p.userId === uid);
                return sum + (me?.unreadCount || 0);
              }, 0);
              this.state.setUnreadCount(totalUnread);
              window.dispatchEvent(
                new CustomEvent('messenger:unread-count', { detail: { count: totalUnread } })
              );
              // Update the toggle button to reflect the now-read state
              if (this.chatView && this._activeConversationId === id) {
                this.chatView._updateMarkUnreadBtn(false);
              }
            }
          }
        }
      })
      .catch(err => console.warn('[MessengerAppV4] mark-read failed:', err));
  }

  /**
   * Create a new conversation with given participant IDs.
   * @param {string[]} participantIds
   * @param {string|Object} contextOrType - Either:
   *   - a conversation type string ('direct' | 'marketplace' | 'enquiry' | 'supplier_network' | 'support'),
   *   - a context type string ('package' | 'supplier_profile' | 'marketplace_listing' | 'find_a_supplier')
   *     which will be mapped to the corresponding conversation type, or
   *   - a canonical context object { type, referenceId, referenceTitle, referenceImage }.
   */
  async createConversation(participantIds, contextOrType = 'direct', options = {}) {
    try {
      const { type, context } = MessengerAppV4._resolveTypeAndContext(contextOrType);
      const data = await this.api.createConversation({
        type,
        participantIds,
        context,
        metadata: options.metadata || {},
      });
      const conv = data.conversation || data;
      if (conv?._id) {
        this.state.updateConversation(conv);
        await this.selectConversation(conv._id);
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
  }

  /**
   * Map a user-supplied type/context argument into:
   *   - `type`    — a valid conversation type (backend schema)
   *   - `context` — a normalized canonical context object, or null
   *
   * Accepts legacy aliases from older entry points (e.g. 'supplier' → 'supplier_profile',
   * 'marketplace' context alias → 'marketplace_listing').  Keeps the contract stable
   * while the audit is closed out.
   *
   * @param {string|Object|null} contextOrType
   * @returns {{ type: string, context: Object|null }}
   */
  static _resolveTypeAndContext(contextOrType) {
    // Context-type → conversation-type mapping.
    const CTX_TO_CONV_TYPE = {
      package: 'enquiry',
      supplier_profile: 'direct',
      marketplace_listing: 'marketplace',
      find_a_supplier: 'direct',
    };
    // Legacy aliases that entered the codebase before the canonical types existed.
    const LEGACY_CTX_ALIAS = {
      supplier: 'supplier_profile',
      marketplace: 'marketplace_listing',
    };
    const CONV_TYPES = new Set(['direct', 'marketplace', 'enquiry', 'supplier_network', 'support']);

    // Plain string: may be a conversation type OR a context-type shorthand.
    if (typeof contextOrType === 'string') {
      const s = contextOrType.trim();
      if (!s || s === 'direct') {
        return { type: 'direct', context: null };
      }
      if (CONV_TYPES.has(s)) {
        return { type: s, context: null };
      }
      const canonical = LEGACY_CTX_ALIAS[s] || s;
      if (CTX_TO_CONV_TYPE[canonical]) {
        return { type: CTX_TO_CONV_TYPE[canonical], context: { type: canonical } };
      }
      // Unknown token — fall back to direct so we never send an invalid type.
      return { type: 'direct', context: null };
    }

    // Object form: normalize field names into the canonical schema.
    if (contextOrType && typeof contextOrType === 'object') {
      const rawType = contextOrType.type || null;
      const canonical = rawType ? LEGACY_CTX_ALIAS[rawType] || rawType : null;
      const hasField = (obj, key) => obj[key] !== undefined && obj[key] !== null;
      const referenceId = hasField(contextOrType, 'referenceId')
        ? contextOrType.referenceId
        : hasField(contextOrType, 'id')
          ? contextOrType.id
          : null;
      const referenceTitle = hasField(contextOrType, 'referenceTitle')
        ? contextOrType.referenceTitle
        : hasField(contextOrType, 'title')
          ? contextOrType.title
          : null;
      const referenceImage = hasField(contextOrType, 'referenceImage')
        ? contextOrType.referenceImage
        : hasField(contextOrType, 'imageUrl')
          ? contextOrType.imageUrl
          : null;

      if (canonical && CTX_TO_CONV_TYPE[canonical]) {
        const context = { type: canonical };
        if (referenceId !== null && referenceId !== undefined) {
          context.referenceId = String(referenceId);
        }
        if (referenceTitle !== null && referenceTitle !== undefined) {
          context.referenceTitle = String(referenceTitle);
        }
        if (referenceImage !== null && referenceImage !== undefined) {
          context.referenceImage = String(referenceImage);
        }
        return { type: CTX_TO_CONV_TYPE[canonical], context };
      }
      // Object had no recognised context type — treat as direct with no context.
      if (canonical && CONV_TYPES.has(canonical)) {
        return { type: canonical, context: null };
      }
    }

    return { type: 'direct', context: null };
  }

  /**
   * Switch visible panel in single-column mobile layout.
   * @param {'sidebar'|'chat'} panel
   */
  handleMobilePanel(panel) {
    const sidebar = document.querySelector('[data-v4="sidebar"]');
    const chat = document.querySelector('[data-v4="chat-panel"]');
    if (!sidebar || !chat) {
      return;
    }

    // Use CSS slide animations unless the user prefers reduced motion.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (panel === 'chat') {
      if (reduced) {
        sidebar.style.display = 'none';
        chat.style.display = 'flex';
      } else {
        sidebar.classList.add('is-leaving');
        chat.style.display = 'flex';
        chat.classList.add('is-entering');
        setTimeout(() => {
          sidebar.style.display = 'none';
          sidebar.classList.remove('is-leaving');
          chat.classList.remove('is-entering');
        }, 260);
      }
    } else {
      if (reduced) {
        sidebar.style.display = '';
        chat.style.display = 'none';
      } else {
        sidebar.style.display = '';
        sidebar.classList.add('is-entering');
        chat.classList.add('is-leaving');
        setTimeout(() => {
          chat.style.display = 'none';
          chat.classList.remove('is-leaving');
          sidebar.classList.remove('is-entering');
        }, 260);
      }
    }
  }

  /**
   * Parse URL parameters and act on them.
   * Supports: ?conversation=ID, ?new=true|1, ?recipientId=userId, ?contact=userId, ?prefill=msg, ?contextType, ?contextId, ?contextTitle
   */
  handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get('conversation');
    const openNew = params.get('new');
    const contactId = params.get('contact') || params.get('recipientId');
    const prefill = params.get('prefill') || null;
    const contextType = params.get('contextType');
    const contextId = params.get('contextId');
    const contextTitle = params.get('contextTitle');

    // Build a canonical context object when context params are present.
    // `_resolveTypeAndContext` will normalize legacy aliases (e.g. 'supplier'
    // → 'supplier_profile') and strip unknown types so we never ship an
    // invalid context to the backend.
    const context = contextType
      ? {
          type: contextType,
          referenceId: contextId || null,
          referenceTitle: contextTitle || null,
        }
      : null;

    if (conversationId) {
      this.selectConversation(conversationId);
    } else if (openNew === 'true' || openNew === '1' || contactId) {
      if (contactId) {
        // Dispatch event so _setupEventBus can create/find the conversation
        window.dispatchEvent(
          new CustomEvent('messenger:open-contact-by-id', {
            detail: { userId: contactId, context, prefill },
          })
        );
      } else {
        this.contactPicker?.open();
      }
    }
  }

  /** Clean up all components and listeners. */
  destroy() {
    this.conversationList?.destroy();
    this.chatView?.destroy();
    this.composer?.destroy();
    this.contactPicker?.destroy();
    this.notificationBridge?.destroy();
    this.socket?.disconnect?.();
    this._readObserver?.disconnect?.();
    this._readMutationObserver?.disconnect?.();
    this._readMutationObserver = null;
    if (this._onKeyDown) {
      document.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    if (this._responsiveMq && this._onMqChange) {
      this._responsiveMq.removeEventListener('change', this._onMqChange);
      this._responsiveMq = null;
      this._onMqChange = null;
    }
    if (this._telemetryVisibilityHandler) {
      document.removeEventListener('visibilitychange', this._telemetryVisibilityHandler);
      this._telemetryVisibilityHandler = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Returns the current user's ID string. Supports both .id and ._id fields. */
  _getCurrentUserId() {
    return this.currentUser?.id || this.currentUser?._id || null;
  }

  async _loadCurrentUser() {
    // Try AuthStateManager first (primary, set by auth-state.js)
    if (window.AuthStateManager?.isAuthenticated?.()) {
      const user = window.AuthStateManager.getUser();
      if (user) {
        return user;
      }
    }

    // Final fallback: fetch from API
    try {
      const data = await fetch('/api/v1/auth/me', { credentials: 'include' }).then(r => r.json());
      return data.user || data || null;
    } catch {
      return null;
    }
  }

  async _loadConversations() {
    try {
      const data = await this.api.getConversations();
      const conversations = data.conversations || data || [];
      this.state.setConversations(conversations);

      // Set global unread count
      const uid = this._getCurrentUserId();
      const unread = conversations.reduce((sum, c) => {
        const me = c.participants?.find(p => p.userId === uid);
        return sum + (me?.unreadCount || 0);
      }, 0);
      this.state.setUnreadCount(unread);
      window.dispatchEvent(
        new CustomEvent('messenger:unread-count', { detail: { count: unread } })
      );
    } catch (err) {
      console.error('[MessengerAppV4] Failed to load conversations:', err);
    }
  }

  async _sendMessage({ message, files, replyTo, conversationId }) {
    if (!conversationId) {
      // Not an error condition worth surfacing to the composer — nothing to
      // send when no conversation is active.  Resolve quietly.
      return;
    }
    try {
      let sentMsg;
      if (files?.length) {
        // Multipart upload – delegate entirely to MessengerAPI.sendMessage so field
        // names stay consistent.  api.sendMessage(id, content, attachments, replyToId)
        const data = await this.api.sendMessage(
          conversationId,
          message || '',
          files,
          replyTo?._id || null
        );
        sentMsg = data.message || data;
      } else {
        // Text-only – pass content string and optional replyToId
        const data = await this.api.sendMessage(
          conversationId,
          message || '',
          [],
          replyTo?._id || null
        );
        sentMsg = data.message || data;
      }

      if (sentMsg) {
        this._upsertMessage(conversationId, sentMsg);
        this.chatView?.appendMessage(sentMsg);
        this._trackLastSeenSeq(conversationId, sentMsg.seq);
      }
    } catch (err) {
      console.error('[MessengerAppV4] Failed to send message:', err);
      // Re-throw so the composer keeps the user's typed content / attachments
      // instead of silently clearing them after a failed send.
      throw err;
    }
  }

  async _togglePin(conversationId) {
    try {
      const uid = this._getCurrentUserId();
      if (!uid) {
        return;
      }
      const conv = this.state.conversations.find(c => c._id === conversationId);
      const me = conv?.participants?.find(p => p.userId === uid);
      const newPinned = !(me?.isPinned || false);
      await this.api.updateConversation(conversationId, { isPinned: newPinned });
      // Optimistic local state update — avoids full reload round-trip
      if (conv && me) {
        me.isPinned = newPinned;
        this.state.updateConversation(conv);
      } else {
        await this._loadConversations();
      }
    } catch (err) {
      console.error('[MessengerAppV4] Pin failed:', err);
    }
  }

  async _toggleArchive(conversationId) {
    try {
      const uid = this._getCurrentUserId();
      if (!uid) {
        return;
      }
      const conv = this.state.conversations.find(c => c._id === conversationId);
      const me = conv?.participants?.find(p => p.userId === uid);
      const newArchived = !(me?.isArchived || false);
      await this.api.updateConversation(conversationId, { isArchived: newArchived });
      // Optimistic local state update — avoids full reload round-trip
      if (conv && me) {
        me.isArchived = newArchived;
        this.state.updateConversation(conv);
      } else {
        await this._loadConversations();
      }
    } catch (err) {
      console.error('[MessengerAppV4] Archive failed:', err);
    }
  }

  async _loadBlockedUsers() {
    try {
      const data = await this.api.getBlockedUsers();
      const blocked = Array.isArray(data?.blocked) ? data.blocked : [];
      this.state.setBlockedUsers(blocked.map(b => b.userId));
    } catch (err) {
      console.error('[MessengerAppV4] Failed to load blocked users:', err);
    }
  }

  async _blockUser(userId) {
    if (!userId) {
      return;
    }
    let confirmed = true;
    if (window.MessengerModals?.showConfirm) {
      confirmed = await window.MessengerModals.showConfirm(
        'Block this user?',
        'You will no longer be able to send or receive messages with this user.',
        'Block',
        'Cancel'
      );
    }
    if (!confirmed) {
      return;
    }
    try {
      await this.api.blockUser(userId);
      this.state.blockedUserIds.add(String(userId));
      this.state.emit('blockedUsersChanged', this.state.blockedUserIds);
      const conv =
        this._activeConversationId &&
        this.state.conversations.find(c => c._id === this._activeConversationId);
      if (conv && this.chatView?._renderHeader) {
        this.chatView._renderHeader(conv);
      }
      if (typeof window.showToast === 'function') {
        window.showToast('User blocked.', 'success');
      }
    } catch (err) {
      console.error('[MessengerAppV4] Block failed:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Failed to block user. Please try again.', 'error');
      }
    }
  }

  async _unblockUser(userId) {
    if (!userId) {
      return;
    }
    try {
      await this.api.unblockUser(userId);
      this.state.blockedUserIds.delete(String(userId));
      this.state.emit('blockedUsersChanged', this.state.blockedUserIds);
      const conv =
        this._activeConversationId &&
        this.state.conversations.find(c => c._id === this._activeConversationId);
      if (conv && this.chatView?._renderHeader) {
        this.chatView._renderHeader(conv);
      }
      if (typeof window.showToast === 'function') {
        window.showToast('User unblocked.', 'success');
      }
    } catch (err) {
      console.error('[MessengerAppV4] Unblock failed:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Failed to unblock user. Please try again.', 'error');
      }
    }
  }

  async _reportContent(type, targetId, promptTitle) {
    if (!targetId || !window.MessengerModals?.showReportPrompt) {
      return;
    }
    const result = await window.MessengerModals.showReportPrompt(promptTitle);
    if (!result || !result.reason) {
      return;
    }
    try {
      await this.api.reportContent(type, targetId, result.reason, result.details);
      if (typeof window.showToast === 'function') {
        window.showToast('Thank you — our team will review this report.', 'success');
      }
    } catch (err) {
      console.error('[MessengerAppV4] Report failed:', err);
      if (typeof window.showToast === 'function') {
        window.showToast(err.message || 'Failed to submit report. Please try again.', 'error');
      }
    }
  }

  async _editMessage(messageId) {
    try {
      // Use MessengerModals if available; fall back to a simple prompt
      const msgs = this.state.getMessages(this._activeConversationId) || [];
      const msg = msgs.find(m => String(m._id) === messageId);
      const currentContent = msg?.content || '';

      let newContent;
      if (window.MessengerModals && typeof window.MessengerModals.showEditPrompt === 'function') {
        newContent = await window.MessengerModals.showEditPrompt(currentContent);
      } else {
        // eslint-disable-next-line no-alert
        newContent = window.prompt('Edit message:', currentContent);
      }

      if (!newContent || newContent.trim() === currentContent.trim()) {
        return;
      }

      const data = await this.api.editMessage(messageId, newContent.trim());
      const updated = data.message || data;
      if (updated) {
        this.state.updateMessage(this._activeConversationId, messageId, updated);
        // Re-render the message bubble in the DOM
        const el = this.chatView?.messagesEl?.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
        if (el && window.MessageBubbleV4) {
          const uid = this._getCurrentUserId();
          // MessageBubbleV4.render() escapes all user-supplied content (message text, senderName,
          // attachments, reactions) via MessageBubbleV4.escape() before producing HTML.
          // innerHTML is therefore safe — it receives only factory-escaped output.
          const wrapper = document.createElement('div');
          wrapper.innerHTML = window.MessageBubbleV4.render(updated, uid);
          el.replaceWith(wrapper.firstElementChild);
        }
      }
    } catch (err) {
      console.error('[MessengerAppV4] Edit message failed:', err);
    }
  }

  async _deleteMessage(messageId) {
    try {
      const confirmed =
        window.MessengerModals && typeof window.MessengerModals.showConfirm === 'function'
          ? await window.MessengerModals.showConfirm(
              'Delete Message',
              'Are you sure you want to delete this message?',
              'Delete',
              'Cancel'
            )
          : // eslint-disable-next-line no-alert
            window.confirm('Delete this message?');

      if (!confirmed) {
        return;
      }

      await this.api.deleteMessage(messageId);
      this.state.deleteMessage(this._activeConversationId, messageId);
      // Remove from DOM
      const el = this.chatView?.messagesEl?.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
      if (el) {
        el.remove();
      }
      // Reload conversations so the list preview (lastMessage) reflects the deletion
      await this._loadConversations();
    } catch (err) {
      console.error('[MessengerAppV4] Delete message failed:', err);
    }
  }

  async _reactToMessage(messageId, emoji) {
    try {
      // If no emoji provided, prompt via MessengerModals or a simple picker
      let resolvedEmoji = emoji;
      if (!resolvedEmoji) {
        if (
          window.MessengerModals &&
          typeof window.MessengerModals.showEmojiPicker === 'function'
        ) {
          resolvedEmoji = await window.MessengerModals.showEmojiPicker();
        } else {
          // eslint-disable-next-line no-alert
          resolvedEmoji = window.prompt('Enter emoji to react with (e.g. 👍):');
        }
      }
      if (!resolvedEmoji) {
        return;
      }

      const data = await this.api.toggleReaction(messageId, resolvedEmoji);
      const updated = data.message || data;
      if (updated) {
        // Replace the reactions array from the server response (authoritative)
        this.state.updateMessage(this._activeConversationId, messageId, {
          reactions: updated.reactions || [],
        });
        // Re-render only the reactions bar
        const el = this.chatView?.messagesEl?.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
        if (el && window.MessageBubbleV4) {
          const reactBar = el.querySelector('.messenger-v4__reactions-bar');
          if (reactBar) {
            reactBar.remove();
          }
          if (updated.reactions?.length) {
            const newBar = document.createElement('div');
            // renderReactions escapes all values via MessageBubbleV4.escape() — innerHTML is safe.
            newBar.innerHTML = window.MessageBubbleV4.renderReactions(updated.reactions, messageId);
            el.querySelector('.messenger-v4__message-content')?.appendChild(
              newBar.firstElementChild
            );
          }
        }
      }
    } catch (err) {
      console.error('[MessengerAppV4] React to message failed:', err);
    }
  }

  _broadcastTyping(isTyping) {
    if (!this._activeConversationId || !this.socket) {
      return;
    }
    try {
      // Pass the current user's display name so recipients can show it in the typing indicator
      const userName = this.currentUser?.displayName || this.currentUser?.businessName || '';
      // MessengerSocket.sendTyping() emits the correct v4 socket event
      this.socket.sendTyping(this._activeConversationId, isTyping, userName);
    } catch {
      // Socket may not be connected
    }
  }

  _setupKeyboardShortcuts() {
    this._onKeyDown = e => {
      // Escape: close contact picker or mobile chat panel
      if (e.key === 'Escape') {
        if (this.contactPicker?.modalEl?.style.display !== 'none') {
          this.contactPicker.close();
          return;
        }
        if (window.innerWidth <= 767 && this._activeConversationId) {
          this._activeConversationId = null;
          this.state.setActiveConversation(null);
          this.handleMobilePanel('sidebar');
        }
        return;
      }

      // Ignore shortcuts when typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }

      // ArrowDown / ArrowUp: navigate conversations
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this._navigateConversations(e.key === 'ArrowDown' ? 1 : -1);
      }
    };
    document.addEventListener('keydown', this._onKeyDown);
  }

  _navigateConversations(direction) {
    const convs = this.state.getFilteredConversations();
    if (!convs.length) {
      return;
    }
    const idx = convs.findIndex(c => c._id === this._activeConversationId);
    const next = idx + direction;
    if (next >= 0 && next < convs.length) {
      this.selectConversation(convs[next]._id);
    }
  }

  _setupResponsive() {
    const mq = window.matchMedia('(max-width: 767px)');
    this._onMqChange = e => {
      if (!e.matches && this._activeConversationId) {
        // Restore both panels on desktop
        const sidebar = document.querySelector('[data-v4="sidebar"]');
        const chat = document.querySelector('[data-v4="chat-panel"]');
        if (sidebar) {
          sidebar.style.display = '';
        }
        if (chat) {
          chat.style.display = '';
        }
      }
    };
    this._responsiveMq = mq;
    mq.addEventListener('change', this._onMqChange);
  }

  _showGlobalError(msg) {
    const el = document.querySelector('[data-v4="global-error"]');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    } else {
      console.error('[MessengerAppV4]', msg);
    }
  }

  _hideGlobalError() {
    const el = document.querySelector('[data-v4="global-error"]');
    if (el) {
      el.style.display = 'none';
      el.innerHTML = '';
    }
  }

  /**
   * Connection-failed banner with a manual retry affordance, so the user
   * isn't stuck waiting on MessengerSocket's slow background retry timer.
   */
  _showConnectionFailedBanner() {
    const el = document.querySelector('[data-v4="global-error"]');
    if (!el) {
      console.error(
        '[MessengerAppV4] Connection lost. Real-time updates are paused — please refresh to reconnect.'
      );
      return;
    }
    el.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = 'Connection lost. Real-time updates are paused. ';
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'ef-cta';
    retryBtn.textContent = 'Retry now';
    retryBtn.style.marginLeft = '8px';
    retryBtn.addEventListener('click', () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Retrying…';
      this.socket?.manualReconnect();
      // Re-enable in case the retry itself fails to reconnect quickly;
      // a successful reconnect hides the whole banner via _hideGlobalError().
      setTimeout(() => {
        retryBtn.disabled = false;
        retryBtn.textContent = 'Retry now';
      }, 5000);
    });
    el.appendChild(text);
    el.appendChild(retryBtn);
    el.style.display = 'block';
  }

  _lastSeenSeqKey(conversationId) {
    return `messenger:v4:lastSeenSeq:${conversationId}`;
  }

  _getLastSeenSeq(conversationId) {
    try {
      return Number(localStorage.getItem(this._lastSeenSeqKey(conversationId)) || 0) || 0;
    } catch {
      return 0;
    }
  }

  _trackLastSeenSeq(conversationId, seq) {
    if (!conversationId || !Number.isFinite(Number(seq))) {
      return;
    }
    const next = Number(seq);
    const prev = this._getLastSeenSeq(conversationId);
    if (next <= prev) {
      return;
    }
    try {
      localStorage.setItem(this._lastSeenSeqKey(conversationId), String(next));
    } catch {
      // noop
    }
  }

  _isDuplicateMessage(conversationId, message) {
    const seq = Number(message?.seq);
    if (Number.isFinite(seq)) {
      const set = this._seenSeqByConv.get(conversationId) || new Set();
      if (set.has(seq)) {
        return true;
      }
      set.add(seq);
      this._seenSeqByConv.set(conversationId, set);
      return false;
    }
    const clientId = message?.clientMessageId;
    if (!clientId) {
      return false;
    }
    const set = this._seenClientMessageIds.get(conversationId) || new Set();
    if (set.has(clientId)) {
      return true;
    }
    set.add(clientId);
    this._seenClientMessageIds.set(conversationId, set);
    return false;
  }

  _upsertMessage(conversationId, message) {
    const messages = this.state.getMessages(conversationId) || [];
    if (window.dedupeMessagesV4) {
      const merged = window.dedupeMessagesV4(messages, [message]);
      const before = messages.find(
        m =>
          message.clientMessageId &&
          m.clientMessageId === message.clientMessageId &&
          String(m._id) !== String(message._id)
      );
      if (before) {
        this._reconMetrics.clientMessageIdReconciliations++;
        this._recordTelemetry({ cmidReconciles: 1 });
      }
      this.state.setMessages(conversationId, merged);
      return;
    }
    this.state.addMessage(conversationId, message);
  }

  async _catchUpAllConversations() {
    const conversations = Array.isArray(this.state.conversations) ? this.state.conversations : [];
    for (const conv of conversations) {
      await this._catchUpConversation(conv._id);
    }
  }

  async _catchUpConversation(conversationId) {
    if (!conversationId) {
      return;
    }
    let sinceSeq = this._getLastSeenSeq(conversationId);
    let fetched = 0;
    // Hard ceiling protects against runaway loops/bad server data.  At
    // limit=100 this allows up to 200k catch-up messages — more than enough
    // for any realistic offline gap.  If we hit the cap, log loudly so ops
    // can investigate rather than silently truncating.
    const MAX_CATCHUP_PAGES = 2000;
    let i = 0;
    for (; i < MAX_CATCHUP_PAGES; i++) {
      const res = await this.api.getMessages(conversationId, { sinceSeq, limit: 100 });
      const msgs = Array.isArray(res?.messages) ? res.messages : [];
      if (!msgs.length) {
        break;
      }
      fetched += msgs.length;
      for (const msg of msgs) {
        if (!this._isDuplicateMessage(conversationId, msg)) {
          this._upsertMessage(conversationId, msg);
          if (conversationId === this._activeConversationId) {
            this.chatView?.appendMessage(msg);
          }
          this._trackLastSeenSeq(conversationId, msg.seq);
        } else {
          this._reconMetrics.duplicateSeqDrops++;
          this._recordTelemetry({ dupSeqDrops: 1 });
        }
      }
      sinceSeq = Number(res?.nextSinceSeq || msgs[msgs.length - 1]?.seq || sinceSeq);
      if (!res?.hasMore) {
        break;
      }
    }
    if (i >= MAX_CATCHUP_PAGES) {
      console.warn('[MessengerAppV4] catch-up hit safety cap', {
        conversationId,
        fetched,
        sinceSeq,
      });
      this._recordTelemetry({ catchupTruncated: 1 });
    }
    this._reconMetrics.catchupGapSize = fetched;
    this._recordTelemetry({ maxGapSize: fetched });
    this._logRecon('catchup-gap', { conversationId, fetched });
  }

  _replayQueuedLiveEvents() {
    const queued = this._queuedLiveEvents.splice(0);
    for (const evt of queued) {
      if (!evt?.message || !evt?.conversationId) {
        continue;
      }
      if (this._isDuplicateMessage(evt.conversationId, evt.message)) {
        this._reconMetrics.duplicateSeqDrops++;
        this._recordTelemetry({ dupSeqDrops: 1 });
        continue;
      }
      this._upsertMessage(evt.conversationId, evt.message);
      if (evt.conversationId === this._activeConversationId) {
        this.chatView?.appendMessage(evt.message);
      }
      this._trackLastSeenSeq(evt.conversationId, evt.message.seq);
    }
  }

  _enqueueDelivered(conversationId, message) {
    const uid = this._getCurrentUserId();
    if (!uid || !message?._id || message.senderId === uid) {
      return;
    }
    const set = this._deliveredQueue.get(conversationId) || new Set();
    set.add(String(message._id));
    this._deliveredQueue.set(conversationId, set);
    clearTimeout(this._deliveredFlushTimer);
    this._deliveredFlushTimer = setTimeout(() => this._flushDelivered(), 500);
    this._scheduleReadAdvance(conversationId, message.seq);
  }

  async _flushDelivered() {
    // Drain each per-conversation queue in 50-id batches until empty so
    // backlogs larger than one batch are not stranded waiting for the next
    // incoming message to retrigger the debounce.
    const MAX_BATCH = 50;
    for (const [conversationId, idsSet] of this._deliveredQueue.entries()) {
      while (idsSet.size > 0) {
        const ids = Array.from(idsSet).slice(0, MAX_BATCH);
        if (!ids.length) {
          break;
        }
        try {
          await this.api.markDelivered(conversationId, ids);
        } catch (_err) {
          // Best-effort: server will re-reconcile on next sinceSeq fetch.
          // Drop the batch so we don't loop forever on a persistent failure.
        }
        ids.forEach(id => idsSet.delete(id));
      }
      if (idsSet.size === 0) {
        this._deliveredQueue.delete(conversationId);
      }
    }
  }

  _setupReadObserver() {
    if (typeof IntersectionObserver !== 'function') {
      return;
    }
    this._readObserver = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const seq = Number(entry.target.getAttribute('data-seq'));
          if (!Number.isFinite(seq) || !this._activeConversationId) {
            continue;
          }
          const prev = this._visibleSeqByConv.get(this._activeConversationId) || 0;
          if (seq > prev) {
            this._visibleSeqByConv.set(this._activeConversationId, seq);
            this._scheduleReadAdvance(this._activeConversationId, seq);
          }
        }
      },
      { threshold: 0.7 }
    );
    // Store the mutation observer so destroy() can disconnect it and avoid
    // listener leaks on repeated mount/unmount.
    this._readMutationObserver = new MutationObserver(() => this._observeMessageNodes());
    const target = document.querySelector('#v4Messages');
    if (target) {
      this._readMutationObserver.observe(target, { childList: true, subtree: true });
    }
  }

  _observeMessageNodes() {
    if (!this._readObserver || !this.chatView?.messagesEl) {
      return;
    }
    const msgs = this.state.getMessages(this._activeConversationId) || [];
    const byId = new Map(msgs.map(m => [String(m._id), m]));
    this.chatView.messagesEl.querySelectorAll('.messenger-v4__message[data-id]').forEach(el => {
      const msg = byId.get(String(el.getAttribute('data-id')));
      if (msg && Number.isFinite(Number(msg.seq))) {
        el.setAttribute('data-seq', String(msg.seq));
      }
      this._readObserver.observe(el);
    });
  }

  _scheduleReadAdvance(conversationId, seq) {
    const prev = this._readUpToSeq.get(conversationId) || 0;
    if (!Number.isFinite(Number(seq)) || Number(seq) <= prev) {
      return;
    }
    this._readUpToSeq.set(conversationId, Number(seq));
    clearTimeout(this._readDebounceTimer);
    this._readDebounceTimer = setTimeout(async () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) {
        return;
      }
      const upToSeq = this._readUpToSeq.get(conversationId) || 0;
      const sent = this._visibleSeqByConv.get(conversationId) || 0;
      const finalSeq = Math.max(upToSeq, sent);
      const already = this._readUpToSeq.get(`${conversationId}:sent`) || 0;
      if (finalSeq > already) {
        await this.api.markAsRead(conversationId, { upToSeq: finalSeq }).catch(() => {});
        this._readUpToSeq.set(`${conversationId}:sent`, finalSeq);
      }
    }, 750);
  }

  _initTelemetry() {
    if (!window.MessengerTelemetryEmitter || this._telemetry) {
      return;
    }
    const userId = this._getCurrentUserId() || 'anon';
    this._telemetry = new window.MessengerTelemetryEmitter({
      sessionId: `${userId}:${Date.now().toString(36)}`,
    });
    this._telemetryVisibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        this._flushTelemetry('hidden');
      }
    };
    document.addEventListener('visibilitychange', this._telemetryVisibilityHandler);
  }

  _recordTelemetry(partial) {
    this._telemetry?.record?.(partial);
  }

  _flushTelemetry(reason) {
    this._telemetry?.flush?.(reason).catch?.(() => {});
  }

  _logRecon(event, payload = {}) {
    if (!window.__MESSENGER_DEBUG__) {
      return;
    }
    const logger =
      window.logger && typeof window.logger.debug === 'function' ? window.logger : null;
    if (logger) {
      logger.debug('[MessengerRecon]', event, payload, this._reconMetrics);
      return;
    }
    console.debug('[MessengerRecon]', event, payload, this._reconMetrics);
  }
}

// Auto-boot on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  window.messengerAppV4 = new MessengerAppV4();
  window.messengerAppV4.init();
});
