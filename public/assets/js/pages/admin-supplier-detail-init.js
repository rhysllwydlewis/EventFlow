(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const supplierId = urlParams.get('id');

  if (!supplierId) {
    AdminShared.showToast('No supplier ID provided', 'error');
    setTimeout(() => (window.location.href = '/admin'), 2000);
    return;
  }

  let supplierData = null;
  let verificationAuditLoaded = false;

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tabEl = document.getElementById(tab);
      tabEl.classList.add('active');
      // Smooth scroll to top of tab content area
      tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // Lazy-load verification audit only once
      if (tab === 'verification' && !verificationAuditLoaded) {
        loadVerificationAudit();
      }
    });
  });

  // Load supplier data
  async function loadSupplier() {
    const header = document.getElementById('supplierHeader');
    if (header) {
      header.classList.add('is-loading');
    }
    try {
      const response = await AdminShared.api(`/api/admin/suppliers/${supplierId}`);
      supplierData = response.supplier || response;
      renderSupplier();
      loadPackages();
      loadPhotos();
      loadReviews();
      loadAnalytics();
    } catch (err) {
      console.error('Failed to load supplier:', err);
      AdminShared.showToast('Failed to load supplier details', 'error');
      if (header) {
        header.innerHTML =
          '<p class="empty-state-card"><span class="empty-icon">⚠️</span><br>Failed to load supplier. <a href="" onclick="location.reload()">Retry</a></p>';
      }
    } finally {
      if (header) {
        header.classList.remove('is-loading');
      }
    }
  }

  function renderSupplier() {
    if (!supplierData) {
      return;
    }

    document.getElementById('supplierName').textContent = supplierData.name || 'Unknown Supplier';

    let statusHtml = '';
    const vs =
      supplierData.verificationStatus || (supplierData.verified ? 'approved' : 'unverified');

    const STATE_BADGE = {
      unverified: '<span class="badge badge-secondary">Unverified</span>',
      pending_review: '<span class="badge badge-warning">Pending Review</span>',
      needs_changes: '<span class="badge badge-warning">Needs Changes</span>',
      approved: '<span class="badge badge-success">Approved</span>',
      verified: '<span class="badge badge-success">Approved</span>', // legacy
      rejected: '<span class="badge badge-danger">Rejected</span>',
      suspended: '<span class="badge badge-danger">Suspended</span>',
    };
    statusHtml += `${STATE_BADGE[vs] || `<span class="badge badge-secondary">${vs}</span>`} `;

    if (supplierData.approved) {
      statusHtml += '<span class="badge badge-info">Listing Active</span>';
    }

    document.getElementById('supplierStatus').innerHTML = statusHtml;

    const metaHtml = `
      <div class="supplier-meta-item">
        <strong>ID:</strong> ${AdminShared.escapeHtml(String(supplierData.id || supplierData._id || ''))}
      </div>
      <div class="supplier-meta-item">
        <strong>Email:</strong> <a href="mailto:${AdminShared.escapeHtml(supplierData.email || '')}">${AdminShared.escapeHtml(supplierData.email || 'Not provided')}</a>
      </div>
      ${supplierData.description_short || supplierData.blurb ? `<div class="supplier-meta-item supplier-meta-description"><strong>Description:</strong> ${AdminShared.escapeHtml(supplierData.description_short || supplierData.blurb || '')}</div>` : ''}
      <div class="supplier-meta-item">
        <strong>Verified:</strong> ${
          supplierData.verified
            ? `<span style="color: #10b981;">Yes</span> ${supplierData.verifiedAt ? `(${new Date(supplierData.verifiedAt).toLocaleDateString()})` : ''}`
            : '<span style="color: #ef4444;">No</span>'
        }
      </div>
      <div class="supplier-meta-item">
        <strong>Verification Status:</strong> ${AdminShared.escapeHtml(supplierData.verificationStatus || 'unverified')}
      </div>
      ${supplierData.verificationNotes ? `<div class="supplier-meta-item"><strong>Verification Notes:</strong> ${AdminShared.escapeHtml(supplierData.verificationNotes)}</div>` : ''}
      <div class="supplier-meta-item">
        <strong>Health Score:</strong> ${supplierData.healthScore || 0}/100
      </div>
      <div class="supplier-meta-item">
        <strong>Pro Plan:</strong> ${AdminShared.escapeHtml(supplierData.proPlan || 'None')}
      </div>
    `;
    document.getElementById('supplierMeta').innerHTML = metaHtml;

    // Update button visibility based on current verification state
    const stateForButtons =
      supplierData.verificationStatus || (supplierData.verified ? 'approved' : 'unverified');

    const verifyBtn = document.getElementById('verifySupplierBtn');
    if (verifyBtn) {
      if (stateForButtons === 'approved' || stateForButtons === 'verified') {
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Already Approved';
        verifyBtn.title = 'This supplier has already been approved';
      } else {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify Supplier';
        verifyBtn.title = "Manually verify this supplier's identity";
      }
    }

    // Approve button: enabled unless already approved; shows "Reinstate" when suspended
    const approveBtn = document.getElementById('approveBtn');
    if (approveBtn) {
      const canApprove = [
        'unverified',
        'pending_review',
        'needs_changes',
        'rejected',
        'suspended',
        'pending',
      ].includes(stateForButtons);
      approveBtn.disabled = !canApprove;
      approveBtn.textContent = stateForButtons === 'suspended' ? 'Reinstate' : 'Approve';
    }

    // Request Changes: only from pending_review
    const reqChangesBtn = document.getElementById('requestChangesBtn');
    if (reqChangesBtn) {
      reqChangesBtn.disabled = stateForButtons !== 'pending_review';
    }

    // Reject: cannot reject if already rejected
    const rejectBtn = document.getElementById('rejectBtn');
    if (rejectBtn) {
      rejectBtn.disabled = stateForButtons === 'rejected';
    }

    // Suspend: only when approved
    const suspendBtn = document.getElementById('suspendBtn');
    if (suspendBtn) {
      suspendBtn.disabled = stateForButtons !== 'approved' && stateForButtons !== 'verified';
    }

    // Business info
    const businessHtml = `
      <div class="info-field">
        <label>Business Name</label>
        <value>${AdminShared.escapeHtml(supplierData.name || '')}</value>
      </div>
      <div class="info-field">
        <label>Description</label>
        <value>${AdminShared.escapeHtml(supplierData.description || 'No description')}</value>
      </div>
      <div class="info-field">
        <label>Location</label>
        <value>${AdminShared.escapeHtml(supplierData.location || 'Not specified')}</value>
      </div>
      <div class="info-field">
        <label>Website</label>
        <value>${supplierData.website && /^https?:\/\//i.test(supplierData.website) ? `<a href="${AdminShared.escapeHtml(supplierData.website)}" target="_blank" rel="noopener noreferrer">${AdminShared.escapeHtml(supplierData.website)}</a>` : AdminShared.escapeHtml(supplierData.website || 'Not provided')}</value>
      </div>
      <div class="info-field">
        <label>Tags</label>
        <value>${(supplierData.tags || []).join(', ') || 'No tags'}</value>
      </div>
      <div class="info-field">
        <label>Created</label>
        <value>${supplierData.createdAt ? new Date(supplierData.createdAt).toLocaleString() : 'Unknown'}</value>
      </div>
    `;
    document.getElementById('businessInfo').innerHTML = businessHtml;

    // Contact info
    const contactHtml = `
      <div class="info-field">
        <label>Email</label>
        <value><a href="mailto:${AdminShared.escapeHtml(supplierData.email || '')}">${AdminShared.escapeHtml(supplierData.email || 'Not provided')}</a></value>
      </div>
      <div class="info-field">
        <label>Phone</label>
        <value>${supplierData.phone || 'Not provided'}</value>
      </div>
      <div class="info-field">
        <label>Address</label>
        <value>${AdminShared.escapeHtml(supplierData.address || 'Not provided')}</value>
      </div>
    `;
    document.getElementById('contactInfo').innerHTML = contactHtml;

    // Pro plan info — support both new subscription schema and legacy fields
    const sub = supplierData.subscription;
    const hasActiveSub =
      (sub && sub.tier && sub.tier !== 'free' && sub.status === 'active') ||
      (supplierData.proPlan && supplierData.proPlanExpiry) ||
      supplierData.isPro; // simple isPro boolean set by /pro endpoint

    let proPlanHtml = '<p>No active subscription</p>';
    if (hasActiveSub) {
      const tierLabel =
        sub?.tier === 'pro_plus' || supplierData.proPlan === 'Pro+' ? 'Pro+' : 'Pro';
      const expiryDate = sub?.endDate || supplierData.proPlanExpiry || supplierData.proExpiresAt;
      const expiryDisplay = expiryDate ? new Date(expiryDate).toLocaleString() : 'No expiry set';
      proPlanHtml = `
        <p><strong>Plan:</strong> ${tierLabel}</p>
        <p><strong>Expires:</strong> ${expiryDisplay}</p>
        <p><strong>Status:</strong> ${sub?.status || 'active'}</p>
      `;
    }

    // Always show grant/remove controls
    proPlanHtml += `
      <div style="margin-top: 1rem; border-top: 1px solid #e5e7eb; padding-top: 1rem;">
        <h4 style="margin-bottom: 0.75rem; font-size: 0.9rem; font-weight: 600;">Manage Subscription</h4>
        <label for="subscriptionTier" style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Tier:</label>
        <select id="subscriptionTier" class="form-control" style="margin-bottom: 1rem;">
          <option value="pro">Pro</option>
          <option value="pro_plus">Pro Plus</option>
        </select>
        <label for="subscriptionDuration" style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Duration:</label>
        <select id="subscriptionDuration" class="form-control" style="margin-bottom: 1rem;">
          <option value="7">7 days (Trial)</option>
          <option value="14">14 days (Trial)</option>
          <option value="30" selected>30 days (1 Month)</option>
          <option value="60">60 days (2 Months)</option>
          <option value="90">90 days (3 Months)</option>
          <option value="180">180 days (6 Months)</option>
          <option value="365">365 days (1 Year)</option>
        </select>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <button class="btn btn-primary" id="grantProBtn">Grant / Extend</button>
          ${hasActiveSub ? '<button class="btn btn-secondary" id="cancelProBtn">Remove Subscription</button>' : ''}
        </div>
      </div>
    `;
    document.getElementById('proPlanInfo').innerHTML = proPlanHtml;
  }

  async function loadPackages() {
    try {
      const response = await AdminShared.api(`/api/admin/packages?supplierId=${supplierId}`);
      const packages = response.items || [];

      if (packages.length === 0) {
        document.getElementById('packageList').innerHTML =
          '<div class="empty-state-card"><span class="empty-icon">📦</span><p>No packages yet</p></div>';
        return;
      }

      const html = packages
        .map(
          pkg => `
        <div class="package-item">
          <div class="package-info">
            <h4><a href="/package?id=${pkg.id}" target="_blank">${AdminShared.escapeHtml(pkg.title)}</a></h4>
            <p>${AdminShared.escapeHtml(pkg.price_display || pkg.price || 'Price not set')} • ${pkg.approved ? 'Approved' : 'Pending'}</p>
          </div>
          <div class="flex-gap">
            <button class="btn btn-small btn-primary" onclick="window.open('/package?id=${pkg.id}', '_blank')">View</button>
            <button class="btn btn-small btn-secondary" data-action="editPackage" data-id="${pkg.id}">Edit</button>
            ${!pkg.approved ? `<button class="btn btn-small btn-success" data-action="approvePackage" data-id="${pkg.id}">Approve</button>` : ''}
          </div>
        </div>
      `
        )
        .join('');
      document.getElementById('packageList').innerHTML = html;
    } catch (err) {
      console.error('Failed to load packages:', err);
      document.getElementById('packageList').innerHTML =
        '<div class="empty-state-card"><span class="empty-icon">⚠️</span><p>Failed to load packages</p></div>';
    }
  }

  async function loadPhotos() {
    try {
      const response = await AdminShared.api(`/api/admin/photos?supplierId=${supplierId}`);
      const photos = response.photos || [];

      if (photos.length === 0) {
        document.getElementById('photoGallery').innerHTML =
          '<div class="empty-state-card"><span class="empty-icon">📸</span><p>No photos yet</p></div>';
        return;
      }

      const html = photos
        .map(photo => {
          // Sanitise photo URL — only allow http/https URLs
          const safeUrl =
            photo.url && /^https?:\/\//i.test(photo.url) ? AdminShared.escapeHtml(photo.url) : '';
          return `
        <div class="photo-item">
          ${safeUrl ? `<img src="${safeUrl}" alt="Supplier photo" loading="lazy">` : '<div class="photo-placeholder">No image</div>'}
          <div class="photo-actions">
            <button class="btn btn-small btn-danger" data-action="deletePhoto" data-id="${AdminShared.escapeHtml(String(photo.id || ''))}">Delete</button>
          </div>
        </div>
      `;
        })
        .join('');
      document.getElementById('photoGallery').innerHTML = html;
    } catch (err) {
      console.error('Failed to load photos:', err);
      document.getElementById('photoGallery').innerHTML =
        '<div class="empty-state-card"><span class="empty-icon">⚠️</span><p>Failed to load photos</p></div>';
    }
  }

  async function loadReviews() {
    try {
      const response = await AdminShared.api(`/api/admin/reviews?supplierId=${supplierId}`);
      const reviews = response.reviews || [];

      if (reviews.length === 0) {
        document.getElementById('reviewsList').innerHTML =
          '<div class="empty-state-card"><span class="empty-icon">⭐</span><p>No reviews yet</p></div>';
        return;
      }

      const html = reviews
        .map(review => {
          const rating = Math.min(5, Math.max(0, Math.round(review.rating || 0)));
          const starsHtml =
            '★'.repeat(rating) + '<span style="opacity:0.25">★</span>'.repeat(5 - rating);
          return `
        <div class="border-bottom-pad">
          <div class="flex-between-start">
            <div>
              <strong>${AdminShared.escapeHtml(review.userName || 'Anonymous')}</strong>
              <span class="small"> • ${new Date(review.createdAt).toLocaleDateString()}</span>
            </div>
            <div class="stars-gold" aria-label="${rating} out of 5 stars">${starsHtml}</div>
          </div>
          <p>${AdminShared.escapeHtml(review.comment || '')}</p>
        </div>
      `;
        })
        .join('');
      document.getElementById('reviewsList').innerHTML = html;
    } catch (err) {
      console.error('Failed to load reviews:', err);
      document.getElementById('reviewsList').innerHTML =
        '<div class="empty-state-card"><span class="empty-icon">⚠️</span><p>Failed to load reviews</p></div>';
    }
  }

  async function loadAnalytics() {
    // Real analytics are not currently implemented
    // Show "Not configured" state instead of fake data
    document.getElementById('totalViews').textContent = '—';
    document.getElementById('totalBookings').textContent = '—';
    document.getElementById('avgRating').textContent = '—';
    document.getElementById('healthScore').textContent = supplierData?.healthScore || '—';

    // Add a note below the analytics section if it exists
    const analyticsSection = document.querySelector('.stats-grid');
    if (analyticsSection && !analyticsSection.querySelector('.analytics-note')) {
      const note = document.createElement('p');
      note.className = 'analytics-note small';
      note.style.color = '#6b7280';
      note.style.marginTop = '1rem';
      note.textContent = 'Analytics data not yet configured';
      analyticsSection.appendChild(note);
    }
  }

  async function loadVerificationAudit() {
    const container = document.getElementById('verificationTimeline');
    if (!container) {
      return;
    }

    verificationAuditLoaded = true;

    try {
      const data = await AdminShared.api(`/api/admin/suppliers/${supplierId}/audit`);
      const entries = data.audit || [];

      if (entries.length === 0) {
        container.innerHTML = '<p class="timeline-empty">No verification events recorded yet.</p>';
        return;
      }

      const ACTION_LABELS = {
        supplier_approved: '✅ Approved',
        supplier_rejected: '❌ Rejected',
        supplier_needs_changes: '⚠️ Changes Requested',
        supplier_suspended: '🚫 Suspended',
        supplier_reinstated: '🔄 Reinstated',
        supplier_verified: '✅ Verified',
        supplier_verification_submitted: '📋 Submitted for Review',
      };

      const ACTION_CLASS = {
        supplier_approved: 'entry-approved',
        supplier_verified: 'entry-approved',
        supplier_rejected: 'entry-rejected',
        supplier_needs_changes: 'entry-needs_changes',
        supplier_suspended: 'entry-suspended',
        supplier_reinstated: 'entry-approved',
        supplier_verification_submitted: 'entry-submitted',
      };

      container.innerHTML = entries
        .map(entry => {
          const label = ACTION_LABELS[entry.action] || entry.action.replace(/_/g, ' ');
          const cls = ACTION_CLASS[entry.action] || '';
          const ts = entry.timestamp
            ? new Date(entry.timestamp).toLocaleString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'Unknown time';

          const notesText = entry.details?.notes || entry.details?.reason || '';
          const notesHtml = notesText
            ? `<div class="timeline-notes">"${AdminShared.escapeHtml(notesText)}"</div>`
            : '';

          return `
            <div class="timeline-entry ${cls}">
              <div class="timeline-action">${label}</div>
              <div class="timeline-actor">by ${AdminShared.escapeHtml(entry.actor || 'System')} · ${ts}</div>
              ${notesHtml}
            </div>
          `;
        })
        .join('');
    } catch (err) {
      console.error('Failed to load verification audit:', err);
      container.innerHTML = '<p class="timeline-empty">Unable to load verification history.</p>';
    }
  }

  // Action handlers

  // Edit Details handler — opens a modal to edit key supplier fields
  document.getElementById('editSupplierBtn')?.addEventListener('click', async () => {
    if (!supplierData) {
      AdminShared.showToast('Supplier data not loaded yet', 'error');
      return;
    }

    const EDITABLE_FIELDS = [
      { key: 'name', label: 'Business Name' },
      { key: 'category', label: 'Category' },
      { key: 'location', label: 'Location' },
      { key: 'price_display', label: 'Price Display' },
      { key: 'website', label: 'Website URL' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'description_short', label: 'Short Description' },
    ];

    // Build a select-dropdown modal so the user doesn't have to type the field name exactly
    const matched = await new Promise(resolve => {
      // Lock body scroll (consistent with AdminShared modals)
      const originalOverflow = document.body.style.overflow;
      const originalPaddingRight = document.body.style.paddingRight;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }

      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;' +
        'align-items:center;justify-content:center;z-index:10001;animation:fadeIn 0.2s ease;';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'edit-field-modal-title');

      const optionsHtml = EDITABLE_FIELDS.map(
        f => `<option value="${f.key}">${f.label}</option>`
      ).join('');

      const dialog = document.createElement('div');
      dialog.style.cssText =
        'background:white;border-radius:8px;padding:1.5rem;max-width:480px;width:90%;' +
        'box-shadow:0 10px 40px rgba(0,0,0,0.3);animation:slideUp 0.3s ease;';
      dialog.innerHTML = `
        <h3 id="edit-field-modal-title" style="margin:0 0 0.5rem 0;font-size:1.25rem;font-weight:600;color:#1f2937;">
          Edit Supplier — Select Field
        </h3>
        <p style="margin:0 0 1rem 0;color:#6b7280;font-size:0.875rem;line-height:1.5;">Choose the field you would like to edit:</p>
        <div style="margin-bottom:1rem;">
          <label for="edit-field-select" style="display:block;margin-bottom:0.5rem;font-weight:600;color:#374151;font-size:0.875rem;">Field</label>
          <select id="edit-field-select" style="width:100%;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:6px;font-size:0.875rem;background:white;cursor:pointer;">
            ${optionsHtml}
          </select>
        </div>
        <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
          <button id="edit-field-cancel" style="padding:0.5rem 1rem;border:1px solid #d1d5db;background:white;color:#374151;border-radius:6px;cursor:pointer;font-size:0.875rem;font-weight:500;">Cancel</button>
          <button id="edit-field-confirm" style="padding:0.5rem 1rem;border:none;background:#3b82f6;color:white;border-radius:6px;cursor:pointer;font-size:0.875rem;font-weight:500;">Confirm</button>
        </div>
      `;

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      // Restore scroll on close
      const cleanup = () => {
        overlay.remove();
        document.body.style.overflow = originalOverflow;
        document.body.style.paddingRight = originalPaddingRight;
      };

      // Auto-focus the select
      setTimeout(() => {
        const sel = dialog.querySelector('#edit-field-select');
        if (sel) sel.focus();
      }, 50);

      dialog.querySelector('#edit-field-confirm').addEventListener('click', () => {
        const key = dialog.querySelector('#edit-field-select').value;
        cleanup();
        resolve(EDITABLE_FIELDS.find(f => f.key === key) || null);
      });

      dialog.querySelector('#edit-field-cancel').addEventListener('click', () => {
        cleanup();
        resolve(null);
      });

      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          cleanup();
          resolve(null);
        }
      });

      // Escape key closes the modal
      const onKeyDown = e => {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', onKeyDown);
          cleanup();
          resolve(null);
        }
      };
      document.addEventListener('keydown', onKeyDown);
    });

    if (!matched) {
      return;
    }

    const valueResult = await AdminShared.showInputModal({
      title: `Edit — ${matched.label}`,
      message: `Enter a new value for "${matched.label}":`,
      label: matched.label,
      initialValue: String(supplierData[matched.key] || ''),
      placeholder: `New ${matched.label}`,
      required: false,
      type: matched.key === 'description_short' ? 'textarea' : 'text',
    });

    if (!valueResult.confirmed) {
      return;
    }

    try {
      await AdminShared.api(`/api/admin/suppliers/${supplierId}`, 'PUT', {
        [matched.key]: valueResult.value,
      });
      AdminShared.showToast(`${matched.label} updated successfully`, 'success');
      loadSupplier();
    } catch (err) {
      AdminShared.showToast(`Failed to update: ${err.message || 'Unknown error'}`, 'error');
    }
  });

  // Add New Package handler — navigate to admin packages page
  document.getElementById('addPackageBtn')?.addEventListener('click', () => {
    window.location.href = `/admin-packages?supplierId=${encodeURIComponent(supplierId)}`;
  });

  // Upload Photo handler — navigate to admin photos page
  document.getElementById('uploadPhotoBtn')?.addEventListener('click', () => {
    window.location.href = `/admin-photos?supplierId=${encodeURIComponent(supplierId)}`;
  });

  // Delete Supplier handler — double-confirm before deleting
  document.getElementById('deleteSupplierBtn')?.addEventListener('click', async () => {
    const name = supplierData ? supplierData.name || 'this supplier' : 'this supplier';

    const first = await AdminShared.showConfirmModal({
      title: '⚠️ Delete Supplier',
      message: `Are you sure you want to permanently delete "${AdminShared.escapeHtml(name)}"? This cannot be undone.`,
      confirmText: 'Yes, delete',
      cancelText: 'Cancel',
    });
    if (!first) {
      return;
    }

    const second = await AdminShared.showConfirmModal({
      title: '🚨 Final Confirmation',
      message: `This will permanently delete all data for "${AdminShared.escapeHtml(name)}". There is NO recovery. Proceed?`,
      confirmText: 'Delete permanently',
      cancelText: 'Cancel',
    });
    if (!second) {
      return;
    }

    try {
      await AdminShared.api(`/api/admin/suppliers/${supplierId}`, 'DELETE');
      AdminShared.showToast('Supplier deleted successfully', 'success');
      setTimeout(() => (window.location.href = '/admin-suppliers'), 1500);
    } catch (err) {
      AdminShared.showToast(
        `Failed to delete supplier: ${err.message || 'Unknown error'}`,
        'error'
      );
    }
  });

  // Delegated handler for package and photo action buttons
  document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) {
      return;
    }
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'editPackage') {
      window.location.href = `/admin-packages?id=${encodeURIComponent(id)}`;
    } else if (action === 'approvePackage') {
      if (
        !(await AdminShared.showConfirmModal({
          title: 'Approve Package',
          message: 'Approve this package so it becomes publicly visible?',
          confirmText: 'Approve',
        }))
      ) {
        return;
      }
      try {
        await AdminShared.api(`/api/admin/packages/${id}/approve`, 'POST', { approved: true });
        AdminShared.showToast('Package approved', 'success');
        loadPackages();
      } catch (err) {
        AdminShared.showToast(
          `Failed to approve package: ${err.message || 'Unknown error'}`,
          'error'
        );
      }
    } else if (action === 'deletePhoto') {
      if (
        !(await AdminShared.showConfirmModal({
          title: 'Delete Photo',
          message: 'Permanently delete this photo? This cannot be undone.',
          confirmText: 'Delete',
        }))
      ) {
        return;
      }
      try {
        await AdminShared.api(`/api/admin/photos/${id}`, 'DELETE');
        AdminShared.showToast('Photo deleted', 'success');
        loadPhotos();
      } catch (err) {
        AdminShared.showToast(`Failed to delete photo: ${err.message || 'Unknown error'}`, 'error');
      }
    }
  });

  document.getElementById('approveBtn')?.addEventListener('click', async () => {
    const isSuspended = supplierData?.verificationStatus === 'suspended';
    const actionTitle = isSuspended ? 'Reinstate Supplier' : 'Approve Supplier';
    const actionMessage = isSuspended
      ? 'Reinstate this supplier? They will be fully approved and visible again.'
      : 'Approve this supplier? You can add optional notes.';
    const successMessage = isSuspended ? 'Supplier reinstated' : 'Supplier approved';

    const notesResult = await AdminShared.showInputModal({
      title: actionTitle,
      message: actionMessage,
      label: 'Notes (optional)',
      placeholder: 'e.g., Documents verified, identity confirmed.',
      required: false,
      type: 'textarea',
    });

    if (!notesResult.confirmed) {
      return;
    }

    try {
      await AdminShared.api(`/api/admin/suppliers/${supplierId}/approve`, 'POST', {
        notes: notesResult.value || '',
      });
      AdminShared.showToast(successMessage, 'success');
      loadSupplier();
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message || 'Unknown error'}`, 'error');
    }
  });

  document.getElementById('rejectBtn')?.addEventListener('click', async () => {
    const reasonResult = await AdminShared.showInputModal({
      title: 'Reject Supplier',
      message: 'Please provide a reason for rejecting this supplier.',
      label: 'Rejection Reason',
      placeholder: 'e.g., Incomplete documentation, failed identity check, etc.',
      required: true,
      type: 'textarea',
    });

    if (!reasonResult.confirmed) {
      return;
    }

    try {
      await AdminShared.api(`/api/admin/suppliers/${supplierId}/reject`, 'POST', {
        reason: reasonResult.value,
      });
      AdminShared.showToast('Supplier rejected', 'success');
      loadSupplier();
    } catch (err) {
      AdminShared.showToast(
        `Failed to reject supplier: ${err.message || 'Unknown error'}`,
        'error'
      );
    }
  });

  document.getElementById('requestChangesBtn')?.addEventListener('click', async () => {
    const reasonResult = await AdminShared.showInputModal({
      title: 'Request Changes',
      message: 'Describe what changes the supplier needs to make before approval.',
      label: 'Changes Required',
      placeholder: 'e.g., Please upload proof of insurance and update your business address.',
      required: true,
      type: 'textarea',
    });

    if (!reasonResult.confirmed) {
      return;
    }

    try {
      await AdminShared.api(`/api/admin/suppliers/${supplierId}/request-changes`, 'POST', {
        reason: reasonResult.value,
      });
      AdminShared.showToast('Changes requested from supplier', 'success');
      loadSupplier();
    } catch (err) {
      AdminShared.showToast(
        `Failed to request changes: ${err.message || 'Unknown error'}`,
        'error'
      );
    }
  });

  document.getElementById('suspendBtn')?.addEventListener('click', async () => {
    const reasonResult = await AdminShared.showInputModal({
      title: 'Suspend Supplier',
      message: 'Please provide a reason for suspending this supplier.',
      label: 'Suspension Reason',
      placeholder: 'e.g., Reported policy violation under investigation.',
      required: true,
      type: 'textarea',
    });

    if (!reasonResult.confirmed) {
      return;
    }

    try {
      await AdminShared.api(`/api/admin/suppliers/${supplierId}/suspend`, 'POST', {
        reason: reasonResult.value,
      });
      AdminShared.showToast('Supplier suspended', 'success');
      loadSupplier();
    } catch (err) {
      AdminShared.showToast(
        `Failed to suspend supplier: ${err.message || 'Unknown error'}`,
        'error'
      );
    }
  });

  document.getElementById('verifySupplierBtn')?.addEventListener('click', async () => {
    const notesResult = await AdminShared.showInputModal({
      title: 'Verify Supplier',
      message: 'Add any notes about this verification (optional)',
      label: 'Verification Notes',
      placeholder: 'e.g., Documents checked, identity confirmed, etc.',
      required: false,
      type: 'textarea',
    });

    if (!notesResult.confirmed) {
      return;
    } // User cancelled

    try {
      await AdminShared.api(`/api/admin/suppliers/${supplierId}/verify`, 'POST', {
        verified: true,
        verificationNotes: notesResult.value || 'Manual verification by admin',
      });
      AdminShared.showToast('Supplier verified successfully', 'success');
      loadSupplier();
    } catch (err) {
      console.error('Verify supplier error:', err);
      AdminShared.showToast(
        `Failed to verify supplier: ${err.message || 'Unknown error'}`,
        'error'
      );
    }
  });

  // Grant subscription handler (delegated event)
  document.addEventListener('click', async e => {
    if (e.target && e.target.id === 'grantProBtn') {
      const tierSelect = document.getElementById('subscriptionTier');
      const durationSelect = document.getElementById('subscriptionDuration');

      if (!tierSelect || !durationSelect) {
        AdminShared.showToast('Unable to find subscription options', 'error');
        return;
      }

      const tier = tierSelect.value;
      const days = parseInt(durationSelect.value);
      const tierName = tier === 'pro_plus' ? 'Pro Plus' : 'Pro';

      if (
        !(await AdminShared.showConfirmModal({
          title: 'Grant Subscription',
          message: `Grant ${tierName} subscription for ${days} days to this supplier?`,
          confirmText: 'Grant',
        }))
      ) {
        return;
      }

      try {
        await AdminShared.api(`/api/admin/suppliers/${supplierId}/subscription`, 'POST', {
          tier: tier,
          days: days,
        });

        AdminShared.showToast(`${tierName} subscription granted for ${days} days`, 'success');
        loadSupplier();
      } catch (err) {
        console.error('Grant subscription error:', err);
        AdminShared.showToast(
          `Failed to grant subscription: ${err.message || 'Unknown error'}`,
          'error'
        );
      }
    }
  });

  // Cancel/Remove subscription handler (delegated event)
  document.addEventListener('click', async e => {
    if (e.target && e.target.id === 'cancelProBtn') {
      if (
        !(await AdminShared.showConfirmModal({
          title: 'Remove Subscription',
          message:
            "Remove this supplier's subscription? They will lose Pro/Pro+ features immediately.",
          confirmText: 'Remove',
        }))
      ) {
        return;
      }

      try {
        await AdminShared.api(`/api/admin/suppliers/${supplierId}/subscription`, 'DELETE');
        AdminShared.showToast('Subscription removed successfully', 'success');
        loadSupplier();
      } catch (err) {
        console.error('Remove subscription error:', err);
        AdminShared.showToast(
          `Failed to remove subscription: ${err.message || 'Unknown error'}`,
          'error'
        );
      }
    }
  });

  // Highlight active page in top navbar
  const currentPath = window.location.pathname;
  document.querySelectorAll('.admin-nav-btn').forEach(link => {
    if (link.getAttribute('href') === currentPath) {
      link.classList.add('active');
    }
  });

  // Load badge counts
  AdminShared.loadBadgeCounts?.();

  // Initial load
  loadSupplier();
})();
