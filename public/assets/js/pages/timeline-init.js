window.__EF_PAGE__ = 'timeline';

document.addEventListener('DOMContentLoaded', () => {
  // Load saved timeline events from localStorage
  const savedEvents = localStorage.getItem('timeline-events');
  const events = savedEvents ? JSON.parse(savedEvents) : [];

  // Initialize timeline builder
  const timeline = new TimelineBuilder({
    container: '#timeline-builder',
    events: events,
    editable: true,
    onEventAdd: event => {
      console.log('Event added:', event);
      saveTimeline();
      if (typeof showToast === 'function') {
        showToast('Event added to timeline', 'success');
      }
    },
    onEventUpdate: event => {
      console.log('Event updated:', event);
      saveTimeline();
      if (typeof showToast === 'function') {
        showToast('Event updated', 'success');
      }
    },
    onEventDelete: eventId => {
      console.log('Event deleted:', eventId);
      saveTimeline();
      if (typeof showToast === 'function') {
        showToast('Event removed from timeline', 'success');
      }
    },
    onEventMove: events => {
      console.log('Events reordered');
      saveTimeline();
    },
  });

  function saveTimeline() {
    const events = timeline.getData();
    localStorage.setItem('timeline-events', JSON.stringify(events));
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
