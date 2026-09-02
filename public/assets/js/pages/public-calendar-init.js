/**
 * Public Calendar Page — Client Initialisation
 *
 * Handles:
 *  - Loading and rendering public calendar events
 *  - Filtering (category, location, date range)
 *  - Publisher UX: Add / Edit / Delete own events
 *  - Customer UX: Save / unsave events to dashboard calendar
 */
'use strict';
(function () {
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

  function displayTitle(value) {
    const title = String(value || '').trim();
    return title ? title.charAt(0).toUpperCase() + title.slice(1) : '';
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

      updatePermissionMessaging();
    } catch (_) {
      // not logged in — read-only view
    }
  }

  async function loadSupplierDoc() {
    try {
      const data = await apiFetch('/api/me/suppliers');
      const list = data.suppliers || data.items || data;
      if (Array.isArray(list) && list.length) {
        supplierDoc = list[0];
      } else {
        supplierDoc = data.supplier || data;
      }
    } catch (_) {
      /* ignore */
    }

    // Use the server-computed flag (avoids duplicating PUBLISHER_CATEGORIES here).
    if (supplierDoc) {
      isPublisher = supplierDoc.canPublishPublicCalendar === true;
    }
  }

  function updatePermissionMessaging() {
    const banner = document.getElementById('pc-publisher-banner');
    const bannerText = document.getElementById('pc-publisher-banner-text');
    const notice = document.getElementById('pc-permission-notice');
    if (isAdmin || isPublisher) {
      if (banner) {
        banner.hidden = false;
        banner.style.display = '';
      }
      if (isAdmin) {
        const wrap = document.getElementById('pc-filter-status-wrap');
        if (wrap) {
          wrap.hidden = false;
          wrap.style.display = '';
          // Inject admin-only status options (not in static HTML to keep public render clean)
          const statusSel = document.getElementById('pc-filter-status');
          if (statusSel) {
            statusSel.innerHTML = [
              '<option value="">All upcoming events</option>',
              '<option value="published">Published</option>',
              '<option value="all">All statuses</option>',
              '<option value="draft">Draft</option>',
              '<option value="cancelled">Cancelled</option>',
              '<option value="pending_review">Pending review</option>',
              '<option value="rejected">Rejected</option>',
              '<option value="expired">Expired</option>',
            ].join('');
          }
        }
        if (bannerText) {
          bannerText.innerHTML =
            '<strong>Admin calendar controls enabled.</strong> You can view all statuses, edit events, and manage supplier publishing requests.';
        }
        showAdminRequestsPanel();
      } else if (
        bannerText &&
        supplierDoc &&
        supplierDoc.publicCalendarPublisherOverride === true
      ) {
        bannerText.innerHTML =
          '<strong>Calendar publishing has been granted by admin override.</strong> You can publish public events to the shared calendar and manage events you created.';
      }
      return;
    }
    if (currentUser && currentUser.role === 'supplier' && notice) {
      const forceDenied = supplierDoc && supplierDoc.publicCalendarPublisherOverride === false;
      notice.hidden = false;
      notice.style.display = '';
      notice.innerHTML = forceDenied
        ? '<strong>Calendar publishing has been disabled for this supplier account by an administrator.</strong>'
        : '<strong>Your supplier category does not currently include shared calendar publishing.</strong><br>Event Planner and Wedding Fayre suppliers can publish by default. Other suppliers can request publishing access if they regularly host public events such as open days, showcases, workshops, venue tours or fayres. <button type="button" class="ef-cta pc-btn pc-btn-sm pc-btn-primary" id="pc-request-access-btn">Request calendar publishing access</button>';
      document
        .getElementById('pc-request-access-btn')
        ?.addEventListener('click', submitPublisherRequest);
    }
  }

  function ensurePublisherRequestModal() {
    const existing = document.getElementById('pc-request-modal-overlay');
    if (existing) {
      return existing;
    }

    const overlay = document.createElement('div');
    overlay.id = 'pc-request-modal-overlay';
    overlay.className = 'pc-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pc-request-modal-title');
    overlay.innerHTML = `
      <div class="pc-modal">
        <div class="pc-modal__header">
          <h2 class="pc-modal__title" id="pc-request-modal-title">Request calendar publishing access</h2>
          <button class="ef-cta pc-modal__close" id="pc-request-close-btn" aria-label="Close request form" type="button">×</button>
        </div>
        <p style="color:#4b5563;margin-top:-0.5rem;">Tell the admin team how you plan to use the shared calendar. One pending request is allowed per supplier.</p>
        <form id="pc-request-form" novalidate>
          <div class="pc-form__group">
            <label class="pc-form__label" for="pc-request-reason">Reason <span class="pc-form__label-req">*</span></label>
            <textarea id="pc-request-reason" class="pc-form__control" maxlength="500" rows="3" required placeholder="Why do you need publishing access?"></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
            <div class="pc-form__group">
              <label class="pc-form__label" for="pc-request-types">Event types</label>
              <input id="pc-request-types" class="pc-form__control" maxlength="500" placeholder="Open days, workshops…" />
            </div>
            <div class="pc-form__group">
              <label class="pc-form__label" for="pc-request-example">Example event title</label>
              <input id="pc-request-example" class="pc-form__control" maxlength="200" placeholder="Autumn venue tour" />
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
            <div class="pc-form__group">
              <label class="pc-form__label" for="pc-request-frequency">Expected frequency</label>
              <select id="pc-request-frequency" class="pc-form__control">
                <option value="one-off">One-off</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div class="pc-form__group">
              <label class="pc-form__label" for="pc-request-url">Supporting URL</label>
              <input id="pc-request-url" type="url" class="pc-form__control" maxlength="500" placeholder="https://…" />
            </div>
          </div>
          <div class="pc-form__group">
            <label class="pc-form__label" for="pc-request-notes">Optional notes</label>
            <textarea id="pc-request-notes" class="pc-form__control" maxlength="500" rows="2"></textarea>
          </div>
          <div id="pc-request-error" class="pc-form__error" role="alert"></div>
          <div class="pc-form__footer">
            <button type="button" id="pc-request-cancel" class="ef-cta pc-btn pc-btn-ghost">Cancel</button>
            <button type="submit" id="pc-request-submit" class="ef-cta pc-btn pc-btn-primary">Submit request</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    overlay
      .querySelector('#pc-request-close-btn')
      .addEventListener('click', closePublisherRequestModal);
    overlay
      .querySelector('#pc-request-cancel')
      .addEventListener('click', closePublisherRequestModal);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        closePublisherRequestModal();
      }
    });
    overlay
      .querySelector('#pc-request-form')
      .addEventListener('submit', submitPublisherRequestForm);
    return overlay;
  }

  function openPublisherRequestModal() {
    const overlay = ensurePublisherRequestModal();
    overlay.querySelector('#pc-request-form').reset();
    overlay.querySelector('#pc-request-error').style.display = 'none';
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    overlay.querySelector('#pc-request-reason').focus();
  }

  function closePublisherRequestModal() {
    const overlay = document.getElementById('pc-request-modal-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  async function submitPublisherRequestForm(e) {
    e.preventDefault();
    const errorEl = document.getElementById('pc-request-error');
    const submitBtn = document.getElementById('pc-request-submit');
    const body = {
      reason: document.getElementById('pc-request-reason').value,
      eventTypes: document.getElementById('pc-request-types').value,
      exampleEventTitle: document.getElementById('pc-request-example').value,
      expectedFrequency: document.getElementById('pc-request-frequency').value,
      supportingUrl: document.getElementById('pc-request-url').value,
      notes: document.getElementById('pc-request-notes').value,
    };
    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    try {
      await apiFetch('/api/v1/public-calendar/publisher-request', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      closePublisherRequestModal();
      showToast('Calendar publishing access request submitted', 'success');
      await loadCurrentUser();
    } catch (err) {
      const details = err.data?.details || [
        err.data?.error || err.message || 'Failed to submit request',
      ];
      errorEl.textContent = Array.isArray(details) ? details.join(' · ') : details;
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit request';
    }
  }

  function submitPublisherRequest() {
    openPublisherRequestModal();
  }

  async function showAdminRequestsPanel() {
    const panel = document.getElementById('pc-admin-requests-panel');
    if (!panel) {
      return;
    }
    panel.hidden = false;
    panel.style.display = '';
    const refresh = document.getElementById('pc-admin-requests-refresh');
    if (refresh && !refresh.dataset.bound) {
      refresh.dataset.bound = 'true';
      refresh.addEventListener('click', loadAdminPublishingRequests);
    }
    await loadAdminPublishingRequests();
  }

  async function loadAdminPublishingRequests() {
    const list = document.getElementById('pc-admin-requests-list');
    if (!list) {
      return;
    }
    list.innerHTML = '<p style="color:#64748b;margin:0;">Loading publishing requests…</p>';
    try {
      const data = await apiFetch('/api/v1/public-calendar/publisher-requests?status=pending');
      const requests = data.requests || [];
      if (!requests.length) {
        list.innerHTML =
          '<p style="color:#64748b;margin:0;">No pending calendar publishing requests.</p>';
        return;
      }
      list.innerHTML = requests.map(renderAdminRequestCard).join('');
      list.querySelectorAll('[data-admin-request-action]').forEach(btn => {
        btn.addEventListener('click', () => handleAdminRequestAction(btn));
      });
    } catch (err) {
      list.innerHTML = '<p style="color:#dc2626;margin:0;">Failed to load publishing requests.</p>';
    }
  }

  function renderAdminRequestCard(req) {
    return `<article style="border:1px solid #e2e8f0;border-radius:0.75rem;padding:0.85rem;margin-top:0.75rem;background:#fff;">
      <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <div>
          <strong>${esc(req.supplierName || req.supplierId || 'Supplier')}</strong>
          <div style="color:#64748b;font-size: 0.8125rem;">${esc(req.supplierCategory || 'Unknown category')} · ${esc(req.expectedFrequency || 'frequency not set')}</div>
        </div>
        <span class="pc-event-card__badge pc-event-card__badge--book">${esc(req.status || 'pending')}</span>
      </div>
      <p style="margin:0.65rem 0;color:#334155;">${esc(req.reason)}</p>
      <p style="margin:0 0 0.75rem;color:#64748b;font-size: 0.875rem;"><strong>Types:</strong> ${esc(req.eventTypes || 'Not specified')} · <strong>Example:</strong> ${esc(req.exampleEventTitle || 'Not specified')}</p>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <button class="ef-cta pc-btn pc-btn-sm pc-btn-primary" data-admin-request-action="approve" data-request-id="${esc(req.id)}">Approve</button>
        <button class="ef-cta pc-btn pc-btn-sm pc-btn-danger" data-admin-request-action="reject" data-request-id="${esc(req.id)}">Reject</button>
        ${req.supportingUrl ? `<a class="pc-btn pc-btn-sm pc-btn-ghost" href="${esc(req.supportingUrl)}" target="_blank" rel="noopener noreferrer">Supporting URL ↗</a>` : ''}
      </div>
    </article>`;
  }

  async function handleAdminRequestAction(btn) {
    const action = btn.dataset.adminRequestAction;
    const requestId = btn.dataset.requestId;
    const reason =
      action === 'reject'
        ? window.prompt('Optional rejection reason for the supplier:') || ''
        : 'Approved for shared calendar publishing';
    btn.disabled = true;
    try {
      await apiFetch(
        `/api/v1/public-calendar/publisher-requests/${encodeURIComponent(requestId)}/${action}`,
        {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }
      );
      showToast(`Publishing request ${action === 'approve' ? 'approved' : 'rejected'}`, 'success');
      await loadAdminPublishingRequests();
    } catch (err) {
      showToast(err.data?.error || `Failed to ${action} request`, 'error');
      btn.disabled = false;
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
            ${isAdmin || isPublisher ? `<button class="ef-cta pc-btn pc-btn-primary" id="pc-empty-add-btn" style="margin-top:1rem;" type="button">+ Add the first event</button>` : ''}
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
      btn.addEventListener('click', () => handleDelete(btn.dataset.id, btn.dataset.title, btn));
    });
  }

  function renderEventCard(ev) {
    const canEdit =
      isAdmin || (isPublisher && ev.createdByUserId === (currentUser && currentUser.id));
    const isLoggedIn = !!currentUser;

    const saveBtn = isLoggedIn
      ? ev.savedByMe
        ? `<button class="ef-cta pc-btn pc-btn-sm pc-btn-saved" data-action="unsave" data-id="${esc(ev.id)}" title="Remove from my calendar">Remove from calendar</button>`
        : `<button class="ef-cta pc-btn pc-btn-sm pc-btn-save" data-action="save" data-id="${esc(ev.id)}">+ Add to calendar</button>`
      : `<a class="pc-btn pc-btn-sm pc-btn-disabled" href="/auth?redirect=/public-calendar" aria-label="Sign in to save this event">Sign in to save</a>`;

    const editBtns = canEdit
      ? `<button class="ef-cta pc-btn pc-btn-sm pc-btn-outline-green" data-action="edit" data-id="${esc(ev.id)}">Edit</button>
         <button class="ef-cta pc-btn pc-btn-sm pc-btn-danger" data-action="delete" data-id="${esc(ev.id)}" data-title="${esc(displayTitle(ev.title))}">Delete</button>`
      : '';

    const image = ev.featuredImageUrl || ev.imageUrl;
    const imgSection = image
      ? `<img class="pc-event-card__img" src="${esc(image)}" alt="" loading="lazy" />`
      : `<div class="pc-event-card__img-placeholder">${getCategoryEmoji(ev.eventType || ev.category)}</div>`;

    const externalLink =
      ev.externalBookingUrl || ev.externalUrl
        ? `<a href="${esc(ev.externalBookingUrl || ev.externalUrl)}" target="_blank" rel="noopener noreferrer" class="pc-btn pc-btn-sm pc-btn-ghost">Book/info ↗</a>`
        : '';
    const detailLink = `<a href="/events/${esc(ev.slug || ev.id)}" class="pc-btn pc-btn-sm pc-btn-ghost">View details</a>`;
    const icsLink = `<a href="/api/v1/public-calendar/events/${esc(ev.id)}/ics" class="pc-btn pc-btn-sm pc-btn-ghost">Download event</a>`;

    const categoryBadge =
      ev.eventType || ev.category
        ? `<span class="pc-event-card__category">${esc(ev.eventType || ev.category)}</span>`
        : '';
    const priceBadge =
      ev.priceType === 'free'
        ? '<span class="pc-event-card__badge pc-event-card__badge--free">Free</span>'
        : ev.priceType === 'paid' && ev.ticketPrice
          ? `<span class="pc-event-card__badge">£${esc(ev.ticketPrice)}</span>`
          : '';
    const bookingBadge = ev.bookingRequired
      ? '<span class="pc-event-card__badge pc-event-card__badge--book">Booking required</span>'
      : '';
    const locationText =
      ev.location ||
      [ev.venueName, ev.townCity, ev.county, ev.postcode].filter(Boolean).join(', ') ||
      (ev.isOnline ? 'Online event' : '');

    const dateStr = formatDate(ev.startDate);
    const endDateStr = ev.endDate ? ` – ${formatDate(ev.endDate)}` : '';

    return `
      <article class="pc-event-card">
        ${imgSection}
        <div class="pc-event-card__body">
          <div class="pc-event-card__badges">${categoryBadge}${priceBadge}${bookingBadge}</div>
          ${ev.status === 'cancelled' ? '<div class="pc-event-card__cancelled">Cancelled</div>' : ''}
          <h3 class="pc-event-card__title">${esc(ev.title)}</h3>
          <div class="pc-event-card__meta">
            <span class="pc-event-card__meta-row">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              ${esc(dateStr)}${esc(endDateStr)}
            </span>
            ${
              locationText
                ? `<span class="pc-event-card__meta-row">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              ${esc(locationText)}
            </span>`
                : ''
            }
          </div>
          ${ev.description ? `<p class="pc-event-card__description">${esc(ev.description)}</p>` : ''}
          ${ev.organiserName ? `<p class="pc-event-card__meta-row"><strong>Hosted by:</strong> ${esc(ev.organiserName)}</p>` : ''}
          <div class="pc-event-card__actions">
            ${saveBtn}${detailLink}${icsLink}${externalLink}${editBtns}
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
      html += `<button class="ef-cta pc-btn pc-btn-ghost" id="pc-prev-btn">← Previous</button>`;
    }
    html += `<span style="align-self:center;font-size: 0.875rem;color:#6b7280;">Page ${currentPage + 1} of ${pages}</span>`;
    if (currentPage < pages - 1) {
      html += `<button class="ef-cta pc-btn pc-btn-ghost" id="pc-next-btn">Next →</button>`;
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
    // Show loading skeleton. `#pc-loading-skeleton` lives inside
    // `#pc-events-list`, so clearing the list's innerHTML on every load (as
    // opposed to only the first one) deleted the skeleton node itself —
    // after that, later filter/pagination reloads showed a blank list with
    // no loading state at all. Rebuilding the markup here keeps a skeleton
    // node present for every load, not just the pre-hydration paint.
    const list = document.getElementById('pc-events-list');
    if (list) {
      list.innerHTML = `
        <div class="pc-skeleton-grid" id="pc-loading-skeleton">
          <div class="pc-skeleton-card"></div>
          <div class="pc-skeleton-card"></div>
          <div class="pc-skeleton-card"></div>
        </div>`;
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
      showToast('Saved to your planning calendar', 'success');
      btn.outerHTML = `<button class="ef-cta pc-btn pc-btn-sm pc-btn-saved" data-action="unsave" data-id="${esc(eventId)}" title="Remove from my calendar">✓ Saved</button>`;
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
      showToast('Removed from your planning calendar', 'success');
      btn.outerHTML = `<button class="ef-cta pc-btn pc-btn-sm pc-btn-save" data-action="save" data-id="${esc(eventId)}">+ Save</button>`;
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
  async function handleDelete(eventId, title, delBtn) {
    // Inline two-step confirmation — avoids native confirm() dialog for consistent UX
    const actionsEl = delBtn ? delBtn.closest('.pc-event-card__actions') : null;
    if (!actionsEl) {
      return;
    }

    const originalHTML = actionsEl.innerHTML;
    actionsEl.innerHTML = `
      <span style="font-size: 0.8125rem;color:#374151;align-self:center;white-space:nowrap;">Delete this event?</span>
      <button class="ef-cta pc-btn pc-btn-sm pc-btn-danger" id="_pc-del-confirm">Confirm</button>
      <button class="ef-cta pc-btn pc-btn-sm pc-btn-ghost" id="_pc-del-cancel">Cancel</button>
    `;

    document.getElementById('_pc-del-cancel').onclick = () => {
      actionsEl.innerHTML = originalHTML;
      rewireButtons();
    };

    document.getElementById('_pc-del-confirm').onclick = async () => {
      actionsEl.querySelectorAll('button').forEach(b => {
        b.disabled = true;
      });
      try {
        await apiFetch(`/api/v1/public-calendar/events/${eventId}`, {
          method: 'DELETE',
          body: '{}',
        });
        showToast('Event deleted', 'success');
        loadEvents();
      } catch (e) {
        actionsEl.innerHTML = originalHTML;
        rewireButtons();
        showToast(e.data?.message || 'Failed to delete event', 'error');
      }
    };
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
      document.getElementById('pc-form-external').value =
        ev.externalBookingUrl || ev.externalUrl || '';
      document.getElementById('pc-form-price-type').value = ev.priceType || 'unknown';
      document.getElementById('pc-form-booking-required').value = ev.bookingRequired
        ? 'true'
        : 'false';
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
      featuredImageUrl: document.getElementById('pc-form-image').value,
      externalUrl: document.getElementById('pc-form-external').value,
      externalBookingUrl: document.getElementById('pc-form-external').value,
      eventType: document.getElementById('pc-form-category').value || 'Other',
      priceType: document.getElementById('pc-form-price-type').value,
      bookingRequired: document.getElementById('pc-form-booking-required').value === 'true',
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
    // Simple fallback — styled via calendar.css .pc-toast classes
    const div = document.createElement('div');
    div.textContent = message;
    div.className = `pc-toast pc-toast--${type === 'error' ? 'error' : 'success'}`;
    document.body.appendChild(div);
    requestAnimationFrame(() => div.classList.add('pc-toast--visible'));
    setTimeout(() => {
      div.classList.remove('pc-toast--visible');
      setTimeout(() => div.remove(), 300);
    }, 3200);
  }

  // ── Filter handlers ───────────────────────────────────────────────────────
  function applyFilters() {
    currentFilters = {
      q: (document.getElementById('pc-filter-q').value || '').trim(),
      eventType: (document.getElementById('pc-filter-event-type').value || '').trim(),
      category: (document.getElementById('pc-filter-category').value || '').trim(),
      location: (document.getElementById('pc-filter-location').value || '').trim(),
      includePast: document.getElementById('pc-filter-past')?.checked ? 'true' : '',
      status: document.getElementById('pc-filter-status')?.value || '',
      startDate: document.getElementById('pc-filter-from').value,
      endDate: document.getElementById('pc-filter-to').value,
    };
    currentOffset = 0;
    loadEvents();
  }

  function clearFilters() {
    document.getElementById('pc-filter-q').value = '';
    document.getElementById('pc-filter-event-type').value = '';
    document.getElementById('pc-filter-category').value = '';
    document.getElementById('pc-filter-location').value = '';
    if (document.getElementById('pc-filter-past')) {
      document.getElementById('pc-filter-past').checked = false;
    }
    if (document.getElementById('pc-filter-status')) {
      document.getElementById('pc-filter-status').value = '';
    }
    document.getElementById('pc-filter-from').value = '';
    document.getElementById('pc-filter-to').value = '';
    currentFilters = {};
    currentOffset = 0;
    loadEvents();
  }

  // ── Public calendar widget ───────────────────────────────────────────────
  let calendarWidgetDate = new Date();
  let calendarWidgetEvents = [];

  function ensureCalendarWidgetModal() {
    const existing = document.getElementById('pc-calendar-widget-overlay');
    if (existing) {
      return existing;
    }

    const overlay = document.createElement('div');
    overlay.id = 'pc-calendar-widget-overlay';
    overlay.className = 'pc-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pc-calendar-widget-title');
    overlay.innerHTML = `
      <div class="pc-modal pc-calendar-modal" role="document">
        <div class="pc-modal__header">
          <div>
            <h2 class="pc-modal__title" id="pc-calendar-widget-title">Public events calendar</h2>
            <p style="margin:.35rem 0 0;color:#64748b;font-size: 0.875rem;">All public events in a simple month view.</p>
          </div>
          <button class="ef-cta pc-modal__close" id="pc-calendar-widget-close" aria-label="Close public calendar" type="button">×</button>
        </div>
        <div id="pc-calendar-widget-body" aria-live="polite"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay
      .querySelector('#pc-calendar-widget-close')
      .addEventListener('click', closeCalendarWidget);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        closeCalendarWidget();
      }
    });
    return overlay;
  }

  function closeCalendarWidget() {
    const overlay = document.getElementById('pc-calendar-widget-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.classList.remove('is-open');
      document.body.style.overflow = '';
    }
  }

  function eventDateKey(event) {
    const date = new Date(event.startDate);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }

  function renderCalendarWidget() {
    const body = document.getElementById('pc-calendar-widget-body');
    if (!body) {
      return;
    }

    const monthStart = new Date(calendarWidgetDate.getFullYear(), calendarWidgetDate.getMonth(), 1);
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - monthStart.getDay());
    const byDay = new Map();
    calendarWidgetEvents.forEach(event => {
      const key = eventDateKey(event);
      if (!key) {
        return;
      }
      if (!byDay.has(key)) {
        byDay.set(key, []);
      }
      byDay.get(key).push(event);
    });

    const days = [];
    const cursor = new Date(gridStart);
    for (let i = 0; i < 42; i += 1) {
      const key = cursor.toISOString().slice(0, 10);
      const dayEvents = byDay.get(key) || [];
      const muted = cursor.getMonth() !== monthStart.getMonth();
      days.push(`
        <div class="pc-calendar-day ${muted ? 'pc-calendar-day--muted' : ''}">
          <div class="pc-calendar-day__num">${cursor.getDate()}</div>
          ${dayEvents
            .slice(0, 4)
            .map(
              event =>
                `<a class="pc-calendar-event" href="/events/${encodeURIComponent(event.slug || event.id)}" title="${esc(displayTitle(event.title))}">${esc(formatDate(event.startDate).replace(/,.*$/, ''))} · ${esc(displayTitle(event.title))}</a>`
            )
            .join('')}
          ${dayEvents.length > 4 ? `<div style="font-size:.75rem;color:#64748b;font-weight:700;">+${dayEvents.length - 4} more</div>` : ''}
        </div>`);
      cursor.setDate(cursor.getDate() + 1);
    }

    body.innerHTML = `
      <div class="pc-calendar-modal__top">
        <h3 class="pc-calendar-modal__month">${monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>
        <div class="pc-calendar-modal__controls">
          <button class="ef-cta pc-btn pc-btn-ghost" type="button" id="pc-cal-prev">← Previous</button>
          <button class="ef-cta pc-btn pc-btn-calendar" type="button" id="pc-cal-today">Today</button>
          <button class="ef-cta pc-btn pc-btn-ghost" type="button" id="pc-cal-next">Next →</button>
        </div>
      </div>
      ${
        calendarWidgetEvents.length
          ? `<div class="pc-calendar-grid">
        ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<div class="pc-calendar-weekday">${day}</div>`).join('')}
        ${days.join('')}
      </div>`
          : '<div class="pc-calendar-empty">No public events are currently available.</div>'
      }`;

    document.getElementById('pc-cal-prev')?.addEventListener('click', () => {
      calendarWidgetDate = new Date(
        calendarWidgetDate.getFullYear(),
        calendarWidgetDate.getMonth() - 1,
        1
      );
      renderCalendarWidget();
    });
    document.getElementById('pc-cal-next')?.addEventListener('click', () => {
      calendarWidgetDate = new Date(
        calendarWidgetDate.getFullYear(),
        calendarWidgetDate.getMonth() + 1,
        1
      );
      renderCalendarWidget();
    });
    document.getElementById('pc-cal-today')?.addEventListener('click', () => {
      calendarWidgetDate = new Date();
      renderCalendarWidget();
    });
  }

  async function openCalendarWidget() {
    const overlay = ensureCalendarWidgetModal();
    const body = document.getElementById('pc-calendar-widget-body');
    overlay.style.display = 'flex';
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    if (body) {
      body.innerHTML = '<div class="pc-calendar-empty">Loading public events…</div>';
    }
    try {
      const data = await apiFetch(
        '/api/v1/public-calendar/events?includePast=true&limit=100&offset=0'
      );
      calendarWidgetEvents = (data.events || []).sort(
        (a, b) => new Date(a.startDate) - new Date(b.startDate)
      );
      const nextEvent = calendarWidgetEvents.find(event => new Date(event.startDate) >= new Date());
      calendarWidgetDate = nextEvent ? new Date(nextEvent.startDate) : new Date();
      renderCalendarWidget();
    } catch (err) {
      if (body) {
        body.innerHTML = `<div class="pc-calendar-empty" style="color:#b91c1c;">${esc(err.message || 'Failed to load public events.')}</div>`;
      }
    }
  }

  // ── Initialise ────────────────────────────────────────────────────────────
  async function init() {
    await loadCurrentUser();
    await loadEvents();

    // Filter controls
    document.getElementById('pc-filter-btn').addEventListener('click', applyFilters);
    document.getElementById('pc-filter-clear-btn').addEventListener('click', clearFilters);
    [
      'pc-filter-q',
      'pc-filter-event-type',
      'pc-filter-category',
      'pc-filter-location',
      'pc-filter-from',
      'pc-filter-to',
      'pc-filter-status',
    ].forEach(id => {
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

    const calendarViewBtn = document.getElementById('pc-calendar-view-btn');
    if (calendarViewBtn) {
      calendarViewBtn.addEventListener('click', openCalendarWidget);
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
        closeCalendarWidget();
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
