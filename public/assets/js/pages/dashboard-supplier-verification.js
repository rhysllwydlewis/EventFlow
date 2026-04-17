(function () {
  // ── Verification Widget Modal ───────────────────────────────────────────────

  /** Inject scoped CSS once into <head>. */
  function injectStyles() {
    if (document.getElementById('sv-modal-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'sv-modal-styles';
    style.textContent = `
      @keyframes sv-fade-in {
        from { opacity: 0; transform: translateY(12px) scale(0.98); }
        to   { opacity: 1; transform: translateY(0)   scale(1); }
      }
      #sv-verification-modal { display: none; }
      #sv-verification-modal.sv-open { display: flex !important; }
      #sv-modal-inner {
        animation: sv-fade-in 0.22s cubic-bezier(0.22,1,0.36,1);
      }
      .sv-input {
        width: 100%;
        box-sizing: border-box;
        padding: 0.5rem 0.75rem;
        border: 1.5px solid #d1d5db;
        border-radius: 8px;
        font-size: 0.9rem;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
        font-family: inherit;
        background: #fff;
      }
      .sv-input:focus {
        border-color: #6366f1;
        box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
      }
      .sv-input::placeholder { color: #9ca3af; }
      #sv-submit-btn {
        width: 100%;
        padding: 0.65rem 1rem;
        background: #6366f1;
        color: #fff;
        font-size: 0.9rem;
        font-weight: 600;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.15s, transform 0.1s;
        font-family: inherit;
      }
      #sv-submit-btn:hover:not(:disabled) { background: #4f46e5; }
      #sv-submit-btn:active:not(:disabled) { transform: scale(0.98); }
      #sv-submit-btn:disabled { opacity: 0.65; cursor: not-allowed; }
      #sv-cancel-btn {
        width: 100%;
        margin-top: 0.5rem;
        padding: 0.5rem 1rem;
        background: none;
        color: #6b7280;
        font-size: 0.875rem;
        font-weight: 500;
        border: 1.5px solid #e5e7eb;
        border-radius: 8px;
        cursor: pointer;
        transition: border-color 0.15s, color 0.15s;
        font-family: inherit;
      }
      #sv-cancel-btn:hover { border-color: #d1d5db; color: #374151; }
      #sv-modal-close:hover { color: #111827; }
      /* "Get Verified" amber button */
      .sv-open-widget-btn--amber:hover { background: #d97706 !important; }
      .sv-open-widget-btn--amber:active { transform: scale(0.97); }
      /* "Resubmit" / "Blocked" red button */
      .sv-open-widget-btn--red:hover { background: #dc2626 !important; }
      .sv-open-widget-btn--red:active { transform: scale(0.97); }
    `;
    document.head.appendChild(style);
  }

  function buildModal() {
    const existing = document.getElementById('sv-verification-modal');
    if (existing) {
      return existing;
    }
    injectStyles();
    const modal = document.createElement('div');
    modal.id = 'sv-verification-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'sv-modal-title');
    modal.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:9999',
      'background:rgba(0,0,0,0.55)',
      'align-items:center',
      'justify-content:center',
      'padding:1rem',
    ].join(';');

    modal.innerHTML = `
      <div id="sv-modal-inner" style="background:#fff;border-radius:16px;max-width:480px;width:100%;padding:2rem;box-shadow:0 20px 60px rgba(0,0,0,0.25);position:relative;max-height:calc(100vh - 2rem);overflow-y:auto;">
        <button id="sv-modal-close" aria-label="Close dialog" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:#9ca3af;line-height:1;padding:0.25rem;border-radius:4px;transition:color 0.15s;">×</button>
        <h2 id="sv-modal-title" style="margin:0 0 0.25rem;font-size:1.25rem;font-weight:700;color:#111827;">Submit for Supplier Verification</h2>
        <p id="sv-modal-subtitle" style="margin:0 0 1.5rem;font-size:0.875rem;color:#6b7280;line-height:1.5;">Confirm your details below and submit your profile for admin review.</p>
        <div id="sv-modal-error" role="alert" aria-live="assertive" style="display:none;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.875rem;color:#991b1b;"></div>
        <div id="sv-modal-success" role="status" aria-live="polite" style="display:none;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:1rem;margin-bottom:1rem;font-size:0.9rem;color:#166534;line-height:1.5;"></div>
        <div id="sv-rejection-notes-block" style="display:none;margin-bottom:1.25rem;padding:0.75rem 1rem;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;">
          <p style="margin:0 0 0.375rem;font-size:0.8125rem;font-weight:600;color:#991b1b;">Admin rejection notes:</p>
          <p id="sv-rejection-notes-text" style="margin:0;font-size:0.8125rem;color:#7f1d1d;white-space:pre-wrap;"></p>
        </div>
        <form id="sv-verification-form" novalidate>
          <div style="margin-bottom:1rem;">
            <label for="sv-name" style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.4rem;color:#374151;">Business Name <span style="color:#ef4444;" aria-hidden="true">*</span></label>
            <input id="sv-name" name="name" type="text" required maxlength="120"
              class="sv-input" placeholder="Your registered business name" autocomplete="organization" />
          </div>
          <div style="margin-bottom:1rem;">
            <label for="sv-category" style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.4rem;color:#374151;">Category <span style="color:#ef4444;" aria-hidden="true">*</span></label>
            <input id="sv-category" name="category" type="text" required maxlength="80"
              class="sv-input" placeholder="e.g. Photographer, Venue, Catering" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
            <div>
              <label for="sv-phone" style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.4rem;color:#374151;">Phone <span style="color:#ef4444;" aria-hidden="true">*</span></label>
              <input id="sv-phone" name="phone" type="tel" required maxlength="30"
                class="sv-input" placeholder="+44 7700 000000" autocomplete="tel" />
            </div>
            <div>
              <label for="sv-location" style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.4rem;color:#374151;">Location <span style="color:#ef4444;" aria-hidden="true">*</span></label>
              <input id="sv-location" name="location" type="text" required maxlength="200"
                class="sv-input" placeholder="City or postcode" autocomplete="address-level2" />
            </div>
          </div>
          <div style="margin-bottom:1rem;">
            <label for="sv-email" style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.4rem;color:#374151;">Contact Email <span style="color:#ef4444;" aria-hidden="true">*</span></label>
            <input id="sv-email" name="email" type="email" required maxlength="254"
              class="sv-input" placeholder="contact@yourbusiness.com" autocomplete="email" />
          </div>
          <div id="sv-supplier-note-block" style="display:none;margin-bottom:1rem;">
            <label for="sv-supplier-note" style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.4rem;color:#374151;">What changed? <span style="font-weight:400;color:#6b7280;">(optional)</span></label>
            <textarea id="sv-supplier-note" name="supplierNote" maxlength="500" rows="3"
              class="sv-input" placeholder="Briefly describe the changes you have made…" style="resize:vertical;"></textarea>
          </div>
          <button class="ef-cta" type="submit" id="sv-submit-btn">Submit for Verification</button>
          <button class="ef-cta" type="button" id="sv-cancel-btn">Cancel</button>
        </form>
      </div>`;

    document.body.appendChild(modal);

    // Close handlers
    function closeModal() {
      modal.classList.remove('sv-open');
    }
    document.getElementById('sv-modal-close').addEventListener('click', closeModal);
    document.getElementById('sv-cancel-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', e => {
      if (e.target === modal) {
        closeModal();
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.classList.contains('sv-open')) {
        closeModal();
      }
    });

    // Form submit — uses the existing state-machine verification endpoint
    document.getElementById('sv-verification-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errorEl = document.getElementById('sv-modal-error');
      const successEl = document.getElementById('sv-modal-success');
      const submitBtn = document.getElementById('sv-submit-btn');
      errorEl.style.display = 'none';
      successEl.style.display = 'none';

      const name = document.getElementById('sv-name').value.trim();
      const category = document.getElementById('sv-category').value.trim();
      const phone = document.getElementById('sv-phone').value.trim();
      const location = document.getElementById('sv-location').value.trim();
      const email = document.getElementById('sv-email').value.trim();
      const supplierNoteEl = document.getElementById('sv-supplier-note');
      const supplierNote = supplierNoteEl ? supplierNoteEl.value.trim() : '';

      const missing = [];
      if (!name) {
        missing.push('Business name');
      }
      if (!category) {
        missing.push('Category');
      }
      if (!phone) {
        missing.push('Phone');
      }
      if (!location) {
        missing.push('Location');
      }
      if (!email) {
        missing.push('Contact email');
      }

      if (missing.length > 0) {
        errorEl.textContent = `Required fields are missing: ${missing.join(', ')}`;
        errorEl.style.display = 'block';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';

      try {
        // Fetch CSRF token
        const csrfRes = await fetch('/api/csrf-token', { credentials: 'include' });
        const csrfData = csrfRes.ok ? await csrfRes.json() : {};
        const csrfToken = csrfData.csrfToken || '';

        const body = { name, category, phone, location, email };
        if (supplierNote) {
          body.supplierNote = supplierNote;
        }

        const res = await fetch('/api/supplier/verification/submit', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (res.status === 409) {
          // Already pending or already approved
          successEl.innerHTML = `✅ ${data.error || 'Your verification is already under review or approved.'}`;
          successEl.style.display = 'block';
          document.getElementById('sv-verification-form').style.display = 'none';
          return;
        }

        if (res.status === 403 && data.code === 'VERIFICATION_MAX_REJECTIONS') {
          errorEl.textContent =
            data.error ||
            'You have reached the maximum number of verification submissions. Please contact support.';
          errorEl.style.display = 'block';
          return;
        }

        if (!res.ok) {
          if (data.missingFields && data.missingFields.length > 0) {
            errorEl.textContent = `Please complete your profile first. Missing: ${data.missingFields.join(', ')}`;
          } else {
            errorEl.textContent = data.error || 'Failed to submit request. Please try again.';
          }
          errorEl.style.display = 'block';
          return;
        }

        const isAutoApproved = data.autoApproved === true;
        successEl.innerHTML = isAutoApproved
          ? '✅ Your profile has been verified and approved!'
          : `✅ ${data.message || 'Verification submitted! An admin will review your profile shortly.'}`;
        successEl.style.display = 'block';
        document.getElementById('sv-verification-form').style.display = 'none';
      } catch (err) {
        errorEl.textContent = 'Network error. Please check your connection and try again.';
        errorEl.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent =
          submitBtn.dataset.mode === 'resubmit'
            ? 'Resubmit for Verification'
            : 'Submit for Verification';
      }
    });

    return modal;
  }

  function openVerificationModal(supplierProfile, options) {
    const opts = options || {};
    const modal = buildModal();
    // Pre-fill fields if profile data is available
    if (supplierProfile) {
      const nameEl = document.getElementById('sv-name');
      const categoryEl = document.getElementById('sv-category');
      const phoneEl = document.getElementById('sv-phone');
      const locationEl = document.getElementById('sv-location');
      const emailEl = document.getElementById('sv-email');
      if (nameEl && supplierProfile.name) {
        nameEl.value = supplierProfile.name;
      }
      if (categoryEl && supplierProfile.category) {
        categoryEl.value = supplierProfile.category;
      }
      if (phoneEl && supplierProfile.phone) {
        phoneEl.value = supplierProfile.phone;
      }
      if (locationEl) {
        locationEl.value = supplierProfile.location || supplierProfile.venuePostcode || '';
      }
      if (emailEl && supplierProfile.email) {
        emailEl.value = supplierProfile.email;
      }
    }
    // Reset form state
    const errorEl = document.getElementById('sv-modal-error');
    const successEl = document.getElementById('sv-modal-success');
    const form = document.getElementById('sv-verification-form');
    const rejectionBlock = document.getElementById('sv-rejection-notes-block');
    const rejectionNotesText = document.getElementById('sv-rejection-notes-text');
    const supplierNoteBlock = document.getElementById('sv-supplier-note-block');
    const supplierNoteEl = document.getElementById('sv-supplier-note');
    const titleEl = document.getElementById('sv-modal-title');
    const subtitleEl = document.getElementById('sv-modal-subtitle');
    const submitBtn = document.getElementById('sv-submit-btn');

    if (errorEl) {
      errorEl.style.display = 'none';
    }
    if (successEl) {
      successEl.style.display = 'none';
    }
    if (form) {
      form.style.display = '';
    }

    // Show/hide rejection notes and supplier notes for resubmit context
    const isResubmit = opts.rejectionNotes !== undefined;
    if (rejectionBlock && rejectionNotesText) {
      if (isResubmit && opts.rejectionNotes) {
        rejectionNotesText.textContent = opts.rejectionNotes;
        rejectionBlock.style.display = 'block';
      } else {
        rejectionBlock.style.display = 'none';
      }
    }
    if (supplierNoteBlock) {
      supplierNoteBlock.style.display = isResubmit ? 'block' : 'none';
    }
    if (supplierNoteEl) {
      supplierNoteEl.value = '';
    }
    if (isResubmit) {
      if (titleEl) {
        titleEl.textContent = 'Resubmit for Verification';
      }
      if (subtitleEl) {
        subtitleEl.textContent =
          'Review the feedback below, update your details if needed, and resubmit for admin review.';
      }
      if (submitBtn) {
        submitBtn.textContent = 'Resubmit for Verification';
        submitBtn.dataset.mode = 'resubmit';
      }
    } else {
      if (titleEl) {
        titleEl.textContent = 'Submit for Supplier Verification';
      }
      if (subtitleEl) {
        subtitleEl.textContent =
          'Confirm your details below and submit your profile for admin review.';
      }
      if (submitBtn) {
        submitBtn.textContent = 'Submit for Verification';
        submitBtn.dataset.mode = 'submit';
      }
    }
    modal.classList.add('sv-open');
    // Focus first input after animation
    setTimeout(() => {
      const firstInput = document.getElementById('sv-name');
      if (firstInput) {
        firstInput.focus();
      }
    }, 50);
  }

  // ── Approval Banner ──────────────────────────────────────────────────────────

  async function loadApprovalBanner() {
    const banner = document.getElementById('verification-status-banner');
    if (!banner) {
      return;
    }
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      // /api/auth/me returns { user: { role, supplierApproved, ... } }
      const user = data.user;
      if (!user) {
        return;
      }

      // Only show banner for supplier role users with an unapproved profile
      if (user.role !== 'supplier') {
        return;
      }
      if (user.supplierApproved === true) {
        // Approved — keep dashboard clean
        return;
      }

      // Supplier is not approved — fetch profile for pre-filling the widget
      let supplierProfile = null;
      try {
        const suppliersRes = await fetch('/api/me/suppliers', { credentials: 'include' });
        if (suppliersRes.ok) {
          const suppliersData = await suppliersRes.json();
          supplierProfile = Array.isArray(suppliersData.items)
            ? suppliersData.items[0] || null
            : suppliersData.supplier || null;
        }
      } catch (_) {
        // Non-fatal — widget can still open without pre-fill
      }

      // Determine current verification status details
      let verificationStatus = null;
      let verificationNotes = '';
      let verificationRejectionCount = 0;
      let isPending = false;
      try {
        const statusRes = await fetch('/api/supplier/verification/status', {
          credentials: 'include',
        });
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          verificationStatus = statusData.verificationStatus;
          verificationNotes = statusData.verificationNotes || '';
          verificationRejectionCount = statusData.verificationRejectionCount || 0;
          isPending = verificationStatus === 'pending_review';
        }
      } catch (_) {
        // Non-fatal
      }

      // Render banner — build each state independently for clean styling
      const baseBannerStyle = [
        'display:block',
        'margin-bottom:1.25rem',
        'padding:1rem 1.25rem',
        'border-radius:12px',
      ].join(';');

      if (isPending) {
        banner.style.cssText = [
          baseBannerStyle,
          'border-left:4px solid #f59e0b',
          'background:linear-gradient(135deg,rgba(245,158,11,0.12) 0%,rgba(251,191,36,0.06) 100%)',
          'box-shadow:0 2px 8px rgba(245,158,11,0.12)',
        ].join(';');
        banner.innerHTML = `
          <div style="display:flex;align-items:center;gap:0.875rem;flex-wrap:wrap;">
            <span style="font-size:1.5rem;flex-shrink:0;line-height:1;" aria-hidden="true">⏳</span>
            <div style="flex:1;min-width:180px;">
              <strong style="display:block;font-size:0.9375rem;color:#92400e;margin-bottom:0.2rem;">Verification under review</strong>
              <span style="font-size:0.8125rem;color:#78350f;line-height:1.45;">
                Your profile has been submitted and is awaiting admin review. You'll be notified once a decision is made.
              </span>
            </div>
          </div>`;
      } else if (verificationRejectionCount >= 5) {
        // Blocked — max rejections reached
        const notesHtml = verificationNotes
          ? `<div style="margin-top:0.5rem;padding:0.5rem 0.75rem;background:rgba(239,68,68,0.08);border-radius:6px;font-size:0.8125rem;color:#7f1d1d;border-left:3px solid #ef4444;white-space:pre-wrap;">${verificationNotes.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</div>`
          : '';
        banner.style.cssText = [
          baseBannerStyle,
          'border-left:4px solid #ef4444',
          'background:linear-gradient(135deg,rgba(239,68,68,0.10) 0%,rgba(254,202,202,0.06) 100%)',
          'box-shadow:0 2px 8px rgba(239,68,68,0.12)',
        ].join(';');
        banner.innerHTML = `
          <div style="display:flex;align-items:flex-start;gap:0.875rem;flex-wrap:wrap;">
            <span style="font-size:1.5rem;flex-shrink:0;line-height:1;" aria-hidden="true">🚫</span>
            <div style="flex:1;min-width:180px;">
              <strong style="display:block;font-size:0.9375rem;color:#991b1b;margin-bottom:0.2rem;">Verification blocked</strong>
              <span style="font-size:0.8125rem;color:#7f1d1d;line-height:1.45;">
                Your profile has been rejected 5 times and can no longer be resubmitted. Please contact support for assistance.
              </span>
              ${notesHtml}
            </div>
          </div>`;
      } else if (verificationStatus === 'rejected' || verificationStatus === 'needs_changes') {
        // Rejected / needs changes — show admin notes + resubmit button
        const labelText =
          verificationStatus === 'rejected' ? 'Verification rejected' : 'Changes required';
        const bodyText =
          verificationStatus === 'rejected'
            ? 'Your verification request was rejected. Please review the notes below, make any necessary changes, and resubmit.'
            : 'The admin has requested changes to your profile. Please review the notes below and resubmit.';
        const notesHtml = verificationNotes
          ? `<div style="margin-top:0.5rem;padding:0.5rem 0.75rem;background:rgba(239,68,68,0.08);border-radius:6px;font-size:0.8125rem;color:#7f1d1d;border-left:3px solid #ef4444;white-space:pre-wrap;">${verificationNotes.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</div>`
          : '';
        banner.style.cssText = [
          baseBannerStyle,
          'border-left:4px solid #ef4444',
          'background:linear-gradient(135deg,rgba(239,68,68,0.10) 0%,rgba(254,202,202,0.06) 100%)',
          'box-shadow:0 2px 8px rgba(239,68,68,0.12)',
        ].join(';');
        banner.innerHTML = `
          <div style="display:flex;align-items:flex-start;gap:0.875rem;flex-wrap:wrap;">
            <span style="font-size:1.5rem;flex-shrink:0;line-height:1;" aria-hidden="true">❌</span>
            <div style="flex:1;min-width:180px;">
              <strong style="display:block;font-size:0.9375rem;color:#991b1b;margin-bottom:0.2rem;">${labelText}</strong>
              <span style="font-size:0.8125rem;color:#7f1d1d;line-height:1.45;">${bodyText}</span>
              ${notesHtml}
            </div>
            <button id="sv-open-widget-btn" class="sv-open-widget-btn--red"
              style="flex-shrink:0;padding:0.5rem 1.25rem;background:#ef4444;color:#fff;border:none;border-radius:999px;font-weight:700;font-size:0.8125rem;cursor:pointer;transition:background 0.15s,transform 0.1s;letter-spacing:0.01em;white-space:nowrap;"
              aria-label="Open verification resubmission form">
              Resubmit →
            </button>
          </div>`;

        document.getElementById('sv-open-widget-btn')?.addEventListener('click', () => {
          openVerificationModal(supplierProfile, { rejectionNotes: verificationNotes });
        });
      } else {
        banner.style.cssText = [
          baseBannerStyle,
          'border-left:4px solid #f59e0b',
          'background:linear-gradient(135deg,rgba(245,158,11,0.12) 0%,rgba(251,191,36,0.06) 100%)',
          'box-shadow:0 2px 8px rgba(245,158,11,0.12)',
        ].join(';');
        banner.innerHTML = `
          <div style="display:flex;align-items:center;gap:0.875rem;flex-wrap:wrap;">
            <span style="font-size:1.5rem;flex-shrink:0;line-height:1;" aria-hidden="true">⚠️</span>
            <div style="flex:1;min-width:180px;">
              <strong style="display:block;font-size:0.9375rem;color:#92400e;margin-bottom:0.2rem;">Supplier profile pending approval</strong>
              <span style="font-size:0.8125rem;color:#78350f;line-height:1.45;">
                You won't appear in search results or be able to create packages, send messages, or publish calendar events until an admin approves your profile.
              </span>
            </div>
            <button id="sv-open-widget-btn" class="sv-open-widget-btn--amber"
              style="flex-shrink:0;padding:0.5rem 1.25rem;background:#f59e0b;color:#fff;border:none;border-radius:999px;font-weight:700;font-size:0.8125rem;cursor:pointer;transition:background 0.15s,transform 0.1s;letter-spacing:0.01em;white-space:nowrap;"
              aria-label="Open verification request form">
              Get Verified →
            </button>
          </div>`;

        document.getElementById('sv-open-widget-btn')?.addEventListener('click', () => {
          openVerificationModal(supplierProfile);
        });
      }
    } catch (_) {
      // Ensure the banner stays hidden if the API call fails.
      if (banner) {
        banner.style.display = 'none';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadApprovalBanner);
  } else {
    loadApprovalBanner();
  }
})();
