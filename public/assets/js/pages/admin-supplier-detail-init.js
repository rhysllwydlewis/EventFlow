(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const supplierId = urlParams.get('id');

  if (!supplierId) {
    AdminShared.showToast('No supplier ID provided', 'error');
    setTimeout(() => (window.location.href = '/admin'), 2000);
    return;
  }

  let supplierData = null;

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(tab).classList.add('active');
      // Lazy-load verification audit when that tab is first opened
      if (tab === 'verification') {
        loadVerificationAudit();
      }
    });
  });

  // Load supplier data
  async function loadSupplier() {
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
        <strong>ID:</strong> ${supplierData.id || supplierData._id}
      </div>
      <div class="supplier-meta-item">
        <strong>Email:</strong> <a href="mailto:${supplierData.email}">${supplierData.email}</a>
      </div>
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
        <strong>Pro Plan:</strong> ${supplierData.proPlan || 'None'}
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
        <value>${supplierData.website ? `<a href="${supplierData.website}" target="_blank">${supplierData.website}</a>` : 'Not provided'}</value>
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
        <value><a href="mailto:${supplierData.email}">${supplierData.email}</a></value>
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
      (supplierData.proPlan && supplierData.proPlanExpiry);

    let proPlanHtml = '<p>No active subscription</p>';
    if (hasActiveSub) {
      const tierLabel =
        sub?.tier === 'pro_plus' || supplierData.proPlan === 'Pro+' ? 'Pro+' : 'Pro';
      const expiryDate = sub?.endDate || supplierData.proPlanExpiry;
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
        document.getElementById('packageList').innerHTML = '<p class="small">No packages yet</p>';
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
        '<p class="small">Failed to load packages</p>';
    }
  }

  async function loadPhotos() {
    try {
      const response = await AdminShared.api(`/api/admin/photos?supplierId=${supplierId}`);
      const photos = response.photos || [];

      if (photos.length === 0) {
        document.getElementById('photoGallery').innerHTML = '<p class="small">No photos yet</p>';
        return;
      }

      const html = photos
        .map(
          photo => `
        <div class="photo-item">
          <img src="${photo.url}" alt="Photo">
          <div class="photo-actions">
            <button class="btn btn-small btn-danger" data-action="deletePhoto" data-id="${photo.id}">Delete</button>
          </div>
        </div>
      `
        )
        .join('');
      document.getElementById('photoGallery').innerHTML = html;
    } catch (err) {
      console.error('Failed to load photos:', err);
      document.getElementById('photoGallery').innerHTML =
        '<p class="small">No photos available</p>';
    }
  }

  async function loadReviews() {
    try {
      const response = await AdminShared.api(`/api/admin/reviews?supplierId=${supplierId}`);
      const reviews = response.reviews || [];

      if (reviews.length === 0) {
        document.getElementById('reviewsList').innerHTML = '<p class="small">No reviews yet</p>';
        return;
      }

      const html = reviews
        .map(
          review => `
        <div class="border-bottom-pad">
          <div class="flex-between-start">
            <div>
              <strong>${AdminShared.escapeHtml(review.userName || 'Anonymous')}</strong>
              <span class="small"> • ${new Date(review.createdAt).toLocaleDateString()}</span>
            </div>
            <div class="stars-gold">★★★★★</div>
          </div>
          <p>${AdminShared.escapeHtml(review.comment || '')}</p>
        </div>
      `
        )
        .join('');
      document.getElementById('reviewsList').innerHTML = html;
    } catch (err) {
      console.error('Failed to load reviews:', err);
      document.getElementById('reviewsList').innerHTML =
        '<p class="small">No reviews available</p>';
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
    const analyticsSection = document.querySelector('.analytics-grid');
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
