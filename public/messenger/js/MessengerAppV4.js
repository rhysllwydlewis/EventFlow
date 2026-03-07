/**
 * MessengerAppV4 - Main Orchestrator
 * Wires together all v4 components via window CustomEvents.
 * Handles deep links, keyboard shortcuts, mobile panel switching,
 * and WebSocket event routing.
 */

'use strict';

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

      // 2. Initialize all components
      this._initComponents();

      // 3. Connect WebSocket
      if (window.MessengerSocket) {
        this.socket = new MessengerSocket(this.state);
        this.socket.connect(this._getCurrentUserId());
      }

      // 4. Load initial conversation list
      await this._loadConversations();

      // 5. Handle deep links (?conversation=X, ?new=1, ?contact=userId)
      this.handleDeepLink();

      // 6. Keyboard shortcuts
      this._setupKeyboardShortcuts();

      // 7. Responsive mode handling
      this._setupResponsive();

      // 8. Request notification permission (non-blocking)
      this.notificationBridge?.requestPermission();
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
        maxLength: 5000,
      });
    }

    // Contact picker
    const pickerContainer = document.querySelector('[data-v4="contact-picker"]');
    if (pickerContainer && window.ContactPickerV4) {
      this.contactPicker = new ContactPickerV4(pickerContainer, this.api, {
        currentUserId: this._getCurrentUserId(),
        currentUserRole: this.state.currentUser?.role || null,
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
    window.addEventListener('messenger:new-message', e => {
      const { message, conversationId } = e.detail || {};
      if (!message) {
        return;
      }

      // Update state
      this.state.addMessage(conversationId, message);

      // Update conversation list (bubble last message to top)
      const conv = this.state.conversations.find(c => c._id === conversationId);
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

    // Composer send
    window.addEventListener('composer:send', async e => {
      const { message, files, replyTo, conversationId } = e.detail || {};
      await this._sendMessage({
        message,
        files,
        replyTo,
        conversationId: conversationId || this._activeConversationId,
      });
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
      await this._toggleArchive(id);
      // If the user just archived the currently-open conversation, navigate back to the list
      if (id === this._activeConversationId) {
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
    });

    // Delete conversation
    window.addEventListener('messenger:delete-conversation', async e => {
      const { id } = e.detail || {};
      if (!id) {
        return;
      }
      let confirmed;
      if (window.MessengerModals?.showConfirm) {
        confirmed = await window.MessengerModals.showConfirm(
          'Delete Conversation',
          'Are you sure you want to delete this conversation? This cannot be undone.',
          'Delete',
          'Cancel'
        );
      } else {
        // eslint-disable-next-line no-alert
        confirmed = window.confirm('Are you sure you want to delete this conversation?');
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
        console.error('[MessengerAppV4] Delete conversation failed:', err);
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
    window.addEventListener('messenger:mobile-back', () => this.handleMobilePanel('sidebar'));

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

    // WebSocket connection permanently failed — show UI error
    window.addEventListener('messenger:connection-failed', () => {
      this._showGlobalError(
        'Connection lost. Real-time updates are paused — please refresh to reconnect.'
      );
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
      .request(`/conversations/${encodeURIComponent(id)}/read`, { method: 'POST' })
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
   * @param {string|Object} contextOrType - conversation type string ('direct'|'marketplace'|...)
   *   or a context object with a .type property. Backend requires `type` to be set.
   */
  async createConversation(participantIds, contextOrType = 'direct') {
    try {
      // Normalise: accept either a plain type string or a context object
      const type =
        typeof contextOrType === 'string' ? contextOrType : contextOrType?.type || 'direct';
      const context = typeof contextOrType === 'object' ? contextOrType : null;

      // Use MessengerAPI.createConversation which constructs the correct request body
      const data = await this.api.createConversation({ type, participantIds, context });
      const conv = data.conversation || data;
      if (conv?._id) {
        this.state.updateConversation(conv);
        await this.selectConversation(conv._id);
      }
    } catch (err) {
      console.error('[MessengerAppV4] createConversation failed:', err);
    }
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

    // Build a context object if context params are present
    const context = contextType
      ? { type: contextType, id: contextId || null, title: contextTitle || null }
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
    if (this._onKeyDown) {
      document.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    if (this._responsiveMq && this._onMqChange) {
      this._responsiveMq.removeEventListener('change', this._onMqChange);
      this._responsiveMq = null;
      this._onMqChange = null;
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
        this.state.addMessage(conversationId, sentMsg);
        this.chatView?.appendMessage(sentMsg);
      }
    } catch (err) {
      console.error('[MessengerAppV4] Failed to send message:', err);
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
}

// Auto-boot on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  window.messengerAppV4 = new MessengerAppV4();
  window.messengerAppV4.init();
});
