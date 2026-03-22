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
    if (!container) return;

    const statusFilter = document.getElementById('statusFilter')?.value || '';
    const typeFilter = document.getElementById('typeFilter')?.value || '';

    const filtered = allReports.filter(report => {
      if (statusFilter && report.status !== statusFilter) return false;
      if (typeFilter && report.type !== typeFilter) return false;
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
        </div>`;
      return;
    }

    let html = '<div class="table-wrapper"><table><thead><tr><th>Type</th><th>Reason</th><th>Reported By</th><th>Status</th><th>Date</th><th>Resolution</th><th>Actions</th></tr></thead><tbody>';

    filtered.forEach(report => {
      const createdAt = AdminShared.formatDate(report.createdAt);
      const resolutionInfo = (report.status === 'resolved' || report.status === 'dismissed')
        ? `<div class="small" style="color:#6b7280;margin-top:0.25rem;">
            ${report.resolvedByEmail ? `By: ${AdminShared.escapeHtml(report.resolvedByEmail)}<br>` : ''}
            ${report.resolvedAt ? `At: ${AdminShared.formatDate(report.resolvedAt)}<br>` : ''}
            ${report.resolution ? `Resolution: ${AdminShared.escapeHtml(report.resolution)}<br>` : ''}
            ${report.resolutionNotes ? `Notes: ${AdminShared.escapeHtml(report.resolutionNotes)}` : ''}
           </div>`
        : '<span class="small">—</span>';

      html += `
        <tr>
          <td><span class="badge">${AdminShared.escapeHtml(report.type || 'unknown')}</span></td>
          <td>
            <div>${AdminShared.escapeHtml(report.reason || 'No reason')}</div>
            ${report.details ? `<div class="small" style="color:#6b7280;">${AdminShared.escapeHtml(report.details)}</div>` : ''}
          </td>
          <td>${AdminShared.escapeHtml(report.reporterEmail || 'Unknown')}</td>
          <td><span class="badge badge-${report.status || 'pending'}">${report.status || 'pending'}</span></td>
          <td class="small">${createdAt}</td>
          <td class="small">${resolutionInfo}</td>
          <td>
            ${report.status === 'pending'
              ? `<button class="btn-sm btn-success" data-action="resolve" data-id="${report.id}">Resolve</button>
                 <button class="btn-sm btn-danger" data-action="dismiss" data-id="${report.id}">Dismiss</button>`
              : '<span class="small">—</span>'
            }
          </td>
        </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  function showResolveModal(reportId) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
    modal.innerHTML = `
      <div class="modal modal-medium" style="min-width:340px;">
        <h3>Resolve Report</h3>
        <form id="resolveForm" action="#">
          <div class="form-row">
            <label>Resolution</label>
            <select id="resolveResolution">
              <option value="valid">Valid — content violates policy</option>
              <option value="invalid">Invalid — report is unfounded</option>
              <option value="duplicate">Duplicate — already reported</option>
            </select>
          </div>
          <div class="form-row">
            <label>Action Taken</label>
            <select id="resolveAction">
              <option value="no_action">No action required</option>
              <option value="content_removed">Content removed</option>
              <option value="user_warned">User warned</option>
              <option value="user_suspended">User suspended</option>
            </select>
          </div>
          <div class="form-row">
            <label>Notes (optional)</label>
            <textarea id="resolveNotes" rows="3" placeholder="Any additional notes for audit trail..."></textarea>
          </div>
          <div class="action-buttons">
            <button type="submit" class="btn btn-success">Resolve Report</button>
            <button type="button" class="btn btn-secondary" id="cancelResolve">Cancel</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#cancelResolve').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#resolveForm').addEventListener('submit', async e => {
      e.preventDefault();
      const resolution = document.getElementById('resolveResolution').value;
      const action = document.getElementById('resolveAction').value;
      const notes = document.getElementById('resolveNotes').value.trim();
      const submitBtn = modal.querySelector('button[type="submit"]');
      submitBtn.disabled = true; submitBtn.textContent = 'Resolving...';
      try {
        await AdminShared.api(`/api/admin/reports/${reportId}/resolve`, 'POST', { resolution, action, notes });
        AdminShared.showToast('Report resolved successfully', 'success');
        modal.remove();
        await loadReports();
      } catch (error) {
        AdminShared.showToast(error.message || 'Failed to resolve report', 'error');
        submitBtn.disabled = false; submitBtn.textContent = 'Resolve Report';
      }
    });
  }

  // Event delegation for buttons
  document.body.addEventListener('click', async e => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;

    const action = button.getAttribute('data-action');
    const id = button.getAttribute('data-id');

    if (action === 'resolve' && id) {
      showResolveModal(id);
    } else if (action === 'dismiss' && id) {
      const confirmed = await AdminShared.showConfirmModal({
        title: 'Dismiss Report',
        message: 'Are you sure you want to dismiss this report? This action cannot be undone.',
        confirmText: 'Dismiss',
      });
      if (!confirmed) return;
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

  document.getElementById('statusFilter')?.addEventListener('change', renderReports);
  document.getElementById('typeFilter')?.addEventListener('change', renderReports);
  document.getElementById('backToDashboard')?.addEventListener('click', () => {
    window.location.href = '/admin';
  });

  loadReports();
})();
