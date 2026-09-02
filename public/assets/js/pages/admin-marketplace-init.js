(async function () {
  'use strict';

  let allListings = [];
  let currentFilter = 'all';
  const selectedListings = new Set();

  function formatDateTime(dateLike) {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) {
      return 'Unknown date';
    }
    return `${date.toLocaleDateString('en-GB', { timeZone: 'Europe/London' })} ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}`;
  }

  function normalizeListing(listing = {}) {
    return {
      ...listing,
      id: listing.id || `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: listing.title || 'Untitled listing',
      description: listing.description || '',
      category: listing.category || 'other',
      condition: listing.condition || 'good',
      location: listing.location || '',
      userEmail: listing.userEmail || 'Unknown user',
      status: listing.status || 'pending',
      price: Number.isFinite(Number(listing.price)) ? Number(listing.price) : 0,
      createdAt: listing.createdAt || new Date().toISOString(),
      images: Array.isArray(listing.images) ? listing.images : [],
    };
  }

  // Fetch listings
  async function loadListings() {
    try {
      const res = await fetch('/api/admin/marketplace/listings', {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to fetch listings');
      }
      const data = await res.json();
      allListings = (data.listings || []).map(normalizeListing).sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') {
          return -1;
        }
        if (a.status !== 'pending' && b.status === 'pending') {
          return 1;
        }
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      selectedListings.clear();
      updateStats();
      renderListings();
      updateBulkActionsBar();
      document.getElementById('lastUpdatedText').textContent =
        `Last updated: ${formatDateTime(new Date())}`;
    } catch (error) {
      console.error('Error loading listings:', error);
      document.getElementById('listings-container').innerHTML =
        '<div class="card"><p class="error">Failed to load listings</p></div>';
    }
  }

  // Update stats
  function updateStats() {
    const total = allListings.length;
    const pendingCount = allListings.filter(l => l.status === 'pending').length;
    const activeCount = allListings.filter(l => l.status === 'active').length;
    const soldCount = allListings.filter(l => l.status === 'sold').length;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-pending').textContent = pendingCount;
    document.getElementById('stat-active').textContent = activeCount;
    document.getElementById('stat-sold').textContent = soldCount;

    const approvalRate = total > 0 ? Math.round(((activeCount + soldCount) / total) * 100) : 0;
    const sellThroughRate =
      activeCount + soldCount > 0 ? Math.round((soldCount / (activeCount + soldCount)) * 100) : 0;
    const pendingListings = allListings.filter(l => l.status === 'pending');
    const oldestPendingTime = pendingListings
      .map(l => new Date(l.createdAt).getTime())
      .filter(time => Number.isFinite(time))
      .sort((a, b) => a - b)[0];
    const oldestPendingAge = oldestPendingTime
      ? `${Math.max(1, Math.floor((Date.now() - oldestPendingTime) / (1000 * 60 * 60 * 24)))}d`
      : '—';

    document.getElementById('hero-approval-rate').textContent = `${approvalRate}%`;
    document.getElementById('hero-sell-through').textContent = `${sellThroughRate}%`;
    document.getElementById('hero-pending-age').textContent = oldestPendingAge;

    document.getElementById('stat-total-footnote').textContent =
      total === 0 ? 'No listings yet' : 'All listing states';
    document.getElementById('stat-pending-footnote').textContent =
      pendingCount > 0 ? `${pendingCount} awaiting review` : 'Queue clear';
    document.getElementById('stat-active-footnote').textContent =
      activeCount > 0 ? `${activeCount} currently live` : 'No active inventory';
    document.getElementById('stat-sold-footnote').textContent =
      soldCount > 0 ? `${soldCount} marked sold` : 'No completed sales yet';
  }

  // Render listings
  function renderListings() {
    const container = document.getElementById('listings-container');
    const search = document.getElementById('searchInput').value.toLowerCase();
    const category = document.getElementById('categoryFilter').value;

    let filtered = allListings;

    // Apply status filter
    if (currentFilter !== 'all') {
      filtered = filtered.filter(l => l.status === currentFilter);
    }

    // Apply search
    if (search) {
      filtered = filtered.filter(
        l =>
          l.title.toLowerCase().includes(search) ||
          l.description.toLowerCase().includes(search) ||
          l.userEmail.toLowerCase().includes(search) ||
          l.location.toLowerCase().includes(search)
      );
    }

    // Apply category filter
    if (category) {
      filtered = filtered.filter(l => l.category === category);
    }

    if (filtered.length === 0) {
      container.innerHTML =
        '<div class="card"><p>No listings found. Try widening filters or clear search.</p></div>';
      return;
    }

    container.innerHTML = filtered
      .map(
        listing => `
      <div class="listing-card">
        <div style="display:flex;align-items:flex-start;gap:8px;">
          <input type="checkbox" onchange="toggleSelection('${listing.id}')" ${selectedListings.has(listing.id) ? 'checked' : ''} style="margin-top:4px;cursor:pointer;">
          ${
            listing.images && listing.images[0]
              ? `<img src="${escapeHtml(listing.images[0])}" alt="${escapeHtml(listing.title)}" class="listing-image">`
              : '<div class="listing-image"></div>'
          }
        </div>
        <div class="listing-info">
          <h3>${escapeHtml(listing.title)}</h3>
          <p class="small">${escapeHtml(listing.description.slice(0, 150))}${listing.description.length > 150 ? '...' : ''}</p>
          <div class="listing-meta">
            <span><strong>£${listing.price.toFixed(2)}</strong></span>
            <span>📍 ${escapeHtml(listing.location || 'No location')}</span>
            <span>Category: ${escapeHtml(listing.category)}</span>
            <span>Condition: ${escapeHtml(listing.condition)}</span>
          </div>
          <div class="listing-meta" style="margin-top:8px">
            <span>Posted by: ${escapeHtml(listing.userEmail)}</span>
            <span>${formatDateTime(listing.createdAt)}</span>
          </div>
        </div>
        <div class="listing-actions">
          <span class="status-badge status-${listing.status}">${listing.status}</span>
          <button class="cta" onclick="editListing('${listing.id}')">✏️ Edit</button>
          ${
            listing.status === 'pending'
              ? `
            <button class="cta" onclick="approveListing('${listing.id}', true)">Approve</button>
            <button class="cta secondary" onclick="approveListing('${listing.id}', false)">Reject</button>
          `
              : ''
          }
          ${
            listing.status === 'active'
              ? `
            <button class="cta secondary" onclick="markAsSold('${listing.id}')">Mark Sold</button>
          `
              : ''
          }
          <button class="cta ghost" onclick="deleteListing('${listing.id}')">Delete</button>
        </div>
      </div>
    `
      )
      .join('');
  }

  // Approve/reject listing
  window.approveListing = async function (id, approved) {
    try {
      const res = await fetch(`/api/admin/marketplace/listings/${id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
        },
        credentials: 'include',
        body: JSON.stringify({ approved }),
      });

      if (!res.ok) {
        throw new Error('Failed to update listing');
      }

      showToast(approved ? 'Listing approved' : 'Listing rejected');
      await loadListings();
    } catch (error) {
      console.error('Error updating listing:', error);
      showToast('Failed to update listing', 'error');
    }
  };

  // Mark as sold
  window.markAsSold = async function (id) {
    try {
      const res = await fetch(`/api/marketplace/listings/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
        },
        credentials: 'include',
        body: JSON.stringify({ status: 'sold' }),
      });

      if (!res.ok) {
        throw new Error('Failed to update listing');
      }

      showToast('Listing marked as sold');
      await loadListings();
    } catch (error) {
      console.error('Error updating listing:', error);
      showToast('Failed to update listing', 'error');
    }
  };

  // Delete listing (admin endpoint with audit logging)
  window.deleteListing = async function (id) {
    if (
      !(await AdminShared.showConfirmModal({
        title: 'Delete Listing',
        message:
          'Are you sure you want to delete this listing? All associated images will be removed.',
        confirmText: 'Delete',
      }))
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/marketplace/listings/${id}`, {
        method: 'DELETE',
        headers: {
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
        },
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to delete listing');
      }

      const data = await res.json();
      const imageMsg =
        data.deletedImageCount > 0 ? ` (${data.deletedImageCount} images removed)` : '';
      showToast(`Listing deleted${imageMsg}`);
      await loadListings();
    } catch (error) {
      console.error('Error deleting listing:', error);
      showToast('Failed to delete listing', 'error');
    }
  };

  // Edit listing
  window.editListing = function (id) {
    const listing = allListings.find(l => l.id === id);
    if (!listing) {
      return;
    }

    // Create modal for editing
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 20px;
    `;

    modal.innerHTML = `
      <div style="background: white; border-radius: 12px; padding: 24px; max-width: 600px; width: 100%; max-height: 90vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="margin: 0;">Edit Listing</h2>
          <button class="ef-cta" id="closeModal" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
        </div>
        <form id="editListingForm" style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500;">Title</label>
            <input type="text" id="editTitle" value="${escapeHtml(listing.title)}" required style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px;">
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500;">Description</label>
            <textarea id="editDescription" rows="4" required style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px;">${escapeHtml(listing.description)}</textarea>
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500;">Price (£)</label>
            <input type="number" id="editPrice" value="${listing.price}" required min="0" step="0.01" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px;">
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500;">Location</label>
            <input type="text" id="editLocation" value="${escapeHtml(listing.location || '')}" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px;">
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500;">Category</label>
            <select id="editCategory" required style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px;">
              <option value="attire" ${listing.category === 'attire' ? 'selected' : ''}>Attire</option>
              <option value="decor" ${listing.category === 'decor' ? 'selected' : ''}>Décor</option>
              <option value="av-equipment" ${listing.category === 'av-equipment' ? 'selected' : ''}>AV Equipment</option>
              <option value="photography" ${listing.category === 'photography' ? 'selected' : ''}>Photography</option>
              <option value="party-supplies" ${listing.category === 'party-supplies' ? 'selected' : ''}>Party Supplies</option>
              <option value="florals" ${listing.category === 'florals' ? 'selected' : ''}>Florals</option>
            </select>
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500;">Condition</label>
            <select id="editCondition" required style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px;">
              <option value="new" ${listing.condition === 'new' ? 'selected' : ''}>New</option>
              <option value="like-new" ${listing.condition === 'like-new' ? 'selected' : ''}>Like New</option>
              <option value="good" ${listing.condition === 'good' ? 'selected' : ''}>Good</option>
              <option value="fair" ${listing.condition === 'fair' ? 'selected' : ''}>Fair</option>
            </select>
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500;">Status</label>
            <select id="editStatus" required style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px;">
              <option value="pending" ${listing.status === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="active" ${listing.status === 'active' ? 'selected' : ''}>Active</option>
              <option value="sold" ${listing.status === 'sold' ? 'selected' : ''}>Sold</option>
              <option value="removed" ${listing.status === 'removed' ? 'selected' : ''}>Removed</option>
            </select>
          </div>
          <div style="display: flex; gap: 12px; margin-top: 8px;">
            <button type="submit" class="cta" style="flex: 1;">Save Changes</button>
            <button type="button" id="cancelEdit" class="cta secondary" style="flex: 1;">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Close modal handlers
    const closeModal = () => modal.remove();
    modal.querySelector('#closeModal').addEventListener('click', closeModal);
    modal.querySelector('#cancelEdit').addEventListener('click', closeModal);
    modal.addEventListener('click', e => {
      if (e.target === modal) {
        closeModal();
      }
    });

    // Form submit
    modal.querySelector('#editListingForm').addEventListener('submit', async e => {
      e.preventDefault();

      const updatedData = {
        title: modal.querySelector('#editTitle').value,
        description: modal.querySelector('#editDescription').value,
        price: parseFloat(modal.querySelector('#editPrice').value),
        location: modal.querySelector('#editLocation').value,
        category: modal.querySelector('#editCategory').value,
        condition: modal.querySelector('#editCondition').value,
        status: modal.querySelector('#editStatus').value,
      };

      try {
        const res = await fetch(`/api/marketplace/listings/${id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
          },
          credentials: 'include',
          body: JSON.stringify(updatedData),
        });

        if (!res.ok) {
          throw new Error('Failed to update listing');
        }

        showToast('Listing updated successfully');
        closeModal();
        await loadListings();
      } catch (error) {
        console.error('Error updating listing:', error);
        showToast('Failed to update listing', 'error');
      }
    });
  };

  // Show toast notification
  function showToast(message, type = 'success') {
    AdminShared.showToast(message, type);
  }

  // Escape HTML
  function escapeHtml(text) {
    return AdminShared.escapeHtml(text);
  }

  // Toggle selection
  window.toggleSelection = function (id) {
    if (selectedListings.has(id)) {
      selectedListings.delete(id);
    } else {
      selectedListings.add(id);
    }
    updateBulkActionsBar();
  };

  // Update bulk actions bar
  function updateBulkActionsBar() {
    const bar = document.getElementById('bulkActionsBar');
    const count = document.getElementById('selectedCount');
    const selectAll = document.getElementById('selectAll');

    if (selectedListings.size > 0) {
      bar.style.display = 'flex';
      count.textContent = `${selectedListings.size} selected`;
    } else {
      bar.style.display = 'none';
    }

    // Update select all checkbox
    const filtered = getFilteredListings();
    selectAll.checked = filtered.length > 0 && filtered.every(l => selectedListings.has(l.id));
  }

  // Get filtered listings
  function getFilteredListings() {
    let filtered = allListings;
    const search = document.getElementById('searchInput').value.toLowerCase();
    const category = document.getElementById('categoryFilter').value;

    if (currentFilter !== 'all') {
      filtered = filtered.filter(l => l.status === currentFilter);
    }
    if (search) {
      filtered = filtered.filter(
        l =>
          l.title.toLowerCase().includes(search) ||
          l.description.toLowerCase().includes(search) ||
          l.userEmail.toLowerCase().includes(search) ||
          l.location.toLowerCase().includes(search)
      );
    }
    if (category) {
      filtered = filtered.filter(l => l.category === category);
    }

    return filtered;
  }

  // Select all handler
  document.getElementById('selectAll').addEventListener('change', e => {
    const filtered = getFilteredListings();
    if (e.target.checked) {
      filtered.forEach(l => selectedListings.add(l.id));
    } else {
      filtered.forEach(l => selectedListings.delete(l.id));
    }
    renderListings();
    updateBulkActionsBar();
  });

  // Bulk approve
  window.bulkApprove = async function () {
    if (selectedListings.size === 0) {
      return;
    }
    if (
      !(await AdminShared.showConfirmModal({
        title: 'Bulk Approve',
        message: `Approve ${selectedListings.size} listing(s)?`,
        confirmText: 'Approve',
      }))
    ) {
      return;
    }

    try {
      const promises = Array.from(selectedListings).map(id =>
        fetch(`/api/admin/marketplace/listings/${id}/approve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
          },
          credentials: 'include',
          body: JSON.stringify({ approved: true }),
        })
      );
      await Promise.all(promises);
      showToast(`Approved ${selectedListings.size} listing(s)`);
      await loadListings();
    } catch (error) {
      console.error('Error bulk approving:', error);
      showToast('Failed to approve some listings', 'error');
    }
  };

  // Bulk mark sold
  window.bulkMarkSold = async function () {
    if (selectedListings.size === 0) {
      return;
    }
    if (
      !(await AdminShared.showConfirmModal({
        title: 'Mark as Sold',
        message: `Mark ${selectedListings.size} listing(s) as sold?`,
        confirmText: 'Mark Sold',
      }))
    ) {
      return;
    }

    try {
      const promises = Array.from(selectedListings).map(id =>
        fetch(`/api/marketplace/listings/${id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
          },
          credentials: 'include',
          body: JSON.stringify({ status: 'sold' }),
        })
      );
      await Promise.all(promises);
      showToast(`Marked ${selectedListings.size} listing(s) as sold`);
      await loadListings();
    } catch (error) {
      console.error('Error bulk marking sold:', error);
      showToast('Failed to mark some listings as sold', 'error');
    }
  };

  // Bulk delete
  window.bulkDelete = async function () {
    if (selectedListings.size === 0) {
      return;
    }
    if (
      !(await AdminShared.showConfirmModal({
        title: 'Bulk Delete',
        message: `Delete ${selectedListings.size} listing(s)? This cannot be undone.`,
        confirmText: 'Delete',
      }))
    ) {
      return;
    }

    try {
      const promises = Array.from(selectedListings).map(id =>
        fetch(`/api/marketplace/listings/${id}`, {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' },
          credentials: 'include',
        })
      );
      await Promise.all(promises);
      showToast(`Deleted ${selectedListings.size} listing(s)`);
      await loadListings();
    } catch (error) {
      console.error('Error bulk deleting:', error);
      showToast('Failed to delete some listings', 'error');
    }
  };

  // Export listings
  document.getElementById('exportListingsBtn').addEventListener('click', () => {
    const filtered = getFilteredListings();
    if (filtered.length === 0) {
      showToast('No listings to export', 'error');
      return;
    }

    const csv = [
      [
        'Title',
        'Description',
        'Price',
        'Category',
        'Condition',
        'Status',
        'Location',
        'Posted By',
        'Created At',
      ].join(','),
      ...filtered.map(l =>
        [
          `"${l.title.replace(/"/g, '""')}"`,
          `"${l.description.replace(/"/g, '""').slice(0, 100)}"`,
          l.price,
          l.category,
          l.condition,
          l.status,
          `"${(l.location || '').replace(/"/g, '""')}"`,
          l.userEmail,
          new Date(l.createdAt).toISOString(),
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marketplace-listings-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showToast(`Exported ${filtered.length} listing(s)`);
  });

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderListings();
    });
  });

  // Search and category filters
  document.getElementById('searchInput').addEventListener('input', renderListings);
  document.getElementById('categoryFilter').addEventListener('change', renderListings);
  document.getElementById('refreshListingsBtn').addEventListener('click', loadListings);
  document.getElementById('heroRefreshBtn').addEventListener('click', loadListings);
  document.getElementById('heroReviewPendingBtn').addEventListener('click', () => {
    document.querySelector('[data-filter="pending"]')?.click();
    const listingsSection = document.getElementById('listings-container');
    listingsSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Sign out (button not present on all layouts — never let this block init)
  document.getElementById('signoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' });
    window.location.href = '/auth';
  });

  // Initial load
  await loadListings();
})();
