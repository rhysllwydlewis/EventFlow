/**
 * Calendar View for Events
 * Integrates FullCalendar to display user events, saved public events,
 * and personal calendar entries (meetings / events / appointments).
 *
 * Clicking an empty day cell (or the "Add Entry" button in the card header)
 * opens a modal so customers can quickly record a meeting, event, or appointment.
 * Clicking a personal entry offers a delete confirmation.
 */

(function () {
  'use strict';

  // ── Toast ─────────────────────────────────────────────────────────────────

  /**
   * Show a brief success/error toast in the top-right of the screen.
   * @param {string} message
   * @param {'success'|'error'} [type='success']
   */

  function displayTitle(value) {
    const title = String(value || '').trim();
    return title ? title.charAt(0).toUpperCase() + title.slice(1) : '';
  }

  function showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `cal-toast cal-toast--${type || 'success'}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    document.body.appendChild(toast);
    // Animate in
    requestAnimationFrame(() => toast.classList.add('cal-toast--visible'));
    // Auto-remove
    setTimeout(() => {
      toast.classList.remove('cal-toast--visible');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 3000);
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  /**
   * Lazily create (and cache) the entry-creation modal in the document.
   * @returns {HTMLElement} The modal overlay element.
   */
  function ensureModal() {
    const MODAL_ID = 'cal-entry-modal';
    const existing = document.getElementById(MODAL_ID);
    if (existing) {
      return existing;
    }

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'cal-entry-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cal-entry-modal-title');

    overlay.innerHTML = `
      <div class="cal-entry-modal" role="document">
        <div class="cal-entry-modal__header">
          <h2 class="cal-entry-modal__title" id="cal-entry-modal-title">Add Calendar Entry</h2>
          <button type="button" class="ef-cta cal-entry-modal__close" aria-label="Close dialog">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <form class="cal-entry-modal__form" id="cal-entry-form" novalidate>
          <div class="cal-entry-modal__field">
            <label for="cal-entry-title" class="cal-entry-modal__label">Title <span aria-hidden="true">*</span></label>
            <input type="text" id="cal-entry-title" name="title" class="cal-entry-modal__input" maxlength="100" required aria-required="true" placeholder="e.g. Venue walkthrough">
          </div>
          <div class="cal-entry-modal__field">
            <label for="cal-entry-type" class="cal-entry-modal__label">Type <span aria-hidden="true">*</span></label>
            <select id="cal-entry-type" name="type" class="cal-entry-modal__input" required aria-required="true">
              <option value="">— Select type —</option>
              <option value="meeting">Meeting</option>
              <option value="event">Event</option>
              <option value="appointment">Appointment</option>
            </select>
          </div>
          <div class="cal-entry-modal__row">
            <div class="cal-entry-modal__field">
              <label for="cal-entry-date" class="cal-entry-modal__label">Date <span aria-hidden="true">*</span></label>
              <input type="date" id="cal-entry-date" name="date" class="cal-entry-modal__input" required aria-required="true">
            </div>
            <div class="cal-entry-modal__field">
              <label for="cal-entry-time" class="cal-entry-modal__label">Time <span class="cal-entry-modal__optional">(optional)</span></label>
              <input type="time" id="cal-entry-time" name="time" class="cal-entry-modal__input">
            </div>
          </div>
          <div class="cal-entry-modal__field">
            <label for="cal-entry-description" class="cal-entry-modal__label">Notes <span class="cal-entry-modal__optional">(optional)</span></label>
            <textarea id="cal-entry-description" name="description" class="cal-entry-modal__textarea" maxlength="500" rows="3" placeholder="Any additional notes…"></textarea>
          </div>
          <div id="cal-entry-error" class="cal-entry-modal__error" role="alert" aria-live="polite" style="display:none;"></div>
          <div class="cal-entry-modal__actions">
            <button type="button" class="ef-cta cal-entry-modal__btn cal-entry-modal__btn--cancel">Cancel</button>
            <button type="submit" class="ef-cta cal-entry-modal__btn cal-entry-modal__btn--save" id="cal-entry-save-btn">
              <span class="cal-entry-save-label">Add Entry</span>
              <span class="cal-entry-save-spinner" style="display:none;" aria-hidden="true">⏳</span>
            </button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close on overlay backdrop click
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        closeModal(overlay);
      }
    });

    // Close on Escape key
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeModal(overlay);
      }
    });

    overlay.querySelector('.cal-entry-modal__close').addEventListener('click', () => {
      closeModal(overlay);
    });
    overlay.querySelector('.cal-entry-modal__btn--cancel').addEventListener('click', () => {
      closeModal(overlay);
    });

    return overlay;
  }

  /**
   * Open the Add/Edit modal.
   *
   * @param {HTMLElement}   overlay         - The modal overlay element from ensureModal()
   * @param {string}        [dateStr]        - Pre-fill the date field (YYYY-MM-DD)
   * @param {Object|null}   [calendarInstance] - FullCalendar instance (or null in fallback mode)
   * @param {Object|null}   [entryToEdit]   - If provided, the modal opens in edit mode
   *   with fields pre-filled from entryToEdit and submits a PUT instead of POST.
   */
  function openModal(overlay, dateStr, calendarInstance, entryToEdit = null) {
    const titleInput = overlay.querySelector('#cal-entry-title');
    const typeSelect = overlay.querySelector('#cal-entry-type');
    const dateInput = overlay.querySelector('#cal-entry-date');
    const timeInput = overlay.querySelector('#cal-entry-time');
    const descInput = overlay.querySelector('#cal-entry-description');
    const errorEl = overlay.querySelector('#cal-entry-error');
    const form = overlay.querySelector('#cal-entry-form');
    const modalTitle = overlay.querySelector('#cal-entry-modal-title');
    const saveBtn = overlay.querySelector('#cal-entry-save-btn');
    const saveLabel = saveBtn ? saveBtn.querySelector('.cal-entry-save-label') : null;

    const isEditing = Boolean(entryToEdit);

    // Abort any submit listener from a previous open (prevents stacking)
    if (overlay._submitAC) {
      overlay._submitAC.abort();
    }
    const ac = new AbortController();
    overlay._submitAC = ac;

    // Set modal title and submit button label to match add/edit mode
    if (modalTitle) {
      modalTitle.textContent = isEditing ? 'Edit Calendar Entry' : 'Add Calendar Entry';
    }
    if (saveLabel) {
      saveLabel.textContent = isEditing ? 'Save Changes' : 'Add Entry';
    }

    // Reset form, then pre-fill if editing
    form.reset();
    if (isEditing) {
      titleInput.value = entryToEdit.title || '';
      typeSelect.value = entryToEdit.type || '';
      dateInput.value = entryToEdit.date || '';
      timeInput.value = entryToEdit.time || '';
      if (descInput) {
        descInput.value = entryToEdit.description || '';
      }
    } else if (dateStr) {
      dateInput.value = dateStr;
    }

    if (errorEl) {
      errorEl.style.display = 'none';
      errorEl.textContent = '';
    }

    overlay.style.display = 'flex';
    overlay.removeAttribute('hidden');

    let submitting = false;

    // Wire submit — auto-removed when ac is aborted (on close or next open).
    form.addEventListener(
      'submit',
      async e => {
        e.preventDefault();
        if (submitting) {
          return;
        }

        const title = titleInput.value.trim();
        const type = typeSelect.value;
        const date = dateInput.value;
        const time = timeInput.value || null;
        const description = descInput ? descInput.value.trim() : '';

        // Client-side validation
        if (!title) {
          showModalError(errorEl, 'Please enter a title.');
          titleInput.focus();
          return;
        }
        if (!type) {
          showModalError(errorEl, 'Please select an entry type.');
          typeSelect.focus();
          return;
        }
        if (!date) {
          showModalError(errorEl, 'Please select a date.');
          dateInput.focus();
          return;
        }

        submitting = true;
        if (saveBtn) {
          saveBtn.disabled = true;
        }
        const saveSpinner = saveBtn ? saveBtn.querySelector('.cal-entry-save-spinner') : null;
        if (saveLabel) {
          saveLabel.textContent = 'Saving…';
        }
        if (saveSpinner) {
          saveSpinner.style.display = '';
        }
        if (errorEl) {
          errorEl.style.display = 'none';
          errorEl.textContent = '';
        }

        try {
          const csrfToken = getCsrfTokenFromPage();
          const url = isEditing
            ? `/api/me/calendar-entries/${encodeURIComponent(entryToEdit.id)}`
            : '/api/me/calendar-entries';
          const method = isEditing ? 'PUT' : 'POST';

          const resp = await fetch(url, {
            method,
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({ title, type, date, time, description }),
          });

          const data = await resp.json();

          if (!resp.ok) {
            throw new Error(
              data.error || (isEditing ? 'Failed to update entry' : 'Failed to save entry')
            );
          }

          if (isEditing) {
            // Update the event in FullCalendar if available
            if (calendarInstance && data.entry) {
              const ev = calendarInstance.getEventById(entryToEdit.id);
              if (ev) {
                const newStart = data.entry.time
                  ? `${data.entry.date}T${data.entry.time}`
                  : data.entry.date;
                ev.setProp('title', displayTitle(data.entry.title));
                ev.setStart(newStart);
                ev.setAllDay(!data.entry.time);
                ev.setProp('backgroundColor', getEntryColor(data.entry.type));
                ev.setProp('borderColor', getEntryColor(data.entry.type));
                ev.setExtendedProp('entryType', data.entry.type);
                ev.setExtendedProp('description', data.entry.description);
                ev.setExtendedProp('rawEntry', data.entry);
              }
            } else if (!calendarInstance) {
              // Fallback list mode: re-render
              const calEl = document.getElementById('events-calendar');
              if (calEl) {
                await renderFallbackCalendar(calEl);
              }
            }
            if (calendarInstance) {
              renderNextUpFromCalendar(calendarInstance);
            }
            showToast(`"${title}" updated`, 'success');
          } else {
            // Immediately add the new event to the calendar without a full reload
            if (calendarInstance && data.entry) {
              const entry = data.entry;
              const start = entry.time ? `${entry.date}T${entry.time}` : entry.date;
              calendarInstance.addEvent({
                id: entry.id,
                title: displayTitle(entry.title),
                start,
                allDay: !entry.time,
                backgroundColor: getEntryColor(entry.type),
                borderColor: getEntryColor(entry.type),
                extendedProps: {
                  entryType: entry.type,
                  description: entry.description,
                  personalEntry: true,
                  rawEntry: entry,
                },
              });
            } else if (!calendarInstance) {
              // Fallback mode: re-render the list so the new entry appears
              const calEl = document.getElementById('events-calendar');
              if (calEl) {
                await renderFallbackCalendar(calEl);
              }
            }
            if (calendarInstance) {
              renderNextUpFromCalendar(calendarInstance);
            }
            showToast(`"${title}" added to your calendar`, 'success');
          }

          closeModal(overlay);
        } catch (err) {
          showModalError(errorEl, err.message || 'Could not save the entry. Please try again.');
        } finally {
          submitting = false;
          if (saveBtn) {
            saveBtn.disabled = false;
          }
          if (saveLabel) {
            saveLabel.textContent = isEditing ? 'Save Changes' : 'Add Entry';
          }
          if (saveSpinner) {
            saveSpinner.style.display = 'none';
          }
        }
      },
      { signal: ac.signal }
    );

    // Focus the title field for keyboard accessibility
    setTimeout(() => titleInput.focus(), 60);
  }

  function closeModal(overlay) {
    // Clean up any pending submit listener
    if (overlay._submitAC) {
      overlay._submitAC.abort();
      overlay._submitAC = null;
    }
    overlay.style.display = 'none';
    overlay.setAttribute('hidden', '');
  }

  function showModalError(errorEl, message) {
    if (!errorEl) {
      return;
    }
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }

  /** Read CSRF token from the page (meta tag → global → cookie). */
  function getCsrfTokenFromPage() {
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

  // ── Next-up summary ──────────────────────────────────────────────────────

  function normalizeCalendarItem(event) {
    const start = event.start instanceof Date ? event.start : new Date(event.start);
    if (Number.isNaN(start.getTime())) {
      return null;
    }
    return {
      id: event.id,
      title: event.title || 'Untitled entry',
      start,
      type:
        event.extendedProps?.entryType ||
        (event.extendedProps?.publicEvent ? 'public event' : event.type || 'event'),
      location: event.extendedProps?.location || event.location || '',
      color:
        event.backgroundColor || event.borderColor || getEntryColor(event.extendedProps?.entryType),
    };
  }

  function formatDateTime(date) {
    return date.toLocaleString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/London',
    });
  }

  function renderNextUpSummary(rawEvents) {
    const panel = document.getElementById('calendar-next-up');
    if (!panel) {
      return;
    }

    const now = new Date();
    const next = (rawEvents || [])
      .map(normalizeCalendarItem)
      .filter(item => item && item.start >= now)
      .sort((a, b) => a.start - b.start)[0];

    const body = panel.querySelector('.customer-calendar-next-up__body');
    if (!body) {
      return;
    }

    if (!next) {
      body.textContent =
        'No upcoming meetings, appointments, or events yet. Add one above and it will appear here.';
      return;
    }

    const location = next.location
      ? `<div class="customer-calendar-next-up__meta">📍 ${escapeHtml(next.location)}</div>`
      : '';
    body.innerHTML = `
      <div><span class="customer-calendar-next-up__badge" style="background:${escapeHtml(next.color)};">${escapeHtml(next.type)}</span><span class="customer-calendar-next-up__title">${escapeHtml(next.title)}</span></div>
      <div class="customer-calendar-next-up__meta">${escapeHtml(formatDateTime(next.start))}</div>
      ${location}
    `;
  }

  function renderNextUpFromCalendar(calendarInstance) {
    if (!calendarInstance) {
      return;
    }
    renderNextUpSummary(calendarInstance.getEvents());
  }

  // ── Entry actions popover ─────────────────────────────────────────────────

  /**
   * Show a small inline popover offering Edit and Delete actions for a personal
   * calendar entry.  The popover is anchored near the clicked element.
   *
   * Edit opens the modal pre-filled with the entry's current data and submits
   * a PUT request on save.  Delete shows an inline confirmation before calling
   * the DELETE endpoint.
   *
   * @param {HTMLElement}  anchorEl         - Element to anchor the popover near
   * @param {Object}       entry            - The raw calendar entry object
   * @param {Object|null}  calendarInstance - FullCalendar instance (or null)
   * @param {HTMLElement}  modal            - The modal overlay from ensureModal()
   */
  function showEntryActions(anchorEl, entry, calendarInstance, modal) {
    // Remove any existing popover
    document.querySelectorAll('.cal-delete-popover').forEach(el => el.remove());

    const pop = document.createElement('div');
    pop.className = 'cal-delete-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Entry actions');
    pop.innerHTML = `
      <p class="cal-delete-popover__msg">${escapeHtml(entry.title)}</p>
      <div class="cal-delete-popover__actions">
        <button type="button" class="ef-cta cal-delete-popover__btn cal-delete-popover__btn--edit">Edit</button>
        <button type="button" class="ef-cta cal-delete-popover__btn cal-delete-popover__btn--delete">Delete</button>
      </div>
    `;
    document.body.appendChild(pop);

    // Position near the anchor
    const rect = anchorEl.getBoundingClientRect();
    const popWidth = 220;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popWidth - 8));
    pop.className = 'ef-cal-popup';
    pop.style.left = `${left}px`;
    pop.style.top = `${rect.bottom + 6}px`;
    pop.style.width = `${popWidth}px`;

    // Trap first focus on the Edit button
    setTimeout(() => pop.querySelector('.cal-delete-popover__btn--edit').focus(), 50);

    const dismiss = () => {
      if (pop.parentNode) {
        pop.parentNode.removeChild(pop);
      }
      document.removeEventListener('click', outsideClick, true);
    };

    function outsideClick(e) {
      if (!pop.contains(e.target) && e.target !== anchorEl) {
        dismiss();
      }
    }

    pop.querySelector('.cal-delete-popover__btn--edit').addEventListener('click', () => {
      dismiss();
      openModal(modal, null, calendarInstance, entry);
    });

    pop.querySelector('.cal-delete-popover__btn--delete').addEventListener('click', () => {
      // Replace popover content with inline delete confirmation
      pop.innerHTML = `
        <p class="cal-delete-popover__msg">Delete <strong>${escapeHtml(entry.title)}</strong>?</p>
        <div class="cal-delete-popover__actions">
          <button type="button" class="ef-cta cal-delete-popover__btn cal-delete-popover__btn--cancel">Keep</button>
          <button type="button" class="ef-cta cal-delete-popover__btn cal-delete-popover__btn--confirm">Delete</button>
        </div>
      `;

      pop.querySelector('.cal-delete-popover__btn--cancel').addEventListener('click', dismiss);

      pop.querySelector('.cal-delete-popover__btn--confirm').addEventListener('click', async () => {
        dismiss();
        try {
          const csrfToken = getCsrfTokenFromPage();
          const resp = await fetch(`/api/me/calendar-entries/${encodeURIComponent(entry.id)}`, {
            method: 'DELETE',
            credentials: 'include',
            headers: { 'X-CSRF-Token': csrfToken },
          });
          if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to delete entry');
          }
          // Remove from calendar UI
          if (calendarInstance) {
            const ev = calendarInstance.getEventById(entry.id);
            if (ev) {
              ev.remove();
            }
            renderNextUpFromCalendar(calendarInstance);
          } else {
            // Fallback list mode: remove the row or refresh the list
            const listItem = anchorEl.closest('.cal-fallback-item');
            if (listItem) {
              listItem.remove();
              const calEl = document.getElementById('events-calendar');
              if (calEl) {
                await renderFallbackCalendar(calEl);
              }
            }
          }
          showToast('Entry deleted', 'success');
        } catch (err) {
          showToast(err.message || 'Could not delete entry', 'error');
        }
      });

      setTimeout(() => pop.querySelector('.cal-delete-popover__btn--cancel').focus(), 50);
    });

    pop.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        dismiss();
      }
    });

    // Defer the outside-click listener so this click doesn't immediately close
    setTimeout(() => document.addEventListener('click', outsideClick, true), 100);
  }

  // ── Calendar initialisation ───────────────────────────────────────────────

  /**
   * Build a lightweight month grid used when the FullCalendar CDN is unavailable.
   * It keeps the dashboard visibly calendar-shaped instead of collapsing to an empty message.
   */
  function buildFallbackMonth(entries) {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - monthStart.getDay());

    const byDay = new Map();
    entries.forEach(entry => {
      const entryDate = String(entry.date || '').slice(0, 10);
      if (!entryDate) {
        return;
      }
      if (!byDay.has(entryDate)) {
        byDay.set(entryDate, []);
      }
      byDay.get(entryDate).push(entry);
    });

    const cells = [];
    const cursor = new Date(gridStart);
    for (let i = 0; i < 42; i += 1) {
      const key = cursor.toISOString().slice(0, 10);
      const dayEntries = byDay.get(key) || [];
      const muted = cursor.getMonth() !== monthStart.getMonth();
      const isToday = key === today.toISOString().slice(0, 10);
      cells.push(`
        <button type="button" class="cal-fallback-day ${muted ? 'cal-fallback-day--muted' : ''} ${isToday ? 'cal-fallback-day--today' : ''}" data-date="${key}" aria-label="Add calendar entry for ${formatDate(key)}">
          <span class="cal-fallback-day__num">${cursor.getDate()}</span>
          <span class="cal-fallback-day__events">
            ${dayEntries
              .slice(0, 2)
              .map(
                entry =>
                  `<span class="cal-fallback-day__event" style="--cal-event-color:${entry.color || getEntryColor(entry.type)}">${escapeHtml(entry.title)}</span>`
              )
              .join('')}
            ${dayEntries.length > 2 ? `<span class="cal-fallback-day__more">+${dayEntries.length - 2} more</span>` : ''}
          </span>
        </button>`);
      cursor.setDate(cursor.getDate() + 1);
    }

    return `
      <div class="cal-fallback-month" role="application" aria-label="Calendar fallback month view">
        <div class="cal-fallback-month__header">
          <div>
            <div class="cal-fallback-month__eyebrow">Calendar view</div>
            <h4 class="cal-fallback-month__title">${monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h4>
          </div>
          <p class="cal-fallback-month__hint">Click any day to add an entry.</p>
        </div>
        <div class="cal-fallback-month__weekdays" aria-hidden="true">
          ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<span>${day}</span>`).join('')}
        </div>
        <div class="cal-fallback-month__grid">${cells.join('')}</div>
      </div>`;
  }

  async function fetchFallbackCalendarItems() {
    const calendarItems = [];
    let personalEntries = [];

    try {
      const response = await fetch('/api/v1/me/plans', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        (data.plans || []).forEach(plan => {
          const date = plan.eventDate || plan.date;
          if (!date) {
            return;
          }
          calendarItems.push({
            id: plan.id,
            title: displayTitle(plan.eventName || plan.title || 'Untitled Event'),
            date,
            time: '',
            type: 'event plan',
            color: getEventColor(plan.eventType || plan.type),
            start: date,
            backgroundColor: getEventColor(plan.eventType || plan.type),
            extendedProps: {
              entryType: 'event plan',
              location: plan.location || '',
              description: plan.description || '',
            },
          });
        });
      }
    } catch (_) {
      /* non-fatal: fallback still shows any other available calendar items */
    }

    try {
      const response = await fetch('/api/v1/public-calendar/events/saved', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        (data.events || []).forEach(event => {
          if (!event.startDate) {
            return;
          }
          const deleted =
            event.deleted === true || event.status === 'deleted' || event.isDeleted === true;
          calendarItems.push({
            id: `pce_${event.id}`,
            title: displayTitle(event.title || 'Public Event'),
            date: event.startDate.slice(0, 10),
            time: '',
            type: deleted ? 'removed public event' : 'public',
            color: deleted ? '#9ca3af' : '#7c3aed',
            start: event.startDate,
            backgroundColor: deleted ? '#9ca3af' : '#7c3aed',
            extendedProps: {
              entryType: deleted ? 'removed public event' : 'public',
              location: event.location || '',
              description: deleted
                ? event.warning ||
                  'This saved public event has been removed from the shared calendar.'
                : event.description || '',
              deletedEvent: deleted,
            },
          });
        });
      }
    } catch (_) {
      /* non-fatal */
    }

    try {
      const response = await fetch('/api/me/calendar-entries', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        personalEntries = (data.entries || []).sort((a, b) => a.date.localeCompare(b.date));
        personalEntries.forEach(entry => {
          calendarItems.push({
            ...entry,
            date: entry.date,
            time: entry.time || '',
            type: entry.type,
            color: getEntryColor(entry.type),
            start: entry.time ? `${entry.date}T${entry.time}` : `${entry.date}T00:00:00`,
            backgroundColor: getEntryColor(entry.type),
            extendedProps: {
              entryType: entry.type,
              description: entry.description,
              personalEntry: true,
            },
          });
        });
      }
    } catch (_) {
      /* non-fatal */
    }

    calendarItems.sort((a, b) =>
      String(a.start || a.date).localeCompare(String(b.start || b.date))
    );
    return { calendarItems, personalEntries };
  }

  /**
   * Render a fallback list-style calendar when FullCalendar is not available.
   * Shows existing personal entries and keeps the "Add Entry" button working.
   */
  async function renderFallbackCalendar(container) {
    // Mark the viewport so the min-height is not applied
    container.classList.add('fc-fallback');

    const { calendarItems, personalEntries } = await fetchFallbackCalendarItems();

    renderNextUpSummary(
      calendarItems.map(item => ({
        id: item.id,
        title: item.title,
        start: item.start || (item.time ? `${item.date}T${item.time}` : `${item.date}T00:00:00`),
        backgroundColor: item.backgroundColor || item.color || getEntryColor(item.type),
        extendedProps: item.extendedProps || {
          entryType: item.type,
          description: item.description,
        },
      }))
    );

    const fallbackWrap = document.createElement('div');
    fallbackWrap.className = 'cal-fallback-wrap';
    fallbackWrap.innerHTML = buildFallbackMonth(calendarItems);

    const listEl = document.createElement('ul');
    listEl.className = 'cal-fallback-list';

    if (personalEntries.length === 0) {
      listEl.innerHTML = `
        <li class="cal-fallback-empty">
          <div class="cal-fallback-empty__icon">📅</div>
          <p class="cal-fallback-empty__text">No personal entries yet. Click <strong>Add Entry</strong> above or choose a day in the calendar to schedule a meeting, event, or appointment.</p>
        </li>
      `;
      fallbackWrap.appendChild(listEl);
      container.replaceChildren(fallbackWrap);
      fallbackWrap.querySelectorAll('.cal-fallback-day').forEach(day => {
        day.addEventListener('click', () => openModal(ensureModal(), day.dataset.date, null));
      });
      return;
    }

    personalEntries.forEach(entry => {
      const li = document.createElement('li');
      li.className = 'cal-fallback-item';
      const color = getEntryColor(entry.type);
      const timeStr = entry.time ? ` at ${entry.time}` : '';
      li.innerHTML = `
        <span class="cal-fallback-item__dot" style="background:${color};"></span>
        <span class="cal-fallback-item__date">${formatDate(entry.date)}${timeStr}</span>
        <span class="cal-fallback-item__badge cal-entry-badge cal-entry-badge--${escapeHtml(entry.type)}">${escapeHtml(entry.type)}</span>
        <span class="cal-fallback-item__title">${escapeHtml(entry.title)}</span>
        <button type="button" class="ef-cta cal-fallback-item__edit" aria-label="Edit ${escapeHtml(entry.title)}" data-id="${escapeHtml(entry.id)}">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M10 2l2 2-7 7H3v-2l7-7z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
        </button>
        <button type="button" class="ef-cta cal-fallback-item__delete" aria-label="Delete ${escapeHtml(entry.title)}" data-id="${escapeHtml(entry.id)}" data-title="${escapeHtml(entry.title)}">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      `;
      // Store raw entry data on the li for edit pre-fill
      li._calEntry = entry;
      listEl.appendChild(li);
    });

    fallbackWrap.appendChild(listEl);
    container.replaceChildren(fallbackWrap);

    // Handle edits and deletes in fallback mode
    fallbackWrap.querySelectorAll('.cal-fallback-day').forEach(day => {
      day.addEventListener('click', () => openModal(ensureModal(), day.dataset.date, null));
    });

    listEl.addEventListener('click', e => {
      const editBtn = e.target.closest('.cal-fallback-item__edit');
      if (editBtn) {
        const li = editBtn.closest('.cal-fallback-item');
        const entry = li ? li._calEntry : null;
        if (entry) {
          openModal(ensureModal(), null, null, entry);
        }
        return;
      }
      const btn = e.target.closest('.cal-fallback-item__delete');
      if (!btn) {
        return;
      }
      const id = btn.dataset.id;
      const title = btn.dataset.title;
      showEntryActions(btn, { id, title }, null, ensureModal());
    });
  }

  /** Format an ISO date string to a human-friendly string, e.g. "25 Mar 2026" */
  function formatDate(dateStr) {
    if (!dateStr) {
      return '';
    }
    try {
      return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Europe/London',
      });
    } catch (_) {
      return dateStr;
    }
  }

  /**
   * Initialize calendar view
   * @param {string} containerId - ID of the container element
   * @param {Object} options - Configuration options
   */
  async function initCalendarView(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn(`Calendar container #${containerId} not found`);
      return;
    }

    // Pre-create the modal so it's ready immediately on first click
    const modal = ensureModal();

    // Wire the header "Add Entry" button to open the modal
    const headerAddBtn = document.getElementById('cal-add-entry-btn');
    if (headerAddBtn && !headerAddBtn._calWired) {
      headerAddBtn._calWired = true;
      headerAddBtn.addEventListener('click', () => {
        const today = new Date().toISOString().slice(0, 10);
        openModal(modal, today, container._calendarInstance || null);
      });
    }

    // Check if FullCalendar is loaded; render fallback list if not
    if (typeof FullCalendar === 'undefined') {
      console.warn('FullCalendar not available — rendering fallback list view');
      await renderFallbackCalendar(container);
      return;
    }

    // Fetch plan events from API
    let events = [];
    try {
      const response = await fetch('/api/v1/me/plans', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch plans');
      }

      const data = await response.json();
      events = (data.plans || []).map(plan => ({
        id: plan.id,
        title: displayTitle(plan.eventName || plan.title || 'Untitled Event'),
        start: plan.eventDate || plan.date,
        description: plan.description || '',
        type: plan.eventType || plan.type || 'event',
        location: plan.location || '',
        url: `/plan?id=${plan.id}`,
        backgroundColor: getEventColor(plan.eventType || plan.type),
        borderColor: getEventColor(plan.eventType || plan.type),
        extendedProps: {
          description: plan.description || '',
          location: plan.location || '',
        },
      }));
    } catch (error) {
      console.error('Error fetching events:', error);
      container.classList.add('fc-fallback');
      container.innerHTML = `
        <div class="cal-fallback-empty">
          <p class="cal-fallback-empty__text">Failed to load events. Please refresh the page.</p>
        </div>
      `;
      return;
    }

    // Load saved public calendar events (distinct purple colour)
    try {
      const pubRes = await fetch('/api/v1/public-calendar/events/saved', {
        credentials: 'include',
      });
      if (pubRes.ok) {
        const pubData = await pubRes.json();
        const pubEvents = (pubData.events || []).map(ev => {
          const deleted = ev.deleted === true || ev.status === 'deleted' || ev.isDeleted === true;
          return {
            id: `pce_${ev.id}`,
            title: displayTitle(ev.title || 'Public Event'),
            start: ev.startDate,
            end: ev.endDate || undefined,
            url: deleted ? '' : `/events/${encodeURIComponent(ev.slug || ev.id)}`,
            backgroundColor: deleted ? '#9ca3af' : '#7c3aed',
            borderColor: deleted ? '#ef4444' : '#6d28d9',
            textColor: '#fff',
            extendedProps: {
              description: deleted
                ? ev.warning || 'This saved public event has been removed from the shared calendar.'
                : ev.description || '',
              location: ev.location || '',
              publicEvent: true,
              deletedEvent: deleted,
            },
          };
        });
        events = events.concat(pubEvents);
      }
    } catch (_) {
      // Silently ignore — public calendar saves are optional
    }

    // Load personal calendar entries (meetings / events / appointments)
    try {
      const entryRes = await fetch('/api/me/calendar-entries', {
        credentials: 'include',
      });
      if (entryRes.ok) {
        const entryData = await entryRes.json();
        const entryEvents = (entryData.entries || []).map(entry => ({
          id: entry.id,
          title: displayTitle(entry.title),
          start: entry.time ? `${entry.date}T${entry.time}` : entry.date,
          allDay: !entry.time,
          backgroundColor: getEntryColor(entry.type),
          borderColor: getEntryColor(entry.type),
          extendedProps: {
            entryType: entry.type,
            description: entry.description,
            personalEntry: true,
            rawEntry: entry, // stored for edit pre-fill
          },
        }));
        events = events.concat(entryEvents);
      }
    } catch (_) {
      // Non-fatal — personal entries may not be available yet
    }

    // Mark container as loaded so CSS can apply the full min-height
    container.classList.add('fc-loaded');

    // Initialize FullCalendar
    const calendar = new FullCalendar.Calendar(container, {
      initialView: options.initialView || 'dayGridMonth',
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
      events: events,
      expandRows: false,
      contentHeight: 'auto',
      selectable: true,
      nowIndicator: true,
      // Open the "Add Entry" modal when the user clicks a day cell
      dateClick: function (info) {
        openModal(modal, info.dateStr, calendar);
      },
      eventClick: function (info) {
        info.jsEvent.preventDefault();
        // Personal entries: show edit/delete action popover instead of navigating
        if (info.event.extendedProps.personalEntry) {
          const rawEntry = info.event.extendedProps.rawEntry || {
            id: info.event.id,
            title: displayTitle(info.event.title),
          };
          showEntryActions(info.el, rawEntry, calendar, modal);
          return;
        }
        if (info.event.url) {
          window.location.href = info.event.url;
        }
      },
      eventDidMount: function (info) {
        // Tooltip with event details on hover
        const desc = info.event.extendedProps.description;
        const loc = info.event.extendedProps.location;
        const entryType = info.event.extendedProps.entryType;
        const deletedEvent = info.event.extendedProps.deletedEvent;
        if (desc || loc || entryType || deletedEvent) {
          const tooltip = document.createElement('div');
          tooltip.className = 'calendar-tooltip';

          const typeLabel = deletedEvent
            ? '<span class="cal-entry-badge" style="background:#fee2e2;color:#991b1b;">Removed public event</span><br>'
            : entryType
              ? `<span class="cal-entry-badge cal-entry-badge--${escapeHtml(entryType)}">${escapeHtml(entryType)}</span><br>`
              : '';
          const actionHint = entryType
            ? `<br><small style="color:#9ca3af;font-size:0.75rem;">Click to edit or delete</small>`
            : '';
          tooltip.innerHTML = `
            ${typeLabel}
            <strong>${escapeHtml(info.event.title)}</strong>
            ${loc ? `<br><small>📍 ${escapeHtml(loc)}</small>` : ''}
            ${desc ? `<br><small style="color:#6b7280;">${escapeHtml(String(desc).substring(0, 120))}${String(desc).length > 120 ? '…' : ''}</small>` : ''}
            ${actionHint}
          `;

          info.el.addEventListener('mouseenter', () => {
            document.body.appendChild(tooltip);
            const rect = info.el.getBoundingClientRect();
            tooltip.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;
            tooltip.style.top = `${rect.bottom + 6}px`;
            tooltip.classList.add('is-visible');
          });

          info.el.addEventListener('mouseleave', () => {
            tooltip.classList.remove('is-visible');
            if (tooltip.parentNode) {
              tooltip.parentNode.removeChild(tooltip);
            }
          });
        }
      },
      // Show a "+" hint on day cells to prompt entry creation
      dayCellDidMount: function (info) {
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'cal-day-add-btn';
        addBtn.setAttribute('aria-label', `Add entry for ${info.dateStr}`);
        addBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        addBtn.addEventListener('click', e => {
          e.stopPropagation();
          openModal(modal, info.dateStr, calendar);
        });
        const frame = info.el.querySelector('.fc-daygrid-day-frame');
        if (frame) {
          frame.appendChild(addBtn);
        }
      },
      // Show a usage hint inside the "no events" area
      noEventsContent: function () {
        return {
          html: '<div class="cal-no-events">No events yet. Click any day to add one.</div>',
        };
      },
      height: options.height || 'auto',
    });

    calendar.render();
    renderNextUpFromCalendar(calendar);

    // Store calendar instance for external access
    container._calendarInstance = calendar;
  }

  // ── Colour helpers ────────────────────────────────────────────────────────

  /**
   * Get color for plan/event type (for plan events loaded from API).
   */
  function getEventColor(type) {
    const colors = {
      wedding: '#ec4899',
      birthday: '#f59e0b',
      corporate: '#3b82f6',
      conference: '#8b5cf6',
      party: '#10b981',
      meeting: '#6366f1',
      default: '#0B8073',
    };
    return colors[type] || colors.default;
  }

  /**
   * Get color for personal calendar entry type.
   */
  function getEntryColor(type) {
    const colors = {
      meeting: '#6366f1',
      appointment: '#f59e0b',
      event: '#0b8073',
    };
    return colors[type] || '#0b8073';
  }

  /**
   * Escape HTML to avoid XSS in tooltip content.
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // Export for use in other scripts
  window.CalendarView = {
    init: initCalendarView,
  };
})();
