'use strict';
(function () {
  let currentPage = 1;
  let currentReviewRequestPage = 1;

  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[ch]
    );
  }

  function formatDate(value) {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB');
  }

  function setStatus(message, type) {
    const el = document.getElementById('emailCentreStatus');
    if (!el) {
      return;
    }
    el.textContent = message || '';
    el.className = `campaigns-status${type ? ` campaigns-status--${type}` : ''}`;
  }

  function renderSummary(summary) {
    const cards = [
      ['Sent', summary.sent],
      ['Failed', summary.failed],
      ['Delivered', summary.delivered],
      ['Bounced', summary.bounced],
      ['Opened', summary.opened],
      ['Clicked', summary.clicked],
      ['Last 24h', summary.last24h],
      ['Last 7d', summary.last7d],
    ];
    document.getElementById('emailSummaryCards').innerHTML = cards
      .map(
        ([label, value]) =>
          `<article class="email-stat-card"><span>${escapeHtml(label)}</span><strong>${Number(value || 0).toLocaleString('en-GB')}</strong></article>`
      )
      .join('');
  }

  function renderHealth(health) {
    const provenance = health.verificationProvenance || {};
    const rows = [
      ['Email enabled', health.emailEnabled ? 'Yes' : 'No'],
      ['Postmark configured', health.postmarkConfigured ? 'Yes' : 'No'],
      ['Provider status', health.provider || 'unknown'],
      ['Default from', health.defaultFrom || 'Not configured'],
      ['Email domain', health.emailDomain || 'Not configured'],
      ['Campaign stream', health.campaignMessageStream || 'outbound'],
      ['Last webhook received', formatDate(health.lastWebhookAt)],
      ['Verification users checked', provenance.checkedUsers],
      ['Verification critical issues', provenance.criticalIssues],
      ['Verification warnings', provenance.warnings],
      [
        'Email/password users missing verification logs',
        provenance.emailPasswordUsersMissingVerificationEmailLogs,
      ],
      ['Google users with valid provenance', provenance.googleUsersWithValidProvenance],
      ['Verification email logs', provenance.verificationEmailLogs],
      ['Verification emails saved to outbox', provenance.outboxVerificationEmailLogs],
      ['Failed verification emails', provenance.failedVerificationEmailLogs],
      ['Bounced verification emails', provenance.bouncedVerificationEmailLogs],
      ['Last verification email attempt', formatDate(provenance.lastVerificationEmailAttemptAt)],
      [
        'Last successful verification email',
        formatDate(provenance.lastSuccessfulVerificationEmailAt),
      ],
      ['Last failed verification email', formatDate(provenance.lastFailedVerificationEmailAt)],
    ];
    document.getElementById('emailHealthList').innerHTML = rows
      .map(
        ([term, desc]) =>
          `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(desc ?? '—')}</dd></div>`
      )
      .join('');
  }

  function filterValue(id) {
    return (document.getElementById(id).value || '').trim();
  }

  function buildQuery() {
    const params = new URLSearchParams({ page: String(currentPage), limit: '25' });
    [
      ['recipient', 'emailFilterRecipient'],
      ['subject', 'emailFilterSubject'],
      ['template', 'emailFilterTemplate'],
      ['status', 'emailFilterStatus'],
      ['messageStream', 'emailFilterMessageStream'],
      ['tag', 'emailFilterTag'],
      ['fromDate', 'emailFilterFromDate'],
      ['toDate', 'emailFilterToDate'],
    ].forEach(([key, id]) => {
      const value = filterValue(id);
      if (value) {
        params.set(key, value);
      }
    });
    return params;
  }

  function renderLogs(data) {
    const rows = document.getElementById('emailLogRows');
    const items = data.items || [];
    if (!items.length) {
      rows.innerHTML =
        '<tr><td colspan="8" class="email-log-empty">No email activity matches these filters.</td></tr>';
    } else {
      rows.innerHTML = items
        .map(item => {
          const lastEvent = item.lastEventAt
            ? `${item.status} · ${formatDate(item.lastEventAt)}`
            : '—';
          return `<tr>
            <td>${escapeHtml(formatDate(item.createdAt || item.attemptedAt))}</td>
            <td>${escapeHtml(item.to || (item.recipients || []).join(', '))}</td>
            <td>${escapeHtml(item.subject)}</td>
            <td>${escapeHtml(item.template || '—')}</td>
            <td>${escapeHtml(item.messageStream || 'outbound')}</td>
            <td><span class="email-status email-status--${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
            <td>${escapeHtml(lastEvent)}</td>
            <td><button class="btn btn-secondary btn-sm" type="button" data-log-id="${escapeHtml(item.id)}">View details</button></td>
          </tr>`;
        })
        .join('');
    }
    const pagination = data.pagination || {};
    document.getElementById('emailLogPagination').textContent =
      `Page ${pagination.page || 1} of ${pagination.totalPages || 1} · ${pagination.total || 0} total logs`;
  }

  function reviewRequestStatusLabel(status) {
    return (
      {
        pending: 'Preparing',
        sent: 'Sent',
        opened: 'Opened',
        completed: 'Completed',
        failed: 'Failed',
        expired: 'Expired',
      }[status] || 'Unknown'
    );
  }

  function buildReviewRequestQuery() {
    const params = new URLSearchParams({
      page: String(currentReviewRequestPage),
      limit: '50',
    });
    [
      ['supplier', 'reviewRequestFilterSupplier'],
      ['recipient', 'reviewRequestFilterRecipient'],
      ['status', 'reviewRequestFilterStatus'],
    ].forEach(([key, id]) => {
      const value = filterValue(id);
      if (value) {
        params.set(key, value);
      }
    });
    return params;
  }

  function renderReviewRequestSummary(summary) {
    const cards = [
      ['Total', summary.total],
      ['Active', summary.active],
      ['Opened', summary.opened],
      ['Completed', summary.completed],
      ['Failed', summary.failed],
      ['Expired', summary.expired],
      ['Needs attention', summary.deliveryIssues],
      ['Conversion', `${Number(summary.conversionRate || 0).toFixed(1)}%`],
    ];
    document.getElementById('reviewRequestSummaryCards').innerHTML = cards
      .map(
        ([label, value]) =>
          `<article class="email-stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(
            value ?? 0
          )}</strong></article>`
      )
      .join('');
  }

  function renderReviewRequests(data) {
    renderReviewRequestSummary(data.summary || {});
    const rows = document.getElementById('reviewRequestRows');
    const items = data.items || [];
    if (!items.length) {
      rows.innerHTML =
        '<tr><td colspan="7" class="email-log-empty">No review requests match these filters.</td></tr>';
    } else {
      rows.innerHTML = items
        .map(item => {
          const outcome = item.completedAt
            ? `Completed ${formatDate(item.completedAt)}`
            : item.failedAt
              ? `Failed ${formatDate(item.failedAt)}`
              : item.expiredAt || item.status === 'expired'
                ? `Expired ${formatDate(item.expiredAt || item.expiresAt)}`
                : item.retryAt
                  ? `Retry ${formatDate(item.retryAt)}`
                  : 'In progress';
          const linkedEmail = item.emailLogId
            ? `<button class="btn btn-secondary btn-sm" type="button" data-log-id="${escapeHtml(
                item.emailLogId
              )}">Open email log</button>`
            : '—';
          const error = item.lastError
            ? `<span class="review-request-admin-error">${escapeHtml(item.lastError)}</span>`
            : '';
          return `<tr>
            <td>${escapeHtml(formatDate(item.createdAt))}</td>
            <td><strong>${escapeHtml(item.supplierName || 'Unknown supplier')}</strong><span class="email-table-subtext">${escapeHtml(item.supplierId || '—')}</span></td>
            <td><strong>${escapeHtml(item.customerName || item.customerEmail)}</strong>${item.customerName ? `<span class="email-table-subtext">${escapeHtml(item.customerEmail)}</span>` : ''}</td>
            <td><span class="email-status review-request-status--${escapeHtml(item.status)}">${escapeHtml(
              reviewRequestStatusLabel(item.status)
            )}</span><span class="email-table-subtext">Expires ${escapeHtml(
              formatDate(item.expiresAt)
            )}</span></td>
            <td><strong>${escapeHtml(item.deliveryStatus || item.status)}</strong><span class="email-table-subtext">${escapeHtml(item.deliveryProvider || '—')}</span>${error}</td>
            <td>${escapeHtml(outcome)}</td>
            <td>${linkedEmail}</td>
          </tr>`;
        })
        .join('');
    }
    const pagination = data.pagination || {};
    document.getElementById('reviewRequestPagination').textContent =
      `Page ${pagination.page || 1} of ${pagination.totalPages || 1} · ${pagination.total || 0} total requests`;
  }

  async function loadReviewRequests() {
    const status = document.getElementById('reviewRequestCentreStatus');
    status.textContent = 'Loading review request operations…';
    const data = await AdminShared.api(
      `/api/admin/email-centre/review-requests?${buildReviewRequestQuery().toString()}`,
      'GET'
    );
    renderReviewRequests(data);
    status.textContent = '';
  }

  async function loadSummary() {
    const data = await AdminShared.api('/api/admin/email-centre/summary', 'GET');
    renderSummary(data.summary || {});
    renderHealth(data.health || {});
  }

  async function loadLogs() {
    setStatus('Loading sent email activity…', '');
    const data = await AdminShared.api(`/api/admin/email-logs?${buildQuery().toString()}`, 'GET');
    renderLogs(data);
    setStatus('', '');
  }

  async function openDetail(id) {
    const data = await AdminShared.api(`/api/admin/email-logs/${encodeURIComponent(id)}`, 'GET');
    const item = data.item || {};
    document.getElementById('emailLogDetailTitle').textContent = item.subject || 'Email details';
    document.getElementById('emailLogDetailMeta').textContent =
      `${item.to || 'Unknown recipient'} · ${item.status || 'unknown'}`;
    const fields = [
      ['Recipient', item.to],
      ['From', item.from],
      ['Subject', item.subject],
      ['Template', item.template || '—'],
      ['Tags', (item.tags || []).join(', ') || '—'],
      ['Message stream', item.messageStream],
      ['Provider', item.provider],
      ['Postmark MessageID', item.postmarkMessageId || '—'],
      ['Status', item.status],
      ['Attempted', formatDate(item.attemptedAt)],
      ['Sent', formatDate(item.sentAt)],
      ['Error', item.errorMessage || '—'],
    ];
    const timeline = (item.events || [])
      .map(
        event =>
          `<li><strong>${escapeHtml(event.type)}</strong><span>${escapeHtml(formatDate(event.timestamp))}</span><p>${escapeHtml(event.summary || '')}</p></li>`
      )
      .join('');
    document.getElementById('emailLogDetailBody').innerHTML = `
      <dl class="email-log-detail-grid">${fields.map(([term, desc]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(desc || '—')}</dd></div>`).join('')}</dl>
      <h3>Event timeline</h3>
      <ol class="email-log-timeline">${timeline || '<li>No events recorded yet.</li>'}</ol>`;
    document.getElementById('emailLogDetailDialog').showModal();
  }

  function activateTab(tabName) {
    document.querySelectorAll('.email-centre-tab').forEach(tab => {
      tab.classList.toggle('is-active', tab.getAttribute('data-tab') === tabName);
    });
    ['activity', 'campaigns', 'templates', 'reviewRequests', 'health'].forEach(name => {
      const panel = document.getElementById(
        `emailTab${name.charAt(0).toUpperCase()}${name.slice(1)}`
      );
      panel.hidden = name !== tabName;
    });
  }

  function bindEvents() {
    document.querySelectorAll('.email-centre-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        activateTab(tabName);
        if (tabName === 'reviewRequests') {
          loadReviewRequests().catch(err => {
            document.getElementById('reviewRequestCentreStatus').textContent = err.message;
          });
        }
      });
    });
    document.getElementById('emailLogsRefresh').addEventListener('click', () => {
      currentPage = 1;
      Promise.all([loadSummary(), loadLogs()]).catch(err => setStatus(err.message, 'error'));
    });
    document.getElementById('emailFiltersClear').addEventListener('click', () => {
      document
        .querySelectorAll('.email-centre-filters input, .email-centre-filters select')
        .forEach(el => {
          el.value = '';
        });
      currentPage = 1;
      loadLogs().catch(err => setStatus(err.message, 'error'));
    });
    document.getElementById('emailLogRows').addEventListener('click', event => {
      const button = event.target.closest('[data-log-id]');
      if (button) {
        openDetail(button.getAttribute('data-log-id')).catch(err =>
          setStatus(err.message, 'error')
        );
      }
    });
    document.getElementById('reviewRequestsRefresh').addEventListener('click', () => {
      currentReviewRequestPage = 1;
      loadReviewRequests().catch(err => {
        document.getElementById('reviewRequestCentreStatus').textContent = err.message;
      });
    });
    document.getElementById('reviewRequestFiltersClear').addEventListener('click', () => {
      document
        .querySelectorAll('#emailTabReviewRequests input, #emailTabReviewRequests select')
        .forEach(element => {
          element.value = '';
        });
      currentReviewRequestPage = 1;
      loadReviewRequests().catch(err => {
        document.getElementById('reviewRequestCentreStatus').textContent = err.message;
      });
    });
    document.getElementById('reviewRequestRows').addEventListener('click', event => {
      const button = event.target.closest('[data-log-id]');
      if (button) {
        openDetail(button.getAttribute('data-log-id')).catch(err =>
          setStatus(err.message, 'error')
        );
      }
    });
    document.getElementById('emailLogDetailClose').addEventListener('click', () => {
      document.getElementById('emailLogDetailDialog').close();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    Promise.all([loadSummary(), loadLogs()]).catch(err => setStatus(err.message, 'error'));
  });
})();
