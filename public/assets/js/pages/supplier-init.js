(function () {
  try {
    const params = new URLSearchParams(window.location.search);
    const supplierId = params.get('id');
    const isPreview = params.get('preview') === 'true';
    const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i;
    const CONTACT_SUPPLIER_PATHS = new Set(['/api/v1/contact-supplier', '/api/contact-supplier']);
    const ALTCHA_SCRIPT_SRC = '/assets/js/vendor/altcha.min.js';
    const ALTCHA_CHALLENGE_URL = '/api/v1/altcha/challenge';
    let supplierContactCaptchaPayload = null;
    let supplierAltchaLoadPromise = null;

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

    const showSupplierCaptchaMessage = (form, message, isError) => {
      if (!form) {
        return;
      }
      let status = form.querySelector('#supplier-altcha-status');
      if (!status) {
        status = document.createElement('p');
        status.id = 'supplier-altcha-status';
        status.className = 'small';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const actions = form.querySelector('.form-actions');
        if (actions && actions.parentNode) {
          actions.parentNode.insertBefore(status, actions);
        } else {
          form.appendChild(status);
        }
      }
      status.textContent = message || '';
      status.style.color = isError ? '#dc2626' : '#0B8073';
    };

    const readSupplierAltchaPayload = widget => {
      if (!widget) {
        return null;
      }
      try {
        const shadowInput = widget.shadowRoot && widget.shadowRoot.querySelector('input[name="altcha"]');
        if (shadowInput && shadowInput.value) {
          return shadowInput.value;
        }
      } catch (_err) {
        // Shadow DOM access is best-effort only.
      }
      return widget.value || null;
    };

    const loadSupplierAltcha = () => {
      if (window.customElements && customElements.get('altcha-widget')) {
        return Promise.resolve();
      }
      if (supplierAltchaLoadPromise) {
        return supplierAltchaLoadPromise;
      }
      supplierAltchaLoadPromise = new Promise((resolve, reject) => {
        let timeoutId;
        const done = () => {
          clearTimeout(timeoutId);
          resolve();
        };
        if (!document.querySelector(`script[src*="${ALTCHA_SCRIPT_SRC}"]`)) {
          const script = document.createElement('script');
          script.src = ALTCHA_SCRIPT_SRC;
          script.defer = true;
          script.onerror = () => {
            clearTimeout(timeoutId);
            reject(new Error('ALTCHA failed to load'));
          };
          document.head.appendChild(script);
        }
        const poll = setInterval(() => {
          if (window.customElements && customElements.get('altcha-widget')) {
            clearInterval(poll);
            done();
          }
        }, 100);
        timeoutId = setTimeout(() => {
          clearInterval(poll);
          reject(new Error('ALTCHA load timeout'));
        }, 10000);
      });
      return supplierAltchaLoadPromise;
    };

    const ensureSupplierContactCaptcha = form => {
      if (!form || form.dataset.supplierAltchaReady === 'true') {
        return;
      }
      form.dataset.supplierAltchaReady = 'true';
      const container = document.createElement('div');
      container.id = 'supplier-altcha-container';
      container.className = 'altcha-container';
      container.style.margin = '0 0 16px 0';
      container.innerHTML = '<p class="small" style="color:#666;margin:0;">Loading verification…</p>';
      const actions = form.querySelector('.form-actions');
      if (actions && actions.parentNode) {
        actions.parentNode.insertBefore(container, actions);
      } else {
        form.appendChild(container);
      }

      loadSupplierAltcha()
        .then(() => {
          container.innerHTML = '';
          const widget = document.createElement('altcha-widget');
          widget.id = 'supplier-altcha-widget';
          widget.setAttribute('challengeurl', ALTCHA_CHALLENGE_URL);
          widget.addEventListener('statechange', event => {
            if (event.detail && event.detail.state === 'verified') {
              supplierContactCaptchaPayload = event.detail.payload || readSupplierAltchaPayload(widget);
              showSupplierCaptchaMessage(form, 'Verification complete.', false);
            } else {
              supplierContactCaptchaPayload = null;
            }
          });
          container.appendChild(widget);
        })
        .catch(() => {
          form.dataset.supplierAltchaUnavailable = 'true';
          container.innerHTML =
            '<p class="small" style="color:#b45309;margin:0;">Verification failed to load. Please refresh the page and try again.</p>';
        });
    };

    const supplierCaptchaToken = () =>
      supplierContactCaptchaPayload || readSupplierAltchaPayload(document.getElementById('supplier-altcha-widget'));

    const blockedSupplierCaptchaResponse = message =>
      new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });

    if (!window.__supplierProfileFetchPreflight && window.fetch) {
      window.__supplierProfileFetchPreflight = true;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async function supplierProfileFetch(input, init) {
        const originalUrl = typeof input === 'string' ? input : input && input.url;
        const patchedUrl = appendPreview(originalUrl);
        const path = supplierApiPath(originalUrl);
        let requestInput = input;
        let requestInit = init;

        if (typeof input === 'string') {
          requestInput = patchedUrl;
        } else if (patchedUrl !== originalUrl && typeof Request !== 'undefined') {
          requestInput = new Request(new URL(patchedUrl, window.location.origin).href, input);
        }

        if (CONTACT_SUPPLIER_PATHS.has(path)) {
          const token = supplierCaptchaToken();
          const form = document.querySelector('#supplier-contact-form');
          if (!token) {
            const message = 'Please complete the verification challenge before sending your message.';
            showSupplierCaptchaMessage(form, message, true);
            return blockedSupplierCaptchaResponse(message);
          }
          requestInit = { ...(init || {}) };
          try {
            const body = requestInit.body && typeof requestInit.body === 'string' ? JSON.parse(requestInit.body) : null;
            if (body && typeof body === 'object') {
              body.captchaToken = token;
              requestInit.body = JSON.stringify(body);
            }
          } catch (_err) {
            // Leave malformed bodies untouched so the server can reject them consistently.
          }
        }

        const response = await originalFetch(requestInput, requestInit);
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

    const scanSupplierContactForm = () => {
      const form = document.querySelector('#supplier-contact-form');
      if (form) {
        ensureSupplierContactCaptcha(form);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loadProfilePolish);
      document.addEventListener('DOMContentLoaded', scanSupplierContactForm);
    } else {
      loadProfilePolish();
      scanSupplierContactForm();
    }

    if (window.MutationObserver) {
      const observer = new MutationObserver(scanSupplierContactForm);
      observer.observe(document.documentElement, { childList: true, subtree: true });
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
