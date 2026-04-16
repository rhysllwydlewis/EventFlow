window.__EF_PAGE__ = 'timeline';

document.addEventListener('DOMContentLoaded', async () => {
  // Resolve a planId to persist the timeline server-side.
  // Falls back to localStorage if not authenticated or no plans exist.
  let planId = null;
  let csrfToken = '';

  async function getCsrfToken() {
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    try {
      const r = await fetch('/api/csrf-token', { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        const t = d.csrfToken || d.token || '';
        if (t) {
          window.__CSRF_TOKEN__ = t;
        }
        return t;
      }
    } catch (_) { /* ignore */ }
    const m = document.cookie.match(/(?:^|;\s*)(?:csrf|csrfToken)=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  try {
    const r = await fetch('/api/me/plans', { credentials: 'include' });
    if (r.ok) {
      const d = await r.json();
      const plans = d.plans || [];
      if (plans.length > 0) {
        planId = plans[0].id; // Use primary plan
        csrfToken = await getCsrfToken();
      }
    }
  } catch (_) { /* not authenticated — use localStorage fallback */ }

  // Load initial events: prefer server plan timeline, fall back to localStorage
  let events = [];
  if (planId) {
    try {
      const r = await fetch(`/api/me/plans/${encodeURIComponent(planId)}`, { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        if (d.plan && Array.isArray(d.plan.timeline)) {
          events = d.plan.timeline;
        }
      }
    } catch (_) { /* ignore */ }
  }

  // Fallback to localStorage if no server data
  if (events.length === 0) {
    try {
      const saved = localStorage.getItem('timeline-events');
      if (saved) {
        events = JSON.parse(saved);
      }
    } catch (_) { /* ignore */ }
  }

  // Initialize timeline builder
  const timeline = new TimelineBuilder({
    container: '#timeline-builder',
    events: events,
    editable: true,
    onEventAdd: (_event) => {
      saveTimeline();
      if (typeof showToast === 'function') {
        showToast('Event added to timeline', 'success');
      }
    },
    onEventUpdate: (_event) => {
      saveTimeline();
      if (typeof showToast === 'function') {
        showToast('Event updated', 'success');
      }
    },
    onEventDelete: (_eventId) => {
      saveTimeline();
      if (typeof showToast === 'function') {
        showToast('Event removed from timeline', 'success');
      }
    },
    onEventMove: (_events) => {
      saveTimeline();
    },
  });

  async function saveTimeline() {
    const currentEvents = timeline.getData();

    // Always write to localStorage as fast local cache
    try {
      localStorage.setItem('timeline-events', JSON.stringify(currentEvents));
    } catch (_) { /* ignore */ }

    // Persist to server if we have a plan
    if (planId) {
      try {
        await fetch(`/api/me/plans/${encodeURIComponent(planId)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken || (await getCsrfToken()),
          },
          credentials: 'include',
          body: JSON.stringify({ timeline: currentEvents }),
        });
      } catch (err) {
        console.warn('Timeline server sync failed, cached locally:', err);
      }
    }
  }

  // Show notification bell for logged-in users
  const authState = window.__authState || window.AuthStateManager;
  if (authState) {
    authState.onchange(user => {
      // Support both old and new notification bell IDs
      const notificationBell =
        document.getElementById('ef-notification-btn') ||
        document.getElementById('notification-bell');
      if (notificationBell) {
        notificationBell.style.display = user ? 'block' : 'none';
      }
    });
  }
});
