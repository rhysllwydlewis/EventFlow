(async function () {
  // Check admin authentication - using AdminShared if available, otherwise fall back to fetch
  try {
    const data = await AdminShared.api('/api/v1/auth/me');
    const user = data.user; // Extract user from response
    if (!user || user.role !== 'admin') {
      window.location.href = '/auth';
      return;
    }
  } catch (err) {
    window.location.href = '/auth';
    return;
  }

  // Fetch CSRF token once at page load
  await AdminShared.fetchCSRFToken();

  let photos = [];
  const selectedPhotos = new Set();
  let suppliers = [];
  let selectedSupplier = null;

  const queueElement = document.getElementById('photoQueue');
  const filterStatus = document.getElementById('filterStatus');
  const searchSupplier = document.getElementById('searchSupplier');
  const supplierNameFilter = document.getElementById('supplierNameFilter');
  const supplierDropdown = document.getElementById('supplierDropdown');
  const batchActions = document.getElementById('batchActions');
  const selectedCount = document.getElementById('selectedCount');
  const batchApprove = document.getElementById('batchApprove');
  const batchReject = document.getElementById('batchReject');
  const clearSelection = document.getElementById('clearSelection');

  // HTML sanitization helper
  function escapeHtml(unsafe) {
    return AdminShared.escapeHtml(unsafe);
  }

  async function loadPhotos() {
    try {
      const data = await AdminShared.api('/api/admin/photos/pending');
      photos = data.photos || [];
      await loadSuppliers();
      renderPhotos();
    } catch (err) {
      console.error('Error loading photos:', err);
      AdminShared.showToast('Failed to load photos', 'error');
      queueElement.innerHTML =
        '<div class="card"><p class="small">Failed to load photos. Please try again.</p></div>';
    }
  }

  async function loadSuppliers() {
    try {
      const data = await AdminShared.api('/api/admin/suppliers');
      suppliers = data.items || data.suppliers || [];
    } catch (err) {
      console.error('Error loading suppliers:', err);
    }
  }

  function renderPhotos() {
    const statusFilter = filterStatus.value;
    const searchTerm = searchSupplier.value.toLowerCase().trim();

    let filtered = photos;

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter(p => {
        if (statusFilter === 'pending') {
          return !p.approved && !p.rejected;
        }
        if (statusFilter === 'approved') {
          return p.approved === true;
        }
        if (statusFilter === 'rejected') {
          return p.rejected === true;
        }
        return true;
      });
    }

    // Filter by search
    if (searchTerm) {
      filtered = filtered.filter(p => (p.supplierName || '').toLowerCase().includes(searchTerm));
    }

    // Filter by selected supplier
    if (selectedSupplier) {
      filtered = filtered.filter(p => p.supplierId === selectedSupplier.id);
    }

    if (filtered.length === 0) {
      queueElement.innerHTML = `
        <div class="photo-queue__empty">
          <div class="photo-queue__empty-icon">📷</div>
          <div>No photos found</div>
        </div>
      `;
      return;
    }

    queueElement.innerHTML = filtered
      .map(
        photo => `
      <div class="photo-queue__item" data-photo-id="${escapeHtml(photo.id)}">
        <input type="checkbox" class="photo-select" data-photo-id="${escapeHtml(photo.id)}">
        <img class="photo-queue__image" src="${escapeHtml(photo.url || photo.thumbnail || '')}" alt="Photo" loading="lazy">
        <div class="photo-queue__details">
          <div class="photo-queue__meta">
            <span class="photo-queue__badge photo-queue__badge--pending">
              ${photo.approved ? 'Approved' : photo.rejected ? 'Rejected' : 'Pending'}
            </span>
            ${photo.size ? `<span class="photo-queue__badge">${formatFileSize(photo.size)}</span>` : ''}
          </div>
          <div class="photo-queue__supplier">
            Supplier: <a href="/supplier?id=${escapeHtml(photo.supplierId)}">${escapeHtml(photo.supplierName || 'Unknown')}</a>
            | <a href="/admin-supplier-detail?id=${escapeHtml(photo.supplierId)}" style="color: #667eea;">View Profile</a>
          </div>
          ${photo.caption ? `<div class="small" style="margin-bottom: 0.5rem;">${escapeHtml(photo.caption)}</div>` : ''}
          <div class="small" style="color: #999;">Uploaded: ${formatDate(photo.uploadedAt)}</div>
          <div class="photo-queue__actions">
            <button class="photo-queue__btn photo-queue__btn--approve" data-action="approvePhoto" data-id="${escapeHtml(photo.id)}">
              ✓ Approve
            </button>
            <button class="photo-queue__btn photo-queue__btn--reject" data-action="rejectPhoto" data-id="${escapeHtml(photo.id)}">
              × Reject
            </button>
          </div>
        </div>
      </div>
    `
      )
      .join('');

    // Attach checkbox event listeners
    document.querySelectorAll('.photo-select').forEach(checkbox => {
      checkbox.addEventListener('change', updateSelection);
    });
  }

  function updateSelection() {
    selectedPhotos.clear();
    document.querySelectorAll('.photo-select:checked').forEach(checkbox => {
      selectedPhotos.add(checkbox.dataset.photoId);
    });

    selectedCount.textContent = selectedPhotos.size;

    if (selectedPhotos.size > 0) {
      batchActions.classList.add('active');
    } else {
      batchActions.classList.remove('active');
    }
  }

  window.approvePhoto = async function (photoId) {
    try {
      await AdminShared.api(`/api/admin/photos/${photoId}/approve`, 'POST', { approved: true });
      await loadPhotos();
      AdminShared.showToast('Photo approved', 'success');
    } catch (err) {
      console.error('Error approving photo:', err);
      AdminShared.showToast('Failed to approve photo', 'error');
    }
  };

  window.rejectPhoto = async function (photoId) {
    if (
      !(await AdminShared.showConfirmModal({
        title: 'Reject Photo',
        message: 'Are you sure you want to reject this photo?',
        confirmText: 'Reject',
      }))
    ) {
      return;
    }

    try {
      await AdminShared.api(`/api/admin/photos/${photoId}/reject`, 'POST', {});
      await loadPhotos();
      AdminShared.showToast('Photo rejected', 'success');
    } catch (err) {
      console.error('Error rejecting photo:', err);
      AdminShared.showToast('Failed to reject photo', 'error');
    }
  };

  batchApprove.addEventListener('click', async () => {
    if (selectedPhotos.size === 0) {
      return;
    }

    if (
      !(await AdminShared.showConfirmModal({
        title: 'Approve Photos',
        message: `Approve ${selectedPhotos.size} photo(s)?`,
        confirmText: 'Approve',
      }))
    ) {
      return;
    }

    try {
      const promises = Array.from(selectedPhotos).map(id =>
        AdminShared.api(`/api/admin/photos/${id}/approve`, 'POST', { approved: true })
      );

      await Promise.all(promises);
      selectedPhotos.clear();
      await loadPhotos();
      AdminShared.showToast(`${promises.length} photo(s) approved`, 'success');
    } catch (err) {
      console.error('Error batch approving:', err);
      AdminShared.showToast('Failed to approve some photos', 'error');
    }
  });

  batchReject.addEventListener('click', async () => {
    if (selectedPhotos.size === 0) {
      return;
    }

    if (
      !(await AdminShared.showConfirmModal({
        title: 'Reject Photos',
        message: `Reject ${selectedPhotos.size} photo(s)?`,
        confirmText: 'Reject',
      }))
    ) {
      return;
    }

    try {
      const promises = Array.from(selectedPhotos).map(id =>
        AdminShared.api(`/api/admin/photos/${id}/reject`, 'POST', {})
      );

      await Promise.all(promises);
      selectedPhotos.clear();
      await loadPhotos();
      AdminShared.showToast(`${promises.length} photo(s) rejected`, 'success');
    } catch (err) {
      console.error('Error batch rejecting:', err);
      AdminShared.showToast('Failed to reject some photos', 'error');
    }
  });

  clearSelection.addEventListener('click', () => {
    document.querySelectorAll('.photo-select:checked').forEach(cb => (cb.checked = false));
    updateSelection();
  });

  filterStatus.addEventListener('change', renderPhotos);
  searchSupplier.addEventListener('input', renderPhotos);

  // Supplier name autocomplete
  supplierNameFilter.addEventListener('input', function () {
    const searchTerm = this.value.toLowerCase().trim();

    if (!searchTerm) {
      supplierDropdown.style.display = 'none';
      selectedSupplier = null;
      renderPhotos();
      return;
    }

    const matched = suppliers.filter(s => (s.name || '').toLowerCase().includes(searchTerm));

    if (matched.length === 0) {
      supplierDropdown.style.display = 'none';
      return;
    }

    // Count photos per supplier
    const photoCounts = {};
    photos.forEach(p => {
      if (p.supplierId) {
        photoCounts[p.supplierId] = (photoCounts[p.supplierId] || 0) + 1;
      }
    });

    supplierDropdown.innerHTML = matched
      .map(s => {
        const count = photoCounts[s.id] || 0;
        return `
        <div class="supplier-dropdown-item" data-supplier-id="${escapeHtml(s.id)}" style="padding: 10px; cursor: pointer; border-bottom: 1px solid #eee;">
          <div style="font-weight: 500;">${escapeHtml(s.name || 'Unknown')}</div>
          <div style="font-size: 12px; color: #666;">${count} photo${count !== 1 ? 's' : ''}</div>
        </div>
      `;
      })
      .join('');

    supplierDropdown.style.display = 'block';

    // Add click handlers
    supplierDropdown.querySelectorAll('.supplier-dropdown-item').forEach(item => {
      item.addEventListener('click', function () {
        const supplierId = this.dataset.supplierId;
        selectedSupplier = suppliers.find(s => s.id === supplierId);
        if (selectedSupplier) {
          supplierNameFilter.value = selectedSupplier.name || 'Unknown';
          supplierDropdown.style.display = 'none';
          renderPhotos();
        }
      });
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (!supplierNameFilter.contains(e.target) && !supplierDropdown.contains(e.target)) {
      supplierDropdown.style.display = 'none';
    }
  });

  // Clear supplier filter when input is cleared manually
  supplierNameFilter.addEventListener('keydown', function (e) {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (this.value.length <= 1) {
        selectedSupplier = null;
      }
    }
  });

  function formatFileSize(bytes) {
    if (bytes === 0) {
      return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
  }

  function formatDate(timestamp) {
    return AdminShared.formatDate(timestamp);
  }

  // Load photos on page load
  await loadPhotos();

  // Event delegation for dynamically created buttons
  document.body.addEventListener('click', e => {
    const target = e.target;
    if (target.tagName !== 'BUTTON') {
      return;
    }

    const action = target.getAttribute('data-action');
    if (!action) {
      return;
    }

    const id = target.getAttribute('data-id');

    switch (action) {
      case 'approvePhoto':
        if (id) {
          approvePhoto(id);
        }
        break;
      case 'rejectPhoto':
        if (id) {
          rejectPhoto(id);
        }
        break;
    }
  });
})();
