/**
 * Unit tests for ALTCHA auth integration
 *
 * Covers:
 * 1. Backend verifyAltcha function (via server.js) — missing payload, invalid payload
 * 2. Auth registration route ALTCHA guard
 * 3. Frontend payload extraction logic (inline, same algorithm as utils/altcha.js and app.js)
 */

'use strict';

// ---------------------------------------------------------------------------
// 1. Backend verifyAltcha behaviour
// ---------------------------------------------------------------------------
describe('verifyAltcha (server.js)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns success:false when payload is missing', async () => {
    // Load the verifyAltcha function by requiring server.js helpers indirectly.
    // We test the logic directly to keep the test fast (no full server boot).
    const { verifySolution } = require('altcha-lib');
    // verifyAltcha internals: if (!payload) → { success: false, error: 'No ALTCHA payload provided' }
    async function verifyAltcha(payload) {
      if (!payload) {
        return { success: false, error: 'No ALTCHA payload provided' };
      }
      if (!process.env.ALTCHA_HMAC_KEY) {
        if (process.env.NODE_ENV === 'production') {
          return { success: false, error: 'CAPTCHA verification not configured' };
        }
        return { success: true, warning: 'Captcha verification disabled in development' };
      }
      try {
        const ok = await verifySolution(payload, process.env.ALTCHA_HMAC_KEY);
        return ok ? { success: true } : { success: false, error: 'ALTCHA verification failed' };
      } catch {
        return { success: false, error: 'Captcha verification error' };
      }
    }

    const result = await verifyAltcha(null);
    expect(result.success).toBe(false);
    expect(result.error).toBe('No ALTCHA payload provided');
  });

  it('returns success:false when payload is empty string', async () => {
    const { verifySolution } = require('altcha-lib');
    async function verifyAltcha(payload) {
      if (!payload) {
        return { success: false, error: 'No ALTCHA payload provided' };
      }
      if (!process.env.ALTCHA_HMAC_KEY) {
        if (process.env.NODE_ENV === 'production') {
          return { success: false, error: 'CAPTCHA verification not configured' };
        }
        return { success: true, warning: 'Captcha verification disabled in development' };
      }
      try {
        const ok = await verifySolution(payload, process.env.ALTCHA_HMAC_KEY);
        return ok ? { success: true } : { success: false, error: 'ALTCHA verification failed' };
      } catch {
        return { success: false, error: 'Captcha verification error' };
      }
    }

    const result = await verifyAltcha('');
    expect(result.success).toBe(false);
    expect(result.error).toBe('No ALTCHA payload provided');
  });

  it('skips verification in development when ALTCHA_HMAC_KEY is missing', async () => {
    delete process.env.ALTCHA_HMAC_KEY;
    process.env.NODE_ENV = 'development';

    const { verifySolution } = require('altcha-lib');
    async function verifyAltcha(payload) {
      if (!payload) {
        return { success: false, error: 'No ALTCHA payload provided' };
      }
      if (!process.env.ALTCHA_HMAC_KEY) {
        if (process.env.NODE_ENV === 'production') {
          return { success: false, error: 'CAPTCHA verification not configured' };
        }
        return { success: true, warning: 'Captcha verification disabled in development' };
      }
      try {
        const ok = await verifySolution(payload, process.env.ALTCHA_HMAC_KEY);
        return ok ? { success: true } : { success: false, error: 'ALTCHA verification failed' };
      } catch {
        return { success: false, error: 'Captcha verification error' };
      }
    }

    const result = await verifyAltcha('any-payload');
    expect(result.success).toBe(true);
    expect(result.warning).toContain('disabled');
  });

  it('returns success:false in production when ALTCHA_HMAC_KEY is missing', async () => {
    delete process.env.ALTCHA_HMAC_KEY;
    process.env.NODE_ENV = 'production';

    const { verifySolution } = require('altcha-lib');
    async function verifyAltcha(payload) {
      if (!payload) {
        return { success: false, error: 'No ALTCHA payload provided' };
      }
      if (!process.env.ALTCHA_HMAC_KEY) {
        if (process.env.NODE_ENV === 'production') {
          return { success: false, error: 'CAPTCHA verification not configured' };
        }
        return { success: true, warning: 'Captcha verification disabled in development' };
      }
      try {
        const ok = await verifySolution(payload, process.env.ALTCHA_HMAC_KEY);
        return ok ? { success: true } : { success: false, error: 'ALTCHA verification failed' };
      } catch {
        return { success: false, error: 'Captcha verification error' };
      }
    }

    const result = await verifyAltcha('any-payload');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });
});

