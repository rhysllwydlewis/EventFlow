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

  function supplierBadge(profile) {
    if (!profile) {
      return '<span class="badge" style="opacity:.5">—</span>';
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

    const userIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    const groupIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
    const alertIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    const clockIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const shopIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;

    grid.innerHTML = [
      makeCard(summary.total, 'Total users', groupIcon, 'blue', ''),
      makeCard(summary.byRole.customer, 'Customers', userIcon, 'teal', 'role=customer'),
      makeCard(summary.byRole.supplier, 'Suppliers', shopIcon, 'purple', 'role=supplier'),
      makeCard(
        summary.byRole.admin + (summary.byRole.owner || 0),
        'Admins',
        userIcon,
        'grey',
        'role=admin'
      ),
      makeCard(summary.newLast7, 'New this week', clockIcon, 'green', ''),
      makeCard(summary.unverified, 'Unverified', alertIcon, 'amber', 'verificationMethod=pending'),
      makeCard(summary.issueCount, 'Issues', alertIcon, 'red', 'issue=email_unverified'),
      makeCard(summary.suppliers.pending, 'Pending suppliers', shopIcon, 'amber', 'role=supplier'),
    ].join('');
  }

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

    // Wire checkboxes
    tbody.querySelectorAll('.uc-user-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const uid = cb.dataset.userId;
        if (cb.checked) {
          selectedUserIds.add(uid);
        } else {
          selectedUserIds.delete(uid);
        }
        updateBulkBar();
        updateSelectAll();
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

    const statusEl = $('ucFilterStatus');
    if (statusEl) {
      statusEl.textContent =
        total === allUsers.length
          ? `${total} user${total !== 1 ? 's' : ''}`
          : `${total} of ${allUsers.length} user${allUsers.length !== 1 ? 's' : ''}`;
    }

    const titleEl = $('ucTableTitle');
    if (titleEl) {
      titleEl.textContent = role ? `${role.charAt(0).toUpperCase() + role.slice(1)}s` : 'All users';
    }

    renderTable(slice);
    renderPagination(currentPage, pages, total);
  }

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
