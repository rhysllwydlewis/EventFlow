/**
 * Cookie Consent Banner - UK GDPR/PECR Compliant
 * Version: 2.0.0
 *
 * Category-based consent model:
 *   - essential:   always on (authentication, consent record)
 *   - functional:  theme/UI preferences stored in localStorage
 *   - analytics:   analytics/tracking (currently unused, off by default)
 *
 * Backward compatible: old cookie values "accepted"/"rejected" are migrated
 * automatically to the new structured format on first load.
 *
 * Public API on window.CookieConsent:
 *   getConsent()        → { essential, functional, analytics }
 *   hasConsent()        → boolean (any decision recorded)
 *   openPreferences()   → open preferences dialog (always works)
 *   revokeConsent()     → clear consent and reopen banner
 *   reset()             → alias for revokeConsent()
 *   show()              → show banner if no consent recorded
 *   init()              → initialise (called automatically)
 *
 * Optional localStorage keys cleared when functional consent is denied:
 *   theme, ef_expanded_folders, marketplaceLocation,
 *   jadeassist-teaser-dismissed, ef_onboarding_dismissed,
 *   ef_supplier_welcome_dismissed, eventflow_onboarding_new,
 *   ef_notification_sound_enabled, ef_notification_volume,
 *   ef_tour_completed, ef_signup_popup_dismissed
 */

