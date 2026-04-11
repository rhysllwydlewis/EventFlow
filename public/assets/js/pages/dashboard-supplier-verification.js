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
      #sv-open-widget-btn:hover { background: #d97706 !important; }
      #sv-open-widget-btn:active { transform: scale(0.97); }
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
        <h2 id="sv-modal-title" style="margin:0 0 0.25rem;font-size:1.25rem;font-weight:700;color:#111827;">Request Supplier Verification</h2>
        <p style="margin:0 0 1.5rem;font-size:0.875rem;color:#6b7280;line-height:1.5;">Complete the form below and our team will review your request within <strong>24 hours</strong>.</p>
        <div id="sv-modal-error" role="alert" aria-live="assertive" style="display:none;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.875rem;color:#991b1b;"></div>
        <div id="sv-modal-success" role="status" aria-live="polite" style="display:none;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:1rem;margin-bottom:1rem;font-size:0.9rem;color:#166534;line-height:1.5;"></div>
        <form id="sv-verification-form" novalidate>
          <div style="margin-bottom:1rem;">
            <label for="sv-businessName" style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.4rem;color:#374151;">Business Name <span style="color:#ef4444;" aria-hidden="true">*</span></label>
            <input id="sv-businessName" name="businessName" type="text" required maxlength="120"
              class="sv-input" placeholder="Your registered business name" autocomplete="organization" />
          </div>
          <div style="margin-bottom:1rem;">
            <label for="sv-website" style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.4rem;color:#374151;">Website</label>
            <input id="sv-website" name="website" type="url" maxlength="200"
              class="sv-input" placeholder="https://yourbusiness.com" autocomplete="url" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
            <div>
              <label for="sv-phone" style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.4rem;color:#374151;">Phone</label>
              <input id="sv-phone" name="phone" type="tel" maxlength="30"
                class="sv-input" placeholder="+44 7700 000000" autocomplete="tel" />
            </div>
            <div>
              <label for="sv-postcode" style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.4rem;color:#374151;">Postcode / Location</label>
              <input id="sv-postcode" name="postcode" type="text" maxlength="60"
                class="sv-input" placeholder="SW1A 1AA" autocomplete="postal-code" />
            </div>
          </div>
          <div style="margin-bottom:1.5rem;">
            <label for="sv-note" style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.4rem;color:#374151;">Additional information</label>
            <textarea id="sv-note" name="note" maxlength="1000" rows="3"
              class="sv-input" placeholder="Briefly describe your business and why you'd like to be verified…" style="resize:vertical;"></textarea>
            <p id="sv-note-counter" style="margin:0.3rem 0 0;font-size:0.75rem;color:#9ca3af;">0 / 1000 characters</p>
          </div>
          <button type="submit" id="sv-submit-btn">Submit Verification Request</button>
          <button type="button" id="sv-cancel-btn">Cancel</button>
        </form>
      </div>`;

    document.body.appendChild(modal);

    // Live character counter for note textarea
    const noteEl = document.getElementById('sv-note');
    const noteCounter = document.getElementById('sv-note-counter');
    if (noteEl && noteCounter) {
      noteEl.addEventListener('input', function () {
        const charCount = noteEl.value.length;
        noteCounter.textContent = `${charCount} / 1000 characters`;
        noteCounter.style.color = charCount > 900 ? '#f59e0b' : '#9ca3af';
      });
    }

    // Close handlers
    function closeModal() {
      modal.classList.remove('sv-open');
    }
    document.getElementById('sv-modal-close').addEventListener('click', closeModal);
    document.getElementById('sv-cancel-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeModal();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('sv-open')) {
        closeModal();
      }
    });

    // Form submit
    document.getElementById('sv-verification-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errorEl = document.getElementById('sv-modal-error');
      const successEl = document.getElementById('sv-modal-success');
      const submitBtn = document.getElementById('sv-submit-btn');
      errorEl.style.display = 'none';
      successEl.style.display = 'none';

      const businessName = document.getElementById('sv-businessName').value.trim();
      if (!businessName) {
        errorEl.textContent = 'Business name is required.';
        errorEl.style.display = 'block';
        document.getElementById('sv-businessName').focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';

      try {
        // Fetch CSRF token
        const csrfRes = await fetch('/api/csrf-token', { credentials: 'include' });
        const csrfData = csrfRes.ok ? await csrfRes.json() : {};
        const csrfToken = csrfData.csrfToken || '';

        const body = {
          businessName,
          website: document.getElementById('sv-website').value.trim(),
          phone: document.getElementById('sv-phone').value.trim(),
          postcode: document.getElementById('sv-postcode').value.trim(),
          note: document.getElementById('sv-note').value.trim(),
        };

        const res = await fetch('/api/me/suppliers/verification-request', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (res.status === 409) {
          successEl.innerHTML =
            '✅ ' + (data.message || 'A verification request is already under review. Our team will be in touch within 24 hours.');
          successEl.style.display = 'block';
          document.getElementById('sv-verification-form').style.display = 'none';
          return;
        }

        if (!res.ok) {
          errorEl.textContent = data.error || 'Failed to submit request. Please try again.';
          errorEl.style.display = 'block';
          return;
        }

        successEl.innerHTML =
          '✅ ' + (data.message || 'Verification request submitted! Our team will review it within 24 hours.');
        successEl.style.display = 'block';
        document.getElementById('sv-verification-form').style.display = 'none';
      } catch (err) {
        errorEl.textContent = 'Network error. Please check your connection and try again.';
        errorEl.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Verification Request';
      }
    });

    return modal;
  }

  function openVerificationModal(supplierProfile) {
    const modal = buildModal();
    // Pre-fill fields if profile data is available
    if (supplierProfile) {
      const nameEl = document.getElementById('sv-businessName');
      const websiteEl = document.getElementById('sv-website');
      const phoneEl = document.getElementById('sv-phone');
      const postcodeEl = document.getElementById('sv-postcode');
      if (nameEl && supplierProfile.name) {
        nameEl.value = supplierProfile.name;
      }
      if (websiteEl && supplierProfile.website) {
        websiteEl.value = supplierProfile.website;
      }
      if (phoneEl && supplierProfile.phone) {
        phoneEl.value = supplierProfile.phone;
      }
      if (postcodeEl) {
        postcodeEl.value = supplierProfile.venuePostcode || supplierProfile.location || '';
      }
    }
    // Reset form state
    const errorEl = document.getElementById('sv-modal-error');
    const successEl = document.getElementById('sv-modal-success');
    const form = document.getElementById('sv-verification-form');
    if (errorEl) {
      errorEl.style.display = 'none';
    }
    if (successEl) {
      successEl.style.display = 'none';
    }
    if (form) {
      form.style.display = '';
    }
    modal.classList.add('sv-open');
    // Focus first input after animation
    setTimeout(function () {
      const firstInput = document.getElementById('sv-businessName');
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

      // Render banner
      banner.style.cssText = [
        'display:block',
        'margin-bottom:1.25rem',
        'padding:1rem 1.25rem',
        'border-radius:12px',
        'border-left:4px solid #f59e0b',
        'background:linear-gradient(135deg,rgba(245,158,11,0.12) 0%,rgba(251,191,36,0.06) 100%)',
        'box-shadow:0 2px 8px rgba(245,158,11,0.12)',
      ].join(';');

      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.875rem;flex-wrap:wrap;">
          <span style="font-size:1.5rem;flex-shrink:0;line-height:1;" aria-hidden="true">⏳</span>
          <div style="flex:1;min-width:180px;">
            <strong style="display:block;font-size:0.9375rem;color:#92400e;margin-bottom:0.2rem;">Supplier profile pending approval</strong>
            <span style="font-size:0.8125rem;color:#78350f;line-height:1.45;">
              You won't appear in search results or be able to create packages, send messages, or publish calendar events until an admin approves your profile.
            </span>
          </div>
          <button id="sv-open-widget-btn"
            style="flex-shrink:0;padding:0.5rem 1.25rem;background:#f59e0b;color:#fff;border:none;border-radius:999px;font-weight:700;font-size:0.8125rem;cursor:pointer;transition:background 0.15s,transform 0.1s;letter-spacing:0.01em;white-space:nowrap;"
            aria-label="Open verification request form">
            Get Verified →
          </button>
        </div>`;

      document.getElementById('sv-open-widget-btn').addEventListener('click', function () {
        openVerificationModal(supplierProfile);
      });
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

