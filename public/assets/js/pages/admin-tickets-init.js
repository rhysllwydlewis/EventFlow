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

  const TIER_LABELS = {
    pro_plus: 'Pro Plus',
    pro: 'Pro',
    free: 'Free',
  };

  // Tickets waiting more than this many hours without admin reply are considered stale.
  const STALE_HOURS = 48;
  const MS_PER_HOUR = 3_600_000;

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

  function isActiveTicket(ticket) {
    return ticket.status === 'open' || ticket.status === 'in_progress';
  }

  function isStale(ticket) {
    if (!isActiveTicket(ticket)) {
      return false;
    }
    const responses = getTicketResponses(ticket);
    // Stale if the last reply was from a non-admin (or there are no replies at all) and
    // it's been more than STALE_HOURS hours since the last update.
    const lastAdminReply = responses.reduce((latest, r) => {
      if (r.userRole === 'admin') {
        const t = new Date(r.createdAt || 0).getTime();
        return t > latest ? t : latest;
      }
      return latest;
    }, 0);
    const lastUpdate = new Date(ticket.updatedAt || ticket.createdAt || 0).getTime();
    const compareTime = lastAdminReply > 0 ? lastAdminReply : lastUpdate;
    const hoursAgo = (Date.now() - compareTime) / MS_PER_HOUR;
    return hoursAgo > STALE_HOURS;
  }

  function getTierBadgeHtml(tier) {
    const label = TIER_LABELS[tier] || 'Free';
    const safeKey = ['pro_plus', 'pro', 'free'].includes(tier) ? tier : 'free';
    return `<span class="tier-badge tier-badge--${safeKey}">${escapeHtml(label)}</span>`;
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
        '<div class="data-section"><p class="small text-error">Failed to load tickets. Please try again.</p></div>';
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
    const unassigned = allTickets.filter(
      ticket => isActiveTicket(ticket) && !ticket.assignedTo
    ).length;
    const stale = allTickets.filter(isStale).length;
    const proPlusCount = allTickets.filter(t => t.accountTier === 'pro_plus').length;
    const proCount = allTickets.filter(t => t.accountTier === 'pro').length;

    const cards = [
      { label: 'Open', value: open, mod: 'open' },
      { label: 'In Progress', value: inProgress, mod: 'progress' },
      { label: 'Resolved', value: resolved, mod: 'resolved' },
      { label: 'Urgent', value: urgent, mod: 'urgent' },
      { label: 'Unassigned (active)', value: unassigned, mod: 'warning' },
      { label: `Stale (>${STALE_HOURS}h)`, value: stale, mod: 'stale' },
      { label: 'Pro Plus tickets', value: proPlusCount, mod: 'pro_plus' },
      { label: 'Pro tickets', value: proCount, mod: 'pro' },
    ];

    summaryContainer.innerHTML = cards
      .map(
        card => `
      <div class="ticket-summary-card ticket-summary-card--${card.mod}">
        <div class="ticket-summary-card__label">${escapeHtml(card.label)}</div>
        <div class="ticket-summary-card__value">${card.value}</div>
      </div>`
      )
      .join('');
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
    const tierFilter = document.getElementById('tierFilter')?.value || '';
    const sortOrder = document.getElementById('sortOrder')?.value || 'newest';

    const PRIORITY_SORT_RANK = { urgent: 4, high: 3, medium: 2, low: 1 };

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

      if (tierFilter && (ticket.accountTier || 'free') !== tierFilter) {
        return false;
      }

      return true;
    });

    if (!filtered.length) {
      container.innerHTML = `
        <div class="data-section">
          <div class="empty-state">
            <div class="empty-state-icon">🎫</div>
            <h3>No tickets found</h3>
            <p class="small">
              ${allTickets.length === 0 ? 'Support tickets will appear here when users submit them.' : 'No tickets match your current filters.'}
            </p>
          </div>
        </div>
      `;
      return;
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortOrder === 'priority') {
        const rankA = PRIORITY_SORT_RANK[a.priority] || 2;
        const rankB = PRIORITY_SORT_RANK[b.priority] || 2;
        if (rankB !== rankA) {
          return rankB - rankA;
        }
        // secondary: newest first
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sortOrder === 'oldest') {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      if (sortOrder === 'updated') {
        return (
          new Date(b.updatedAt || b.createdAt).getTime() -
          new Date(a.updatedAt || a.createdAt).getTime()
        );
      }
      // newest (default)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    let html =
      '<div class="table-wrapper"><table><thead><tr><th>Subject</th><th>From / Tier</th><th>Status</th><th>Priority</th><th>Created</th><th>Assigned</th><th>Actions</th></tr></thead><tbody>';

    filtered.forEach(ticket => {
      const createdAt = formatDate(ticket.createdAt);
      const senderName = ticket.senderName || ticket.userName || 'Unknown User';
      const senderEmail = ticket.senderEmail || ticket.userEmail || '';
      const replyCount = getTicketResponses(ticket).length;
      const tierBadge = getTierBadgeHtml(ticket.accountTier || 'free');
      const staleIndicator = isStale(ticket)
        ? ' <span class="stale-indicator" title="No admin reply in over 48 hours">⚠ stale</span>'
        : '';

      html += `
        <tr>
          <td>
            <strong>${escapeHtml(ticket.subject || 'No subject')}</strong>${staleIndicator}<br>
            <span class="small">${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}</span>
          </td>
          <td>
            ${escapeHtml(senderName)}<br>
            <span class="small">${escapeHtml(senderEmail)}</span><br>
            ${tierBadge}
          </td>
          <td><span class="badge badge-${ticket.status || 'open'}">${(ticket.status || 'open').replace('_', ' ')}</span></td>
          <td><span class="badge badge-priority-${ticket.priority || 'medium'}">${ticket.priority || 'medium'}</span></td>
          <td class="small">${createdAt}</td>
          <td class="small">${ticket.assignedTo ? escapeHtml(ticket.assignedTo) : '<em>Unassigned</em>'}</td>
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
          <div class="ticket-response ticket-response--${isAdmin ? 'admin' : 'user'}">
            <div class="ticket-response__header">
              <strong>${escapeHtml(author)} ${isAdmin ? '<span class="badge badge-in_progress">Admin</span>' : ''}</strong>
              <span class="small">${formatDate(response.createdAt || response.timestamp)}</span>
            </div>
            <p class="ticket-response__body">${escapeHtml(response.message || '')}</p>
          </div>
        `;
      })
      .join('');

    // Triage metadata display
    const tier = ticket.accountTier || 'free';
    const tierLabel = TIER_LABELS[tier] || 'Free';
    const prioritySourceLabel =
      ticket.prioritySource === 'admin' ? 'Admin override' : 'Auto (account tier)';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal ticket-modal">
        <div class="modal-header">
          <h3>Manage Ticket</h3>
          <button class="modal-close" type="button" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="small ticket-modal__sender">From ${escapeHtml(ticket.senderName || ticket.senderEmail || 'Unknown')}</p>
          <h4 class="ticket-modal__subject">${escapeHtml(ticket.subject || 'No subject')}</h4>

          <div class="ticket-modal__meta">
            ${getTierBadgeHtml(tier)}
            <span class="small">Account tier: <strong>${escapeHtml(tierLabel)}</strong></span>
            <span class="small">• Priority source: <strong>${escapeHtml(prioritySourceLabel)}</strong></span>
          </div>

          <p class="ticket-modal__message">${escapeHtml(ticket.message || '')}</p>

          <div class="ticket-modal__controls">
            <label class="small">Status
              <select id="ticketStatusSelect">${statusOptions}</select>
            </label>
            <label class="small">Priority (admin override)
              <select id="ticketPrioritySelect">${priorityOptions}</select>
            </label>
            <label class="small">Assigned To
              <input id="ticketAssignedTo" value="${escapeHtml(ticket.assignedTo || '')}" placeholder="admin@email.com">
            </label>
          </div>

          <h4 class="ticket-modal__section-heading">Conversation</h4>
          <div class="ticket-modal__responses">${responsesHtml || '<p class="small">No replies yet.</p>'}</div>

          <label for="ticketReplyMessage" class="small ticket-modal__reply-label">Reply to user</label>
          <textarea id="ticketReplyMessage" rows="4" placeholder="Write your reply..."></textarea>
        </div>
        <div class="modal-footer ticket-modal__footer">
          <button type="button" class="btn btn-secondary" id="markResolvedBtn">Mark Resolved</button>
          <div class="ticket-modal__footer-actions">
            <button type="button" class="btn btn-secondary" id="saveTicketBtn">Save Changes</button>
            <button type="button" class="btn btn-primary" id="sendReplyBtn">Send Reply</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => {
      modal.remove();
      document.removeEventListener('keydown', handleKeydown);
    };

    const handleKeydown = event => {
      if (event.key === 'Escape') {
        close();
      }
    };

    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.addEventListener('click', event => {
      if (event.target === modal) {
        close();
      }
    });

    // Register Escape-key listener after all click-close paths are wired
    document.addEventListener('keydown', handleKeydown);

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
    [
      'ticketSearch',
      'statusFilter',
      'priorityFilter',
      'assignedFilter',
      'tierFilter',
      'sortOrder',
    ].forEach(id => {
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

  // =============================================
  // Tab switching
  // =============================================
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      document.querySelectorAll('.admin-tab').forEach(t => {
        t.classList.remove('admin-tab--active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.admin-tab-panel').forEach(p => {
        p.style.display = 'none';
      });
      tab.classList.add('admin-tab--active');
      tab.setAttribute('aria-selected', 'true');
      const panel = document.getElementById(`panel-${targetTab}`);
      if (panel) {
        panel.style.display = 'block';
      }
      if (targetTab === 'contacts') {
        loadContactEnquiries();
      }
    });
  });
})();

