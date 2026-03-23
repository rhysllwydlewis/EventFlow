(async function () {
  // ── Auth ──────────────────────────────────────────────────────────────────
  // Try v1 endpoint first; fall back to legacy path so either server config works.
  async function checkAuth() {
    const endpoints = ['/api/v1/auth/me', '/api/auth/me'];
    for (const url of endpoints) {
      try {
        const data = await AdminShared.api(url);
        const user = data.user;
        if (user && user.role === 'admin') {
          return true;
        }
        if (user) {
          return false;
        } // authenticated but not admin
      } catch (_) {
        // try next endpoint
      }
    }
    return false;
  }

  const isAdmin = await checkAuth();
  if (!isAdmin) {
    window.location.href = '/auth';
    return;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let photos = [];
  let suppliers = [];
  let selectedSupplier = null;
  let autoApprove = true; // default; will be overwritten from API

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const queueEl = document.getElementById('photoQueue');
  const searchInput = document.getElementById('searchSupplier');
  const supplierFilter = document.getElementById('supplierNameFilter');
  const supplierDropdown = document.getElementById('supplierDropdown');
  const statusBanner = document.getElementById('statusBanner');
  const toggleEl = document.getElementById('autoApproveToggle');
  const toggleStateLabel = document.getElementById('toggleStateLabel');
  const batchBar = document.getElementById('batchActionsBar');
  const batchCount = document.getElementById('batchCount');
  const batchApproveBtn = document.getElementById('batchApproveBtn');
  const batchRejectBtn = document.getElementById('batchRejectBtn');

  // ── Helpers ───────────────────────────────────────────────────────────────
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

  function formatDate(timestamp) {
    return AdminShared.formatDate(timestamp);
  }

  function formatFileSize(bytes) {
    if (bytes === null || bytes === undefined || typeof bytes !== 'number' || bytes < 0) {
      return '';
    }
    if (bytes === 0) {
      return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
  }

  // Stable ID for gallery photos that don't have an explicit id.
  // Two independent FNV-1a passes (one forward, one reverse) over the same
  // `supplierId:url` string are combined into a single ID. Using two passes
  // significantly reduces the collision probability compared to a single hash:
  // each pass independently has ~1-in-4B odds of collision, so the combined
  // result has ~1-in-18 quintillion odds — safe for a UI display deduplication.
  function stablePhotoId(supplierId, url) {
    const raw = `${supplierId}:${url}`;
    let h1 = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
      h1 ^= raw.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
    let h2 = 0xcbf29ce4;
    for (let i = raw.length - 1; i >= 0; i--) {
      h2 ^= raw.charCodeAt(i);
      h2 = Math.imul(h2, 0x01000193) >>> 0;
    }
    return `gallery_${supplierId}_${h1.toString(36)}${h2.toString(36)}`;
  }

  // ── Status banner ─────────────────────────────────────────────────────────
  function updateStatusBanner(isOn) {
    if (!statusBanner) {
      return;
    }
    if (isOn) {
      statusBanner.innerHTML = `
        <div class="ap-status-banner ap-status-banner--on" role="status">
          <span class="ap-status-banner__icon" aria-hidden="true">✅</span>
          <p class="ap-status-banner__text"><strong>Auto-approval enabled</strong> — photos uploaded by suppliers are immediately visible. No manual approval needed.</p>
        </div>`;
    } else {
      statusBanner.innerHTML = `
        <div class="ap-status-banner ap-status-banner--off" role="status">
          <span class="ap-status-banner__icon" aria-hidden="true">⏳</span>
          <p class="ap-status-banner__text"><strong>Manual moderation active</strong> — new uploads are held in the queue below until an admin approves or rejects them.</p>
        </div>`;
    }
  }

  function updateToggleUI(isOn) {
    if (toggleEl) {
      toggleEl.checked = isOn;
    }
    if (toggleStateLabel) {
      toggleStateLabel.textContent = isOn ? 'ON' : 'OFF';
      toggleStateLabel.className = `ap-toggle-state ${isOn ? 'ap-toggle-state--on' : 'ap-toggle-state--off'}`;
    }
    updateStatusBanner(isOn);
  }

  // ── Feature flag: load + save ─────────────────────────────────────────────
  async function loadAutoApproveFlag() {
    try {
      const data = await AdminShared.api('/api/admin/settings/features');
      autoApprove = data.photoAutoApprove !== false;
    } catch (err) {
      console.error('Failed to load feature flags:', err);
      autoApprove = true; // safe default
    }
    updateToggleUI(autoApprove);
  }

  async function saveAutoApproveFlag(newValue) {
    try {
      await AdminShared.adminFetch('/api/admin/settings/features', {
        method: 'PUT',
        body: { photoAutoApprove: newValue },
      });
      autoApprove = newValue;
      updateToggleUI(autoApprove);
      showToast(`Auto-approve ${newValue ? 'enabled' : 'disabled'}`, 'success');
      await loadPhotos();
    } catch (err) {
      console.error('Failed to save feature flag:', err);
      showToast('Failed to update auto-approve setting', 'error');
      // Revert toggle
      updateToggleUI(autoApprove);
    }
  }

  // Toggle change handler
  if (toggleEl) {
    toggleEl.addEventListener('change', async () => {
      const newValue = toggleEl.checked;
      // Disable toggle while saving
      toggleEl.disabled = true;
      await saveAutoApproveFlag(newValue);
      toggleEl.disabled = false;
    });
  }

  // ── Data loading ──────────────────────────────────────────────────────────
  async function loadSuppliers() {
    try {
      const data = await AdminShared.api('/api/admin/suppliers');
      suppliers = data.items || data.suppliers || [];
    } catch (err) {
      console.error('Error loading suppliers:', err);
      suppliers = [];
    }
  }

  async function loadPhotos() {
    if (!queueEl) {
      return;
    }
    queueEl.innerHTML = '<div class="card"><p>Loading photos…</p></div>';

    try {
      await loadSuppliers();

      if (autoApprove) {
        // Library mode: load all approved gallery photos
        const data = await AdminShared.api('/api/admin/photos/library');
        photos = (data.photos || []).map(p => ({
          ...p,
          id: p.id || stablePhotoId(p.supplierId, p.url || ''),
          uploadedAt: p.uploadedAt || null,
        }));
      } else {
        // Queue mode: load pending photos
        const data = await AdminShared.api('/api/admin/photos/pending');
        photos = (data.photos || []).map(p => ({
          ...p,
          id: p.id || stablePhotoId(p.supplierId || '', p.url || ''),
          uploadedAt: p.uploadedAt || null,
        }));
      }

      renderPhotos();
    } catch (err) {
      console.error('Error loading photos:', err);
      showToast('Failed to load photos', 'error');
      queueEl.innerHTML =
        '<div class="card"><p class="small">Failed to load photos. Please try again.</p></div>';
    }
  }

  // ── Moderation actions ────────────────────────────────────────────────────
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

  window.rejectPhoto = async function rejectPhoto(photoId) {
    const confirmed = await showConfirmModal('Are you sure you want to reject this photo?');
    if (!confirmed) {
      return;
    }
    try {
      await AdminShared.adminFetch(`/api/admin/photos/${encodeURIComponent(photoId)}/reject`, {
        method: 'POST',
        body: { rejectionReason: '' },
      });
      showToast('Photo rejected', 'success');
      await loadPhotos();
    } catch (err) {
      console.error('Error rejecting photo:', err);
      showToast('Failed to reject photo', 'error');
    }
  };

  // ── Batch actions ─────────────────────────────────────────────────────────
  function getSelectedIds() {
    if (!queueEl) {
      return [];
    }
    return Array.from(queueEl.querySelectorAll('.photo-queue__checkbox:checked'))
      .map(el => el.dataset.photoId)
      .filter(Boolean);
  }

  function updateBatchBar() {
    if (!batchBar) {
      return;
    }
    const ids = getSelectedIds();
    if (!autoApprove && ids.length > 0) {
      batchBar.classList.add('active');
      if (batchCount) {
        batchCount.textContent = `${ids.length} selected`;
      }
    } else {
      batchBar.classList.remove('active');
    }
  }

  if (batchApproveBtn) {
    batchApproveBtn.addEventListener('click', async () => {
      const ids = getSelectedIds();
      if (ids.length === 0) {
        showToast('No photos selected', 'warning');
        return;
      }
      const confirmed = await showConfirmModal(`Approve ${ids.length} photo(s)?`);
      if (!confirmed) {
        return;
      }
      try {
        for (const id of ids) {
          await AdminShared.adminFetch(`/api/admin/photos/${encodeURIComponent(id)}/approve`, {
            method: 'POST',
          });
        }
        showToast(`${ids.length} photo(s) approved`, 'success');
        await loadPhotos();
      } catch (err) {
        console.error('Batch approve error:', err);
        showToast('Failed to approve photos', 'error');
      }
    });
  }

  if (batchRejectBtn) {
    batchRejectBtn.addEventListener('click', async () => {
      const ids = getSelectedIds();
      if (ids.length === 0) {
        showToast('No photos selected', 'warning');
        return;
      }
      const confirmed = await showConfirmModal(`Reject ${ids.length} photo(s)?`);
      if (!confirmed) {
        return;
      }
      try {
        for (const id of ids) {
          await AdminShared.adminFetch(`/api/admin/photos/${encodeURIComponent(id)}/reject`, {
            method: 'POST',
            body: { rejectionReason: '' },
          });
        }
        showToast(`${ids.length} photo(s) rejected`, 'success');
        await loadPhotos();
      } catch (err) {
        console.error('Batch reject error:', err);
        showToast('Failed to reject photos', 'error');
      }
    });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function renderPhotos() {
    if (!queueEl) {
      return;
    }

    const searchTerm = (searchInput ? searchInput.value : '').toLowerCase().trim();
    let filtered = photos;

    if (searchTerm) {
      filtered = filtered.filter(p => (p.supplierName || '').toLowerCase().includes(searchTerm));
    }
    if (selectedSupplier) {
      filtered = filtered.filter(p => p.supplierId === selectedSupplier.id);
    }

    if (filtered.length === 0) {
      const emptyMsg = searchTerm
        ? 'No photos found matching your search.'
        : autoApprove
          ? 'No photos in the library yet.'
          : 'No photos awaiting approval.';
      queueEl.innerHTML = `
        <div class="photo-queue__empty">
          <div class="photo-queue__empty-icon" aria-hidden="true">📷</div>
          <div>${emptyMsg}</div>
        </div>`;
      return;
    }

    const countText = `Showing ${filtered.length} photo${filtered.length !== 1 ? 's' : ''}${photos.length !== filtered.length ? ` (filtered from ${photos.length} total)` : ''}`;

    queueEl.innerHTML = `
      <p class="ap-photo-count">${countText}</p>
      ${filtered.map(photo => renderPhotoCard(photo)).join('')}`;

    // Attach checkbox change listeners for batch bar
    queueEl.querySelectorAll('.photo-queue__checkbox').forEach(cb => {
      cb.addEventListener('change', updateBatchBar);
    });
  }

  function renderPhotoCard(photo) {
    const safeId = escapeHtml(photo.id || '');
    const safeUrl = escapeHtml(photo.url || photo.thumbnail || '');
    const safeSupplierName = escapeHtml(photo.supplierName || 'Unknown');
    const safeSupplierId = escapeHtml(photo.supplierId || '');
    const safeCaption = photo.caption ? escapeHtml(photo.caption) : '';

    const badgeHtml = autoApprove
      ? `<span class="photo-queue__badge photo-queue__badge--approved">In library</span>`
      : `<span class="photo-queue__badge photo-queue__badge--pending">Pending</span>`;

    const sizeHtml = photo.size
      ? `<span class="photo-queue__badge">${formatFileSize(photo.size)}</span>`
      : '';

    const actionsHtml = autoApprove
      ? ''
      : `
      <div class="photo-queue__actions">
        <button class="photo-queue__btn photo-queue__btn--approve" onclick="approvePhoto('${safeId}')" type="button">Approve</button>
        <button class="photo-queue__btn photo-queue__btn--reject" onclick="rejectPhoto('${safeId}')" type="button">Reject</button>
      </div>`;

    const checkboxHtml = autoApprove
      ? ''
      : `
      <input type="checkbox" class="photo-queue__checkbox" data-photo-id="${safeId}" aria-label="Select photo">`;

    return `
      <div class="photo-queue__item" data-photo-id="${safeId}">
        ${checkboxHtml}
        <img class="photo-queue__image" src="${safeUrl}" alt="Supplier photo" loading="lazy">
        <div class="photo-queue__details">
          <div class="photo-queue__meta">
            ${badgeHtml}
            ${sizeHtml}
          </div>
          <div class="photo-queue__supplier">
            Supplier: <a href="/supplier?id=${safeSupplierId}">${safeSupplierName}</a>
            · <a href="/admin-supplier-detail?id=${safeSupplierId}">View profile</a>
          </div>
          ${safeCaption ? `<div class="small">${safeCaption}</div>` : ''}
          <div class="small" style="color:#9ca3af;">Uploaded: ${formatDate(photo.uploadedAt)}</div>
          ${actionsHtml}
        </div>
      </div>`;
  }

  // ── Search & filter ───────────────────────────────────────────────────────
  if (searchInput) {
    searchInput.addEventListener('input', renderPhotos);
  }

  if (supplierFilter) {
    supplierFilter.setAttribute('aria-expanded', 'false');

    supplierFilter.addEventListener('input', function () {
      const term = this.value.toLowerCase().trim();

      if (!term) {
        hideDropdown();
        selectedSupplier = null;
        renderPhotos();
        return;
      }

      const matched = suppliers.filter(s => (s.name || '').toLowerCase().includes(term));

      if (matched.length === 0) {
        hideDropdown();
        return;
      }

      // Photo counts per supplier
      const counts = {};
      photos.forEach(p => {
        if (p.supplierId) {
          counts[p.supplierId] = (counts[p.supplierId] || 0) + 1;
        }
      });

      if (supplierDropdown) {
        supplierDropdown.innerHTML = matched
          .map(s => {
            const count = counts[s.id] || 0;
            return `<li role="option" data-supplier-id="${escapeHtml(s.id)}">
            <span class="sd-name">${escapeHtml(s.name || 'Unknown')}</span>
            <span class="sd-count">${count} photo${count !== 1 ? 's' : ''}</span>
          </li>`;
          })
          .join('');

        supplierDropdown.removeAttribute('hidden');
        supplierFilter.setAttribute('aria-expanded', 'true');

        supplierDropdown.querySelectorAll('li').forEach(item => {
          item.addEventListener('click', function () {
            const id = this.dataset.supplierId;
            selectedSupplier = suppliers.find(s => s.id === id) || null;
            if (selectedSupplier) {
              supplierFilter.value = selectedSupplier.name || 'Unknown';
            }
            hideDropdown();
            renderPhotos();
          });
        });
      }
    });

    supplierFilter.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        hideDropdown();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (this.value.length <= 1) {
          selectedSupplier = null;
          renderPhotos();
        }
      }
    });
  }

  document.addEventListener('click', e => {
    if (
      supplierFilter &&
      supplierDropdown &&
      !supplierFilter.contains(e.target) &&
      !supplierDropdown.contains(e.target)
    ) {
      hideDropdown();
    }
  });

  function hideDropdown() {
    if (supplierDropdown) {
      supplierDropdown.setAttribute('hidden', '');
    }
    if (supplierFilter) {
      supplierFilter.setAttribute('aria-expanded', 'false');
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  await loadAutoApproveFlag();
  await loadPhotos();
})();
