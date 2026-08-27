'use strict';

let activeRequestId = 0;
let activeLightbox = null;

function getSupplierId() {
  return new URLSearchParams(window.location.search).get('id') || '';
}

function isUsableSupplierImageUrl(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const url = value.trim();
  return /^(https?:\/\/[^\s]+|\/[^/\\:][^:]*)$/i.test(url);
}

function getSupplierProfileImage(supplier) {
  const candidates = [
    supplier?.profilePhotoUrl,
    supplier?.displayAvatarUrl,
    supplier?.avatarUrl,
    supplier?.logo,
  ];
  const imageUrl = candidates.find(isUsableSupplierImageUrl);
  return typeof imageUrl === 'string' ? imageUrl.trim() : '';
}

function getLoadedSupplier(supplierId) {
  const supplier = typeof window !== 'undefined' ? window.__supplierData : null;
  if (!supplier || typeof supplier !== 'object') {
    return null;
  }
  return String(supplier.id || '') === String(supplierId) ? supplier : null;
}

function getInitialsFromName(name) {
  return window.EFSupplierAvatar.getSupplierInitials(name);
}

function getAvatarEl(img) {
  return (
    document.getElementById('hero-avatar') || (img && img.closest && img.closest('.hero-avatar'))
  );
}

function prepareAvatarShell(img, initialsEl) {
  const avatarEl = getAvatarEl(img);
  if (avatarEl) {
    avatarEl.style.position = avatarEl.style.position || 'relative';
    avatarEl.style.overflow = 'hidden';
  }
  if (img) {
    img.style.position = 'absolute';
    img.style.inset = '0';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '50%';
    img.style.zIndex = '2';
  }
  if (initialsEl) {
    initialsEl.style.position = 'relative';
    initialsEl.style.zIndex = '1';
  }
  return avatarEl;
}

function setPlaceholder(img, initialsEl, initials, gradient) {
  const avatarEl = prepareAvatarShell(img, initialsEl);
  if (avatarEl) {
    avatarEl.classList.remove('has-profile-photo');
    avatarEl.dataset.avatarStatus = 'placeholder';
    avatarEl.removeAttribute('data-avatar-url');
    if (gradient) {
      avatarEl.style.background = gradient;
    }
    disableAvatarLightbox(avatarEl);
  }
  if (img) {
    img.removeAttribute('src');
    img.classList.remove('sp-polish-safe-hidden');
    img.hidden = true;
    img.style.display = 'none';
    img.alt = '';
  }
  if (initialsEl) {
    if (initials) {
      initialsEl.textContent = initials;
    }
    initialsEl.style.display = '';
    initialsEl.hidden = false;
  }
}

function getSearchResults(payload) {
  if (Array.isArray(payload?.data?.results)) {
    return payload.data.results;
  }
  if (Array.isArray(payload?.results)) {
    return payload.results;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  return [];
}

function findSupplierInSearchPayload(payload, supplierId) {
  return getSearchResults(payload).find(
    supplier => String(supplier?.id || '') === String(supplierId)
  );
}

function getSearchUrls() {
  const urls = [];
  const loadedSupplier = typeof window !== 'undefined' ? window.__supplierData : null;
  const supplierName = loadedSupplier && (loadedSupplier.name || loadedSupplier.businessName);
  if (supplierName) {
    const params = new URLSearchParams({ q: String(supplierName), limit: '20' });
    urls.push(`/api/v2/search/suppliers?${params.toString()}`);
  }
  urls.push('/api/v2/search/suppliers?limit=100');
  return [...new Set(urls)];
}

async function fetchSupplierFromSearchRoute(supplierId) {
  for (const url of getSearchUrls()) {
    try {
      const response = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) {
        continue;
      }
      const payload = await response.json();
      const supplier = findSupplierInSearchPayload(payload, supplierId);
      if (supplier) {
        return supplier;
      }
    } catch (_error) {
      // Compatibility helper for diagnostics and legacy callers.
    }
  }
  return null;
}

