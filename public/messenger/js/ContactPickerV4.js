/**
 * ContactPickerV4 Component
 * Modal for searching and selecting contacts to start a conversation.
 * Features: debounced search, role badges, recent contacts, duplicate detection,
 * and context selection (Direct / Package / Marketplace).
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
    this._selectedContext = 'direct';
    this._recentContacts = this._loadRecentContacts();

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
      <div class="messenger-modal" id="v4ContactPickerModal" role="dialog" aria-modal="true" aria-label="Start a new conversation" style="display:none">
        <div class="messenger-modal__overlay" id="v4ContactPickerOverlay"></div>
        <div class="messenger-modal__content">
          <div class="messenger-modal__header">
            <h2 class="messenger-modal__title">New Conversation</h2>
            <button class="messenger-modal__close" id="v4ContactPickerClose" aria-label="Close contact picker">✕</button>
          </div>

          <div class="messenger-modal__body">
            <!-- Context selector -->
            <div class="messenger-v4__context-selector" role="group" aria-label="Conversation context">
              <button class="messenger-v4__context-option messenger-v4__context-option--active" data-context="direct" aria-pressed="true">💬 Direct</button>
              <button class="messenger-v4__context-option" data-context="package" aria-pressed="false">📦 Package Enquiry</button>
              <button class="messenger-v4__context-option" data-context="marketplace" aria-pressed="false">🛒 Marketplace</button>
            </div>

            <!-- Search input -->
            <div class="messenger-v4__search">
              <span class="messenger-v4__search-icon" aria-hidden="true">🔍</span>
              <input type="search"
                     class="messenger-v4__search-input"
                     id="v4ContactSearch"
                     placeholder="Search by name or email…"
                     aria-label="Search contacts"
                     autocomplete="off" />
            </div>

            <!-- Results area -->
            <div id="v4ContactResults" role="listbox" aria-label="Contact results">
              ${this._buildRecentHTML()}
            </div>
          </div>
        </div>
      </div>`;

    this.modalEl = this.container.querySelector('#v4ContactPickerModal');
    this.searchInput = this.container.querySelector('#v4ContactSearch');
    this.resultsEl = this.container.querySelector('#v4ContactResults');
  }

  attachEventListeners() {
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
        this.resultsEl.innerHTML = this._buildRecentHTML();
        return;
      }
      this.resultsEl.innerHTML =
        '<div class="messenger-v4__skeleton--text messenger-v4__skeleton--long"></div>';
      this._searchTimer = setTimeout(() => this.search(q), 300);
    });

    // Context buttons
    this.container.querySelectorAll('.messenger-v4__context-option').forEach(btn => {
      btn.addEventListener('click', () => {
        this.container.querySelectorAll('.messenger-v4__context-option').forEach(b => {
          b.classList.remove('messenger-v4__context-option--active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('messenger-v4__context-option--active');
        btn.setAttribute('aria-pressed', 'true');
        this._selectedContext = btn.dataset.context;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Open the contact picker modal. */
  open() {
    this.modalEl.style.display = 'flex';
    this.searchInput.value = '';
    this.resultsEl.innerHTML = this._buildRecentHTML();
    this._attachResultListeners();
    document.addEventListener('keydown', this._onKeyDown);
    this.searchInput.focus();
  }

  /** Close the contact picker modal. */
  close() {
    this.modalEl.style.display = 'none';
    document.removeEventListener('keydown', this._onKeyDown);
  }

  /**
   * Search for contacts via the API.
   * @param {string} query
   */
  async search(query) {
    try {
      // For customers, pass role=supplier to the server to avoid fetching unauthorised contacts
      const myRole = this.options.currentUserRole;
      const apiOptions = myRole === 'customer' ? { role: 'supplier' } : {};
      const data = await this.api.getContacts(query, apiOptions);
      // _filterByRole provides client-side enforcement as a defence-in-depth layer
      const contacts = this._filterByRole(data.contacts || data || []);
      this.resultsEl.innerHTML = contacts.length
        ? contacts.map(c => this._buildContactHTML(c)).join('')
        : `<div class="messenger-v4__empty-state" role="status">No contacts found for "${this.escape(query)}"</div>`;
      this._attachResultListeners();
    } catch (err) {
      console.error('[ContactPickerV4] Search failed:', err);
      this.resultsEl.innerHTML =
        '<div class="messenger-v4__empty-state">Search failed. Please try again.</div>';
    }
  }

  /**
   * Select a contact and check for duplicate conversations before creating.
   * @param {Object} user - Contact user object
   */
  async selectContact(user) {
    try {
      // Duplicate conversation detection: check existing conversations
      const existing = await this._findExistingConversation(user._id || user.id);
      if (existing) {
        // Auto-redirect to existing conversation
        this.close();
        window.dispatchEvent(
          new CustomEvent('messenger:conversation-selected', { detail: { id: existing._id } })
        );
        return;
      }
    } catch (err) {
      // Non-fatal: continue to create
      console.warn('[ContactPickerV4] Duplicate check failed:', err);
    }

    // Save to recent contacts
    this._saveRecentContact(user);

    const payload = {
      contact: user,
      context: this._selectedContext,
    };

    if (typeof this.options.onSelect === 'function') {
      this.options.onSelect(payload);
    }

    window.dispatchEvent(new CustomEvent('contactpicker:selected', { detail: payload }));
    this.close();
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
   * Filter contacts based on business rules:
   * - customer → only suppliers
   * - supplier → all (customers + suppliers)
   * @param {Array} contacts
   * @returns {Array}
   */
  _filterByRole(contacts) {
    const myRole = this.options.currentUserRole;
    if (myRole === 'customer') {
      return contacts.filter(c => (c.role || 'customer') === 'supplier');
    }
    return contacts;
  }

  _buildRecentHTML() {
    if (!this._recentContacts.length) {
      return '<div class="messenger-v4__empty-state" role="status">Search for a contact to start a conversation</div>';
    }
    const filtered = this._filterByRole(this._recentContacts.slice(0, 5));
    if (!filtered.length) {
      return '<div class="messenger-v4__empty-state" role="status">Search for a contact to start a conversation</div>';
    }
    const items = filtered.map(c => this._buildContactHTML(c)).join('');
    return `<div class="messenger-v4__recent-label">Recent</div>${items}`;
  }

  _buildContactHTML(user) {
    const name = this.escape(user.displayName || user.name || 'Unknown');
    const email = this.escape(user.email || '');
    const role = user.role || 'customer';
    const initial = (user.displayName || user.name || 'U').charAt(0).toUpperCase();
    const uid = this.escape(user._id || user.id);
    const isOnline = user.isOnline || false;

    return `
      <div class="messenger-v4__contact-item"
           data-user-id="${uid}"
           role="option"
           tabindex="0"
           aria-label="${name}${email ? `, ${email}` : ''}">
        <div class="messenger-v4__avatar-wrapper">
          <div class="messenger-v4__avatar" aria-hidden="true">${this.escape(initial)}</div>
          ${isOnline ? '<span class="messenger-v4__presence-dot messenger-v4__presence-dot--online" aria-label="Online"></span>' : ''}
        </div>
        <div class="messenger-v4__contact-info">
          <span class="messenger-v4__contact-name">${name}</span>
          ${email ? `<span class="messenger-v4__contact-email">${email}</span>` : ''}
        </div>
        <span class="messenger-v4__role-badge messenger-v4__role-badge--${this.escape(role)}" aria-label="Role: ${this.escape(role)}">
          ${this.escape(role.charAt(0).toUpperCase() + role.slice(1))}
        </span>
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
    const email = el.querySelector('.messenger-v4__contact-email')?.textContent || '';
    const roleBadge = el.querySelector('.messenger-v4__role-badge');
    const role = roleBadge ? roleBadge.textContent.trim().toLowerCase() : 'customer';
    this.selectContact({ _id: userId, displayName: name, email, role });
  }

  async _findExistingConversation(participantId) {
    try {
      // Fast path: check already-loaded conversations from the app state.
      // The GET /conversations endpoint has no participantId filter, so we rely on the
      // in-memory state (populated at app init) rather than making an API call that
      // returns up to 50 conversations and silently misses matches on page 2+.
      const appState = window.messengerAppV4?.state ?? window.messengerState ?? null;
      if (appState?.conversations) {
        const found = appState.conversations.find(
          c =>
            Array.isArray(c.participants) &&
            c.participants.some(p => p.userId === participantId) &&
            c.participants.some(p => p.userId === this.options.currentUserId)
        );
        if (found) {
          return found;
        }
      }
      // Slow path: fetch all conversations and search locally
      const data = await this.api.request('/conversations');
      const convs = data.conversations || [];
      return (
        convs.find(c => {
          const ids = (c.participants || []).map(p => p.userId);
          return ids.includes(participantId) && ids.includes(this.options.currentUserId);
        }) || null
      );
    } catch {
      return null;
    }
  }

  _loadRecentContacts() {
    try {
      const raw = localStorage.getItem('messenger_v4_recent_contacts');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  _saveRecentContact(user) {
    const contacts = this._recentContacts.filter(c => (c._id || c.id) !== (user._id || user.id));
    contacts.unshift(user);
    this._recentContacts = contacts.slice(0, 5);
    try {
      localStorage.setItem('messenger_v4_recent_contacts', JSON.stringify(this._recentContacts));
    } catch {
      // localStorage may be unavailable
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
  window.ContactPickerV4 = ContactPickerV4;
}
