(function () {
  'use strict';

  const API_BASE = '/api/v1/public-calendar';
  let events = [];
  let requests = [];
  let reports = [];
  let editingEvent = null;

  function esc(value) {
    return AdminShared.escapeHtml(value || '');
  }

  function formatDate(iso) {
    return iso ? AdminShared.formatDate(iso) : '—';
  }

  function toDatetimeLocal(iso) {
    if (!iso) {
      return '';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toISOString().slice(0, 16);
  }

  function badge(value) {
    const safe = esc(value || 'unknown');
    return `<span class="calendar-admin-badge calendar-admin-badge--${safe}">${safe.replace(/_/g, ' ')}</span>`;
  }

  function showLoading(containerId, message) {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `<div class="calendar-admin-empty">${esc(message || 'Loading…')}</div>`;
    }
  }

  function errorText(err, fallback) {
    return err?.message || fallback || 'Something went wrong.';
  }

  function showPanelError(containerId, err, fallback, retryHandler) {
    const container = document.getElementById(containerId);
    if (!container) {
      return;
    }
    container.innerHTML = `
      <div class="calendar-admin-empty calendar-admin-empty--error">
        <strong>${esc(fallback)}</strong>
        <span>${esc(errorText(err, fallback))}</span>
        ${retryHandler ? '<button type="button" class="ef-cta btn-sm" data-calendar-retry>Retry</button>' : ''}
      </div>`;
    container.querySelector('[data-calendar-retry]')?.addEventListener('click', retryHandler);
  }

  function showToast(message, type = 'success') {
    if (AdminShared.showToast) {
      AdminShared.showToast(message, type);
    }
  }

  async function api(url, method = 'GET', body = null) {
    return AdminShared.api(url, method, body);
  }

  function buildEventQuery() {
    const params = new URLSearchParams({
      limit: '200',
      offset: '0',
      status: document.getElementById('eventStatusFilter')?.value || 'all',
      includePast: document.getElementById('eventIncludePastFilter')?.value || 'true',
    });
    const q = document.getElementById('eventSearchFilter')?.value.trim();
    const eventType = document.getElementById('eventTypeFilter')?.value.trim();
    const county = document.getElementById('eventCountyFilter')?.value.trim();
    if (q) {
      params.set('q', q);
    }
    if (eventType) {
      params.set('eventType', eventType);
    }
    if (county) {
      params.set('county', county);
    }
    return params;
  }

  async function loadStats() {
    try {
      const [allData, publishedData, requestsData, reportsData] = await Promise.all([
        api(`${API_BASE}/events?status=all&includePast=true&limit=1`),
        api(`${API_BASE}/events?status=published&includePast=true&limit=1`),
        api(`${API_BASE}/publisher-requests?status=pending`),
        api(`${API_BASE}/reports?status=open`),
      ]);
      document.getElementById('adminCalendarTotalEvents').textContent = allData.total || 0;
      document.getElementById('adminCalendarPublishedEvents').textContent =
        publishedData.total || 0;
      document.getElementById('adminCalendarPendingRequests').textContent = requestsData.total || 0;
      document.getElementById('adminCalendarOpenReports').textContent = reportsData.total || 0;
    } catch (err) {
      console.warn('Failed to load calendar stats:', err.message);
    }
  }

  async function loadEvents() {
    showLoading('adminCalendarEventsContainer', 'Loading calendar events…');
    try {
      const data = await api(`${API_BASE}/events?${buildEventQuery()}`);
      events = data.events || [];
      renderEvents();
    } catch (err) {
      showPanelError(
        'adminCalendarEventsContainer',
        err,
        'Failed to load calendar events.',
        loadEvents
      );
    }
  }

  function renderEvents() {
    const container = document.getElementById('adminCalendarEventsContainer');
    if (!events.length) {
      container.innerHTML =
        '<div class="calendar-admin-empty">No events match these filters.</div>';
      return;
    }

    container.innerHTML = `
      <table class="calendar-admin-table">
        <thead><tr><th>Event</th><th>Date</th><th>Type</th><th>Status</th><th>Location</th><th>Saves</th><th>Actions</th></tr></thead>
        <tbody>
          ${events
            .map(
              event => `
                <tr>
                  <td><strong>${esc(event.title)}</strong><div class="small">${esc(event.organiserName || event.supplierId || '—')}</div></td>
                  <td>${formatDate(event.startDate)}</td>
                  <td>${esc(event.eventType || event.category || 'Other')}</td>
                  <td>${badge(event.status || 'published')}</td>
                  <td>${esc(event.location || [event.townCity, event.county, event.postcode].filter(Boolean).join(', ') || '—')}</td>
                  <td>${Number(event.savesCount || 0)}</td>
                  <td><div class="calendar-admin-actions-inline">
                    <button class="ef-cta btn-sm" data-event-action="edit" data-id="${esc(event.id)}">Edit</button>
                    <a class="ef-cta btn-sm" href="/events/${encodeURIComponent(event.slug || event.id)}" target="_blank" rel="noopener noreferrer">View</a>
                    <a class="ef-cta btn-sm" href="${API_BASE}/events/${encodeURIComponent(event.id)}/ics">ICS</a>
                    ${event.status !== 'published' ? `<button class="ef-cta btn-sm btn-success" data-event-action="status" data-status="published" data-id="${esc(event.id)}">Publish</button>` : `<button class="ef-cta btn-sm" data-event-action="status" data-status="draft" data-id="${esc(event.id)}">Unpublish</button>`}
                    ${event.status !== 'cancelled' ? `<button class="ef-cta btn-sm btn-danger" data-event-action="status" data-status="cancelled" data-id="${esc(event.id)}">Cancel</button>` : ''}
                    <button class="ef-cta btn-sm btn-danger" data-event-action="delete" data-id="${esc(event.id)}">Delete</button>
                  </div></td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
    container.querySelectorAll('[data-event-action]').forEach(button => {
      button.addEventListener('click', () => handleEventAction(button));
    });
  }

  async function loadRequests() {
    const container = document.getElementById('adminCalendarRequestsContainer');
    container.innerHTML = '<div class="calendar-admin-empty">Loading publishing requests…</div>';
    try {
      const data = await api(`${API_BASE}/publisher-requests?status=pending`);
      requests = data.requests || [];
      renderRequests();
    } catch (err) {
      showPanelError(
        'adminCalendarRequestsContainer',
        err,
        'Failed to load publishing requests.',
        loadRequests
      );
    }
  }

  function renderRequests() {
    const container = document.getElementById('adminCalendarRequestsContainer');
    if (!requests.length) {
      container.innerHTML =
        '<div class="calendar-admin-empty">No pending publishing access requests.</div>';
      return;
    }
    container.innerHTML = requests
      .map(
        request => `
          <article class="calendar-admin-panel" style="box-shadow:none;margin:0 0 .75rem;">
            <div class="calendar-admin-panel__header">
              <div>
                <h3 class="calendar-admin-panel__title">${esc(request.supplierName || request.supplierId)}</h3>
                <p class="calendar-admin-panel__subtitle">${esc(request.supplierCategory || 'Unknown category')} · ${formatDate(request.createdAt)}</p>
              </div>
              ${badge(request.status || 'pending')}
            </div>
            <p>${esc(request.reason)}</p>
            <p class="small"><strong>Event types:</strong> ${esc(request.eventTypes || 'Not specified')} · <strong>Example:</strong> ${esc(request.exampleEventTitle || 'Not specified')} · <strong>Frequency:</strong> ${esc(request.expectedFrequency || 'Not specified')}</p>
            <div class="calendar-admin-actions-inline">
              <button class="ef-cta btn-sm btn-success" data-request-action="approve" data-id="${esc(request.id)}">Approve</button>
              <button class="ef-cta btn-sm btn-danger" data-request-action="reject" data-id="${esc(request.id)}">Reject</button>
              ${request.supportingUrl ? `<a class="ef-cta btn-sm" href="${esc(request.supportingUrl)}" target="_blank" rel="noopener noreferrer">Supporting URL ↗</a>` : ''}
            </div>
          </article>`
      )
      .join('');
    container.querySelectorAll('[data-request-action]').forEach(button => {
      button.addEventListener('click', () => handleRequestAction(button));
    });
  }

  async function loadReports() {
    const container = document.getElementById('adminCalendarReportsContainer');
    container.innerHTML = '<div class="calendar-admin-empty">Loading event reports…</div>';
    try {
      const data = await api(`${API_BASE}/reports?status=open`);
      reports = data.reports || [];
      renderReports();
    } catch (err) {
      showPanelError(
        'adminCalendarReportsContainer',
        err,
        'Failed to load event reports.',
        loadReports
      );
    }
  }

  function renderReports() {
    const container = document.getElementById('adminCalendarReportsContainer');
    if (!reports.length) {
      container.innerHTML = '<div class="calendar-admin-empty">No open event reports.</div>';
      return;
    }
    container.innerHTML = `
      <div class="calendar-admin-table-wrap"><table class="calendar-admin-table">
        <thead><tr><th>Event</th><th>Reason</th><th>Notes</th><th>Reported</th><th>Actions</th></tr></thead>
        <tbody>${reports
          .map(
            report => `
              <tr>
                <td><strong>${esc(report.eventTitle || report.eventId)}</strong>${report.eventSlug ? `<div class="small"><a href="/events/${encodeURIComponent(report.eventSlug)}" target="_blank" rel="noopener noreferrer">View event ↗</a></div>` : ''}</td>
                <td>${esc(report.reason)}</td>
                <td>${esc(report.notes || '—')}</td>
                <td>${formatDate(report.createdAt)}</td>
                <td><div class="calendar-admin-actions-inline">
                  <button class="ef-cta btn-sm" data-report-status="reviewed" data-id="${esc(report.id)}">Mark reviewed</button>
                  <button class="ef-cta btn-sm" data-report-status="dismissed" data-id="${esc(report.id)}">Dismiss</button>
                  <button class="ef-cta btn-sm btn-danger" data-report-status="actioned" data-id="${esc(report.id)}">Actioned</button>
                </div></td>
              </tr>`
          )
          .join('')}</tbody>
      </table></div>`;
    container.querySelectorAll('[data-report-status]').forEach(button => {
      button.addEventListener('click', () => handleReportStatus(button));
    });
  }

  async function handleEventAction(button) {
    const id = button.dataset.id;
    const action = button.dataset.eventAction;
    const event = events.find(item => item.id === id);
    if (!event) {
      return;
    }
    if (action === 'edit') {
      openEventModal(event);
      return;
    }
    if (action === 'delete') {
      const confirmed = await AdminShared.showConfirmModal({
        title: 'Delete public event?',
        message: `Delete “${event.title}”? This also removes saves for this event.`,
        confirmText: 'Delete event',
        type: 'danger',
      });
      if (!confirmed) {
        return;
      }
      button.disabled = true;
      try {
        await api(`${API_BASE}/events/${encodeURIComponent(id)}`, 'DELETE', {});
        showToast('Event deleted', 'success');
        await refreshAll();
      } catch (err) {
        showToast(err.message || 'Failed to delete event', 'error');
        button.disabled = false;
      }
      return;
    }
    if (action === 'status') {
      const status = button.dataset.status;
      const body = { status };
      if (status === 'cancelled') {
        const result = await AdminShared.showInputModal({
          title: 'Cancel event',
          message: 'Add an optional cancellation reason that will appear on the event detail page.',
          label: 'Cancellation reason',
          required: false,
          confirmText: 'Cancel event',
          type: 'textarea',
        });
        body.cancelledReason = result.confirmed ? result.value || '' : '';
      }
      button.disabled = true;
      try {
        await api(`${API_BASE}/events/${encodeURIComponent(id)}`, 'PUT', body);
        showToast(`Event moved to ${status.replace(/_/g, ' ')}`, 'success');
        await refreshAll();
      } catch (err) {
        showToast(err.message || 'Failed to update event', 'error');
        button.disabled = false;
      }
    }
  }

  function openEventModal(event = null) {
    editingEvent = event;
    document.getElementById('adminCalendarEventModalTitle').textContent = event
      ? 'Edit event'
      : 'Create event';
    document.getElementById('eventFormId').value = event?.id || '';
    document.getElementById('eventFormTitle').value = event?.title || '';
    document.getElementById('eventFormStatus').value = event?.status || 'published';
    document.getElementById('eventFormStart').value = toDatetimeLocal(event?.startDate);
    document.getElementById('eventFormEnd').value = toDatetimeLocal(event?.endDate);
    document.getElementById('eventFormType').value = event?.eventType || 'Other';
    document.getElementById('eventFormVenue').value = event?.venueName || '';
    document.getElementById('eventFormTown').value = event?.townCity || '';
    document.getElementById('eventFormCounty').value = event?.county || '';
    document.getElementById('eventFormPostcode').value = event?.postcode || '';
    document.getElementById('eventFormPriceType').value = event?.priceType || 'unknown';
    document.getElementById('eventFormTicketPrice').value = event?.ticketPrice || '';
    document.getElementById('eventFormBookingRequired').value = event?.bookingRequired
      ? 'true'
      : 'false';
    document.getElementById('eventFormBookingUrl').value =
      event?.externalBookingUrl || event?.externalUrl || '';
    document.getElementById('eventFormImageUrl').value =
      event?.featuredImageUrl || event?.imageUrl || '';
    document.getElementById('eventFormDescription').value = event?.description || '';
    document.getElementById('eventFormCancelledReason').value = event?.cancelledReason || '';
    document.getElementById('adminCalendarEventFormError').style.display = 'none';
    document.getElementById('adminCalendarEventModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    document.getElementById('eventFormTitle').focus();
  }

  function closeEventModal() {
    document.getElementById('adminCalendarEventModal').style.display = 'none';
    document.body.style.overflow = '';
    editingEvent = null;
  }

  function eventFormBody() {
    const eventType = document.getElementById('eventFormType').value;
    return {
      title: document.getElementById('eventFormTitle').value,
      status: document.getElementById('eventFormStatus').value,
      startDate: document.getElementById('eventFormStart').value,
      endDate: document.getElementById('eventFormEnd').value || undefined,
      eventType,
      category: eventType,
      venueName: document.getElementById('eventFormVenue').value,
      townCity: document.getElementById('eventFormTown').value,
      county: document.getElementById('eventFormCounty').value,
      postcode: document.getElementById('eventFormPostcode').value,
      priceType: document.getElementById('eventFormPriceType').value,
      ticketPrice: document.getElementById('eventFormTicketPrice').value,
      bookingRequired: document.getElementById('eventFormBookingRequired').value === 'true',
      externalBookingUrl: document.getElementById('eventFormBookingUrl').value,
      externalUrl: document.getElementById('eventFormBookingUrl').value,
      featuredImageUrl: document.getElementById('eventFormImageUrl').value,
      imageUrl: document.getElementById('eventFormImageUrl').value,
      description: document.getElementById('eventFormDescription').value,
      cancelledReason: document.getElementById('eventFormCancelledReason').value,
    };
  }

  async function submitEventForm(e) {
    e.preventDefault();
    const errorEl = document.getElementById('adminCalendarEventFormError');
    const submitBtn = document.getElementById('adminCalendarEventSave');
    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    try {
      const body = eventFormBody();
      if (editingEvent) {
        await api(`${API_BASE}/events/${encodeURIComponent(editingEvent.id)}`, 'PUT', body);
      } else {
        await api(`${API_BASE}/events`, 'POST', body);
      }
      closeEventModal();
      showToast(editingEvent ? 'Event updated' : 'Event created', 'success');
      await refreshAll();
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to save event';
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save event';
    }
  }

  async function handleRequestAction(button) {
    const id = button.dataset.id;
    const action = button.dataset.requestAction;
    const reason =
      action === 'reject'
        ? window.prompt('Optional rejection reason:') || ''
        : 'Approved for shared calendar publishing';
    button.disabled = true;
    try {
      await api(`${API_BASE}/publisher-requests/${encodeURIComponent(id)}/${action}`, 'POST', {
        reason,
      });
      showToast(`Publishing request ${action === 'approve' ? 'approved' : 'rejected'}`, 'success');
      await refreshAll();
    } catch (err) {
      showToast(err.message || 'Failed to update request', 'error');
      button.disabled = false;
    }
  }

  async function handleReportStatus(button) {
    const id = button.dataset.id;
    const status = button.dataset.reportStatus;
    const noteResult = await AdminShared.showInputModal({
      title: 'Update event report',
      message: `Mark this report as ${status}. Add an optional admin note for the audit trail.`,
      label: 'Admin note',
      required: false,
      confirmText: 'Update report',
      type: 'textarea',
    });
    const adminNotes = noteResult.confirmed ? noteResult.value || '' : '';
    button.disabled = true;
    try {
      await api(`${API_BASE}/reports/${encodeURIComponent(id)}`, 'PUT', { status, adminNotes });
      showToast(`Report marked ${status}`, 'success');
      await refreshAll();
    } catch (err) {
      showToast(err.message || 'Failed to update report', 'error');
      button.disabled = false;
    }
  }

  async function refreshAll() {
    await Promise.all([loadStats(), loadEvents(), loadRequests(), loadReports()]);
  }

  function setupListeners() {
    document
      .getElementById('adminCalendarCreateBtn')
      ?.addEventListener('click', () => openEventModal());
    document.getElementById('adminCalendarRefreshEvents')?.addEventListener('click', loadEvents);
    document
      .getElementById('adminCalendarRefreshRequests')
      ?.addEventListener('click', loadRequests);
    document.getElementById('adminCalendarRefreshReports')?.addEventListener('click', loadReports);
    document.getElementById('adminCalendarApplyFilters')?.addEventListener('click', loadEvents);
    document.getElementById('adminCalendarEventForm')?.addEventListener('submit', submitEventForm);
    document
      .getElementById('adminCalendarEventModalClose')
      ?.addEventListener('click', closeEventModal);
    document.getElementById('adminCalendarEventCancel')?.addEventListener('click', closeEventModal);
    document.getElementById('adminCalendarEventModal')?.addEventListener('click', e => {
      if (e.target.id === 'adminCalendarEventModal') {
        closeEventModal();
      }
    });
    ['eventSearchFilter', 'eventCountyFilter'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          loadEvents();
        }
      });
    });
  }

  async function init() {
    setupListeners();
    await refreshAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