async function fetchLegacyAvatarEndpoint(supplierId) {
  try {
    const response = await fetch(`/api/public/suppliers/${encodeURIComponent(supplierId)}/avatar`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    if (!payload || !payload.hasPhoto || !payload.avatarUrl) {
      return payload || null;
    }
    return {
      name: payload.initials || '',
      profilePhotoUrl: payload.avatarUrl,
    };
  } catch (_error) {
    return null;
  }
}

function ensureAvatarLightboxStyles() {
  if (!document?.head || document.getElementById('sp-avatar-lightbox-styles')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'sp-avatar-lightbox-styles';
  style.textContent = `
    .hero-avatar.is-lightbox-trigger { cursor: zoom-in; }
    .hero-avatar.is-lightbox-trigger:focus-visible {
      outline: 3px solid var(--sp-profile-accent, #0b8073);
      outline-offset: 4px;
    }
    .sp-avatar-lightbox {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: grid;
      place-items: center;
      padding: 1.25rem;
      background: rgba(2, 6, 23, 0.88);
      backdrop-filter: blur(8px);
    }
    .sp-avatar-lightbox__dialog {
      position: relative;
      display: grid;
      gap: 0.75rem;
      max-width: min(92vw, 760px);
      max-height: 92vh;
      margin: 0;
    }
    .sp-avatar-lightbox__image {
      display: block;
      max-width: 100%;
      max-height: 78vh;
      margin: auto;
      border-radius: 22px;
      background: #fff;
      box-shadow: 0 30px 90px rgba(0, 0, 0, 0.45);
      object-fit: contain;
    }
    .sp-avatar-lightbox__caption {
      margin: 0;
      color: #fff;
      text-align: center;
      font-weight: 700;
    }
    .sp-avatar-lightbox__close {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.82);
      color: #fff;
      font-size: 1.75rem;
      line-height: 1;
      cursor: pointer;
    }
    .sp-avatar-lightbox__close:focus-visible {
      outline: 3px solid #fff;
      outline-offset: 3px;
    }
  `;
  document.head.appendChild(style);
}

function closeAvatarLightbox() {
  if (!activeLightbox) {
    return;
  }
  const { overlay, trigger, previousBodyOverflow, onKeydown } = activeLightbox;
  document.removeEventListener('keydown', onKeydown);
  if (document.body) {
    document.body.style.overflow = previousBodyOverflow;
  }
  overlay.remove();
  activeLightbox = null;
  if (trigger && typeof trigger.focus === 'function') {
    trigger.focus();
  }
}

function openAvatarLightbox(avatarUrl, supplierName = 'Supplier', trigger = null) {
  if (!isUsableSupplierImageUrl(avatarUrl) || !document?.body || !document.createElement) {
    return null;
  }
  closeAvatarLightbox();
  ensureAvatarLightboxStyles();

  const overlay = document.createElement('div');
  overlay.className = 'sp-avatar-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'sp-avatar-lightbox-caption');

  const dialog = document.createElement('figure');
  dialog.className = 'sp-avatar-lightbox__dialog';
  const image = document.createElement('img');
  image.className = 'sp-avatar-lightbox__image';
  image.src = avatarUrl;
  image.alt = `${supplierName} profile photo`;
  const caption = document.createElement('figcaption');
  caption.id = 'sp-avatar-lightbox-caption';
  caption.className = 'sp-avatar-lightbox__caption';
  caption.textContent = `${supplierName} profile photo`;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'sp-avatar-lightbox__close';
  closeButton.setAttribute('aria-label', 'Close larger profile photo');
  closeButton.textContent = '×';

  dialog.append(image, caption, closeButton);
  overlay.appendChild(dialog);
  const previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.appendChild(overlay);

  const onKeydown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAvatarLightbox();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      closeButton.focus();
    }
  };
  activeLightbox = { overlay, trigger, previousBodyOverflow, onKeydown };
  document.addEventListener('keydown', onKeydown);
  closeButton.addEventListener('click', closeAvatarLightbox);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeAvatarLightbox();
    }
  });
  closeButton.focus();
  return overlay;
}

function disableAvatarLightbox(avatarEl) {
  if (!avatarEl) {
    return;
  }
  avatarEl.classList?.remove('is-lightbox-trigger');
  avatarEl.removeAttribute?.('role');
  avatarEl.removeAttribute?.('tabindex');
  avatarEl.removeAttribute?.('aria-label');
  if (avatarEl.dataset) {
    delete avatarEl.dataset.avatarLightboxUrl;
  }
}

