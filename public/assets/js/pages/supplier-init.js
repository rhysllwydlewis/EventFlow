(function () {
  try {
    const params = new URLSearchParams(window.location.search);
    const supplierId = params.get('id');
    const isPreview = params.get('preview') === 'true';
    const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i;

    const safeImageUrl = value => {
      const raw = String(value || '').trim();
      if (!raw) {
        return '';
      }
      if (DATA_IMAGE_RE.test(raw)) {
        return raw;
      }
      try {
        const url = new URL(raw, window.location.origin);
        return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
      } catch (_err) {
        return '';
      }
    };

    const safeExternalUrl = value => {
      const raw = String(value || '').trim();
      if (!/^https?:\/\//i.test(raw)) {
        return '';
      }
      try {
        const url = new URL(raw);
        return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
      } catch (_err) {
        return '';
      }
    };

    const safeTel = value => {
      const raw = String(value || '').trim();
      return /^[+\d][\d\s().-]{5,}$/.test(raw) ? raw : '';
    };

    const supplierApiPath = urlLike => {
      if (typeof urlLike !== 'string') {
        return '';
      }
      try {
        const url = new URL(urlLike, window.location.origin);
        return url.origin === window.location.origin ? url.pathname : '';
      } catch (_err) {
        return '';
      }
    };

    const appendPreview = urlLike => {
      const path = supplierApiPath(urlLike);
      if (!isPreview || !/^\/api\/suppliers\/[^/]+(?:\/packages)?$/.test(path)) {
        return urlLike;
      }
      try {
        const url = new URL(urlLike, window.location.origin);
        url.searchParams.set('preview', 'true');
        return /^https?:\/\//i.test(urlLike) ? url.href : `${url.pathname}${url.search}${url.hash}`;
      } catch (_err) {
        return urlLike;
      }
    };

    const sanitiseSupplier = data => {
      if (!data || typeof data !== 'object') {
        return data;
      }
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
            .map(item =>
              safeImageUrl(typeof item === 'string' ? item : item && (item.url || item.src))
            )
            .filter(Boolean)
        : [];
      supplier.isPreview = isPreview || supplier.isPreview === true;
      return supplier;
    };

    const sanitisePackageData = data => {
      if (!data || typeof data !== 'object') {
        return data;
      }
      const copy = { ...data };
      const items = Array.isArray(copy.items)
        ? copy.items
        : Array.isArray(copy.packages)
          ? copy.packages
          : null;
      if (items) {
        const clean = items
          .filter(item => item && typeof item === 'object')
          .map(item => ({
            ...item,
            image: safeImageUrl(item.image || item.imageUrl),
            imageUrl: safeImageUrl(item.imageUrl || item.image),
          }));
        if (Array.isArray(copy.items)) {
          copy.items = clean;
        }
        if (Array.isArray(copy.packages)) {
          copy.packages = clean;
        }
      }
      return copy;
    };

    if (!window.__supplierProfileFetchPreflight && window.fetch) {
      window.__supplierProfileFetchPreflight = true;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async function supplierProfileFetch(input, init) {
        const originalUrl = typeof input === 'string' ? input : input && input.url;
        const patchedUrl = appendPreview(originalUrl);
        let requestInput = input;
        if (typeof input === 'string') {
          requestInput = patchedUrl;
        } else if (patchedUrl !== originalUrl && typeof Request !== 'undefined') {
          requestInput = new Request(new URL(patchedUrl, window.location.origin).href, input);
        }

        const response = await originalFetch(requestInput, init);
        const path = supplierApiPath(originalUrl);
        if (!path.startsWith('/api/suppliers/')) {
          return response;
        }
        const clone = response.clone();
        return new Proxy(response, {
          get(target, prop) {
            if (prop === 'json') {
              return async () => {
                const data = await clone.json();
                return path.endsWith('/packages')
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

    const loadProfilePolish = () => {
      if (document.getElementById('supplier-profile-public-polish-script')) {
        return;
      }
      const script = document.createElement('script');
      script.id = 'supplier-profile-public-polish-script';
      script.src = '/assets/js/pages/supplier-profile-public-polish.js?v=1.0.0';
      script.defer = true;
      document.body.appendChild(script);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loadProfilePolish);
    } else {
      loadProfilePolish();
    }

    if (supplierId && !isPreview) {
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'profile_view', supplierId: supplierId }),
      }).catch(() => {});
    }
  } catch (e) {
    /* ignore */
  }
})();
