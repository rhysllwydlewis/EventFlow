/**
 * ConversationListV4 Component
 * Sidebar conversation list with tabs, search, swipe gestures, and presence dots.
 * BEM prefix: messenger-v4__
 */

'use strict';

// Returns true when a string looks like an email address (should not be shown as a name).
function _clv4LooksLikeEmail(str) {
  return typeof str === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

// Returns the first candidate that is non-empty and not an email, or the fallback.
function _clv4SafeName(str, fallback) {
  if (str && !_clv4LooksLikeEmail(str)) {
    return str;
  }
  if (str && _clv4LooksLikeEmail(str)) {
    return str.split('@')[0] || str;
  }
  return fallback || 'Unknown';
}

// Named time constants for readability
const _CLV4_MS = {
  MINUTE: 60_000,
  HOUR: 3_600_000,
  DAY: 86_400_000,
  WEEK: 604_800_000,
};

class ConversationListV4 {
  constructor(container, state, api, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.state = state;
    this.api = api;
    this.options = options;

    this.activeTab = 'all';
    this.searchQuery = '';
    this.searchDebounceTimer = null;

    // Touch tracking for swipe gestures
    this._touchStartX = 0;
    this._touchStartY = 0;
    this._touchTarget = null;

    // Bound handler references for removal
    this._onConversationsChanged = this._onConversationsChanged.bind(this);
    this._onPresenceChanged = this._onPresenceChanged.bind(this);
    this._onConversationSelected = this._onConversationSelected.bind(this);

    this.init();
  }

  /** Initialize: render shell, attach listeners, subscribe to state. */
  init() {
    this.render();
    this.attachEventListeners();
    this.state.on('conversationsChanged', this._onConversationsChanged);
    this.state.on('presenceChanged', this._onPresenceChanged);
    window.addEventListener('messenger:conversation-selected', this._onConversationSelected);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /** Build the static sidebar shell (header, search, tabs, list container). */
  render() {
    this.container.innerHTML = `
      <div class="messenger-v4__sidebar-header">
        <h2 class="messenger-v4__sidebar-title">Messages</h2>
        <button class="messenger-v4__new-convo-btn" aria-label="New conversation" title="New conversation">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      <div class="messenger-v4__search">
        <span class="messenger-v4__search-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </span>
        <input
          type="search"
          class="messenger-v4__search-input"
          placeholder="Search conversations…"
          aria-label="Search conversations"
          autocomplete="off"
        />
      </div>

      <div class="messenger-v4__filter-tabs" role="tablist" aria-label="Conversation filters">
        <button class="messenger-v4__filter-tab messenger-v4__filter-tab--active" data-tab="all" role="tab" aria-selected="true">All</button>
        <button class="messenger-v4__filter-tab" data-tab="pinned" role="tab" aria-selected="false">Pinned</button>
        <button class="messenger-v4__filter-tab" data-tab="unread" role="tab" aria-selected="false">Unread</button>
        <button class="messenger-v4__filter-tab" data-tab="archived" role="tab" aria-selected="false">Archived</button>
      </div>

      <div class="messenger-v4__conversation-list" role="list" id="v4ConversationList"></div>
    `;

    this.listEl = this.container.querySelector('#v4ConversationList');
    this.searchInput = this.container.querySelector('.messenger-v4__search-input');

    // Show skeleton immediately while data loads
    this.renderSkeleton();
  }

  /** Show 3 skeleton placeholder items. */
  renderSkeleton() {
    let html = '';
    for (let i = 0; i < 3; i++) {
      html += `
        <div class="messenger-v4__conversation-item messenger-v4__skeleton" role="listitem" aria-hidden="true">
          <div class="messenger-v4__skeleton--avatar"></div>
          <div class="messenger-v4__conversation-details">
            <div class="messenger-v4__skeleton--text messenger-v4__skeleton--short"></div>
            <div class="messenger-v4__skeleton--text messenger-v4__skeleton--long"></div>
          </div>
        </div>`;
    }
    this.listEl.innerHTML = html;
  }

  /** Show empty-state illustration and message. */
  renderEmpty() {
    const tabMessages = {
      pinned: {
        icon: '📌',
        title: 'No pinned conversations',
        sub: 'Pin a conversation to find it quickly.',
      },
      unread: { icon: '✅', title: 'All caught up!', sub: 'You have no unread conversations.' },
      archived: {
        icon: '🗂️',
        title: 'No archived conversations',
        sub: 'Archived conversations will appear here.',
      },
    };
    const cfg = tabMessages[this.activeTab] || {
      icon: '💬',
      title: 'No conversations yet',
      sub: 'Start a new conversation to get going.',
    };

    // Build using DOM methods so values are always escaped even if source changes
    const wrapper = document.createElement('div');
    wrapper.className = 'messenger-v4__empty-state';
    wrapper.setAttribute('role', 'status');

    const iconEl = document.createElement('span');
    iconEl.className = 'messenger-v4__empty-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = cfg.icon;

    const titleEl = document.createElement('p');
    titleEl.className = 'messenger-v4__empty-title';
    titleEl.textContent = cfg.title;

    const subEl = document.createElement('p');
    subEl.className = 'messenger-v4__empty-sub';
    subEl.textContent = cfg.sub;

    wrapper.appendChild(iconEl);
    wrapper.appendChild(titleEl);
    wrapper.appendChild(subEl);

    if (this.activeTab === 'all') {
      const cta = document.createElement('button');
      cta.className = 'messenger-v4__empty-cta';
      cta.dataset.action = 'new-conversation';
      cta.setAttribute('aria-label', 'Start a new conversation');
      cta.textContent = '+ New Conversation';
      wrapper.appendChild(cta);
    }

    this.listEl.innerHTML = '';
    this.listEl.appendChild(wrapper);
  }

  /**
   * Render filtered conversation list into the sidebar.
   * @param {Array} conversations - Raw conversation objects from state
   */
  renderConversations(conversations) {
    const currentUser = this.state.currentUser;

    // Apply tab filter
    let filtered = conversations.filter(conv => {
      const me = this._myParticipant(conv, currentUser);
      if (this.activeTab === 'pinned') {
        return me && me.isPinned;
      }
      if (this.activeTab === 'unread') {
        return me && me.unreadCount > 0;
      }
      if (this.activeTab === 'archived') {
        return me && me.isArchived;
      }
      // 'all' — exclude archived
      return !me || !me.isArchived;
    });

    // Apply search filter
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      filtered = filtered.filter(conv => {
        const other = this._otherParticipant(conv, currentUser);
        return (
          other?.displayName?.toLowerCase().includes(q) ||
          conv.lastMessage?.content?.toLowerCase().includes(q)
        );
      });
    }

    // Sort by most recently updated (mirrors the API sort order; required because
    // state.updateConversation() updates in-place without re-sorting the array)
    filtered = filtered.slice().sort((a, b) => {
      // Pinned conversations always float above non-pinned within the same tab
      const meA = this._myParticipant(a, currentUser);
      const meB = this._myParticipant(b, currentUser);
      if (meA?.isPinned !== meB?.isPinned) {
        return meA?.isPinned ? -1 : 1;
      }
      const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return tb - ta;
    });

    if (!filtered.length) {
      this.renderEmpty();
      return;
    }

    this.listEl.innerHTML = filtered
      .map(conv => this._buildConversationHTML(conv, currentUser))
      .join('');

    // Re-attach per-item listeners after re-render
    this._attachItemListeners();
  }

  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------

  attachEventListeners() {
    // Tab switching
    this.container.querySelectorAll('.messenger-v4__filter-tab').forEach(tab => {
      tab.addEventListener('click', () => this._switchTab(tab.dataset.tab));
    });

    // Search with 300 ms debounce
    this.searchInput.addEventListener('input', e => {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        this.searchQuery = e.target.value.trim();
        this.state.setFilter('search', this.searchQuery);
        this.renderConversations(this.state.conversations || []);
      }, 300);
    });

    // New conversation button
    const newBtn = this.container.querySelector('.messenger-v4__new-convo-btn');
    if (newBtn) {
      newBtn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('messenger:open-contact-picker'));
      });
    }

    // Touch events for swipe gestures (delegated to list)
    this.listEl.addEventListener('touchstart', e => this._onTouchStart(e), { passive: true });
    this.listEl.addEventListener('touchend', e => this._onTouchEnd(e), { passive: true });
  }

  /** Re-attach click listeners on individual conversation items after re-render. */
  _attachItemListeners() {
    this.listEl.querySelectorAll('.messenger-v4__conversation-item[data-id]').forEach(el => {
      el.addEventListener('click', () => this.selectConversation(el.dataset.id));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.selectConversation(el.dataset.id);
        }
      });
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        this._showItemContextMenu(el.dataset.id, e.clientX, e.clientY);
      });
    });
  }

  /**
   * Show a context menu for a conversation item (right-click).
   * @param {string} id - Conversation ID
   * @param {number} x - Client X position
   * @param {number} y - Client Y position
   */
  _showItemContextMenu(id, x, y) {
    // Remove any existing context menus
    document.querySelectorAll('.messenger-v4__conv-context-menu').forEach(m => m.remove());

    // Determine whether the conversation is currently unread for the toggle label
    const currentUser = this.state.currentUser;
    const uid = currentUser?.id || currentUser?._id;
    const conv = (this.state.conversations || []).find(c => c._id === id);
    const me = conv && uid ? conv.participants?.find(p => p.userId === uid) : null;
    const isUnread = me ? (me.unreadCount || 0) > 0 : false;
    const markLabel = isUnread ? 'Mark as Read' : 'Mark as Unread';
    const markAction = isUnread ? 'mark-read' : 'mark-unread';

    const menu = document.createElement('div');
    menu.className = 'messenger-v4__conv-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Conversation options');
    menu.innerHTML = `
      <button class="messenger-v4__conv-context-menu-item" data-action="${this.escape(markAction)}" data-id="${this.escape(id)}" role="menuitem">
        <svg class="messenger-v4__menu-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        ${this.escape(markLabel)}
      </button>
      <button class="messenger-v4__conv-context-menu-item" data-action="pin" data-id="${this.escape(id)}" role="menuitem">
        <svg class="messenger-v4__menu-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17H19V13L14 3H10L5 13V17Z"/></svg>
        Pin
      </button>
      <button class="messenger-v4__conv-context-menu-item" data-action="archive" data-id="${this.escape(id)}" role="menuitem">
        <svg class="messenger-v4__menu-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
        Archive
      </button>
      <button class="messenger-v4__conv-context-menu-item messenger-v4__conv-context-menu-item--danger" data-action="delete" data-id="${this.escape(id)}" role="menuitem">
        <svg class="messenger-v4__menu-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        Delete
      </button>
    `;

    // Position the menu near the cursor
    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);

    // Adjust to keep within viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${y - rect.height}px`;
    }

    // Setup close-on-outside-mousedown BEFORE wiring buttons so references are available
    let menuClicked = false;
    menu.addEventListener('mousedown', () => {
      menuClicked = true;
    });

    const removeListeners = () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', onEsc);
    };
    const closeMenu = () => {
      if (menuClicked) {
        menuClicked = false;
        return;
      }
      menu.remove();
      removeListeners();
    };
    const onEsc = e => {
      if (e.key === 'Escape') {
        menu.remove();
        removeListeners();
      }
    };
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', onEsc);

    // Wire action buttons
    menu.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const convId = btn.dataset.id;
        menu.remove();
        removeListeners();
        switch (action) {
          case 'mark-unread':
            window.dispatchEvent(
              new CustomEvent('messenger:mark-unread', { detail: { id: convId } })
            );
            break;
          case 'mark-read':
            window.dispatchEvent(
              new CustomEvent('messenger:mark-read', { detail: { id: convId } })
            );
            break;
          case 'pin':
            window.dispatchEvent(
              new CustomEvent('messenger:pin-conversation', { detail: { id: convId } })
            );
            break;
          case 'archive':
            window.dispatchEvent(
              new CustomEvent('messenger:archive-conversation', { detail: { id: convId } })
            );
            break;
          case 'delete':
            window.dispatchEvent(
              new CustomEvent('messenger:delete-conversation', { detail: { id: convId } })
            );
            break;
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Public actions
  // ---------------------------------------------------------------------------

  /**
   * Mark a conversation as selected and dispatch event.
   * @param {string} id - Conversation ID
   */
  selectConversation(id) {
    // Update active highlight
    this.listEl.querySelectorAll('.messenger-v4__conversation-item').forEach(el => {
      el.classList.toggle('messenger-v4__conversation-item--active', el.dataset.id === id);
      el.setAttribute('aria-selected', el.dataset.id === id ? 'true' : 'false');
    });

    window.dispatchEvent(new CustomEvent('messenger:conversation-selected', { detail: { id } }));
  }

  /** Remove all listeners and clear DOM. */
  destroy() {
    clearTimeout(this.searchDebounceTimer);
    this.state.off('conversationsChanged', this._onConversationsChanged);
    this.state.off('presenceChanged', this._onPresenceChanged);
    window.removeEventListener('messenger:conversation-selected', this._onConversationSelected);
    this.container.innerHTML = '';
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _switchTab(tab) {
    this.activeTab = tab;
    this.container.querySelectorAll('.messenger-v4__filter-tab').forEach(el => {
      const active = el.dataset.tab === tab;
      el.classList.toggle('messenger-v4__filter-tab--active', active);
      el.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    // Keep MessengerState.filters in sync so arrow-key navigation mirrors the visible list
    this.state.setFilter('active', tab);
    this.renderConversations(this.state.conversations || []);
  }

  _onConversationsChanged(conversations) {
    // Capture previous unread counts before re-rendering so we can pulse new ones
    const prevUnread = {};
    this.listEl.querySelectorAll('.messenger-v4__conversation-item[data-id]').forEach(el => {
      const badge = el.querySelector('.messenger-v4__unread-badge');
      prevUnread[el.dataset.id] = badge ? parseInt(badge.textContent, 10) || 0 : 0;
    });

    this.renderConversations(conversations || []);

    // Pulse unread badges that increased
    this.listEl.querySelectorAll('.messenger-v4__conversation-item[data-id]').forEach(el => {
      const badge = el.querySelector('.messenger-v4__unread-badge');
      if (!badge) {
        return;
      }
      const newCount = parseInt(badge.textContent, 10) || 0;
      if (newCount > (prevUnread[el.dataset.id] || 0)) {
        badge.classList.remove('is-pulsing'); // reset if already running
        // Force reflow so animation restarts
        void badge.offsetWidth;
        badge.classList.add('is-pulsing');
        badge.addEventListener('animationend', () => badge.classList.remove('is-pulsing'), {
          once: true,
        });
      }
    });
  }

  _onPresenceChanged() {
    // Re-render to update online dots
    this.renderConversations(this.state.conversations || []);
  }

  _onConversationSelected(e) {
    const id = e.detail?.id;
    if (!id) {
      return;
    }
    this.listEl.querySelectorAll('.messenger-v4__conversation-item').forEach(el => {
      const isActive = el.dataset.id === id;
      el.classList.toggle('messenger-v4__conversation-item--active', isActive);
      el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  // ---------------------------------------------------------------------------
  // Swipe gesture handling (mobile)
  // ---------------------------------------------------------------------------

  _onTouchStart(e) {
    const touch = e.touches[0];
    this._touchStartX = touch.clientX;
    this._touchStartY = touch.clientY;
    this._touchTarget = e.target.closest('.messenger-v4__conversation-item[data-id]');
  }

  _onTouchEnd(e) {
    if (!this._touchTarget) {
      return;
    }
    const touch = e.changedTouches[0];
    const dx = touch.clientX - this._touchStartX;
    const dy = touch.clientY - this._touchStartY;

    // Only treat as horizontal swipe if mostly horizontal
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) {
      this._touchTarget = null;
      return;
    }

    const id = this._touchTarget.dataset.id;
    if (dx < 0) {
      // Swipe left → archive
      window.dispatchEvent(new CustomEvent('messenger:archive-conversation', { detail: { id } }));
    } else {
      // Swipe right → pin
      window.dispatchEvent(new CustomEvent('messenger:pin-conversation', { detail: { id } }));
    }
    this._touchTarget = null;
  }

  // ---------------------------------------------------------------------------
  // HTML builders
  // ---------------------------------------------------------------------------

  /**
   * Build HTML string for a single conversation item.
   * @param {Object} conv
   * @param {Object} currentUser
   * @returns {string}
   */
  _buildConversationHTML(conv, currentUser) {
    const me = this._myParticipant(conv, currentUser);
    const other = this._otherParticipant(conv, currentUser);
    const unread = me?.unreadCount || 0;
    const isActive = this.state.activeConversationId === conv._id;
    const isOnline = this.state.getPresence(other?.userId)?.state === 'online';

    const avatarLetter = this.escape(
      _clv4SafeName(other?.displayName, 'U').charAt(0).toUpperCase()
    );
    const name = this.escape(_clv4SafeName(other?.displayName));
    const preview = this._buildPreview(conv, currentUser);
    const timestamp = this._formatTime(conv.updatedAt);
    const contextBadge = this._buildContextBadge(conv);

    const itemClasses = [
      'messenger-v4__conversation-item',
      isActive ? 'messenger-v4__conversation-item--active' : '',
      unread > 0 ? 'messenger-v4__conversation-item--unread' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return `
      <div class="${itemClasses}"
           data-id="${this.escape(conv._id)}"
           role="listitem"
           tabindex="0"
           aria-selected="${isActive}"
           aria-label="Conversation with ${name}${unread > 0 ? `, ${unread} unread` : ''}">
        <div class="messenger-v4__avatar-wrapper">
          <div class="messenger-v4__avatar" aria-hidden="true">${avatarLetter}</div>
          ${isOnline ? '<span class="messenger-v4__presence-dot messenger-v4__presence-dot--online" aria-label="Online"></span>' : ''}
        </div>
        <div class="messenger-v4__conversation-details">
          <div class="messenger-v4__conversation-header">
            <span class="messenger-v4__conversation-name">${name}</span>
            <span class="messenger-v4__conversation-meta">
              <span class="messenger-v4__timestamp">${this.escape(timestamp)}</span>
              ${unread > 0 ? `<span class="messenger-v4__unread-badge" aria-label="${unread} unread">${unread > 99 ? '99+' : unread}</span>` : ''}
            </span>
          </div>
          <div class="messenger-v4__message-preview">
            ${preview}
            ${contextBadge}
          </div>
        </div>
      </div>`;
  }

  /** Build the preview snippet (prefix "You: " for own messages). */
  _buildPreview(conv, currentUser) {
    const msg = conv.lastMessage;
    if (!msg) {
      return '<span class="messenger-v4__message-preview--empty">No messages yet</span>';
    }
    const isOwn = msg.senderId === currentUser?.id || msg.senderId === currentUser?._id;
    const text = msg.content ? this.escape(msg.content.substring(0, 60)) : '📎 Attachment';
    return isOwn ? `<span class="messenger-v4__message-preview--you">You: ${text}</span>` : text;
  }

  /** Build context chip HTML for package/supplier/marketplace conversations. */
  _buildContextBadge(conv) {
    if (!conv.context?.type) {
      return '';
    }
    const map = {
      package: '📦 Package',
      supplier_profile: '🏢 Supplier',
      marketplace_listing: '🛒 Marketplace',
      find_a_supplier: '🔍 Find a Supplier',
    };
    const label = map[conv.context.type];
    if (!label) {
      return '';
    }
    return `<span class="messenger-v4__context-badge" aria-label="${this.escape(conv.context.type)} context">${label}</span>`;
  }

  _myParticipant(conv, currentUser) {
    if (!currentUser || !conv.participants) {
      return null;
    }
    const uid = currentUser.id || currentUser._id;
    return conv.participants.find(p => p.userId === uid) || null;
  }

  _otherParticipant(conv, currentUser) {
    if (!currentUser || !conv.participants) {
      return null;
    }
    const uid = currentUser.id || currentUser._id;
    return conv.participants.find(p => p.userId !== uid) || null;
  }

  _formatTime(dateStr) {
    if (!dateStr) {
      return '';
    }
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (isNaN(diff)) {
      return '';
    }
    if (diff < _CLV4_MS.MINUTE) {
      return 'Just now';
    }
    if (diff < _CLV4_MS.HOUR) {
      return `${Math.floor(diff / _CLV4_MS.MINUTE)}m`;
    }
    if (diff < _CLV4_MS.DAY) {
      return `${Math.floor(diff / _CLV4_MS.HOUR)}h`;
    }
    if (diff < _CLV4_MS.WEEK) {
      return d.toLocaleDateString(undefined, { weekday: 'short' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /**
   * Escape a string to prevent XSS in innerHTML.
   * @param {*} str
   * @returns {string}
   */
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
  window.ConversationListV4 = ConversationListV4;
}
