(function () {
  'use strict';

  if (window.__supplierProfilePublicPolishLoaded) return;
  window.__supplierProfilePublicPolishLoaded = true;

  const safety = window.EventFlowSupplierProfileSafety || {};
  const isPreview = safety.isPreview === true;
  const STYLE_ID = 'supplier-profile-public-polish-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
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
    `;
    document.head.appendChild(style);
  }

  function updatePreviewState() {
    if (!isPreview) return;
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
    if (!gallerySection || isPreview) return;
    const empty = gallerySection.querySelector('.sp-gallery-empty');
    if (!empty) return;
    const card = empty.closest('.sp-card') || gallerySection;
    card.dataset.emptyHidden = 'true';
    gallerySection.style.display = 'none';
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
    if (!note) return;
    if (responseText) {
      note.textContent = responseText;
      note.dataset.derived = 'true';
    } else if (/usually responds/i.test(note.textContent || '')) {
      note.textContent = 'Send a message and the supplier will reply through EventFlow.';
      note.dataset.derived = 'false';
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

  function run() {
    injectStyles();
    updatePreviewState();
    hidePublicEmptyGallery();
    deriveResponseCopy();
    tidyUnsafeRenderedLinks();
    tidyImages();
  }

  const observer = new MutationObserver(run);
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 45000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
