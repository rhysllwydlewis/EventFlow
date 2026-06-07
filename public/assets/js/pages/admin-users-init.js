/**
 * EventFlow Admin — Users Centre
 * Drives /admin-users (Users Centre page).
 * Uses the /api/admin/users/summary and /api/admin/users/list endpoints
 * from services/adminUserSummary.service.js so counts match /admin dashboard.
 */
(function () {
  'use strict';

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
  }

  function fmtDate(dt) {
    if (!dt) {
      return '—';
    }
    try {
      return new Date(dt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '—';
    }
  }

  function fmtRelative(dt) {
    if (!dt) {
      return '—';
    }
    try {
      const diff = Date.now() - new Date(dt).getTime();
      const days = Math.floor(diff / 86400000);
      if (days === 0) {
        return 'Today';
      }
      if (days === 1) {
        return 'Yesterday';
      }
      if (days < 7) {
        return `${days}d ago`;
      }
      if (days < 30) {
        return `${Math.floor(days / 7)}w ago`;
      }
      return fmtDate(dt);
    } catch {
      return '—';
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let allUsers = [];
  let currentPage = 1;
  const PAGE_SIZE = 50;
  const selectedUserIds = new Set();
  let debounceTimer = null;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ── Badge helpers ─────────────────────────────────────────────────────────
  function roleBadge(role) {
    const map = {
      customer: '<span class="badge badge-customer">Customer</span>',
      supplier: '<span class="badge badge-supplier-account">Supplier</span>',
      admin: '<span class="badge badge-admin">Admin</span>',
      owner: '<span class="badge badge-admin">Owner</span>',
    };
    return map[role] || `<span class="badge">${esc(role)}</span>`;
  }

  function signupBadge(method) {
    const map = {
      google: '<span class="badge badge-google">Google</span>',
      email_password: '<span class="badge badge-email">Email</span>',
      admin_created: '<span class="badge badge-admin-created">Admin</span>',
      owner: '<span class="badge badge-admin">Owner</span>',
      unknown: '<span class="badge badge-warning">Unknown</span>',
    };
    return map[method] || `<span class="badge badge-warning">${esc(method)}</span>`;
  }

  function verifBadge(method) {
    const map = {
      google: '<span class="badge badge-google">Google</span>',
      email_link: '<span class="badge badge-yes">Email link</span>',
      admin: '<span class="badge badge-admin-created">Admin</span>',
      legacy: '<span class="badge">Legacy</span>',
      pending: '<span class="badge badge-no">Pending</span>',
      unknown: '<span class="badge badge-warning">Unknown</span>',
    };
    return map[method] || `<span class="badge badge-warning">${esc(method)}</span>`;
  }

  function humanize(value) {
    return String(value || 'unknown')
      .replace(/_/g, ' ')
      .replace(/(^|\s)([a-z])/g, (_m, prefix, c) => prefix + c.toUpperCase());
  }

  function badge(label, type) {
    return `<span class="badge badge-${type || 'secondary'}" style="display:inline-block;margin:1px 2px 1px 0;white-space:nowrap;">${escapeHtml(label)}</span>`;
  }

  function verificationBadge(user) {
    switch (user.verificationMethod) {
      case 'google_verified_email':
        return badge('Google verified', 'success');
      case 'eventflow_email':
        return badge('Verified by EventFlow email', 'success');
      case 'admin_created':
        return badge('Admin-created verified', 'info');
      case 'owner_account':
        return badge('Owner account', 'warning');
      case 'pending':
        return badge('Email verification pending', 'warning');
      default:
        return badge('Unknown verification source', 'danger');
    }
  }

  function emailStatusBadge(status) {
    switch (status) {
      case 'not_required':
        return badge('No EventFlow email required', 'secondary');
      case 'sent':
        return badge('Email sent', 'info');
      case 'delivered':
        return badge('Delivered', 'success');
      case 'failed':
        return badge('Email failed', 'danger');
      case 'outbox':
        return badge('Outbox fallback', 'warning');
      case 'bounced':
        return badge('Bounced', 'danger');
      case 'pending':
        return badge('Email pending', 'warning');
      default:
        return badge('Email unknown', 'secondary');
    }
  }

  function canResendVerification(user) {
    if (!user || user.verified) {
      return false;
    }
    if (
      ['google_verified_email', 'admin_created', 'owner_account'].includes(user.verificationMethod)
    ) {
      return false;
    }
    if (['google', 'admin_created', 'owner_seed'].includes(user.signupMethod)) {
      return false;
    }
    return true;
  }

  function formatDate(dateStr) {
    if (!dateStr) {
      return 'Never';
    }
    if (profile.approved) {
      return `<a href="${esc(profile.profileUrl)}" class="badge badge-yes">Approved</a>`;
    }
    return `<a href="${esc(profile.profileUrl)}" class="badge badge-warning">Pending</a>`;
  }

  function issueBadges(issues) {
    if (!issues || !issues.length) {
      return '';
    }
    const labels = {
      email_unverified: '<span class="uc-issue-badge">Unverified</span>',
      unknown_verification_source:
        '<span class="uc-issue-badge uc-issue-badge--warn">Unknown source</span>',
      supplier_profile_missing:
        '<span class="uc-issue-badge uc-issue-badge--warn">No profile</span>',
      suspended: '<span class="uc-issue-badge uc-issue-badge--danger">Suspended</span>',
    };
    return issues.map(i => labels[i] || `<span class="uc-issue-badge">${esc(i)}</span>`).join(' ');
  }

  // ── Summary cards ─────────────────────────────────────────────────────────
  function renderSummaryCards(summary) {
    const grid = $('ucSummaryGrid');
    if (!grid || !summary) {
      return;
    }

    const makeCard = (value, label, icon, accent, filterParams) => {
      const href = filterParams ? `/admin-users?${filterParams}` : '/admin-users';
      return `
        <a href="${href}" class="uc-summary-card uc-summary-card--${accent}" title="Click to filter">
          <div class="uc-summary-card__icon uc-summary-card__icon--${accent}" aria-hidden="true">${icon}</div>
          <div class="uc-summary-card__value">${value}</div>
          <div class="uc-summary-card__label">${label}</div>
        </a>`;
    };

    // Show loading state
    AdminShared.showLoadingState(tbody, {
      rows: 5,
      cols: 12,
      message: 'Loading users...',
    });

  // ── Table rendering ───────────────────────────────────────────────────────
  function renderTable(users) {
    const tbody = $('ucTableBody');
    if (!tbody) {
      return;
    }

    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="uc-empty-cell">
        <div class="admin-empty-state">
          <p>No users match the current filters.</p>
          <button type="button" class="btn btn-ghost btn-sm" id="ucEmptyClear">Clear filters</button>
        </div>
      </td></tr>`;
      $('ucEmptyClear') && $('ucEmptyClear').addEventListener('click', clearFilters);
      return;
    }

    tbody.innerHTML = users
      .map(u => {
        const userId = esc(u.id || '');
        const isChecked = selectedUserIds.has(u.id);
        return `<tr class="${u.suspended ? 'uc-row--suspended' : ''} ${u.accountIssues && u.accountIssues.length ? 'uc-row--issues' : ''}">
        <td class="checkbox-cell">
          <input type="checkbox" class="uc-user-checkbox table-checkbox" data-user-id="${userId}" ${isChecked ? 'checked' : ''} aria-label="Select ${esc(u.name || u.email)}">
        </td>
        <td class="uc-name-cell">
          <a href="/admin-user-detail?id=${userId}" class="uc-user-link">${esc(u.name || '(no name)')}</a>
          <span class="uc-user-email">${esc(u.email || '')}</span>
          ${issueBadges(u.accountIssues)}
        </td>
        <td>${roleBadge(u.role)}</td>
        <td>${signupBadge(u.signupMethod)}</td>
        <td>${verifBadge(u.verificationMethod)}</td>
        <td>${supplierBadge(u.supplierProfile)}</td>
        <td class="uc-date-cell">${fmtDate(u.createdAt)}</td>
        <td class="uc-date-cell">${fmtRelative(u.lastLoginAt)}</td>
        <td class="uc-actions-cell">
          <a href="/admin-user-detail?id=${userId}" class="btn btn-ghost btn-xs" title="View user detail">View</a>
          ${u.supplierProfile ? `<a href="${esc(u.supplierProfile.profileUrl)}" class="btn btn-ghost btn-xs" title="Supplier profile">Supplier</a>` : ''}
        </td>
      </tr>`;
      })
      .join('');

      // Show error state with retry button
      AdminShared.showErrorState(tbody, {
        message: 'Failed to load users. Please try again.',
        onRetry: loadAdminUsers,
        colspan: 12,
      });
    });
  }

  // ── Filtering + pagination ─────────────────────────────────────────────────
  function getFilters() {
    return {
      search: ($('ucSearch') || {}).value || '',
      role: ($('ucRoleFilter') || {}).value || '',
      signupMethod: ($('ucSignupFilter') || {}).value || '',
      verificationMethod: ($('ucVerifFilter') || {}).value || '',
      issue: ($('ucIssueFilter') || {}).value || '',
    };
  }

  function applyFilters() {
    const { search, role, signupMethod, verificationMethod, issue } = getFilters();
    const s = search.toLowerCase();
    const filtered = allUsers.filter(u => {
      if (
        s &&
        !(u.name || '').toLowerCase().includes(s) &&
        !(u.email || '').toLowerCase().includes(s)
      ) {
        return false;
      }
      if (role && u.role !== role) {
        return false;
      }
      if (signupMethod && u.signupMethod !== signupMethod) {
        return false;
      }
      if (verificationMethod && u.verificationMethod !== verificationMethod) {
        return false;
      }
      if (issue && !(u.accountIssues || []).includes(issue)) {
        return false;
      }
      return true;
    });

    const total = filtered.length;
    const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    currentPage = Math.min(currentPage, pages);
    const slice = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

          renderUsers();
        },
        colspan: 12,
      });
      return;
    }

    tbody.innerHTML = filtered
      .map(u => {
        // Build role badge using shared helper
        const roleBadge = AdminShared.getRoleBadge(u.role);

        // Admin users get an Admin badge — they have full privileges, not a subscription tier
        const isAdminUser = u.role === 'admin';
        let subscriptionBadge = '';
        if (isAdminUser) {
          subscriptionBadge = '—';
        } else {
          const subscription = u.subscription || { tier: 'free', status: 'active' };
          if (subscription.tier === 'pro') {
            subscriptionBadge = '<span class="badge badge-pro">Pro</span>';
          } else if (subscription.tier === 'pro_plus') {
            subscriptionBadge = '<span class="badge badge-pro-plus">Pro Plus</span>';
          } else {
            subscriptionBadge = '<span class="badge badge-starter">Starter</span>';
          }
        }

        const userId = escapeHtml(u.id || u._id || '');
        const isChecked = selectedUserIds.has(userId);

        const actionsHtml = `
          <button class="btn btn-secondary btn-sm" data-manage-subscription="${userId}" style="font-size:12px;padding:4px 8px;margin-right:4px;">Manage Subscription</button>
          ${
            canResendVerification(u)
              ? `<button class="btn btn-secondary btn-sm" data-resend-verification="${userId}" style="font-size:12px;padding:4px 8px;">Resend Verification</button>`
              : ''
          }
        `;

        return (
          `<tr>` +
          `<td class="checkbox-cell"><input type="checkbox" class="user-checkbox table-checkbox" data-user-id="${userId}" ${isChecked ? 'checked' : ''}></td>` +
          `<td><a href="/admin-user-detail?id=${userId}" style="color:#3b82f6;text-decoration:none;">${escapeHtml(u.name || '')}</a></td>` +
          `<td><a href="/admin-user-detail?id=${userId}" style="color:#3b82f6;text-decoration:none;">${escapeHtml(u.email || '')}</a></td>` +
          `<td>${roleBadge}</td>` +
          `<td>${subscriptionBadge}</td>` +
          `<td>${u.verified ? '✓ Yes' : '✗ No'}<div>${verificationBadge(u)}</div></td>` +
          `<td>${badge(humanize(u.signupMethod), 'secondary')}<br>${badge(humanize(u.authProvider), 'secondary')}</td>` +
          `<td>${emailStatusBadge(u.emailDeliveryStatus)}</td>` +
          `<td>${u.marketingOptIn ? 'Yes' : 'No'}</td>` +
          `<td>${formatDate(u.createdAt)}</td>` +
          `<td>${formatDate(u.lastLoginAt)}</td>` +
          `<td>${actionsHtml}</td>` +
          `</tr>`
        );
      })
      .join('');

  function clearFilters() {
    ['ucSearch', 'ucRoleFilter', 'ucSignupFilter', 'ucVerifFilter', 'ucIssueFilter'].forEach(id => {
      const el = $(id);
      if (el) {
        el.value = '';
      }
    });
    currentPage = 1;
    applyFilters();
  }

  // Apply URL query params on load
  function applyUrlFilters() {
    const params = new URLSearchParams(window.location.search);
    const mapping = {
      role: 'ucRoleFilter',
      signupMethod: 'ucSignupFilter',
      verificationMethod: 'ucVerifFilter',
      issue: 'ucIssueFilter',
    };
    Object.entries(mapping).forEach(([param, id]) => {
      const val = params.get(param);
      const el = $(id);
      if (val && el) {
        el.value = val;
      }
    });
    const search = params.get('search');
    const searchEl = $('ucSearch');
    if (search && searchEl) {
      searchEl.value = search;
    }
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  function renderPagination(page, pages, total) {
    const html =
      pages <= 1
        ? ''
        : `
      <div class="uc-pagination-inner">
        <button class="btn btn-ghost btn-xs" ${page === 1 ? 'disabled' : ''} data-page="${page - 1}">← Prev</button>
        <span class="uc-pagination-label">Page ${page} of ${pages} (${total})</span>
        <button class="btn btn-ghost btn-xs" ${page >= pages ? 'disabled' : ''} data-page="${page + 1}">Next →</button>
      </div>`;

    [$('ucPaginationTop'), $('ucPaginationBottom')].forEach(el => {
      if (!el) {
        return;
      }
      el.innerHTML = html;
      el.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
          currentPage = Number(btn.dataset.page);
          applyFilters();
        });
      });
    });
  }

  // ── Select all / bulk actions ──────────────────────────────────────────────
  function updateBulkBar() {
    const bar = $('ucBulkActionsBar');
    const count = $('ucBulkCount');
    if (!bar) {
      return;
    }
    const n = selectedUserIds.size;
    if (n > 0) {
      bar.hidden = false;
      if (count) {
        count.textContent = `${n} selected`;
      }
    } else {
      bar.hidden = true;
    }
  }

  function updateSelectAll() {
    const sa = $('ucSelectAll');
    if (!sa) {
      return;
    }
    const checkboxes = document.querySelectorAll('.uc-user-checkbox');
    const checked = [...checkboxes].filter(c => c.checked).length;
    sa.indeterminate = checked > 0 && checked < checkboxes.length;
    sa.checked = checked === checkboxes.length && checkboxes.length > 0;
  }

  // ── Bulk actions ───────────────────────────────────────────────────────────
  async function bulkVerify(ids) {
    const eligible = allUsers.filter(
      u => ids.includes(u.id) && !u.verified && u.signupMethod === 'email_password'
    );
    if (!eligible.length) {
      AdminShared.showToast(
        'No eligible users — only unverified email/password accounts can be verified this way.',
        'warning'
      );
      return;
    }
    const ok = await AdminShared.showConfirmModal({
      title: `Verify ${eligible.length} user${eligible.length !== 1 ? 's' : ''}?`,
      message:
        'This will mark selected unverified email/password accounts as verified. Google and admin-created accounts are excluded.',
      confirmText: 'Verify',
      type: 'warning',
    });
    if (!ok) {
      return;
    }
    try {
      await AdminShared.adminFetch('/api/admin/users/bulk-verify', {
        method: 'POST',
        body: JSON.stringify({ userIds: eligible.map(u => u.id) }),
      });
      AdminShared.showToast(
        `Verified ${eligible.length} user${eligible.length !== 1 ? 's' : ''}.`,
        'success'
      );
      await loadData();
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message}`, 'error');
    }
  }

  async function bulkResendVerif(ids) {
    const eligible = allUsers.filter(
      u => ids.includes(u.id) && !u.verified && u.signupMethod === 'email_password'
    );
    if (!eligible.length) {
      AdminShared.showToast(
        'No eligible users — only unverified email/password accounts can receive a verification resend.',
        'warning'
      );
      return;
    }
    const ok = await AdminShared.showConfirmModal({
      title: `Resend verification to ${eligible.length} user${eligible.length !== 1 ? 's' : ''}?`,
      confirmText: 'Resend',
      type: 'info',
    });
    if (!ok) {
      return;
    }
    let sent = 0;
    for (const u of eligible) {
      try {
        await AdminShared.adminFetch(`/api/admin/users/${u.id}/resend-verification`, {
          method: 'POST',
        });
        sent++;
      } catch {
        /* continue */
      }
    }
    AdminShared.showToast(
      `Sent ${sent} of ${eligible.length} verification email${eligible.length !== 1 ? 's' : ''}.`,
      sent > 0 ? 'success' : 'error'
    );
  }

  async function bulkSuspend(ids) {
    const safeIds = allUsers
      .filter(u => ids.includes(u.id) && u.role !== 'admin' && u.role !== 'owner')
      .map(u => u.id);
    if (!safeIds.length) {
      AdminShared.showToast(
        'No eligible users — admin and owner accounts cannot be bulk suspended.',
        'warning'
      );
      return;
    }
    const ok = await AdminShared.showConfirmModal({
      title: `Suspend ${safeIds.length} user${safeIds.length !== 1 ? 's' : ''}?`,
      confirmText: 'Suspend',
      type: 'danger',
    });
    if (!ok) {
      return;
    }
    try {
      await AdminShared.adminFetch('/api/admin/users/bulk-suspend', {
        method: 'POST',
        body: JSON.stringify({ userIds: safeIds, suspend: true }),
      });
      AdminShared.showToast(
        `Suspended ${safeIds.length} account${safeIds.length !== 1 ? 's' : ''}.`,
        'success'
      );
      await loadData();
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message}`, 'error');
    }
  }

  async function bulkDelete(ids) {
    const safeIds = allUsers
      .filter(u => ids.includes(u.id) && u.role !== 'admin' && u.role !== 'owner')
      .map(u => u.id);
    if (!safeIds.length) {
      AdminShared.showToast(
        'No eligible users — admin and owner accounts cannot be bulk deleted.',
        'warning'
      );
      return;
    }
    const ok = await AdminShared.showConfirmModal({
      title: `Permanently delete ${safeIds.length} user${safeIds.length !== 1 ? 's' : ''}?`,
      message: 'This cannot be undone. Admin and owner accounts are excluded.',
      confirmText: 'Delete permanently',
      type: 'danger',
    });
    if (!ok) {
      return;
    }
    let deleted = 0;
    for (const id of safeIds) {
      try {
        await AdminShared.adminFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
        deleted++;
      } catch {
        /* continue */
      }
    }
    AdminShared.showToast(
      `Deleted ${deleted} account${deleted !== 1 ? 's' : ''}.`,
      deleted > 0 ? 'success' : 'error'
    );
    selectedUserIds.clear();
    await loadData();
  }

  // ── Data loading ───────────────────────────────────────────────────────────
  async function loadSummary() {
    try {
      const data = await AdminShared.api('/api/admin/users/summary');
      renderSummaryCards(data);
    } catch (err) {
      AdminShared.showToast('Failed to load user summary.', 'error');
    }
  }

  async function loadUsers() {
    try {
      // Use the existing /users list endpoint which is already mounted
      const data = await AdminShared.api('/api/admin/users/list');
      allUsers = data.items || [];
      applyFilters();
    } catch (err) {
      const tbody = $('ucTableBody');
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="9" class="uc-empty-cell">Failed to load users. Please refresh.</td></tr>';
      }
      AdminShared.showToast('Failed to load users.', 'error');
    }
  }

  async function loadData() {
    await Promise.allSettled([loadSummary(), loadUsers()]);
  }

  // ── Initialise ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    applyUrlFilters();

    // Refresh button
    const refreshBtn = $('ucRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', loadData);
    }

    // Clear filters
    const clearBtn = $('ucClearFilters');
    if (clearBtn) {
      clearBtn.addEventListener('click', clearFilters);
    }

    // Search + filters with debounce
    ['ucSearch', 'ucRoleFilter', 'ucSignupFilter', 'ucVerifFilter', 'ucIssueFilter'].forEach(id => {
      const el = $(id);
      if (!el) {
        return;
      }
      el.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          currentPage = 1;
          applyFilters();
        }, 250);
      });
      el.addEventListener('change', () => {
        currentPage = 1;
        applyFilters();
      });
    });

    // Select all
    const sa = $('ucSelectAll');
    if (sa) {
      sa.addEventListener('change', () => {
        const checkboxes = document.querySelectorAll('.uc-user-checkbox');
        checkboxes.forEach(cb => {
          cb.checked = sa.checked;
          const uid = cb.dataset.userId;
          if (sa.checked) {
            selectedUserIds.add(uid);
          } else {
            selectedUserIds.delete(uid);
          }
        });
        updateBulkBar();
      });
    }

    // Bulk action buttons
    [
      ['ucBulkVerify', () => bulkVerify([...selectedUserIds])],
      ['ucBulkResendVerif', () => bulkResendVerif([...selectedUserIds])],
      ['ucBulkSuspend', () => bulkSuspend([...selectedUserIds])],
      ['ucBulkExport', () => AdminShared.showToast('Export from /admin-exports.', 'info')],
      ['ucBulkDelete', () => bulkDelete([...selectedUserIds])],
    ].forEach(([id, handler]) => {
      const btn = $(id);
      if (btn) {
        btn.addEventListener('click', handler);
      }
    });

    loadData();
  });
})();
