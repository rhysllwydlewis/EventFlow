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
  let apDiagnosticsLoaded = false;
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
      // Lazy-load action-prompt diagnostics only once
      if (tab === 'action-prompts' && !apDiagnosticsLoaded) {
        loadApDiagnostics();
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
          '<p class="empty-state-card"><span class="empty-icon">⚠️</span><br>Failed to load supplier. <button type="button" id="retryLoadSupplierBtn" style="background:none;border:none;color:#667eea;cursor:pointer;padding:0;text-decoration:underline;font-size:inherit;">Retry</button></p>';
        header
          .querySelector('#retryLoadSupplierBtn')
          ?.addEventListener('click', () => location.reload());
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
            ? `<span style="color: #10b981;">Yes</span> ${supplierData.verifiedAt ? `(${new Date(supplierData.verifiedAt).toLocaleDateString('en-GB', { timeZone: 'Europe/London' })})` : ''}`
            : '<span style="color: #ef4444;">No</span>'
        }
      </div>
      <div class="supplier-meta-item">
        <strong>Verification Status:</strong> ${AdminShared.escapeHtml(supplierData.verificationStatus || 'unverified')}
      </div>
      ${supplierData.verificationNotes ? `<div class="supplier-meta-item"><strong>Verification Notes:</strong> ${AdminShared.escapeHtml(supplierData.verificationNotes)}</div>` : ''}
      <div class="supplier-meta-item">
        <strong>Quality Score:</strong> ${supplierData.healthScore || 0}/100
      </div>
      <div class="supplier-meta-item">
        <strong>Pro Plan:</strong> ${AdminShared.escapeHtml(supplierData.proPlan || 'None')}
      </div>
    `;
    document.getElementById('supplierMeta').innerHTML = metaHtml;
    renderProfileHealth();

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
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem;">
          <div>
            <label for="subscriptionTier" style="display: block; margin-bottom: 0.35rem; font-size: 0.8rem; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px;">Tier</label>
            <select id="subscriptionTier" class="form-control" style="width: 100%;">
              <option value="pro">Pro</option>
              <option value="pro_plus">Pro Plus</option>
            </select>
          </div>
          <div>
            <label for="subscriptionDuration" style="display: block; margin-bottom: 0.35rem; font-size: 0.8rem; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px;">Duration</label>
            <select id="subscriptionDuration" class="form-control" style="width: 100%;">
              <option value="7">7 days (Trial)</option>
              <option value="14">14 days (Trial)</option>
              <option value="30" selected>30 days (1 Month)</option>
              <option value="60">60 days (2 Months)</option>
              <option value="90">90 days (3 Months)</option>
              <option value="180">180 days (6 Months)</option>
              <option value="365">365 days (1 Year)</option>
            </select>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <button class="ef-cta btn btn-primary" id="grantProBtn">Grant / Extend</button>
          ${hasActiveSub ? '<button class="ef-cta btn btn-secondary" id="cancelProBtn">Remove Subscription</button>' : ''}
        </div>
      </div>
    `;
    document.getElementById('proPlanInfo').innerHTML = proPlanHtml;

    // ── Public Calendar Override ───────────────────────────────────────────
    const override = supplierData.publicCalendarPublisherOverride;
    // Derive whether the supplier can publish by default (from category)
    const publisherCategories = ['Event Planner', 'Wedding Fayre'];
    const defaultPublisher = publisherCategories.includes(supplierData.category || '');
    const effectivePublisher =
      override === true ? true : override === false ? false : defaultPublisher;

    const overrideLabel =
      override === true
        ? '<span style="color:#16a34a">✔ Forced ON (admin override)</span>'
        : override === false
          ? '<span style="color:#dc2626">✘ Forced OFF (admin override)</span>'
          : '<span style="color:#6b7280">Auto (from category)</span>';

    const calendarHtml = `
      <p><strong>Supplier category:</strong> ${AdminShared.escapeHtml(supplierData.category || 'Unknown')}</p>
      <p><strong>Default publishing right:</strong> ${defaultPublisher ? '<span style="color:#16a34a">Yes</span>' : '<span style="color:#6b7280">No</span>'}</p>
      <p><strong>Override:</strong> ${overrideLabel}</p>
      <p class="small" style="color:#6b7280;margin-top:0.35rem;">Override meanings: <strong>true</strong> = supplier can publish regardless of category; <strong>false</strong> = supplier cannot publish regardless of category; <strong>null</strong> = use Event Planner / Wedding Fayre category defaults.</p>
      <p><strong>Effective permission:</strong> ${effectivePublisher ? '<span style="color:#16a34a;font-weight:600">Can publish</span>' : '<span style="color:#dc2626;font-weight:600">Read-only</span>'}</p>
      <div style="margin-top:1rem;border-top:1px solid #e5e7eb;padding-top:1rem;">
        <h4 style="margin-bottom:0.75rem;font-size:0.9rem;font-weight:600;">Set Override</h4>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <button class="ef-cta btn btn-success btn-small" id="calOverrideTrue">Force ON</button>
          <button class="ef-cta btn btn-danger btn-small" id="calOverrideFalse">Force OFF</button>
          <button class="ef-cta btn btn-secondary btn-small" id="calOverrideNull">Clear (auto)</button>
        </div>
      </div>
    `;
    document.getElementById('calendarOverrideInfo').innerHTML = calendarHtml;

    // Wire up override buttons
    async function setCalendarOverride(value) {
      try {
        await AdminShared.adminFetch(`/api/admin/suppliers/${supplierId}/calendar-override`, {
          method: 'PUT',
          body: JSON.stringify({ override: value }),
        });
        AdminShared.showToast(
          value === null ? 'Calendar override cleared' : `Calendar override set to ${value}`,
          'success'
        );
        await loadSupplier();
      } catch {
        AdminShared.showToast('Failed to update calendar override', 'error');
      }
    }

    document
      .getElementById('calOverrideTrue')
      .addEventListener('click', () => setCalendarOverride(true));
    document
      .getElementById('calOverrideFalse')
      .addEventListener('click', () => setCalendarOverride(false));
    document
      .getElementById('calOverrideNull')
      .addEventListener('click', () => setCalendarOverride(null));
  }

  /**
   * Render the "Profile Health" stat box: the supplier's own completeness
   * percentage (same formula as their dashboard's Profile Health card),
   * plus a per-item checklist in its info popover so support staff can see
   * exactly what's missing without switching accounts.
   */
  function renderProfileHealth() {
    const scoreEl = document.getElementById('profileHealthScore');
    const checklistEl = document.getElementById('profileHealthChecklist');
    if (!scoreEl || !checklistEl || !supplierData) {
      return;
    }

    if (!window.ProfileHealthWidget || typeof window.ProfileHealthWidget.calculate !== 'function') {
      scoreEl.textContent = '—';
      checklistEl.innerHTML = '';
      return;
    }

    const scoreData = window.ProfileHealthWidget.calculate(supplierData);
    scoreEl.textContent = `${scoreData.percentage}%`;

    const items = [
      ...scoreData.completedItems.map(item => ({ ...item, complete: true })),
      ...scoreData.incompleteItems.map(item => ({ ...item, complete: false })),
    ];
    checklistEl.innerHTML = items
      .map(
        item =>
          `<li class="${item.complete ? 'is-complete' : 'is-incomplete'}">${item.complete ? '✓' : '✗'} ${AdminShared.escapeHtml(item.label)} (${item.weight}pts)</li>`
      )
      .join('');
  }

  /**
   * Wire the (i) info buttons on the Analytics stat boxes to their popovers.
   * Click toggles the matching popover, only one open at a time; Escape or a
   * click outside any popover closes whichever is open.
   */
  function setupStatInfoPopovers() {
    const buttons = Array.from(document.querySelectorAll('.stat-info-btn'));

    function closeAll(except, { refocus } = {}) {
      buttons.forEach(btn => {
        if (btn === except) {
          return;
        }
        const wasOpen = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', 'false');
        document.getElementById(btn.getAttribute('aria-controls'))?.classList.remove('is-open');
        if (wasOpen && refocus) {
          btn.focus();
        }
      });
    }

    buttons.forEach(btn => {
      const popover = document.getElementById(btn.getAttribute('aria-controls'));
      if (!popover) {
        return;
      }
      btn.addEventListener('click', event => {
        event.stopPropagation();
        const isOpen = btn.getAttribute('aria-expanded') === 'true';
        closeAll(isOpen ? null : btn);
        btn.setAttribute('aria-expanded', String(!isOpen));
        popover.classList.toggle('is-open', !isOpen);
      });
      // Clicking inside the popover itself (selecting text, etc.) must not
      // count as an "outside click" and close it.
      popover.addEventListener('click', event => event.stopPropagation());
    });

    document.addEventListener('click', () => closeAll(null));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeAll(null, { refocus: true });
      }
    });
  }
  setupStatInfoPopovers();

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
            <button class="ef-cta btn btn-small btn-primary" data-action="viewPackage" data-id="${AdminShared.escapeHtml(pkg.id)}">View</button>
            <button class="ef-cta btn btn-small btn-secondary" data-action="editPackage" data-id="${pkg.id}">Edit</button>
            ${!pkg.approved ? `<button class="ef-cta btn btn-small btn-success" data-action="approvePackage" data-id="${pkg.id}">Approve</button>` : ''}
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
            <button class="ef-cta btn btn-small btn-danger" data-action="deletePhoto" data-id="${AdminShared.escapeHtml(String(photo.id || ''))}">Delete</button>
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
              <span class="small"> • ${new Date(review.createdAt).toLocaleDateString('en-GB', { timeZone: 'Europe/London' })}</span>
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

  function loadAnalytics() {
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
        if (sel) {
          sel.focus();
        }
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

    // Client-side validation for website URL — use URL constructor for structural check
    if (matched.key === 'website' && valueResult.value) {
      try {
        const parsed = new URL(valueResult.value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error('protocol');
        }
      } catch {
        AdminShared.showToast('Website URL must be a valid http:// or https:// address', 'error');
        return;
      }
    }

    // Client-side validation for required fields — derive a clean value to send
    let finalValue = valueResult.value;
    if (matched.key === 'name') {
      finalValue = valueResult.value.trim();
      if (!finalValue) {
        AdminShared.showToast('Business name cannot be empty', 'error');
        return;
      }
    }

    try {
      await AdminShared.api(`/api/admin/suppliers/${supplierId}`, 'PUT', {
        [matched.key]: finalValue,
      });
      AdminShared.showToast(`${matched.label} updated successfully`, 'success');
      loadSupplier();
    } catch (err) {
      AdminShared.showToast(
        `Failed to update ${matched.label}: ${err.message || 'Unknown error'}`,
        'error'
      );
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

    if (action === 'viewPackage') {
      window.open(`/package?id=${encodeURIComponent(id)}`, '_blank', 'noopener,noreferrer');
    } else if (action === 'editPackage') {
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

  // ── Action Prompt Diagnostics ──────────────────────────────────────────

  let apDiagnosticsData = null;

  function apBadge(text, color) {
    const bg =
      { green: '#d1fae5', red: '#fee2e2', amber: '#fef3c7', grey: '#f1f5f9' }[color] || '#f1f5f9';
    const fg =
      { green: '#065f46', red: '#991b1b', amber: '#92400e', grey: '#374151' }[color] || '#374151';
    return `<span style="display:inline-block;padding:0.15rem 0.5rem;border-radius:9999px;background:${bg};color:${fg};font-size:0.78rem;font-weight:600;">${escapeHtml(String(text))}</span>`;
  }

  function apBool(val) {
    return val ? apBadge('✓ Yes', 'green') : apBadge('✗ No', 'red');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderApDiagnostics(data) {
    const panel = document.getElementById('apDiagnosticsPanel');
    if (!panel) {
      return;
    }

    const { global: g, user, actions, cadence, lastRun, warnings } = data;

    const warningHtml =
      warnings && warnings.length > 0
        ? `<div style="background:#fef3c7;border:1px solid #d97706;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;">
          <strong style="color:#92400e;">⚠ Warnings</strong>
          <ul style="margin:0.5rem 0 0 1.25rem;padding:0;color:#92400e;">
            ${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
          </ul>
        </div>`
        : '';

    const outstandingHtml =
      actions.outstanding.length > 0
        ? actions.outstanding
            .map(a => {
              const sev = a.severity === 'red' ? 'red' : 'amber';
              return `<li style="margin-bottom:0.4rem;">${apBadge(a.severity?.toUpperCase() || 'AMBER', sev)} <strong>${escapeHtml(a.title)}</strong> <span style="color:#6b7280;font-size:0.85rem;">(${escapeHtml(a.key)})</span></li>`;
            })
            .join('')
        : '<li style="color:#059669;">✓ No outstanding actions</li>';

    const completedHtml =
      actions.completed.length > 0
        ? actions.completed
            .map(a => `<li style="color:#6b7280;">${escapeHtml(a.title)}</li>`)
            .join('')
        : '<li style="color:#6b7280;">—</li>';

    const cs = cadence.state;
    const cadenceHtml = cs
      ? `<table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
          <tr><td style="padding:0.35rem 0.5rem;color:#6b7280;">Stage</td><td style="padding:0.35rem 0.5rem;font-weight:600;">${escapeHtml(cs.cadence || 'daily')}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:0.35rem 0.5rem;color:#6b7280;">Daily sends</td><td style="padding:0.35rem 0.5rem;">${cs.sendCountDaily ?? 0} / 7</td></tr>
          <tr><td style="padding:0.35rem 0.5rem;color:#6b7280;">Weekly sends</td><td style="padding:0.35rem 0.5rem;">${cs.sendCountWeekly ?? 0} / 4</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:0.35rem 0.5rem;color:#6b7280;">Monthly sends</td><td style="padding:0.35rem 0.5rem;">${cs.sendCountMonthly ?? 0}</td></tr>
          <tr><td style="padding:0.35rem 0.5rem;color:#6b7280;">Last sent</td><td style="padding:0.35rem 0.5rem;">${cs.lastSentAt ? new Date(cs.lastSentAt).toLocaleString() : 'Never'}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:0.35rem 0.5rem;color:#6b7280;">Next send</td><td style="padding:0.35rem 0.5rem;">${cs.nextSendAt ? new Date(cs.nextSendAt).toLocaleString() : '—'}</td></tr>
          <tr><td style="padding:0.35rem 0.5rem;color:#6b7280;">First outstanding</td><td style="padding:0.35rem 0.5rem;">${cs.firstOutstandingAt ? new Date(cs.firstOutstandingAt).toLocaleString() : '—'}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:0.35rem 0.5rem;color:#6b7280;">Would send now?</td><td style="padding:0.35rem 0.5rem;">${cadence.wouldSendNow ? apBadge('Yes', 'green') : apBadge('No', 'grey')}</td></tr>
        </table>`
      : `<p style="color:#6b7280;margin:0;">No cadence state — this supplier has not been queued yet.</p>`;

    const lastRunHtml = lastRun
      ? `<span style="font-size:0.85rem;">Last global run: <strong>${new Date(lastRun.finishedAt).toLocaleString()}</strong> — scanned ${lastRun.scanned}, sent ${lastRun.sent}, errors ${lastRun.errors}</span>`
      : `<span style="color:#6b7280;font-size:0.85rem;">No global run recorded yet.</span>`;

    panel.innerHTML = `
      ${warningHtml}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem;">
        <!-- Global settings -->
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:0.875rem;">
          <div style="font-weight:600;margin-bottom:0.625rem;font-size:0.9rem;">Global Settings</div>
          <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
            <tr><td style="padding:0.3rem 0;color:#6b7280;">Master enabled</td><td style="padding:0.3rem 0;">${apBool(g.enabled)}</td></tr>
            <tr><td style="padding:0.3rem 0;color:#6b7280;">Missing packages</td><td>${apBool(g.promptTypes.missingPackages)}</td></tr>
            <tr><td style="padding:0.3rem 0;color:#6b7280;">Incomplete profile</td><td>${apBool(g.promptTypes.incompleteProfile)}</td></tr>
            <tr><td style="padding:0.3rem 0;color:#6b7280;">Missing photos</td><td>${apBool(g.promptTypes.missingPhotos)}</td></tr>
          </table>
        </div>
        <!-- User / Supplier settings -->
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:0.875rem;">
          <div style="font-weight:600;margin-bottom:0.625rem;font-size:0.9rem;">Supplier / User Settings</div>
          ${
            user
              ? `<table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
            <tr><td style="padding:0.3rem 0;color:#6b7280;">Email</td><td style="padding:0.3rem 0;word-break:break-all;">${escapeHtml(user.email)}</td></tr>
            <tr><td style="padding:0.3rem 0;color:#6b7280;">Verified</td><td>${apBool(user.verified)}</td></tr>
            <tr><td style="padding:0.3rem 0;color:#6b7280;">User account</td><td style="padding:0.3rem 0;"><a href="/admin-user-detail?id=${escapeHtml(user.id || '')}" style="color:#0B8073;text-decoration:none;font-weight:600;">View User Detail →</a></td></tr>
            <tr><td style="padding:0.3rem 0;color:#6b7280;">Prefs enabled</td><td>${apBool(user.emailPrefsEnabled)}</td></tr>
            <tr><td style="padding:0.3rem 0;color:#6b7280;">Pref: packages</td><td>${apBool(user.emailPrefsPerType.missingPackages)}</td></tr>
            <tr><td style="padding:0.3rem 0;color:#6b7280;">Pref: profile</td><td>${apBool(user.emailPrefsPerType.incompleteProfile)}</td></tr>
            <tr><td style="padding:0.3rem 0;color:#6b7280;">Pref: photos</td><td>${apBool(user.emailPrefsPerType.missingPhotos)}</td></tr>
          </table>`
              : `<p style="color:#dc2626;font-size:0.875rem;margin:0;">⚠ No user account linked to this supplier.</p>`
          }
        </div>
      </div>
      <!-- Outstanding actions -->
      <div style="margin-bottom:1.25rem;">
        <div style="font-weight:600;margin-bottom:0.5rem;font-size:0.9rem;">
          Outstanding Actions
          ${apBadge(actions.outstanding.length, actions.outstanding.length > 0 ? 'red' : 'green')}
          <span style="font-weight:400;font-size:0.82rem;color:#6b7280;margin-left:0.5rem;">${actions.completionPercent}% complete</span>
          ${actions.basedOnSyntheticUser ? '<span style="font-weight:400;font-size:0.78rem;color:#92400e;background:#fef3c7;padding:1px 6px;border-radius:4px;margin-left:0.5rem;">Based on profile data — no linked user account</span>' : ''}
        </div>
        <ul style="margin:0;padding-left:1.25rem;">${outstandingHtml}</ul>
      </div>
      <div style="margin-bottom:1.25rem;">
        <div style="font-weight:600;margin-bottom:0.5rem;font-size:0.9rem;">Completed ✓</div>
        <ul style="margin:0;padding-left:1.25rem;">${completedHtml}</ul>
      </div>
      <!-- Cadence state -->
      <div style="margin-bottom:1.25rem;">
        <div style="font-weight:600;margin-bottom:0.5rem;font-size:0.9rem;">Cadence State</div>
        ${cadenceHtml}
      </div>
      <!-- Last run -->
      <div style="margin-top:0.5rem;padding:0.625rem 0.875rem;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;">
        ${lastRunHtml}
      </div>
    `;
  }

  async function loadApDiagnostics() {
    const panel = document.getElementById('apDiagnosticsPanel');
    if (!panel) {
      return;
    }
    panel.innerHTML = '<p style="color:#6b7280;">Loading…</p>';
    try {
      const data = await AdminShared.api(
        `/api/admin/suppliers/${supplierId}/action-prompts/diagnostics`
      );
      apDiagnosticsData = data;
      apDiagnosticsLoaded = true;
      renderApDiagnostics(data);
    } catch (err) {
      console.error('Failed to load action-prompt diagnostics:', err);
      panel.innerHTML = `<p style="color:#dc2626;">Failed to load diagnostics: ${escapeHtml(err.message || 'Unknown error')}</p>`;
    }
  }

  // Refresh button
  document.getElementById('apRefreshBtn')?.addEventListener('click', () => {
    apDiagnosticsLoaded = false;
    loadApDiagnostics();
  });

  // Copy debug summary
  document.getElementById('apCopyDebugBtn')?.addEventListener('click', async () => {
    if (!apDiagnosticsData?.debugSummary) {
      AdminShared.showToast('Load diagnostics first', 'warning');
      return;
    }
    try {
      const text = Array.isArray(apDiagnosticsData.debugSummary)
        ? apDiagnosticsData.debugSummary.join('\n')
        : String(apDiagnosticsData.debugSummary);
      await navigator.clipboard.writeText(text);
      AdminShared.showToast('Debug summary copied to clipboard', 'success');
    } catch {
      AdminShared.showToast('Clipboard copy failed — try manually selecting the text', 'error');
    }
  });

  // Enable reminders
  document.getElementById('apEnableBtn')?.addEventListener('click', async () => {
    if (
      !(await AdminShared.showConfirmModal({
        title: 'Enable Reminders',
        message: 'Enable action-prompt reminder emails for this supplier?',
        confirmText: 'Enable',
      }))
    ) {
      return;
    }
    try {
      await AdminShared.api(
        `/api/admin/suppliers/${supplierId}/action-prompts/set-enabled`,
        'POST',
        { enabled: true }
      );
      AdminShared.showToast('Reminders enabled', 'success');
      apDiagnosticsLoaded = false;
      loadApDiagnostics();
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message || 'Unknown error'}`, 'error');
    }
  });

  // Disable reminders
  document.getElementById('apDisableBtn')?.addEventListener('click', async () => {
    if (
      !(await AdminShared.showConfirmModal({
        title: 'Disable Reminders',
        message:
          'Disable action-prompt reminder emails for this supplier? They will not receive any more reminder emails until re-enabled.',
        confirmText: 'Disable',
      }))
    ) {
      return;
    }
    try {
      await AdminShared.api(
        `/api/admin/suppliers/${supplierId}/action-prompts/set-enabled`,
        'POST',
        { enabled: false }
      );
      AdminShared.showToast('Reminders disabled', 'success');
      apDiagnosticsLoaded = false;
      loadApDiagnostics();
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message || 'Unknown error'}`, 'error');
    }
  });

  // Reset cadence
  document.getElementById('apResetCadenceBtn')?.addEventListener('click', async () => {
    if (
      !(await AdminShared.showConfirmModal({
        title: 'Reset Cadence',
        message:
          'Reset the send cadence for this supplier? The daily→weekly→monthly cycle will restart from the beginning on the next run.',
        confirmText: 'Reset',
      }))
    ) {
      return;
    }
    try {
      await AdminShared.api(
        `/api/admin/suppliers/${supplierId}/action-prompts/reset-cadence`,
        'POST',
        {}
      );
      AdminShared.showToast('Cadence reset successfully', 'success');
      apDiagnosticsLoaded = false;
      loadApDiagnostics();
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message || 'Unknown error'}`, 'error');
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
