/**
 * ContactPickerV4Safeguards
 *
 * Keeps the generic Messenger v4 new-message widget supplier-first, blocks cold
 * customer/admin/partner starts, and uses public supplier profile data for
 * names, avatars and profile routing.
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
    'resolvedProfileImageUrl',
    'avatarUrl',
    'avatar',
    'profilePhoto',
    'photoUrl',
    'logoUrl',
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
    'name',
    'displayName',
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
    if (!candidate || looksLikeEmail(candidate)) {
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
    const profileName = firstUseful(contact, [
      'primaryLabel',
      'profileName',
      'supplierName',
      'businessName',
      'companyName',
      'company',
      'tradingName',
      'name',
    ]);
    const accountName = firstUseful(contact, ['displayName']);

    if (profileName && !isGenericName(profileName)) {
      return profileName;
    }
    if (accountName && !isGenericName(accountName)) {
      return accountName;
    }
    return profileName || accountName || 'Supplier';
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
      const category = clean(contact.category || contact.serviceCategory || contact.primaryCategory);
      const location = clean(contact.location || contact.town || contact.city || contact.area);
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

  function supplierOwnerId(supplier) {
    return clean(
      supplier?.ownerUserId ||
        supplier?.messagingRecipientId ||
        supplier?.userId ||
        supplier?.createdByUserId ||
        supplier?.accountId
    );
  }

  function normalizeSupplierProfile(supplier) {
    const userId = supplierOwnerId(supplier);
    const profileId = clean(supplier?.id || supplier?.supplierId || supplier?._id);
    if (!userId || !profileId) {
      return null;
    }
    const displayName = supplierDisplayName({ ...supplier, role: SUPPLIER_ROLE });
    const avatar = contactAvatar(supplier);
    return {
      ...supplier,
      _id: userId,
      id: userId,
      userId,
      role: SUPPLIER_ROLE,
      supplierProfileId: profileId,
      supplierId: profileId,
      primaryLabel: displayName,
      displayName,
      secondaryLabel: contactDetail({ ...supplier, role: SUPPLIER_ROLE }),
      avatar,
      avatarUrl: avatar,
      profileUrl: `/supplier?id=${encodeURIComponent(profileId)}`,
    };
  }

  async function fetchSupplierContacts(query) {
    const params = new URLSearchParams();
    if (query) {
      params.set('q', query);
    }
    const response = await fetch(`/api/suppliers${params.toString() ? `?${params.toString()}` : ''}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error('Supplier search failed');
    }
    const payload = await response.json();
    const suppliers = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
    return suppliers.map(normalizeSupplierProfile).filter(Boolean);
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
      const supplierProfileId = this.escape(contact.supplierProfileId || contact.supplierId || '');
      const profileUrl = this.escape(contact.profileUrl || '');
      const isOnline = Boolean(contact.isOnline);

      return `
        <div class="messenger-v4__new-message-contact messenger-v4__contact-item"
             data-user-id="${uid}"
             ${conversationId ? `data-conversation-id="${conversationId}"` : ''}
             ${supplierProfileId ? `data-supplier-profile-id="${supplierProfileId}"` : ''}
             ${profileUrl ? `data-profile-url="${profileUrl}"` : ''}
             ${avatarUrl ? `data-avatar-url="${this.escape(avatarUrl)}"` : ''}
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

    Picker.prototype._handleContactClick = function handleContactClick(el) {
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
      this.selectContact({
        _id: userId,
        id: userId,
        userId,
        displayName: name,
        primaryLabel: name,
        secondaryLabel,
        role,
        supplierProfileId: el.dataset.supplierProfileId || null,
        supplierId: el.dataset.supplierProfileId || null,
        avatar: el.dataset.avatarUrl || null,
        avatarUrl: el.dataset.avatarUrl || null,
        profileUrl: el.dataset.profileUrl || null,
      });
    };

    Picker.prototype.selectContact = async function safeguardedSelectContact(contact) {
      if (this._isSelecting) {
        return;
      }
      const participantId = contact?._id || contact?.id || contact?.userId;
      if (!participantId) {
        this._showError('That supplier could not be opened. Please choose another supplier.');
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
        if (!isSupplier(contact)) {
          this._showError(
            'Customers can only be opened here from an existing conversation. Search suppliers to start a new message.'
          );
          return;
        }

        const supplierProfileId = clean(contact.supplierProfileId || contact.supplierId);
        const referenceImage = contactAvatar(contact);
        const context = supplierProfileId
          ? {
              type: 'supplier_profile',
              referenceId: supplierProfileId,
              referenceTitle: contactDisplayName(contact),
              referenceImage,
            }
          : 'direct';
        const metadata = {
          source: 'generic_new_message',
          ...(supplierProfileId ? { supplierProfileId } : {}),
        };

        if (window.messengerAppV4?.createConversation) {
          await window.messengerAppV4.createConversation([participantId], context, {
            throwOnError: true,
            metadata,
          });
        } else if (typeof this.options.onSelect === 'function') {
          await this.options.onSelect({ contact, context, metadata });
        } else {
          window.dispatchEvent(
            new CustomEvent('contactpicker:selected', { detail: { contact, context, metadata } })
          );
        }
        this.close();
      } catch (err) {
        console.error('[ContactPickerV4] Conversation start failed:', err);
        this._showError(this._friendlyError(err));
      } finally {
        this._isSelecting = false;
        this._setContactPending(participantId, false);
      }
    };

    Picker.prototype.search = async function supplierOnlySearch(query) {
      try {
        const contacts = this._filterSelectableContacts(await fetchSupplierContacts(query));
        this.resultsEl.innerHTML = contacts.length
          ? contacts.map(contact => this._buildContactHTML(contact)).join('')
          : `<div class="messenger-v4__new-message-empty" role="status">No suppliers found for "${this.escape(query)}".</div>`;
        this._attachResultListeners();
      } catch (err) {
        console.error('[ContactPickerV4] Supplier search failed:', err);
        this._showError(
          'We could not search suppliers right now. Please check your connection and try again.'
        );
        this.resultsEl.innerHTML =
          '<div class="messenger-v4__new-message-empty" role="status">Supplier search is temporarily unavailable.</div>';
      }
    };

    Picker.prototype.__supplierSafeguardsPatched = true;
  }

  patchContactPicker();
})();