'use strict';
(function () {
  // ─── Constants ────────────────────────────────────────────────────────────

  const CONSENT_COOKIE_NAME = 'eventflow_cookie_consent';
  const CONSENT_EXPIRY_DAYS = 365;
  const CONSENT_VERSION = 1;

  // localStorage keys that are "functional" (optional) and must be cleared on rejection
  const FUNCTIONAL_STORAGE_KEYS = [
    'theme',
    'ef_expanded_folders',
    'marketplaceLocation',
    'jadeassist-teaser-dismissed',
    'ef_onboarding_dismissed',
    'ef_supplier_welcome_dismissed',
    'eventflow_onboarding_new',
    'ef_notification_sound_enabled',
    'ef_notification_volume',
    'ef_tour_completed',
    'ef_signup_popup_dismissed',
  ];

  // ─── Cookie helpers ────────────────────────────────────────────────────────

  function getCookieRaw(name) {
    try {
      if (!name || typeof document === 'undefined' || !document.cookie) {
        return null;
      }
      const nameEQ = `${name}=`;
      const cookies = document.cookie.split(';');
      for (let i = 0; i < cookies.length; i++) {
        const c = cookies[i] ? cookies[i].trim() : '';
        if (c && c.indexOf(nameEQ) === 0) {
          return c.substring(nameEQ.length);
        }
      }
      return null;
    } catch (e) {
      console.warn('CookieConsent: error reading cookie', e);
      return null;
    }
  }

  function setCookieRaw(name, value, days) {
    try {
      if (!name || typeof document === 'undefined') {
        return;
      }
      let expires = '';
      if (days) {
        const d = new Date();
        d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
        expires = `; expires=${d.toUTCString()}`;
      }
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${name}=${value || ''}${expires}; path=/; SameSite=Lax${secure}`;
    } catch (e) {
      console.warn('CookieConsent: error setting cookie', e);
    }
  }

  function deleteCookieRaw(name) {
    setCookieRaw(name, '', -1);
  }

  // ─── Consent state helpers ─────────────────────────────────────────────────

  function defaultPrefs() {
    return { essential: true, functional: false, analytics: false };
  }

  /**
   * Parse the consent cookie; migrate legacy "accepted"/"rejected" values.
   * Returns null if no cookie exists yet.
   */
  function readConsentCookie() {
    const raw = getCookieRaw(CONSENT_COOKIE_NAME);
    if (raw === null) {
      return null;
    }

    // Migrate legacy binary values
    if (raw === 'accepted') {
      const migrated = { v: CONSENT_VERSION, essential: true, functional: true, analytics: false };
      setCookieRaw(CONSENT_COOKIE_NAME, JSON.stringify(migrated), CONSENT_EXPIRY_DAYS);
      return migrated;
    }
    if (raw === 'rejected') {
      const migrated = { v: CONSENT_VERSION, essential: true, functional: false, analytics: false };
      setCookieRaw(CONSENT_COOKIE_NAME, JSON.stringify(migrated), CONSENT_EXPIRY_DAYS);
      return migrated;
    }

    // Parse JSON
    try {
      const parsed = JSON.parse(decodeURIComponent(raw));
      return {
        v: parsed.v || CONSENT_VERSION,
        essential: true,
        functional: !!parsed.functional,
        analytics: !!parsed.analytics,
      };
    } catch (e) {
      return null;
    }
  }

  function writeConsentCookie(prefs) {
    const value = JSON.stringify({
      v: CONSENT_VERSION,
      essential: true,
      functional: !!prefs.functional,
      analytics: !!prefs.analytics,
    });
    setCookieRaw(CONSENT_COOKIE_NAME, encodeURIComponent(value), CONSENT_EXPIRY_DAYS);
  }

  function clearOptionalStorage() {
    try {
      for (let i = 0; i < FUNCTIONAL_STORAGE_KEYS.length; i++) {
        localStorage.removeItem(FUNCTIONAL_STORAGE_KEYS[i]);
      }
    } catch (e) {
      // localStorage may be unavailable in some contexts
    }
  }

  function dispatchConsentEvent(prefs) {
    try {
      if (typeof window.CustomEvent === 'function') {
        window.dispatchEvent(
          new CustomEvent('cookieConsentChanged', {
            detail: {
              accepted: !!prefs.functional,
              essential: true,
              functional: !!prefs.functional,
              analytics: !!prefs.analytics,
            },
          })
        );
      }
    } catch (e) {
      // ignore
    }
  }

  // ─── Focus trap helper ─────────────────────────────────────────────────────

  let _trapHandler = null;
  let _triggerEl = null;

  function trapFocus(el) {
    const focusable = el.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    _trapHandler = e => {
      if (e.key !== 'Tab' && e.keyCode !== 9) {
        return;
      }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    el.addEventListener('keydown', _trapHandler);
    first.focus();
  }

  function releaseFocus(el) {
    if (_trapHandler && el) {
      el.removeEventListener('keydown', _trapHandler);
      _trapHandler = null;
    }
  }

  // ─── Banner ────────────────────────────────────────────────────────────────

  function removeBanner() {
    const banner = document.getElementById('cookie-consent-banner');
    document.body.classList.remove('ef-cookie-banner-open');
    if (banner) {
      banner.classList.add('cookie-consent-hiding');
      setTimeout(() => {
        if (banner.parentNode) {
          banner.parentNode.removeChild(banner);
        }
      }, 300);
    }
  }

  function showCookieBanner() {
    if (hasConsent()) {
      return;
    }

    // Synchronously remove any stale banner before creating a new one
    const stale = document.getElementById('cookie-consent-banner');
    if (stale && stale.parentNode) {
      stale.parentNode.removeChild(stale);
    }

    const banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.className = 'cookie-consent-banner';
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-modal', 'true');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.setAttribute('aria-live', 'polite');

    banner.innerHTML =
      '<div class="cookie-consent-content">' +
      '<div class="cookie-consent-message">' +
      '<p><strong>We use cookies.</strong> Essential cookies keep the site working; with your consent we also use functional cookies (e.g.\u00a0theme preference). Clicking \u201cAccept All\u201d agrees to the optional ones.</p>' +
      '<p class="cookie-consent-links">' +
      '<a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> \u00b7 ' +
      '<a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> \u00b7 ' +
      '<a href="/legal#cookies" target="_blank" rel="noopener noreferrer">Cookie Policy</a>' +
      '</p>' +
      '</div>' +
      '<div class="cookie-consent-actions">' +
      '<button id="cookie-consent-accept" class="cookie-consent-btn cookie-consent-accept" aria-label="Accept all cookies">Accept All</button>' +
      '<button id="cookie-consent-reject" class="cookie-consent-btn cookie-consent-reject" aria-label="Reject non-essential cookies">Reject</button>' +
      '<button id="cookie-consent-manage" class="cookie-consent-btn cookie-consent-manage" aria-label="Manage cookie preferences">Manage Preferences</button>' +
      '</div>' +
      '</div>';

    // Hide floating widgets (e.g. the chat launcher) that would otherwise overlap
    // the banner's action buttons in the same bottom-left safe area on mobile.
    document.body.classList.add('ef-cookie-banner-open');

    document.body.appendChild(banner);
    // Focus first interactive element for keyboard users
    requestAnimationFrame(() => {
      const firstBtn = banner.querySelector('button, [href]');
      if (firstBtn) {
        firstBtn.focus();
      }
    });

    setTimeout(() => {
      banner.classList.add('cookie-consent-visible');
    }, 100);

    // Focus the first action button for accessibility
    const acceptBtn = document.getElementById('cookie-consent-accept');
    if (acceptBtn) {
      setTimeout(() => acceptBtn.focus(), 150);
    }

    document.getElementById('cookie-consent-accept').addEventListener('click', () => {
      applyConsent({ essential: true, functional: true, analytics: false });
      removeBanner();
    });

    document.getElementById('cookie-consent-reject').addEventListener('click', () => {
      applyConsent({ essential: true, functional: false, analytics: false });
      removeBanner();
    });

    document.getElementById('cookie-consent-manage').addEventListener('click', () => {
      removeBanner();
      openPreferencesDialog(readConsentCookie() || defaultPrefs());
    });
  }

  // ─── Apply & persist consent ────────────────────────────────────────────────

  function applyConsent(prefs) {
    writeConsentCookie(prefs);
    if (!prefs.functional) {
      clearOptionalStorage();
    }
    dispatchConsentEvent(prefs);
  }

  // ─── Preferences dialog ────────────────────────────────────────────────────

  function openPreferencesDialog(currentPrefs) {
    // Remove any existing dialog
    const existing = document.getElementById('cookie-prefs-dialog');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    const prefs = currentPrefs || readConsentCookie() || defaultPrefs();

    const overlay = document.createElement('div');
    overlay.id = 'cookie-prefs-dialog';
    overlay.className = 'cookie-prefs-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cookie-prefs-title');

    overlay.innerHTML =
      '<div class="cookie-prefs-panel" role="document">' +
      '<div class="cookie-prefs-header">' +
      '<h2 id="cookie-prefs-title" class="cookie-prefs-title">Cookie Preferences</h2>' +
      '<button class="ef-cta cookie-prefs-close" aria-label="Close cookie preferences">' +
      '<span aria-hidden="true">\u00d7</span>' +
      '</button>' +
      '</div>' +
      '<div class="cookie-prefs-body">' +
      '<p class="cookie-prefs-intro">Manage your cookie preferences below. Essential cookies cannot be disabled as they are required for the site to function.</p>' +
      // Essential
      '<div class="cookie-prefs-category">' +
      '<div class="cookie-prefs-category-header">' +
      '<div>' +
      '<strong class="cookie-prefs-category-name">Essential Cookies</strong>' +
      '<p class="cookie-prefs-category-desc">Required for authentication and core site functionality. Cannot be disabled.</p>' +
      '</div>' +
      '<span class="cookie-prefs-always-on" aria-label="Always active">Always on</span>' +
      '</div>' +
      '</div>' +
      // Functional
      '<div class="cookie-prefs-category">' +
      '<div class="cookie-prefs-category-header">' +
      '<div>' +
      '<strong class="cookie-prefs-category-name">Functional Cookies</strong>' +
      '<p class="cookie-prefs-category-desc">Remember your preferences such as dark/light mode and UI settings. Disabling will clear saved preferences.</p>' +
      '</div>' +
      `<label class="cookie-prefs-toggle" aria-label="Toggle functional cookies">` +
      `<input type="checkbox" id="cookie-pref-functional" ${prefs.functional ? 'checked' : ''}>` +
      '<span class="cookie-prefs-toggle-slider"></span>' +
      '</label>' +
      '</div>' +
      '</div>' +
      // Analytics
      '<div class="cookie-prefs-category">' +
      '<div class="cookie-prefs-category-header">' +
      '<div>' +
      '<strong class="cookie-prefs-category-name">Analytics Cookies</strong>' +
      '<p class="cookie-prefs-category-desc">Help us understand how visitors use the site. Currently unused \u2014 off by default.</p>' +
      '</div>' +
      `<label class="cookie-prefs-toggle" aria-label="Toggle analytics cookies">` +
      `<input type="checkbox" id="cookie-pref-analytics" ${prefs.analytics ? 'checked' : ''}>` +
      '<span class="cookie-prefs-toggle-slider"></span>' +
      '</label>' +
      '</div>' +
      '</div>' +
      '</div>' + // end body
      '<div class="cookie-prefs-footer">' +
      '<button id="cookie-prefs-save" class="cookie-consent-btn cookie-consent-accept">Save Preferences</button>' +
      '<button id="cookie-prefs-accept-all" class="cookie-consent-btn cookie-consent-reject">Accept All</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.classList.add('cookie-prefs-open');

    // Trap focus and focus first element
    const panel = overlay.querySelector('.cookie-prefs-panel');
    trapFocus(panel);

    // Escape key closes dialog
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        closePreferencesDialog(overlay);
      }
    });

    // Click outside panel closes dialog
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        closePreferencesDialog(overlay);
      }
    });

    overlay.querySelector('.cookie-prefs-close').addEventListener('click', () => {
      closePreferencesDialog(overlay);
    });

    document.getElementById('cookie-prefs-save').addEventListener('click', () => {
      const functional = document.getElementById('cookie-pref-functional').checked;
      const analytics = document.getElementById('cookie-pref-analytics').checked;
      applyConsent({ essential: true, functional, analytics });
      closePreferencesDialog(overlay);
      removeBanner();
    });

    document.getElementById('cookie-prefs-accept-all').addEventListener('click', () => {
      applyConsent({ essential: true, functional: true, analytics: false });
      closePreferencesDialog(overlay);
      removeBanner();
    });

    // Animate in
    setTimeout(() => overlay.classList.add('cookie-prefs-visible'), 10);
  }

  function closePreferencesDialog(overlay) {
    const el = overlay || document.getElementById('cookie-prefs-dialog');
    if (!el) {
      return;
    }
    releaseFocus(el.querySelector('.cookie-prefs-panel'));
    el.classList.remove('cookie-prefs-visible');
    document.body.classList.remove('cookie-prefs-open');
    const trigger = _triggerEl;
    _triggerEl = null;
    setTimeout(() => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
      if (trigger && typeof trigger.focus === 'function') {
        trigger.focus();
      }
    }, 250);
  }

  // ─── Public helpers ────────────────────────────────────────────────────────

  function hasConsent() {
    return readConsentCookie() !== null;
  }

  function openPreferences(e) {
    const candidate = (e && e.currentTarget) || (e && e.target) || null;
    _triggerEl =
      candidate && candidate !== document.body && typeof candidate.focus === 'function'
        ? candidate
        : null;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => openPreferencesDialog());
    } else {
      openPreferencesDialog();
    }
  }

  function revokeConsent() {
    deleteCookieRaw(CONSENT_COOKIE_NAME);
    clearOptionalStorage();
    dispatchConsentEvent(defaultPrefs());
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showCookieBanner);
    } else {
      removeBanner();
      const existingDialog = document.getElementById('cookie-prefs-dialog');
      if (existingDialog) {
        closePreferencesDialog(existingDialog);
      }
      showCookieBanner();
    }
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  function bindPrefsButtons() {
    document.querySelectorAll('[data-cookie-prefs]').forEach(btn => {
      btn.addEventListener('click', openPreferences);
    });
  }

  function bindRevokeButtons() {
    document.querySelectorAll('[data-cookie-revoke]').forEach(btn => {
      btn.addEventListener('click', revokeConsent);
    });
  }

  function init() {
    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          showCookieBanner();
          bindPrefsButtons();
          bindRevokeButtons();
        });
      } else {
        showCookieBanner();
        bindPrefsButtons();
        bindRevokeButtons();
      }
    } catch (e) {
      console.warn('CookieConsent: failed to initialise', e);
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  window.CookieConsent = {
    /** Returns the current structured consent object {essential, functional, analytics}. */
    getConsent() {
      try {
        const prefs = readConsentCookie();
        return prefs
          ? { essential: true, functional: !!prefs.functional, analytics: !!prefs.analytics }
          : { essential: true, functional: false, analytics: false };
      } catch {
        return { essential: true, functional: false, analytics: false };
      }
    },
    /** Returns true if a consent decision has been recorded. */
    hasConsent,
    /** Opens the preferences dialog (works even after a prior decision). */
    openPreferences,
    /** Clears consent and reopens the initial banner. */
    revokeConsent,
    /** Alias for revokeConsent. */
    reset: revokeConsent,
    /** Shows the initial banner if no consent has been recorded. */
    show: showCookieBanner,
    /** Re-initialise (idempotent). */
    init,
  };

  try {
    init();
  } catch (e) {
    console.warn('CookieConsent: auto-init failed', e);
  }
})();
