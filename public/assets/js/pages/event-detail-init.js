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

  async function reportEvent() {
    const reason = window.prompt(
      'Why are you reporting this event? Use: Incorrect information, Spam or advertising, Event no longer exists, Inappropriate content, Duplicate event, or Other.'
    );
    if (!reason) {
      return;
    }
    const notes = window.prompt('Optional notes for the admin team:') || '';
    try {
      await apiFetch(
        `/api/v1/public-calendar/events/${encodeURIComponent(currentEvent.id)}/report`,
        {
          method: 'POST',
          body: JSON.stringify({ reason, notes }),
        }
      );
      showToast('Thanks — this event has been reported for admin review.', 'success');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = `/auth?redirect=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      showToast(err.data?.details?.[0] || err.data?.error || 'Unable to report event', 'error');
    }
  }

  async function init() {
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
