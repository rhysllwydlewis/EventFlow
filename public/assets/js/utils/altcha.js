/**
 * ALTCHA Integration Utility
 * Provides proof-of-work CAPTCHA verification for forms using the ALTCHA web component.
 * ALTCHA is a privacy-focused, self-hosted alternative that requires no third-party tracking.
 */

const ALTCHA_CDN_URL = '/assets/js/vendor/altcha.min.js';
const ALTCHA_FALLBACK_URLS = [
  'https://cdn.jsdelivr.net/npm/altcha@2/dist/altcha.min.js',
  'https://unpkg.com/altcha@2/dist/altcha.min.js',
];

/**
 * Load ALTCHA script, waiting for the custom element to be defined.
 * The vendor shim (altcha.min.js) dispatches an `altcha-loaded` event on
 * document when the widget is ready. We listen for that event as the primary
 * signal, with an interval-based fallback for environments where the event
 * is not fired (e.g. the element was already registered before this call).
 * @returns {Promise<void>}
 */
export function loadAltchaScript() {
  return new Promise((resolve, reject) => {
    // Check if already loaded (custom elements define altcha-widget)
    if (customElements.get('altcha-widget')) {
      resolve();
      return;
    }

    // Listen for the altcha-loaded event dispatched by the vendor shim
    const onLoaded = () => {
      clearInterval(checkInterval);
      clearTimeout(timeoutId);
      resolve();
    };
    document.addEventListener('altcha-loaded', onLoaded, { once: true });

    // Also poll in case the shim loaded the element before this listener was attached
    const checkInterval = setInterval(() => {
      if (customElements.get('altcha-widget')) {
        clearInterval(checkInterval);
        clearTimeout(timeoutId);
        document.removeEventListener('altcha-loaded', onLoaded);
        resolve();
      }
    }, 100);

    // Check if script tag already exists; if not, inject the shim
    if (!document.querySelector(`script[src*="altcha"]`)) {
      const script = document.createElement('script');
      script.src = ALTCHA_CDN_URL;
      script.async = true;
      script.onerror = () => {
        // Shim failed to load; attempt direct CDN sources sequentially as last resort
        console.warn(
          '[ALTCHA] Failed to load shim from',
          ALTCHA_CDN_URL,
          ', trying CDN fallbacks…'
        );
        let fallbackIndex = 0;
        function tryFallback() {
          if (fallbackIndex >= ALTCHA_FALLBACK_URLS.length) {
            return;
          }
          const url = ALTCHA_FALLBACK_URLS[fallbackIndex++];
          const fallback = document.createElement('script');
          fallback.src = url;
          fallback.type = 'module';
          fallback.onerror = () => {
            console.warn('[ALTCHA] Fallback failed:', url);
            tryFallback();
          };
          document.head.appendChild(fallback);
        }
        tryFallback();
      };
      document.head.appendChild(script);
    }

    const timeoutId = setTimeout(() => {
      clearInterval(checkInterval);
      document.removeEventListener('altcha-loaded', onLoaded);
      reject(new Error('ALTCHA script load timeout'));
    }, 10000);
  });
}

/**
 * Render an ALTCHA widget inside a container element
 * @param {string|HTMLElement} container - Container element or selector
 * @param {object} options - Widget options
 * @param {string} [options.challengeUrl='/api/v1/altcha/challenge'] - URL for challenge endpoint
 * @returns {Promise<HTMLElement>} The created altcha-widget element
 */
export async function renderAltchaWidget(container, options = {}) {
  const { challengeUrl = '/api/v1/altcha/challenge' } = options;

  await loadAltchaScript();

  const element = typeof container === 'string' ? document.querySelector(container) : container;

  if (!element) {
    throw new Error('ALTCHA container not found');
  }

  const widget = document.createElement('altcha-widget');
  widget.setAttribute('challengeurl', challengeUrl);
  element.appendChild(widget);

  return widget;
}

