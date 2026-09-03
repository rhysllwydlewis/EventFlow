/**
 * hCaptcha Integration Utility
 * Provides CAPTCHA verification for forms to prevent bot spam
 */

/**
 * Load hCaptcha script
 * @returns {Promise<void>}
 */
export function loadHCaptchaScript() {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.hcaptcha) {
      resolve();
      return;
    }

    // Check if script tag already exists
    if (document.querySelector('script[src*="hcaptcha.com"]')) {
      // Wait for it to load
      const checkInterval = setInterval(() => {
        if (window.hcaptcha) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('hCaptcha script load timeout'));
      }, 10000);
      return;
    }

    // Load script
    const script = document.createElement('script');
    script.src = 'https://js.hcaptcha.com/1/api.js';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load hCaptcha script'));
    document.head.appendChild(script);
  });
}

/**
 * Render hCaptcha widget
 * @param {string|HTMLElement} container - Container element or selector
 * @param {object} options - hCaptcha options
 * @returns {Promise<string>} Widget ID
 */
export async function renderHCaptcha(container, options = {}) {
  const {
    sitekey = '', // Should be set via environment/config
    theme = 'light',
    size = 'normal',
    callback = null,
    expiredCallback = null,
    errorCallback = null,
  } = options;

  // Ensure script is loaded
  await loadHCaptchaScript();

  // Get container element
  const element = typeof container === 'string' ? document.querySelector(container) : container;

  if (!element) {
    throw new Error('hCaptcha container not found');
  }

  // Check if sitekey is configured
  if (!sitekey) {
    // In production, sitekey must be provided
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') {
      throw new Error('hCaptcha sitekey not configured for production');
    }
    console.warn('hCaptcha sitekey not configured. Using test key for development only.');
  }

  // Render widget
  const widgetId = window.hcaptcha.render(element, {
    sitekey: sitekey || '10000000-ffff-ffff-ffff-000000000001', // Test key for development only
    theme,
    size,
    callback,
    'expired-callback': expiredCallback,
    'error-callback': errorCallback,
  });

  return widgetId;
}

/**
 * Get hCaptcha response token
 * @param {string} widgetId - Widget ID returned from render
 * @returns {string|null} Response token or null if not solved
 */
export function getHCaptchaResponse(widgetId) {
  if (!window.hcaptcha) {
    console.error('hCaptcha not loaded');
    return null;
  }

  return window.hcaptcha.getResponse(widgetId);
}

/**
 * Reset hCaptcha widget
 * @param {string} widgetId - Widget ID to reset
 */
export function resetHCaptcha(widgetId) {
  if (!window.hcaptcha) {
    console.error('hCaptcha not loaded');
    return;
  }

  window.hcaptcha.reset(widgetId);
}

/**
 * Verify hCaptcha response server-side
 * @param {string} token - hCaptcha response token
 * @returns {Promise<object>} Verification result
 */
export async function verifyHCaptcha(token) {
  try {
    const response = await fetch('/api/v1/verify-captcha', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      throw new Error('Captcha verification failed');
    }

    return await response.json();
  } catch (error) {
    console.error('Error verifying captcha:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Add hCaptcha to a form
 * @param {string|HTMLElement} form - Form element or selector
 * @param {object} options - Configuration options
 * @returns {Promise<object>} Widget info and helper functions
 */
export async function addHCaptchaToForm(form, options = {}) {
  const {
    containerSelector = '.hcaptcha-container',
    onSuccess = null,
    onError = null,
    onExpired = null,
  } = options;

  // Get form element
  const formElement = typeof form === 'string' ? document.querySelector(form) : form;

  if (!formElement) {
    throw new Error('Form element not found');
  }

  // Find or create container
  let container = formElement.querySelector(containerSelector);
  if (!container) {
    container = document.createElement('div');
    container.className = 'hcaptcha-container';
    container.style.marginBottom = '1rem';

    // Insert before submit button if exists
    const submitBtn = formElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.parentNode.insertBefore(container, submitBtn);
    } else {
      formElement.appendChild(container);
    }
  }

  // Render captcha
  const widgetId = await renderHCaptcha(container, {
    ...options,
    callback: token => {
      if (onSuccess) {
        onSuccess(token);
      }
    },
    expiredCallback: () => {
      if (onExpired) {
        onExpired();
      }
    },
    errorCallback: error => {
      if (onError) {
        onError(error);
      }
    },
  });

  // Add form submit handler
  const originalSubmit = formElement.onsubmit;
  formElement.onsubmit = event => {
    event.preventDefault();

    // Get captcha response
    const token = getHCaptchaResponse(widgetId);

    if (!token) {
      alert('Please complete the CAPTCHA verification');
      return false;
    }

    // Call original submit handler if exists
    if (originalSubmit) {
      return originalSubmit.call(formElement, event, token);
    }

    return true;
  };

  return {
    widgetId,
    getResponse: () => getHCaptchaResponse(widgetId),
    reset: () => resetHCaptcha(widgetId),
    container,
  };
}

/**
 * Get hCaptcha configuration from meta tags or config
 * @returns {object} Configuration object
 */
export function getHCaptchaConfig() {
  // Try to get from meta tag
  const metaTag = document.querySelector('meta[name="hcaptcha-sitekey"]');
  if (metaTag) {
    return {
      sitekey: metaTag.getAttribute('content'),
    };
  }

  // Try to get from global config
  if (window.EVENTFLOW_CONFIG && window.EVENTFLOW_CONFIG.hcaptchaSitekey) {
    return {
      sitekey: window.EVENTFLOW_CONFIG.hcaptchaSitekey,
    };
  }

  // Development fallback
  console.warn('hCaptcha sitekey not configured. CAPTCHA disabled for development.');
  return {
    sitekey: '', // Empty in development if not configured
  };
}

export default {
  loadHCaptchaScript,
  renderHCaptcha,
  getHCaptchaResponse,
  resetHCaptcha,
  verifyHCaptcha,
  addHCaptchaToForm,
  getHCaptchaConfig,
};
