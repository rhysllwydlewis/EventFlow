// Supplier Management Page Initialization
(function () {
  let allSuppliers = [];
  let filteredSuppliers = [];
  const selectedSuppliers = new Set();
  let currentPage = 1;
  const itemsPerPage = 20;

  // Initialize page
  async function init() {
    await loadSuppliers();
    setupEventListeners();
    renderTable();
  }

  // Load suppliers data
  async function loadSuppliers() {
    try {
      const data = await AdminShared.api('/api/admin/suppliers');
      // API may return data.items or data.suppliers - accept both for compatibility
      allSuppliers = data.items || data.suppliers || [];

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
  async function calculateSupplierHealth(supplier) {
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
          <div style="font-weight: 600; margin-bottom: 8px;">Health Score: ${score}% (${label})</div>
          ${breakdownHtml}
        </div>
      </div>
    `;
  }

  // Update statistics
  function updateStats() {
    const total = allSuppliers.length;
    const pending = allSuppliers.filter(s => {
      const vs = s.verificationStatus || (s.verified ? 'approved' : 'unverified');
      return vs === 'pending_review' || vs === 'unverified';
    }).length;
    const pro = allSuppliers.filter(s => s.subscription?.tier === 'pro_plus').length;
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
  }

  // Handle filters
  function handleFilters() {
    const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const approval = document.getElementById('approvalFilter')?.value || 'all';
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

      const matchesSubscription =
        subscription === 'all' || supplier.subscription?.tier === subscription;

      const supplierVerification =
        supplier.verificationStatus || (supplier.verified ? 'approved' : 'unverified');
      const matchesVerification = verification === 'all' || supplierVerification === verification;

      return matchesSearch && matchesApproval && matchesSubscription && matchesVerification;
    });

    currentPage = 1;
    renderTable();
  }

  // Clear filters
  function clearFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('approvalFilter').value = 'all';
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
        const subscriptionBadge = getSubscriptionBadge(supplier.subscription?.tier || 'free');
        const healthScoreBadge = getHealthScoreBadge(
          supplier.healthScore || 0,
          supplier.healthBreakdown
        );

        const verificationBadge = getVerificationBadge(
          supplier.verificationStatus || (supplier.verified ? 'approved' : 'unverified')
        );

        return `
        <tr>
          <td><input type="checkbox" ${isSelected ? 'checked' : ''} onchange="window.toggleSupplierSelection('${escapeHtml(supplier.id)}')"></td>
          <td><a href="/admin-supplier-detail?id=${escapeHtml(supplier.id)}" style="color: #667eea; font-weight: 500;">${escapeHtml(supplier.name || 'Unknown')}</a></td>
          <td>${escapeHtml(supplier.email || '')}</td>
          <td>${supplier.approved ? '<span style="color: #10b981;">✓ Yes</span>' : '<span style="color: #f59e0b;">Pending</span>'}</td>
          <td>${verificationBadge}</td>
          <td>${subscriptionBadge}</td>
          <td>${healthScoreBadge}</td>
          <td><span style="font-size: 12px; color: #6b7280;">${escapeHtml(supplier.tags?.join(', ') || 'None')}</span></td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <div style="display: flex; gap: 8px;">
                <button onclick="window.viewSupplier('${escapeHtml(supplier.id)}')" class="btn-xs" title="View Profile">👁️</button>
                <button onclick="window.editSupplier('${escapeHtml(supplier.id)}')" class="btn-xs" title="Edit">✏️</button>
                ${!supplier.approved ? `<button onclick="window.approveSupplier('${escapeHtml(supplier.id)}')" class="btn-xs" style="background: #10b981; color: white;" title="Approve">✓</button>` : ''}
                <button onclick="window.deleteSupplier('${escapeHtml(supplier.id)}')" class="btn-xs" style="background: #ef4444; color: white;" title="Delete">🗑️</button>
              </div>
              <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
                <select id="sub-tier-${escapeHtml(supplier.id)}" class="btn-xs" style="padding: 2px 4px; font-size: 11px;" title="Subscription tier">
                  <option value="pro">Pro</option>
                  <option value="pro_plus">Pro+</option>
                </select>
                <select id="sub-days-${escapeHtml(supplier.id)}" class="btn-xs" style="padding: 2px 4px; font-size: 11px;" title="Duration">
                  <option value="7">7d</option>
                  <option value="14">14d</option>
                  <option value="30" selected>30d</option>
                  <option value="90">90d</option>
                  <option value="180">180d</option>
                  <option value="365">1yr</option>
                </select>
                <button onclick="window.grantSubscription('${escapeHtml(supplier.id)}')" class="btn-xs" style="background: #667eea; color: white; font-size: 11px;" title="Grant subscription">Grant</button>
                <button onclick="window.removeSubscription('${escapeHtml(supplier.id)}')" class="btn-xs" style="background: #6b7280; color: white; font-size: 11px;" title="Remove subscription">Remove</button>
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
      free: '<span class="subscription-badge badge-free">FREE</span>',
      pro: '<span class="subscription-badge badge-pro">PRO</span>',
      pro_plus: '<span class="subscription-badge badge-pro-plus">PRO+</span>',
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
    const confirmed = await AdminShared.showConfirmModal({
      title: 'Confirm Bulk Action',
      message: `Are you sure you want to ${actionText} ${selectedSuppliers.size} supplier(s)?`,
      confirmText: actionText.charAt(0).toUpperCase() + actionText.slice(1),
    });
    if (!confirmed) {
      return;
    }

    try {
      const supplierIds = Array.from(selectedSuppliers);
      const endpoint = `/api/admin/suppliers/bulk-${action}`;

      const result = await AdminShared.api(endpoint, 'POST', { supplierIds });
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
      'Health Score',
      'Tags',
    ];
    const rows = data.map(s => [
      s.name || '',
      s.email || '',
      s.category || '',
      s.approved ? 'Yes' : 'No',
      s.verificationStatus || (s.verified ? 'approved' : 'unverified'),
      s.subscription?.tier || 'free',
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
      message: 'Approve this supplier?',
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
    const daysSel = document.getElementById(`sub-days-${id}`);
    if (!tierSel || !daysSel) {
      showToast('Could not find subscription controls', 'error');
      return;
    }
    const tier = tierSel.value;
    const days = parseInt(daysSel.value, 10);
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
