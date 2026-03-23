/**
 * Public Calendar Page — Client Initialisation
 *
 * Handles:
 *  - Loading and rendering public calendar events
 *  - Filtering (category, location, date range)
 *  - Publisher UX: Add / Edit / Delete own events
 *  - Customer UX: Save / unsave events to dashboard calendar
 */
(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  let currentUser = null; // populated after /api/v1/auth/me
  let supplierDoc = null; // populated if user is a supplier publisher
  let isAdmin = false;
  let isPublisher = false;

  const PAGE_SIZE = 20;
  let currentOffset = 0;
  let totalEvents = 0;
  let currentFilters = {};

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(str) {
    if (!str) {
      return '';
    }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    if (!iso) {
      return '';
    }
    try {
      return new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (_) {
      return iso;
    }
  }

  async function apiFetch(url, options = {}) {
    const csrfToken =
      document.cookie
        .split('; ')
        .find(r => r.startsWith('csrfToken='))
        ?.split('=')[1] || '';

    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    const res = await fetch(url, { credentials: 'include', ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error(data.message || data.error || 'Request failed'), {
        status: res.status,
        data,
      });
    }
    return data;
  }

  // ── Auth check ────────────────────────────────────────────────────────────
  async function loadCurrentUser() {
    try {
      const data = await apiFetch('/api/v1/auth/me');
      currentUser = data.user || data;
      isAdmin = currentUser.role === 'admin';

      if (currentUser.role === 'supplier') {
        await loadSupplierDoc();
      }

      // Show publisher banner
      if (isAdmin || isPublisher) {
        const banner = document.getElementById('pc-publisher-banner');
        if (banner) {
          banner.style.display = '';
        }
      }
    } catch (_) {
      // not logged in — read-only view
    }
  }

  async function loadSupplierDoc() {
    try {
      const data = await apiFetch('/api/v1/me/suppliers/profile');
      supplierDoc = data.supplier || data;
    } catch (_) {
      // try alternate endpoint
      try {
        const data = await apiFetch('/api/me/suppliers');
        const list = data.suppliers || data;
        if (Array.isArray(list) && list.length) {
          supplierDoc = list[0];
        }
      } catch (__) {
        /* ignore */
      }
    }

    if (supplierDoc) {
      const override = supplierDoc.publicCalendarPublisherOverride;
      const publisherCategories = ['Event Planner', 'Wedding Fayre'];
      if (override === true) {
        isPublisher = true;
      } else if (override === false) {
        isPublisher = false;
      } else {
        isPublisher = publisherCategories.includes(supplierDoc.category || '');
      }
    }
  }

  // ── Render events ─────────────────────────────────────────────────────────
  function renderEvents(events) {
    // Hide loading skeleton
    const skeleton = document.getElementById('pc-loading-skeleton');
    if (skeleton) {
      skeleton.style.display = 'none';
    }

    const list = document.getElementById('pc-events-list');
    if (!list) {
      return;
    }

    const countEl = document.getElementById('pc-results-count');
    if (countEl) {
      countEl.innerHTML =
        totalEvents > 0
          ? `<strong>${totalEvents}</strong> event${totalEvents !== 1 ? 's' : ''} found`
          : '';
    }

    if (!events.length) {
      list.innerHTML = `
        <div class="pc-events-grid" style="display:block;">
          <div class="pc-empty">
            <span class="pc-empty__icon">📅</span>
            <p class="pc-empty__title">No events found</p>
            <p class="pc-empty__text">Try adjusting your filters, or check back soon for upcoming events.</p>
            ${isAdmin || isPublisher ? `<button class="pc-btn pc-btn-primary" id="pc-empty-add-btn" style="margin-top:1rem;" type="button">+ Add the first event</button>` : ''}
          </div>
        </div>`;
      document.getElementById('pc-empty-add-btn')?.addEventListener('click', openAddModal);
      return;
    }

    list.innerHTML = `<div class="pc-events-grid">${events.map(ev => renderEventCard(ev)).join('')}</div>`;

    // Wire up action buttons
    list.querySelectorAll('[data-action="save"]').forEach(btn => {
      btn.addEventListener('click', () => handleSave(btn.dataset.id, btn));
    });
    list.querySelectorAll('[data-action="unsave"]').forEach(btn => {
      btn.addEventListener('click', () => handleUnsave(btn.dataset.id, btn));
    });
    list.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });
    list.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => handleDelete(btn.dataset.id, btn.dataset.title));
    });
  }

  function renderEventCard(ev) {
    const canEdit =
      isAdmin || (isPublisher && ev.createdByUserId === (currentUser && currentUser.id));
    const isLoggedIn = !!currentUser;

    const saveBtn = isLoggedIn
      ? ev.savedByMe
        ? `<button class="pc-btn pc-btn-sm pc-btn-saved" data-action="unsave" data-id="${esc(ev.id)}" title="Remove from my calendar">✓ Saved</button>`
        : `<button class="pc-btn pc-btn-sm pc-btn-save" data-action="save" data-id="${esc(ev.id)}">+ Save to calendar</button>`
      : '';

    const editBtns = canEdit
      ? `<button class="pc-btn pc-btn-sm pc-btn-outline-green" data-action="edit" data-id="${esc(ev.id)}">Edit</button>
         <button class="pc-btn pc-btn-sm pc-btn-danger" data-action="delete" data-id="${esc(ev.id)}" data-title="${esc(ev.title)}">Delete</button>`
      : '';

    const imgSection = ev.imageUrl
      ? `<img class="pc-event-card__img" src="${esc(ev.imageUrl)}" alt="" loading="lazy" />`
      : `<div class="pc-event-card__img-placeholder">${getCategoryEmoji(ev.category)}</div>`;

    const externalLink = ev.externalUrl
      ? `<a href="${esc(ev.externalUrl)}" target="_blank" rel="noopener noreferrer" class="pc-btn pc-btn-sm pc-btn-ghost">More info ↗</a>`
      : '';

    const categoryBadge = ev.category
      ? `<span class="pc-event-card__category">${esc(ev.category)}</span>`
      : '';

    const dateStr = formatDate(ev.startDate);
    const endDateStr = ev.endDate ? ` – ${formatDate(ev.endDate)}` : '';

    return `
      <article class="pc-event-card">
        ${imgSection}
        <div class="pc-event-card__body">
          ${categoryBadge}
          <h3 class="pc-event-card__title">${esc(ev.title)}</h3>
          <div class="pc-event-card__meta">
            <span class="pc-event-card__meta-row">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              ${esc(dateStr)}${esc(endDateStr)}
            </span>
            ${
              ev.location
                ? `<span class="pc-event-card__meta-row">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              ${esc(ev.location)}
            </span>`
                : ''
            }
          </div>
          ${ev.description ? `<p class="pc-event-card__description">${esc(ev.description)}</p>` : ''}
          <div class="pc-event-card__actions">
            ${saveBtn}${externalLink}${editBtns}
          </div>
        </div>
      </article>`;
  }

  function getCategoryEmoji(category) {
    const map = {
      Venues: '🏛️',
      Catering: '🍽️',
      Photography: '📸',
      Videography: '🎥',
      Entertainment: '🎭',
      'Music/DJ': '🎵',
      Florist: '🌸',
      Decor: '✨',
      Transport: '🚗',
      Cake: '🎂',
      Stationery: '📝',
      'Hair & Makeup': '💄',
      Beauty: '💅',
      Bridalwear: '👗',
      Jewellery: '💍',
      Celebrant: '🎓',
      'Event Planner': '📋',
      'Wedding Fayre': '💒',
      Planning: '🗓️',
      Other: '⭐',
    };
    return map[category] || '📅';
  }

  function renderPagination() {
    const container = document.getElementById('pc-pagination');
    if (!container) {
      return;
    }

    const pages = Math.ceil(totalEvents / PAGE_SIZE);
    const currentPage = Math.floor(currentOffset / PAGE_SIZE);

    if (pages <= 1) {
      container.innerHTML = '';
      return;
    }

    let html = '';
    if (currentPage > 0) {
      html += `<button class="pc-btn pc-btn-ghost" id="pc-prev-btn">← Previous</button>`;
    }
    html += `<span style="align-self:center;font-size:0.9rem;color:#6b7280;">Page ${currentPage + 1} of ${pages}</span>`;
    if (currentPage < pages - 1) {
      html += `<button class="pc-btn pc-btn-ghost" id="pc-next-btn">Next →</button>`;
    }
    container.innerHTML = html;

    const prev = document.getElementById('pc-prev-btn');
    const next = document.getElementById('pc-next-btn');
    if (prev) {
      prev.addEventListener('click', () => {
        currentOffset -= PAGE_SIZE;
        loadEvents();
      });
    }
    if (next) {
      next.addEventListener('click', () => {
        currentOffset += PAGE_SIZE;
        loadEvents();
      });
    }
  }

  // ── Load events ───────────────────────────────────────────────────────────
  async function loadEvents() {
    // Show loading skeleton
    const skeleton = document.getElementById('pc-loading-skeleton');
    if (skeleton) {
      skeleton.style.display = '';
    }
    const list = document.getElementById('pc-events-list');
    if (list) {
      list.innerHTML = '';
    }

    try {
      const params = new URLSearchParams({
        limit: PAGE_SIZE,
        offset: currentOffset,
        ...currentFilters,
      });
      // Remove empty filter values (collect keys first, then delete)
      const keysToDelete = [...params.entries()].filter(([, v]) => !v).map(([k]) => k);
      keysToDelete.forEach(k => params.delete(k));

      const data = await apiFetch(`/api/v1/public-calendar/events?${params}`);
      totalEvents = data.total || 0;
      renderEvents(data.events || []);
      renderPagination();
    } catch (err) {
      if (skeleton) {
        skeleton.style.display = 'none';
      }
      if (list) {
        list.innerHTML =
          '<p style="color:#dc2626;padding:2rem;text-align:center;">Failed to load events. Please try again.</p>';
      }
    }
  }

  // ── Save / unsave ─────────────────────────────────────────────────────────
  async function handleSave(eventId, btn) {
    if (!currentUser) {
      window.location.href = `/auth?redirect=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    try {
      btn.disabled = true;
      await apiFetch(`/api/v1/public-calendar/events/${eventId}/save`, {
        method: 'POST',
        body: '{}',
      });
      btn.outerHTML = `<button class="pc-btn pc-btn-sm pc-btn-saved" data-action="unsave" data-id="${esc(eventId)}" title="Remove from my calendar">✓ Saved</button>`;
      rewireButtons();
    } catch (e) {
      btn.disabled = false;
      showToast(e.data?.message || 'Failed to save event', 'error');
    }
  }

  async function handleUnsave(eventId, btn) {
    try {
      btn.disabled = true;
      await apiFetch(`/api/v1/public-calendar/events/${eventId}/save`, {
        method: 'DELETE',
        body: '{}',
      });
      btn.outerHTML = `<button class="pc-btn pc-btn-sm pc-btn-save" data-action="save" data-id="${esc(eventId)}">+ Save to calendar</button>`;
      rewireButtons();
    } catch (e) {
      btn.disabled = false;
      showToast('Failed to remove event', 'error');
    }
  }

  function rewireButtons() {
    const list = document.getElementById('pc-events-list');
    if (!list) {
      return;
    }
    list.querySelectorAll('[data-action="save"]').forEach(btn => {
      btn.addEventListener('click', () => handleSave(btn.dataset.id, btn));
    });
    list.querySelectorAll('[data-action="unsave"]').forEach(btn => {
      btn.addEventListener('click', () => handleUnsave(btn.dataset.id, btn));
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete(eventId, title) {
    if (!confirm(`Delete event "${title}"? This cannot be undone.`)) {
      return;
    }
    try {
      await apiFetch(`/api/v1/public-calendar/events/${eventId}`, { method: 'DELETE', body: '{}' });
      showToast('Event deleted', 'success');
      loadEvents();
    } catch (e) {
      showToast(e.data?.message || 'Failed to delete event', 'error');
    }
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  let editingEventId = null;

  function openAddModal() {
    editingEventId = null;
    document.getElementById('pc-modal-title').textContent = 'Add Event';
    document.getElementById('pc-modal-submit').textContent = 'Publish';
    document.getElementById('pc-event-form').reset();
    document.getElementById('pc-form-id').value = '';
    document.getElementById('pc-form-error').style.display = 'none';
    showModal();
  }

  async function openEditModal(eventId) {
    try {
      const data = await apiFetch(`/api/v1/public-calendar/events/${eventId}`);
      const ev = data.event;
      editingEventId = eventId;

      document.getElementById('pc-modal-title').textContent = 'Edit Event';
      document.getElementById('pc-modal-submit').textContent = 'Save changes';
      document.getElementById('pc-form-id').value = ev.id;
      document.getElementById('pc-form-title').value = ev.title || '';
      document.getElementById('pc-form-start').value = (ev.startDate || '').slice(0, 16);
      document.getElementById('pc-form-end').value = (ev.endDate || '').slice(0, 16);
      document.getElementById('pc-form-location').value = ev.location || '';
      document.getElementById('pc-form-category').value = ev.category || '';
      document.getElementById('pc-form-description').value = ev.description || '';
      document.getElementById('pc-form-image').value = ev.imageUrl || '';
      document.getElementById('pc-form-external').value = ev.externalUrl || '';
      document.getElementById('pc-form-error').style.display = 'none';
      showModal();
    } catch (e) {
      showToast('Failed to load event details', 'error');
    }
  }

  function showModal() {
    const overlay = document.getElementById('pc-modal-overlay');
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    document.getElementById('pc-form-title').focus();
  }

  function closeModal() {
    const overlay = document.getElementById('pc-modal-overlay');
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    const errorEl = document.getElementById('pc-form-error');
    errorEl.style.display = 'none';

    const body = {
      title: document.getElementById('pc-form-title').value,
      startDate: document.getElementById('pc-form-start').value,
      endDate: document.getElementById('pc-form-end').value || undefined,
      location: document.getElementById('pc-form-location').value,
      category: document.getElementById('pc-form-category').value,
      description: document.getElementById('pc-form-description').value,
      imageUrl: document.getElementById('pc-form-image').value,
      externalUrl: document.getElementById('pc-form-external').value,
    };

    const submitBtn = document.getElementById('pc-modal-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      if (editingEventId) {
        await apiFetch(`/api/v1/public-calendar/events/${editingEventId}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        showToast('Event updated', 'success');
      } else {
        await apiFetch('/api/v1/public-calendar/events', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        showToast('Event published', 'success');
      }
      closeModal();
      currentOffset = 0;
      loadEvents();
    } catch (err) {
      const msgs = err.data?.details || [err.message || 'Failed to save event'];
      errorEl.textContent = Array.isArray(msgs) ? msgs.join(' · ') : msgs;
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = editingEventId ? 'Save changes' : 'Publish';
    }
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(message, type) {
    // Try the shared notification system if available
    if (window.NotificationSystem && window.NotificationSystem.show) {
      window.NotificationSystem.show(message, type);
      return;
    }
    // Simple fallback
    const div = document.createElement('div');
    div.textContent = message;
    div.style.cssText = `position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;padding:0.75rem 1.25rem;border-radius:0.5rem;color:#fff;font-weight:600;background:${type === 'error' ? '#dc2626' : '#16a34a'};`;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3500);
  }

  // ── Filter handlers ───────────────────────────────────────────────────────
  function applyFilters() {
    currentFilters = {
      category: (document.getElementById('pc-filter-category').value || '').trim(),
      location: (document.getElementById('pc-filter-location').value || '').trim(),
      startDate: document.getElementById('pc-filter-from').value,
      endDate: document.getElementById('pc-filter-to').value,
    };
    currentOffset = 0;
    loadEvents();
  }

  function clearFilters() {
    document.getElementById('pc-filter-category').value = '';
    document.getElementById('pc-filter-location').value = '';
    document.getElementById('pc-filter-from').value = '';
    document.getElementById('pc-filter-to').value = '';
    currentFilters = {};
    currentOffset = 0;
    loadEvents();
  }

  // ── Initialise ────────────────────────────────────────────────────────────
  async function init() {
    await loadCurrentUser();
    await loadEvents();

    // Filter controls
    document.getElementById('pc-filter-btn').addEventListener('click', applyFilters);
    document.getElementById('pc-filter-clear-btn').addEventListener('click', clearFilters);
    ['pc-filter-category', 'pc-filter-location', 'pc-filter-from', 'pc-filter-to'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            applyFilters();
          }
        });
      }
    });

    // Add event button
    const addBtn = document.getElementById('pc-add-event-btn');
    if (addBtn) {
      addBtn.addEventListener('click', openAddModal);
    }

    // Modal cancel / overlay click
    document.getElementById('pc-modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('pc-modal-close-btn')?.addEventListener('click', closeModal);
    document.getElementById('pc-modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('pc-modal-overlay')) {
        closeModal();
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeModal();
      }
    });

    // Form submit
    document.getElementById('pc-event-form').addEventListener('submit', handleFormSubmit);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
