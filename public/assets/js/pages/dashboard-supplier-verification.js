(function () {
  function esc(unsafe) {
    if (!unsafe) {
      return '';
    }
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── Verification Widget Modal ───────────────────────────────────────────────

  function buildModal() {
    const existing = document.getElementById('sv-verification-modal');
    if (existing) {
      return existing;
    }
    const modal = document.createElement('div');
    modal.id = 'sv-verification-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'sv-modal-title');
    modal.style.cssText = [
      'display:none',
      'position:fixed',
      'inset:0',
      'z-index:9999',
      'background:rgba(0,0,0,0.55)',
      'align-items:center',
      'justify-content:center',
      'padding:1rem',
    ].join(';');

    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:480px;width:100%;padding:2rem;box-shadow:0 20px 60px rgba(0,0,0,0.25);position:relative;">
        <button id="sv-modal-close" aria-label="Close" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.4rem;cursor:pointer;color:#6b7280;line-height:1;">×</button>
        <h2 id="sv-modal-title" style="margin:0 0 0.25rem;font-size:1.2rem;font-weight:700;color:#111827;">Request Supplier Verification</h2>
        <p style="margin:0 0 1.25rem;font-size:0.875rem;color:#6b7280;">Fill in the details below and our team will review your request within 24 hours.</p>
        <div id="sv-modal-error" role="alert" style="display:none;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:0.75rem;margin-bottom:1rem;font-size:0.875rem;color:#991b1b;"></div>
        <div id="sv-modal-success" role="status" style="display:none;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:0.75rem;margin-bottom:1rem;font-size:0.875rem;color:#166534;"></div>
        <form id="sv-verification-form" novalidate>
          <div style="margin-bottom:1rem;">
            <label for="sv-businessName" style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:0.375rem;color:#374151;">Business Name <span style="color:#ef4444;">*</span></label>
            <input id="sv-businessName" name="businessName" type="text" required maxlength="120"
              style="width:100%;box-sizing:border-box;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:8px;font-size:0.9rem;outline:none;" placeholder="Your business name" />
          </div>
          <div style="margin-bottom:1rem;">
            <label for="sv-website" style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:0.375rem;color:#374151;">Website</label>
            <input id="sv-website" name="website" type="url" maxlength="200"
              style="width:100%;box-sizing:border-box;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:8px;font-size:0.9rem;outline:none;" placeholder="https://yourbusiness.com" />
          </div>
          <div style="margin-bottom:1rem;">
            <label for="sv-phone" style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:0.375rem;color:#374151;">Phone</label>
            <input id="sv-phone" name="phone" type="tel" maxlength="30"
              style="width:100%;box-sizing:border-box;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:8px;font-size:0.9rem;outline:none;" placeholder="+44 1234 567890" />
          </div>
          <div style="margin-bottom:1rem;">
            <label for="sv-postcode" style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:0.375rem;color:#374151;">Location / Postcode</label>
            <input id="sv-postcode" name="postcode" type="text" maxlength="60"
              style="width:100%;box-sizing:border-box;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:8px;font-size:0.9rem;outline:none;" placeholder="SW1A 1AA or City, County" />
          </div>
          <div style="margin-bottom:1.5rem;">
            <label for="sv-note" style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:0.375rem;color:#374151;">Additional information</label>
            <textarea id="sv-note" name="note" maxlength="1000" rows="3"
              style="width:100%;box-sizing:border-box;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:8px;font-size:0.9rem;outline:none;resize:vertical;" placeholder="Tell us a bit about your business and why you'd like to be verified…"></textarea>
          </div>
          <button type="submit" id="sv-submit-btn"
            style="width:100%;padding:0.65rem 1rem;background:#6366f1;color:#fff;font-size:0.9rem;font-weight:600;border:none;border-radius:8px;cursor:pointer;transition:background 0.15s;">
            Submit Verification Request
          </button>
          <button type="button" id="sv-cancel-btn"
            style="width:100%;margin-top:0.5rem;padding:0.5rem 1rem;background:none;color:#6b7280;font-size:0.875rem;font-weight:500;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;">
            Cancel
          </button>
        </form>
      </div>`;

    document.body.appendChild(modal);

    // Close handlers
    function closeModal() {
      modal.style.display = 'none';
    }
    document.getElementById('sv-modal-close').addEventListener('click', closeModal);
    document.getElementById('sv-cancel-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeModal();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.style.display !== 'none') {
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
          successEl.textContent =
            data.message || 'A verification request is already pending review. We will be in touch within 24 hours.';
          successEl.style.display = 'block';
          document.getElementById('sv-verification-form').style.display = 'none';
          return;
        }

        if (!res.ok) {
          errorEl.textContent = data.error || 'Failed to submit request. Please try again.';
          errorEl.style.display = 'block';
          return;
        }

        successEl.textContent =
          data.message || 'Verification request submitted! Our team will review it within 24 hours.';
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
    modal.style.display = 'flex';
    const firstInput = document.getElementById('sv-businessName');
    if (firstInput) {
      firstInput.focus();
    }
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

      // Only show banner for supplier role users with an unapproved profile
      if (data.role !== 'supplier') {
        return;
      }
      if (data.supplierApproved === true) {
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

      banner.style.cssText = [
        'display:block',
        'margin-bottom:1rem',
        'padding:1rem 1.25rem',
        'border-radius:12px',
        'border-left:4px solid #f59e0b',
        'background:rgba(245,158,11,0.08)',
      ].join(';');

      banner.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:0.75rem;flex-wrap:wrap;">
          <span style="font-size:1.4rem;flex-shrink:0;" aria-hidden="true">⏳</span>
          <div style="flex:1;min-width:200px;">
            <strong style="font-size:0.95rem;color:#92400e;">Your supplier profile is pending approval</strong>
            <p style="margin:0.25rem 0 0;font-size:0.85rem;color:#78350f;">
              You won't appear in search results or be able to create packages, send messages, or publish calendar events until approved.
            </p>
          </div>
          <button id="sv-open-widget-btn"
            style="flex-shrink:0;margin-top:0.25rem;padding:0.45rem 1.1rem;background:#f59e0b;color:#fff;border:none;border-radius:999px;font-weight:600;font-size:0.85rem;cursor:pointer;transition:background 0.15s;"
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
