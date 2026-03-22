// Standalone admin users loader with search and filters
(function () {
  let allUsers = [];
  const selectedUserIds = new Set();

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    if (!dateStr) {
      return 'Never';
    }
    try {
      return new Date(dateStr).toLocaleString();
    } catch (e) {
      return dateStr;
    }
  }

  async function loadAdminUsers() {
    const summary = document.getElementById('user-summary');
    const tbody = document.querySelector('table.table tbody');
    if (!summary || !tbody) {
      return;
    }

    summary.textContent = 'Loading users…';

    // Show loading state
    AdminShared.showLoadingState(tbody, {
      rows: 5,
      cols: 10,
      message: 'Loading users...',
    });

    try {
      // Use AdminShared.api for consistent error handling
      const data = await AdminShared.api('/api/admin/users');
      allUsers = (data && data.items) || [];

      renderUsers();
    } catch (e) {
      AdminShared.debugError('Admin users load failed', e);
      summary.textContent = 'Error loading users';

      // Show error state with retry button
      AdminShared.showErrorState(tbody, {
        message: 'Failed to load users. Please try again.',
        onRetry: loadAdminUsers,
        colspan: 10,
      });
    }
  }

  function renderUsers() {
    const summary = document.getElementById('user-summary');
    const tbody = document.querySelector('table.table tbody');

    // Get filter values
    const searchTerm = document.getElementById('userSearch')?.value.toLowerCase() || '';
    const roleFilter = document.getElementById('roleFilter')?.value || '';
    const subscriptionFilter = document.getElementById('subscriptionFilter')?.value || '';
    const verifiedFilter = document.getElementById('verifiedFilter')?.value || '';

    // Filter users
    const filtered = allUsers.filter(u => {
      // Search filter
      if (searchTerm) {
        const name = (u.name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        if (!name.includes(searchTerm) && !email.includes(searchTerm)) {
          return false;
        }
      }

      // Role filter
      if (roleFilter && u.role !== roleFilter) {
        return false;
      }

      // Subscription filter
      if (subscriptionFilter) {
        const userTier = u.subscription?.tier || 'free';
        if (userTier !== subscriptionFilter) {
          return false;
        }
      }

      // Verified filter
      if (verifiedFilter === 'yes' && !u.verified) {
        return false;
      }
      if (verifiedFilter === 'no' && u.verified) {
        return false;
      }

      return true;
    });

    summary.textContent = filtered.length
      ? `${filtered.length} user${filtered.length === 1 ? '' : 's'} found (${allUsers.length} total)`
      : 'No users match the filters.';

    if (!filtered.length) {
      // Show empty state
      AdminShared.showEmptyState(tbody, {
        message: 'No users found matching your filters.',
        icon: '👥',
        actionLabel: 'Clear Filters',
        onAction: () => {
          // Clear all filters
          const searchInput = document.getElementById('userSearch');
          const roleFilter = document.getElementById('roleFilter');
          const subscriptionFilter = document.getElementById('subscriptionFilter');
          const verifiedFilter = document.getElementById('verifiedFilter');

          if (searchInput) {
            searchInput.value = '';
          }
          if (roleFilter) {
            roleFilter.value = '';
          }
          if (subscriptionFilter) {
            subscriptionFilter.value = '';
          }
          if (verifiedFilter) {
            verifiedFilter.value = '';
          }

          renderUsers();
        },
        colspan: 10,
      });
      return;
    }

    tbody.innerHTML = filtered
      .map(u => {
        // Get subscription badge
        const subscription = u.subscription || { tier: 'free', status: 'active' };
        let subscriptionBadge = '';
        if (subscription.tier === 'pro') {
          subscriptionBadge = '<span class="badge badge-pro">Pro</span>';
        } else if (subscription.tier === 'pro_plus') {
          subscriptionBadge = '<span class="badge badge-pro-plus">Pro+</span>';
        } else {
          subscriptionBadge = '<span class="badge badge-free">Free</span>';
        }

        const userId = escapeHtml(u.id || u._id || '');
        const isChecked = selectedUserIds.has(userId);

        const actionsHtml = `
          <button class="btn btn-secondary btn-sm" data-manage-subscription="${userId}" style="font-size:12px;padding:4px 8px;margin-right:4px;">Manage Subscription</button>
          ${
            !u.verified
              ? `<button class="btn btn-secondary btn-sm" data-resend-verification="${userId}" style="font-size:12px;padding:4px 8px;">Resend Verification</button>`
              : ''
          }
        `;

        return (
          `<tr>` +
          `<td class="checkbox-cell"><input type="checkbox" class="user-checkbox table-checkbox" data-user-id="${userId}" ${isChecked ? 'checked' : ''}></td>` +
          `<td><a href="/admin-user-detail?id=${userId}" style="color:#3b82f6;text-decoration:none;">${escapeHtml(u.name || '')}</a></td>` +
          `<td><a href="/admin-user-detail?id=${userId}" style="color:#3b82f6;text-decoration:none;">${escapeHtml(u.email || '')}</a></td>` +
          `<td>${escapeHtml(u.role || '')}</td>` +
          `<td>${subscriptionBadge}</td>` +
          `<td>${u.verified ? '✓ Yes' : '✗ No'}</td>` +
          `<td>${u.marketingOptIn ? 'Yes' : 'No'}</td>` +
          `<td>${formatDate(u.createdAt)}</td>` +
          `<td>${formatDate(u.lastLoginAt)}</td>` +
          `<td>${actionsHtml}</td>` +
          `</tr>`
        );
      })
      .join('');

    // Add event listeners to manage subscription buttons
    document.querySelectorAll('[data-manage-subscription]').forEach(btn => {
      btn.addEventListener('click', async () => {
        // Use btn directly from the closure rather than e.target, which can point to a child
        // element (e.g. a badge or icon inside the button) on some browsers/renderings and
        // would then lack the data attribute, silently preventing the modal from opening.
        const userId = btn.getAttribute('data-manage-subscription');
        if (userId) {
          openSubscriptionModal(userId);
        }
      });
    });

    // Add event listeners to resend buttons
    document.querySelectorAll('[data-resend-verification]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.getAttribute('data-resend-verification');
        if (!userId) {
          return;
        }

        // Use showConfirmModal instead of browser confirm
        const confirmed = await AdminShared.showConfirmModal({
          title: 'Resend Verification Email',
          message: 'Send a new verification email to this user?',
          confirmText: 'Send Email',
          cancelText: 'Cancel',
          type: 'info',
        });

        if (!confirmed) {
          return;
        }

        // Use safeAction for consistent button state management
        await AdminShared.safeAction(
          btn,
          async () => {
            const data = await AdminShared.adminFetch(
              `/api/admin/users/${userId}/resend-verification`,
              { method: 'POST' }
            );
            return data;
          },
          {
            loadingText: 'Sending...',
            successMessage: 'Verification email sent successfully',
            errorMessage: 'Failed to send verification email',
          }
        );
      });
    });

    // Add event listeners to checkboxes
    document.querySelectorAll('.user-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', e => {
        const userId = e.target.getAttribute('data-user-id');
        if (e.target.checked) {
          selectedUserIds.add(userId);
        } else {
          selectedUserIds.delete(userId);
        }
        updateBulkActionsUI();
      });
    });

    // Update "Select All" checkbox state
    updateSelectAllCheckbox();
  }

  function updateBulkActionsUI() {
    const bulkActionsBar = document.getElementById('bulkActionsBar');
    const selectedCount = document.getElementById('selectedCount');

    if (!bulkActionsBar || !selectedCount) {
      return;
    }

    if (selectedUserIds.size > 0) {
      bulkActionsBar.style.display = 'block';
      selectedCount.textContent = `${selectedUserIds.size} user${selectedUserIds.size === 1 ? '' : 's'} selected`;
    } else {
      bulkActionsBar.style.display = 'none';
    }
  }

  function updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('selectAll');
    if (!selectAllCheckbox) {
      return;
    }

    const checkboxes = document.querySelectorAll('.user-checkbox');
    const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;

    if (checkedCount === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    } else if (checkedCount === checkboxes.length) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true;
    }
  }

  function setupSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('selectAll');
    if (!selectAllCheckbox) {
      return;
    }

    selectAllCheckbox.addEventListener('change', e => {
      const checkboxes = document.querySelectorAll('.user-checkbox');
      const isChecked = e.target.checked;

      checkboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
        const userId = checkbox.getAttribute('data-user-id');
        if (isChecked) {
          selectedUserIds.add(userId);
        } else {
          selectedUserIds.delete(userId);
        }
      });

      updateBulkActionsUI();
    });
  }

  function setupBulkActions() {
    const executeBulkActionBtn = document.getElementById('executeBulkAction');
    const clearSelectionBtn = document.getElementById('clearSelection');
    const bulkActionSelect = document.getElementById('bulkActionSelect');

    if (executeBulkActionBtn) {
      executeBulkActionBtn.addEventListener('click', async () => {
        const action = bulkActionSelect?.value;
        if (!action) {
          AdminShared.showToast('Please select an action', 'error');
          return;
        }

        if (selectedUserIds.size === 0) {
          AdminShared.showToast('No users selected', 'error');
          return;
        }

        const userIds = Array.from(selectedUserIds);

        switch (action) {
          case 'delete':
            await bulkDeleteUsers(userIds);
            break;
          case 'verify':
            await bulkVerifyUsers(userIds);
            break;
          case 'suspend':
            await bulkSuspendUsers(userIds, true);
            break;
          case 'unsuspend':
            await bulkSuspendUsers(userIds, false);
            break;
          case 'export':
            await exportSelectedUsers(userIds);
            break;
          default:
            AdminShared.showToast('Unknown action', 'error');
        }
      });
    }

    if (clearSelectionBtn) {
      clearSelectionBtn.addEventListener('click', () => {
        selectedUserIds.clear();
        const checkboxes = document.querySelectorAll('.user-checkbox');
        checkboxes.forEach(cb => (cb.checked = false));
        const selectAll = document.getElementById('selectAll');
        if (selectAll) {
          selectAll.checked = false;
          selectAll.indeterminate = false;
        }
        updateBulkActionsUI();
      });
    }
  }

  async function bulkDeleteUsers(userIds) {
    const confirmed = await AdminShared.showConfirmModal({
      title: 'Delete Users',
      message: `Are you sure you want to delete ${userIds.length} user${userIds.length === 1 ? '' : 's'}? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      type: 'danger',
    });

    if (!confirmed) {
      return;
    }

    const executeBtn = document.getElementById('executeBulkAction');
    let successCount = 0;
    let failedCount = 0;
    const errors = [];

    await AdminShared.safeAction(
      executeBtn,
      async () => {
        // Process deletions sequentially to respect API rate limits
        for (const userId of userIds) {
          try {
            await AdminShared.adminFetch(`/api/admin/users/${userId}`, {
              method: 'DELETE',
            });
            successCount++;
            selectedUserIds.delete(userId);
          } catch (error) {
            failedCount++;
            errors.push(`Failed to delete user ${userId}: ${error.message}`);
          }
        }

        // Clear selection and refresh
        selectedUserIds.clear();
        await loadAdminUsers();

        return { successCount, failedCount };
      },
      {
        loadingText: 'Deleting...',
        successMessage: `Deleted ${successCount} user${successCount === 1 ? '' : 's'}${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
        errorMessage: 'Bulk delete operation failed',
        showDefaultToast: false,
      }
    );

    // Show summary
    if (successCount > 0 || failedCount > 0) {
      const message = `Deleted ${successCount} user${successCount === 1 ? '' : 's'} successfully${failedCount > 0 ? `. ${failedCount} failed.` : '.'}`;
      AdminShared.showToast(message, failedCount > 0 ? 'warning' : 'success');
    }
  }

  async function bulkVerifyUsers(userIds) {
    const confirmed = await AdminShared.showConfirmModal({
      title: 'Verify Users',
      message: `Verify ${userIds.length} user${userIds.length === 1 ? '' : 's'}?`,
      confirmText: 'Verify',
      cancelText: 'Cancel',
      type: 'info',
    });

    if (!confirmed) {
      return;
    }

    const executeBtn = document.getElementById('executeBulkAction');

    await AdminShared.safeAction(
      executeBtn,
      async () => {
        const result = await AdminShared.adminFetch('/api/admin/users/bulk-verify', {
          method: 'POST',
          body: { userIds },
        });

        // Clear selection and refresh
        selectedUserIds.clear();
        await loadAdminUsers();

        return result;
      },
      {
        loadingText: 'Verifying...',
        successMessage: data => {
          return `Verified ${data.verifiedCount} user${data.verifiedCount === 1 ? '' : 's'}${data.alreadyVerifiedCount > 0 ? ` (${data.alreadyVerifiedCount} already verified)` : ''}`;
        },
        errorMessage: 'Failed to verify users',
      }
    );
  }

  async function bulkSuspendUsers(userIds, suspend = true) {
    const action = suspend ? 'Suspend' : 'Unsuspend';

    let reason = '';
    let duration = '';

    if (suspend) {
      // Ask for reason and duration
      const reasonResult = await AdminShared.showInputModal({
        title: 'Suspension Reason',
        message: 'Please provide a reason for suspending these users',
        label: 'Reason',
        placeholder: 'e.g., Terms of service violation',
        required: false,
        type: 'textarea',
      });

      if (!reasonResult.confirmed) {
        return;
      }
      reason = reasonResult.value || 'Bulk suspension';

      const durationResult = await AdminShared.showInputModal({
        title: 'Suspension Duration',
        message: 'Enter duration (e.g., "7d", "30d", "1y") or leave blank for permanent',
        label: 'Duration',
        placeholder: 'e.g., 7d, 30d, 1y',
        required: false,
      });

      if (!durationResult.confirmed) {
        return;
      }
      duration = durationResult.value || '';
    }

    const confirmed = await AdminShared.showConfirmModal({
      title: `${action} Users`,
      message: `${action} ${userIds.length} user${userIds.length === 1 ? '' : 's'}?`,
      confirmText: action,
      cancelText: 'Cancel',
      type: suspend ? 'warning' : 'info',
    });

    if (!confirmed) {
      return;
    }

    const executeBtn = document.getElementById('executeBulkAction');

    await AdminShared.safeAction(
      executeBtn,
      async () => {
        const result = await AdminShared.adminFetch('/api/admin/users/bulk-suspend', {
          method: 'POST',
          body: { userIds, suspended: suspend, reason, duration },
        });

        // Clear selection and refresh
        selectedUserIds.clear();
        await loadAdminUsers();

        return result;
      },
      {
        loadingText: `${suspend ? 'Suspending' : 'Unsuspending'}...`,
        successMessage: data => {
          return `${suspend ? 'Suspended' : 'Unsuspended'} ${data.updatedCount} user${data.updatedCount === 1 ? '' : 's'}`;
        },
        errorMessage: `Failed to ${suspend ? 'suspend' : 'unsuspend'} users`,
      }
    );
  }

  async function exportSelectedUsers(userIds) {
    try {
      // Get full user data
      const selectedUsers = allUsers.filter(u => userIds.includes(u.id || u._id));

      if (selectedUsers.length === 0) {
        AdminShared.showToast('No users to export', 'error');
        return;
      }

      // Create CSV content
      const headers = [
        'Name',
        'Email',
        'Role',
        'Subscription',
        'Verified',
        'Marketing Opt-In',
        'Joined',
        'Last Login',
      ];
      const rows = selectedUsers.map(u => [
        u.name || '',
        u.email || '',
        u.role || '',
        u.subscription?.tier || 'free',
        u.verified ? 'Yes' : 'No',
        u.marketingOptIn ? 'Yes' : 'No',
        u.createdAt || '',
        u.lastLoginAt || '',
      ]);

      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      // Create and download file
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `users-export-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      AdminShared.showToast(
        `Exported ${selectedUsers.length} user${selectedUsers.length === 1 ? '' : 's'}`,
        'success'
      );
    } catch (error) {
      AdminShared.debugError('Export error:', error);
      AdminShared.showToast('Failed to export users', 'error');
    }
  }

  function setupFilterListeners() {
    const searchInput = document.getElementById('userSearch');
    const roleFilter = document.getElementById('roleFilter');
    const subscriptionFilter = document.getElementById('subscriptionFilter');
    const verifiedFilter = document.getElementById('verifiedFilter');
    const clearBtn = document.getElementById('clearFilters');

    // Debounced search for better performance
    if (searchInput) {
      if (window.AdminShared && window.AdminShared.debounce) {
        const debouncedRender = window.AdminShared.debounce(renderUsers, 300);
        searchInput.addEventListener('input', debouncedRender);
      } else {
        searchInput.addEventListener('input', renderUsers);
      }
    }

    if (roleFilter) {
      roleFilter.addEventListener('change', renderUsers);
    }

    if (subscriptionFilter) {
      subscriptionFilter.addEventListener('change', renderUsers);
    }

    if (verifiedFilter) {
      verifiedFilter.addEventListener('change', renderUsers);
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
        }
        if (roleFilter) {
          roleFilter.value = '';
        }
        if (subscriptionFilter) {
          subscriptionFilter.value = '';
        }
        if (verifiedFilter) {
          verifiedFilter.value = '';
        }
        renderUsers();
      });
    }
  }

  // Subscription Modal Management
  let currentSubscriptionUserId = null;

  /**
   * Returns a human-readable countdown string for a subscription end date.
   * e.g. "Expires in 28 days", "Expired 3 days ago", "Expires today"
   */
  function expiryCountdown(endDateStr) {
    if (!endDateStr) {
      return null;
    }
    try {
      const now = new Date();
      const end = new Date(endDateStr);
      const diffMs = end.getTime() - now.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        const absDays = Math.abs(diffDays);
        return { label: `Expired ${absDays} day${absDays === 1 ? '' : 's'} ago`, expired: true };
      }
      if (diffDays === 0) {
        return { label: 'Expires today', urgent: true };
      }
      if (diffDays <= 7) {
        return { label: `Expires in ${diffDays} day${diffDays === 1 ? '' : 's'}`, urgent: true };
      }
      return { label: `Expires in ${diffDays} day${diffDays === 1 ? '' : 's'}`, expired: false };
    } catch (_) {
      return null;
    }
  }

  /**
   * Returns CSS class name for a history action type.
   */
  function historyActionClass(action) {
    const map = {
      granted: 'sub-action--granted',
      renewed: 'sub-action--renewed',
      upgraded: 'sub-action--upgraded',
      downgraded: 'sub-action--downgraded',
      cancelled: 'sub-action--cancelled',
      removed: 'sub-action--cancelled',
    };
    return map[action] || 'sub-action--default';
  }

  /**
   * Render tier label from tier string.
   */
  function tierLabel(tier) {
    if (tier === 'pro_plus') {
      return 'Pro+';
    }
    if (tier === 'pro') {
      return 'Pro';
    }
    return 'Free';
  }

  function openSubscriptionModal(userId) {
    currentSubscriptionUserId = userId;
    const modal = document.getElementById('subscriptionModal');
    if (!modal) {
      console.error(
        '[AdminUsers] #subscriptionModal not found in DOM. Cannot open subscription modal.'
      );
      return;
    }

    // Show the modal. components.css uses opacity:0/visibility:hidden on .modal-overlay and
    // only reveals it with the .active class. Setting display alone is not enough.
    modal.style.display = 'flex';
    modal.classList.add('active');

    const userIdInput = document.getElementById('subscriptionUserId');
    if (userIdInput) {
      userIdInput.value = userId;
    } else {
      console.error('[AdminUsers] #subscriptionUserId not found in DOM.');
    }

    // Update modal title with user context
    const user = allUsers.find(u => (u.id || u._id) === userId);
    const titleEl = document.getElementById('subscriptionModalTitle');
    const subtitleEl = document.getElementById('subscriptionModalSubtitle');
    if (titleEl) {
      titleEl.textContent = user
        ? `Manage Subscription — ${user.name || user.email}`
        : 'Manage Subscription';
    }
    if (subtitleEl) {
      subtitleEl.textContent = user && user.name && user.email ? user.email : '';
    }

    // Load current subscription status and history (always live from API)
    loadSubscriptionData(userId);
  }

  function closeSubscriptionModal() {
    const modal = document.getElementById('subscriptionModal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
    currentSubscriptionUserId = null;

    // Reset form
    const form = document.getElementById('subscriptionForm');
    if (form) {
      form.reset();
    }
  }

  async function loadSubscriptionData(userId) {
    const statusDiv = document.getElementById('currentSubscriptionStatus');
    const historyDiv = document.getElementById('subscriptionHistory');

    if (!statusDiv || !historyDiv) {
      console.error(
        '[AdminUsers] Missing required DOM elements: #currentSubscriptionStatus or #subscriptionHistory. Cannot render subscription data.'
      );
      return;
    }

    // Show skeleton loading states while fetching
    statusDiv.innerHTML =
      '<div class="sub-status-skeleton"><div class="skeleton-list-item" style="height:72px;border-radius:10px;"></div></div>';
    historyDiv.innerHTML = '<div class="text-muted" style="padding:8px 0;">Loading history…</div>';

    try {
      // Single API call returns both currentSubscription and history (newest-first)
      const data = await AdminShared.api(`/api/admin/users/${userId}/subscription-history`);
      const subscription = data.currentSubscription || { tier: 'free', status: 'active' };
      const history = data.history || [];

      // ── Current status card ───────────────────────────────────────────────────
      const tier = subscription.tier || 'free';
      const tLabel = tierLabel(tier);
      const isFree = tier === 'free';
      const isCancelled = subscription.status === 'cancelled';
      const statusBadgeClass = isFree || isCancelled ? 'badge-secondary' : 'badge-success';
      const statusText = isCancelled ? 'Cancelled' : subscription.status || 'Active';
      const cardClass =
        isFree || isCancelled
          ? 'subscription-status-card subscription-status-card--free'
          : `subscription-status-card subscription-status-card--${tier.replace('_', '-')}`;
      const countdown = expiryCountdown(subscription.endDate);
      const countdownHtml = countdown
        ? `<div class="sub-countdown ${countdown.expired ? 'sub-countdown--expired' : countdown.urgent ? 'sub-countdown--urgent' : ''}">
             <span class="sub-countdown-icon">${countdown.expired ? '⚠️' : '🕐'}</span>
             ${escapeHtml(countdown.label)}
           </div>`
        : subscription.endDate === null && !isFree
          ? '<div class="sub-countdown sub-countdown--lifetime">♾️ Lifetime</div>'
          : '';

      statusDiv.innerHTML = `
        <div class="${cardClass}">
          <div class="sub-status-top-row">
            <div class="sub-tier-info">
              <span class="sub-tier-icon">${tier === 'pro_plus' ? '⭐' : tier === 'pro' ? '✦' : '○'}</span>
              <span class="sub-tier-name">${escapeHtml(tLabel)}</span>
            </div>
            <span class="badge ${statusBadgeClass}">${escapeHtml(statusText)}</span>
          </div>
          ${subscription.startDate ? `<div class="sub-status-row"><span class="sub-label">Since:</span> <span>${formatDate(subscription.startDate)}</span></div>` : ''}
          ${subscription.endDate ? `<div class="sub-status-row"><span class="sub-label">Until:</span> <span>${formatDate(subscription.endDate)}</span></div>` : ''}
          ${countdownHtml}
          ${subscription.reason ? `<div class="sub-status-row sub-status-reason"><span class="sub-label">Reason:</span> <span class="text-muted">${escapeHtml(subscription.reason)}</span></div>` : ''}
        </div>
      `;

      // Update allUsers cache so table badge reflects latest without a full reload
      const cachedUser = allUsers.find(u => (u.id || u._id) === userId);
      if (cachedUser) {
        cachedUser.subscription = subscription;
      }

      // ── History list ─────────────────────────────────────────────────────────
      if (history.length === 0) {
        historyDiv.innerHTML =
          '<p class="text-muted" style="padding:4px 0;">No subscription history found.</p>';
      } else {
        historyDiv.innerHTML = history
          .map(
            h => `
            <div class="subscription-history-item">
              <div class="sub-history-header">
                <span class="sub-action-badge ${historyActionClass(h.action)}">${escapeHtml(h.action || 'changed')}</span>
                <span class="sub-history-tier">${escapeHtml(tierLabel(h.tier))}</span>
                <span class="sub-history-date text-muted">${formatDate(h.date)}</span>
              </div>
              <div class="text-muted sub-history-meta">
                By: ${escapeHtml(h.adminEmail || 'Unknown')}
                ${h.reason ? ` · ${escapeHtml(h.reason)}` : ''}
                ${h.endDate ? ` · Ends: ${formatDate(h.endDate)}` : ''}
              </div>
            </div>
          `
          )
          .join('');
      }
    } catch (error) {
      AdminShared.debugError('Error loading subscription data:', error);
      statusDiv.innerHTML = '<p class="text-error">Failed to load subscription status</p>';
      historyDiv.innerHTML = '<p class="text-error">Failed to load subscription history</p>';
    }
  }

  function setupSubscriptionModal() {
    const closeBtn = document.getElementById('closeSubscriptionModal');
    const cancelBtn = document.getElementById('cancelSubscriptionBtn');
    const form = document.getElementById('subscriptionForm');
    const removeBtn = document.getElementById('removeSubscriptionBtn');
    const modal = document.getElementById('subscriptionModal');

    // Close modal handlers
    if (closeBtn) {
      closeBtn.addEventListener('click', closeSubscriptionModal);
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', closeSubscriptionModal);
    }

    // Click outside to close
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) {
          closeSubscriptionModal();
        }
      });
    }

    // Handle tier change - hide duration if free is selected
    const tierSelect = document.getElementById('subscriptionTier');
    const durationGroup = document.getElementById('subscriptionDurationGroup');

    if (tierSelect && durationGroup) {
      tierSelect.addEventListener('change', e => {
        if (e.target.value === 'free' || e.target.value === '') {
          durationGroup.style.display = 'none';
          document.getElementById('subscriptionDuration').removeAttribute('required');
        } else {
          durationGroup.style.display = 'block';
          document.getElementById('subscriptionDuration').setAttribute('required', 'required');
        }
      });
    }

    // Form submission
    if (form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();

        const userId = document.getElementById('subscriptionUserId').value;
        const tier = document.getElementById('subscriptionTier').value;
        const duration = document.getElementById('subscriptionDuration').value;
        const reason = document.getElementById('subscriptionReason').value;

        if (!userId) {
          AdminShared.showToast('No user selected', 'error');
          return;
        }

        // If tier is free, remove subscription instead
        if (tier === 'free') {
          const confirmed = await AdminShared.showConfirmModal({
            title: 'Remove Subscription',
            message: 'This will remove the current subscription. Continue?',
            confirmText: 'Remove',
            cancelText: 'Cancel',
            type: 'warning',
          });

          if (!confirmed) {
            return;
          }

          const submitBtn = form.querySelector('button[type="submit"]');
          await AdminShared.safeAction(
            submitBtn,
            async () => {
              const data = await AdminShared.adminFetch(`/api/admin/users/${userId}/subscription`, {
                method: 'DELETE',
                body: { reason: reason || 'Admin set to free tier' },
              });
              // Reload status panel inside the modal to reflect the change
              await loadSubscriptionData(userId);
              // Update table row badge without a full reload
              _updateTableSubscriptionBadge(userId, { tier: 'free', status: 'cancelled' });
              return data;
            },
            {
              loadingText: 'Removing...',
              successMessage: 'Subscription removed successfully',
              errorMessage: 'Failed to remove subscription',
            }
          );
          return;
        }

        if (!tier || !duration) {
          AdminShared.showToast('Please select both tier and duration', 'error');
          return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        await AdminShared.safeAction(
          submitBtn,
          async () => {
            const data = await AdminShared.adminFetch(`/api/admin/users/${userId}/subscription`, {
              method: 'POST',
              body: { tier, duration, reason },
            });
            // Reload status panel inside the modal to reflect the new subscription
            await loadSubscriptionData(userId);
            // Update table row badge without a full reload
            if (data && data.subscription) {
              _updateTableSubscriptionBadge(userId, data.subscription);
            }
            return data;
          },
          {
            loadingText: 'Granting...',
            successMessage: 'Subscription granted successfully',
            errorMessage: 'Failed to grant subscription',
          }
        );
      });
    }

    // Remove subscription button
    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        if (!currentSubscriptionUserId) {
          AdminShared.showToast('No user selected', 'error');
          return;
        }

        // Use modal for reason input instead of prompt
        const confirmed = await AdminShared.showConfirmModal({
          title: 'Remove Subscription',
          message:
            'Are you sure you want to remove this subscription? This action cannot be undone.',
          confirmText: 'Remove',
          cancelText: 'Cancel',
          type: 'danger',
        });

        if (!confirmed) {
          return;
        }

        const reasonResult = await AdminShared.showInputModal({
          title: 'Removal Reason',
          message: 'Please provide a reason for removing this subscription',
          label: 'Reason',
          placeholder: 'e.g., Requested by user, Payment issue, etc.',
          required: false,
          type: 'textarea',
        });

        if (!reasonResult.confirmed) {
          return; // Cancelled
        }

        await AdminShared.safeAction(
          removeBtn,
          async () => {
            const data = await AdminShared.adminFetch(
              `/api/admin/users/${currentSubscriptionUserId}/subscription`,
              {
                method: 'DELETE',
                body: { reason: reasonResult.value || 'Manual admin removal' },
              }
            );
            // Reload status panel inside the modal to reflect the removal
            await loadSubscriptionData(currentSubscriptionUserId);
            // Update table row badge
            _updateTableSubscriptionBadge(currentSubscriptionUserId, {
              tier: 'free',
              status: 'cancelled',
            });
            return data;
          },
          {
            loadingText: 'Removing...',
            successMessage: 'Subscription removed successfully',
            errorMessage: 'Failed to remove subscription',
          }
        );
      });
    }
  }

  /**
   * Updates the subscription badge for a specific user row in the table without
   * performing a full reload. This gives the admin instant visual feedback.
   */
  function _updateTableSubscriptionBadge(userId, subscription) {
    const tier = subscription?.tier || 'free';
    let badgeHtml = '';
    if (tier === 'pro') {
      badgeHtml = '<span class="badge badge-pro">Pro</span>';
    } else if (tier === 'pro_plus') {
      badgeHtml = '<span class="badge badge-pro-plus">Pro+</span>';
    } else {
      badgeHtml = '<span class="badge badge-free">Free</span>';
    }
    // Find the table row for this user and update the subscription cell (column index 4)
    const btn = document.querySelector(`[data-manage-subscription="${CSS.escape(userId)}"]`);
    if (btn) {
      const row = btn.closest('tr');
      if (row) {
        const cells = row.querySelectorAll('td');
        if (cells[4]) {
          cells[4].innerHTML = badgeHtml;
        }
      }
    }
    // Also update allUsers cache
    const cachedUser = allUsers.find(u => (u.id || u._id) === userId);
    if (cachedUser) {
      cachedUser.subscription = subscription;
    }
  }

  // Load when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadAdminUsers();
      setupFilterListeners();
      setupSubscriptionModal();
      setupSelectAllCheckbox();
      setupBulkActions();
    });
  } else {
    loadAdminUsers();
    setupFilterListeners();
    setupSubscriptionModal();
    setupSelectAllCheckbox();
    setupBulkActions();
  }
})();
