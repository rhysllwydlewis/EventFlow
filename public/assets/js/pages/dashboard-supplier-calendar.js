/**
 * Supplier Dashboard Calendar
 *
 * Initialises an interactive FullCalendar on the supplier dashboard.
 *
 * For publisher suppliers (Event Planner / Wedding Fayre, or admin override):
 *   - Can create, edit, and delete shared public calendar events inline
 *   - Sees own events with edit/delete options
 *   - Sees other public events with save/unsave option
 *   - CTA link shows "Manage Events"
 *
 * For all suppliers:
 *   - Read-only view of all public calendar events
 *   - Can save/unsave public events to personal calendar
 *   - Can create/delete personal calendar entries (meeting/event/appointment)
 *   - CTA link shows "View Public Calendar"
 */
'use strict';
(function () {
  let currentSupplier = null; // Current supplier's profile document
  let isPublisher = false; // Whether this supplier can publish public events (set from server)
  let calendarInstance = null; // FullCalendar instance
  const savedEventIds = new Set(); // IDs of public events the supplier has saved

  // ── CSRF Token ─────────────────────────────────────────────────────────────

  function getCsrfToken() {
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.getAttribute('content')) {
      return meta.getAttribute('content');
    }
    const match = document.cookie.match(/(?:^|;\s*)(?:csrf|csrfToken)=([^;]+)/);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch (_) {
        return match[1];
      }
    }
    return '';
  }

  async function ensureCsrfToken() {
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    try {
      const resp = await fetch('/api/csrf-token', { credentials: 'include' });
      if (resp.ok) {
        const data = await resp.json();
        const token = data.csrfToken || data.token || '';
        if (token) {
          window.__CSRF_TOKEN__ = token;
          const meta = document.querySelector('meta[name="csrf-token"]');
          if (meta) {
            meta.setAttribute('content', token);
          }
        }
        return token;
      }
    } catch (_) {
      /* fall back to cookie/meta */
    }
    return getCsrfToken();
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  function showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `cal-toast cal-toast--${type || 'success'}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
    // A live region is announced when its text changes, not when it is inserted already holding
    // text, so the message goes in a moment after the (empty) region is on the page.
    setTimeout(() => {
      toast.textContent = message;
    }, 50);
    requestAnimationFrame(() => toast.classList.add('cal-toast--visible'));
    setTimeout(() => {
      toast.classList.remove('cal-toast--visible');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 3000);
  }

  // ── Escape HTML ────────────────────────────────────────────────────────────

  function displayTitle(value) {
    const title = String(value || '').trim();
    return title ? title.charAt(0).toUpperCase() + title.slice(1) : '';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function showFieldError(el, msg) {
    el.textContent = msg;
    el.hidden = false;
  }

  // ── Keyboard focus for the overlays built here (see utils/overlay-focus.js) ──────────

  /** Keeps Tab inside `overlay` and remembers what to give focus back to when it closes. */
  function holdFocus(overlay, opener) {
    if (window.EFOverlayFocus) {
      window.EFOverlayFocus.trap(overlay, opener);
    }
  }

  /** Gives focus back (to the opener, else `fallbackId`'s button) as `overlay` closes. */
  function returnFocus(overlay, fallbackId) {
    if (window.EFOverlayFocus) {
      window.EFOverlayFocus.release(
        overlay,
        fallbackId ? document.getElementById(fallbackId) : null
      );
    }
  }

  // ── Colour helpers ─────────────────────────────────────────────────────────

  function getEntryColor(type) {
    const colors = {
      meeting: '#6366f1',
      appointment: '#f59e0b',
      event: '#0b8073',
    };
    return colors[type] || '#0b8073';
  }

  function getPublicEventColor(ev) {
    // Supplier's own event: teal
    if (currentSupplier && String(ev.supplierId) === String(currentSupplier.id)) {
      return { bg: '#0b8073', border: '#096b60' };
    }
    // Saved event: purple
    if (savedEventIds.has(String(ev.id))) {
      return { bg: '#7c3aed', border: '#6d28d9' };
    }
    // Other public events: rose
    return { bg: '#e11d48', border: '#be123c' };
  }

  // ── Supplier profile ───────────────────────────────────────────────────────

  async function loadSupplierProfile() {
    try {
      const res = await fetch('/api/me/suppliers', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const list = data.suppliers || data.items || data;
        if (Array.isArray(list) && list.length) {
          currentSupplier = list[0];
        } else {
          currentSupplier = data.supplier || data;
        }
      }
    } catch (_) {
      /* network error — ignore */
    }

    // Use the server-computed flag (avoids duplicating PUBLISHER_CATEGORIES here).
    if (currentSupplier) {
      isPublisher = currentSupplier.canPublishPublicCalendar === true;
    }
  }

  // ── Update card header based on publisher status ───────────────────────────

  function updateCalendarHeader() {
    const ctaLink = document.getElementById('supplier-cal-cta');
    const subtitle = document.getElementById('supplier-cal-subtitle');
    const publisherBtns = document.querySelectorAll('.sup-cal-publisher-only');

    const notice = document.getElementById('sup-cal-permission-notice');
    if (isPublisher) {
      if (ctaLink) {
        ctaLink.textContent = 'Manage public events';
        ctaLink.setAttribute('aria-label', 'Manage public calendar events');
      }
      if (subtitle) {
        subtitle.textContent = 'Your private calendar, and the public events you publish.';
      }
      if (notice) {
        notice.dataset.tone = '';
        notice.textContent =
          currentSupplier && currentSupplier.publicCalendarPublisherOverride === true
            ? 'An administrator has allowed you to publish public events. They appear on the EventFlow public calendar. Your private entries stay private.'
            : 'You can publish public events to the EventFlow public calendar and manage the ones you created. Your private entries stay private.';
      }
      publisherBtns.forEach(el => {
        el.hidden = false;
      });
    } else {
      if (subtitle) {
        subtitle.textContent = 'Your private calendar: entries only you can see.';
      }
      if (notice) {
        const forceDenied =
          currentSupplier && currentSupplier.publicCalendarPublisherOverride === false;
        notice.dataset.tone = forceDenied ? 'danger' : 'warn';
        notice.textContent = '';
        const copy = document.createElement('div');
        copy.className = 'sup-cal-permission-notice__copy';
        const lead = document.createElement('strong');
        lead.textContent = forceDenied
          ? 'Public calendar publishing has been disabled for your account by an administrator.'
          : "Public calendar publishing isn't available for your supplier type.";
        copy.appendChild(lead);
        const reassurance = document.createElement('p');
        reassurance.textContent = 'Your private calendar is not affected.';
        copy.appendChild(reassurance);
        notice.appendChild(copy);
        if (!forceDenied) {
          const request = document.createElement('button');
          request.type = 'button';
          request.id = 'sup-request-publishing-btn';
          request.className = 'sdh-btn sdh-btn--secondary sdh-btn--sm';
          request.textContent = 'Ask to publish public events';
          request.addEventListener('click', requestPublishingAccess);
          notice.appendChild(request);
        }
      }
      publisherBtns.forEach(el => {
        el.hidden = true;
      });
    }
  }

  /** Wires the request dialog once: its form, and its close and Cancel buttons. */
  function bindPublisherDialog() {
    const form = document.getElementById('sdh-publisher-form');
    const dialog = document.getElementById('sdh-publisher-dialog');
    if (!form || !dialog || form._wired) {
      return;
    }
    form._wired = true;
    form.addEventListener('submit', submitPublishingRequest);
    dialog.querySelectorAll('[data-dialog-close]').forEach(button => {
      button.addEventListener('click', () => dialog.close());
    });
  }

  /** Opens the dialog where a supplier asks an administrator for public calendar publishing. */
  function requestPublishingAccess() {
    const dialog = document.getElementById('sdh-publisher-dialog');
    const form = document.getElementById('sdh-publisher-form');
    if (!dialog || !form || typeof dialog.showModal !== 'function') {
      return;
    }
    form.reset();
    const status = document.getElementById('sdh-publisher-status');
    if (status) {
      status.textContent = '';
    }
    dialog.showModal();
    document.getElementById('sdh-publisher-reason')?.focus();
  }

  /** Sends the publishing-access request from the dialog and says what happened inside it. */
  async function submitPublishingRequest(event) {
    event.preventDefault();
    const dialog = document.getElementById('sdh-publisher-dialog');
    const reasonField = document.getElementById('sdh-publisher-reason');
    const status = document.getElementById('sdh-publisher-status');
    const send = document.getElementById('sdh-publisher-send');
    const reason = reasonField ? reasonField.value.trim() : '';
    /** Writes a message in the dialog. */
    const say = (message, tone) => {
      if (status) {
        status.textContent = message;
        status.setAttribute('data-tone', tone);
      }
    };
    if (reason.length < 10) {
      reasonField?.setAttribute('aria-invalid', 'true');
      say('Tell us a little more: what you would publish and how often.', 'error');
      reasonField?.focus();
      return;
    }
    reasonField?.removeAttribute('aria-invalid');
    if (send) {
      send.disabled = true;
    }
    try {
      const res = await fetch('/api/v1/public-calendar/publisher-request', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({
          reason,
          eventTypes: reason,
          exampleEventTitle: 'See reason',
          expectedFrequency: 'See reason',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || 'Request failed');
      }
      dialog?.close();
      showToast('Request sent. An administrator will review it.', 'success');
    } catch (error) {
      // A dropped connection is a TypeError with the browser's own wording ("Failed to fetch").
      say(
        error instanceof TypeError || !error.message
          ? 'The request could not be sent. Check your connection and try again.'
          : error.message,
        'error'
      );
    } finally {
      if (send) {
        send.disabled = false;
      }
    }
  }

  async function renderMyPublicEvents() {
    const mount = document.getElementById('sup-my-public-events');
    if (!mount) {
      return;
    }
    if (!isPublisher) {
      mount.innerHTML = '';
      return;
    }
    try {
      const res = await fetch(
        '/api/v1/public-calendar/events?status=all&includePast=true&limit=100',
        { credentials: 'include' }
      );
      const data = await res.json();
      const own = (data.events || []).filter(
        ev => ev.createdByUserId === (currentSupplier && currentSupplier.ownerUserId)
      );
      const rows = own
        .slice(0, 8)
        .map(
          ev =>
            `<tr><td>${escapeHtml(ev.title)}</td><td>${escapeHtml(formatDate(ev.startDate))}</td><td><strong>${escapeHtml(ev.status || 'published')}</strong></td><td><a href="/events/${encodeURIComponent(ev.slug || ev.id)}">View</a></td></tr>`
        )
        .join('');
      mount.innerHTML = `<div class="sup-my-public-events__head"><h3>My public events</h3><button type="button" class="sup-cal-publisher-only" id="sup-my-events-create">Create event</button></div>${own.length ? `<div class="sup-my-public-events__table"><table><thead><tr><th>Title</th><th>Date</th><th>Status</th><th>Public page</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="sup-my-public-events__empty">No public events yet. Create your first wedding fayre, open day, workshop or showcase.</p>'}`;
      document
        .getElementById('sup-my-events-create')
        ?.addEventListener('click', () => openEventModal());
    } catch {
      mount.innerHTML =
        '<h3>My public events</h3><p class="sup-my-public-events__empty">Unable to load your public events.</p>';
    }
  }

  // ── Personal Entry Modal ───────────────────────────────────────────────────

  function ensureEntryModal() {
    const MODAL_ID = 'sup-cal-entry-modal';
    const existing = document.getElementById(MODAL_ID);
    if (existing) {
      return existing;
    }

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'cal-entry-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'sup-cal-entry-modal-title');

    overlay.innerHTML = `
      <div class="cal-entry-modal" role="document">
        <div class="cal-entry-modal__header">
          <h2 class="cal-entry-modal__title" id="sup-cal-entry-modal-title">Add Calendar Entry</h2>
          <button type="button" class="ef-cta cal-entry-modal__close" aria-label="Close dialog">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <form class="cal-entry-modal__form" id="sup-cal-entry-form" novalidate>
          <div class="cal-entry-modal__field">
            <label for="sup-cal-entry-title" class="cal-entry-modal__label">Title <span aria-hidden="true">*</span></label>
            <input type="text" id="sup-cal-entry-title" name="title" class="cal-entry-modal__input" maxlength="100" required aria-required="true" placeholder="e.g. Client meeting">
          </div>
          <div class="cal-entry-modal__field">
            <label for="sup-cal-entry-type" class="cal-entry-modal__label">Type <span aria-hidden="true">*</span></label>
            <select id="sup-cal-entry-type" name="type" class="cal-entry-modal__input" required aria-required="true">
              <option value="">— Select type —</option>
              <option value="meeting">Meeting</option>
              <option value="event">Event</option>
              <option value="appointment">Appointment</option>
            </select>
          </div>
          <div class="cal-entry-modal__field">
            <label for="sup-cal-entry-date" class="cal-entry-modal__label">Date <span aria-hidden="true">*</span></label>
            <input type="date" id="sup-cal-entry-date" name="date" class="cal-entry-modal__input" required aria-required="true">
          </div>
          <div class="cal-entry-modal__field">
            <label for="sup-cal-entry-time" class="cal-entry-modal__label">Time <span class="cal-entry-modal__optional">(optional)</span></label>
            <input type="time" id="sup-cal-entry-time" name="time" class="cal-entry-modal__input">
          </div>
          <div class="cal-entry-modal__field">
            <label for="sup-cal-entry-notes" class="cal-entry-modal__label">Notes <span class="cal-entry-modal__optional">(optional)</span></label>
            <textarea id="sup-cal-entry-notes" name="description" class="cal-entry-modal__input cal-entry-modal__textarea" maxlength="500" placeholder="Add any details…" rows="3"></textarea>
          </div>
          <p class="cal-entry-modal__error" id="sup-cal-entry-error" role="alert" aria-live="assertive" hidden></p>
          <div class="cal-entry-modal__actions">
            <button type="button" class="cal-entry-modal__btn cal-entry-modal__btn--cancel" id="sup-cal-entry-cancel">Cancel</button>
            <button type="submit" class="cal-entry-modal__btn cal-entry-modal__btn--save" id="sup-cal-entry-submit">Save Entry</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay
      .querySelector('.cal-entry-modal__close')
      .addEventListener('click', () => closeEntryModal(overlay));
    overlay
      .querySelector('#sup-cal-entry-cancel')
      .addEventListener('click', () => closeEntryModal(overlay));
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        closeEntryModal(overlay);
      }
    });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeEntryModal(overlay);
      }
    });
    overlay
      .querySelector('#sup-cal-entry-form')
      .addEventListener('submit', e => submitEntryForm(e, overlay));

    return overlay;
  }

  /** A date as YYYY-MM-DD in the visitor's own time zone (toISOString would use UTC). */
  function localIsoDate(date) {
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function openEntryModal(modal, dateStr) {
    modal.querySelector('#sup-cal-entry-title').value = '';
    modal.querySelector('#sup-cal-entry-type').value = '';
    modal.querySelector('#sup-cal-entry-date').value = dateStr || localIsoDate(new Date());
    modal.querySelector('#sup-cal-entry-time').value = '';
    modal.querySelector('#sup-cal-entry-notes').value = '';
    const errorEl = modal.querySelector('#sup-cal-entry-error');
    errorEl.hidden = true;
    const submitBtn = modal.querySelector('#sup-cal-entry-submit');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Entry';

    holdFocus(modal);
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('cal-entry-modal-overlay--visible'));
    modal.querySelector('#sup-cal-entry-title').focus();
  }

  function closeEntryModal(modal) {
    returnFocus(modal, 'sup-cal-add-entry-btn');
    modal.classList.remove('cal-entry-modal-overlay--visible');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 200);
  }

  async function submitEntryForm(e, modal) {
    e.preventDefault();
    const form = e.target;
    const title = form.querySelector('#sup-cal-entry-title').value.trim();
    const type = form.querySelector('#sup-cal-entry-type').value;
    const date = form.querySelector('#sup-cal-entry-date').value;
    const time = form.querySelector('#sup-cal-entry-time').value;
    const description = form.querySelector('#sup-cal-entry-notes').value.trim();
    const errorEl = modal.querySelector('#sup-cal-entry-error');
    const submitBtn = modal.querySelector('#sup-cal-entry-submit');

    if (!title) {
      showFieldError(errorEl, 'Please enter a title.');
      form.querySelector('#sup-cal-entry-title').focus();
      return;
    }
    if (!type) {
      showFieldError(errorEl, 'Please select a type.');
      form.querySelector('#sup-cal-entry-type').focus();
      return;
    }
    if (!date) {
      showFieldError(errorEl, 'Please select a date.');
      form.querySelector('#sup-cal-entry-date').focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    errorEl.hidden = true;

    const token = await ensureCsrfToken();
    const body = { title, type, date };
    if (time) {
      body.time = time;
    }
    if (description) {
      body.description = description;
    }

    try {
      const res = await fetch('/api/me/calendar-entries', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Failed to save entry (${res.status})`);
      }

      const data = await res.json();
      const entry = data.entry || data;

      if (calendarInstance) {
        calendarInstance.addEvent({
          id: entry.id,
          title: displayTitle(entry.title),
          start: entry.time ? `${entry.date}T${entry.time}` : entry.date,
          allDay: !entry.time,
          backgroundColor: getEntryColor(entry.type),
          classNames: ['sdh-ev--private'],
          borderColor: getEntryColor(entry.type),
          extendedProps: {
            entryType: entry.type,
            description: entry.description,
            personalEntry: true,
          },
        });
      }

      closeEntryModal(modal);
      showToast('Entry added to your calendar.', 'success');
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Entry';
      showFieldError(errorEl, err.message || 'Failed to save. Please try again.');
    }
  }

  // ── Delete popover for personal entries ────────────────────────────────────

  function showDeletePopover(anchorEl, entryId, entryTitle, calInst) {
    document.querySelectorAll('.cal-delete-popover').forEach(p => p.remove());

    const popover = document.createElement('div');
    popover.className = 'cal-delete-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'true');
    popover.setAttribute('aria-label', `Delete "${entryTitle}"?`);
    popover.innerHTML = `
      <p class="cal-delete-popover__msg">Delete this entry?</p>
      <p class="cal-delete-popover__meta">${escapeHtml(entryTitle)}</p>
      <div class="cal-delete-popover__actions">
        <button type="button" class="cal-delete-popover__btn cal-delete-popover__btn--cancel">Cancel</button>
        <button type="button" class="cal-delete-popover__btn cal-delete-popover__btn--confirm">Delete</button>
      </div>
    `;

    document.body.appendChild(popover);

    const rect = anchorEl.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.zIndex = '10000';
    const popW = 220;
    let left = rect.left + rect.width / 2 - popW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 140)}px`;
    popover.style.width = `${popW}px`;

    // role="dialog" aria-modal: hold Tab inside, close on Escape, hand focus back to the entry.
    holdFocus(popover, anchorEl);
    const close = (refocus = true) => {
      document.removeEventListener('click', closeOutside, true);
      if (refocus) {
        returnFocus(popover, 'sup-cal-add-entry-btn');
      }
      popover.remove();
    };
    popover
      .querySelector('.cal-delete-popover__btn--cancel')
      .addEventListener('click', () => close());
    popover
      .querySelector('.cal-delete-popover__btn--confirm')
      .addEventListener('click', async () => {
        close();
        await deletePersonalEntry(entryId, calInst);
        // The entry that held focus is gone; keep keyboard users in the calendar card.
        if (!document.activeElement || document.activeElement === document.body) {
          document.getElementById('sup-cal-add-entry-btn')?.focus();
        }
      });
    popover.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        close();
      }
    });

    function closeOutside(e) {
      if (!popover.contains(e.target) && e.target !== anchorEl) {
        close(false);
      }
    }
    setTimeout(() => document.addEventListener('click', closeOutside, true), 10);

    popover.querySelector('.cal-delete-popover__btn--cancel').focus();
  }

  async function deletePersonalEntry(entryId, calInst) {
    const token = await ensureCsrfToken();
    try {
      const res = await fetch(`/api/me/calendar-entries/${entryId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-CSRF-Token': token },
      });
      if (!res.ok) {
        throw new Error('Delete failed');
      }
      if (calInst) {
        const ev = calInst.getEventById(entryId);
        if (ev) {
          ev.remove();
        }
      }
      showToast('Entry deleted.', 'success');
    } catch {
      showToast('Could not delete entry. Please try again.', 'error');
    }
  }

  // ── Public event action popover ────────────────────────────────────────────

  function showPublicEventPopover(anchorEl, ev) {
    document
      .querySelectorAll('.cal-delete-popover, .sup-cal-event-popover')
      .forEach(p => p.remove());

    const rawId = ev.extendedProps.rawId;
    const isSaved = savedEventIds.has(String(rawId));
    const isOwn = ev.extendedProps.ownEvent;

    const popover = document.createElement('div');
    popover.className = 'cal-delete-popover sup-cal-event-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'true');
    popover.setAttribute('aria-label', `Event: ${ev.title}`);

    let actionsHtml = '';
    if (isOwn && isPublisher) {
      actionsHtml = `
        <div class="cal-delete-popover__actions">
          <button type="button" class="cal-delete-popover__btn cal-delete-popover__btn--cancel" data-action="close">Close</button>
          <button type="button" class="cal-delete-popover__btn cal-delete-popover__btn--edit" data-action="edit">Edit</button>
          <button type="button" class="cal-delete-popover__btn cal-delete-popover__btn--confirm" data-action="delete">Delete</button>
        </div>
      `;
    } else {
      actionsHtml = `
        <div class="cal-delete-popover__actions">
          <button type="button" class="cal-delete-popover__btn cal-delete-popover__btn--cancel" data-action="close">Close</button>
          <button type="button" class="cal-delete-popover__btn cal-delete-popover__btn--edit" data-action="${isSaved ? 'unsave' : 'save'}">${isSaved ? 'Remove from calendar' : 'Save to calendar'}</button>
        </div>
      `;
    }

    const startLabel = ev.startStr
      ? new Date(`${ev.startStr}T00:00:00`).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '';

    popover.innerHTML = `
      <p class="cal-delete-popover__msg">${escapeHtml(ev.title)}</p>
      ${startLabel ? `<p class="cal-delete-popover__meta">${escapeHtml(startLabel)}</p>` : ''}
      ${actionsHtml}
    `;

    document.body.appendChild(popover);

    const rect = anchorEl.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.zIndex = '10000';
    const popW = 240;
    let left = rect.left + rect.width / 2 - popW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 160)}px`;
    popover.style.width = `${popW}px`;

    holdFocus(popover, anchorEl);
    const close = (refocus = true) => {
      document.removeEventListener('click', closeOutside, true);
      if (refocus) {
        returnFocus(popover);
      }
      popover.remove();
    };
    popover.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        close();
      }
    });

    popover.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        close(action === 'close' || action === 'save' || action === 'unsave');
        if (action === 'save') {
          await toggleSavePublicEvent(rawId, false);
        } else if (action === 'unsave') {
          await toggleSavePublicEvent(rawId, true);
        } else if (action === 'delete') {
          showDeletePublicEventConfirm(ev);
        } else if (action === 'edit') {
          openPublicEventModal(rawId);
        }
        // 'close' just closes the popover (already removed above)
      });
    });

    function closeOutside(e) {
      if (!popover.contains(e.target)) {
        close(false);
      }
    }
    setTimeout(() => document.addEventListener('click', closeOutside, true), 10);

    // The popover is a dialog: move focus into it, as the delete popover does.
    const firstButton = popover.querySelector('[data-action]');
    if (firstButton) {
      firstButton.focus();
    }
  }

  async function toggleSavePublicEvent(eventId, isSaved) {
    const token = await ensureCsrfToken();
    const method = isSaved ? 'DELETE' : 'POST';
    try {
      const res = await fetch(`/api/v1/public-calendar/events/${eventId}/save`, {
        method,
        credentials: 'include',
        headers: { 'X-CSRF-Token': token },
      });
      if (!res.ok) {
        throw new Error('Request failed');
      }
      if (isSaved) {
        savedEventIds.delete(String(eventId));
        showToast('Event removed from your calendar.', 'success');
      } else {
        savedEventIds.add(String(eventId));
        showToast('Event saved to your calendar.', 'success');
      }
      // Update event colour on calendar to reflect saved/unsaved state
      if (calendarInstance) {
        const calEv = calendarInstance.getEventById(`pub_${eventId}`);
        if (calEv) {
          const mockEv = { id: eventId, supplierId: calEv.extendedProps.supplierId };
          const colors = getPublicEventColor(mockEv);
          calEv.setProp('backgroundColor', colors.bg);
          calEv.setProp('borderColor', colors.border);
        }
      }
    } catch {
      showToast('Could not update. Please try again.', 'error');
    }
  }

  // ── Public Event Modal (publisher only) ────────────────────────────────────

  function ensurePublicEventModal() {
    const MODAL_ID = 'sup-cal-pub-event-modal';
    const existing = document.getElementById(MODAL_ID);
    if (existing) {
      return existing;
    }

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'cal-entry-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'sup-cal-pub-event-modal-title');

    overlay.innerHTML = `
      <div class="cal-entry-modal" role="document">
        <div class="cal-entry-modal__header">
          <h2 class="cal-entry-modal__title" id="sup-cal-pub-event-modal-title">Add Public Event</h2>
          <button type="button" class="ef-cta cal-entry-modal__close" aria-label="Close dialog">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <form class="cal-entry-modal__form" id="sup-cal-pub-event-form" novalidate>
          <input type="hidden" id="sup-cal-pub-event-id" name="id" value="">
          <div class="cal-entry-modal__field">
            <label for="sup-cal-pub-title" class="cal-entry-modal__label">Title <span aria-hidden="true">*</span></label>
            <input type="text" id="sup-cal-pub-title" name="title" class="cal-entry-modal__input" maxlength="120" required aria-required="true" placeholder="e.g. Wedding Fayre – Spring 2026">
          </div>
          <div class="cal-entry-modal__field">
            <label for="sup-cal-pub-start" class="cal-entry-modal__label">Start Date <span aria-hidden="true">*</span></label>
            <input type="date" id="sup-cal-pub-start" name="startDate" class="cal-entry-modal__input" required aria-required="true">
          </div>
          <div class="cal-entry-modal__field">
            <label for="sup-cal-pub-end" class="cal-entry-modal__label">End Date <span class="cal-entry-modal__optional">(optional)</span></label>
            <input type="date" id="sup-cal-pub-end" name="endDate" class="cal-entry-modal__input">
          </div>
          <div class="cal-entry-modal__field">
            <label for="sup-cal-pub-location" class="cal-entry-modal__label">Location <span class="cal-entry-modal__optional">(optional)</span></label>
            <input type="text" id="sup-cal-pub-location" name="location" class="cal-entry-modal__input" maxlength="200" placeholder="e.g. London, UK">
          </div>
          <div class="cal-entry-modal__field">
            <label for="sup-cal-pub-description" class="cal-entry-modal__label">Description <span class="cal-entry-modal__optional">(optional)</span></label>
            <textarea id="sup-cal-pub-description" name="description" class="cal-entry-modal__input cal-entry-modal__textarea" maxlength="1000" rows="3" placeholder="Describe your event…"></textarea>
          </div>
          <p class="cal-entry-modal__error" id="sup-cal-pub-event-error" role="alert" aria-live="assertive" hidden></p>
          <div class="cal-entry-modal__actions">
            <button type="button" class="cal-entry-modal__btn cal-entry-modal__btn--cancel" id="sup-cal-pub-event-cancel">Cancel</button>
            <button type="submit" class="cal-entry-modal__btn cal-entry-modal__btn--save" id="sup-cal-pub-event-submit">Publish Event</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay
      .querySelector('.cal-entry-modal__close')
      .addEventListener('click', () => closePublicEventModal(overlay));
    overlay
      .querySelector('#sup-cal-pub-event-cancel')
      .addEventListener('click', () => closePublicEventModal(overlay));
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        closePublicEventModal(overlay);
      }
    });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closePublicEventModal(overlay);
      }
    });
    overlay
      .querySelector('#sup-cal-pub-event-form')
      .addEventListener('submit', e => submitPublicEventForm(e, overlay));

    return overlay;
  }

  function openPublicEventModal(eventId, dateStr) {
    const modal = ensurePublicEventModal();
    const titleEl = modal.querySelector('#sup-cal-pub-event-modal-title');
    const idInput = modal.querySelector('#sup-cal-pub-event-id');
    const titleInput = modal.querySelector('#sup-cal-pub-title');
    const startInput = modal.querySelector('#sup-cal-pub-start');
    const endInput = modal.querySelector('#sup-cal-pub-end');
    const locationInput = modal.querySelector('#sup-cal-pub-location');
    const descInput = modal.querySelector('#sup-cal-pub-description');
    const errorEl = modal.querySelector('#sup-cal-pub-event-error');
    const submitBtn = modal.querySelector('#sup-cal-pub-event-submit');

    if (eventId) {
      // Edit mode
      const ev = calendarInstance && calendarInstance.getEventById(`pub_${eventId}`);
      titleEl.textContent = 'Edit Public Event';
      submitBtn.textContent = 'Save Changes';
      idInput.value = eventId;
      titleInput.value = ev ? ev.title : '';
      startInput.value = ev ? (ev.startStr || '').slice(0, 10) : '';
      endInput.value = ev && ev.endStr ? ev.endStr.slice(0, 10) : '';
      locationInput.value = ev ? ev.extendedProps.location || '' : '';
      descInput.value = ev ? ev.extendedProps.description || '' : '';
    } else {
      // Create mode
      titleEl.textContent = 'Add Public Event';
      submitBtn.textContent = 'Publish Event';
      idInput.value = '';
      titleInput.value = '';
      startInput.value = dateStr || new Date().toISOString().slice(0, 10);
      endInput.value = '';
      locationInput.value = '';
      descInput.value = '';
    }
    errorEl.hidden = true;
    submitBtn.disabled = false;

    holdFocus(modal);
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('cal-entry-modal-overlay--visible'));
    titleInput.focus();
  }

  function closePublicEventModal(modal) {
    returnFocus(modal, 'sup-cal-add-event-btn');
    modal.classList.remove('cal-entry-modal-overlay--visible');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 200);
  }

  async function submitPublicEventForm(e, modal) {
    e.preventDefault();
    const form = e.target;
    const eventId = form.querySelector('#sup-cal-pub-event-id').value;
    const title = form.querySelector('#sup-cal-pub-title').value.trim();
    const startDate = form.querySelector('#sup-cal-pub-start').value;
    const endDate = form.querySelector('#sup-cal-pub-end').value;
    const location = form.querySelector('#sup-cal-pub-location').value.trim();
    const description = form.querySelector('#sup-cal-pub-description').value.trim();
    const errorEl = modal.querySelector('#sup-cal-pub-event-error');
    const submitBtn = modal.querySelector('#sup-cal-pub-event-submit');

    if (!title) {
      showFieldError(errorEl, 'Please enter a title.');
      form.querySelector('#sup-cal-pub-title').focus();
      return;
    }
    if (!startDate) {
      showFieldError(errorEl, 'Please select a start date.');
      form.querySelector('#sup-cal-pub-start').focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    errorEl.hidden = true;

    const token = await ensureCsrfToken();
    const body = { title, startDate };
    if (endDate) {
      body.endDate = endDate;
    }
    if (location) {
      body.location = location;
    }
    if (description) {
      body.description = description;
    }

    try {
      const url = eventId
        ? `/api/v1/public-calendar/events/${eventId}`
        : '/api/v1/public-calendar/events';
      const method = eventId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Failed (${res.status})`);
      }

      const data = await res.json();
      const ev = data.event || data;

      if (calendarInstance) {
        if (eventId) {
          // Update existing event on calendar
          const existing = calendarInstance.getEventById(`pub_${eventId}`);
          if (existing) {
            existing.setProp('title', displayTitle(ev.title));
            existing.setStart(ev.startDate);
            if (ev.endDate) {
              existing.setEnd(ev.endDate);
            }
            existing.setExtendedProp('location', ev.location || '');
            existing.setExtendedProp('description', ev.description || '');
          }
        } else {
          // Add new event to calendar
          const colors = getPublicEventColor(ev);
          calendarInstance.addEvent({
            id: `pub_${ev.id}`,
            title: displayTitle(ev.title),
            start: ev.startDate,
            end: ev.endDate || undefined,
            backgroundColor: colors.bg,
            classNames: ['sdh-ev--public', 'sdh-ev--own'],
            borderColor: colors.border,
            extendedProps: {
              supplierId: ev.supplierId,
              description: ev.description || '',
              location: ev.location || '',
              publicEvent: true,
              ownEvent: true,
              rawId: ev.id,
            },
          });
        }
      }

      closePublicEventModal(modal);
      showToast(eventId ? 'Event updated.' : 'Event published to shared calendar.', 'success');
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = eventId ? 'Save Changes' : 'Publish Event';
      showFieldError(errorEl, err.message || 'Failed to save. Please try again.');
    }
  }

  function showDeletePublicEventConfirm(ev) {
    const dialog = document.createElement('div');
    dialog.className = 'cal-entry-modal-overlay';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Confirm delete public event');
    dialog.style.display = 'flex';
    dialog.innerHTML = `
      <div class="cal-entry-modal cal-entry-modal--narrow" role="document">
        <div class="cal-entry-modal__header">
          <h2 class="cal-entry-modal__title">Delete public event?</h2>
        </div>
        <div class="cal-entry-modal__form">
          <p class="cal-entry-modal__text">"${escapeHtml(ev.title)}" will be removed from the shared calendar permanently.</p>
          <div class="cal-entry-modal__actions">
            <button type="button" class="cal-entry-modal__btn cal-entry-modal__btn--cancel" id="sup-del-pub-cancel">Cancel</button>
            <button type="button" class="cal-entry-modal__btn cal-entry-modal__btn--danger" id="sup-del-pub-confirm">Delete event</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    holdFocus(dialog);
    requestAnimationFrame(() => dialog.classList.add('cal-entry-modal-overlay--visible'));

    const rawId = ev.extendedProps ? ev.extendedProps.rawId : null;

    const closeConfirm = () => {
      returnFocus(dialog, 'sup-cal-add-event-btn');
      dialog.classList.remove('cal-entry-modal-overlay--visible');
      setTimeout(() => dialog.remove(), 200);
    };
    dialog.querySelector('#sup-del-pub-cancel').addEventListener('click', closeConfirm);
    dialog.querySelector('#sup-del-pub-confirm').addEventListener('click', async () => {
      closeConfirm();
      await deletePublicEvent(rawId || ev.id);
    });
    dialog.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeConfirm();
      }
    });
    dialog.querySelector('#sup-del-pub-cancel').focus();
  }

  async function deletePublicEvent(eventId) {
    const token = await ensureCsrfToken();
    try {
      const res = await fetch(`/api/v1/public-calendar/events/${eventId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-CSRF-Token': token },
      });
      if (!res.ok) {
        throw new Error('Delete failed');
      }
      if (calendarInstance) {
        const ev = calendarInstance.getEventById(`pub_${eventId}`);
        if (ev) {
          ev.remove();
        }
      }
      showToast('Public event deleted.', 'success');
    } catch {
      showToast('Could not delete event. Please try again.', 'error');
    }
  }

  // ── Calendar Initialization ────────────────────────────────────────────────

  // FullCalendar loads from a CDN (see the <script defer> tag two lines above
  // this file's own in dashboard-supplier.html). `defer` scripts run in
  // document order, so in the normal case FullCalendar is already defined by
  // the time this runs — but a slow or blocked CDN request can still leave it
  // undefined for real users. Give it a few short retries before showing the
  // fallback, so a merely-slow load doesn't read as a permanent failure.
  function waitForFullCalendar(attemptsLeft = 8, delayMs = 250) {
    return new Promise(resolve => {
      if (typeof FullCalendar !== 'undefined') {
        resolve(true);
        return;
      }
      if (attemptsLeft <= 0) {
        resolve(false);
        return;
      }
      setTimeout(() => {
        resolve(waitForFullCalendar(attemptsLeft - 1, delayMs));
      }, delayMs);
    });
  }

  function renderCalendarUnavailable(container) {
    container.innerHTML =
      '<div class="cal-fallback-empty">' +
      '<p class="cal-fallback-empty__text">We couldn’t load the calendar. Check your connection and try again.</p>' +
      '<button type="button" class="cal-fallback-empty__retry ef-cta">Try again</button>' +
      '</div>';
    const retryBtn = container.querySelector('.cal-fallback-empty__retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => initSupplierCalendar());
    }
  }

  async function initSupplierCalendar() {
    const container = document.getElementById('supplier-events-calendar');
    if (!container) {
      return;
    }

    if (typeof FullCalendar === 'undefined') {
      const becameAvailable = await waitForFullCalendar();
      if (!becameAvailable) {
        renderCalendarUnavailable(container);
        return;
      }
    }

    await ensureCsrfToken();
    await loadSupplierProfile();
    updateCalendarHeader();
    bindPublisherDialog();
    renderMyPublicEvents();

    const entryModal = ensureEntryModal();
    if (isPublisher) {
      ensurePublicEventModal();
    }

    // Wire the "Add Entry" button (personal entries — all suppliers)
    const addEntryBtn = document.getElementById('sup-cal-add-entry-btn');
    if (addEntryBtn && !addEntryBtn._calWired) {
      addEntryBtn._calWired = true;
      addEntryBtn.addEventListener('click', () => {
        const today = new Date().toISOString().slice(0, 10);
        openEntryModal(entryModal, today);
      });
    }

    // Wire the "Add Event" button (public events — publisher only)
    const addEventBtn = document.getElementById('sup-cal-add-event-btn');
    if (addEventBtn && !addEventBtn._calWired) {
      addEventBtn._calWired = true;
      addEventBtn.addEventListener('click', () => {
        openPublicEventModal(null, new Date().toISOString().slice(0, 10));
      });
    }

    let allEvents = [];

    // 1. Load saved event IDs first (for correct colour coding)
    try {
      const savedRes = await fetch('/api/v1/public-calendar/events/saved', {
        credentials: 'include',
      });
      if (savedRes.ok) {
        const savedData = await savedRes.json();
        (savedData.events || []).forEach(ev => savedEventIds.add(String(ev.id)));
      }
    } catch {
      /* ignore — saved events are optional */
    }

    // 2. Load all public calendar events
    try {
      const pubRes = await fetch('/api/v1/public-calendar/events', { credentials: 'include' });
      if (pubRes.ok) {
        const pubData = await pubRes.json();
        const pubEvents = (pubData.events || []).map(ev => {
          const colors = getPublicEventColor(ev);
          const isOwn = currentSupplier && String(ev.supplierId) === String(currentSupplier.id);
          return {
            id: `pub_${ev.id}`,
            title: displayTitle(ev.title || 'Public Event'),
            start: ev.startDate,
            end: ev.endDate || undefined,
            backgroundColor: colors.bg,
            classNames: ['sdh-ev--public'].concat(
              isOwn ? ['sdh-ev--own'] : [],
              savedEventIds.has(String(ev.id)) ? ['sdh-ev--saved'] : []
            ),
            borderColor: colors.border,
            extendedProps: {
              supplierId: ev.supplierId,
              description: ev.description || '',
              location: ev.location || '',
              publicEvent: true,
              ownEvent: isOwn,
              rawId: ev.id,
            },
          };
        });
        allEvents = allEvents.concat(pubEvents);
      }
    } catch {
      /* ignore */
    }

    // 3. Load personal calendar entries (meeting / event / appointment)
    try {
      const entryRes = await fetch('/api/me/calendar-entries', { credentials: 'include' });
      if (entryRes.ok) {
        const entryData = await entryRes.json();
        const entries = (entryData.entries || []).map(entry => ({
          id: entry.id,
          title: displayTitle(entry.title),
          start: entry.time ? `${entry.date}T${entry.time}` : entry.date,
          allDay: !entry.time,
          backgroundColor: getEntryColor(entry.type),
          classNames: ['sdh-ev--private'],
          borderColor: getEntryColor(entry.type),
          extendedProps: {
            entryType: entry.type,
            description: entry.description,
            personalEntry: true,
          },
        }));
        allEvents = allEvents.concat(entries);
      }
    } catch {
      /* ignore — personal entries are optional */
    }

    container.classList.add('fc-loaded');

    calendarInstance = new FullCalendar.Calendar(container, {
      // A month grid is too narrow to read on a phone: start on the week list there.
      initialView: window.matchMedia?.('(max-width: 639px)').matches ? 'listWeek' : 'dayGridMonth',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,listWeek',
      },
      buttonText: {
        today: 'Today',
        month: 'Month',
        week: 'Week',
        list: 'List',
      },
      events: allEvents,
      expandRows: false,
      contentHeight: 'auto',
      selectable: true,
      nowIndicator: true,
      // Click on a day cell — open personal entry modal
      dateClick: function (info) {
        openEntryModal(entryModal, info.dateStr);
      },
      eventClick: function (info) {
        info.jsEvent.preventDefault();
        if (info.event.extendedProps.personalEntry) {
          showDeletePopover(info.el, info.event.id, info.event.title, calendarInstance);
          return;
        }
        if (info.event.extendedProps.publicEvent) {
          showPublicEventPopover(info.el, info.event);
          return;
        }
      },
      eventDidMount: function (info) {
        const desc = info.event.extendedProps.description;
        const loc = info.event.extendedProps.location;
        const entryType = info.event.extendedProps.entryType;
        if (desc || loc || entryType) {
          const tooltip = document.createElement('div');
          tooltip.className = 'calendar-tooltip';

          const typeLabel = entryType
            ? `<span class="calendar-tooltip__type">${escapeHtml(entryType)}</span><br>`
            : '';
          const clickHint = info.event.extendedProps.personalEntry
            ? '<br><small class="calendar-tooltip__hint">Click to delete</small>'
            : info.event.extendedProps.publicEvent
              ? '<br><small class="calendar-tooltip__hint">Click for options</small>'
              : '';

          tooltip.innerHTML = `
            ${typeLabel}
            <strong>${escapeHtml(info.event.title)}</strong>
            ${loc ? `<br><small>${escapeHtml(loc)}</small>` : ''}
            ${desc ? `<br><small class="calendar-tooltip__hint">${escapeHtml(String(desc).substring(0, 120))}${String(desc).length > 120 ? '…' : ''}</small>` : ''}
            ${clickHint}
          `;

          info.el.addEventListener('mouseenter', () => {
            document.body.appendChild(tooltip);
            const rect = info.el.getBoundingClientRect();
            tooltip.classList.add('is-visible');
            tooltip.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;
            tooltip.style.top = `${rect.bottom + 6}px`;
          });
          info.el.addEventListener('mouseleave', () => {
            tooltip.classList.remove('is-visible');
            if (tooltip.parentNode) {
              tooltip.parentNode.removeChild(tooltip);
            }
          });
        }
      },
      // "+" hint on day cells for quick entry creation
      dayCellDidMount(info) {
        // Day cells carry a Date (not a dateStr, which only click and select callbacks have).
        const cellDate = localIsoDate(info.date);
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'cal-day-add-btn';
        addBtn.setAttribute(
          'aria-label',
          `Add entry for ${info.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
        );
        // The "Add private entry" button is the keyboard route; one tab stop per day (42 a month)
        // would bury everything below the calendar. These stay for pointer and touch use, and for
        // a screen reader's own navigation.
        addBtn.tabIndex = -1;
        addBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
          '<path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
          '</svg>';
        addBtn.addEventListener('click', e => {
          e.stopPropagation();
          openEntryModal(entryModal, cellDate);
        });
        const frame = info.el.querySelector('.fc-daygrid-day-frame');
        if (frame) {
          frame.appendChild(addBtn);
        }
      },
      noEventsContent: function () {
        return {
          html: '<div class="cal-no-events">No events yet. Use Add private entry to add one.</div>',
        };
      },
      // FullCalendar marks its chevron glyphs role="img" with no name; the buttons carry the
      // names, so the glyphs are decoration.
      datesSet() {
        container.querySelectorAll('.fc-icon[role="img"]').forEach(icon => {
          icon.removeAttribute('role');
          icon.setAttribute('aria-hidden', 'true');
        });
      },
      height: 'auto',
    });

    calendarInstance.render();
    container._calendarInstance = calendarInstance;
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupplierCalendar);
  } else {
    initSupplierCalendar();
  }
})();
