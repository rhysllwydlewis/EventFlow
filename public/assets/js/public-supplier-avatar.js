'use strict';

let activeRequestId = 0;

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
  // Keep this in the same order as the suppliers listing card renderer in
  // public/assets/js/pages/suppliers-init.js. The public profile avatar should
  // show the same image users saw before clicking through from /suppliers.
  const candidates = [
    supplier?.profilePhotoUrl,
    supplier?.displayAvatarUrl,
    supplier?.avatarUrl,
    supplier?.logo,
  ];
  const imageUrl = candidates.find(isUsableSupplierImageUrl);
  return typeof imageUrl === 'string' ? imageUrl.trim() : '';
}

function getInitialsFromName(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  if (words.length === 1) {
    return words[0].charAt(0).toUpperCase();
  }
  return `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`.toUpperCase();
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
  return getSearchResults(payload).find(supplier => String(supplier?.id || '') === String(supplierId));
}

function getSearchUrls() {
  const urls = [];
  const loadedSupplier = typeof window !== 'undefined' ? window.__supplierData : null;
  const supplierName = loadedSupplier && (loadedSupplier.name || loadedSupplier.businessName);
  if (supplierName) {
    const params = new URLSearchParams({ q: String(supplierName), limit: '20' });
    urls.push(`/api/v2/search/suppliers?${params.toString()}`);
  }
  // Fallback to the same browse endpoint used by /suppliers. The exact id check
  // below prevents a wrong supplier image being used if this page has not yet
  // received window.__supplierData.
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
      // Try the next search URL before falling back to initials.
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

  const supplier =
    (await fetchSupplierFromSearchRoute(supplierId)) || (await fetchLegacyAvatarEndpoint(supplierId));
  if (requestId !== activeRequestId) {
    return;
  }

  const initials = getInitialsFromName(supplier?.name || window.__supplierData?.name);
  if (initials) {
    initialsEl.textContent = initials;
  }

  const avatarUrl = getSupplierProfileImage(supplier);
  if (!avatarUrl) {
    setPlaceholder(img, initialsEl, initials);
    return;
  }

  if (img.getAttribute('src') === avatarUrl && img.hidden === false) {
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
    setPlaceholder(img, initialsEl, initials);
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
    findSupplierInSearchPayload,
    getSupplierProfileImage,
    loadPublicSupplierAvatar,
    setPlaceholder,
  };
}
