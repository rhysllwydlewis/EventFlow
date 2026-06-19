/**
 * ContactPickerV4Safeguards
 *
 * Small post-load guard for the Messenger v4 new-message widget.  It keeps the
 * generic composer supplier-first, blocks cold customer/admin/partner starts,
 * and improves contact display names/avatar fallbacks without rebuilding the
 * existing ContactPickerV4 component.
 */

'use strict';

(function () {
  const SUPPLIER_ROLE = 'supplier';
  const GENERIC_NAME_RE = /^(info|admin|hello|contact|enquiries?|sales|support|office|mail|test)$/i;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const IMAGE_FIELDS = [
    'publicProfileAvatarUrl',
    'profilePhotoUrl',
    'displayAvatarUrl',
    'avatarUrl',
    'avatar',
    'profilePhoto',
    'photoUrl',
    'logo',
    'image',
  ];
  const NAME_FIELDS = [
    'primaryLabel',
    'profileName',
    'supplierName',
    'businessName',
    'companyName',
    'company',
    'tradingName',
    'displayName',
    'name',
  ];

  function roleOf(contact) {
    return String(contact?.role || '').trim().toLowerCase();
  }

  function isSupplier(contact) {
    return roleOf(contact) === SUPPLIER_ROLE;
  }

  function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function looksLikeEmail(value) {
    return EMAIL_RE.test(clean(value));
  }

  function isGenericName(value) {
    const candidate = clean(value);
    if (!candidate) {
      return true;
    }
    if (looksLikeEmail(candidate)) {
      return true;
    }
    return GENERIC_NAME_RE.test(candidate);
  }

  function firstUseful(contact, fields) {
    for (const field of fields) {
      const value = clean(contact?.[field]);
      if (value) {
        return value;
      }
    }
    return '';
  }

  function supplierDisplayName(contact) {
    const businessName = firstUseful(contact, [
      'primaryLabel',
      'profileName',
      'supplierName',
      'businessName',
      'companyName',
      'company',
      'tradingName',
    ]);
    const displayName = firstUseful(contact, ['displayName', 'name']);

    if (businessName && !isGenericName(businessName)) {
      return businessName;
    }
    if (displayName && !isGenericName(displayName)) {
      return displayName;
    }
    if (businessName) {
      return businessName;
    }
    if (displayName) {
      return displayName;
    }
    const email = clean(contact?.email);
    return email ? email.split('@')[0] : 'Supplier';
  }

  function contactDisplayName(contact) {
    if (isSupplier(contact)) {
      return supplierDisplayName(contact);
    }
    return firstUseful(contact, NAME_FIELDS) || 'Existing conversation';
  }

  function contactDetail(contact) {
    if (contact?.secondaryLabel) {
      return clean(contact.secondaryLabel);
    }
    if (isSupplier(contact)) {
      const location = clean(contact.location || contact.town || contact.city || contact.area);
      const category = clean(contact.category || contact.serviceCategory || contact.primaryCategory);
      return [category, location].filter(Boolean).join(' · ') || 'Supplier';
    }
    return contact?.conversationId ? 'Existing conversation' : 'Contact';
  }

  function safeImageUrl(value) {
    const url = clean(value);
    if (!url || /^data:/i.test(url) || /^javascript:/i.test(url) || /^\/\//.test(url)) {
      return '';
    }
    if (url.startsWith('/') && !url.startsWith('//')) {
      return url;
    }
    try {
      const parsed = new URL(url, window.location.origin);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch {
      return '';
    }
  }

  function contactAvatar(contact) {
    for (const field of IMAGE_FIELDS) {
      const url = safeImageUrl(contact?.[field]);
      if (url) {
        return url;
      }
    }
    return '';
  }

  function initialsFrom(name) {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) {
      return 'S';
    }
    if (parts.length === 1) {
      return parts[0].charAt(0).toUpperCase();
    }
    return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
  }

  function patchMessengerApi() {
    const Api = window.MessengerAPI;
    if (!Api || Api.prototype.__contactPickerSafeguardsPatched) {
      return;
    }
    const originalGetContacts = Api.prototype.getContacts;
    Api.prototype.getContacts = function getContacts(searchQuery = '', options = {}) {
      const nextOptions = {
        ...options,
        role: SUPPLIER_ROLE,
        mode: options.mode || 'supplier_search',
      };
      return originalGetContacts.call(this, searchQuery, nextOptions);
    };
    Api.prototype.__contactPickerSafeguardsPatched = true;
  }

  function patchContactPicker() {
    const Picker = window.ContactPickerV4;
    if (!Picker || Picker.prototype.__supplierSafeguardsPatched) {
      return;
    }

    Picker.prototype._filterByRole = function filterByRole(contacts) {
      return (Array.isArray(contacts) ? contacts : []).filter(isSupplier);
    };

    Picker.prototype._filterSelectableContacts = function filterSelectableContacts(contacts) {
      const currentUserId = String(this.options.currentUserId || '');
      return this._filterByRole(contacts).filter(
        contact => String(contact?._id || contact?.id || contact?.userId) !== currentUserId
      );
    };

    Picker.prototype._buildContactHTML = function buildContactHTML(contact) {
      const name = this.escape(contactDisplayName(contact));
      const detail = this.escape(contactDetail(contact));
      const role = roleOf(contact) || 'contact';
      const initial = this.escape(initialsFrom(name));
      const avatarUrl = contactAvatar(contact);
      const avatarHTML = avatarUrl
        ? `<img class="messenger-v4__avatar-image" src="${this.escape(avatarUrl)}" alt="" loading="lazy" decoding="async" />`
        : `<span class="messenger-v4__avatar-initials">${initial}</span>`;
      const uid = this.escape(contact._id || contact.id || contact.userId || '');
      const conversationId = this.escape(contact.conversationId || '');
      const isOnline = Boolean(contact.isOnline);

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
    };

    const originalSelectContact = Picker.prototype.selectContact;
    Picker.prototype.selectContact = async function safeguardedSelectContact(contact) {
      const participantId = contact?._id || contact?.id || contact?.userId;
      const existing = participantId ? await this._findExistingConversation(participantId) : null;
      if (!existing && !isSupplier(contact)) {
        this._showError('Customers can only be opened here from an existing conversation. Search suppliers to start a new message.');
        return;
      }
      return originalSelectContact.call(this, contact);
    };

    const originalSearch = Picker.prototype.search;
    Picker.prototype.search = async function supplierOnlySearch(query) {
      const result = await originalSearch.call(this, query);
      // Defence-in-depth against stale/cached API responses that include customers/admins.
      const contacts = this.resultsEl?.querySelectorAll('.messenger-v4__contact-item') || [];
      contacts.forEach(row => {
        const badge = row.querySelector('.messenger-v4__role-badge');
        const role = String(badge?.textContent || '').trim().toLowerCase();
        if (role && role !== SUPPLIER_ROLE) {
          row.remove();
        }
      });
      if (this.resultsEl && !this.resultsEl.querySelector('.messenger-v4__contact-item')) {
        this.resultsEl.innerHTML = `<div class="messenger-v4__new-message-empty" role="status">No suppliers found for "${this.escape(query)}".</div>`;
      }
      return result;
    };

    Picker.prototype.__supplierSafeguardsPatched = true;
  }

  patchMessengerApi();
  patchContactPicker();
})();
