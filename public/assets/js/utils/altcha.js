/**
 * ALTCHA Integration Utility
 * Provides proof-of-work CAPTCHA verification for forms using the ALTCHA web component.
 * ALTCHA is a privacy-focused, self-hosted alternative that requires no third-party tracking.
 */

const ALTCHA_CDN_URL =
  'https://cdn.jsdelivr.net/npm/@altcha-org/altcha/dist/altcha.min.js';

/**
 * Load ALTCHA script from CDN
 * @returns {Promise<void>}
 */
export function loadAltchaScript() {
  return new Promise((resolve, reject) => {
    // Check if already loaded (custom elements define altcha-widget)
    if (customElements.get('altcha-widget')) {
      resolve();
      return;
    }

    // Check if script tag already exists
    if (document.querySelector(`script[src*="altcha"]`)) {
      const checkInterval = setInterval(() => {
        if (customElements.get('altcha-widget')) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('ALTCHA script load timeout'));
      }, 10000);
      return;
    }

    const script = document.createElement('script');
    script.src = ALTCHA_CDN_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load ALTCHA script'));
    document.head.appendChild(script);
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
 * The payload is stored in a hidden input named "altcha" inside the form
 * @param {HTMLElement|string} widgetOrForm - The altcha-widget element or the form containing it
 * @returns {string|null} Base64-encoded payload or null if not yet solved
 */
export function getAltchaPayload(widgetOrForm) {
  const el =
    typeof widgetOrForm === 'string' ? document.querySelector(widgetOrForm) : widgetOrForm;

  if (!el) {
    return null;
  }

  // If it's the widget itself, look for the hidden input sibling or inside
  const input = el.querySelector
    ? el.querySelector('input[name="altcha"]')
    : null;

  if (input) {
    return input.value || null;
  }

  // If it's a form element, look for the hidden input inside the form
  if (el.tagName === 'FORM' || el.elements) {
    const formInput = el.querySelector('input[name="altcha"]');
    return formInput ? formInput.value || null : null;
  }

  // Try the value property on the widget (some versions expose it directly)
  return el.value || null;
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
