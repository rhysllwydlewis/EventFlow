/**
 * ContactPickerV4 Component
 * Liquid-glass widget for searching and selecting contacts to start a conversation.
 * Features: debounced search, role badges, recent contacts, duplicate detection,
 * direct-message creation, and accessible dialog controls.
 * BEM prefix: messenger-v4__ / messenger-modal
 */

'use strict';

class ContactPickerV4 {
  constructor(container, api, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.api = api;
    this.options = {
      onSelect: null,
      currentUserId: null,
      currentUserRole: null,
      ...options,
    };

    this._searchTimer = null;
    this._isOpen = false;
    this._isSelecting = false;
    this._returnFocusEl = null;

    // Bound handlers
    this._onKeyDown = this._onKeyDown.bind(this);

    this.init();
  }

  init() {
    this.render();
    this.attachEventListeners();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render() {
    this.container.innerHTML = `
      <div class="messenger-v4__new-message-popout" id="v4ContactPickerModal" role="dialog" aria-modal="true" aria-labelledby="v4ContactPickerTitle" aria-describedby="v4ContactPickerDescription" hidden>
        <div class="messenger-v4__new-message-scrim" id="v4ContactPickerOverlay" aria-hidden="true"></div>
        <section class="messenger-v4__new-message-card" aria-live="polite">
          <div class="messenger-v4__new-message-header">
            <div>
              <p class="messenger-v4__new-message-kicker">Direct message</p>
              <h2 class="messenger-v4__new-message-title" id="v4ContactPickerTitle">New message</h2>
              <p class="messenger-v4__new-message-subtitle" id="v4ContactPickerDescription">Search suppliers to start a new message. Recent conversations show people you have already spoken to.</p>
            </div>
            <button class="ef-cta messenger-v4__new-message-close" id="v4ContactPickerClose" type="button" aria-label="Close new message picker">✕</button>
          </div>

          <div class="messenger-v4__new-message-error" id="v4ContactPickerError" role="alert" hidden></div>

          <label class="messenger-v4__new-message-search" for="v4ContactSearch">
            <span class="messenger-v4__new-message-search-icon" aria-hidden="true">🔍</span>
            <input type="search"
                   id="v4ContactSearch"
                   placeholder="Search suppliers by business name..."
                   aria-label="Search suppliers"
                   autocomplete="off" />
          </label>

          <div class="messenger-v4__new-message-results" id="v4ContactResults" role="listbox" aria-label="Contact results">
            ${this._buildRecentHTML()}
          </div>
        </section>
      </div>`;

    this.modalEl = this.container.querySelector('#v4ContactPickerModal');
    this.searchInput = this.container.querySelector('#v4ContactSearch');
    this.resultsEl = this.container.querySelector('#v4ContactResults');
    this.errorEl = this.container.querySelector('#v4ContactPickerError');
  }

  attachEventListeners() {
    if (this._listenersAttached) {
      return;
    }
    this._listenersAttached = true;
    // Close handlers
    this.container
      .querySelector('#v4ContactPickerClose')
      .addEventListener('click', () => this.close());
    this.container
      .querySelector('#v4ContactPickerOverlay')
      .addEventListener('click', () => this.close());

    // Search with 300 ms debounce
    this.searchInput.addEventListener('input', e => {
      clearTimeout(this._searchTimer);
      const q = e.target.value.trim();
      if (!q) {
        this._clearError();
        this.resultsEl.innerHTML = this._buildRecentHTML();
        this._attachResultListeners();
        return;
      }
      this.resultsEl.innerHTML =
        '<div class="messenger-v4__skeleton--text messenger-v4__skeleton--long"></div>';
      this._searchTimer = setTimeout(() => this.search(q), 300);
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Open the contact picker modal. */
  open(triggerEl = null) {
    if (this._isOpen) {
      this.searchInput.focus();
      return;
    }
    this._isOpen = true;
    this._returnFocusEl = triggerEl || document.activeElement;
    this.modalEl.hidden = false;
    this.modalEl.classList.add('messenger-v4__new-message-popout--open');
    this.searchInput.value = '';
    this._isSelecting = false;
    this._clearError();
    this.resultsEl.innerHTML = this._buildRecentHTML();
    this._attachResultListeners();
    document.addEventListener('keydown', this._onKeyDown);
    window.requestAnimationFrame(() => this.searchInput.focus());
  }

  /** Close the contact picker modal. */
  close() {
    if (!this._isOpen) {
      return;
    }
    this._isOpen = false;
    this.modalEl.classList.remove('messenger-v4__new-message-popout--open');
    this.modalEl.hidden = true;
    this._isSelecting = false;
    document.removeEventListener('keydown', this._onKeyDown);
    if (this._returnFocusEl && typeof this._returnFocusEl.focus === 'function') {
      this._returnFocusEl.focus();
    }
  }

  /**
   * Search for contacts via the API.
   * @param {string} query
   */
  async search(query) {
    try {
      // Generic new-message search is supplier-only; recent conversations cover existing customers.
      const data = await this.api.getContacts(query, { role: 'supplier', mode: 'supplier_search' });
      // _filterByRole provides client-side enforcement as a defence-in-depth layer
      const contacts = this._filterSelectableContacts(data.contacts || data || []);
      this.resultsEl.innerHTML = contacts.length
        ? contacts.map(c => this._buildContactHTML(c)).join('')
        : `<div class="messenger-v4__new-message-empty" role="status">No suppliers found for "${this.escape(query)}".</div>`;
      this._attachResultListeners();
    } catch (err) {
      console.error('[ContactPickerV4] Search failed:', err);
      this._showError(
        'We could not search contacts right now. Please check your connection and try again.'
      );
      this.resultsEl.innerHTML =
        '<div class="messenger-v4__new-message-empty" role="status">Search is temporarily unavailable.</div>';
    }
  }

  /**
   * Select a contact and check for duplicate conversations before creating.
   * @param {Object} user - Contact user object
   */
  async selectContact(user) {
    if (this._isSelecting) {
      return;
    }
    const participantId = user?._id || user?.id;
    if (!participantId) {
      this._showError('That contact could not be opened. Please try another contact.');
      return;
    }
    if (String(participantId) === String(this.options.currentUserId)) {
      this._showError('You cannot start a conversation with yourself.');
      return;
    }

    this._isSelecting = true;
    this._clearError();
    this._setContactPending(participantId, true);

    try {
      const existing = await this._findExistingConversation(participantId);
      if (existing) {
        this.close();
        window.dispatchEvent(
          new CustomEvent('messenger:conversation-selected', { detail: { id: existing._id } })
        );
        return;
      }

      if ((user.role || '').toLowerCase() !== 'supplier') {
        this._showError('Customers can only be opened here from an existing conversation.');
        return;
      }

      const payload = {
        contact: user,
        context: 'direct',
        metadata: { source: 'generic_new_message' },
      };

      if (typeof this.options.onSelect === 'function') {
        await this.options.onSelect(payload);
      } else {
        window.dispatchEvent(new CustomEvent('contactpicker:selected', { detail: payload }));
      }
      this.close();
    } catch (err) {
      console.error('[ContactPickerV4] Conversation start failed:', err);
      this._showError(this._friendlyError(err));
    } finally {
      this._isSelecting = false;
      this._setContactPending(participantId, false);
    }
  }

  /** Remove all listeners and clear DOM. */
  destroy() {
    clearTimeout(this._searchTimer);
    document.removeEventListener('keydown', this._onKeyDown);
    this.container.innerHTML = '';
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      this.close();
    }
  }

  /**
   * Generic new-message search is supplier-only. Customers are shown only
   * through recent conversations that are backed by an existing thread.
   * @param {Array} contacts
   * @returns {Array}
   */
  _filterByRole(contacts) {
    return contacts.filter(c => (c.role || '').toLowerCase() === 'supplier');
  }

  _filterSelectableContacts(contacts) {
    const currentUserId = this.options.currentUserId;
    return this._filterByRole(contacts).filter(
      c => String(c._id || c.id || c.userId) !== String(currentUserId)
    );
  }

  _buildRecentHTML() {
    const recent = this._getRecentConversationContacts().slice(0, 5);
    if (!recent.length) {
      return '<div class="messenger-v4__recent-label">Recent conversations</div><div class="messenger-v4__new-message-empty" role="status">People you have already spoken to will appear here.</div>';
    }
    const items = recent.map(c => this._buildContactHTML(c)).join('');
    return `<div class="messenger-v4__recent-label">Recent conversations</div>${items}`;
  }

  _getRecentConversationContacts() {
    const currentUserId = String(this.options.currentUserId || '');
    const appState = window.messengerAppV4?.state ?? window.messengerState ?? null;
    const conversations = Array.isArray(appState?.conversations) ? appState.conversations : [];
    return conversations
      .filter(c => c?.type === 'direct' && Array.isArray(c.participants))
      .map(c => {
        const other = c.participants.find(p => String(p.userId || p.id) !== currentUserId);
        if (!other) {
          return null;
        }
        return {
          _id: other.userId || other.id,
          id: other.userId || other.id,
          displayName: other.primaryLabel || other.displayName || other.name,
          primaryLabel: other.primaryLabel || other.displayName || other.name,
          secondaryLabel: other.secondaryLabel || 'Existing conversation',
          role: other.role || 'customer',
          avatar: other.avatar || other.avatarUrl || null,
          conversationId: c._id,
        };
      })
      .filter(Boolean);
  }

  _buildContactHTML(user) {
    const name = this.escape(user.primaryLabel || user.displayName || user.name || 'Unknown');
    const detail = this.escape(
      user.secondaryLabel || (user.role === 'supplier' ? 'Supplier' : 'Existing conversation')
    );
    const role = user.role || 'customer';
    const initial = (user.primaryLabel || user.displayName || user.name || 'U')
      .charAt(0)
      .toUpperCase();
    const avatarUrl = this._safeImageUrl(user.avatar || user.avatarUrl || user.profilePhoto || '');
    const avatarHTML = avatarUrl
      ? `<img class="messenger-v4__avatar-image" src="${this.escape(avatarUrl)}" alt="" loading="lazy" decoding="async" />`
      : this.escape(initial);
    const uid = this.escape(user._id || user.id || user.userId);
    const conversationId = this.escape(user.conversationId || '');
    const isOnline = user.isOnline || false;

    return `
      <div class="messenger-v4__new-message-contact messenger-v4__contact-item"
           data-user-id="${uid}"
           ${conversationId ? `data-conversation-id="${conversationId}"` : ''}
           role="option"
           tabindex="0"
           aria-label="${name}${detail ? `, ${detail}` : ''}">
        <div class="messenger-v4__avatar-wrapper">
          <div class="messenger-v4__avatar" aria-hidden="true">${avatarHTML}</div>
          ${isOnline ? '<span class="messenger-v4__presence-dot messenger-v4__presence-dot--online" aria-label="Online"></span>' : ''}
        </div>
        <div class="messenger-v4__contact-info">
          <span class="messenger-v4__contact-name">${name}</span>
          ${detail ? `<span class="messenger-v4__contact-email">${detail}</span>` : ''}
        </div>
        <span class="messenger-v4__role-badge messenger-v4__role-badge--${this.escape(role)}" aria-label="Role: ${this.escape(role)}">
          ${this.escape(role.charAt(0).toUpperCase() + role.slice(1))}
        </span>
        <span class="messenger-v4__new-message-contact-status">Direct</span>
      </div>`;
  }

  _attachResultListeners() {
    this.resultsEl.querySelectorAll('.messenger-v4__contact-item').forEach(el => {
      el.addEventListener('click', () => this._handleContactClick(el));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._handleContactClick(el);
        }
      });
    });
  }

