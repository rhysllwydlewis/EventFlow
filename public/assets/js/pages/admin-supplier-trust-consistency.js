(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const supplierId = params.get('id');
  if (!supplierId || !window.AdminShared) {
    return;
  }

  const TRUST_BADGES = [
    {
      id: 'public-liability-verified',
      key: 'publicLiability',
      label: 'Public Liability Insurance',
      help: 'Only confirm after EventFlow has reviewed appropriate public liability insurance evidence.',
    },
    {
      id: 'dbs-checked',
      key: 'dbs',
      label: 'DBS Check',
      help: 'Only confirm that evidence has been checked. Do not store or expose DBS contents in this badge.',
    },
    {
      id: 'licence-verified',
      key: 'licence',
      label: 'Relevant Licence',
      help: 'Only confirm where a relevant licence has been independently reviewed by EventFlow.',
    },
  ];

  let supplier = null;
  let applying = false;

  function asText(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function canonicalDescription(data) {
    return (
      asText(data?.description_long) ||
      asText(data?.description_short) ||
      asText(data?.description) ||
      asText(data?.blurb)
    );
  }

  function canonicalPrice(data) {
    return asText(data?.priceRange) || asText(data?.price_display) || asText(data?.priceDisplay);
  }

  function canonicalPhotoCount(data) {
    const canonical = Array.isArray(data?.photosGallery) ? data.photosGallery.length : 0;
    const legacy = Array.isArray(data?.images) ? data.images.length : 0;
    const recorded = Number(data?.photoCount || 0) || 0;
    return Math.max(canonical, legacy, recorded);
  }

  // Mirrors the Supplier Management score so the list and detail views do not
  // display contradictory values for the same record. Alias-aware reads prevent
  // populated modern profile fields being treated as empty.
  function calculateAdminHealth(data) {
    let score = 0;
    const profileValues = [
      asText(data?.name),
      canonicalDescription(data),
      asText(data?.location),
      asText(data?.category),
      canonicalPrice(data),
    ];
    const completedFields = profileValues.filter(Boolean).length;
    score += (completedFields / profileValues.length) * 30;

    const responseRate = Number(data?.responseRate || 0);
    score += Math.max(0, Math.min(1, responseRate)) * 25;

    const averageRating = Number(data?.averageRating ?? data?.rating ?? 0);
    score += (Math.max(0, Math.min(5, averageRating)) / 5) * 20;

    const bookingCount = Number(data?.bookingCount || data?.bookings?.length || 0);
    score += Math.min(Math.max(bookingCount, 0) / 10, 1) * 15;

    score += Math.min(canonicalPhotoCount(data) / 10, 1) * 10;
    return Math.round(score);
  }

  function findInfoValue(containerId, labelText) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    const field = Array.from(container.querySelectorAll('.info-field')).find(item =>
      item.querySelector('label')?.textContent?.trim().toLowerCase() === labelText.toLowerCase()
    );
    return field?.querySelector('value') || null;
  }

  function updateExistingAdminFields() {
    if (!supplier) return;

    const descriptionValue = findInfoValue('businessInfo', 'Description');
    const description = canonicalDescription(supplier) || 'No description';
    if (descriptionValue && descriptionValue.textContent !== description) {
      descriptionValue.textContent = description;
    }

    const health = calculateAdminHealth(supplier);
    document.querySelectorAll('#supplierMeta .supplier-meta-item').forEach(item => {
      const strong = item.querySelector('strong');
      if (strong?.textContent?.trim() === 'Health Score:') {
        const expected = `Health Score: ${health}/100`;
        if (item.textContent.replace(/\s+/g, ' ').trim() !== expected) {
          item.innerHTML = `<strong>Health Score:</strong> ${health}/100`;
        }
      }
    });

    const analyticsHealth = document.getElementById('healthScore');
    if (analyticsHealth && analyticsHealth.textContent !== String(health)) {
      analyticsHealth.textContent = String(health);
    }
  }

  function isTrustedBadge(item) {
    return supplier?.trustVerifications?.[item.key]?.verified === true;
  }

  function bannerState(data) {
    const value = asText(data?.bannerUrl || data?.coverImage);
    if (!value) {
      return {
        tone: 'amber',
        label: 'Not configured',
        detail: 'The public profile will use the fallback hero until a banner is saved.',
      };
    }
    if (/^data:image\//i.test(value)) {
      return {
        tone: 'red',
        label: 'Legacy upload needs repair',
        detail: 'A base64/data URL is stored. Public profiles deliberately do not publish this format.',
      };
    }
    if (/^(https?:\/\/|\/api\/photos\/|\/uploads\/)/i.test(value)) {
      return {
        tone: 'green',
        label: 'Configured',
        detail: 'A publishable banner URL is present on the supplier record.',
      };
    }
    return {
      tone: 'red',
      label: 'Invalid banner value',
      detail: 'The stored banner value is not a recognised public image URL.',
    };
  }

  function statusPill(verified, positiveLabel = 'Verified', negativeLabel = 'Not verified') {
    return verified
      ? `<span style="display:inline-block;padding:0.18rem 0.55rem;border-radius:999px;background:#d1fae5;color:#065f46;font-size:0.78rem;font-weight:700;">${AdminShared.escapeHtml(positiveLabel)}</span>`
      : `<span style="display:inline-block;padding:0.18rem 0.55rem;border-radius:999px;background:#f1f5f9;color:#475569;font-size:0.78rem;font-weight:700;">${AdminShared.escapeHtml(negativeLabel)}</span>`;
  }

  function bannerPill(state) {
    const palette = {
      green: ['#d1fae5', '#065f46'],
      amber: ['#fef3c7', '#92400e'],
      red: ['#fee2e2', '#991b1b'],
    }[state.tone] || ['#f1f5f9', '#475569'];
    return `<span style="display:inline-block;padding:0.18rem 0.55rem;border-radius:999px;background:${palette[0]};color:${palette[1]};font-size:0.78rem;font-weight:700;">${AdminShared.escapeHtml(state.label)}</span>`;
  }

  function getOrCreateTrustCard() {
    let card = document.getElementById('adminSupplierTrustSafety');
    if (card) return card;

    const contactInfo = document.getElementById('contactInfo');
    const contactCard = contactInfo?.closest('.info-card');
    if (!contactCard) return null;

    card = document.createElement('div');
    card.className = 'info-card';
    card.id = 'adminSupplierTrustSafety';
    contactCard.insertAdjacentElement('afterend', card);
    return card;
  }

  function renderTrustCard() {
    if (!supplier) return;
    const card = getOrCreateTrustCard();
    if (!card) return;

    const banner = bannerState(supplier);
    // Public directory visibility is controlled by approved === true. Keep this
    // diagnostic fail-closed instead of upgrading stale verified/status aliases.
    const profileApproved = supplier.approved === true;
    const conflictingApprovalSignal =
      !profileApproved &&
      (supplier.verificationStatus === 'approved' || supplier.verified === true);
    const trustState = TRUST_BADGES.map(item => [item.id, isTrustedBadge(item)]);
    const signature = JSON.stringify({
      profileApproved,
      conflictingApprovalSignal,
      bannerTone: banner.tone,
      bannerLabel: banner.label,
      bannerValue: asText(supplier.bannerUrl || supplier.coverImage),
      trustState,
    });

    // The overview is observed because the primary admin script renders after us.
    // Do not rebuild this card unless its underlying state actually changed, or
    // our own DOM writes would recursively trigger the MutationObserver.
    if (card.dataset.renderSignature === signature) {
      return;
    }
    card.dataset.renderSignature = signature;

    const rows = TRUST_BADGES.map(item => {
      const verified = isTrustedBadge(item);
      return `
        <div style="display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:1rem;align-items:center;padding:0.85rem 0;border-top:1px solid #eef2f7;">
          <div>
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <strong>${AdminShared.escapeHtml(item.label)}</strong>
              ${statusPill(verified)}
            </div>
            <p class="small" style="margin:0.35rem 0 0;color:#6b7280;max-width:780px;">${AdminShared.escapeHtml(item.help)}</p>
          </div>
          <button
            type="button"
            class="ef-cta btn btn-small ${verified ? 'btn-secondary' : 'btn-success'}"
            data-trust-badge="${item.id}"
            data-trust-action="${verified ? 'remove' : 'award'}"
          >${verified ? 'Remove verification' : 'Confirm verified'}</button>
        </div>
      `;
    }).join('');

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
        <div>
          <h3 style="margin:0;">Trust &amp; Safety</h3>
          <p class="small" style="margin:0.4rem 0 0;color:#6b7280;max-width:820px;">
            These are EventFlow-confirmed trust signals, separate from normal profile approval. Do not confirm PLI, DBS or licence badges from supplier-entered text alone. No DBS contents or sensitive certificate details are stored in these badges.
          </p>
        </div>
        <a class="ef-cta btn btn-secondary btn-small" href="/supplier?id=${encodeURIComponent(supplierId)}" target="_blank" rel="noopener noreferrer">Open public profile</a>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:0.75rem;margin-top:1rem;">
        <div style="padding:0.8rem;border:1px solid #e5e7eb;border-radius:10px;">
          <div class="small" style="color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">Profile approval</div>
          <div style="margin-top:0.35rem;">${statusPill(profileApproved, 'Approved', 'Not approved')}</div>
          ${
            conflictingApprovalSignal
              ? '<div class="small" style="color:#b45309;margin-top:0.4rem;">Data mismatch: a legacy verification signal says approved, but the authoritative listing flag is not approved.</div>'
              : ''
          }
        </div>
        <div style="padding:0.8rem;border:1px solid #e5e7eb;border-radius:10px;">
          <div class="small" style="color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">Banner</div>
          <div style="margin-top:0.35rem;">${bannerPill(banner)}</div>
          <div class="small" style="color:#6b7280;margin-top:0.35rem;">${AdminShared.escapeHtml(banner.detail)}</div>
        </div>
      </div>
      <div style="margin-top:0.4rem;">${rows}</div>
    `;

    card.querySelectorAll('[data-trust-badge]').forEach(button => {
      button.addEventListener('click', handleTrustBadgeAction);
    });
  }

  async function handleTrustBadgeAction(event) {
    const button = event.currentTarget;
    const badgeId = button.dataset.trustBadge;
    const action = button.dataset.trustAction;
    const config = TRUST_BADGES.find(item => item.id === badgeId);
    if (!config || !supplier) return;

    const awarding = action === 'award';
    const confirmed = await AdminShared.showConfirmModal({
      title: awarding ? `Confirm ${config.label}` : `Remove ${config.label}`,
      message: awarding
        ? `Confirm that EventFlow has reviewed sufficient evidence for ${config.label}. This will show a trust signal on the public supplier profile and create an admin audit record.`
        : `Remove the public ${config.label} trust signal from this supplier? This change will be audited.`,
      confirmText: awarding ? 'Confirm verified' : 'Remove',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    button.disabled = true;
    try {
      const response = await AdminShared.api(
        `/api/admin/suppliers/${supplierId}/trust-badges/${encodeURIComponent(badgeId)}`,
        awarding ? 'POST' : 'DELETE',
        awarding ? {} : undefined
      );
      const updated = response?.supplier || {};
      if (Array.isArray(updated.badges)) {
        supplier.badges = updated.badges;
      }
      if (updated.trustVerifications && typeof updated.trustVerifications === 'object') {
        supplier.trustVerifications = updated.trustVerifications;
      }
      AdminShared.showToast(
        awarding ? `${config.label} confirmed` : `${config.label} verification removed`,
        'success'
      );
      renderTrustCard();
    } catch (error) {
      AdminShared.showToast(
        `Failed to update ${config.label}: ${error.message || 'Unknown error'}`,
        'error'
      );
      button.disabled = false;
    }
  }

  function applyConsistency() {
    if (applying || !supplier) return;
    applying = true;
    try {
      updateExistingAdminFields();
      renderTrustCard();
    } finally {
      applying = false;
    }
  }

  async function load() {
    try {
      const response = await AdminShared.api(`/api/admin/suppliers/${supplierId}`);
      supplier = response.supplier || response;
      applyConsistency();

      // The primary supplier-detail script renders asynchronously. Re-apply the
      // consistency layer when those areas are populated without polling forever.
      const target = document.getElementById('overview') || document.body;
      const observer = new MutationObserver(() => applyConsistency());
      observer.observe(target, { childList: true, subtree: true });
      window.setTimeout(() => observer.disconnect(), 15000);
    } catch (error) {
      console.warn('[AdminSupplierTrust] Unable to load supplier consistency data:', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }
})();
