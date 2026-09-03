(async function () {
  // ── Wait for AdminShared ──────────────────────────────────────────────────
  function waitForAdminShared(timeoutMs = 5000) {
    if (window.AdminShared) {
      return true;
    }
    const POLL_INTERVAL_MS = 50;
    return new Promise(resolve => {
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        if (window.AdminShared) {
          resolve(true);
        } else if (Date.now() >= deadline) {
          resolve(false);
        } else {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      };
      setTimeout(poll, POLL_INTERVAL_MS);
    });
  }

  const adminSharedReady = await waitForAdminShared();
  if (!adminSharedReady) {
    console.error('[admin-reviews] AdminShared not available — page cannot initialise');
    const q = document.getElementById('reviewQueue');
    if (q) {
      q.innerHTML =
        '<div class="card card-mt"><p class="text-danger">Admin utilities failed to load. Please reload the page.</p></div>';
    }
    return;
  }

  // ── Ensure CSRF token ──────────────────────────────────────────────────────
  async function ensureCSRFToken() {
    if (!window.__CSRF_TOKEN__) {
      await AdminShared.fetchCSRFToken();
    }
  }

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
  const selectedIds = new Set();

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
    if (!statusBanner) {
      return;
    }
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
      await ensureCSRFToken();
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
    if (!batchBar || !batchCount) {
      return;
    }
    if (selectedIds.size > 0) {
      batchBar.classList.add('active');
      batchCount.textContent = `${selectedIds.size} selected`;
    } else {
      batchBar.classList.remove('active');
    }
  }

  // ── Reviews loading ───────────────────────────────────────────────────────
  async function loadReviews() {
    if (!queueEl) {
      return;
    }
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
    if (!queueEl) {
      return;
    }

    if (reviews.length === 0) {
      queueEl.innerHTML = `<div class="card card-mt"><p>No pending reviews. ${
        autoApprove
          ? 'Qualifying reviews are being auto-approved.'
          : 'New reviews will appear here for moderation.'
      }</p></div>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    reviews.forEach(review => {
      const id = review.id || review._id || '';
      const card = document.createElement('div');
      card.className = 'card card-mt';
      card.dataset.reviewId = id;

      const rating = review.rating || review.moderation?.rating || 0;
      const stars =
        '★'.repeat(Math.max(0, Math.min(5, rating))) +
        '☆'.repeat(Math.max(0, 5 - Math.min(5, rating)));
      const title = review.title || '';
      const text = review.text || review.comment || '';
      const supplierId = review.supplierId || '';
      const authorId = review.authorId || '';
      const createdAt = review.createdAt ? formatDate(review.createdAt) : '—';
      const moderationState =
        (review.moderation && review.moderation.state) || review.status || 'pending';
      const moderationReason = (review.moderation && review.moderation.reason) || '';
      const flagged = review.flagged ? ' <span class="badge badge-warning">Reported</span>' : '';
      const reportInfo =
        Array.isArray(review.reports) && review.reports.length > 0
          ? `<p class="small review-report-warning">🚩 ${review.reports.length} report${review.reports.length !== 1 ? 's' : ''} received — review this content and take action below.</p>`
          : '';

      card.innerHTML =
        `<div style="display:flex;align-items:flex-start;gap:12px;">` +
        `<input type="checkbox" class="review-checkbox table-checkbox" data-id="${escapeHtml(id)}" aria-label="Select review ${escapeHtml(id)}">` +
        `<div style="flex:1;">` +
        `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">` +
        `<span class="rating-stars" aria-label="${escapeHtml(String(rating))} out of 5 stars">${escapeHtml(stars)}</span>${
          title ? `<strong>${escapeHtml(title)}</strong>` : ''
        }${
          flagged
        }<span class="badge badge-secondary" style="margin-left:auto;">${escapeHtml(moderationState)}</span>` +
        `</div>${
          text ? `<p style="margin:0 0 8px;">${escapeHtml(text)}</p>` : ''
        }<p class="small" style="color:#6b7280;margin:0 0 4px;">` +
        `<strong>Supplier:</strong> ${escapeHtml(supplierId)} &nbsp;|&nbsp; ` +
        `<strong>Author:</strong> ${escapeHtml(authorId)} &nbsp;|&nbsp; ` +
        `<strong>Submitted:</strong> ${escapeHtml(createdAt)}` +
        `</p>${
          moderationReason
            ? `<p class="small" style="color:#9ca3af;margin:0 0 10px;"><em>${escapeHtml(moderationReason)}</em></p>`
            : ''
        }${reportInfo}<div class="review-action-btns">` +
        `<button class="ef-cta btn btn-sm btn-danger" data-action="approve" data-id="${escapeHtml(id)}" title="The report is valid — remove this review from the platform">🗑️ Remove Review</button>` +
        `<button class="ef-cta btn btn-sm btn-success" data-action="reject" data-id="${escapeHtml(id)}" title="The report is not valid — keep the review published">✓ Dismiss Report</button>` +
        `</div>` +
        `</div>` +
        `</div>`;

      fragment.appendChild(card);
    });

    queueEl.innerHTML = '';
    queueEl.appendChild(fragment);
  }

  // ── Event delegation (set up once after DOM is ready) ──────────────────────
  if (queueEl) {
    // Checkbox delegation
    queueEl.addEventListener('change', e => {
      const cb = e.target.closest('.review-checkbox');
      if (!cb) {
        return;
      }
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
      const btn = e.target.closest('button[data-action]');
      if (!btn) {
        return;
      }
      const action = btn.dataset.action;
      const reviewId = btn.dataset.id;
      if (action === 'approve') {
        promptRemoveReview(reviewId);
      } else if (action === 'reject') {
        promptDismissReport(reviewId);
      }
    });
  }

  // ── Remove Review / Dismiss Report ────────────────────────────────────────
  async function removeReview(reviewId) {
    try {
      await ensureCSRFToken();
      await AdminShared.adminFetch(`/api/v2/admin/reviews/${encodeURIComponent(reviewId)}/reject`, {
        method: 'POST',
        body: { reason: 'Review removed following valid report' },
      });
      showToast('Review removed from the platform', 'success');
      reviews = reviews.filter(r => (r.id || r._id) !== reviewId);
      selectedIds.delete(reviewId);
      updateBatchBar();
      renderReviews();
    } catch (err) {
      console.error('Failed to remove review:', err);
      showToast('Failed to remove review', 'error');
    }
  }

  async function dismissReport(reviewId) {
    try {
      await ensureCSRFToken();
      await AdminShared.adminFetch(
        `/api/v2/admin/reviews/${encodeURIComponent(reviewId)}/approve`,
        {
          method: 'POST',
        }
      );
      showToast('Report dismissed — review remains published', 'success');
      reviews = reviews.filter(r => (r.id || r._id) !== reviewId);
      selectedIds.delete(reviewId);
      updateBatchBar();
      renderReviews();
    } catch (err) {
      console.error('Failed to dismiss report:', err);
      showToast('Failed to dismiss report', 'error');
    }
  }

  async function promptRemoveReview(reviewId) {
    if (typeof AdminShared.showConfirmModal !== 'function') {
      showToast('Admin utilities not available. Please reload the page.', 'error');
      return;
    }
    const result = await AdminShared.showConfirmModal({
      title: 'Remove Review',
      message:
        'The report is valid — this review will be permanently removed from the platform. Continue?',
    });
    if (!result) {
      return;
    }
    await removeReview(reviewId);
  }

  async function promptDismissReport(reviewId) {
    if (typeof AdminShared.showConfirmModal !== 'function') {
      showToast('Admin utilities not available. Please reload the page.', 'error');
      return;
    }
    const result = await AdminShared.showConfirmModal({
      title: 'Dismiss Report',
      message: 'The report is not valid — the review will remain published. Continue?',
    });
    if (!result) {
      return;
    }
    await dismissReport(reviewId);
  }

  // ── Batch actions ─────────────────────────────────────────────────────────
  if (batchApproveBtn) {
    batchApproveBtn.addEventListener('click', async () => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) {
        return;
      }
      if (typeof AdminShared.showConfirmModal !== 'function') {
        showToast('Admin utilities not available. Please reload the page.', 'error');
        return;
      }
      const result = await AdminShared.showConfirmModal({
        title: 'Remove Selected Reviews',
        message: `Remove ${ids.length} selected review(s) from the platform?`,
      });
      if (!result) {
        return;
      }
      batchApproveBtn.disabled = true;
      for (const id of ids) {
        await removeReview(id);
      }
      batchApproveBtn.disabled = false;
    });
  }

  if (batchRejectBtn) {
    batchRejectBtn.addEventListener('click', async () => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) {
        return;
      }
      if (typeof AdminShared.showConfirmModal !== 'function') {
        showToast('Admin utilities not available. Please reload the page.', 'error');
        return;
      }
      const result = await AdminShared.showConfirmModal({
        title: 'Dismiss Selected Reports',
        message: `Dismiss reports for ${ids.length} selected review(s) and keep them published?`,
      });
      if (!result) {
        return;
      }
      batchRejectBtn.disabled = true;
      for (const id of ids) {
        await dismissReport(id);
      }
      batchRejectBtn.disabled = false;
    });
  }

  // ── Initialise ────────────────────────────────────────────────────────────
  await loadAutoApproveFlag();
  await loadReviews();
})();
