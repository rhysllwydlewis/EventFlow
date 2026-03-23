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

      // Show/hide publisher controls
      if (isAdmin || isPublisher) {
        const btn = document.getElementById('pc-add-event-btn');
        if (btn) {
          btn.style.display = '';
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
    const list = document.getElementById('pc-events-list');
    if (!list) {
      return;
    }

    if (!events.length) {
      list.innerHTML =
        '<p style="color:var(--color-text-muted,#6b7280);">No events found matching your filters.</p>';
      return;
    }

    list.innerHTML = events.map(ev => renderEventCard(ev)).join('');

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
        ? `<button class="btn btn-small btn-secondary" data-action="unsave" data-id="${esc(ev.id)}" title="Remove from my calendar">✓ Saved</button>`
        : `<button class="btn btn-small btn-primary" data-action="save" data-id="${esc(ev.id)}">+ Save to my calendar</button>`
      : '';

    const editBtns = canEdit
      ? `<button class="btn btn-small btn-ghost" data-action="edit" data-id="${esc(ev.id)}" style="margin-left:0.25rem;">Edit</button>
         <button class="btn btn-small btn-danger" data-action="delete" data-id="${esc(ev.id)}" data-title="${esc(ev.title)}" style="margin-left:0.25rem;">Delete</button>`
      : '';

    const img = ev.imageUrl
      ? `<img src="${esc(ev.imageUrl)}" alt="" style="width:100%;height:160px;object-fit:cover;border-radius:0.5rem 0.5rem 0 0;" loading="lazy" />`
      : '';

    const externalLink = ev.externalUrl
      ? `<a href="${esc(ev.externalUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-small btn-ghost" style="margin-left:0.25rem;">More info ↗</a>`
      : '';

    return `
      <div class="card" style="margin-bottom:1rem;overflow:hidden;">
        ${img}
        <div style="padding:1rem;">
          <h3 style="margin:0 0 0.25rem;font-size:1.1rem;">${esc(ev.title)}</h3>
          <p style="margin:0 0 0.5rem;font-size:0.85rem;color:var(--color-text-muted,#6b7280);">
            📅 ${esc(formatDate(ev.startDate))}
            ${ev.endDate ? ` – ${esc(formatDate(ev.endDate))}` : ''}
            ${ev.location ? ` &nbsp;📍 ${esc(ev.location)}` : ''}
            ${ev.category ? ` &nbsp;🏷 ${esc(ev.category)}` : ''}
          </p>
          ${ev.description ? `<p style="margin:0 0 0.75rem;font-size:0.9rem;">${esc(ev.description).replace(/\n/g, '<br>')}</p>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:0.25rem;align-items:center;">
            ${saveBtn}${externalLink}${editBtns}
          </div>
        </div>
      </div>`;
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
      html += `<button class="btn btn-small btn-secondary" id="pc-prev-btn">← Previous</button>`;
    }
    html += `<span style="align-self:center;font-size:0.9rem;">Page ${currentPage + 1} of ${pages}</span>`;
    if (currentPage < pages - 1) {
      html += `<button class="btn btn-small btn-secondary" id="pc-next-btn">Next →</button>`;
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
    const list = document.getElementById('pc-events-list');
    if (list) {
      list.innerHTML = '<p style="color:var(--color-text-muted,#6b7280);">Loading events…</p>';
    }

    try {
      const params = new URLSearchParams({
        limit: PAGE_SIZE,
        offset: currentOffset,
        ...currentFilters,
      });
      // Remove empty filter values
      [...params.entries()].forEach(([k, v]) => {
        if (!v) {
          params.delete(k);
        }
      });

      const data = await apiFetch(`/api/v1/public-calendar/events?${params}`);
      totalEvents = data.total || 0;
      renderEvents(data.events || []);
      renderPagination();
    } catch (err) {
      if (list) {
        list.innerHTML = '<p style="color:#dc2626;">Failed to load events. Please try again.</p>';
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
      btn.outerHTML = `<button class="btn btn-small btn-secondary" data-action="unsave" data-id="${esc(eventId)}" title="Remove from my calendar">✓ Saved</button>`;
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
      btn.outerHTML = `<button class="btn btn-small btn-primary" data-action="save" data-id="${esc(eventId)}">+ Save to my calendar</button>`;
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
    document.getElementById('pc-modal-cancel').addEventListener('click', closeModal);
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
