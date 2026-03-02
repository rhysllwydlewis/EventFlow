(function () {
  'use strict';

  let allTickets = [];

  const STATUS_OPTIONS = [
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'closed', label: 'Closed' },
  ];

  const PRIORITY_OPTIONS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ];

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function formatDate(timestamp) {
    return AdminShared.formatTimestamp(timestamp);
  }

  function getTicketResponses(ticket) {
    if (Array.isArray(ticket.responses)) {
      return ticket.responses;
    }
    if (Array.isArray(ticket.replies)) {
      return ticket.replies;
    }
    return [];
  }

  async function loadTickets() {
    const container = document.getElementById('ticketsContainer');
    try {
      container.innerHTML = '<p class="small">Loading tickets...</p>';
      const data = await AdminShared.api('/api/admin/tickets');
      allTickets = data.items || [];
      renderSummary();
      renderTickets();
    } catch (error) {
      console.error('Error loading tickets:', error);
      container.innerHTML =
        '<div class="data-section"><p class="small" style="color:#ef4444;">Failed to load tickets. Please try again.</p></div>';
    }
  }

  function renderSummary() {
    const summaryContainer = document.getElementById('ticketSummaryCards');
    if (!summaryContainer) {
      return;
    }

    const open = allTickets.filter(ticket => ticket.status === 'open').length;
    const inProgress = allTickets.filter(ticket => ticket.status === 'in_progress').length;
    const resolved = allTickets.filter(ticket => ticket.status === 'resolved').length;
    const urgent = allTickets.filter(ticket => ticket.priority === 'urgent').length;

    summaryContainer.innerHTML = `
      <div class="card" style="min-width:180px;">
        <div class="small">Open</div>
        <div style="font-size:1.5rem;font-weight:700;color:#92400e;">${open}</div>
      </div>
      <div class="card" style="min-width:180px;">
        <div class="small">In Progress</div>
        <div style="font-size:1.5rem;font-weight:700;color:#1e3a8a;">${inProgress}</div>
      </div>
      <div class="card" style="min-width:180px;">
        <div class="small">Resolved</div>
        <div style="font-size:1.5rem;font-weight:700;color:#166534;">${resolved}</div>
      </div>
      <div class="card" style="min-width:180px;">
        <div class="small">Urgent</div>
        <div style="font-size:1.5rem;font-weight:700;color:#b91c1c;">${urgent}</div>
      </div>
    `;
  }

  function renderTickets() {
    const container = document.getElementById('ticketsContainer');
    if (!container) {
      return;
    }

    const searchTerm = document.getElementById('ticketSearch')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('statusFilter')?.value || '';
    const priorityFilter = document.getElementById('priorityFilter')?.value || '';
    const assignedFilter = document.getElementById('assignedFilter')?.value || '';

    const filtered = allTickets.filter(ticket => {
      if (searchTerm) {
        const subject = (ticket.subject || '').toLowerCase();
        const message = (ticket.message || '').toLowerCase();
        const userName = (ticket.senderName || ticket.userName || '').toLowerCase();
        const userEmail = (ticket.senderEmail || ticket.userEmail || '').toLowerCase();
        if (
          !subject.includes(searchTerm) &&
          !message.includes(searchTerm) &&
          !userName.includes(searchTerm) &&
          !userEmail.includes(searchTerm)
        ) {
          return false;
        }
      }

      if (statusFilter && ticket.status !== statusFilter) {
        return false;
      }

      if (priorityFilter && ticket.priority !== priorityFilter) {
        return false;
      }

      if (assignedFilter === 'unassigned' && ticket.assignedTo) {
        return false;
      }

      if (assignedFilter === 'assigned' && !ticket.assignedTo) {
        return false;
      }

      return true;
    });

    if (!filtered.length) {
      container.innerHTML = `
        <div class="data-section">
          <div style="text-align:center;padding:4rem 2rem;">
            <div style="font-size:4rem;margin-bottom:1rem;">🎫</div>
            <h3 style="margin:0 0 0.5rem 0;font-size:1.5rem;">No tickets found</h3>
            <p style="color:#6b7280;margin:0;">
              ${allTickets.length === 0 ? 'Support tickets will appear here when users submit them.' : 'No tickets match your current filters.'}
            </p>
          </div>
        </div>
      `;
      return;
    }

    let html =
      '<div class="table-wrapper"><table><thead><tr><th>Subject</th><th>From</th><th>Status</th><th>Priority</th><th>Created</th><th>Assigned</th><th>Actions</th></tr></thead><tbody>';

    filtered.forEach(ticket => {
      const createdAt = formatDate(ticket.createdAt);
      const senderName = ticket.senderName || ticket.userName || 'Unknown User';
      const senderEmail = ticket.senderEmail || ticket.userEmail || '';
      const replyCount = getTicketResponses(ticket).length;

      html += `
        <tr>
          <td><strong>${escapeHtml(ticket.subject || 'No subject')}</strong><br><span class="small">${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}</span></td>
          <td>${escapeHtml(senderName)}<br><span class="small">${escapeHtml(senderEmail)}</span></td>
          <td><span class="badge badge-${ticket.status || 'open'}">${(ticket.status || 'open').replace('_', ' ')}</span></td>
          <td><span class="badge badge-priority-${ticket.priority || 'medium'}">${ticket.priority || 'medium'}</span></td>
          <td class="small">${createdAt}</td>
          <td class="small">${ticket.assignedTo ? escapeHtml(ticket.assignedTo) : 'Unassigned'}</td>
          <td>
            <button class="btn-sm btn-primary" data-action="viewTicket" data-id="${ticket.id}">Manage</button>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;

    container.querySelectorAll('[data-action="viewTicket"]').forEach(button => {
      button.addEventListener('click', () => openTicketModal(button.dataset.id));
    });
  }

  async function openTicketModal(ticketId) {
    const ticket = allTickets.find(item => item.id === ticketId);
    if (!ticket) {
      return;
    }

    const statusOptions = STATUS_OPTIONS.map(
      option =>
        `<option value="${option.value}" ${ticket.status === option.value ? 'selected' : ''}>${option.label}</option>`
    ).join('');

    const priorityOptions = PRIORITY_OPTIONS.map(
      option =>
        `<option value="${option.value}" ${ticket.priority === option.value ? 'selected' : ''}>${option.label}</option>`
    ).join('');

    const responsesHtml = getTicketResponses(ticket)
      .map(response => {
        const author =
          response.userName || response.authorEmail || response.responderName || 'Unknown';
        const role = response.userRole || response.responderType || 'user';
        const isAdmin = role === 'admin';
        return `
          <div style="background:${isAdmin ? '#eff6ff' : '#f9fafb'};border:1px solid #e5e7eb;border-radius:8px;padding:0.75rem;margin-bottom:0.75rem;">
            <div style="display:flex;justify-content:space-between;gap:0.75rem;">
              <strong>${escapeHtml(author)} ${isAdmin ? '<span class="badge badge-in_progress">Admin</span>' : ''}</strong>
              <span class="small">${formatDate(response.createdAt || response.timestamp)}</span>
            </div>
            <p style="margin:0.5rem 0 0;white-space:pre-wrap;">${escapeHtml(response.message || '')}</p>
          </div>
        `;
      })
      .join('');

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal" style="max-width:780px;">
        <div class="modal-header">
          <h3>Manage Ticket</h3>
          <button class="modal-close" type="button" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="small" style="margin:0 0 0.25rem;">From ${escapeHtml(ticket.senderName || ticket.senderEmail || 'Unknown')}</p>
          <h4 style="margin:0 0 0.5rem;">${escapeHtml(ticket.subject || 'No subject')}</h4>
          <p style="background:#f9fafb;border-radius:8px;padding:0.75rem;border:1px solid #e5e7eb;white-space:pre-wrap;">${escapeHtml(ticket.message || '')}</p>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.75rem;margin:1rem 0;">
            <label class="small">Status
              <select id="ticketStatusSelect">${statusOptions}</select>
            </label>
            <label class="small">Priority
              <select id="ticketPrioritySelect">${priorityOptions}</select>
            </label>
            <label class="small">Assigned To
              <input id="ticketAssignedTo" value="${escapeHtml(ticket.assignedTo || '')}" placeholder="admin@email.com">
            </label>
          </div>

          <h4 style="margin:1rem 0 0.5rem;">Conversation</h4>
          <div>${responsesHtml || '<p class="small">No replies yet.</p>'}</div>

          <label for="ticketReplyMessage" class="small" style="display:block;margin:1rem 0 0.5rem;">Reply to user</label>
          <textarea id="ticketReplyMessage" rows="4" placeholder="Write your reply..." style="width:100%;"></textarea>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary" id="markResolvedBtn">Mark Resolved</button>
          <div style="display:flex;gap:0.5rem;">
            <button type="button" class="btn btn-secondary" id="saveTicketBtn">Save Changes</button>
            <button type="button" class="btn btn-primary" id="sendReplyBtn">Send Reply</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.addEventListener('click', event => {
      if (event.target === modal) {
        close();
      }
    });

    modal.querySelector('#saveTicketBtn').addEventListener('click', async () => {
      try {
        await AdminShared.api(`/api/admin/tickets/${ticket.id}`, 'PUT', {
          status: modal.querySelector('#ticketStatusSelect').value,
          priority: modal.querySelector('#ticketPrioritySelect').value,
          assignedTo: modal.querySelector('#ticketAssignedTo').value.trim(),
        });
        Toast?.success?.('Ticket updated');
        close();
        await loadTickets();
      } catch (error) {
        Toast?.error?.(error.message || 'Failed to update ticket');
      }
    });

    modal.querySelector('#markResolvedBtn').addEventListener('click', async () => {
      try {
        await AdminShared.api(`/api/admin/tickets/${ticket.id}`, 'PUT', {
          status: 'resolved',
        });
        Toast?.success?.('Ticket marked as resolved');
        close();
        await loadTickets();
      } catch (error) {
        Toast?.error?.(error.message || 'Failed to resolve ticket');
      }
    });

    modal.querySelector('#sendReplyBtn').addEventListener('click', async () => {
      const message = modal.querySelector('#ticketReplyMessage').value.trim();
      if (!message) {
        Toast?.warning?.('Please add a reply message');
        return;
      }
      try {
        await AdminShared.api(`/api/admin/tickets/${ticket.id}/reply`, 'POST', { message });
        Toast?.success?.('Reply sent');
        close();
        await loadTickets();
      } catch (error) {
        Toast?.error?.(error.message || 'Failed to send reply');
      }
    });
  }

  function setupFilterListeners() {
    ['ticketSearch', 'statusFilter', 'priorityFilter', 'assignedFilter'].forEach(id => {
      const element = document.getElementById(id);
      if (!element) {
        return;
      }
      const eventType = id === 'ticketSearch' ? 'input' : 'change';
      element.addEventListener(eventType, renderTickets);
    });
  }

  document.getElementById('backToDashboard')?.addEventListener('click', () => {
    window.location.href = '/admin';
  });

  document.getElementById('refreshTicketsBtn')?.addEventListener('click', loadTickets);

  setupFilterListeners();
  loadTickets();
})();
