// Supplier Management Page Initialization
(function () {
  let allSuppliers = [];
  let filteredSuppliers = [];
  const selectedSuppliers = new Set();
  let currentPage = 1;
  const itemsPerPage = 20;

  // Initialize page
  async function init() {
    await loadAutoApproveVerificationFlag();
    await loadSuppliers();
    setupEventListeners();
    renderTable();
  }

  // ── Auto-approve supplier verification toggle ─────────────────────────────
  let autoApproveVerification = false; // default off (safer)

  async function loadAutoApproveVerificationFlag() {
    try {
      const data = await AdminShared.api('/api/admin/settings/features');
      autoApproveVerification = data.autoApproveSupplierVerification === true;
    } catch (err) {
      console.error('Failed to load feature flags:', err);
      autoApproveVerification = false;
    }
    updateVerificationToggleUI(autoApproveVerification);
  }

  function updateVerificationToggleUI(isOn) {
    const toggleEl = document.getElementById('autoApproveVerificationToggle');
    const labelEl = document.getElementById('verificationToggleStateLabel');
    if (toggleEl) {
      toggleEl.checked = isOn;
    }
    if (labelEl) {
      labelEl.textContent = isOn ? 'ON' : 'OFF';
      labelEl.className = `ap-toggle-state ${isOn ? 'ap-toggle-state--on' : 'ap-toggle-state--off'}`;
    }
  }

  async function saveAutoApproveVerificationFlag(newValue) {
    try {
      await AdminShared.adminFetch('/api/admin/settings/features', {
        method: 'PUT',
        body: { autoApproveSupplierVerification: newValue },
      });
      autoApproveVerification = newValue;
      updateVerificationToggleUI(autoApproveVerification);
      showToast(`Auto-approve new suppliers ${newValue ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      console.error('Failed to save feature flag:', err);
      showToast('Failed to update auto-approve setting', 'error');
      updateVerificationToggleUI(autoApproveVerification);
    }
  }

  // Load suppliers data
  async function loadSuppliers() {
    try {
      const suppliersData = await AdminShared.api('/api/admin/suppliers');
      // API may return data.items or data.suppliers - accept both for compatibility
      allSuppliers = suppliersData.items || suppliersData.suppliers || [];

      // Calculate health scores for all suppliers
      allSuppliers = await Promise.all(
        allSuppliers.map(async supplier => {
          const healthData = await calculateSupplierHealth(supplier);
          return {
            ...supplier,
            healthScore: healthData.score,
            healthBreakdown: healthData.breakdown,
          };
        })
      );

      filteredSuppliers = [...allSuppliers];

      updateStats();
    } catch (error) {
      console.error('Error loading suppliers:', error);
      showToast(`Failed to load suppliers: ${error.message}`, 'error');
      // Show error state in table
      const tbody = document.getElementById('suppliersTableBody');
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="9" style="text-align: center; padding: 40px; color: #ef4444;">⚠️ Error loading suppliers. Please refresh the page.</td></tr>';
      }
    }
  }

  // Calculate supplier health score
  function calculateSupplierHealth(supplier) {
    let score = 0;
    const breakdown = {};

    // Profile completeness (0-30)
    const profileFields = ['name', 'description', 'location', 'category', 'priceRange'];
    const completedFields = profileFields.filter(
      f => supplier[f] && supplier[f].toString().trim()
    ).length;
    const profileScore = (completedFields / profileFields.length) * 30;
    score += profileScore;
    breakdown.profileCompleteness = {
      score: Math.round(profileScore),
      weight: 30,
      completedFields,
      totalFields: profileFields.length,
    };

    // Response rate (0-25) - default to 0 if not available
    const responseRate = supplier.responseRate || 0;
    const responseScore = responseRate * 25;
    score += responseScore;
    breakdown.responseRate = {
      score: Math.round(responseScore),
      weight: 25,
      rate: Math.round(responseRate * 100),
    };

    // Review rating (0-20)
    const averageRating = supplier.averageRating || supplier.rating || 0;
    const ratingScore = (averageRating / 5) * 20;
    score += ratingScore;
    breakdown.reviewRating = {
      score: Math.round(ratingScore),
      weight: 20,
      rating: averageRating.toFixed(1),
    };

    // Booking count (0-15)
    const bookingCount = supplier.bookingCount || supplier.bookings?.length || 0;
    const bookingScore = Math.min(bookingCount / 10, 1) * 15;
    score += bookingScore;
    breakdown.bookingCount = {
      score: Math.round(bookingScore),
      weight: 15,
      count: bookingCount,
    };

    // Photo count (0-10)
    const photoCount = supplier.photoCount || supplier.photosGallery?.length || 0;
    const photoScore = Math.min(photoCount / 10, 1) * 10;
    score += photoScore;
    breakdown.photoCount = {
      score: Math.round(photoScore),
      weight: 10,
      count: photoCount,
    };

    return {
      score: Math.round(score),
      breakdown,
    };
  }

  // Get health score badge HTML
  function getHealthScoreBadge(score, breakdown) {
    let color, bgColor, label;

    if (score >= 80) {
      color = '#10b981';
      bgColor = '#d1fae5';
      label = 'Excellent';
    } else if (score >= 60) {
      color = '#f59e0b';
      bgColor = '#fef3c7';
      label = 'Good';
    } else if (score >= 40) {
      color = '#f97316';
      bgColor = '#fed7aa';
      label = 'Fair';
    } else {
      color = '#ef4444';
      bgColor = '#fee2e2';
      label = 'Poor';
    }

    const breakdownHtml = breakdown
      ? `
      <div style="text-align: left; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2);">
        <div style="font-size: 11px; margin-bottom: 4px;">Profile: ${breakdown.profileCompleteness.score}/${breakdown.profileCompleteness.weight} (${breakdown.profileCompleteness.completedFields}/${breakdown.profileCompleteness.totalFields} fields)</div>
        <div style="font-size: 11px; margin-bottom: 4px;">Response: ${breakdown.responseRate.score}/${breakdown.responseRate.weight} (${breakdown.responseRate.rate}%)</div>
        <div style="font-size: 11px; margin-bottom: 4px;">Rating: ${breakdown.reviewRating.score}/${breakdown.reviewRating.weight} (${breakdown.reviewRating.rating}/5)</div>
        <div style="font-size: 11px; margin-bottom: 4px;">Bookings: ${breakdown.bookingCount.score}/${breakdown.bookingCount.weight} (${breakdown.bookingCount.count})</div>
        <div style="font-size: 11px;">Photos: ${breakdown.photoCount.score}/${breakdown.photoCount.weight} (${breakdown.photoCount.count})</div>
      </div>
    `
      : '';

    return `
      <div class="health-score-badge" style="position: relative; display: inline-block; cursor: help;">
        <span style="display: inline-block; padding: 4px 12px; border-radius: 12px; font-weight: 600; font-size: 14px; color: ${color}; background: ${bgColor};">
          ${score}%
        </span>
        <div class="health-score-tooltip" style="display: none; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.9); color: white; padding: 12px; border-radius: 8px; white-space: nowrap; z-index: 1000; margin-bottom: 8px; min-width: 250px;">
          <div style="font-weight: 600; margin-bottom: 8px;">Quality Score: ${score}% (${label})</div>
          <div style="font-size: 11px; margin-bottom: 8px; color: rgba(255,255,255,0.7);">Blends profile completeness with activity (response rate, reviews, bookings). Not the same as the supplier's own Profile Health completeness score.</div>
          ${breakdownHtml}
        </div>
      </div>
    `;
  }

  // Helper: derive the effective subscription tier for a supplier.
  // admin-user-management.js stores subscription.tier (rich model, supports pro_plus).
  // supplier-admin.js /pro endpoint stores isPro boolean (legacy model).
  // Both are kept in sync — subscription.tier is the source of truth when present.
  function getEffectiveSubscriptionTier(supplier) {
    const tier = supplier.subscription?.tier;
    if (tier && tier !== 'free' && tier !== 'cancelled') {
      return tier; // 'pro' or 'pro_plus' from rich model
    }
    return supplier.isPro ? 'pro' : 'free';
  }

  // Helper: falling back gracefully for records without a verificationStatus field.
  function getEffectiveVerificationStatus(supplier) {
    return supplier.verificationStatus || (supplier.verified ? 'approved' : 'unverified');
  }

  // Update statistics
  function updateStats() {
    const total = allSuppliers.length;
    const pending = allSuppliers.filter(s => {
      const vs = getEffectiveVerificationStatus(s);
      return vs === 'pending_review' || vs === 'unverified';
    }).length;
    const pro = allSuppliers.filter(s => getEffectiveSubscriptionTier(s) !== 'free').length;
    const avgScore = allSuppliers.reduce((sum, s) => sum + (s.healthScore || 0), 0) / total || 0;

    document.getElementById('totalSuppliers').textContent = total;
    document.getElementById('pendingSuppliers').textContent = pending;
    document.getElementById('proSuppliers').textContent = pro;
    document.getElementById('avgScore').textContent = `${avgScore.toFixed(1)}%`;
  }

  // Setup event listeners
  function setupEventListeners() {
    // Search
    document.getElementById('searchInput')?.addEventListener('input', handleFilters);

    // Filters
    document.getElementById('approvalFilter')?.addEventListener('change', handleFilters);
    document.getElementById('categoryFilter')?.addEventListener('change', handleFilters);
    document.getElementById('subscriptionFilter')?.addEventListener('change', handleFilters);
    document.getElementById('verificationFilter')?.addEventListener('change', handleFilters);
    document.getElementById('clearFiltersBtn')?.addEventListener('click', clearFilters);

    // Bulk actions
    document.getElementById('selectAll')?.addEventListener('change', toggleSelectAll);
    document
      .getElementById('bulkApproveBtn')
      ?.addEventListener('click', () => bulkAction('approve'));
    document.getElementById('bulkRejectBtn')?.addEventListener('click', () => bulkAction('reject'));
    document.getElementById('bulkDeleteBtn')?.addEventListener('click', () => bulkAction('delete'));
    document.getElementById('smartTagBtn')?.addEventListener('click', smartTag);

    // Pagination
    document.getElementById('prevPageBtn')?.addEventListener('click', () => changePage(-1));
    document.getElementById('nextPageBtn')?.addEventListener('click', () => changePage(1));

    // Export and Import
    document.getElementById('exportSuppliersBtn')?.addEventListener('click', exportSuppliers);
    document
      .getElementById('importDemoSuppliersBtn')
      ?.addEventListener('click', importDemoSuppliers);

    // Auto-approve supplier verification toggle
    const verificationToggleEl = document.getElementById('autoApproveVerificationToggle');
    if (verificationToggleEl) {
      verificationToggleEl.addEventListener('change', async () => {
        const newValue = verificationToggleEl.checked;
        verificationToggleEl.disabled = true;
        await saveAutoApproveVerificationFlag(newValue);
        verificationToggleEl.disabled = false;
      });
    }

    // Delegated click handler for table row action buttons (CSP-safe: no inline onclick)
    const tbody = document.getElementById('suppliersTableBody');
    if (tbody) {
      tbody.addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) {
          return;
        }
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (!id) {
          return;
        }
        switch (action) {
          case 'view':
            window.viewSupplier(id);
            break;
          case 'edit':
            window.editSupplier(id);
            break;
          case 'approve':
            window.approveSupplier(id);
            break;
          case 'reject':
            window.rejectSupplier(id);
            break;
          case 'delete':
            window.deleteSupplier(id);
            break;
          case 'grantSubscription':
            window.grantSubscription(id);
            break;
          case 'removeSubscription':
            window.removeSubscription(id);
            break;
        }
      });

      // Delegated change handler for row checkboxes (CSP-safe: no inline onchange)
      tbody.addEventListener('change', e => {
        const checkbox = e.target.closest('input[type="checkbox"][data-action="toggleSelect"]');
        if (!checkbox) {
          return;
        }
        const id = checkbox.dataset.id;
        if (id) {
          window.toggleSupplierSelection(id);
        }
      });
    }
  }

  // Handle filters
  function handleFilters() {
    const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const approval = document.getElementById('approvalFilter')?.value || 'all';
    const category = document.getElementById('categoryFilter')?.value || 'all';
    const subscription = document.getElementById('subscriptionFilter')?.value || 'all';
    const verification = document.getElementById('verificationFilter')?.value || 'all';

    filteredSuppliers = allSuppliers.filter(supplier => {
      const matchesSearch =
        supplier.name?.toLowerCase().includes(search) ||
        supplier.email?.toLowerCase().includes(search);

      const matchesApproval =
        approval === 'all' ||
        (approval === 'approved' && supplier.approved) ||
        (approval === 'pending' &&
          !supplier.approved &&
          supplier.verificationStatus !== 'rejected') ||
        (approval === 'rejected' &&
          (supplier.rejected || supplier.verificationStatus === 'rejected'));

      const matchesCategory = category === 'all' || supplier.category === category;

      const supplierTier = getEffectiveSubscriptionTier(supplier);
      const matchesSubscription =
        subscription === 'all' ||
        (subscription === 'pro' && supplierTier !== 'free') ||
        (subscription === 'free' && supplierTier === 'free');

      const supplierVerification = getEffectiveVerificationStatus(supplier);
      const matchesVerification = verification === 'all' || supplierVerification === verification;

      return (
        matchesSearch &&
        matchesApproval &&
        matchesCategory &&
        matchesSubscription &&
        matchesVerification
      );
    });

    currentPage = 1;
    renderTable();
  }

  // Clear filters
  function clearFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('approvalFilter').value = 'all';
    document.getElementById('categoryFilter').value = 'all';
    document.getElementById('subscriptionFilter').value = 'all';
    document.getElementById('verificationFilter').value = 'all';
    handleFilters();
  }

  // Render table
  function renderTable() {
    const tbody = document.getElementById('suppliersTableBody');
    if (!tbody) {
      return;
    }

    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageSuppliers = filteredSuppliers.slice(start, end);

    if (pageSuppliers.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="9" style="text-align: center; padding: 40px; color: #9ca3af;">No suppliers found</td></tr>';
      updatePagination();
      return;
    }

    tbody.innerHTML = pageSuppliers
      .map(supplier => {
        const isSelected = selectedSuppliers.has(supplier.id);
        const subscriptionBadge = getSubscriptionBadge(getEffectiveSubscriptionTier(supplier));
        const healthScoreBadge = getHealthScoreBadge(
          supplier.healthScore || 0,
          supplier.healthBreakdown
        );

        const verificationBadge = getVerificationBadge(getEffectiveVerificationStatus(supplier));

        // Show approval status based on supplier's actual approval/verification state
        const effectiveStatus = getEffectiveVerificationStatus(supplier);
        const isPendingReview = effectiveStatus === 'pending_review';
        const approvalCell = supplier.approved
          ? '<span style="color: #10b981;">✓ Approved</span>'
          : isPendingReview
            ? '<span style="color: #f59e0b;">Pending</span><br><span style="font-size:10px;background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:999px;padding:1px 6px;white-space:nowrap;">🔍 Awaiting review</span>'
            : '<span style="color: #9ca3af;">Unapproved</span>';

        // Orphaned supplier — owner account has been deleted; flagged for admin attention
        const orphanBadge = supplier._ownerDeleted
          ? ' <span title="Owner account deleted — hidden from all public pages. Delete it to clean up." style="font-size:10px;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:999px;padding:1px 6px;white-space:nowrap;cursor:help;">⚠️ Owner deleted</span>'
          : '';

        return `
        <tr${supplier._ownerDeleted ? ' style="opacity:0.75;background:#fff7f7;"' : ''}>
          <td><input type="checkbox" aria-label="Select ${escapeHtml(supplier.name || 'supplier')}" ${isSelected ? 'checked' : ''} data-action="toggleSelect" data-id="${escapeHtml(supplier.id)}"></td>
          <td><a href="/admin-supplier-detail?id=${escapeHtml(supplier.id)}" style="color: #667eea; font-weight: 500;">${escapeHtml(supplier.name || 'Unknown')}</a>${orphanBadge}</td>
          <td>${escapeHtml(supplier.email || '')}</td>
          <td>${approvalCell}</td>
          <td>${verificationBadge}</td>
          <td>${subscriptionBadge}</td>
          <td>${healthScoreBadge}</td>
          <td><span style="font-size: 12px; color: #6b7280;">${escapeHtml(supplier.tags?.join(', ') || 'None')}</span></td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <div style="display: flex; gap: 8px;">
                <button data-action="view" data-id="${escapeHtml(supplier.id)}" class="ef-cta btn-xs" title="View Profile">👁️</button>
                <button data-action="edit" data-id="${escapeHtml(supplier.id)}" class="ef-cta btn-xs" title="Edit">✏️</button>
                ${
                  !supplier.approved
                    ? [
                        `<button data-action="approve" data-id="${escapeHtml(supplier.id)}" class="ef-cta btn-xs" style="background: #10b981; color: white;" title="Approve supplier">✓ Approve</button>`,
                        `<button data-action="reject" data-id="${escapeHtml(supplier.id)}" class="ef-cta btn-xs" style="background: #ef4444; color: white;" title="Reject supplier">✗ Reject</button>`,
                      ].join('')
                    : ''
                }
                <button data-action="delete" data-id="${escapeHtml(supplier.id)}" class="ef-cta btn-xs" style="background: #6b7280; color: white;" title="Delete">🗑️</button>
              </div>
              <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
                <select id="sub-tier-${escapeHtml(supplier.id)}" class="btn-xs" style="padding: 2px 4px; font-size: 11px;" title="Subscription tier">
                  <option value="pro">Pro</option>
                  <option value="pro_plus">Pro+</option>
                </select>
                <select id="sub-dur-${escapeHtml(supplier.id)}" class="btn-xs" style="padding: 2px 4px; font-size: 11px;" title="Duration">
                  <option value="7">7 days</option>
                  <option value="30" selected>30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                </select>
                <button data-action="grantSubscription" data-id="${escapeHtml(supplier.id)}" class="ef-cta btn-xs" style="background: #667eea; color: white; font-size: 11px;" title="Grant subscription">Grant</button>
                <button data-action="removeSubscription" data-id="${escapeHtml(supplier.id)}" class="ef-cta btn-xs" style="background: #6b7280; color: white; font-size: 11px;" title="Remove subscription">Remove</button>
              </div>
            </div>
          </td>
        </tr>
      `;
      })
      .join('');

    updatePagination();
    updateBulkActionsBar();

    // Setup tooltip hover listeners
    setupHealthScoreTooltips();
  }

  // Setup health score tooltips
  function setupHealthScoreTooltips() {
    document.querySelectorAll('.health-score-badge').forEach(badge => {
      badge.addEventListener('mouseenter', function () {
        const tooltip = this.querySelector('.health-score-tooltip');
        if (tooltip) {
          tooltip.style.display = 'block';
        }
      });
      badge.addEventListener('mouseleave', function () {
        const tooltip = this.querySelector('.health-score-tooltip');
        if (tooltip) {
          tooltip.style.display = 'none';
        }
      });
    });
  }

  // Get subscription badge HTML
  function getSubscriptionBadge(tier) {
    const badges = {
      free: '<span class="badge badge-starter">Starter</span>',
      pro: '<span class="badge badge-pro">Pro</span>',
      pro_plus: '<span class="badge badge-pro-plus">Pro Plus</span>',
    };
    return badges[tier] || badges.free;
  }

  // Get verification status badge HTML
  function getVerificationBadge(status) {
    const STYLES = {
      unverified: 'background:#e5e7eb;color:#374151',
      pending_review: 'background:#fef3c7;color:#92400e',
      needs_changes: 'background:#fed7aa;color:#9a3412',
      approved: 'background:#d1fae5;color:#065f46',
      verified: 'background:#d1fae5;color:#065f46',
      rejected: 'background:#fee2e2;color:#991b1b',
      suspended: 'background:#f3f4f6;color:#374151',
    };
    const LABELS = {
      unverified: 'Unverified',
      pending_review: 'Pending Review',
      needs_changes: 'Needs Changes',
      approved: 'Approved',
      verified: 'Approved',
      rejected: 'Rejected',
      suspended: 'Suspended',
    };
    const style = STYLES[status] || STYLES.unverified;
    const label = LABELS[status] || status;
    return `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;${style}">${label}</span>`;
  }

  // Update pagination
  function updatePagination() {
    const totalPages = Math.ceil(filteredSuppliers.length / itemsPerPage);
    const start = (currentPage - 1) * itemsPerPage + 1;
    const end = Math.min(currentPage * itemsPerPage, filteredSuppliers.length);

    document.getElementById('paginationInfo').textContent =
      `Showing ${start}-${end} of ${filteredSuppliers.length} suppliers`;

    document.getElementById('prevPageBtn').disabled = currentPage === 1;
    document.getElementById('nextPageBtn').disabled =
      currentPage === totalPages || totalPages === 0;
  }

  // Change page
  function changePage(delta) {
    currentPage += delta;
    renderTable();
  }

  // Toggle supplier selection
  window.toggleSupplierSelection = function (supplierId) {
    if (selectedSuppliers.has(supplierId)) {
      selectedSuppliers.delete(supplierId);
    } else {
      selectedSuppliers.add(supplierId);
    }
    updateBulkActionsBar();
  };

  // Toggle select all
  function toggleSelectAll(e) {
    const checked = e.target.checked;
    selectedSuppliers.clear();

    if (checked) {
      const start = (currentPage - 1) * itemsPerPage;
      const end = start + itemsPerPage;
      filteredSuppliers.slice(start, end).forEach(s => selectedSuppliers.add(s.id));
    }

    renderTable();
  }

  // Update bulk actions bar
  function updateBulkActionsBar() {
    const bar = document.getElementById('bulkActionsBar');
    const count = document.getElementById('selectedCount');

    if (selectedSuppliers.size > 0) {
      bar.style.display = 'flex';
      count.textContent = `${selectedSuppliers.size} supplier${selectedSuppliers.size > 1 ? 's' : ''} selected`;
    } else {
      bar.style.display = 'none';
    }
  }

  // Bulk actions
  async function bulkAction(action) {
    if (selectedSuppliers.size === 0) {
      return;
    }

    const actionText = action === 'approve' ? 'approve' : action === 'reject' ? 'reject' : 'delete';

    // For bulk reject, prompt for a shared rejection note before confirming
    let bulkRejectNotes = null;
    if (action === 'reject') {
      const noteResult = await AdminShared.showInputModal({
        title: `Reject ${selectedSuppliers.size} Supplier(s)`,
        message:
          'Provide a rejection reason that will be sent to all selected suppliers (each supplier may resubmit up to 5 times).',
        label: 'Rejection Notes',
        placeholder: 'e.g., Incomplete documentation, failed identity check…',
        required: true,
        type: 'textarea',
      });
      if (!noteResult || !noteResult.confirmed) {
        return;
      }
      bulkRejectNotes = noteResult.value;
    } else {
      const confirmed = await AdminShared.showConfirmModal({
        title: 'Confirm Bulk Action',
        message: `Are you sure you want to ${actionText} ${selectedSuppliers.size} supplier(s)?`,
        confirmText: actionText.charAt(0).toUpperCase() + actionText.slice(1),
      });
      if (!confirmed) {
        return;
      }
    }

    try {
      const supplierIds = Array.from(selectedSuppliers);
      const endpoint = `/api/admin/suppliers/bulk-${action}`;
      const body = action === 'reject' ? { supplierIds, notes: bulkRejectNotes } : { supplierIds };

      const result = await AdminShared.api(endpoint, 'POST', body);
      showToast(
        result.message || `Successfully ${actionText}ed ${selectedSuppliers.size} supplier(s)`,
        'success'
      );

      // Clear selection and reload
      selectedSuppliers.clear();
      await loadSuppliers();
      renderTable();
    } catch (error) {
      console.error(`Error bulk ${actionText}:`, error);
      showToast(`Failed to ${actionText} suppliers: ${error.message}`, 'error');
    }
  }

  // Smart tag
  async function smartTag() {
    if (selectedSuppliers.size === 0) {
      showToast('Please select suppliers to tag', 'info');
      return;
    }

    const confirmed = await AdminShared.showConfirmModal({
      title: 'Apply Smart Tags',
      message: `Apply smart tags to ${selectedSuppliers.size} supplier(s)? This will analyze their profiles and add relevant tags.`,
      confirmText: 'Apply Tags',
    });
    if (!confirmed) {
      return;
    }

    try {
      const result = await AdminShared.api('/api/admin/suppliers/smart-tags', 'POST', {
        supplierIds: Array.from(selectedSuppliers),
      });

      showToast(
        `Smart tags applied to ${result.taggedCount || selectedSuppliers.size} supplier(s)`,
        'success'
      );

      // Clear selection and reload
      selectedSuppliers.clear();
      await loadSuppliers();
      renderTable();
    } catch (error) {
      console.error('Error applying smart tags:', error);
      showToast(`Failed to apply smart tags: ${error.message}`, 'error');
    }
  }

  // Import demo suppliers
  async function importDemoSuppliers() {
    const confirmed = await AdminShared.showConfirmModal({
      title: 'Import Demo Suppliers',
      message:
        'Import demo suppliers from data/suppliers.json?\n\nThis will add or update demo suppliers in the database. Existing suppliers with the same ID will be updated.',
      confirmText: 'Import',
    });
    if (!confirmed) {
      return;
    }

    try {
      showToast('Importing demo suppliers...', 'info');

      const result = await AdminShared.api('/api/admin/suppliers/import-demo', 'POST', {});

      showToast(result.message || `Successfully imported ${result.total} supplier(s)`, 'success');

      // Reload suppliers to show the imported ones
      await loadSuppliers();
      renderTable();
    } catch (error) {
      console.error('Error importing demo suppliers:', error);
      showToast(`Failed to import demo suppliers: ${error.message}`, 'error');
    }
  }

  // Export suppliers
  function exportSuppliers() {
    const csv = convertToCSV(filteredSuppliers);
    downloadCSV(csv, 'suppliers-export.csv');
    showToast('Suppliers exported successfully', 'success');
  }

  // Helper: Escape HTML
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Helper: Convert to CSV
  function convertToCSV(data) {
    const headers = [
      'Name',
      'Email',
      'Category',
      'Approved',
      'Verification',
      'Subscription',
      'Quality Score',
      'Tags',
    ];
    const rows = data.map(s => [
      s.name || '',
      s.email || '',
      s.category || '',
      s.approved ? 'Yes' : 'No',
      getEffectiveVerificationStatus(s),
      getEffectiveSubscriptionTier(s),
      s.healthScore || 0,
      s.tags?.join(';') || '',
    ]);

    return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  }

  // Helper: Download CSV
  function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Helper: Show toast
  function showToast(message, type = 'info') {
    if (window.AdminShared && window.AdminShared.showToast) {
      window.AdminShared.showToast(message, type);
    } else {
      console.warn('[AdminSuppliers] AdminShared not available, toast suppressed:', message);
    }
  }

  // Global functions for button actions
  window.viewSupplier = function (id) {
    window.location.href = `/admin-supplier-detail?id=${id}`;
  };

  window.editSupplier = function (id) {
    window.location.href = `/admin-supplier-detail?id=${id}`;
  };

  window.approveSupplier = async function (id) {
    const confirmed = await AdminShared.showConfirmModal({
      title: 'Approve Supplier',
      message:
        'Approve this supplier? They will be able to create packages, send messages, appear in search, and publish calendar events.',
      confirmText: 'Approve',
    });
    if (confirmed) {
      try {
        await AdminShared.api(`/api/admin/suppliers/${id}/approve`, 'POST', { approved: true });
        showToast('Supplier approved', 'success');
        await loadSuppliers();
        renderTable();
      } catch (error) {
        console.error('Error approving supplier:', error);
        showToast(`Failed to approve supplier: ${error.message}`, 'error');
      }
    }
  };

  window.rejectSupplier = async function (id) {
    const result = await AdminShared.showInputModal({
      title: 'Reject Supplier',
      message:
        'Reject this supplier? They will remain unapproved and will see a dashboard banner prompting them to resubmit. Please provide a reason.',
      label: 'Rejection Notes',
      placeholder: 'e.g., Incomplete documentation, failed identity check…',
      required: true,
      type: 'textarea',
    });
    if (result && result.confirmed) {
      try {
        await AdminShared.api(`/api/admin/suppliers/${id}/reject`, 'POST', {
          notes: result.value,
        });
        showToast('Supplier rejected', 'success');
        await loadSuppliers();
        renderTable();
      } catch (error) {
        console.error('Error rejecting supplier:', error);
        showToast(`Failed to reject supplier: ${error.message}`, 'error');
      }
    }
  };

  window.deleteSupplier = async function (id) {
    const confirmed = await AdminShared.showConfirmModal({
      title: 'Delete Supplier',
      message:
        'Are you sure you want to delete this supplier? This will also delete all their packages.',
      confirmText: 'Delete',
    });
    if (confirmed) {
      try {
        await AdminShared.api(`/api/admin/suppliers/${id}`, 'DELETE');
        showToast('Supplier deleted', 'success');
        await loadSuppliers();
        renderTable();
      } catch (error) {
        console.error('Error deleting supplier:', error);
        showToast(`Failed to delete supplier: ${error.message}`, 'error');
      }
    }
  };

  window.grantSubscription = async function (id) {
    const tierSel = document.getElementById(`sub-tier-${id}`);
    const durSel = document.getElementById(`sub-dur-${id}`);
    if (!tierSel || !durSel) {
      showToast('Could not find subscription controls', 'error');
      return;
    }
    const tier = tierSel.value;
    const days = parseInt(durSel.value, 10);
    const tierName = tier === 'pro_plus' ? 'Pro+' : 'Pro';
    const confirmed = await AdminShared.showConfirmModal({
      title: 'Grant Subscription',
      message: `Grant ${tierName} subscription for ${days} day(s) to this supplier?`,
      confirmText: 'Grant',
    });
    if (!confirmed) {
      return;
    }
    try {
      await AdminShared.api(`/api/admin/suppliers/${id}/subscription`, 'POST', { tier, days });
      showToast(`${tierName} subscription granted for ${days} day(s)`, 'success');
      await loadSuppliers();
      renderTable();
    } catch (error) {
      console.error('Error granting subscription:', error);
      showToast(`Failed to grant subscription: ${error.message}`, 'error');
    }
  };

  window.removeSubscription = async function (id) {
    const confirmed = await AdminShared.showConfirmModal({
      title: 'Remove Subscription',
      message: "Remove this supplier's subscription? They will lose Pro/Pro+ features immediately.",
      confirmText: 'Remove',
    });
    if (!confirmed) {
      return;
    }
    try {
      await AdminShared.api(`/api/admin/suppliers/${id}/subscription`, 'DELETE');
      showToast('Subscription removed', 'success');
      await loadSuppliers();
      renderTable();
    } catch (error) {
      console.error('Error removing subscription:', error);
      showToast(`Failed to remove subscription: ${error.message}`, 'error');
    }
  };

  // Initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