/**
 * Get the ALTCHA payload from a widget element
 * The hidden input lives inside the widget's Shadow DOM, so we must use
 * shadowRoot.querySelector() rather than a light-DOM querySelector().
 * @param {HTMLElement|string} widgetOrForm - The altcha-widget element or the form containing it
 * @returns {string|null} Base64-encoded payload or null if not yet solved
 */
export function getAltchaPayload(widgetOrForm) {
  const el = typeof widgetOrForm === 'string' ? document.querySelector(widgetOrForm) : widgetOrForm;

  if (!el) {
    return null;
  }

  // If a form (or container) was passed, look for a nested altcha-widget first
  const widget =
    el.tagName && el.tagName.toLowerCase() === 'altcha-widget'
      ? el
      : (el.querySelector ? el.querySelector('altcha-widget') : null) || el;

  // 1. Try shadow DOM — the hidden input lives inside the widget's shadow root
  try {
    if (widget.shadowRoot) {
      const shadowInput = widget.shadowRoot.querySelector('input[name="altcha"]');
      if (shadowInput && shadowInput.value) {
        return shadowInput.value;
      }
    }
  } catch (_) {
    // Shadow DOM not accessible in this environment
  }

  // 2. Try light DOM (in case the widget injects the input into light DOM)
  if (widget.querySelector) {
    const input = widget.querySelector('input[name="altcha"]');
    if (input && input.value) {
      return input.value;
    }
  }

  // 3. Try form-level search (walk all altcha-widget elements inside a form)
  if (el.querySelectorAll) {
    const widgets = el.querySelectorAll('altcha-widget');
    for (const w of widgets) {
      try {
        if (w.shadowRoot) {
          const shadowInput = w.shadowRoot.querySelector('input[name="altcha"]');
          if (shadowInput && shadowInput.value) {
            return shadowInput.value;
          }
        }
      } catch (_) {
        // Ignore
      }
      if (w.value) {
        return w.value;
      }
    }
  }

  // 4. Try the value property on the widget (ALTCHA v2 exposes this directly)
  return widget.value || null;
}

/**
 * Verify ALTCHA payload server-side via the verify-captcha API endpoint
 * @param {string} payload - ALTCHA base64 payload
 * @returns {Promise<object>} Verification result
 */
export async function verifyAltcha(payload) {
  try {
    const response = await fetch('/api/v1/verify-captcha', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ token: payload }),
    });

    if (!response.ok) {
      throw new Error('Captcha verification failed');
    }

    return await response.json();
  } catch (error) {
    console.error('Error verifying ALTCHA payload:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Add an ALTCHA widget to a form
 * @param {string|HTMLElement} form - Form element or selector
 * @param {object} options - Configuration options
 * @param {string} [options.challengeUrl='/api/v1/altcha/challenge'] - Challenge endpoint URL
 * @returns {Promise<object>} Widget info and helper functions
 */
export async function addAltchaToForm(form, options = {}) {
  const { challengeUrl = '/api/v1/altcha/challenge' } = options;

  const formElement = typeof form === 'string' ? document.querySelector(form) : form;

  if (!formElement) {
    throw new Error('Form element not found');
  }

  // Create a container div and insert before the submit button
  const container = document.createElement('div');
  container.className = 'altcha-container';
  container.style.marginBottom = '1rem';

  const submitBtn = formElement.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.parentNode.insertBefore(container, submitBtn);
  } else {
    formElement.appendChild(container);
  }

  const widget = await renderAltchaWidget(container, { challengeUrl });

  return {
    widget,
    getPayload: () => getAltchaPayload(formElement),
    container,
  };
}

/**
 * Get ALTCHA configuration from global config
 * @returns {object} Configuration object with challengeUrl
 */
export function getAltchaConfig() {
  if (window.EVENTFLOW_CONFIG && window.EVENTFLOW_CONFIG.altchaChallengeUrl) {
    return {
      challengeUrl: window.EVENTFLOW_CONFIG.altchaChallengeUrl,
    };
  }

  return {
    challengeUrl: '/api/v1/altcha/challenge',
  };
}

export default {
  loadAltchaScript,
  renderAltchaWidget,
  getAltchaPayload,
  verifyAltcha,
  addAltchaToForm,
  getAltchaConfig,
};
