(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[ch]);
  }

  function labelForMethod(method) {
    switch (method) {
      case 'google_verified_email':
        return 'Google verified';
      case 'eventflow_email':
        return 'EventFlow email verified';
      case 'admin_created':
        return 'Admin-created verified';
      case 'owner_account':
        return 'Owner account';
      case 'pending':
        return 'Email verification pending';
      case 'unknown':
        return 'Unknown verification source';
      default:
        return method || 'Unknown verification source';
    }
  }

  function labelForSignup(method) {
    switch (method) {
      case 'google':
        return 'Google sign-up';
      case 'email_password':
        return 'Email/password';
      case 'admin_created':
        return 'Admin-created';
      case 'owner_seed':
        return 'Owner/system';
      default:
        return method || 'Unknown sign-up';
    }
  }

  function badge(text, tone) {
    return `<span class="badge badge-${tone || 'starter'}" style="display:inline-block;margin-top:4px;font-size:11px;line-height:1.2;">${escapeHtml(text)}</span>`;
  }

  function toneForMethod(method) {
    if (method === 'google_verified_email' || method === 'eventflow_email') return 'success';
    if (method === 'pending') return 'warning';
    if (method === 'unknown') return 'danger';
    return 'starter';
  }

  function decorateRows(items) {
    const byId = new Map();
    const byEmail = new Map();
    (items || []).forEach(item => {
      if (item.id) byId.set(String(item.id), item);
      if (item.email) byEmail.set(String(item.email).toLowerCase(), item);
    });

    document.querySelectorAll('table.table tbody tr').forEach(row => {
      const id = row.querySelector('[data-user-id]')?.getAttribute('data-user-id') || '';
      const email = (row.children[2]?.textContent || '').trim().toLowerCase();
      const item = byId.get(id) || byEmail.get(email);
      if (!item || row.dataset.provenanceDecorated === 'true') return;

      const verifiedCell = row.children[5];
      if (!verifiedCell) return;
      const method = item.verificationMethod || 'unknown';
      const signup = item.signupMethod || 'unknown';
      const status = item.emailDeliveryStatus || 'unknown';
      verifiedCell.innerHTML = `${verifiedCell.innerHTML}<br>${badge(labelForMethod(method), toneForMethod(method))}<br>${badge(labelForSignup(signup), 'starter')}<br><span class="small">Email: ${escapeHtml(status)}</span>`;

      const resendButton = row.querySelector('[data-resend-verification]');
      if (resendButton && ['google_verified_email', 'admin_created', 'owner_account'].includes(method)) {
        resendButton.remove();
      }

      row.dataset.provenanceDecorated = 'true';
    });
  }

  async function loadProvenance() {
    if (!window.AdminShared || !AdminShared.api) return;
    try {
      const data = await AdminShared.api('/api/admin/email-centre/users-provenance', 'GET');
      decorateRows(data.items || []);
    } catch (err) {
      if (window.AdminShared && AdminShared.debugError) {
        AdminShared.debugError('Admin user provenance load failed', err);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(loadProvenance, 900);
    document.addEventListener('click', event => {
      if (event.target && (event.target.id === 'clearFilters' || event.target.closest('[data-resend-verification]'))) {
        setTimeout(loadProvenance, 900);
      }
    });
  });
})();