// =============================================
// External Contact Enquiries Module
// =============================================
(function () {
  'use strict';

  let allEnquiries = [];

  const CONTACT_STATUS_LABELS = {
    new: 'New',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    closed: 'Closed',
  };

  const CONTACT_STATUS_BADGE = {
    new: 'badge-new',
    in_progress: 'badge-contact-in_progress',
    resolved: 'badge-resolved',
    closed: 'badge-closed',
  };

  function escHtml(str) {
    if (!str) {
      return '';
    }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function relativeTime(dateStr) {
    if (!dateStr) {
      return '—';
    }
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2) {
      return 'just now';
    }
    if (mins < 60) {
      return `${mins}m ago`;
    }
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) {
      return `${hrs}h ago`;
    }
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  window.loadContactEnquiries = async function () {
    const container = document.getElementById('contactsContainer');
    if (!container) {
      return;
    }
    try {
      const data = await AdminShared.api('/api/admin/contact-enquiries', 'GET');
      allEnquiries = data.items || [];
      renderContactEnquiries();
      updateContactSummaryCards();
      updateContactBadge();
    } catch (err) {
      if (container) {
        container.innerHTML = `<p class="small" style="color:#ef4444;">Failed to load enquiries: ${escHtml(err.message)}</p>`;
      }
    }
  };

  function updateContactBadge() {
    const badge = document.getElementById('contactEnquiriesBadge');
    if (!badge) {
      return;
    }
    const newCount = allEnquiries.filter(e => e.status === 'new').length;
    if (newCount > 0) {
      badge.textContent = newCount;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }

  function updateContactSummaryCards() {
    const container = document.getElementById('contactSummaryCards');
    if (!container) {
      return;
    }
    const total = allEnquiries.length;
    const newCount = allEnquiries.filter(e => e.status === 'new').length;
    const inProgress = allEnquiries.filter(e => e.status === 'in_progress').length;
    const resolved = allEnquiries.filter(e => e.status === 'resolved').length;
    container.innerHTML = `
      <div class="ticket-summary-card ticket-summary-card--open">
        <div class="ticket-summary-card__label">New</div>
        <div class="ticket-summary-card__value">${newCount}</div>
      </div>
      <div class="ticket-summary-card ticket-summary-card--progress">
        <div class="ticket-summary-card__label">In Progress</div>
        <div class="ticket-summary-card__value">${inProgress}</div>
      </div>
      <div class="ticket-summary-card ticket-summary-card--resolved">
        <div class="ticket-summary-card__label">Resolved</div>
        <div class="ticket-summary-card__value">${resolved}</div>
      </div>
      <div class="ticket-summary-card">
        <div class="ticket-summary-card__label">Total</div>
        <div class="ticket-summary-card__value">${total}</div>
      </div>
    `;
  }

  function getFilteredEnquiries() {
    const search = (document.getElementById('contactSearch')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('contactStatusFilter')?.value || '';
    const sortOrder = document.getElementById('contactSortOrder')?.value || 'newest';

    const items = allEnquiries.filter(e => {
      if (statusFilter && e.status !== statusFilter) {
        return false;
      }
      if (search) {
        const haystack = [e.senderName, e.senderEmail, e.subject, e.message]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }
      return true;
    });

    items.sort((a, b) => {
      if (sortOrder === 'newest') {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      }
      if (sortOrder === 'oldest') {
        return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      }
      if (sortOrder === 'updated') {
        return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
      }
      return 0;
    });

    return items;
  }

  function renderContactEnquiries() {
    const container = document.getElementById('contactsContainer');
    if (!container) {
      return;
    }
    const items = getFilteredEnquiries();

    if (items.length === 0) {
      container.innerHTML = `<p class="small" style="color:#6b7280;padding:1.5rem 0;">No contact enquiries found.</p>`;
      return;
    }

    const tableHtml = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Received</th>
              <th>Replies</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map(
                e => `
              <tr>
                <td>
                  <strong>${escHtml(e.senderName)}</strong><br>
                  <span class="small">${escHtml(e.senderEmail)}</span>
                </td>
                <td>${escHtml(e.subject || '—')}</td>
                <td>
                  <span class="badge ${CONTACT_STATUS_BADGE[e.status] || 'badge'}">
                    ${escHtml(CONTACT_STATUS_LABELS[e.status] || e.status)}
                  </span>
                </td>
                <td class="small">${relativeTime(e.createdAt)}</td>
                <td class="small">${Array.isArray(e.responses) ? e.responses.length : 0}</td>
                <td>
                  <button class="btn-sm btn-primary" data-contact-manage="${escHtml(e.id)}">Manage</button>
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = tableHtml;

    container.querySelectorAll('[data-contact-manage]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.contactManage;
        const enquiry = allEnquiries.find(e => e.id === id);
        if (enquiry) {
          openContactModal(enquiry);
        }
      });
    });
  }

  function openContactModal(enquiry) {
    const existing = document.getElementById('contactManageModal');
    if (existing) {
      existing.remove();
    }

    const responses = Array.isArray(enquiry.responses) ? enquiry.responses : [];
    const responsesHtml =
      responses.length === 0
        ? '<p class="small" style="color:#6b7280;font-style:italic;">No replies yet.</p>'
        : responses
            .map(
              r => `
          <div class="ticket-response ${r.userRole === 'admin' ? 'ticket-response--admin' : 'ticket-response--user'}">
            <div class="ticket-response__header">
              <strong>${escHtml(r.userName || (r.userRole === 'admin' ? 'Support Team' : 'Visitor'))}</strong>
              <span class="small ticket-response__timestamp">${relativeTime(r.createdAt)}</span>
            </div>
            <p class="ticket-response__body">${escHtml(r.message)}</p>
          </div>
        `
            )
            .join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'contactManageModal';
    overlay.innerHTML = `
      <div class="modal contact-modal ticket-modal" role="dialog" aria-modal="true" aria-labelledby="contactModalTitle">
        <div class="modal-header">
          <div>
            <p class="ticket-modal__sender">From: ${escHtml(enquiry.senderName)} &lt;${escHtml(enquiry.senderEmail)}&gt;</p>
            <h3 id="contactModalTitle" class="ticket-modal__subject">${escHtml(enquiry.subject || 'General Enquiry')}</h3>
            <div class="ticket-modal__meta">
              <span class="badge ${CONTACT_STATUS_BADGE[enquiry.status] || 'badge'}">${escHtml(CONTACT_STATUS_LABELS[enquiry.status] || enquiry.status)}</span>
              <span>Received ${relativeTime(enquiry.createdAt)}</span>
            </div>
          </div>
          <button class="modal-close" id="closeContactModal" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="ticket-modal__message">${escHtml(enquiry.message)}</p>

          <div class="ticket-modal__controls">
            <label class="small">Status
              <select id="contactStatusUpdate">
                <option value="new"${enquiry.status === 'new' ? ' selected' : ''}>New</option>
                <option value="in_progress"${enquiry.status === 'in_progress' ? ' selected' : ''}>In Progress</option>
                <option value="resolved"${enquiry.status === 'resolved' ? ' selected' : ''}>Resolved</option>
                <option value="closed"${enquiry.status === 'closed' ? ' selected' : ''}>Closed</option>
              </select>
            </label>
          </div>

          <h4 class="ticket-modal__section-heading">Conversation</h4>
          <div class="ticket-modal__responses">${responsesHtml}</div>

          <label for="contactReplyMessage" class="ticket-modal__reply-label">
            Reply to ${escHtml(enquiry.senderName)} — sends email via Postmark
          </label>
          <textarea id="contactReplyMessage" rows="4" placeholder="Write your reply…"></textarea>
        </div>
        <div class="modal-footer ticket-modal__footer">
          <button type="button" class="btn btn-secondary" id="saveContactStatusBtn">Save Status</button>
          <div class="ticket-modal__footer-actions">
            <button type="button" class="btn btn-secondary" id="cancelContactModal">Cancel</button>
            <button type="button" class="btn btn-primary" id="sendContactReplyBtn">Send Reply</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('#closeContactModal').focus();

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', handleContactKeydown);
    };
    const handleContactKeydown = e => {
      if (e.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('keydown', handleContactKeydown);
    overlay.querySelector('#cancelContactModal').addEventListener('click', close);
    overlay.querySelector('#closeContactModal').addEventListener('click', close);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        close();
      }
    });

    overlay.querySelector('#saveContactStatusBtn').addEventListener('click', async () => {
      const newStatus = overlay.querySelector('#contactStatusUpdate').value;
      try {
        await AdminShared.api(`/api/admin/contact-enquiries/${enquiry.id}`, 'PUT', {
          status: newStatus,
        });
        Toast?.success?.('Status updated');
        close();
        await window.loadContactEnquiries();
      } catch (err) {
        Toast?.error?.(err.message || 'Failed to update status');
      }
    });

    overlay.querySelector('#sendContactReplyBtn').addEventListener('click', async () => {
      const message = overlay.querySelector('#contactReplyMessage').value.trim();
      if (!message) {
        Toast?.warning?.('Please write a reply');
        return;
      }
      const btn = overlay.querySelector('#sendContactReplyBtn');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        await AdminShared.api(`/api/admin/contact-enquiries/${enquiry.id}/reply`, 'POST', {
          message,
        });
        Toast?.success?.('Reply sent via email');
        close();
        await window.loadContactEnquiries();
      } catch (err) {
        Toast?.error?.(err.message || 'Failed to send reply');
        btn.disabled = false;
        btn.textContent = 'Send Reply';
      }
    });
  }

  // Filter listeners
  ['contactSearch', 'contactStatusFilter', 'contactSortOrder'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) {
      return;
    }
    el.addEventListener(id === 'contactSearch' ? 'input' : 'change', renderContactEnquiries);
  });

  document
    .getElementById('refreshContactsBtn')
    ?.addEventListener('click', window.loadContactEnquiries);
})();
