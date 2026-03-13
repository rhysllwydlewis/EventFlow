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

  // HTML sanitization helper
  function escapeHtml(unsafe) {
    return AdminShared.escapeHtml(unsafe);
  }

  async function loadPhotos() {
    try {
      // Photos are now fetched from all suppliers directly since approval is no longer needed
      await loadSuppliers();
      photos = [];
      for (const supplier of suppliers) {
        if (supplier.photosGallery && supplier.photosGallery.length > 0) {
          supplier.photosGallery.forEach(p => {
            photos.push({ ...p, supplierId: supplier.id, supplierName: supplier.name });
          });
        }
      }
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
