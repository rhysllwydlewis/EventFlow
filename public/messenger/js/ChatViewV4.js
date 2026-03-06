/**
 * ChatViewV4 Component
 * Renders the main chat panel: message list, header, infinite scroll,
 * reply threading, image lightbox, and typing indicator integration.
 * BEM prefix: messenger-v4__
 */

'use strict';

// Returns true when a string looks like an email address (should not be shown as a name).
function _cv4LooksLikeEmail(str) {
  return typeof str === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

// Returns str if it is non-empty and not an email, otherwise the fallback.
function _cv4SafeName(str, fallback) {
  if (str && !_cv4LooksLikeEmail(str)) {
    return str;
  }
  if (str && _cv4LooksLikeEmail(str)) {
    return str.split('@')[0] || str;
  }
  return fallback || 'Unknown';
}

class ChatViewV4 {
  constructor(container, state, api, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.state = state;
    this.api = api;
    this.options = options;

    this.conversationId = null;
    this.isLoadingOlder = false;
    this.hasMoreMessages = true;
    this.oldestCursor = null; // cursor (message ID) for pagination

    // Bound handlers
    this._onNewMessage = this._onNewMessage.bind(this);
    this._onV4Message = this._onV4Message.bind(this);
    this._onScroll = this._onScroll.bind(this);
    this._onLightboxClose = this._onLightboxClose.bind(this);

    this.init();
  }

  init() {
    this.render();
    this.attachEventListeners();
    window.addEventListener('messenger:new-message', this._onNewMessage);
    window.addEventListener('messenger:v4:message', this._onV4Message);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /** Render the static chat panel shell. */
  render() {
    this.container.innerHTML = `
      <div class="messenger-v4__chat-header" id="v4ChatHeader" style="display:none">
        <div class="messenger-v4__avatar-wrapper">
          <div class="messenger-v4__avatar messenger-v4__chat-header-avatar" aria-hidden="true"></div>
          <span class="messenger-v4__presence-dot" id="v4HeaderPresenceDot"></span>
        </div>
        <div class="messenger-v4__chat-header-info">
          <span class="messenger-v4__chat-header-name" id="v4ChatHeaderName"></span>
          <span class="messenger-v4__chat-header-status" id="v4ChatHeaderStatus"></span>
        </div>
        <div class="messenger-v4__chat-actions">
          <button class="messenger-v4__action-button" id="v4PinBtn" aria-label="Pin conversation" title="Pin">📌</button>
          <button class="messenger-v4__action-button" id="v4ArchiveBtn" aria-label="Archive conversation" title="Archive">🗂️</button>
          <button class="messenger-v4__action-button" id="v4DeleteConvBtn" aria-label="Delete conversation" title="Delete">🗑️</button>
          <button class="messenger-v4__action-button" id="v4MarkUnreadBtn" aria-label="Mark as unread" title="Mark as unread">✉️</button>
          <button class="messenger-v4__action-button" id="v4BackBtn" aria-label="Back to list" title="Back" style="display:none">←</button>
        </div>
      </div>

      <div class="messenger-v4__messages" id="v4Messages" role="log" aria-live="polite" aria-label="Messages">
        <div class="messenger-v4__empty-state" id="v4ChatEmpty">
          <span class="messenger-v4__empty-icon" aria-hidden="true">💬</span>
          <p>Select a conversation to start messaging</p>
        </div>
      </div>

      <button class="messenger-v4__scroll-to-bottom" id="v4ScrollToBottom" aria-label="Scroll to latest message" style="display:none">↓</button>

      <!-- Lightbox overlay -->
      <div class="messenger-v4__lightbox" id="v4Lightbox" role="dialog" aria-modal="true" aria-label="Image preview" style="display:none">
        <button class="messenger-v4__lightbox-close" id="v4LightboxClose" aria-label="Close image preview">✕</button>
        <img class="messenger-v4__lightbox-img" id="v4LightboxImg" alt="Full size attachment" />
      </div>
    `;

    this.messagesEl = this.container.querySelector('#v4Messages');
    this.headerEl = this.container.querySelector('#v4ChatHeader');
    this.scrollBtn = this.container.querySelector('#v4ScrollToBottom');
    this.lightbox = this.container.querySelector('#v4Lightbox');
    this.lightboxImg = this.container.querySelector('#v4LightboxImg');
  }

  attachEventListeners() {
    // Infinite scroll: load older messages when near the top
    this.messagesEl.addEventListener('scroll', this._onScroll);

    // Scroll-to-bottom button
    this.scrollBtn.addEventListener('click', () => this.scrollToBottom(true));

    // Lightbox close
    this.container
      .querySelector('#v4LightboxClose')
      .addEventListener('click', this._onLightboxClose);
    this.lightbox.addEventListener('click', e => {
      if (e.target === this.lightbox) {
        this._onLightboxClose();
      }
    });
    // Escape key closes lightbox (WCAG 2.1 modal pattern)
    this._onKeyDown = e => {
      if (e.key === 'Escape' && this._lightboxOpen) {
        e.preventDefault();
        e.stopPropagation();
        this._onLightboxClose();
      }
    };
    document.addEventListener('keydown', this._onKeyDown);

    // Header action buttons
    this.container.querySelector('#v4PinBtn').addEventListener('click', () => {
      if (this.conversationId) {
        window.dispatchEvent(
          new CustomEvent('messenger:pin-conversation', { detail: { id: this.conversationId } })
        );
      }
    });
    this.container.querySelector('#v4ArchiveBtn').addEventListener('click', () => {
      if (this.conversationId) {
        window.dispatchEvent(
          new CustomEvent('messenger:archive-conversation', { detail: { id: this.conversationId } })
        );
      }
    });
    this.container.querySelector('#v4DeleteConvBtn').addEventListener('click', () => {
      if (this.conversationId) {
        window.dispatchEvent(
          new CustomEvent('messenger:delete-conversation', { detail: { id: this.conversationId } })
        );
      }
    });
    this.container.querySelector('#v4MarkUnreadBtn').addEventListener('click', () => {
      if (this.conversationId) {
        const btn = this.container.querySelector('#v4MarkUnreadBtn');
        const isCurrentlyUnread = btn.dataset.unread === 'true';
        if (isCurrentlyUnread) {
          window.dispatchEvent(
            new CustomEvent('messenger:mark-read', { detail: { id: this.conversationId } })
          );
        } else {
          window.dispatchEvent(
            new CustomEvent('messenger:mark-unread', { detail: { id: this.conversationId } })
          );
        }
      }
    });
    this.container.querySelector('#v4BackBtn').addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('messenger:mobile-back'));
    });

    // Delegated click: image lightbox + context menu + context menu items + reaction pills
    this.messagesEl.addEventListener('click', e => {
      // Image lightbox
      const img = e.target.closest('.messenger-v4__attachment--image img');
      if (img) {
        // Don't open lightbox for images that failed to load
        if (img.classList.contains('messenger-v4__attachment-error')) {
          return;
        }
        this._openLightbox(img.src, img.alt);
        return;
      }

      // Context menu item action
      const menuItem = e.target.closest('.messenger-v4__context-menu-item[data-action]');
      if (menuItem) {
        this._handleContextMenuAction(menuItem.dataset.action, menuItem.dataset.id);
        this._closeContextMenu();
        return;
      }

      // Context menu open/close toggle
      const menuBtn = e.target.closest('.messenger-v4__context-menu-btn');
      if (menuBtn) {
        this._toggleContextMenu(menuBtn);
        return;
      }

      // Reaction pill toggle
      const reactionBtn = e.target.closest('.messenger-v4__reaction[data-emoji][data-message-id]');
      if (reactionBtn) {
        window.dispatchEvent(
          new CustomEvent('messenger:react-message', {
            detail: { messageId: reactionBtn.dataset.messageId, emoji: reactionBtn.dataset.emoji },
          })
        );
        return;
      }

      // Click anywhere else → close any open context menu
      this._closeContextMenu();
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Load and display a conversation by ID.
   * @param {string} conversationId
   */
  async loadConversation(conversationId) {
    this.conversationId = conversationId;
    this.hasMoreMessages = true;
    this.oldestCursor = null;
    this.isLoadingOlder = false;

    // Show header
    const conv = (this.state.conversations || []).find(c => c._id === conversationId);
    if (conv) {
      this._renderHeader(conv);
    }
    this.headerEl.style.display = '';

    // Show loading skeleton (instant – no animation, just indicates loading)
    this.messagesEl.classList.remove('is-switching');
    this.messagesEl.innerHTML = this._buildMessageSkeleton();

    try {
      const data = await this.api.getMessages(conversationId, { limit: 40 });
      const messages = data.messages || data || [];
      // Respect the server's hasMore flag; fall back to truthy when messages filled the page
      this.hasMoreMessages = data.hasMore !== undefined ? data.hasMore : messages.length >= 40;
      this.oldestCursor = messages[0]?._id || null;

      this.state.setMessages(conversationId, messages);
      this._renderMessages(messages);

      // Fade-in the real content after the skeleton is replaced
      void this.messagesEl.offsetHeight; // force reflow so animation restarts cleanly
      this.messagesEl.classList.add('is-switching');
      this.messagesEl.addEventListener(
        'animationend',
        () => {
          this.messagesEl.classList.remove('is-switching');
        },
        { once: true }
      );

      this.scrollToBottom();
    } catch (err) {
      console.error('[ChatViewV4] Failed to load messages:', err);
      this.messagesEl.innerHTML = `<div class="messenger-v4__empty-state">Failed to load messages. Please try again.</div>`;
    }
  }

  /**
   * Append a single new message to the bottom of the chat.
   * @param {Object} msg - Message object
   */
  appendMessage(msg) {
    if (!this.messagesEl) {
      return;
    }

    // Deduplicate: skip if this message is already in the DOM (prevents double-display
    // when both the API response and the WS echo arrive for the same send)
    if (msg._id && this.messagesEl.querySelector(`[data-id="${CSS.escape(String(msg._id))}"]`)) {
      return;
    }

    // Remove empty state if present
    const emptyEl = this.messagesEl.querySelector('.messenger-v4__empty-state');
    if (emptyEl) {
      emptyEl.remove();
    }

    const wasAtBottom = this._isAtBottom();
    const currentUser = this.state.currentUser;
    const prevMessages = this.state.getMessages(this.conversationId);
    const prevMsg = prevMessages[prevMessages.length - 1] || null;

    // Date separator if new day
    const dateSep = this._maybeDateSeparator(prevMsg, msg);
    if (dateSep) {
      this.messagesEl.insertAdjacentHTML('beforeend', dateSep);
    }

    const html = MessageBubbleV4
      ? MessageBubbleV4.render(msg, currentUser?.id || currentUser?._id)
      : this._buildMessageHTML(msg, currentUser);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const el = wrapper.firstElementChild;
    if (el) {
      el.classList.add('messenger-v4__message--fade-in');
      this.messagesEl.appendChild(el);
    }

    if (wasAtBottom) {
      this.scrollToBottom(true);
    } else {
      this.scrollBtn.style.display = 'flex';
    }
  }

  /**
   * Prepend older messages when scrolling up (infinite scroll).
   * @param {Array} msgs - Older messages array (oldest first)
   */
  prependMessages(msgs) {
    if (!msgs.length) {
      return;
    }
    const prevHeight = this.messagesEl.scrollHeight;
    const currentUser = this.state.currentUser;
    const uid = currentUser?.id || currentUser?._id;

    let html = '';
    for (let i = 0; i < msgs.length; i++) {
      const prev = i === 0 ? null : msgs[i - 1];
      html += this._maybeDateSeparator(prev, msgs[i]) || '';
      html += MessageBubbleV4
        ? MessageBubbleV4.render(msgs[i], uid)
        : this._buildMessageHTML(msgs[i], currentUser);
    }

    this.messagesEl.insertAdjacentHTML('afterbegin', html);

    // Restore scroll position so user doesn't jump
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight - prevHeight;
  }

  /** Scroll the message area to the bottom. */
  scrollToBottom(smooth = false) {
    this.messagesEl.scrollTo({
      top: this.messagesEl.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
    this.scrollBtn.style.display = 'none';
  }

  /**
   * Show a typing indicator bubble.
   * @param {string} name - The name of the typing user
   */
  showTyping(name) {
    if (!name || typeof name !== 'string') {
      return;
    }
    this.hideTyping(); // remove any existing
    const el = document.createElement('div');
    el.id = 'v4TypingBubble';
    el.className = 'messenger-v4__typing-indicator';
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `
      <div class="messenger-v4__message-avatar" aria-hidden="true">${this.escape(name.charAt(0).toUpperCase())}</div>
      <div class="messenger-v4__typing-bubble" aria-label="${this.escape(name)} is typing">
        <span class="messenger-v4__typing-dot"></span>
        <span class="messenger-v4__typing-dot"></span>
        <span class="messenger-v4__typing-dot"></span>
      </div>`;
    this.messagesEl.appendChild(el);
    if (this._isAtBottom()) {
      this.scrollToBottom(true);
    }
  }

  /** Remove the typing indicator bubble. */
  hideTyping() {
    const el = this.messagesEl.querySelector('#v4TypingBubble');
    if (el) {
      el.remove();
    }
  }

  /** Clean up all listeners. */
  destroy() {
    this._onLightboxClose(); // restore body overflow if lightbox was open
    if (this._onKeyDown) {
      document.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    this.messagesEl.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('messenger:new-message', this._onNewMessage);
    window.removeEventListener('messenger:v4:message', this._onV4Message);
    this.container.innerHTML = '';
  }

  /** Reset chat view to empty state (e.g. after conversation deleted). */
  reset() {
    this.conversationId = null;
    this.hasMoreMessages = true;
    this.oldestCursor = null;
    this.isLoadingOlder = false;
    this.headerEl.style.display = 'none';
    this.messagesEl.innerHTML = `
      <div class="messenger-v4__empty-state" id="v4ChatEmpty">
        <span class="messenger-v4__empty-icon" aria-hidden="true">💬</span>
        <p>Select a conversation to start messaging</p>
      </div>`;
    this.scrollBtn.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _renderHeader(conv) {
    const currentUser = this.state.currentUser;
    const uid = currentUser?.id || currentUser?._id;
    const other = conv.participants?.find(p => p.userId !== uid) || {};
    const isOnline = this.state.getPresence(other.userId)?.state === 'online';

    this.container.querySelector('.messenger-v4__chat-header-avatar').textContent = _cv4SafeName(
      other.displayName,
      'U'
    )
      .charAt(0)
      .toUpperCase();
    this.container.querySelector('#v4ChatHeaderName').textContent = _cv4SafeName(other.displayName);
    this.container.querySelector('#v4ChatHeaderStatus').textContent = isOnline
      ? 'Online'
      : 'Offline';

    const dot = this.container.querySelector('#v4HeaderPresenceDot');
    dot.classList.toggle('messenger-v4__presence-dot--online', isOnline);

    // Set mark-read/unread toggle button based on conversation state
    const me = conv.participants?.find(p => p.userId === uid);
    const isUnread = me ? (me.unreadCount || 0) > 0 : false;
    this._updateMarkUnreadBtn(isUnread);

    // Show back button on mobile
    if (window.innerWidth <= 768) {
      this.container.querySelector('#v4BackBtn').style.display = '';
    }
  }

  /**
   * Update the mark-read/unread toggle button label and state.
   * @param {boolean} isUnread - Whether the conversation is currently unread
   */
  _updateMarkUnreadBtn(isUnread) {
    const btn = this.container.querySelector('#v4MarkUnreadBtn');
    if (!btn) {
      return;
    }
    if (isUnread) {
      btn.setAttribute('aria-label', 'Mark as read');
      btn.setAttribute('title', 'Mark as read');
      btn.dataset.unread = 'true';
    } else {
      btn.setAttribute('aria-label', 'Mark as unread');
      btn.setAttribute('title', 'Mark as unread');
      btn.dataset.unread = 'false';
    }
  }

  /** Render a full messages array grouped by date. */
  _renderMessages(messages) {
    if (!messages.length) {
      this.messagesEl.innerHTML = `<div class="messenger-v4__empty-state">No messages yet. Say hello! 👋</div>`;
      return;
    }

    const currentUser = this.state.currentUser;
    const uid = currentUser?.id || currentUser?._id;
    let html = '';

    for (let i = 0; i < messages.length; i++) {
      const prev = i === 0 ? null : messages[i - 1];
      html += this._maybeDateSeparator(prev, messages[i]) || '';
      html += MessageBubbleV4
        ? MessageBubbleV4.render(messages[i], uid)
        : this._buildMessageHTML(messages[i], currentUser);
    }

    this.messagesEl.innerHTML = html;
  }

  /**
   * Build a date separator if message crosses midnight from previous.
   * @returns {string|null}
   */
  _maybeDateSeparator(prevMsg, msg) {
    const msgDate = new Date(msg.createdAt || msg.sentAt || msg.timestamp);
    if (isNaN(msgDate)) {
      return null;
    }
    if (!prevMsg) {
      return this._dateSeparatorHTML(msgDate);
    }
    const prevDate = new Date(prevMsg.createdAt || prevMsg.sentAt || prevMsg.timestamp);
    if (msgDate.toDateString() !== prevDate.toDateString()) {
      return this._dateSeparatorHTML(msgDate);
    }
    return null;
  }

  _dateSeparatorHTML(date) {
    const label = this._formatDateLabel(date);
    return `
      <div class="messenger-v4__date-separator" role="separator" aria-label="${this.escape(label)}">
        <span class="messenger-v4__date-separator-text">${this.escape(label)}</span>
      </div>`;
  }

  _formatDateLabel(date) {
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return 'Today';
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  /**
   * Minimal fallback message bubble builder (used if MessageBubbleV4 unavailable).
   */
  _buildMessageHTML(msg, currentUser) {
    const uid = currentUser?.id || currentUser?._id;
    const isSent = msg.senderId === uid;
    const time =
      msg.createdAt || msg.sentAt
        ? new Date(msg.createdAt || msg.sentAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
    return `
      <div class="messenger-v4__message ${isSent ? 'messenger-v4__message--sent' : 'messenger-v4__message--received'}" data-id="${this.escape(msg._id)}">
        <div class="messenger-v4__message-content">
          <div class="messenger-v4__message-bubble">${this.escape(msg.content || '')}</div>
          <div class="messenger-v4__message-meta">
            <span class="messenger-v4__message-time">${this.escape(time)}</span>
          </div>
        </div>
      </div>`;
  }

  _buildMessageSkeleton() {
    let html = '';
    for (let i = 0; i < 5; i++) {
      const side = i % 2 === 0 ? 'received' : 'sent';
      html += `<div class="messenger-v4__message messenger-v4__message--${side} messenger-v4__skeleton">
        <div class="messenger-v4__message-content">
          <div class="messenger-v4__skeleton--text messenger-v4__skeleton--long"></div>
        </div>
      </div>`;
    }
    return html;
  }

  /** Infinite scroll handler: load older messages when near top. */
  async _onScroll() {
    // Show/hide scroll-to-bottom button
    if (this._isAtBottom()) {
      this.scrollBtn.style.display = 'none';
    } else {
      this.scrollBtn.style.display = 'flex';
    }

    // Load older messages when scrolled within 80px of top
    if (
      this.messagesEl.scrollTop <= 80 &&
      !this.isLoadingOlder &&
      this.hasMoreMessages &&
      this.conversationId
    ) {
      await this._loadOlderMessages();
    }
  }

  async _loadOlderMessages() {
    if (!this.oldestCursor) {
      return;
    }
    this.isLoadingOlder = true;

    const loader = document.createElement('div');
    loader.className = 'messenger-v4__load-more-spinner';
    loader.innerHTML = '<span>Loading…</span>';
    this.messagesEl.prepend(loader);

    try {
      const data = await this.api.getMessages(this.conversationId, {
        before: this.oldestCursor,
        limit: 30,
      });
      const older = data.messages || data || [];

      loader.remove();

      // Use server's authoritative hasMore flag; fall back to count heuristic for older backends
      this.hasMoreMessages = data.hasMore !== undefined ? data.hasMore : older.length >= 30;

      if (!older.length) {
        // No messages returned — regardless of hasMore, nothing to prepend
        return;
      }

      this.oldestCursor = older[0]?._id || this.oldestCursor;
      this.prependMessages(older);
    } catch (err) {
      console.error('[ChatViewV4] Failed to load older messages:', err);
      loader.remove();
    } finally {
      this.isLoadingOlder = false;
    }
  }

  _onNewMessage(e) {
    const { message, conversationId } = e.detail || {};
    if (!message || conversationId !== this.conversationId) {
      return;
    }
    this.hideTyping();
    this.appendMessage(message);
  }

  /** Direct handler for raw socket event (belt-and-suspenders alongside messenger:new-message). */
  _onV4Message(e) {
    this._onNewMessage(e);
  }

  _isAtBottom() {
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    return scrollHeight - scrollTop - clientHeight < 50;
  }

  _openLightbox(src, alt) {
    this.lightboxImg.src = src;
    this.lightboxImg.alt = alt || 'Image attachment';
    this.lightbox.style.display = 'flex';
    this._lightboxOpen = true;
    document.body.style.overflow = 'hidden';
    this.lightbox.focus();
  }

  _onLightboxClose() {
    this.lightbox.style.display = 'none';
    this.lightboxImg.src = '';
    this._lightboxOpen = false;
    document.body.style.overflow = '';
  }

  _toggleContextMenu(btn) {
    const msgEl = btn.closest('[data-id]');
    if (!msgEl) {
      return;
    }

    // If a menu is already open on this message, close it
    const existing = msgEl.querySelector('.messenger-v4__context-menu');
    if (existing) {
      existing.remove();
      return;
    }

    // Close any other open menus
    this._closeContextMenu();

    const messageId = msgEl.dataset.id;
    const isOwn = btn.dataset.isOwn === 'true';
    const canEdit = btn.dataset.canEdit === 'true';

    // Retrieve message for complete data (needed for reply)
    const msgs = this.state ? this.state.getMessages(this.conversationId) : [];
    const msg = msgs.find(m => String(m._id) === messageId) || { _id: messageId };

    const menuHtml = MessageBubbleV4
      ? MessageBubbleV4.renderContextMenu(msg, isOwn, canEdit)
      : `<div class="messenger-v4__context-menu" role="menu">
           <button class="messenger-v4__context-menu-item" data-action="copy" data-id="${this.escape(messageId)}">📋 Copy</button>
           ${isOwn ? `<button class="messenger-v4__context-menu-item messenger-v4__context-menu-item--danger" data-action="delete" data-id="${this.escape(messageId)}">🗑️ Delete</button>` : ''}
         </div>`;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = menuHtml;
    const menuEl = wrapper.firstElementChild;
    if (menuEl) {
      msgEl.appendChild(menuEl);
      // Trigger the glass slide-in animation defined in messenger-v4-polish.css §14
      requestAnimationFrame(() => menuEl.classList.add('is-entering'));
      menuEl.addEventListener('animationend', () => menuEl.classList.remove('is-entering'), {
        once: true,
      });
    }
  }

  _closeContextMenu() {
    this.messagesEl.querySelectorAll('.messenger-v4__context-menu').forEach(m => m.remove());
  }

  _handleContextMenuAction(action, messageId) {
    switch (action) {
      case 'reply': {
        const msgs = this.state ? this.state.getMessages(this.conversationId) : [];
        const msg = msgs.find(m => String(m._id) === messageId);
        if (msg) {
          window.dispatchEvent(
            new CustomEvent('messenger:set-reply', { detail: { message: msg } })
          );
        }
        break;
      }
      case 'copy': {
        const msgs = this.state ? this.state.getMessages(this.conversationId) : [];
        const msg = msgs.find(m => String(m._id) === messageId);
        if (msg?.content) {
          navigator.clipboard?.writeText(msg.content).catch(() => {});
        }
        break;
      }
      case 'edit':
        window.dispatchEvent(new CustomEvent('messenger:edit-message', { detail: { messageId } }));
        break;
      case 'delete':
        window.dispatchEvent(
          new CustomEvent('messenger:delete-message', { detail: { messageId } })
        );
        break;
      case 'react':
        window.dispatchEvent(
          new CustomEvent('messenger:react-message', { detail: { messageId, emoji: null } })
        );
        break;
      default:
        break;
    }
  }

  escape(str) {
    if (str === null || str === undefined) {
      return '';
    }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

if (typeof window !== 'undefined') {
  window.ChatViewV4 = ChatViewV4;
}
