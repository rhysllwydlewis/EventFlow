(function () {
  'use strict';

  if (window.__supplierProfilePreflightLoaded) return;
  window.__supplierProfilePreflightLoaded = true;

  const params = new URLSearchParams(window.location.search);
  const isPreview = params.get('preview') === 'true';
  const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i;

  function safeImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (DATA_IMAGE_RE.test(raw)) return raw;
    try {
      const url = new URL(raw, window.location.origin);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch (_err) {
      return '';
    }
  }

  function safeExternalUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw, window.location.origin);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch (_err) {
      return '';
    }
  }

  function safeTel(value) {
    const raw = String(value || '').trim();
    return /^[+\d][\d\s().-]{5,}$/.test(raw) ? raw : '';
  }

  function appendPreview(urlLike) {
    if (!isPreview || typeof urlLike !== 'string') return urlLike;
    if (!/^\/api\/suppliers\/[^/]+(?:\/packages)?(?:\?|$)/.test(urlLike)) return urlLike;
    try {
      const url = new URL(urlLike, window.location.origin);
      url.searchParams.set('preview', 'true');
      return url.pathname + url.search;
    } catch (_err) {
      return urlLike;
    }
  }

  function sanitiseSupplier(data) {
    if (!data || typeof data !== 'object') return data;
    const supplier = { ...data };
    const banner = safeImageUrl(supplier.bannerUrl || supplier.coverImage);
    const logo = safeImageUrl(supplier.logo || supplier.profileImage);
    supplier.bannerUrl = banner;
    supplier.coverImage = banner;
    supplier.logo = logo;
    supplier.profileImage = logo;
    supplier.openGraphImage = safeImageUrl(supplier.openGraphImage || banner || logo);
    supplier.website = safeExternalUrl(supplier.website);
    supplier.phone = safeTel(supplier.phone);
    supplier.socialLinks = Object.fromEntries(
      Object.entries(supplier.socialLinks || {})
        .map(([key, value]) => [key, safeExternalUrl(value)])
        .filter(([, value]) => value)
    );
    supplier.photosGallery = Array.isArray(supplier.photosGallery)
      ? supplier.photosGallery
          .map(item => safeImageUrl(typeof item === 'string' ? item : item && (item.url || item.src)))
          .filter(Boolean)
      : [];
    supplier.isPreview = isPreview || supplier.isPreview === true;
    return supplier;
  }

  function sanitisePackageData(data) {
    if (!data || typeof data !== 'object') return data;
    const copy = { ...data };
    const items = Array.isArray(copy.items) ? copy.items : Array.isArray(copy.packages) ? copy.packages : null;
    if (items) {
      const clean = items.map(item => ({
        ...item,
        image: safeImageUrl(item.image || item.imageUrl),
        imageUrl: safeImageUrl(item.imageUrl || item.image),
      }));
      if (Array.isArray(copy.items)) copy.items = clean;
      if (Array.isArray(copy.packages)) copy.packages = clean;
    }
    return copy;
  }

  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (originalFetch) {
    window.fetch = async function supplierProfileFetch(input, init) {
      const originalUrl = typeof input === 'string' ? input : input && input.url;
      const patchedUrl = appendPreview(originalUrl);
      const requestInput = typeof input === 'string' ? patchedUrl : input;
      const response = await originalFetch(requestInput, init);
      if (!originalUrl || !/^\/api\/suppliers\/[^/]+/.test(originalUrl)) {
        return response;
      }
      const clone = response.clone();
      return new Proxy(response, {
        get(target, prop) {
          if (prop === 'json') {
            return async () => {
              const data = await clone.json();
              return /\/packages(?:\?|$)/.test(originalUrl)
                ? sanitisePackageData(data)
                : sanitiseSupplier(data);
            };
          }
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
  }

  window.EventFlowSupplierProfileSafety = {
    isPreview,
    safeExternalUrl,
    safeImageUrl,
    safeTel,
  };
})();
