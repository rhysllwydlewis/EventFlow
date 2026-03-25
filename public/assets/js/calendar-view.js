/**
 * Calendar View for Events
 * Integrates FullCalendar to display user events, saved public events,
 * and personal calendar entries (meetings / events / appointments).
 *
 * Clicking an empty day cell opens the "Add Entry" modal so customers
 * can quickly record a meeting, event, or appointment on that date.
 */

(function () {
  'use strict';

  // ── Modal ─────────────────────────────────────────────────────────────────

  /**
   * Lazily create (and cache) the entry-creation modal in the document.
   * @returns {HTMLElement} The modal overlay element.
   */
  function ensureModal() {
    const MODAL_ID = 'cal-entry-modal';
    let existing = document.getElementById(MODAL_ID);
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
          <button type="button" class="cal-entry-modal__close" aria-label="Close dialog">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <form class="cal-entry-modal__form" id="cal-entry-form" novalidate>
          <div class="cal-entry-modal__field">
            <label for="cal-entry-date" class="cal-entry-modal__label">Date <span aria-hidden="true">*</span></label>
            <input type="date" id="cal-entry-date" name="date" class="cal-entry-modal__input" required aria-required="true">
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
          <div class="cal-entry-modal__field">
            <label for="cal-entry-title" class="cal-entry-modal__label">Title <span aria-hidden="true">*</span></label>
            <input type="text" id="cal-entry-title" name="title" class="cal-entry-modal__input" maxlength="100" required aria-required="true" placeholder="e.g. Venue walkthrough">
          </div>
          <div class="cal-entry-modal__field">
            <label for="cal-entry-time" class="cal-entry-modal__label">Time <span class="cal-entry-modal__optional">(optional)</span></label>
            <input type="time" id="cal-entry-time" name="time" class="cal-entry-modal__input">
          </div>
          <div class="cal-entry-modal__field">
            <label for="cal-entry-description" class="cal-entry-modal__label">Notes <span class="cal-entry-modal__optional">(optional)</span></label>
            <textarea id="cal-entry-description" name="description" class="cal-entry-modal__textarea" maxlength="500" rows="3" placeholder="Any additional notes…"></textarea>
          </div>
          <div id="cal-entry-error" class="cal-entry-modal__error" role="alert" aria-live="polite" style="display:none;"></div>
          <div class="cal-entry-modal__actions">
            <button type="button" class="cal-entry-modal__btn cal-entry-modal__btn--cancel">Cancel</button>
            <button type="submit" class="cal-entry-modal__btn cal-entry-modal__btn--save" id="cal-entry-save-btn">
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

  function openModal(overlay, dateStr, calendarInstance) {
    const dateInput = overlay.querySelector('#cal-entry-date');
    const titleInput = overlay.querySelector('#cal-entry-title');
    const typeSelect = overlay.querySelector('#cal-entry-type');
    const timeInput = overlay.querySelector('#cal-entry-time');
    const descInput = overlay.querySelector('#cal-entry-description');
    const errorEl = overlay.querySelector('#cal-entry-error');
    const form = overlay.querySelector('#cal-entry-form');

    // Abort any submit listener from a previous open (prevents stacking)
    if (overlay._submitAC) {
      overlay._submitAC.abort();
    }
    const ac = new AbortController();
    overlay._submitAC = ac;

    // Reset form
    form.reset();
    if (dateStr) {
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
    // Uses a submitting guard instead of aborting on validation failures so the
    // user can fix errors and resubmit without reopening the modal.
    form.addEventListener(
      'submit',
      async e => {
        e.preventDefault();
        if (submitting) return;

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
        const saveBtn = overlay.querySelector('#cal-entry-save-btn');
        const saveLabel = saveBtn.querySelector('.cal-entry-save-label');
        const saveSpinner = saveBtn.querySelector('.cal-entry-save-spinner');
        saveBtn.disabled = true;
        if (saveLabel) saveLabel.textContent = 'Saving…';
        if (saveSpinner) saveSpinner.style.display = '';
        if (errorEl) {
          errorEl.style.display = 'none';
          errorEl.textContent = '';
        }

        try {
          const csrfToken = getCsrfTokenFromPage();
          const resp = await fetch('/api/me/calendar-entries', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({ title, type, date, time, description }),
          });

          const data = await resp.json();

          if (!resp.ok) {
            throw new Error(data.error || 'Failed to save entry');
          }

          // Immediately add the new event to the calendar without a full reload
          if (calendarInstance && data.entry) {
            const entry = data.entry;
            const start = entry.time ? `${entry.date}T${entry.time}` : entry.date;
            calendarInstance.addEvent({
              id: entry.id,
              title: entry.title,
              start,
              allDay: !entry.time,
              backgroundColor: getEntryColor(entry.type),
              borderColor: getEntryColor(entry.type),
              extendedProps: {
                entryType: entry.type,
                description: entry.description,
                personalEntry: true,
              },
            });
          }

          closeModal(overlay);
        } catch (err) {
          showModalError(errorEl, err.message || 'Could not save the entry. Please try again.');
        } finally {
          submitting = false;
          saveBtn.disabled = false;
          if (saveLabel) saveLabel.textContent = 'Add Entry';
          if (saveSpinner) saveSpinner.style.display = 'none';
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

  // ── Calendar initialisation ───────────────────────────────────────────────

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

    // Check if FullCalendar is loaded
    if (typeof FullCalendar === 'undefined') {
      console.error('FullCalendar library not loaded');
      container.innerHTML = '<p>Calendar library not loaded. Please refresh the page.</p>';
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
        title: plan.eventName || plan.title || 'Untitled Event',
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
      container.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: #6b7280;">
          <p>Failed to load events. Please try again.</p>
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
        const pubEvents = (pubData.events || []).map(ev => ({
          id: `pce_${ev.id}`,
          title: ev.title || 'Public Event',
          start: ev.startDate,
          end: ev.endDate || undefined,
          description: ev.description || '',
          location: ev.location || '',
          url: `/public-calendar`,
          backgroundColor: '#7c3aed',
          borderColor: '#6d28d9',
          extendedProps: {
            description: ev.description || '',
            location: ev.location || '',
            publicEvent: true,
          },
        }));
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
          title: entry.title,
          start: entry.time ? `${entry.date}T${entry.time}` : entry.date,
          allDay: !entry.time,
          backgroundColor: getEntryColor(entry.type),
          borderColor: getEntryColor(entry.type),
          extendedProps: {
            entryType: entry.type,
            description: entry.description,
            personalEntry: true,
          },
        }));
        events = events.concat(entryEvents);
      }
    } catch (_) {
      // Non-fatal — personal entries may not be available yet
    }

    // Pre-create the modal so it's ready immediately on first click
    const modal = ensureModal();

    // Initialize FullCalendar
    const calendar = new FullCalendar.Calendar(container, {
      initialView: options.initialView || 'dayGridMonth',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,listWeek',
      },
      events: events,
      selectable: true,
      // Open the "Add Entry" modal when the user clicks a day cell
      dateClick: function (info) {
        openModal(modal, info.dateStr, calendar);
      },
      eventClick: function (info) {
        info.jsEvent.preventDefault();
        if (info.event.url) {
          window.location.href = info.event.url;
        }
      },
      eventDidMount: function (info) {
        // Tooltip with event details on hover
        const desc = info.event.extendedProps.description;
        const loc = info.event.extendedProps.location;
        const entryType = info.event.extendedProps.entryType;
        if (desc || loc || entryType) {
          const tooltip = document.createElement('div');
          tooltip.className = 'calendar-tooltip';
          tooltip.style.cssText =
            'display:none;position:fixed;background:#fff;border:1px solid #e5e7eb;' +
            'border-radius:8px;padding:8px 12px;box-shadow:0 4px 12px rgba(0,0,0,.12);' +
            'z-index:9999;max-width:260px;font-size:0.85rem;pointer-events:none;';

          const typeLabel = entryType
            ? `<span style="display:inline-block;margin-bottom:4px;padding:1px 7px;background:${getEntryColor(entryType)}20;color:${getEntryColor(entryType)};border-radius:4px;font-size:0.75rem;font-weight:600;text-transform:capitalize;">${escapeHtml(entryType)}</span><br>`
            : '';
          tooltip.innerHTML = `
            ${typeLabel}
            <strong>${escapeHtml(info.event.title)}</strong>
            ${loc ? `<br><small>📍 ${escapeHtml(loc)}</small>` : ''}
            ${desc ? `<br><small style="color:#6b7280;">${escapeHtml(String(desc).substring(0, 120))}${String(desc).length > 120 ? '…' : ''}</small>` : ''}
          `;

          info.el.addEventListener('mouseenter', () => {
            document.body.appendChild(tooltip);
            const rect = info.el.getBoundingClientRect();
            tooltip.style.display = 'block';
            tooltip.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;
            tooltip.style.top = `${rect.bottom + 6}px`;
          });

          info.el.addEventListener('mouseleave', () => {
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
      height: options.height || 'auto',
    });

    calendar.render();

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
