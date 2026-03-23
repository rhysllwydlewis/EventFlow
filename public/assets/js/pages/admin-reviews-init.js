(async function () {
  // ── Auth ──────────────────────────────────────────────────────────────────
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
        }
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
  let autoApprove = true; // will be overwritten from API
  let reviews = [];
  let selectedIds = new Set();

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const queueEl = document.getElementById('reviewQueue');
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

  function formatDate(ts) {
    return AdminShared.formatDate ? AdminShared.formatDate(ts) : new Date(ts).toLocaleString();
  }

  // ── Status banner ─────────────────────────────────────────────────────────
  function updateStatusBanner(isOn) {
    if (!statusBanner) return;
    if (isOn) {
      statusBanner.innerHTML = `
        <div class="ap-status-banner ap-status-banner--on" role="status">
          <span class="ap-status-banner__icon" aria-hidden="true">✅</span>
          <p class="ap-status-banner__text"><strong>Auto-approval enabled</strong> — qualifying reviews (verified booking, no spam, neutral/positive sentiment) are published immediately.</p>
        </div>`;
    } else {
      statusBanner.innerHTML = `
        <div class="ap-status-banner ap-status-banner--off" role="status">
          <span class="ap-status-banner__icon" aria-hidden="true">⏳</span>
          <p class="ap-status-banner__text"><strong>Manual moderation active</strong> — all new reviews are held in the queue below until an admin approves or rejects them.</p>
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
      autoApprove = data.autoApproveReviews !== false;
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
        body: { autoApproveReviews: newValue },
      });
      autoApprove = newValue;
      updateToggleUI(autoApprove);
      showToast(`Auto-approve reviews ${newValue ? 'enabled' : 'disabled'}`, 'success');
      await loadReviews();
    } catch (err) {
      console.error('Failed to save feature flag:', err);
      showToast('Failed to update auto-approve setting', 'error');
      updateToggleUI(autoApprove);
    }
  }

  if (toggleEl) {
    toggleEl.addEventListener('change', async () => {
      const newValue = toggleEl.checked;
      toggleEl.disabled = true;
      await saveAutoApproveFlag(newValue);
      toggleEl.disabled = false;
    });
  }

  // ── Batch selection ───────────────────────────────────────────────────────
  function updateBatchBar() {
    if (!batchBar || !batchCount) return;
    if (selectedIds.size > 0) {
      batchBar.style.display = '';
      batchCount.textContent = `${selectedIds.size} selected`;
    } else {
      batchBar.style.display = 'none';
    }
  }

  // ── Reviews loading ───────────────────────────────────────────────────────
  async function loadReviews() {
    if (!queueEl) return;
    queueEl.innerHTML = '<div class="card card-mt"><p>Loading reviews…</p></div>';
    selectedIds.clear();
    updateBatchBar();

    try {
      const data = await AdminShared.api('/api/v2/admin/reviews/pending');
      reviews = data.data || data.reviews || [];
    } catch (err) {
      console.error('Failed to load reviews:', err);
      queueEl.innerHTML =
        '<div class="card card-mt"><p class="text-danger">Failed to load reviews. Please refresh the page.</p></div>';
      return;
    }

    renderReviews();
  }

  function renderReviews() {
    if (!queueEl) return;

    if (reviews.length === 0) {
      queueEl.innerHTML =
        '<div class="card card-mt"><p>No pending reviews. ' +
        (autoApprove
          ? 'Qualifying reviews are being auto-approved.'
          : 'New reviews will appear here for moderation.') +
        '</p></div>';
      return;
    }

    const fragment = document.createDocumentFragment();

    reviews.forEach(review => {
      const id = review._id || review.id || '';
      const card = document.createElement('div');
      card.className = 'card card-mt';
      card.dataset.reviewId = id;

      const rating = review.rating || review.moderation?.rating || 0;
      const stars = '★'.repeat(Math.max(0, Math.min(5, rating))) +
        '☆'.repeat(Math.max(0, 5 - Math.min(5, rating)));
      const title = review.title || '';
      const text = review.text || review.comment || '';
      const supplierId = review.supplierId || '';
      const authorId = review.authorId || '';
      const createdAt = review.createdAt ? formatDate(review.createdAt) : '—';
      const moderationState = (review.moderation && review.moderation.state) || review.status || 'pending';
      const moderationReason = (review.moderation && review.moderation.reason) || '';
      const flagged = review.flagged ? ' <span class="badge badge-warning">Flagged</span>' : '';

      card.innerHTML =
        `<div style="display:flex;align-items:flex-start;gap:12px;">` +
        `<input type="checkbox" class="review-checkbox table-checkbox" data-id="${escapeHtml(id)}" aria-label="Select review ${escapeHtml(id)}">` +
        `<div style="flex:1;">` +
        `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">` +
        `<span class="rating-stars" aria-label="${escapeHtml(String(rating))} out of 5 stars">${escapeHtml(stars)}</span>` +
        (title ? `<strong>${escapeHtml(title)}</strong>` : '') +
        flagged +
        `<span class="badge badge-secondary" style="margin-left:auto;">${escapeHtml(moderationState)}</span>` +
        `</div>` +
        (text ? `<p style="margin:0 0 8px;">${escapeHtml(text)}</p>` : '') +
        `<p class="small" style="color:#6b7280;margin:0 0 4px;">` +
        `<strong>Supplier:</strong> ${escapeHtml(supplierId)} &nbsp;|&nbsp; ` +
        `<strong>Author:</strong> ${escapeHtml(authorId)} &nbsp;|&nbsp; ` +
        `<strong>Submitted:</strong> ${escapeHtml(createdAt)}` +
        `</p>` +
        (moderationReason ? `<p class="small" style="color:#9ca3af;margin:0 0 10px;"><em>${escapeHtml(moderationReason)}</em></p>` : '') +
        `<div style="display:flex;gap:8px;">` +
        `<button class="btn btn-sm btn-success" data-action="approve" data-id="${escapeHtml(id)}">✓ Approve</button>` +
        `<button class="btn btn-sm btn-danger" data-action="reject" data-id="${escapeHtml(id)}">✗ Reject</button>` +
        `</div>` +
        `</div>` +
        `</div>`;

      fragment.appendChild(card);
    });

    queueEl.innerHTML = '';
    queueEl.appendChild(fragment);

    // Checkbox delegation
    queueEl.addEventListener('change', e => {
      const cb = e.target.closest('.review-checkbox');
      if (!cb) return;
      const reviewId = cb.dataset.id;
      if (cb.checked) {
        selectedIds.add(reviewId);
      } else {
        selectedIds.delete(reviewId);
      }
      updateBatchBar();
    });

    // Action delegation
    queueEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const reviewId = btn.dataset.id;
      if (action === 'approve') approveReview(reviewId);
      else if (action === 'reject') promptRejectReview(reviewId);
    });
  }

  // ── Approve / Reject ──────────────────────────────────────────────────────
  async function approveReview(reviewId) {
    try {
      await AdminShared.adminFetch(`/api/v2/admin/reviews/${encodeURIComponent(reviewId)}/approve`, {
        method: 'POST',
        body: {},
      });
      showToast('Review approved', 'success');
      reviews = reviews.filter(r => (r._id || r.id) !== reviewId);
      selectedIds.delete(reviewId);
      updateBatchBar();
      renderReviews();
    } catch (err) {
      console.error('Failed to approve review:', err);
      showToast('Failed to approve review', 'error');
    }
  }

  async function rejectReview(reviewId, reason) {
    try {
      await AdminShared.adminFetch(`/api/v2/admin/reviews/${encodeURIComponent(reviewId)}/reject`, {
        method: 'POST',
        body: { reason: reason || '' },
      });
      showToast('Review rejected', 'success');
      reviews = reviews.filter(r => (r._id || r.id) !== reviewId);
      selectedIds.delete(reviewId);
      updateBatchBar();
      renderReviews();
    } catch (err) {
      console.error('Failed to reject review:', err);
      showToast('Failed to reject review', 'error');
    }
  }

  async function promptRejectReview(reviewId) {
    if (AdminShared.showConfirmModal) {
      const result = await AdminShared.showConfirmModal({
        title: 'Reject Review',
        message: 'Are you sure you want to reject this review?',
      });
      if (!result || !result.confirmed) return;
    } else {
      if (!window.confirm('Reject this review?')) return;
    }
    await rejectReview(reviewId, '');
  }

  // ── Batch actions ─────────────────────────────────────────────────────────
  if (batchApproveBtn) {
    batchApproveBtn.addEventListener('click', async () => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      batchApproveBtn.disabled = true;
      for (const id of ids) {
        await approveReview(id);
      }
      batchApproveBtn.disabled = false;
    });
  }

  if (batchRejectBtn) {
    batchRejectBtn.addEventListener('click', async () => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      if (!window.confirm(`Reject ${ids.length} selected review(s)?`)) return;
      batchRejectBtn.disabled = true;
      for (const id of ids) {
        await rejectReview(id, '');
      }
      batchRejectBtn.disabled = false;
    });
  }

  // ── Initialise ────────────────────────────────────────────────────────────
  await loadAutoApproveFlag();
  await loadReviews();
})();
