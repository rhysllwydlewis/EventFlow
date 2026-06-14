'use strict';

let activeRequestId = 0;

function getSupplierId() {
  return new URLSearchParams(window.location.search).get('id') || '';
}

function setPlaceholder(img, initialsEl, initials) {
  if (img) {
    img.removeAttribute('src');
    img.hidden = true;
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

async function loadPublicSupplierAvatar() {
  const supplierId = getSupplierId();
  const img = document.getElementById('hero-avatar-img');
  const initialsEl = document.getElementById('hero-avatar-initials');
  if (!supplierId || !img || !initialsEl) {
    return;
  }

  const requestId = ++activeRequestId;
  if (img.hidden || !img.getAttribute('src')) {
    setPlaceholder(img, initialsEl);
  }
  let payload;
  try {
    const response = await fetch(`/api/public/suppliers/${encodeURIComponent(supplierId)}/avatar`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      return;
    }
    payload = await response.json();
  } catch (_error) {
    return;
  }

  if (requestId !== activeRequestId) {
    return;
  }

  if (payload && payload.initials) {
    initialsEl.textContent = payload.initials;
  }
  if (!payload || !payload.hasPhoto || !payload.avatarUrl) {
    setPlaceholder(img, initialsEl, payload && payload.initials);
    return;
  }

  if (img.getAttribute('src') === payload.avatarUrl && img.hidden === false) {
    initialsEl.style.display = 'none';
    return;
  }

  img.hidden = true;
  img.alt = `${initialsEl.textContent || 'Supplier'} profile photo`;
  img.onload = () => {
    img.hidden = false;
    img.style.display = '';
    initialsEl.style.display = 'none';
  };
  img.onerror = () => {
    setPlaceholder(img, initialsEl, payload.initials);
  };
  img.src = payload.avatarUrl;
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
  module.exports = { loadPublicSupplierAvatar, setPlaceholder };
}