  _handleContactClick(el) {
    // Reconstruct minimal user object from DOM for simplicity
    const userId = el.dataset.userId;
    const name = el.querySelector('.messenger-v4__contact-name')?.textContent || '';
    const secondaryLabel = el.querySelector('.messenger-v4__contact-email')?.textContent || '';
    const roleBadge = el.querySelector('.messenger-v4__role-badge');
    const role = roleBadge ? roleBadge.textContent.trim().toLowerCase() : 'customer';
    const conversationId = el.dataset.conversationId || null;
    if (conversationId) {
      this.close();
      window.dispatchEvent(
        new CustomEvent('messenger:conversation-selected', { detail: { id: conversationId } })
      );
      return;
    }
    this.selectContact({ _id: userId, displayName: name, secondaryLabel, role });
  }

  async _findExistingConversation(participantId) {
    try {
      // Fast path: check already-loaded conversations from the app state.
      // The GET /conversations endpoint has no participantId filter, so we rely on the
      // in-memory state (populated at app init) rather than making an API call that
      // returns up to 50 conversations and silently misses matches on page 2+.
      const appState = window.messengerAppV4?.state ?? window.messengerState ?? null;
      if (appState?.conversations) {
        const found = appState.conversations.find(c =>
          this._isDirectConversationWithParticipant(c, participantId)
        );
        if (found) {
          return found;
        }
      }
      // Slow path: fetch all conversations and search locally
      const data = await this.api.request('/conversations');
      const convs = data.conversations || [];
      return convs.find(c => this._isDirectConversationWithParticipant(c, participantId)) || null;
    } catch {
      return null;
    }
  }

