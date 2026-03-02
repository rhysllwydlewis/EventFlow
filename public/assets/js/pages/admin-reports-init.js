(function () {
  'use strict';

  let allReports = [];

  async function loadReports() {
    try {
      const data = await AdminShared.api('/api/admin/reports');
      allReports = data.items || [];
      renderReports();
    } catch (error) {
      console.error('Error loading reports:', error);
      document.getElementById('reportsContainer').innerHTML =
        '<div class="data-section"><p class="small" style="color:#ef4444;">Failed to load reports. Please try again.</p></div>';
    }
  }

  function renderReports() {
    const container = document.getElementById('reportsContainer');
    if (!container) {
      return;
    }

    const statusFilter = document.getElementById('statusFilter')?.value || '';
    const typeFilter = document.getElementById('typeFilter')?.value || '';

    const filtered = allReports.filter(report => {
      if (statusFilter && report.status !== statusFilter) {
        return false;
      }
      if (typeFilter && report.type !== typeFilter) {
        return false;
      }
      return true;
    });

    if (!filtered.length) {
      container.innerHTML = `
        <div class="text-center-pad">
          <div style="font-size:4rem;margin-bottom:1rem;">📋</div>
          <h3 class="h3-mb-05">No reports found</h3>
          <p style="color:#6b7280;">
            ${allReports.length === 0 ? 'Content reports will appear here when users flag content.' : 'No reports match your filters.'}
          </p>
        </div>
      `;
      return;
    }

    let html =
      '<div class="table-wrapper"><table><thead><tr><th>Type</th><th>Reason</th><th>Reported By</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead><tbody>';

    filtered.forEach(report => {
      const createdAt = AdminShared.formatDate(report.createdAt);
      html += `
        <tr>
          <td><span class="badge">${AdminShared.escapeHtml(report.type || 'unknown')}</span></td>
          <td>${AdminShared.escapeHtml(report.reason || 'No reason')}</td>
          <td>${AdminShared.escapeHtml(report.reporterEmail || 'Unknown')}</td>
          <td><span class="badge badge-${report.status || 'pending'}">${report.status || 'pending'}</span></td>
          <td class="small">${createdAt}</td>
          <td>
            ${
              report.status === 'pending'
                ? `
              <button class="btn-sm btn-success" data-action="resolve" data-id="${report.id}">Resolve</button>
              <button class="btn-sm btn-danger" data-action="dismiss" data-id="${report.id}">Dismiss</button>
            `
                : '<span class="small">—</span>'
            }
          </td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  // Event delegation for buttons
  document.body.addEventListener('click', async e => {
    const button = e.target.closest('button[data-action]');
    if (!button) {
      return;
    }

    const action = button.getAttribute('data-action');
    const id = button.getAttribute('data-id');

    if (action === 'resolve' && id) {
      try {
        button.disabled = true;
        await AdminShared.api(`/api/admin/reports/${id}/resolve`, 'POST', {});
        AdminShared.showToast('Report resolved', 'success');
        await loadReports();
      } catch (error) {
        AdminShared.showToast(error.message || 'Failed to resolve report', 'error');
        button.disabled = false;
      }
    } else if (action === 'dismiss' && id) {
      try {
        button.disabled = true;
        await AdminShared.api(`/api/admin/reports/${id}/dismiss`, 'POST', {});
        AdminShared.showToast('Report dismissed', 'success');
        await loadReports();
      } catch (error) {
        AdminShared.showToast(error.message || 'Failed to dismiss report', 'error');
        button.disabled = false;
      }
    }
  });

  // Setup filters
  document.getElementById('statusFilter')?.addEventListener('change', renderReports);
  document.getElementById('typeFilter')?.addEventListener('change', renderReports);

  // Back button
  document.getElementById('backToDashboard')?.addEventListener('click', () => {
    window.location.href = '/admin';
  });

  // Initialize
  loadReports();
})();
