'use strict';
(function () {
  if (window.__supplierProfilePublicPolishLoaded) {
    return;
  }
  window.__supplierProfilePublicPolishLoaded = true;

  const safety = window.EventFlowSupplierProfileSafety || {};
  const isPreview = safety.isPreview === true;
  const STYLE_ID = 'supplier-profile-public-polish-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      body.supplier-profile-preview .supplier-hero {
        margin-top: 0.35rem;
      }

      .sp-preview-watermark {
        display: inline-flex;
        align-items: center;
        gap: 0.42rem;
        margin-left: 0.5rem;
        padding: 0.25rem 0.58rem;
        border: 1px solid rgba(124, 58, 237, 0.22);
        border-radius: 999px;
        background: rgba(124, 58, 237, 0.08);
        color: #5b21b6;
        font-size: 0.75rem;
        font-weight: 800;
        vertical-align: middle;
      }

      .sp-preview-hint {
        margin-top: 0.7rem;
        padding: 0.72rem 0.88rem;
        border: 1px solid rgba(124, 58, 237, 0.2);
        border-radius: 14px;
        background: linear-gradient(135deg, rgba(124, 58, 237, 0.08), rgba(80, 192, 176, 0.08));
        color: #3b3161;
        font-size: 0.8125rem;
        font-weight: 650;
      }

      .sp-card,
      .sp-cta-card,
      .sp-trust-card,
      .sp-details-card {
        backdrop-filter: blur(16px) saturate(160%);
        -webkit-backdrop-filter: blur(16px) saturate(160%);
      }

      .sp-card--gallery[data-empty-hidden='true'] {
        display: none !important;
      }

      .sp-cta-card__note[data-derived='true'] {
        color: var(--sp-primary, #0b8073);
        font-weight: 750;
      }

      .sp-social-link[href=''],
      .sp-social-link:not([href]) {
        display: none !important;
      }

      .sp-polish-safe-hidden {
        display: none !important;
      }

      .sp-trust-item--credential .sp-trust-icon {
        color: #0b8073;
      }
    `;
    document.head.appendChild(style);
  }

  function updatePreviewState() {
    if (!isPreview) {
      return;
    }
    document.body.classList.add('supplier-profile-preview');
    const title = document.getElementById('hero-title');
    if (title && !title.querySelector('.sp-preview-watermark') && title.textContent.trim()) {
      const badge = document.createElement('span');
      badge.className = 'sp-preview-watermark';
      badge.textContent = 'Preview';
      title.appendChild(badge);
    }
    const heroMeta = document.getElementById('hero-meta');
    const heroIdentity = document.querySelector('.hero-identity');
    if (heroIdentity && heroMeta && !heroIdentity.querySelector('.sp-preview-hint')) {
      const hint = document.createElement('p');
      hint.className = 'sp-preview-hint';
      hint.textContent =
        'This preview is private to you and does not count as a public profile view.';
      heroMeta.insertAdjacentElement('afterend', hint);
    }
  }

  function hidePublicEmptyGallery() {
    const gallerySection = document.getElementById('sp-section-gallery');
    if (!gallerySection || isPreview) {
      return;
    }
    const empty = gallerySection.querySelector('.sp-gallery-empty');
    if (!empty) {
      return;
    }
    const card = empty.closest('.sp-card') || gallerySection;
    card.dataset.emptyHidden = 'true';
    gallerySection.style.display = 'none';
  }

  function updateResponseNote(note, text, derived) {
    if (note.textContent !== text) {
      note.textContent = text;
    }
    if (note.dataset.derived !== derived) {
      note.dataset.derived = derived;
    }
  }

  function deriveResponseCopy() {
    const details = document.querySelectorAll('.sp-detail-row');
    let responseText = '';
    details.forEach(row => {
      const label = row.querySelector('.sp-detail-row__label')?.textContent?.trim().toLowerCase();
      const value = row.querySelector('.sp-detail-row__value')?.textContent?.trim();
      if (label === 'response' && value) {
        responseText = `Typical response time: ${value.replace(/^~/, 'about ')}`;
      }
    });
    const note = document.querySelector('.sp-cta-card__note');
    if (!note) {
      return;
    }
    if (responseText) {
      const currentText = String(note.textContent || '').trim();
      const nextText = /^typically responds\b/i.test(currentText) ? currentText : responseText;
      updateResponseNote(note, nextText, 'true');
    } else if (/usually responds/i.test(note.textContent || '')) {
      updateResponseNote(
        note,
        'Send a message and the supplier will reply through EventFlow.',
        'false'
      );
    }
  }

  function tidyUnsafeRenderedLinks() {
    const safeExternalUrl = safety.safeExternalUrl || (value => value || '');
    document.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href') || '';
      if (
        href.startsWith('tel:') ||
        href.startsWith('#') ||
        href.startsWith('/') ||
        href.startsWith('mailto:')
      ) {
        return;
      }
      const safe = safeExternalUrl(href);
      if (!safe) {
        link.classList.add('sp-polish-safe-hidden');
        link.removeAttribute('href');
      }
    });
  }

  function tidyImages() {
    const safeImageUrl = safety.safeImageUrl || (value => value || '');
    document
      .querySelectorAll('.supplier-hero img, .sp-gallery img, .sp-pkg-card__image, .wed-party img')
      .forEach(img => {
        const safe = safeImageUrl(img.getAttribute('src') || '');
        if (!safe) {
          img.classList.add('sp-polish-safe-hidden');
          img.removeAttribute('src');
        }
      });
  }

  function getSupplier() {
    return window.__supplierData && typeof window.__supplierData === 'object'
      ? window.__supplierData
      : null;
  }

  function explicitEmailVerified(supplier) {
    return Boolean(supplier?.emailVerified || supplier?.verifications?.email?.verified);
  }

  function profileApproved(supplier) {
    return supplier?.profileApproved === true || supplier?.approved === true;
  }

  function trustCredentialVerified(supplier, key) {
    return supplier?.trustVerifications?.[key]?.verified === true;
  }

  function syncHeroVerificationBadge() {
    const supplier = getSupplier();
    if (!supplier) {
      return;
    }

    // The legacy renderer used `supplier.verified` as a fallback for email
    // verification. Profile approval and email verification are different facts.
    document.querySelectorAll('#hero-badges .badge-email-verified').forEach(badge => {
      if (explicitEmailVerified(supplier)) {
        if (badge.textContent !== 'Email verified') {
          badge.textContent = 'Email verified';
        }
        badge.title = 'Email address verified';
        badge.setAttribute('aria-label', 'Email verified');
        return;
      }
      if (profileApproved(supplier)) {
        if (badge.textContent !== 'Approved listing') {
          badge.textContent = 'Approved listing';
        }
        badge.title =
          'This listing has been approved by EventFlow. It does not confirm the ' +
          "supplier's identity, insurance or licensing.";
        badge.setAttribute('aria-label', 'Approved listing');
      } else {
        badge.remove();
      }
    });
  }

  function buildTrustItem(label, credential = false) {
    return `<div class="sp-trust-item${credential ? ' sp-trust-item--credential' : ''}"><span class="sp-trust-icon" aria-hidden="true">✓</span><span>${label}</span></div>`;
  }

  function renderTrustSafety() {
    const supplier = getSupplier();
    const container = document.getElementById('sp-sidebar-trust');
    if (!supplier || !container) {
      return;
    }

    const labels = [];
    if (profileApproved(supplier)) {
      labels.push(['Listing approved', false]);
    }
    if (explicitEmailVerified(supplier)) {
      labels.push(['Email verified', false]);
    }
    if (supplier.phoneVerified || supplier.verifications?.phone?.verified) {
      labels.push(['Phone verified', false]);
    }
    if (supplier.businessVerified || supplier.verifications?.business?.verified) {
      labels.push(['Business verified', false]);
    }
    if (trustCredentialVerified(supplier, 'publicLiability')) {
      labels.push(['Public liability insurance verified', true]);
    }
    if (trustCredentialVerified(supplier, 'dbs')) {
      labels.push(['DBS check confirmed', true]);
    }
    if (trustCredentialVerified(supplier, 'licence')) {
      labels.push(['Licence verified', true]);
    }

    // Deliberately do not promote supplier-entered `insurance` / `license`
    // fields into EventFlow trust claims. Trust badges must be explicit or
    // admin-confirmed facts.
    const signature = JSON.stringify(labels);
    if (labels.length === 0) {
      if (container.dataset.trustSignature !== signature || container.innerHTML) {
        container.innerHTML = '';
        container.dataset.trustSignature = signature;
      }
      container.style.display = 'none';
      return;
    }

    if (container.dataset.trustSignature !== signature) {
      const items = labels.map(([label, credential]) => buildTrustItem(label, credential));
      container.innerHTML = `
        <div class="sp-trust-card">
          <div class="sp-trust-card__title">Trust &amp; Safety</div>
          <div class="sp-trust-list">${items.join('')}</div>
        </div>
      `;
      container.dataset.trustSignature = signature;
    }
    container.style.display = '';
  }

  function syncRecognitionVerification() {
    const supplier = getSupplier();
    const section = document.getElementById('sp-section-badges');
    if (!supplier || !section) {
      return;
    }

    section.querySelectorAll('.badge-email-verified').forEach(badge => {
      if (explicitEmailVerified(supplier)) {
        return;
      }
      if (profileApproved(supplier)) {
        if (badge.textContent !== 'Approved listing') {
          badge.textContent = 'Approved listing';
        }
        badge.setAttribute('aria-label', 'Approved listing');
      } else {
        badge.remove();
      }
    });

    const verificationRows = section.querySelectorAll('.sp-badges-row');
    let verificationRow = null;
    verificationRows.forEach(row => {
      const label = row.previousElementSibling;
      if (
        label?.classList.contains('sp-badges-group-label') &&
        /verification/i.test(label.textContent)
      ) {
        verificationRow = row;
      }
    });

    const extra = [
      ['publicLiability', 'PLI verified'],
      ['dbs', 'DBS checked'],
      ['licence', 'Licence verified'],
    ];
    const hasExtraVerification = extra.some(([key]) => trustCredentialVerified(supplier, key));
    if (!verificationRow && hasExtraVerification) {
      const card = section.querySelector('.sp-badges-section');
      if (card) {
        const label = document.createElement('p');
        label.className = 'sp-badges-group-label';
        label.textContent = 'Verification';
        verificationRow = document.createElement('div');
        verificationRow.className = 'sp-badges-row';
        card.append(label, verificationRow);
      }
    }
    if (!verificationRow) {
      return;
    }

    extra.forEach(([key, label]) => {
      const marker = `trust-${key}`;
      const existing = verificationRow.querySelector(`[data-trust-badge="${marker}"]`);
      if (trustCredentialVerified(supplier, key)) {
        if (!existing) {
          const badge = document.createElement('span');
          badge.className = 'badge badge-business-verified';
          badge.dataset.trustBadge = marker;
          badge.textContent = label;
          badge.setAttribute('aria-label', label);
          verificationRow.appendChild(badge);
        }
      } else if (existing) {
        existing.remove();
      }
    });
  }

  let runQueued = false;
  function run() {
    if (runQueued) {
      return;
    }
    runQueued = true;
    requestAnimationFrame(() => {
      runQueued = false;
      injectStyles();
      updatePreviewState();
      hidePublicEmptyGallery();
      deriveResponseCopy();
      tidyUnsafeRenderedLinks();
      tidyImages();
      syncHeroVerificationBadge();
      renderTrustSafety();
      syncRecognitionVerification();
    });
  }

  const observer = new MutationObserver(run);
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 45000);

  window.addEventListener('sp:dataReady', run);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
