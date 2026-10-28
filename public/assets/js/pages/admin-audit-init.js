'use strict';
(function () {
  const PAGE_SIZE = 100;
  let currentPage = 1;
  let totalEntries = 0;
  let allLogs = [];

  const field = id => document.getElementById(id);

  // "partner_credits_adjusted" → "Partner credits adjusted"
  function labelFor(value) {
    const text = String(value || '')
      .replace(/_/g, ' ')
      .toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Short, readable summary of what an entry recorded (reason, amounts, from → to, ...)
  function summarise(details) {
    if (!details || typeof details !== 'object') {
      return '';
    }
    const parts = Object.entries(details)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => {
        const shown = typeof value === 'object' ? JSON.stringify(value) : String(value);
        return `${key}: ${shown}`;
      });
    const text = parts.join(' · ');
    return text.length > 160 ? `${text.slice(0, 157)}…` : text;
  }

  function fillSelect(select, values, selected) {
    if (!select) {
      return;
    }
    const first = select.options[0];
    select.innerHTML = '';
    select.appendChild(first);
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = labelFor(value);
      select.appendChild(option);
    }
    select.value = values.includes(selected) ? selected : '';
  }

  // The lists come from the server, so every action the system can record is offered
  async function loadFilterOptions() {
    try {
      const options = await AdminShared.api('/api/admin/audit-logs/filters');
      fillSelect(field('actionFilter'), options.actions || [], field('actionFilter')?.value);
      fillSelect(
        field('targetTypeFilter'),
        options.targetTypes || [],
        field('targetTypeFilter')?.value
      );
    } catch (error) {
      console.error('Error loading audit filters:', error);
    }
  }

  // Filters shared by the list and the export. Dates are plain days: the server treats the
  // "to" day as included.
  function currentFilters() {
    const params = new URLSearchParams();
    const action = field('actionFilter')?.value;
    const targetType = field('targetTypeFilter')?.value;
    const startDate = field('startDateFilter')?.value;
    const endDate = field('endDateFilter')?.value;
    if (action) {
      params.set('action', action);
    }
    if (targetType) {
      params.set('targetType', targetType);
    }
    if (startDate) {
      params.set('startDate', startDate);
    }
    if (endDate) {
      params.set('endDate', endDate);
    }
    return params;
  }

  function datesAreInOrder() {
    const startDate = field('startDateFilter')?.value;
    const endDate = field('endDateFilter')?.value;
    return !startDate || !endDate || startDate <= endDate;
  }

  async function loadAuditLogs() {
    const container = field('auditContainer');
    if (!datesAreInOrder()) {
      AdminShared.showToast('The "to" date is before the "from" date.', 'error');
      return;
    }
    try {
      const params = currentFilters();
      params.set('page', String(currentPage));
      params.set('limit', String(PAGE_SIZE));
      const data = await AdminShared.api(`/api/admin/audit-logs?${params.toString()}`);
      // Response is { logs: [...], count, total, page, limit }
      allLogs = data.logs || [];
      totalEntries = Number(data.total) || allLogs.length;
      renderAuditLogs();
    } catch (error) {
      console.error('Error loading audit logs:', error);
      container.innerHTML =
        '<div class="data-section"><p class="small" style="color:#ef4444;">Failed to load audit logs. Please try again.</p></div>';
    }
  }

  function renderPager() {
    const pager = field('auditPager');
    const count = field('auditCount');
    const first = totalEntries ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
    const last = (currentPage - 1) * PAGE_SIZE + allLogs.length;
    if (count) {
      count.textContent = totalEntries
        ? `Showing ${first}–${last} of ${totalEntries} entries, newest first`
        : '';
    }
    if (pager) {
      pager.hidden = totalEntries <= PAGE_SIZE;
      field('auditPrev').disabled = currentPage <= 1;
      field('auditNext').disabled = last >= totalEntries;
    }
  }

  function renderAuditLogs() {
    const container = field('auditContainer');
    if (!container) {
      return;
    }
    renderPager();

    if (!allLogs.length) {
      container.innerHTML = `
        <div class="text-center-pad">
          <div style="font-size:4rem;margin-bottom:1rem;">📝</div>
          <h3 class="h3-mb-05">No audit logs found</h3>
          <p style="color:#6b7280;">Audit logs will appear here as admins perform actions.</p>
        </div>
      `;
      return;
    }

    let html =
      '<div class="table-wrapper"><table><thead><tr><th>Admin</th><th>Action</th><th>Target</th><th>Target ID</th><th>Details</th><th>Timestamp</th></tr></thead><tbody>';

    allLogs.forEach(log => {
      const timestamp = AdminShared.formatDate(log.timestamp);
      const targetClass = String(log.targetType || 'unknown').replace(/[^a-z0-9_-]/gi, '');
      html += `
        <tr>
          <td>${AdminShared.escapeHtml(log.adminEmail || 'Unknown')}</td>
          <td><span class="badge">${AdminShared.escapeHtml(labelFor(log.action))}</span></td>
          <td><span class="badge badge-${targetClass}">${AdminShared.escapeHtml(labelFor(log.targetType || 'unknown'))}</span></td>
          <td class="small">${AdminShared.escapeHtml(log.targetId || 'N/A')}</td>
          <td class="small">${AdminShared.escapeHtml(summarise(log.details))}</td>
          <td class="small">${timestamp}</td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  // Changing a filter starts again from the newest entries
  function applyFilters() {
    currentPage = 1;
    loadAuditLogs();
  }

  field('actionFilter')?.addEventListener('change', applyFilters);
  field('targetTypeFilter')?.addEventListener('change', applyFilters);
  field('startDateFilter')?.addEventListener('change', applyFilters);
  field('endDateFilter')?.addEventListener('change', applyFilters);

  field('auditPrev')?.addEventListener('click', () => {
    currentPage = Math.max(1, currentPage - 1);
    loadAuditLogs();
  });
  field('auditNext')?.addEventListener('click', () => {
    currentPage += 1;
    loadAuditLogs();
  });

  // Clear filters
  field('clearFilters')?.addEventListener('click', () => {
    field('actionFilter').value = '';
    field('targetTypeFilter').value = '';
    field('startDateFilter').value = '';
    field('endDateFilter').value = '';
    applyFilters();
  });

  // Back button
  field('backToDashboard')?.addEventListener('click', () => {
    window.location.href = '/admin';
  });

  // Export button: the file holds everything the current filters match, not just this page
  field('exportAuditBtn')?.addEventListener('click', async () => {
    if (!datesAreInOrder()) {
      AdminShared.showToast('The "to" date is before the "from" date.', 'error');
      return;
    }
    const params = currentFilters();
    params.set('format', 'csv');

    try {
      const response = await fetch(`/api/admin/audit/export?${params.toString()}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-logs-${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
      } else {
        AdminShared.showToast('Failed to export audit logs', 'error');
      }
    } catch (error) {
      console.error('Export error:', error);
      AdminShared.showToast('Failed to export audit logs', 'error');
    }
  });

  // Initialize
  loadFilterOptions();
  loadAuditLogs();
})();
