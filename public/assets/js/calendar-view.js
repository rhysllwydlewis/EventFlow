/**
 * Calendar View for Events
 * Integrates FullCalendar to display user events
 */

(function () {
  'use strict';

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

    // Fetch events from API
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

    // Also load saved public calendar events and add them with a distinct colour
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
          extendedProps: { publicEvent: true },
        }));
        events = events.concat(pubEvents);
      }
    } catch (_) {
      // Silently ignore — public calendar saves are optional
    }

    // Initialize FullCalendar
    const calendar = new FullCalendar.Calendar(container, {
      initialView: options.initialView || 'dayGridMonth',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,listWeek',
      },
      events: events,
      eventClick: function (info) {
        info.jsEvent.preventDefault();
        if (info.event.url) {
          window.location.href = info.event.url;
        }
      },
      eventDidMount: function (info) {
        // Add tooltip with event details
        if (info.event.extendedProps.description || info.event.extendedProps.location) {
          const tooltip = document.createElement('div');
          tooltip.className = 'calendar-tooltip';
          tooltip.style.display = 'none';
          tooltip.style.position = 'absolute';
          tooltip.style.background = 'white';
          tooltip.style.border = '1px solid #e5e7eb';
          tooltip.style.borderRadius = '6px';
          tooltip.style.padding = '8px 12px';
          tooltip.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
          tooltip.style.zIndex = '1000';
          tooltip.style.maxWidth = '250px';
          tooltip.innerHTML = `
            <strong>${escapeHtml(info.event.title)}</strong>
            ${info.event.extendedProps.location ? `<br><small>📍 ${escapeHtml(info.event.extendedProps.location)}</small>` : ''}
            ${info.event.extendedProps.description ? `<br><small>${escapeHtml(info.event.extendedProps.description.substring(0, 100))}${info.event.extendedProps.description.length > 100 ? '...' : ''}</small>` : ''}
          `;

          info.el.addEventListener('mouseenter', () => {
            document.body.appendChild(tooltip);
            const rect = info.el.getBoundingClientRect();
            tooltip.style.display = 'block';
            tooltip.style.left = `${rect.left}px`;
            tooltip.style.top = `${rect.bottom + 5}px`;
          });

          info.el.addEventListener('mouseleave', () => {
            if (tooltip.parentNode) {
              tooltip.parentNode.removeChild(tooltip);
            }
          });
        }
      },
      height: options.height || 'auto',
      ...options,
    });

    calendar.render();

    // Store calendar instance for external access
    container._calendarInstance = calendar;
  }

  /**
   * Get color for event type
   * @param {string} type - Event type
   * @returns {string} Color code
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
   * Escape HTML
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
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
