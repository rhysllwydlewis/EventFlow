/**
 * EventFlow Admin — Users Centre
 * Drives /admin-users (Users Centre page).
 * Uses the /api/admin/users/summary and /api/admin/users/list endpoints
 * from services/adminUserSummary.service.js so counts match /admin dashboard.
 */
'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const selectedUserIds = new Set();

  let currentUsers = [];
  let currentPage = 1;
  let currentLimit = 50;
  let currentTotal = 0;
  let currentPages = 1;
  let debounceTimer = null;

  function esc(value) {
    const d = document.createElement('div');
    d.textContent = String(value ?? '');
    return d.innerHTML;
  }

  // Blocks javascript:/data:/vbscript: hrefs — esc() only HTML-entity-encodes,
  // it doesn't stop a dangerous URL scheme from still executing on click.
  function safeHref(url) {
    const value = String(url || '').trim();
    if (!value || /^(javascript|data|vbscript):/i.test(value)) {
      return '#';
    }
    return esc(value);
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
      updateSelectAllState();
      return;
    }

    tbody.innerHTML = users
      .map(user => {
        const userId = esc(user.id || '');
        const checked = selectedUserIds.has(user.id) ? 'checked' : '';
        const hasProfile = Boolean(user.supplierProfile);
        const supplierLink = hasProfile
          ? `<a href="${safeHref(user.supplierProfile.profileUrl)}" class="btn btn-ghost btn-xs" style="white-space:nowrap;">Supplier</a>`
          : user.role === 'supplier'
            ? `<button type="button" class="btn btn-warning btn-xs" style="white-space:nowrap;" data-provision-profile="${userId}" title="Create missing supplier profile">⚠️ Provision</button>`
            : '';
        return `<tr class="${user.suspended ? 'uc-row--suspended' : ''} ${(user.accountIssues || []).length ? 'uc-row--issues' : ''}">
          <td class="checkbox-cell"><input type="checkbox" class="uc-user-checkbox table-checkbox" data-user-id="${userId}" ${checked} aria-label="Select ${esc(user.name || user.email || 'user')}"></td>
          <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:155px;"><a href="/admin-user-detail?id=${userId}" class="uc-user-link" title="${esc(user.name || '(no name)')}">${esc(user.name || '(no name)')}</a>${issueBadges(user.accountIssues)}</td>
          <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:195px;"><a href="/admin-user-detail?id=${userId}" class="uc-user-link" title="${esc(user.email || '')}">${esc(user.email || '')}</a></td>
          <td style="white-space:nowrap;">${roleBadge(user.role)}</td>
          <td style="white-space:nowrap;">${subscriptionBadge(user.subscription, user.role)}</td>
          <td>${user.verified ? '✓ Yes' : '✗ No'}<div style="margin-top:2px;">${verificationBadge(user.verificationMethod)}</div></td>
          <td style="white-space:nowrap;">${signupBadge(user.signupMethod)}</td>
          <td style="white-space:nowrap;">${emailStatusBadge(user.emailDeliveryStatus)}</td>
          <td style="white-space:nowrap;">${user.marketingOptIn ? 'Yes' : 'No'}</td>
          <td style="white-space:nowrap;">${fmtDate(user.createdAt)}</td>
          <td style="white-space:nowrap;">${fmtRelative(user.lastLoginAt)}</td>
          <td class="uc-actions-cell" style="white-space:nowrap;">
            <a href="/admin-user-detail?id=${userId}" class="btn btn-ghost btn-xs">View</a>
            ${supplierLink}
            <button type="button" class="btn btn-secondary btn-xs" data-manage-subscription="${userId}">Subscription</button>
            ${canResendVerification(user) ? `<button type="button" class="btn btn-secondary btn-xs" data-resend-verification="${userId}">Resend</button>` : ''}
          </td>
        </tr>`;
      })
      .join('');
    updateSelectAllState();
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

  function buildListUrl() {
    const params = new URLSearchParams();
    const filters = getFilters();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      }
    });
    params.set('page', String(currentPage));
    params.set('limit', String(currentLimit));
    return `/api/admin/users/list?${params.toString()}`;
  }

  function syncFilterUrl() {
    const params = new URLSearchParams();
    Object.entries(getFilters()).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      }
    });
    if (currentPage > 1) {
      params.set('page', String(currentPage));
    }
    if (currentLimit !== 50) {
      params.set('limit', String(currentLimit));
    }
    const query = params.toString();
    window.history.replaceState({}, '', query ? `/admin-users?${query}` : '/admin-users');
  }

  async function applyFilters() {
    syncFilterUrl();
    await loadUsers();
  }

  function updateSummaryText(total, pages) {
    const el = $('ucUserSummary') || $('user-summary');
    const start = total ? (currentPage - 1) * currentLimit + 1 : 0;
    const end = Math.min(currentPage * currentLimit, total);
    if (el) {
      el.textContent = `${total.toLocaleString()} users · showing ${start.toLocaleString()}–${end.toLocaleString()} · page ${currentPage} of ${pages}`;
    }
    const pageEl = $('ucCurrentPage');
    if (pageEl) {
      pageEl.textContent = String(currentPage);
    }
    const pagesEl = $('ucTotalPages');
    if (pagesEl) {
      pagesEl.textContent = String(pages);
    }
    const totalEl = $('ucTotalCount');
    if (totalEl) {
      totalEl.textContent = total.toLocaleString();
    }
    const prev = $('ucPrevPage');
    const next = $('ucNextPage');
    if (prev) {
      prev.disabled = currentPage <= 1;
      prev.setAttribute('aria-disabled', String(prev.disabled));
    }
    if (next) {
      next.disabled = currentPage >= pages;
      next.setAttribute('aria-disabled', String(next.disabled));
    }
  }

  function clearFilters() {
    ['ucSearch', 'ucRoleFilter', 'ucSignupFilter', 'ucVerifFilter', 'ucIssueFilter'].forEach(id => {
      const el = $(id);
      if (el) {
        el.value = '';
      }
    });
    selectedUserIds.clear();
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
    const page = Number(params.get('page'));
    currentPage = Number.isFinite(page) && page > 0 ? page : 1;
    const limit = Number(params.get('limit'));
    if ([25, 50, 100, 200].includes(limit)) {
      currentLimit = limit;
    }
  }

  function visibleCheckboxes() {
    return [...document.querySelectorAll('.uc-user-checkbox')];
  }

  function updateSelectAllState() {
    const selectAll = $('ucSelectAll');
    if (!selectAll) {
      return;
    }
    const checkboxes = visibleCheckboxes();
    const checkedCount = checkboxes.filter(checkbox => checkbox.checked).length;
    selectAll.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
  }

  function selectedEligible(ids, predicate) {
    return currentUsers
      .filter(user => ids.includes(user.id) && predicate(user))
      .map(user => user.id);
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
      message:
        'This cannot be undone. Supplier users will also have their supplier profile, packages and public listing data deleted. Admin and owner accounts are excluded.',
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

  async function provisionMissingProfile(userId) {
    const ok = await AdminShared.showConfirmModal({
      title: 'Create supplier profile?',
      message:
        'This will create a blank supplier profile for this user. They can customise it from their dashboard.',
      confirmText: 'Create profile',
      type: 'warning',
    });
    if (!ok) {
      return;
    }
    try {
      await AdminShared.adminFetch(
        `/api/admin/users/${encodeURIComponent(userId)}/provision-supplier-profile`,
        { method: 'POST' }
      );
      AdminShared.showToast('Supplier profile created.', 'success');
      await loadData();
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message}`, 'error');
    }
  }

  async function bulkProvisionProfiles() {
    const ok = await AdminShared.showConfirmModal({
      title: 'Fix all missing supplier profiles?',
      message:
        'This will create blank supplier profiles for every supplier account that is missing one. Safe to run multiple times.',
      confirmText: 'Fix all',
      type: 'warning',
    });
    if (!ok) {
      return;
    }
    try {
      const data = await AdminShared.adminFetch(
        '/api/admin/users/bulk-provision-supplier-profiles',
        { method: 'POST' }
      );
      AdminShared.showToast(
        `Done — ${data.provisioned || 0} profile(s) created out of ${data.checked || 0} supplier account(s).`,
        'success'
      );
      await loadData();
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message}`, 'error');
    }
  }

  async function resendVerification(userId) {
    const user = currentUsers.find(item => item.id === userId);
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
      count.textContent = `${selectedCount} visible user${selectedCount === 1 ? '' : 's'} selected`;
    }
  }

  function bulkExportSelected() {
    const ids = [...selectedUserIds];
    if (!ids.length) {
      AdminShared.showToast('Select visible users to export.', 'warning');
      return;
    }
    const params = new URLSearchParams();
    params.set('ids', ids.join(','));
    window.open(`/api/admin/users/export?${params.toString()}`, '_blank', 'noopener');
  }

  function renderSubscriptionHistory(history) {
    const target = $('subscriptionHistory');
    if (!target) {
      return;
    }
    if (!Array.isArray(history) || !history.length) {
      target.innerHTML = '<div class="text-muted">No subscription history.</div>';
      return;
    }
    target.innerHTML = history
      .map(
        item =>
          `<div class="subscription-history-item"><strong>${esc(humanize(item.action || 'updated'))}</strong> ${esc(humanize(item.tier || 'free'))}<div class="small">${fmtDate(item.date)}${item.reason ? ` · ${esc(item.reason)}` : ''}</div></div>`
      )
      .join('');
  }

  async function loadSubscriptionHistory(userId) {
    renderSubscriptionHistory([]);
    try {
      const data = await AdminShared.api(
        `/api/admin/users/${encodeURIComponent(userId)}/subscription-history`
      );
      renderSubscriptionHistory(data.history || []);
    } catch {
      const target = $('subscriptionHistory');
      if (target) {
        target.innerHTML = '<div class="text-muted">Could not load subscription history.</div>';
      }
    }
  }

  function openSubscriptionModal(userId) {
    const user = currentUsers.find(item => item.id === userId);
    if (!user) {
      // User not in current page cache — can happen on filtered views with a single result.
      // Fetch directly so the modal still works.
      AdminShared.api(`/api/admin/users/${encodeURIComponent(userId)}`)
        .then(fetchedUser => _showSubscriptionModal(userId, fetchedUser))
        .catch(err => AdminShared.showToast(`Could not load user: ${err.message}`, 'error'));
      return;
    }
    _showSubscriptionModal(userId, user);
  }

  function _showSubscriptionModal(userId, user) {
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
    loadSubscriptionHistory(userId);
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
    } catch {
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
      const data = await AdminShared.api(buildListUrl());
      currentUsers = data.items || [];
      currentTotal = Number(data.total || 0);
      currentPages = Math.max(Number(data.pages || 1), 1);
      currentPage = Math.min(Number(data.page || currentPage), currentPages);
      currentLimit = Number(data.limit || currentLimit);
      selectedUserIds.clear();
      renderTable(currentUsers);
      updateSummaryText(currentTotal, currentPages);
      updateBulkBar();
    } catch {
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
      refreshBtn.addEventListener('click', () => loadData());
    }

    const prevBtn = $('ucPrevPage');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage -= 1;
          applyFilters();
        }
      });
    }
    const nextBtn = $('ucNextPage');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (currentPage < currentPages) {
          currentPage += 1;
          applyFilters();
        }
      });
    }
    const pageSize = $('ucPageSize');
    if (pageSize) {
      pageSize.value = String(currentLimit);
      pageSize.addEventListener('change', () => {
        currentLimit = Number(pageSize.value) || 50;
        selectedUserIds.clear();
        currentPage = 1;
        applyFilters();
      });
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
          selectedUserIds.clear();
          currentPage = 1;
          applyFilters();
        }, 250);
      });
      el.addEventListener('change', () => {
        selectedUserIds.clear();
        currentPage = 1;
        applyFilters();
      });
    });

    const selectAll = $('ucSelectAll');
    if (selectAll) {
      selectAll.addEventListener('change', () => {
        visibleCheckboxes().forEach(checkbox => {
          checkbox.checked = selectAll.checked;
          const uid = checkbox.dataset.userId;
          if (!uid) {
            return;
          }
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
      if (!uid) {
        return;
      }
      if (checkbox.checked) {
        selectedUserIds.add(uid);
      } else {
        selectedUserIds.delete(uid);
      }
      updateBulkBar();
      updateSelectAllState();
    });

    document.addEventListener('click', event => {
      const subscriptionBtn = event.target && event.target.closest('[data-manage-subscription]');
      const resendBtn = event.target && event.target.closest('[data-resend-verification]');
      const provisionBtn = event.target && event.target.closest('[data-provision-profile]');
      if (subscriptionBtn) {
        openSubscriptionModal(subscriptionBtn.dataset.manageSubscription);
      }
      if (resendBtn) {
        resendVerification(resendBtn.dataset.resendVerification).catch(err =>
          AdminShared.showToast(`Failed: ${err.message}`, 'error')
        );
      }
      if (provisionBtn) {
        provisionMissingProfile(provisionBtn.dataset.provisionProfile);
      }
    });

    [
      ['ucBulkVerify', () => bulkVerify([...selectedUserIds])],
      ['ucBulkSuspend', () => bulkSuspend([...selectedUserIds])],
      ['ucBulkDelete', () => bulkDelete([...selectedUserIds])],
      ['ucBulkExport', bulkExportSelected],
      ['ucBulkProvisionProfiles', bulkProvisionProfiles],
    ].forEach(([id, handler]) => {
      const btn = $(id);
      if (btn) {
        btn.addEventListener('click', () =>
          handler().catch(err => AdminShared.showToast(`Failed: ${err.message}`, 'error'))
        );
      }
    });

    const closePanelBtn = $('closeSubPanel');
    if (closePanelBtn) {
      closePanelBtn.addEventListener('click', closeSubscriptionModal);
    }
    const modal = $('subscriptionModal');
    if (modal) {
      modal.addEventListener('click', event => {
        if (event.target === modal) {
          closeSubscriptionModal();
        }
      });
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeSubscriptionModal();
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