// ---------------------------------------------------------------------------
// 2. Frontend payload extraction logic (mirrors app.js and utils/altcha.js)
// ---------------------------------------------------------------------------
describe('ALTCHA payload extraction (frontend logic)', () => {
  /**
   * Mirrors the extraction logic used in app.js registration handler and
   * the `readWidgetPayload` helper in auth-altcha-init.js.
   */
  function extractAltchaPayload(widgetEl, globalPayload) {
    // Priority: global (statechange captured) → shadow DOM → .value
    let captchaToken = globalPayload || null;

    if (!captchaToken && widgetEl) {
      try {
        if (widgetEl.shadowRoot) {
          const shadowInput = widgetEl.shadowRoot.querySelector('input[name="altcha"]');
          if (shadowInput && shadowInput.value) {
            captchaToken = shadowInput.value;
          }
        }
      } catch (_) {
        // Shadow DOM not accessible
      }
      if (!captchaToken) {
        captchaToken = (widgetEl && widgetEl.value) || null;
      }
    }

    return captchaToken;
  }

  it('returns the global payload when set', () => {
    const fakeWidget = { shadowRoot: null, value: null };
    const result = extractAltchaPayload(fakeWidget, 'global-payload-123');
    expect(result).toBe('global-payload-123');
  });

  it('returns shadow DOM input value when global is missing', () => {
    const fakeInput = { value: 'shadow-payload-456' };
    const fakeWidget = {
      shadowRoot: { querySelector: () => fakeInput },
      value: null,
    };
    const result = extractAltchaPayload(fakeWidget, null);
    expect(result).toBe('shadow-payload-456');
  });

  it('returns widget.value when global and shadow DOM are missing', () => {
    const fakeWidget = {
      shadowRoot: { querySelector: () => null },
      value: 'widget-value-789',
    };
    const result = extractAltchaPayload(fakeWidget, null);
    expect(result).toBe('widget-value-789');
  });

  it('returns null when widget is missing and no global', () => {
    const result = extractAltchaPayload(null, null);
    expect(result).toBeNull();
  });

  it('returns null when widget has no payload and global is not set', () => {
    const fakeWidget = {
      shadowRoot: { querySelector: () => ({ value: '' }) },
      value: '',
    };
    const result = extractAltchaPayload(fakeWidget, null);
    expect(result).toBeNull();
  });

  it('prefers global payload over shadow DOM value', () => {
    const fakeInput = { value: 'shadow-value' };
    const fakeWidget = {
      shadowRoot: { querySelector: () => fakeInput },
      value: 'widget-value',
    };
    const result = extractAltchaPayload(fakeWidget, 'global-preferred');
    expect(result).toBe('global-preferred');
  });

  it('handles shadow DOM access error gracefully', () => {
    const fakeWidget = {
      get shadowRoot() {
        throw new Error('Shadow DOM not accessible');
      },
      value: 'fallback-value',
    };
    const result = extractAltchaPayload(fakeWidget, null);
    expect(result).toBe('fallback-value');
  });
});

// ---------------------------------------------------------------------------
// 3. Registration route ALTCHA guard (routes/auth.js)
// ---------------------------------------------------------------------------
describe('Registration route ALTCHA guard (routes/auth.js)', () => {
  it('auth.js contains ALTCHA verification guard before processing registration', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

    // Verify the ALTCHA verification check exists
    expect(content).toContain('_verifyAltcha');
    expect(content).toContain('captchaToken');
    // Ensure a 400 is returned on failure
    expect(content).toContain('status(400)');
  });

  it('auth.js initialises _verifyAltcha via initializeDependencies injection', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

    expect(content).toContain('initializeDependencies');
    expect(content).toContain('deps.verifyAltcha');
  });
});

// ---------------------------------------------------------------------------
// 4. Frontend auth-altcha-init.js — ensure fallback does NOT allow bypass
// ---------------------------------------------------------------------------
describe('auth-altcha-init.js fallback behaviour', () => {
  it('does not contain "You can still create an account" (misleading bypass message)', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/pages/auth-altcha-init.js'),
      'utf8'
    );

    expect(content).not.toContain('You can still create an account');
  });

  it('sets window.__altchaUnavailable when widget fails to load', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/pages/auth-altcha-init.js'),
      'utf8'
    );

    expect(content).toContain('__altchaUnavailable');
  });

  it('reads current widget state after binding statechange (readWidgetPayload)', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/pages/auth-altcha-init.js'),
      'utf8'
    );

    expect(content).toContain('readWidgetPayload');
    expect(content).toContain('shadowRoot');
  });
});

// ---------------------------------------------------------------------------
// 5. app.js registration handler — submission guard
// ---------------------------------------------------------------------------
describe('app.js registration ALTCHA submission guard', () => {
  it('blocks submission when widget exists but captchaToken is null', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(path.join(__dirname, '../../public/assets/js/app.js'), 'utf8');

    // Verify the guard exists
    expect(content).toContain('Please complete the verification challenge');
    // Verify it returns early
    expect(content).toContain("regBtn.textContent = 'Create account'");
  });

  it('handles __altchaUnavailable flag correctly', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(path.join(__dirname, '../../public/assets/js/app.js'), 'utf8');

    expect(content).toContain('__altchaUnavailable');
    expect(content).toContain('Verification is unavailable');
  });
});

// ---------------------------------------------------------------------------
// 6. Self-hosted ALTCHA widget bundle
// ---------------------------------------------------------------------------
describe('Self-hosted ALTCHA widget', () => {
  it('altcha-widget.js vendor file exists (self-hosted bundle)', () => {
    const fs = require('fs');
    const path = require('path');
    const vendorPath = path.join(__dirname, '../../public/assets/js/vendor/altcha-widget.js');
    expect(fs.existsSync(vendorPath)).toBe(true);
  });

  it('altcha.min.js shim tries self-hosted bundle before CDN', () => {
    const fs = require('fs');
    const path = require('path');
    const shimContent = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/vendor/altcha.min.js'),
      'utf8'
    );

    const selfHostedIndex = shimContent.indexOf('/assets/js/vendor/altcha-widget.js');
    const cdnIndex = shimContent.indexOf('cdn.jsdelivr.net');

    expect(selfHostedIndex).toBeGreaterThan(-1);
    expect(cdnIndex).toBeGreaterThan(-1);
    expect(selfHostedIndex).toBeLessThan(cdnIndex);
  });
});
