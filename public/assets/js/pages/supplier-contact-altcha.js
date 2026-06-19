(function () {
  'use strict';

  const FORM_SELECTOR = '#supplier-contact-form';
  const CHALLENGE_URL = '/api/v1/altcha/challenge';
  const ALTCHA_SHIM_URL = '/assets/js/vendor/altcha.min.js';
  const CONTACT_SUPPLIER_PATHS = new Set(['/api/v1/contact-supplier', '/api/contact-supplier']);

  let captchaPayload = null;
  let loadPromise = null;
  let fetchWrapped = false;

  function showInlineMessage(form, message, isError) {
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
  }

  function readWidgetPayload(widget) {
    if (!widget) {
      return null;
    }

    try {
      if (widget.shadowRoot) {
        const shadowInput = widget.shadowRoot.querySelector('input[name="altcha"]');
        if (shadowInput && shadowInput.value) {
          return shadowInput.value;
        }
      }
    } catch (_) {
      // Shadow DOM access can fail in some browser/test environments.
    }

    return widget.value || null;
  }

  function bindWidget(widget) {
    if (!widget || widget.dataset.supplierAltchaBound === 'true') {
      return;
    }

    widget.dataset.supplierAltchaBound = 'true';
    widget.addEventListener('statechange', event => {
      if (event.detail && event.detail.state === 'verified') {
        captchaPayload = event.detail.payload || readWidgetPayload(widget);
        const form = widget.closest(FORM_SELECTOR);
        showInlineMessage(form, 'Verification complete.', false);
      } else {
        captchaPayload = null;
      }
    });

    const existingPayload = readWidgetPayload(widget);
    if (existingPayload) {
      captchaPayload = existingPayload;
    }
  }

  function loadAltchaScript() {
    if (customElements.get('altcha-widget')) {
      return Promise.resolve();
    }

    if (loadPromise) {
      return loadPromise;
    }

    loadPromise = new Promise((resolve, reject) => {
      const onLoaded = () => {
        clearTimeout(timeoutId);
        document.removeEventListener('altcha-loaded', onLoaded);
        resolve();
      };

      document.addEventListener('altcha-loaded', onLoaded, { once: true });

      const existingScript = document.querySelector('script[src*="altcha"]');
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = ALTCHA_SHIM_URL;
        script.defer = true;
        script.onerror = () => {
          clearTimeout(timeoutId);
          document.removeEventListener('altcha-loaded', onLoaded);
          reject(new Error('ALTCHA failed to load'));
        };
        document.head.appendChild(script);
      }

      const poll = setInterval(() => {
        if (customElements.get('altcha-widget')) {
          clearInterval(poll);
          clearTimeout(timeoutId);
          document.removeEventListener('altcha-loaded', onLoaded);
          resolve();
        }
      }, 100);

      const timeoutId = setTimeout(() => {
        clearInterval(poll);
        document.removeEventListener('altcha-loaded', onLoaded);
        reject(new Error('ALTCHA load timeout'));
      }, 10000);
    });

    return loadPromise;
  }

  async function ensureWidget(form) {
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

    try {
      await loadAltchaScript();
      container.innerHTML = '';
      const widget = document.createElement('altcha-widget');
      widget.id = 'supplier-altcha-widget';
      widget.setAttribute('challengeurl', CHALLENGE_URL);
      container.appendChild(widget);
      bindWidget(widget);
    } catch (error) {
      form.dataset.supplierAltchaUnavailable = 'true';
      container.innerHTML =
        '<p class="small" style="color:#b45309;margin:0;">⚠ Verification failed to load. Please refresh the page and try again.</p>';
      if (typeof console !== 'undefined') {
        console.warn('[supplier-contact-altcha] Verification failed to load', error);
      }
    }
  }

  function getSupplierCaptchaToken() {
    const widget = document.getElementById('supplier-altcha-widget');
    return captchaPayload || readWidgetPayload(widget);
  }

  function isContactSupplierRequest(input, init) {
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method !== 'POST') {
      return false;
    }

    const rawUrl = typeof input === 'string' ? input : input && input.url;
    if (!rawUrl) {
      return false;
    }

    try {
      const parsed = new URL(rawUrl, window.location.origin);
      return CONTACT_SUPPLIER_PATHS.has(parsed.pathname);
    } catch (_) {
      return false;
    }
  }

  function makeBlockedResponse(message) {
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function wrapFetch() {
    if (fetchWrapped || !window.fetch) {
      return;
    }

    fetchWrapped = true;
    const realFetch = window.fetch.bind(window);

    window.fetch = function supplierAltchaFetch(input, init) {
      if (!isContactSupplierRequest(input, init || {})) {
        return realFetch(input, init);
      }

      const form = document.querySelector(FORM_SELECTOR);
      const token = getSupplierCaptchaToken();

      if (!token) {
        const message = 'Please complete the verification challenge before sending your message.';
        showInlineMessage(form, message, true);
        return Promise.resolve(makeBlockedResponse(message));
      }

      const nextInit = { ...(init || {}) };
      let body = nextInit.body;

      try {
        const parsedBody = body && typeof body === 'string' ? JSON.parse(body) : body || {};
        if (parsedBody && typeof parsedBody === 'object' && !(parsedBody instanceof FormData)) {
          parsedBody.captchaToken = token;
          body = JSON.stringify(parsedBody);
        }
      } catch (_) {
        // If the body is not JSON, let the server reject it rather than hiding the error.
      }

      nextInit.body = body;
      return realFetch(input, nextInit);
    };
  }

  function scanForSupplierForm() {
    const form = document.querySelector(FORM_SELECTOR);
    if (form) {
      ensureWidget(form);
    }
  }

  function start() {
    wrapFetch();
    scanForSupplierForm();

    const observer = new MutationObserver(scanForSupplierForm);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
