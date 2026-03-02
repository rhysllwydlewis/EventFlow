(function () {
  'use strict';

  let allLogs = [];

  async function loadAuditLogs() {
    try {
      const params = new URLSearchParams();
      const action = document.getElementById('actionFilter')?.value;
      const targetType = document.getElementById('targetTypeFilter')?.value;
      const startDate = document.getElementById('startDateFilter')?.value;
      const endDate = document.getElementById('endDateFilter')?.value;

      if (action) {
        params.append('action', action);
      }
      if (targetType) {
        params.append('targetType', targetType);
      }
      if (startDate) {
        params.append('startDate', new Date(startDate).toISOString());
      }
      if (endDate) {
        params.append('endDate', new Date(endDate).toISOString());
      }

      // Use canonical audit-logs endpoint with standardized response format
      const url = `/api/admin/audit-logs${params.toString() ? `?${params.toString()}` : ''}`;
      const data = await AdminShared.api(url);
      // Response is { logs: [...], count: n }
      allLogs = data.logs || [];
      renderAuditLogs();
    } catch (error) {
      console.error('Error loading audit logs:', error);
      document.getElementById('auditContainer').innerHTML =
        '<div class="data-section"><p class="small" style="color:#ef4444;">Failed to load audit logs. Please try again.</p></div>';
    }
  }

  function renderAuditLogs() {
    const container = document.getElementById('auditContainer');
    if (!container) {
      return;
    }

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
      '<div class="table-wrapper"><table><thead><tr><th>Admin</th><th>Action</th><th>Target</th><th>Target ID</th><th>Timestamp</th></tr></thead><tbody>';

    allLogs.forEach(log => {
      const timestamp = AdminShared.formatDate(log.timestamp);
      const actionDisplay = (log.action || '').replace(/_/g, ' ');
      html += `
        <tr>
          <td>${AdminShared.escapeHtml(log.adminEmail || 'Unknown')}</td>
          <td><span class="badge">${AdminShared.escapeHtml(actionDisplay)}</span></td>
          <td><span class="badge badge-${log.targetType || 'unknown'}">${AdminShared.escapeHtml(log.targetType || 'unknown')}</span></td>
          <td class="small">${AdminShared.escapeHtml(log.targetId || 'N/A')}</td>
          <td class="small">${timestamp}</td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  // Setup filter listeners
  document.getElementById('actionFilter')?.addEventListener('change', loadAuditLogs);
  document.getElementById('targetTypeFilter')?.addEventListener('change', loadAuditLogs);
  document.getElementById('startDateFilter')?.addEventListener('change', loadAuditLogs);
  document.getElementById('endDateFilter')?.addEventListener('change', loadAuditLogs);

  // Clear filters
  document.getElementById('clearFilters')?.addEventListener('click', () => {
    document.getElementById('actionFilter').value = '';
    document.getElementById('targetTypeFilter').value = '';
    document.getElementById('startDateFilter').value = '';
    document.getElementById('endDateFilter').value = '';
    loadAuditLogs();
  });

  // Back button
  document.getElementById('backToDashboard')?.addEventListener('click', () => {
    window.location.href = '/admin';
  });

  // Export button
  document.getElementById('exportAuditBtn')?.addEventListener('click', async () => {
    const startDate = document.getElementById('startDateFilter')?.value || '';
    const endDate = document.getElementById('endDateFilter')?.value || '';

    const params = new URLSearchParams();
    params.set('format', 'csv');
    if (startDate) {
      params.set('startDate', startDate);
    }
    if (endDate) {
      params.set('endDate', endDate);
    }

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
  loadAuditLogs();
})();
