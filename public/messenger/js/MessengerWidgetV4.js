/**
 * MessengerWidgetV4 Component
 * Dashboard inbox widget powered by Messenger v4 API
 * Supports inline quick reply, pulse animation, WebSocket/polling fallback
 */

'use strict';

(function () {
  // ─── Utility helpers ────────────────────────────────────────────────────────

  function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
      return '';
    }
    const div = document.createElement('div');
    div.textContent = unsafe;
    return div.innerHTML;
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) {
      return '';
    }
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) {
      return 'Just now';
    }
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    if (diffDays === 1) {
      return 'Yesterday';
    }
    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }
    return date.toLocaleDateString();
  }

  function getAvatarColor(name) {
    if (!name) {
      return '#0B8073';
    }
    const colors = ['#0B8073', '#0D9488', '#10B981', '#059669', '#14B8A6', '#0891B2'];
    return colors[name.charCodeAt(0) % colors.length];
  }

  function truncate(text, maxLength) {
    if (!text || text.length <= maxLength) {
      return text || '';
    }
    return `${text.substring(0, maxLength)}…`;
  }

  // Returns true if the string looks like an email address (should not be shown as a name)
  function looksLikeEmail(str) {
    return typeof str === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
  }

  // Render a lead quality badge from a conversation object.
  // Uses leadScore (string) or leadScoreRaw (number 0-100) stored on the conversation.
  // Returns a safe HTML string or empty string when no quality data is present.
  function renderLeadQualityBadge(conv) {
    const QUALITY_MAP = {
      High: { label: 'High', color: '#10b981', emoji: '⭐' },
      Medium: { label: 'Medium', color: '#f59e0b', emoji: '●' },
      Low: { label: 'Low', color: '#ef4444', emoji: '◯' },
      Hot: { label: 'Hot', color: '#ef4444', emoji: '🔥' },
      Good: { label: 'Good', color: '#10b981', emoji: '✓' },
    };

    let meta = null;

    if (conv.leadScore && QUALITY_MAP[conv.leadScore]) {
      meta = QUALITY_MAP[conv.leadScore];
    } else if (typeof conv.leadScoreRaw === 'number') {
      if (conv.leadScoreRaw >= 80) {
        meta = QUALITY_MAP.Hot;
      } else if (conv.leadScoreRaw >= 60) {
        meta = QUALITY_MAP.High;
      } else if (conv.leadScoreRaw >= 40) {
        meta = QUALITY_MAP.Good;
      } else {
        meta = QUALITY_MAP.Low;
      }
    }

    if (!meta) {
      return '';
    }

    const scoreHtml =
      typeof conv.leadScoreRaw === 'number'
        ? ` <span style="opacity:0.8;font-size:0.7rem;" aria-hidden="true">(${conv.leadScoreRaw})</span>`
        : '';
    const label = escapeHtml(meta.label);
    const emoji = escapeHtml(meta.emoji);
    const color = escapeHtml(meta.color);

    return `<span class="mwv4__lead-badge lead-badge" role="status" aria-label="Lead quality: ${label}" style="background:${color};color:white;padding:0.15rem 0.4rem;border-radius:4px;font-size:0.7rem;font-weight:600;display:inline-flex;align-items:center;gap:0.2rem;">${emoji} ${label}${scoreHtml}</span>`;
  }

  // Returns the first safe (non-email) display name from the arguments, or fallback
  function safeDisplayName(...candidates) {
    let firstEmail = null;
    for (const candidate of candidates) {
      if (candidate && !looksLikeEmail(candidate)) {
        return candidate;
      }
      if (candidate && looksLikeEmail(candidate) && !firstEmail) {
        firstEmail = candidate;
      }
    }
    if (firstEmail) {
      return firstEmail.split('@')[0] || firstEmail;
    }
    return 'Unknown';
  }

  function getCsrfToken() {
    // Try cookie (primary method – Double-Submit Cookie pattern)
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) {
        continue;
      }
      const name = trimmed.substring(0, eqIndex);
      if (name === 'csrf' || name === 'csrfToken') {
        try {
          const val = decodeURIComponent(trimmed.substring(eqIndex + 1));
          if (val) {
            return val;
          }
        } catch (_) {
          continue;
        }
      }
    }
    // Fallback to globals set by csrf-handler.js
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    if (window.csrfToken) {
      return window.csrfToken;
    }
    return '';
  }

  // ─── MessengerWidgetV4 ───────────────────────────────────────────────────────

  /**
   * MessengerWidgetV4 – Dashboard inbox card powered by Messenger v4.
   *
   * @param {string} containerId   DOM element id to render into.
   * @param {Object} [options]
   * @param {number}   [options.maxItems=5]              Max conversations to show.
   * @param {number}   [options.refreshIntervalMs=60000] Polling interval when WS unavailable.
   * @param {boolean}  [options.showQuickReply=true]     Enable inline quick-reply.
   * @param {string}   [options.currentUserId]           Current user ID (auto-resolved if omitted).
   * @param {Function} [options.conversationUrlBuilder]  Build deep-link URL.
   */
  class MessengerWidgetV4 {
    constructor(containerId, options = {}) {
      this.container = document.getElementById(containerId);
      if (!this.container) {
        console.error(`MessengerWidgetV4: container #${containerId} not found`);
        return;
      }

      this.options = {
        maxItems: options.maxItems || 5,
        refreshIntervalMs: options.refreshIntervalMs || 60000,
        showQuickReply: options.showQuickReply !== false,
        conversationUrlBuilder:
          options.conversationUrlBuilder ||
          (id => `/messenger/?conversation=${encodeURIComponent(id)}`),
      };

      // Resolved current user ID – used to identify self in participants array
      this._currentUserId = options.currentUserId || null;

      this.conversations = [];
      this.unreadCount = 0;
      this._prevUnreadCount = 0;
      this.isLoading = false;
      this.wsConnected = false;
      this.refreshTimer = null;
      this.activeConversationId = null; // for quick-reply panel

      // IDs of external filter/sort/search controls (set via options or auto-detected)
      this._searchInputId = options.searchInputId || 'widget-search-input-supplier';
      this._filterSelectId = options.filterSelectId || 'widget-filter-select-supplier';
      this._sortSelectId = options.sortSelectId || 'widget-sort-select-supplier';

      // Optional callback called after each render with (conversations, filteredConversations)
      this._onRendered = typeof options.onRendered === 'function' ? options.onRendered : null;

      // Bound handlers kept for cleanup
      this._onOnline = () => {
        if (!this.wsConnected) {
          this._fetchConversations();
        }
      };
      this._onOffline = () => {};
      this._onMessengerNotification = () => this._fetchConversations();

      this._init();
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    async _init() {
      this._renderSkeleton();
      await this._fetchConversations();
      this._setupWebSocket();
      this._setupPolling();
      this._setupExternalControls();
      window.addEventListener('online', this._onOnline);
      window.addEventListener('offline', this._onOffline);
      window.addEventListener('messenger:notification', this._onMessengerNotification);
    }

    /**
     * Resolve the current user ID from available sources.
     * Tries: option passed to constructor → AuthStateManager → AuthState → container dataset.
     * Returns null if no user ID can be determined.
     */
    _resolveCurrentUserId() {
      if (this._currentUserId) {
        return this._currentUserId;
      }
      // AuthStateManager (primary global in EventFlow)
      if (window.AuthStateManager && typeof window.AuthStateManager.getUser === 'function') {
        const u = window.AuthStateManager.getUser();
        if (u && (u.id || u._id)) {
          this._currentUserId = String(u.id || u._id);
          return this._currentUserId;
        }
      }
      // Container data attribute fallback (set by page if needed)
      if (this.container.dataset.currentUserId) {
        this._currentUserId = this.container.dataset.currentUserId;
        return this._currentUserId;
      }
      return null;
    }

    destroy() {
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
      if (this._socket) {
        this._socket.disconnect();
        this._socket = null;
      }
      window.removeEventListener('online', this._onOnline);
      window.removeEventListener('offline', this._onOffline);
      window.removeEventListener('messenger:notification', this._onMessengerNotification);
      if (this.container) {
        this.container.innerHTML = '';
      }
    }

    // ── Data ──────────────────────────────────────────────────────────────────

    async _fetchConversations() {
      if (this.isLoading) {
        return;
      }
      if (!navigator.onLine) {
        return;
      }
      this.isLoading = true;
      try {
        const res = await fetch(`/api/v4/messenger/conversations?limit=${this.options.maxItems}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        this.conversations = data.conversations || [];
        this._prevUnreadCount = this.unreadCount;

        // Capture current userId once for the reduction
        const currentUserId = this._resolveCurrentUserId();

        // unreadCount is stored per-participant, not at conversation level
        this.unreadCount = this.conversations.reduce((sum, c) => {
          const participants = Array.isArray(c.participants) ? c.participants : [];
          const me = currentUserId
            ? participants.find(p => String(p.userId) === currentUserId)
            : null;
          return sum + ((me && me.unreadCount) || 0);
        }, 0);

        // Broadcast so NotificationBridgeV4 (loaded on dashboards) can update
        // bell badges and tab title without polling.
        window.dispatchEvent(
          new CustomEvent('messenger:unread-count', { detail: { count: this.unreadCount } })
        );

        this._render();
      } catch (err) {
        console.error('MessengerWidgetV4: fetch failed', err);
        if (this.conversations.length === 0) {
          this._renderError();
        }
      } finally {
        this.isLoading = false;
      }
    }

    // ── Quick-reply send ──────────────────────────────────────────────────────

    async _sendReply(conversationId, message) {
      const res = await fetch(
        `/api/v4/messenger/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
          },
          body: JSON.stringify({ content: message }),
        }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json();
    }

    // ── WebSocket / polling ───────────────────────────────────────────────────

    _setupWebSocket() {
      if (window.io && typeof window.io === 'function') {
        try {
          this._socket = window.io();
          const refresh = () => this._fetchConversations();
          this._socket.on('messenger:v4:message', refresh);
          this._socket.on('messenger:v4:conversation-updated', refresh);
          this._socket.on('messenger:v4:read', refresh);
          this._socket.on('connect', () => {
            this.wsConnected = true;
          });
          this._socket.on('disconnect', () => {
            this.wsConnected = false;
          });
          this.wsConnected = true;
        } catch (e) {
          // Socket.IO unavailable – fall back to polling
          this.wsConnected = false;
        }
      }
    }

    _setupPolling() {
      // Poll only when WebSocket is not connected
      this.refreshTimer = setInterval(() => {
        if (!this.wsConnected) {
          this._fetchConversations();
        }
      }, this.options.refreshIntervalMs);
    }

    // ── Rendering ─────────────────────────────────────────────────────────────

    _renderSkeleton() {
      this.container.innerHTML = `
        <div class="mwv4" aria-busy="true">
          <div class="mwv4__header">
            <span class="mwv4__title">💬 Messages</span>
          </div>
          <ul class="mwv4__list">
            ${[1, 2, 3]
              .map(
                () => `<li class="mwv4__item mwv4__item--skeleton">
                  <div class="mwv4__avatar mwv4__avatar--skeleton"></div>
                  <div class="mwv4__body">
                    <div class="mwv4__skeleton-line mwv4__skeleton-line--name"></div>
                    <div class="mwv4__skeleton-line mwv4__skeleton-line--preview"></div>
                  </div>
                </li>`
              )
              .join('')}
          </ul>
        </div>`;
    }

    // ── External filter/sort/search controls ──────────────────────────────────

    /**
     * Wire external search/filter/sort DOM controls to re-render without refetch.
     * Controls are identified by IDs set in the constructor options.
     */
    _setupExternalControls() {
      const rerender = () => this._render();

      const searchEl = document.getElementById(this._searchInputId);
      const filterEl = document.getElementById(this._filterSelectId);
      const sortEl = document.getElementById(this._sortSelectId);

      if (searchEl) {
        searchEl.addEventListener('input', rerender);
      }
      if (filterEl) {
        filterEl.addEventListener('change', rerender);
      }
      if (sortEl) {
        sortEl.addEventListener('change', rerender);
      }
    }

    /**
     * Apply client-side search, lead-quality filter, and sort to conversations.
     * Reads current values from the external controls if present.
     * @param {Array} conversations - The full fetched conversation array.
     * @returns {Array} Filtered and sorted subset.
     */
    _applyClientFilters(conversations) {
      if (!conversations || conversations.length === 0) {
        return conversations;
      }

      const searchEl = document.getElementById(this._searchInputId);
      const filterEl = document.getElementById(this._filterSelectId);
      const sortEl = document.getElementById(this._sortSelectId);

      const searchQuery = searchEl ? searchEl.value.toLowerCase().trim() : '';
      const filterValue = filterEl ? filterEl.value : 'all';
      const sortValue = sortEl ? sortEl.value : 'newest';

      // QUALITY_SCORE_MAP mirrors the one in renderLeadQualityBadge
      const QUALITY_SCORE_MAP = { Hot: 4, High: 3, Good: 2, Medium: 2, Low: 1 };

      let result = conversations.slice();

      // 1. Search across participant display names and last message preview
      if (searchQuery) {
        result = result.filter(conv => {
          const participants = Array.isArray(conv.participants) ? conv.participants : [];
          const currentUserId = this._resolveCurrentUserId();
          const other =
            participants.find(p => String(p.userId) !== String(currentUserId || '')) ||
            participants[0] ||
            {};
          const name = (other.displayName || other.businessName || other.name || '').toLowerCase();
          const preview = (conv.lastMessage?.content || conv.lastMessage?.text || '').toLowerCase();
          return name.includes(searchQuery) || preview.includes(searchQuery);
        });
      }

      // 2. Quality / status filter
      if (filterValue === 'unread') {
        const currentUserId = this._resolveCurrentUserId();
        result = result.filter(conv => {
          const participants = Array.isArray(conv.participants) ? conv.participants : [];
          const me = currentUserId
            ? participants.find(p => String(p.userId) === currentUserId)
            : null;
          return ((me && me.unreadCount) || 0) > 0;
        });
      } else if (filterValue === 'starred') {
        result = result.filter(conv => conv.isStarred === true);
      } else if (filterValue === 'high') {
        result = result.filter(
          conv =>
            conv.leadScore === 'High' ||
            conv.leadScore === 'Hot' ||
            (typeof conv.leadScoreRaw === 'number' && conv.leadScoreRaw >= 60)
        );
      } else if (filterValue === 'medium') {
        result = result.filter(
          conv =>
            conv.leadScore === 'Medium' ||
            conv.leadScore === 'Good' ||
            (typeof conv.leadScoreRaw === 'number' &&
              conv.leadScoreRaw >= 40 &&
              conv.leadScoreRaw < 60)
        );
      } else if (filterValue === 'low') {
        result = result.filter(
          conv =>
            conv.leadScore === 'Low' ||
            (typeof conv.leadScoreRaw === 'number' && conv.leadScoreRaw < 40)
        );
      }

      // 3. Sort
      result.sort((a, b) => {
        if (sortValue === 'oldest') {
          return new Date(a.updatedAt || a.createdAt) - new Date(b.updatedAt || b.createdAt);
        }
        if (sortValue === 'score-high') {
          const sa = a.leadScoreRaw || QUALITY_SCORE_MAP[a.leadScore] || 0;
          const sb = b.leadScoreRaw || QUALITY_SCORE_MAP[b.leadScore] || 0;
          return sb - sa;
        }
        if (sortValue === 'score-low') {
          const sa = a.leadScoreRaw || QUALITY_SCORE_MAP[a.leadScore] || 0;
          const sb = b.leadScoreRaw || QUALITY_SCORE_MAP[b.leadScore] || 0;
          return sa - sb;
        }
        // Default: newest first
        return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
      });

      return result;
    }

    _render() {
      const pulseBadge = this.unreadCount > this._prevUnreadCount ? ' mwv4__badge--pulse' : '';
      const badgeHtml =
        this.unreadCount > 0
          ? `<span class="mwv4__badge${pulseBadge}" aria-label="${this.unreadCount} unread messages">${this.unreadCount}</span>`
          : '';

      // Apply client-side filter/sort/search before rendering
      const visible = this._applyClientFilters(this.conversations);

      const listHtml = visible.length
        ? visible.map(c => this._renderItem(c)).join('')
        : `<li class="mwv4__empty">
             <span class="mwv4__empty-icon">💬</span>
             <p class="mwv4__empty-text">${this.conversations.length > 0 ? 'No conversations match your filters' : 'No conversations yet'}</p>
           </li>`;

      this.container.innerHTML = `
        <div class="mwv4" role="region" aria-label="Recent messages">
          <div class="mwv4__header">
            <span class="mwv4__title">💬 Messages ${badgeHtml}</span>
            <a href="/messenger/" class="mwv4__view-all" aria-label="View all messages">
              View All Messages →
            </a>
          </div>
          <ul class="mwv4__list" role="list" aria-live="polite">
            ${listHtml}
          </ul>
        </div>`;

      this._attachHandlers();

      // Notify external callback with full + filtered conversation arrays
      if (this._onRendered) {
        try {
          this._onRendered(this.conversations, visible);
        } catch (e) {
          // ignore callback errors
        }
      }
    }

    _renderItem(conv) {
      const currentUserId = this._resolveCurrentUserId();

      // Determine the other participant for display
      const participants = Array.isArray(conv.participants) ? conv.participants : [];

      // Current user's participant entry (for unreadCount)
      const me = currentUserId ? participants.find(p => String(p.userId) === currentUserId) : null;

      // Other participant (for avatar/name display)
      const other =
        participants.find(p => String(p.userId) !== String(currentUserId || '')) ||
        participants[0] ||
        {};

      const rawName = safeDisplayName(other.displayName, other.businessName, other.name);
      const name = escapeHtml(rawName);
      const initial = rawName.charAt(0).toUpperCase() || '?';
      const avatarColor = getAvatarColor(rawName);
      // Only allow same-origin avatar URLs (relative paths starting with /) to prevent tracking pixels
      const safeAvatarUrl = other.avatar && /^\//.test(other.avatar) ? other.avatar : null;
      const avatarImg = safeAvatarUrl
        ? `<img src="${escapeHtml(safeAvatarUrl)}" alt="${name}" class="mwv4__avatar-img" loading="lazy" data-fallback-hide>`
        : `<span class="mwv4__avatar-initial">${escapeHtml(initial)}</span>`;

      const lastMsg = conv.lastMessage || {};
      const preview = escapeHtml(truncate(lastMsg.content || lastMsg.text || '', 60));
      const time = escapeHtml(
        formatRelativeTime(lastMsg.sentAt || lastMsg.createdAt || conv.updatedAt)
      );
      // unreadCount is per-participant, stored in the current user's participant entry
      const unread = (me && me.unreadCount) || 0;
      const convId = escapeHtml(conv._id || conv.id || '');

      const unreadDot =
        unread > 0 ? '<span class="mwv4__unread-dot" aria-hidden="true"></span>' : '';
      const unreadCount =
        unread > 0
          ? `<span class="mwv4__item-badge" aria-label="${unread} unread">${unread > 99 ? '99+' : unread}</span>`
          : '';

      const leadBadge = renderLeadQualityBadge(conv);

      return `
        <li class="mwv4__item${unread > 0 ? ' mwv4__item--unread' : ''}"
            data-conversation-id="${convId}"
            role="listitem">
          <button class="mwv4__item-btn" data-action="open" data-conversation-id="${convId}"
                  aria-label="Open conversation with ${name}">
            <div class="mwv4__avatar" style="background:${avatarColor}" aria-hidden="true">
              ${avatarImg}
              ${unreadDot}
            </div>
            <div class="mwv4__content">
              <div class="mwv4__name">${name}${leadBadge}</div>
              <div class="mwv4__preview">${preview || '<em>No messages yet</em>'}</div>
            </div>
            <div class="mwv4__meta">
              <div class="mwv4__time">${time}</div>
              ${unreadCount}
            </div>
          </button>
          ${this.options.showQuickReply ? this._renderQuickReplyPanel(convId) : ''}
        </li>`;
    }

    _renderQuickReplyPanel(convId) {
      return `
        <div class="mwv4__reply-panel" data-reply-for="${convId}" hidden>
          <textarea class="mwv4__reply-textarea"
                    placeholder="Type a quick reply…"
                    rows="1"
                    aria-label="Quick reply message"
                    maxlength="2000"></textarea>
          <div class="mwv4__reply-actions">
            <button class="mwv4__reply-send" data-action="send" data-conversation-id="${convId}"
                    aria-label="Send reply" disabled>
              Send
            </button>
            <button class="mwv4__reply-cancel" data-action="cancel" data-conversation-id="${convId}"
                    aria-label="Cancel reply">
              Cancel
            </button>
          </div>
        </div>`;
    }

    _renderError() {
      this.container.innerHTML = `
        <div class="mwv4">
          <div class="mwv4__header">
            <span class="mwv4__title">💬 Messages</span>
            <a href="/messenger/" class="mwv4__view-all">View All →</a>
          </div>
          <div class="mwv4__empty" style="text-align:center;padding:2rem 1rem;">
            <div style="font-size:2rem;margin-bottom:0.5rem;">⚠️</div>
            <p class="mwv4__empty-text">Unable to load conversations.</p>
            <button class="mwv4__retry-btn" type="button">Retry</button>
            <p class="small" style="margin-top:0.75rem;"><a href="/messenger/" style="color:#0B8073">Open full inbox</a></p>
          </div>
        </div>`;
      this.container
        .querySelector('.mwv4__retry-btn')
        ?.addEventListener('click', () => this._fetchConversations());
    }

    // ── Event handling ────────────────────────────────────────────────────────

    _attachHandlers() {
      // Open conversation / toggle quick-reply
      this.container.querySelectorAll('[data-action="open"]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const convId = btn.dataset.conversationId;
          if (!this.options.showQuickReply) {
            window.location.href = this.options.conversationUrlBuilder(convId);
            return;
          }
          this._toggleQuickReply(convId);
        });
      });

      // Textarea expand-to-multiline & enable/disable send
      this.container.querySelectorAll('.mwv4__reply-textarea').forEach(ta => {
        ta.addEventListener('input', () => {
          ta.style.height = 'auto';
          ta.style.height = `${ta.scrollHeight}px`;
          const sendBtn = ta.closest('.mwv4__reply-panel').querySelector('[data-action="send"]');
          sendBtn.disabled = ta.value.trim().length === 0;
        });
        ta.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const sendBtn = ta.closest('.mwv4__reply-panel').querySelector('[data-action="send"]');
            if (!sendBtn.disabled) {
              sendBtn.click();
            }
          }
        });
      });

      // Send reply
      this.container.querySelectorAll('[data-action="send"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const convId = btn.dataset.conversationId;
          const panel = this.container.querySelector(
            `.mwv4__reply-panel[data-reply-for="${convId}"]`
          );
          const ta = panel ? panel.querySelector('.mwv4__reply-textarea') : null;
          if (!ta || !ta.value.trim()) {
            return;
          }

          const message = ta.value.trim();
          btn.disabled = true;
          btn.textContent = 'Sending…';

          // Optimistic UI update
          const item = this.container.querySelector(
            `.mwv4__item[data-conversation-id="${convId}"]`
          );
          const previewEl = item ? item.querySelector('.mwv4__preview') : null;
          const oldPreview = previewEl ? previewEl.textContent : '';
          if (previewEl) {
            previewEl.textContent = truncate(message, 60);
          }

          try {
            await this._sendReply(convId, message);
            ta.value = '';
            ta.style.height = 'auto';
            this._hideQuickReply(convId);
            // Refresh to get server state
            this._fetchConversations();
          } catch (err) {
            console.error('MessengerWidgetV4: send failed', err);
            if (previewEl) {
              previewEl.textContent = oldPreview;
            }
            btn.disabled = false;
            btn.textContent = 'Send';
            const panel2 = this.container.querySelector(
              `.mwv4__reply-panel[data-reply-for="${convId}"]`
            );
            if (panel2) {
              let errEl = panel2.querySelector('.mwv4__reply-error');
              if (!errEl) {
                errEl = document.createElement('p');
                errEl.className = 'mwv4__reply-error';
                panel2.appendChild(errEl);
              }
              errEl.textContent = 'Failed to send. Please try again.';
            }
          }
        });
      });

      // Cancel reply
      this.container.querySelectorAll('[data-action="cancel"]').forEach(btn => {
        btn.addEventListener('click', () => this._hideQuickReply(btn.dataset.conversationId));
      });
    }

    _toggleQuickReply(convId) {
      if (this.activeConversationId && this.activeConversationId !== convId) {
        this._hideQuickReply(this.activeConversationId);
      }
      const panel = this.container.querySelector(`.mwv4__reply-panel[data-reply-for="${convId}"]`);
      if (!panel) {
        // No quick reply panel – navigate directly
        window.location.href = this.options.conversationUrlBuilder(convId);
        return;
      }
      if (panel.hidden) {
        // First click: open quick reply
        panel.hidden = false;
        this.activeConversationId = convId;
        const ta = panel.querySelector('.mwv4__reply-textarea');
        if (ta) {
          ta.focus();
        }
      } else {
        // Second click on already-open panel: navigate to full conversation
        window.location.href = this.options.conversationUrlBuilder(convId);
      }
    }

    _hideQuickReply(convId) {
      const panel = this.container.querySelector(`.mwv4__reply-panel[data-reply-for="${convId}"]`);
      if (panel) {
        panel.hidden = true;
      }
      if (this.activeConversationId === convId) {
        this.activeConversationId = null;
      }
    }
  }

  // Expose globally
  window.MessengerWidgetV4 = MessengerWidgetV4;
})();