function enableAvatarLightbox(avatarEl, img, avatarUrl) {
  if (!avatarEl || !img || !isUsableSupplierImageUrl(avatarUrl)) {
    return;
  }
  ensureAvatarLightboxStyles();
  const supplierName = String(window.__supplierData?.name || 'Supplier').trim() || 'Supplier';
  avatarEl.classList?.add('is-lightbox-trigger');
  avatarEl.setAttribute?.('role', 'button');
  avatarEl.setAttribute?.('tabindex', '0');
  avatarEl.setAttribute?.('aria-label', `View larger profile photo for ${supplierName}`);
  if (avatarEl.dataset) {
    avatarEl.dataset.avatarLightboxUrl = avatarUrl;
  }
  if (avatarEl.dataset?.avatarLightboxReady === 'true' || !avatarEl.addEventListener) {
    return;
  }

  const activate = event => {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) {
      return;
    }
    const url = avatarEl.dataset?.avatarLightboxUrl;
    if (!url || !avatarEl.classList?.contains('has-profile-photo')) {
      return;
    }
    event.preventDefault();
    openAvatarLightbox(url, String(window.__supplierData?.name || 'Supplier'), avatarEl);
  };
  avatarEl.addEventListener('click', activate);
  avatarEl.addEventListener('keydown', activate);
  avatarEl.dataset.avatarLightboxReady = 'true';
}

function showAvatarImage(img, initialsEl, avatarUrl) {
  const avatarEl = prepareAvatarShell(img, initialsEl);
  if (avatarEl) {
    avatarEl.classList.add('has-profile-photo');
    avatarEl.dataset.avatarStatus = 'loaded';
    avatarEl.dataset.avatarUrl = avatarUrl;
    enableAvatarLightbox(avatarEl, img, avatarUrl);
  }
  img.classList.remove('sp-polish-safe-hidden');
  img.hidden = false;
  img.style.display = 'block';
  img.style.opacity = '1';
  if (initialsEl) {
    initialsEl.hidden = true;
    initialsEl.style.display = 'none';
  }
}

async function loadPublicSupplierAvatar() {
  const supplierId = getSupplierId();
  const img = document.getElementById('hero-avatar-img');
  const initialsEl = document.getElementById('hero-avatar-initials');
  if (!supplierId || !img || !initialsEl) {
    return;
  }

  const avatarGradient = window.EFSupplierAvatar.getSupplierAvatarGradient(supplierId);
  const requestId = ++activeRequestId;
  if (img.hidden || !img.getAttribute('src')) {
    setPlaceholder(img, initialsEl, null, avatarGradient);
  }

  // In the browser, supplier-profile.js has already resolved the authoritative
  // safe supplier record into window.__supplierData. Reuse it instead of
  // rediscovering the record and probing an endpoint that intentionally hides
  // some directly published unclaimed profiles from directory discovery.
  let supplier = getLoadedSupplier(supplierId);
  // Retain the old network fallback for CommonJS diagnostics/unit tests only;
  // production profile rendering never needs a second supplier lookup.
  if (!supplier && typeof module !== 'undefined' && module.exports) {
    supplier =
      (await fetchSupplierFromSearchRoute(supplierId)) ||
      (await fetchLegacyAvatarEndpoint(supplierId));
  }
  if (!supplier || requestId !== activeRequestId) {
    return;
  }

  const initials = getInitialsFromName(supplier.name || supplier.businessName);
  if (initials) {
    initialsEl.textContent = initials;
  }

  const avatarUrl = getSupplierProfileImage(supplier);
  if (!avatarUrl) {
    setPlaceholder(img, initialsEl, initials, avatarGradient);
    return;
  }

  if (img.getAttribute('src') === avatarUrl && img.hidden === false) {
    showAvatarImage(img, initialsEl, avatarUrl);
    return;
  }

  const avatarEl = prepareAvatarShell(img, initialsEl);
  if (avatarEl) {
    avatarEl.dataset.avatarStatus = 'loading';
    avatarEl.dataset.avatarUrl = avatarUrl;
  }
  img.classList.remove('sp-polish-safe-hidden');
  img.hidden = true;
  img.style.display = 'block';
  img.style.opacity = '0';
  img.alt = `${initialsEl.textContent || 'Supplier'} profile photo`;
  img.onload = () => {
    showAvatarImage(img, initialsEl, avatarUrl);
  };
  img.onerror = () => {
    if (avatarEl) {
      avatarEl.dataset.avatarStatus = 'error';
    }
    setPlaceholder(img, initialsEl, initials, avatarGradient);
  };
  img.src = avatarUrl;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadPublicSupplierAvatar, { once: true });
} else {
  loadPublicSupplierAvatar();
}

document.addEventListener('sp:dataReady', () => {
  loadPublicSupplierAvatar();
});

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('sp:dataReady', () => {
    loadPublicSupplierAvatar();
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    fetchLegacyAvatarEndpoint,
    fetchSupplierFromSearchRoute,
    closeAvatarLightbox,
    enableAvatarLightbox,
    findSupplierInSearchPayload,
    getLoadedSupplier,
    getSupplierProfileImage,
    loadPublicSupplierAvatar,
    openAvatarLightbox,
    setPlaceholder,
    showAvatarImage,
  };
}
