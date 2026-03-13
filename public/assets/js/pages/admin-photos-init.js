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

  let photos = [];
  let suppliers = [];
  let selectedSupplier = null;

  const queueElement = document.getElementById('photoQueue');
  const searchSupplier = document.getElementById('searchSupplier');
  const supplierNameFilter = document.getElementById('supplierNameFilter');
  const supplierDropdown = document.getElementById('supplierDropdown');
  const batchReject = document.getElementById('batchRejectBtn');
  const batchApprove = document.getElementById('batchApproveBtn');

  // HTML sanitization helper
  function escapeHtml(unsafe) {
    return AdminShared.escapeHtml(unsafe);
  }

  function showToast(message, type) {
    AdminShared.showToast(message, type);
  }

  async function showConfirmModal(message) {
    const result = await AdminShared.showConfirmModal({ title: 'Confirm', message });
    return result && result.confirmed;
  }

  async function loadPhotos() {
    try {
      // Load from pending photos API; fall back to empty array if approval is disabled
      const data = await AdminShared.api('/api/admin/photos/pending');
      photos = data.photos || [];

      // Also enrich with supplier gallery photos
      await loadSuppliers();
      for (const supplier of suppliers) {
        if (supplier.photosGallery && supplier.photosGallery.length > 0) {
          supplier.photosGallery.forEach(p => {
            // Avoid duplicates
            if (!photos.some(existing => existing.url === p.url)) {
              photos.push({ ...p, supplierId: supplier.id, supplierName: supplier.name });
            }
          });
        }
      }

      renderPhotos();
    } catch (err) {
      console.error('Error loading photos:', err);
      showToast('Failed to load photos', 'error');
      if (queueElement) {
        queueElement.innerHTML =
          '<div class="card"><p class="small">Failed to load photos. Please try again.</p></div>';
      }
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

  /**
   * Approve a photo by ID
   * @param {string} photoId - Photo ID to approve
   */
  window.approvePhoto = async function approvePhoto(photoId) {
    try {
      await AdminShared.adminFetch(`/api/admin/photos/${encodeURIComponent(photoId)}/approve`, {
        method: 'POST',
      });
      showToast('Photo approved', 'success');
      await loadPhotos();
    } catch (err) {
      console.error('Error approving photo:', err);
      showToast('Failed to approve photo', 'error');
    }
  };

  /**
   * Reject a photo by ID after confirmation
   * @param {string} photoId - Photo ID to reject
   * @param {string} [reason] - Optional rejection reason
   */
  window.rejectPhoto = async function rejectPhoto(photoId, reason) {
    const confirmed = await showConfirmModal('Are you sure you want to reject this photo?');
    if (!confirmed) {
      return;
    }
    try {
      await AdminShared.adminFetch(`/api/admin/photos/${encodeURIComponent(photoId)}/reject`, {
        method: 'POST',
        body: { rejectionReason: reason || '' },
      });
      showToast('Photo rejected', 'success');
      await loadPhotos();
    } catch (err) {
      console.error('Error rejecting photo:', err);
      showToast('Failed to reject photo', 'error');
    }
  };

  // Batch reject handler — calls /reject endpoint for each selected photo
  if (batchReject) {
    batchReject.addEventListener('click', async () => {
      const ids = getSelectedPhotoIds();
      if (ids.length === 0) {
        showToast('No photos selected', 'warning');
        return;
      }
      const confirmed = await showConfirmModal(`Reject ${ids.length} photo(s)?`);
      if (!confirmed) {
        return;
      }
      try {
        // Call the /reject endpoint for each selected photo
        for (const id of ids) {
          await AdminShared.adminFetch(`/api/admin/photos/${id}/reject`, {
            method: 'POST',
            body: { rejectionReason: '' },
          });
        }
        showToast(`${ids.length} photo(s) rejected`, 'success');
        await loadPhotos();
      } catch (err) {
        console.error('Error batch rejecting:', err);
        showToast('Failed to reject photos', 'error');
      }
    });
  }

  // Batch approve handler
  if (batchApprove) {
    batchApprove.addEventListener('click', async () => {
      const selectedIds = getSelectedPhotoIds();
      if (selectedIds.length === 0) {
        showToast('No photos selected', 'warning');
        return;
      }
      const confirmed = await showConfirmModal(`Approve ${selectedIds.length} photo(s)?`);
      if (!confirmed) {
        return;
      }
      try {
        for (const photoId of selectedIds) {
          await AdminShared.adminFetch(`/api/admin/photos/${encodeURIComponent(photoId)}/approve`, {
            method: 'POST',
          });
        }
        showToast('Photos approved', 'success');
        await loadPhotos();
      } catch (err) {
        console.error('Error batch approving photos:', err);
        showToast('Failed to approve photos', 'error');
      }
    });
  }

  function getSelectedPhotoIds() {
    if (!queueElement) {
      return [];
    }
    return Array.from(queueElement.querySelectorAll('.photo-queue__checkbox:checked')).map(
      el => el.dataset.photoId
    );
  }

  function renderPhotos() {
    if (!queueElement) {
      return;
    }

    const searchTerm = searchSupplier ? searchSupplier.value.toLowerCase().trim() : '';

    let filtered = photos;

    // Filter by search
    if (searchTerm) {
      filtered = filtered.filter(p => (p.supplierName || '').toLowerCase().includes(searchTerm));
    }

    // Filter by selected supplier
    if (selectedSupplier) {
      filtered = filtered.filter(p => p.supplierId === selectedSupplier.id);
    }

    if (filtered.length === 0) {
      const emptyMsg =
        searchSupplier && searchSupplier.value.trim()
          ? 'No photos found matching your search.'
          : 'No photos have been uploaded yet.';
      queueElement.innerHTML = `
        <div class="photo-queue__empty">
          <div class="photo-queue__empty-icon">📷</div>
          <div>${emptyMsg}</div>
        </div>
      `;
      return;
    }

    queueElement.innerHTML = `
      <p class="small" style="margin-bottom: 12px; color: var(--muted);">
        Showing ${filtered.length} photo${filtered.length !== 1 ? 's' : ''}${photos.length !== filtered.length ? ` (filtered from ${photos.length} total)` : ''}
      </p>
    ${filtered
      .map(
        photo => `
      <div class="photo-queue__item" data-photo-id="${escapeHtml(photo.id || '')}">
        <input type="checkbox" class="photo-queue__checkbox" data-photo-id="${escapeHtml(photo.id || '')}" style="margin-right: 8px;">
        <img class="photo-queue__image" src="${escapeHtml(photo.url || photo.thumbnail || '')}" alt="Photo" loading="lazy">
        <div class="photo-queue__details">
          <div class="photo-queue__meta">
            <span class="photo-queue__badge photo-queue__badge--approved">Auto-approved</span>
            ${photo.size ? `<span class="photo-queue__badge">${formatFileSize(photo.size)}</span>` : ''}
          </div>
          <div class="photo-queue__supplier">
            Supplier: <a href="/supplier?id=${escapeHtml(photo.supplierId)}">${escapeHtml(photo.supplierName || 'Unknown')}</a>
            | <a href="/admin-supplier-detail?id=${escapeHtml(photo.supplierId)}" style="color: #667eea;">View Profile</a>
          </div>
          ${photo.caption ? `<div class="small" style="margin-bottom: 0.5rem;">${escapeHtml(photo.caption)}</div>` : ''}
          <div class="small" style="color: #999;">Uploaded: ${formatDate(photo.uploadedAt)}</div>
          <div class="photo-queue__actions" style="margin-top: 8px; display: flex; gap: 8px;">
            <button class="btn btn-sm btn-success" onclick="approvePhoto('${escapeHtml(photo.id || '')}')">Approve</button>
            <button class="btn btn-sm btn-danger" onclick="rejectPhoto('${escapeHtml(photo.id || '')}')">Reject</button>
          </div>
        </div>
      </div>
    `
      )
      .join('')}`;
  }

  if (searchSupplier) {
    searchSupplier.addEventListener('input', renderPhotos);
  }

  // Supplier name autocomplete
  if (supplierNameFilter) {
    supplierNameFilter.addEventListener('input', function () {
      const searchTerm = this.value.toLowerCase().trim();

      if (!searchTerm) {
        if (supplierDropdown) {
          supplierDropdown.style.display = 'none';
        }
        selectedSupplier = null;
        renderPhotos();
        return;
      }

      const matched = suppliers.filter(s => (s.name || '').toLowerCase().includes(searchTerm));

      if (matched.length === 0) {
        if (supplierDropdown) {
          supplierDropdown.style.display = 'none';
        }
        return;
      }

      // Count photos per supplier
      const photoCounts = {};
      photos.forEach(p => {
        if (p.supplierId) {
          photoCounts[p.supplierId] = (photoCounts[p.supplierId] || 0) + 1;
        }
      });

      if (supplierDropdown) {
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
      }
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (
      supplierNameFilter &&
      supplierDropdown &&
      !supplierNameFilter.contains(e.target) &&
      !supplierDropdown.contains(e.target)
    ) {
      supplierDropdown.style.display = 'none';
    }
  });

  // Clear supplier filter when input is cleared manually
  if (supplierNameFilter) {
    supplierNameFilter.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (this.value.length <= 1) {
          selectedSupplier = null;
        }
      }
    });
  }

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
})();
