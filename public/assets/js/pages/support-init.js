'use strict';
window.__EF_PAGE__ = 'support';

(function () {
  let allTickets = [];
  let activeFilter = '';

  function escHtml(s) {
    if (!s || typeof s !== 'string') {
      return '';
    }
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function fmtDate(iso) {
    if (!iso) {
      return '';
    }
    try {
      return new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch (_) {
      return iso;
    }
  }

  function badgeClass(status) {
    const map = {
      open: 'badge-open',
      pending: 'badge-pending',
      resolved: 'badge-resolved',
      closed: 'badge-closed',
    };
    return map[status] || 'badge-open';
  }

  async function getCsrf() {
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
    } catch (_) {
      return '';
    }
    const m = document.cookie.match(/(?:^|;\s*)(?:csrf|csrfToken)=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function loadTickets() {
    const loading = document.getElementById('tickets-loading');
    const container = document.getElementById('tickets-container');
    const empty = document.getElementById('tickets-empty');
    const error = document.getElementById('tickets-error');

    loading.style.display = 'block';
    container.style.display = 'none';
    empty.style.display = 'none';
    error.style.display = 'none';

    try {
      const r = await fetch('/api/v1/tickets', { credentials: 'include' });
      if (!r.ok) {
        if (r.status === 401) {
          window.location.href = `/auth?redirect=${encodeURIComponent(window.location.pathname)}`;
          return;
        }
        throw new Error(`HTTP ${r.status}`);
      }
      const d = await r.json();
      allTickets = d.tickets || d.data || [];
      loading.style.display = 'none';
      renderTickets();
    } catch (err) {
      loading.style.display = 'none';
      document.getElementById('tickets-error-msg').textContent =
        `Failed to load tickets: ${err.message}`;
      error.style.display = 'block';
    }
  }

  function renderTickets() {
    const container = document.getElementById('tickets-container');
    const empty = document.getElementById('tickets-empty');

    const filtered = activeFilter
      ? allTickets.filter(t => (t.status || 'open') === activeFilter)
      : allTickets;

    if (filtered.length === 0) {
      container.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    container.style.display = 'block';
    container.innerHTML = filtered
      .map(ticket => {
        const id = ticket._id || ticket.id;
        const status = ticket.status || 'open';
        return `
        <div class="ticket-card" tabindex="0" role="button" data-ticket-id="${escHtml(id)}" aria-label="View ticket: ${escHtml(ticket.subject)}">
          <div class="ticket-card-header">
            <div class="ticket-subject">${escHtml(ticket.subject)}</div>
            <span class="ticket-badge ${badgeClass(status)}">${escHtml(status)}</span>
          </div>
          <div class="ticket-meta">
            #${escHtml(String(id).slice(-8).toUpperCase())} &nbsp;·&nbsp; ${escHtml(ticket.category || 'general')} &nbsp;·&nbsp; Created ${fmtDate(ticket.createdAt)}
          </div>
          ${ticket.message ? `<div class="ticket-preview">${escHtml(ticket.message)}</div>` : ''}
        </div>
      `;
      })
      .join('');

    container.querySelectorAll('.ticket-card').forEach(card => {
      const open = () => viewTicket(card.dataset.ticketId);
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
  }

  async function viewTicket(ticketId) {
    const body = document.getElementById('view-ticket-body');
    body.innerHTML = '<div style="text-align:center;padding:2rem;color:#9ca3af;">Loading…</div>';
    openViewModal();

    try {
      const r = await fetch(`/api/v1/tickets/${encodeURIComponent(ticketId)}`, {
        credentials: 'include',
      });
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      const d = await r.json();
      const ticket = d.ticket || d;
      const replies = ticket.replies || [];

      body.innerHTML = `
        <div style="margin-bottom:1rem;">
          <h4 style="margin:0 0 0.35rem;">${escHtml(ticket.subject)}</h4>
          <div style="font-size: 0.8125rem;color:#9ca3af;margin-bottom:0.75rem;">
            Status: <strong>${escHtml(ticket.status || 'open')}</strong> &nbsp;·&nbsp; Priority: <strong>${escHtml(ticket.priority || 'medium')}</strong> &nbsp;·&nbsp; ${fmtDate(ticket.createdAt)}
          </div>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:1rem;font-size: 0.875rem;color:#374151;white-space:pre-wrap;">${escHtml(ticket.message)}</div>
        </div>
        <div class="reply-thread">
          ${replies
            .map(
              reply => `
            <div class="reply-item ${reply.isStaff || reply.authorRole === 'admin' ? 'reply-staff' : 'reply-user'}">
              <div class="reply-meta">${reply.isStaff || reply.authorRole === 'admin' ? '🛡 EventFlow Support' : '👤 You'} &nbsp;·&nbsp; ${fmtDate(reply.createdAt)}</div>
              <div style="white-space:pre-wrap;">${escHtml(reply.message || reply.content || '')}</div>
            </div>
          `
            )
            .join('')}
        </div>
        ${
          ticket.status !== 'closed'
            ? `
        <div class="reply-form">
          <div class="form-row">
            <label for="reply-message">Reply</label>
            <textarea id="reply-message" rows="3" placeholder="Type your reply…" maxlength="5000"></textarea>
          </div>
          <button type="button" class="cta" id="send-reply-btn" data-ticket-id="${escHtml(String(ticket._id || ticket.id))}">Send Reply</button>
          <span id="reply-status" style="font-size:0.875rem;margin-left:0.75rem;" role="status" aria-live="polite"></span>
        </div>
        `
            : '<p style="color:#9ca3af;font-size:0.875rem;margin-top:1rem;">This ticket is closed.</p>'
        }
      `;

      const sendBtn = body.querySelector('#send-reply-btn');
      if (sendBtn) {
        sendBtn.addEventListener('click', async () => {
          const replyMsg = body.querySelector('#reply-message').value.trim();
          const replyStatus = body.querySelector('#reply-status');
          if (!replyMsg) {
            replyStatus.textContent = 'Please enter a reply.';
            replyStatus.style.color = '#ef4444';
            return;
          }
          sendBtn.disabled = true;
          sendBtn.textContent = 'Sending…';
          replyStatus.textContent = '';
          try {
            const csrf = await getCsrf();
            const rr = await fetch(
              `/api/v1/tickets/${encodeURIComponent(sendBtn.dataset.ticketId)}/reply`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                credentials: 'include',
                body: JSON.stringify({ message: replyMsg }),
              }
            );
            if (!rr.ok) {
              throw new Error(`HTTP ${rr.status}`);
            }
            replyStatus.textContent = '✓ Reply sent';
            replyStatus.style.color = '#10b981';
            body.querySelector('#reply-message').value = '';
            setTimeout(() => viewTicket(sendBtn.dataset.ticketId), 800);
          } catch (err) {
            replyStatus.textContent = `✗ Failed to send: ${err.message}`;
            replyStatus.style.color = '#ef4444';
          } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send Reply';
          }
        });
      }
    } catch (err) {
      body.innerHTML = `<div style="color:#ef4444;padding:1rem;">Failed to load ticket: ${escHtml(err.message)}</div>`;
    }
  }

  // Filter buttons
  document.querySelectorAll('.filter-status-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filter-status-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      activeFilter = this.dataset.status;
      renderTickets();
    });
  });

  // New ticket modal
  const createModal = document.getElementById('create-ticket-modal');
  const viewModal = document.getElementById('view-ticket-modal');

  function openCreateModal() {
    createModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeCreateModal() {
    createModal.classList.remove('active');
    document.body.style.overflow = '';
  }
  function openViewModal() {
    viewModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeViewModal() {
    viewModal.classList.remove('active');
    document.body.style.overflow = '';
  }

  document.getElementById('new-ticket-btn').addEventListener('click', openCreateModal);
  document.getElementById('create-ticket-close').addEventListener('click', closeCreateModal);
  document.getElementById('create-ticket-cancel').addEventListener('click', closeCreateModal);

  // "Create first ticket" shortcut in empty state
  document.getElementById('create-first-ticket-btn')?.addEventListener('click', openCreateModal);

  // Escape key closes whichever modal is active
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') {
      return;
    }
    if (viewModal.classList.contains('active')) {
      closeViewModal();
      return;
    }
    if (createModal.classList.contains('active')) {
      closeCreateModal();
    }
  });

  document.getElementById('create-ticket-submit').addEventListener('click', async () => {
    const subject = document.getElementById('ticket-subject').value.trim();
    const message = document.getElementById('ticket-message').value.trim();
    const category = document.getElementById('ticket-category').value;
    const priority = document.getElementById('ticket-priority').value;
    const subjectErr = document.getElementById('ticket-subject-error');
    const messageErr = document.getElementById('ticket-message-error');
    let valid = true;

    subjectErr.style.display = 'none';
    messageErr.style.display = 'none';
    if (!subject) {
      subjectErr.style.display = 'block';
      valid = false;
    }
    if (!message) {
      messageErr.style.display = 'block';
      valid = false;
    }
    if (!valid) {
      return;
    }

    const btn = document.getElementById('create-ticket-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    try {
      const csrf = await getCsrf();
      const r = await fetch('/api/v1/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        credentials: 'include',
        body: JSON.stringify({ subject, message, category, priority }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      createModal.classList.remove('active');
      document.getElementById('create-ticket-form').reset();
      await loadTickets();
    } catch (err) {
      const submitStatusEl = document.getElementById('_ticket_submit_status');
      if (submitStatusEl) {
        submitStatusEl.textContent = `✗ Failed to submit: ${err.message}`;
        submitStatusEl.style.display = 'block';
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Ticket';
    }
  });

  // View ticket modal close
  document.getElementById('view-ticket-close').addEventListener('click', closeViewModal);

  // Click-outside closes modals
  createModal.addEventListener('click', e => {
    if (e.target === createModal) {
      closeCreateModal();
    }
  });
  viewModal.addEventListener('click', e => {
    if (e.target === viewModal) {
      closeViewModal();
    }
  });

  // Retry button
  document.getElementById('tickets-retry').addEventListener('click', loadTickets);

  // Initial load
  loadTickets();
})();
