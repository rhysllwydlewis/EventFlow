(function () {
  'use strict';

  let currentEvent = null;

  function esc(value) {
    return String(value || '').replace(
      /[&<>"']/g,
      char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
    );
  }

  function csrfHeaders() {
    const token =
      document.cookie
        .split('; ')
        .find(row => row.startsWith('csrfToken='))
        ?.split('=')[1] || '';
    return token ? { 'X-CSRF-Token': decodeURIComponent(token) } : {};
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' });
    } catch (_) {
      return iso || '';
    }
  }

  function locationSummary(event) {
    return (
      event.location ||
      [
        event.venueName,
        event.addressLine1,
        event.addressLine2,
        event.townCity,
        event.county,
        event.postcode,
      ]
        .filter(Boolean)
        .join(', ') ||
      (event.isOnline ? 'Online event' : '')
    );
  }

  function setMeta(name, content) {
    let meta = document.querySelector(`meta[name="${name}"]`);
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = name;
      document.head.appendChild(meta);
    }
    meta.content = content || '';
  }

  function setProperty(name, content) {
    let meta = document.querySelector(`meta[property="${name}"]`);
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('property', name);
      document.head.appendChild(meta);
    }
    meta.content = content || '';
  }

  function showToast(message, type) {
    if (window.NotificationSystem && window.NotificationSystem.show) {
      window.NotificationSystem.show(message, type);
      return;
    }
    const div = document.createElement('div');
    div.textContent = message;
    div.style.cssText = `position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;padding:0.75rem 1.25rem;border-radius:0.5rem;color:#fff;font-weight:700;background:${type === 'error' ? '#dc2626' : '#16a34a'};`;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3500);
  }

  async function apiFetch(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...csrfHeaders(),
      ...(options.headers || {}),
    };
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

  function updateSeo(event, image) {
    document.title = `${event.title} | EventFlow`;
    document.getElementById('event-title').textContent = event.title;
    setMeta('description', (event.description || `Public event: ${event.title}`).slice(0, 160));
    setProperty('og:title', event.title);
    setProperty(
      'og:description',
      (event.description || 'View this public event on EventFlow.').slice(0, 180)
    );
    setMeta('twitter:card', image ? 'summary_large_image' : 'summary');
    if (image) {
      setProperty('og:image', image);
    }
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      canonical.href = location.href;
    }

    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: event.title,
      startDate: event.startDate,
      endDate: event.endDate,
      eventStatus:
        event.status === 'cancelled'
          ? 'https://schema.org/EventCancelled'
          : 'https://schema.org/EventScheduled',
      location: {
        '@type': event.isOnline ? 'VirtualLocation' : 'Place',
        name: locationSummary(event),
        url: event.onlineUrl || undefined,
      },
      description: event.description,
      image: image ? [image] : undefined,
      organizer: { '@type': 'Organization', name: event.organiserName || 'EventFlow supplier' },
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
  }

  function renderEvent(event) {
    currentEvent = event;
    const panel = document.getElementById('event-panel');
    const image = event.featuredImageUrl || event.imageUrl;
    const saveLabel = event.savedByMe ? 'Saved' : 'Save to planning calendar';
    const saveAction = event.savedByMe ? 'unsave' : 'save';
    const cancelled = event.status === 'cancelled';

    updateSeo(event, image);
    panel.innerHTML = `
      ${image ? `<img class="event-image" src="${esc(image)}" alt="">` : '<div class="event-image">📅</div>'}
      <div class="event-body">
        ${cancelled ? `<div class="event-cancelled">This event has been cancelled${event.cancelledReason ? `: ${esc(event.cancelledReason)}` : ''}.</div>` : ''}
        <div class="event-badges">
          <span class="event-badge">${esc(event.eventType || event.category || 'Event')}</span>
          ${event.priceType === 'free' ? '<span class="event-badge">Free</span>' : ''}
          ${event.bookingRequired ? '<span class="event-badge">Booking required</span>' : ''}
        </div>
        <div class="event-grid">
          <div>
            <h2>${esc(event.title)}</h2>
            <p><strong>When:</strong> ${esc(formatDate(event.startDate))}${event.endDate ? ` – ${esc(formatDate(event.endDate))}` : ''}</p>
            <p><strong>Where:</strong> ${esc(locationSummary(event))}</p>
            ${event.description ? `<p>${esc(event.description)}</p>` : ''}
            ${event.accessibilityNotes ? `<p><strong>Accessibility:</strong> ${esc(event.accessibilityNotes)}</p>` : ''}
            ${event.parkingInfo ? `<p><strong>Parking:</strong> ${esc(event.parkingInfo)}</p>` : ''}
            <div class="event-actions">
              <a class="ef-btn ef-btn-primary" href="/api/v1/public-calendar/events/${encodeURIComponent(event.id)}/ics">Add to calendar (.ics)</a>
              ${cancelled ? '' : `<button class="ef-btn ef-btn-secondary" type="button" data-event-action="${saveAction}">${saveLabel}</button>`}
              ${event.externalBookingUrl ? `<a class="ef-btn ef-btn-secondary" href="${esc(event.externalBookingUrl)}" target="_blank" rel="noopener noreferrer">Book / more info</a>` : ''}
              <button class="ef-btn ef-btn-secondary" type="button" data-event-action="report">Report this event</button>
            </div>
          </div>
          <aside class="event-side">
            <p><strong>Organiser</strong></p>
            <p>${esc(event.organiserName || 'EventFlow supplier')}</p>
            ${event.contactEmail ? `<p>${esc(event.contactEmail)}</p>` : ''}
            ${event.contactPhone ? `<p>${esc(event.contactPhone)}</p>` : ''}
            ${event.ticketPrice ? `<p><strong>Ticket price:</strong> £${esc(event.ticketPrice)}</p>` : ''}
          </aside>
        </div>
      </div>`;
    panel.querySelectorAll('[data-event-action]').forEach(button => {
      button.addEventListener('click', () => handleEventAction(button));
    });
  }

  async function handleEventAction(button) {
    if (!currentEvent) {
      return;
    }
    const action = button.dataset.eventAction;
    if (action === 'report') {
      await reportEvent();
      return;
    }
    button.disabled = true;
    try {
      await apiFetch(`/api/v1/public-calendar/events/${encodeURIComponent(currentEvent.id)}/save`, {
        method: action === 'save' ? 'POST' : 'DELETE',
        body: '{}',
      });
      currentEvent.savedByMe = action === 'save';
      showToast(
        action === 'save'
          ? 'Saved to your planning calendar'
          : 'Removed from your planning calendar',
        'success'
      );
      renderEvent(currentEvent);
    } catch (err) {
      if (err.status === 401) {
        window.location.href = `/auth?redirect=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      showToast(err.data?.error || 'Unable to update saved event', 'error');
      button.disabled = false;
    }
  }

  function ensureReportModal() {
    const existing = document.getElementById('event-report-overlay');
    if (existing) {
      return existing;
    }

    const overlay = document.createElement('div');
    overlay.id = 'event-report-overlay';
    overlay.className = 'event-report-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'event-report-title');
    overlay.innerHTML = `
      <div class="event-report-modal" role="document">
        <div class="event-report-modal__header">
          <div>
            <p class="event-report-modal__eyebrow">Help keep the calendar accurate</p>
            <h2 id="event-report-title">Report this public event</h2>
          </div>
          <button class="event-report-modal__close" type="button" aria-label="Close report form">×</button>
        </div>
        <form id="event-report-form" novalidate>
          <label class="event-report-modal__label" for="event-report-reason">Reason</label>
          <select id="event-report-reason" class="event-report-modal__control" required>
            <option value="">Choose a reason…</option>
            <option>Incorrect information</option>
            <option>Spam or advertising</option>
            <option>Event no longer exists</option>
            <option>Inappropriate content</option>
            <option>Duplicate event</option>
            <option>Other</option>
          </select>
          <label class="event-report-modal__label" for="event-report-notes">Optional notes</label>
          <textarea id="event-report-notes" class="event-report-modal__control" rows="4" maxlength="500" placeholder="Add context for the admin team…"></textarea>
          <div id="event-report-error" class="event-report-modal__error" role="alert"></div>
          <div class="event-report-modal__actions">
            <button class="ef-btn ef-btn-secondary" type="button" data-report-cancel>Cancel</button>
            <button class="ef-btn ef-btn-primary" type="submit" id="event-report-submit">Submit report</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.event-report-modal__close').addEventListener('click', closeReportModal);
    overlay.querySelector('[data-report-cancel]').addEventListener('click', closeReportModal);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) {
        closeReportModal();
      }
    });
    overlay.querySelector('#event-report-form').addEventListener('submit', submitReportForm);
    return overlay;
  }

  function openReportModal() {
    const overlay = ensureReportModal();
    overlay.querySelector('#event-report-form').reset();
    overlay.querySelector('#event-report-error').textContent = '';
    overlay.querySelector('#event-report-error').style.display = 'none';
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    overlay.querySelector('#event-report-reason').focus();
  }

  function closeReportModal() {
    const overlay = document.getElementById('event-report-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  async function submitReportForm(event) {
    event.preventDefault();
    if (!currentEvent) {
      return;
    }
    const reason = document.getElementById('event-report-reason').value;
    const notes = document.getElementById('event-report-notes').value;
    const errorEl = document.getElementById('event-report-error');
    const submitBtn = document.getElementById('event-report-submit');

    if (!reason) {
      errorEl.textContent = 'Please choose a report reason.';
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    errorEl.style.display = 'none';
    try {
      await apiFetch(
        `/api/v1/public-calendar/events/${encodeURIComponent(currentEvent.id)}/report`,
        {
          method: 'POST',
          body: JSON.stringify({ reason, notes }),
        }
      );
      closeReportModal();
      showToast('Thanks — this event has been reported for admin review.', 'success');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = `/auth?redirect=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      errorEl.textContent = err.data?.details?.[0] || err.data?.error || 'Unable to report event';
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit report';
    }
  }

  async function reportEvent() {
    openReportModal();
  }

  async function init() {
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeReportModal();
      }
    });
    const slug = decodeURIComponent(location.pathname.split('/').pop());
    const panel = document.getElementById('event-panel');
    try {
      const data = await apiFetch(`/api/v1/public-calendar/events/${encodeURIComponent(slug)}`, {
        headers: {},
      });
      renderEvent(data.event);
    } catch (_) {
      panel.innerHTML =
        '<div class="event-body"><h2>Event not found</h2><p>This event is unavailable or no longer public.</p><p><a href="/public-calendar">Back to public calendar</a></p></div>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