  _isDirectConversationWithParticipant(conversation, participantId) {
    if (!conversation || conversation.type !== 'direct') {
      return false;
    }
    const ids = (conversation.participants || []).map(p => String(p.userId));
    return ids.includes(String(participantId)) && ids.includes(String(this.options.currentUserId));
  }

  _setContactPending(participantId, isPending) {
    const el = this.resultsEl.querySelector(`[data-user-id="${this._cssEscape(participantId)}"]`);
    if (!el) {
      return;
    }
    el.classList.toggle('messenger-v4__new-message-contact--pending', isPending);
    el.setAttribute('aria-disabled', isPending ? 'true' : 'false');
    const status = el.querySelector('.messenger-v4__new-message-contact-status');
    if (status) {
      status.textContent = isPending ? 'Opening…' : 'Direct';
    }
  }

  _showError(message) {
    this.errorEl.textContent = message;
    this.errorEl.hidden = false;
  }

  _clearError() {
    if (!this.errorEl) {
      return;
    }
    this.errorEl.textContent = '';
    this.errorEl.hidden = true;
  }

  _friendlyError(err) {
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('limit') || msg.includes('rate')) {
      return 'You have reached a messaging limit. Please wait a moment and try again.';
    }
    if (msg.includes('invalid') || msg.includes('participant') || msg.includes('self')) {
      return 'That contact cannot be messaged from here. Please choose another contact.';
    }
    if (msg.includes('network') || msg.includes('fetch')) {
      return 'Network trouble stopped us opening that conversation. Please try again.';
    }
    return 'We could not start that conversation. Please try again.';
  }

  _safeImageUrl(url) {
    if (!url || typeof url !== 'string') {
      return '';
    }
    const trimmed = url.trim();
    if (!trimmed) {
      return '';
    }
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
      return trimmed;
    }
    try {
      const parsed = new URL(trimmed, window.location.origin);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch {
      return '';
    }
  }

  _cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
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
  window.ContactPickerV4 = ContactPickerV4;
}
