/**
 * EventFlow Admin — Users Centre
 * Drives /admin-users (Users Centre page).
 * Uses the /api/admin/users/summary and /api/admin/users/list endpoints
 * from services/adminUserSummary.service.js so counts match /admin dashboard.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const PAGE_SIZE = 50;
  const selectedUserIds = new Set();

  let allUsers = [];
  let currentPage = 1;
  let debounceTimer = null;

  function esc(value) {
    const d = document.createElement('div');
    d.textContent = String(value ?? '');
    return d.innerHTML;
  }

  function fmtDate(value) {
    if (!value) {
      return '—';
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return '—';
    }
    return new Date(parsed).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function fmtRelative(value) {
    if (!value) {
      return '—';
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return '—';
    }
    const days = Math.floor((Date.now() - parsed) / 86400000);
    if (days <= 0) {
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
    return fmtDate(value);
  }

  function humanize(value) {
    return String(value || 'unknown')
      .replace(/_/g, ' ')
      .replace(/(^|\s)([a-z])/g, (_m, prefix, c) => prefix + c.toUpperCase());
  }

  function badge(label, type) {
    return `<span class="badge badge-${type || 'secondary'}">${esc(label)}</span>`;
  }

  function roleBadge(role) {
    const map = {
      customer: badge('Customer', 'customer'),
      supplier: badge('Supplier', 'supplier-account'),
      admin: badge('Admin', 'admin'),
      owner: badge('Owner', 'admin'),
    };
    return map[role] || badge(humanize(role), 'secondary');
  }

  function signupBadge(method) {
    const map = {
      google: badge('Google', 'google'),
      email_password: badge('Email/password', 'email'),
      admin_created: badge('Admin-created', 'admin-created'),
      owner: badge('Owner', 'admin'),
      unknown: badge('Unknown', 'warning'),
    };
    return map[method] || badge(humanize(method), 'warning');
  }

  function verificationBadge(method) {
    const map = {
      google: badge('Google verified', 'google'),
      google_verified_email: badge('Google verified', 'google'),
      email_link: badge('Email link', 'yes'),
      eventflow_email: badge('EventFlow email', 'yes'),
      admin: badge('Admin verified', 'admin-created'),
      admin_created: badge('Admin-created', 'admin-created'),
      owner_account: badge('Owner account', 'admin'),
      legacy: badge('Legacy verified', 'secondary'),
      pending: badge('Pending', 'no'),
      unknown: badge('Unknown', 'warning'),
    };
    return map[method] || badge(humanize(method), 'warning');
  }

  function emailStatusBadge(status) {
    const map = {
      not_required: badge('Not required', 'secondary'),
      sent: badge('Sent', 'info'),
      delivered: badge('Delivered', 'yes'),
      failed: badge('Failed', 'danger'),
      bounced: badge('Bounced', 'danger'),
      outbox: badge('Outbox fallback', 'warning'),
      pending: badge('Pending', 'warning'),
    };
    return map[status] || badge(humanize(status), 'secondary');
  }

  function subscriptionBadge(subscription, role) {
    if (role === 'admin' || role === 'owner') {
      return '—';
    }
    const tier = (subscription && subscription.tier) || 'free';
    if (tier === 'pro_plus') {
      return badge('Pro Plus', 'pro-plus');
    }
    if (tier === 'pro') {
      return badge('Pro', 'pro');
    }
    return badge('Starter', 'starter');
  }

  function issueBadges(issues) {
    const labels = {
      email_unverified: ['Email unverified', 'warning'],
      unknown_verification_source: ['Unknown source', 'warning'],
      supplier_profile_missing: ['No supplier profile', 'warning'],
      suspended: ['Suspended', 'danger'],
    };
    return (issues || [])
      .map(issue => {
        const [label, type] = labels[issue] || [humanize(issue), 'secondary'];
        return `<span class="uc-issue-badge uc-issue-badge--${type}">${esc(label)}</span>`;
      })
      .join(' ');
  }

  function canResendVerification(user) {
    return (
      user &&
      user.signupMethod === 'email_password' &&
      user.verified !== true &&
      user.emailDeliveryStatus !== 'not_required'
    );
  }

  function renderSummaryCards(data) {
    const grid = $('ucSummaryGrid');
    if (!grid) {
      return;
    }
    const summary = data.summary || {};
    const health = data.health || {};
    const supplierHealth = data.supplierHealth || {};
    const card = (value, label, href, accent) => `
      <a href="${href}" class="uc-summary-card uc-summary-card--${accent || 'blue'}">
        <span class="uc-summary-card__value">${Number(value || 0).toLocaleString()}</span>
        <span class="uc-summary-card__label">${esc(label)}</span>
      </a>`;

    grid.innerHTML = [
      card(summary.totalUsers ?? data.total, 'Total users', '/admin-users', 'blue'),
      card(
        summary.unverifiedUsers ?? data.unverified,
        'Unverified users',
        '/admin-users?verificationMethod=pending',
        'amber'
      ),
      card(health.googleVerified, 'Google verified', '/admin-users?signupMethod=google', 'green'),
      card(
        health.emailPasswordPending,
        'Email/password pending',
        '/admin-users?signupMethod=email_password&verificationMethod=pending',
        'amber'
      ),
      card(
        supplierHealth.totalSupplierUsers ?? (data.byRole && data.byRole.supplier),
        'Supplier users',
        '/admin-users?role=supplier',
        'teal'
      ),
      card(
        supplierHealth.linkIssues ?? (data.suppliers && data.suppliers.linkIssues),
        'Supplier link issues',
        '/admin-users?issue=supplier_profile_missing',
        'red'
      ),
    ].join('');
  }

  function renderTable(users) {
    const tbody = $('ucTableBody');
    if (!tbody) {
      return;
    }

    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="12" class="uc-empty-cell">
        <div class="admin-empty-state">
          <p>No users match the current filters.</p>
          <button type="button" class="btn btn-ghost btn-sm" id="ucEmptyClear">Clear filters</button>
        </div>
      </td></tr>`;
      const emptyClear = $('ucEmptyClear');
      if (emptyClear) {
        emptyClear.addEventListener('click', clearFilters);
      }
      return;
    }

    tbody.innerHTML = users
      .map(user => {
        const userId = esc(user.id || '');
        const checked = selectedUserIds.has(user.id) ? 'checked' : '';
        const supplierLink = user.supplierProfile
          ? `<a href="${esc(user.supplierProfile.profileUrl)}" class="btn btn-ghost btn-xs">Supplier</a>`
          : '';
        return `<tr class="${user.suspended ? 'uc-row--suspended' : ''} ${(user.accountIssues || []).length ? 'uc-row--issues' : ''}">
          <td class="checkbox-cell"><input type="checkbox" class="uc-user-checkbox table-checkbox" data-user-id="${userId}" ${checked} aria-label="Select ${esc(user.name || user.email || 'user')}"></td>
          <td><a href="/admin-user-detail?id=${userId}" class="uc-user-link">${esc(user.name || '(no name)')}</a>${issueBadges(user.accountIssues)}</td>
          <td><a href="/admin-user-detail?id=${userId}" class="uc-user-link">${esc(user.email || '')}</a></td>
          <td>${roleBadge(user.role)}</td>
          <td>${subscriptionBadge(user.subscription, user.role)}</td>
          <td>${user.verified ? '✓ Yes' : '✗ No'}<div>${verificationBadge(user.verificationMethod)}</div></td>
          <td>${signupBadge(user.signupMethod)}</td>
          <td>${emailStatusBadge(user.emailDeliveryStatus)}</td>
          <td>${user.marketingOptIn ? 'Yes' : 'No'}</td>
          <td>${fmtDate(user.createdAt)}</td>
          <td>${fmtRelative(user.lastLoginAt)}</td>
          <td class="uc-actions-cell">
            <a href="/admin-user-detail?id=${userId}" class="btn btn-ghost btn-xs">View</a>
            ${supplierLink}
            <button type="button" class="btn btn-secondary btn-xs" data-manage-subscription="${userId}">Subscription</button>
            ${canResendVerification(user) ? `<button type="button" class="btn btn-secondary btn-xs" data-resend-verification="${userId}">Resend</button>` : ''}
          </td>
        </tr>`;
      })
      .join('');
  }

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
    const searchLower = search.toLowerCase().trim();
    const filtered = allUsers.filter(user => {
      if (
        searchLower &&
        !(user.name || '').toLowerCase().includes(searchLower) &&
        !(user.email || '').toLowerCase().includes(searchLower)
      ) {
        return false;
      }
      if (role && user.role !== role) {
        return false;
      }
      if (signupMethod && user.signupMethod !== signupMethod) {
        return false;
      }
      if (verificationMethod && user.verificationMethod !== verificationMethod) {
        return false;
      }
      if (issue && !(user.accountIssues || []).includes(issue)) {
        return false;
      }
      return true;
    });

    const total = filtered.length;
    const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    currentPage = Math.min(currentPage, pages);
    const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    renderTable(visible);
    updateSummaryText(total, pages);
    updateBulkBar();
  }

  function updateSummaryText(total, pages) {
    const el = $('ucUserSummary') || $('user-summary');
    if (el) {
      el.textContent = `${total.toLocaleString()} users · page ${currentPage} of ${pages}`;
    }
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

  function applyUrlFilters() {
    const params = new URLSearchParams(window.location.search);
    const mapping = {
      role: 'ucRoleFilter',
      signupMethod: 'ucSignupFilter',
      verificationMethod: 'ucVerifFilter',
      issue: 'ucIssueFilter',
    };
    Object.entries(mapping).forEach(([param, id]) => {
      const value = params.get(param);
      const el = $(id);
      if (value && el) {
        el.value = value;
      }
    });
    const search = params.get('search');
    if (search && $('ucSearch')) {
      $('ucSearch').value = search;
    }
  }

  function selectedEligible(ids, predicate) {
    return allUsers.filter(user => ids.includes(user.id) && predicate(user)).map(user => user.id);
  }

  async function bulkVerify(ids) {
    const safeIds = selectedEligible(
      ids,
      user =>
        user.role !== 'admin' && user.role !== 'owner' && user.signupMethod === 'email_password'
    );
    if (!safeIds.length) {
      AdminShared.showToast('No eligible email/password users selected.', 'warning');
      return;
    }
    const ok = await AdminShared.showConfirmModal({
      title: `Verify ${safeIds.length} user${safeIds.length !== 1 ? 's' : ''}?`,
      message: 'Admin and owner accounts are excluded from this bulk action.',
      confirmText: 'Verify',
      type: 'warning',
    });
    if (!ok) {
      return;
    }
    await AdminShared.adminFetch('/api/admin/users/bulk-verify', {
      method: 'POST',
      body: JSON.stringify({ userIds: safeIds }),
    });
    selectedUserIds.clear();
    AdminShared.showToast(
      `Verified ${safeIds.length} account${safeIds.length !== 1 ? 's' : ''}.`,
      'success'
    );
    await loadData();
  }

  async function bulkSuspend(ids) {
    const safeIds = selectedEligible(ids, user => user.role !== 'admin' && user.role !== 'owner');
    if (!safeIds.length) {
      AdminShared.showToast(
        'No eligible users — admin and owner accounts cannot be suspended.',
        'warning'
      );
      return;
    }
    const ok = await AdminShared.showConfirmModal({
      title: `Suspend ${safeIds.length} user${safeIds.length !== 1 ? 's' : ''}?`,
      message: 'Admin and owner accounts are excluded from this bulk action.',
      confirmText: 'Suspend',
      type: 'danger',
    });
    if (!ok) {
      return;
    }
    await AdminShared.adminFetch('/api/admin/users/bulk-suspend', {
      method: 'POST',
      body: JSON.stringify({
        userIds: safeIds,
        suspended: true,
        reason: 'Bulk suspension from Users Centre',
      }),
    });
    selectedUserIds.clear();
    AdminShared.showToast(
      `Suspended ${safeIds.length} account${safeIds.length !== 1 ? 's' : ''}.`,
      'success'
    );
    await loadData();
  }

  async function bulkDelete(ids) {
    const safeIds = selectedEligible(ids, user => user.role !== 'admin' && user.role !== 'owner');
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
    await AdminShared.adminFetch('/api/admin/users/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ userIds: safeIds }),
    });
    selectedUserIds.clear();
    AdminShared.showToast(
      `Deleted ${safeIds.length} account${safeIds.length !== 1 ? 's' : ''}.`,
      'success'
    );
    await loadData();
  }

  async function resendVerification(userId) {
    const user = allUsers.find(item => item.id === userId);
    if (!canResendVerification(user)) {
      AdminShared.showToast('Verification email is not required for this account.', 'warning');
      return;
    }
    await AdminShared.adminFetch(
      `/api/admin/users/${encodeURIComponent(userId)}/resend-verification`,
      {
        method: 'POST',
      }
    );
    AdminShared.showToast('Verification email queued.', 'success');
  }

  function updateBulkBar() {
    const bar = $('ucBulkActionsBar');
    const count = $('ucBulkCount');
    const selectedCount = selectedUserIds.size;
    if (bar) {
      bar.style.display = selectedCount ? 'flex' : 'none';
    }
    if (count) {
      count.textContent = `${selectedCount} user${selectedCount === 1 ? '' : 's'} selected`;
    }
  }

  function openSubscriptionModal(userId) {
    const user = allUsers.find(item => item.id === userId);
    if (!user) {
      return;
    }
    const modal = $('subscriptionModal');
    const userIdInput = $('subscriptionUserId');
    const subtitle = $('subscriptionModalSubtitle');
    const status = $('currentSubscriptionStatus');
    if (userIdInput) {
      userIdInput.value = userId;
    }
    if (subtitle) {
      subtitle.textContent = `${user.name || '(no name)'} · ${user.email || 'No email'}`;
    }
    if (status) {
      status.innerHTML = `<p>${subscriptionBadge(user.subscription, user.role)} ${esc((user.subscription && user.subscription.status) || 'active')}</p>`;
    }
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  function closeSubscriptionModal() {
    const modal = $('subscriptionModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  async function saveSubscription(event) {
    event.preventDefault();
    const userId = ($('subscriptionUserId') || {}).value;
    const tier = ($('subscriptionTier') || {}).value;
    const duration = ($('subscriptionDuration') || {}).value;
    const reason = ($('subscriptionReason') || {}).value;
    if (!userId || !tier) {
      AdminShared.showToast('Choose a user and subscription tier.', 'warning');
      return;
    }
    if (tier === 'free') {
      await removeSubscription(userId, reason);
      return;
    }
    await AdminShared.adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ tier, duration, reason }),
    });
    closeSubscriptionModal();
    AdminShared.showToast('Subscription updated.', 'success');
    await loadData();
  }

  async function removeSubscription(userId, reason) {
    const ok = await AdminShared.showConfirmModal({
      title: 'Remove subscription?',
      message: 'This user will be moved back to the free tier.',
      confirmText: 'Remove subscription',
      type: 'danger',
    });
    if (!ok) {
      return;
    }
    await AdminShared.adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/subscription`, {
      method: 'DELETE',
      body: JSON.stringify({ reason: reason || 'Removed from Users Centre' }),
    });
    closeSubscriptionModal();
    AdminShared.showToast('Subscription removed.', 'success');
    await loadData();
  }

  async function loadSummary() {
    try {
      const data = await AdminShared.api('/api/admin/users/summary');
      renderSummaryCards(data);
    } catch (err) {
      const grid = $('ucSummaryGrid');
      if (grid) {
        grid.innerHTML = '<div class="admin-inline-error">Could not load user summary.</div>';
      }
      AdminShared.showToast('Failed to load user summary.', 'error');
    }
  }

  async function loadUsers() {
    const tbody = $('ucTableBody');
    if (tbody && window.AdminShared && AdminShared.showLoadingState) {
      AdminShared.showLoadingState(tbody, { rows: 5, cols: 12, message: 'Loading users...' });
    }
    try {
      const data = await AdminShared.api('/api/admin/users/list');
      allUsers = data.items || [];
      selectedUserIds.clear();
      applyFilters();
    } catch (err) {
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="12" class="uc-empty-cell">Failed to load users. Please refresh.</td></tr>';
      }
      AdminShared.showToast('Failed to load users.', 'error');
    }
  }

  async function loadData() {
    await Promise.allSettled([loadSummary(), loadUsers()]);
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyUrlFilters();

    const refreshBtn = $('ucRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', loadData);
    }

    const clearBtn = $('ucClearFilters');
    if (clearBtn) {
      clearBtn.addEventListener('click', clearFilters);
    }

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

    const selectAll = $('ucSelectAll');
    if (selectAll) {
      selectAll.addEventListener('change', () => {
        document.querySelectorAll('.uc-user-checkbox').forEach(checkbox => {
          checkbox.checked = selectAll.checked;
          const uid = checkbox.dataset.userId;
          if (selectAll.checked) {
            selectedUserIds.add(uid);
          } else {
            selectedUserIds.delete(uid);
          }
        });
        updateBulkBar();
      });
    }

    document.addEventListener('change', event => {
      const checkbox = event.target && event.target.closest('.uc-user-checkbox');
      if (!checkbox) {
        return;
      }
      const uid = checkbox.dataset.userId;
      if (checkbox.checked) {
        selectedUserIds.add(uid);
      } else {
        selectedUserIds.delete(uid);
      }
      updateBulkBar();
    });

    document.addEventListener('click', event => {
      const subscriptionBtn = event.target && event.target.closest('[data-manage-subscription]');
      const resendBtn = event.target && event.target.closest('[data-resend-verification]');
      if (subscriptionBtn) {
        openSubscriptionModal(subscriptionBtn.dataset.manageSubscription);
      }
      if (resendBtn) {
        resendVerification(resendBtn.dataset.resendVerification).catch(err =>
          AdminShared.showToast(`Failed: ${err.message}`, 'error')
        );
      }
    });

    [
      ['ucBulkVerify', () => bulkVerify([...selectedUserIds])],
      ['ucBulkSuspend', () => bulkSuspend([...selectedUserIds])],
      ['ucBulkDelete', () => bulkDelete([...selectedUserIds])],
      ['ucBulkExport', () => AdminShared.showToast('Export from /admin-exports.', 'info')],
    ].forEach(([id, handler]) => {
      const btn = $(id);
      if (btn) {
        btn.addEventListener('click', () =>
          handler().catch(err => AdminShared.showToast(`Failed: ${err.message}`, 'error'))
        );
      }
    });

    const closeBtn = $('closeSubscriptionModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeSubscriptionModal);
    }
    const cancelBtn = $('cancelSubscriptionBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', closeSubscriptionModal);
    }
    const form = $('subscriptionForm');
    if (form) {
      form.addEventListener('submit', saveSubscription);
    }
    const removeBtn = $('removeSubscriptionBtn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        const userId = ($('subscriptionUserId') || {}).value;
        removeSubscription(userId).catch(err =>
          AdminShared.showToast(`Failed: ${err.message}`, 'error')
        );
      });
    }

    loadData();
  });
})();
