/**
 * Homepage sign-up popup / banner.
 * Reads the admin-controlled mode (disabled/popup/banner) and delay, then
 * shows either the shared Modal component (components.js) or a compact
 * bottom banner to signed-out visitors. Dismissing either is remembered
 * until the visitor clears functional storage.
 */
'use strict';
(function () {
  const STORAGE_KEY = 'ef_signup_popup_dismissed';
  const SETTINGS_URL = '/api/v1/public/signup-popup';
  const TITLE_ID = 'ef-signup-popup-title';
  const BANNER_ID = 'ef-signup-banner';

  const BADGE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20 21a8 8 0 1 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>';

  const CLOSE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  /**
   * Whether this visitor has already dismissed the popup.
   *
   * Uses localStorage rather than sessionStorage because auth-state.js calls a
   * blanket sessionStorage.clear() every time /auth/me returns 401 — i.e. on
   * every page load for the signed-out visitors this popup targets — which
   * would wipe the flag and re-nag them on each view. Matches the existing
   * ef_onboarding_dismissed convention in app.js.
   *
   * @returns {boolean} true if the popup should stay hidden
   */
  function alreadyDismissed() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  /**
   * Record that the visitor dismissed the popup so it does not return.
   *
   * @returns {void}
   */
  function markDismissed() {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch (_) {
      /* localStorage unavailable (e.g. private mode) — nothing to persist */
    }
  }

  /**
   * Whether the visitor already has an account.
   *
   * The popup pitches creating one, so it must never reach someone signed in.
   * An unavailable or failed auth check is treated as signed out, since the
   * homepage is public and that is the common case.
   *
   * @returns {Promise<boolean>} true if the visitor is authenticated
   */
  async function isSignedIn() {
    const auth = window.AuthStateManager;
    if (!auth || typeof auth.init !== 'function') {
      return false;
    }
    try {
      await auth.init();
      return auth.isAuthenticated();
    } catch (_) {
      return false;
    }
  }

  /**
   * Apply the marketing treatment the shared Modal does not provide: a badge
   * icon above the heading, an SVG close glyph, and an aria-labelledby link
   * from the dialog to its title.
   *
   * @param {Object} modal - a shown Modal instance from components.js
   * @returns {void}
   */
  function decorate(modal) {
    const header = modal.modal.querySelector('.modal-header');
    const title = modal.modal.querySelector('.modal-title');
    const closeBtn = modal.modal.querySelector('.modal-close');

    if (title) {
      title.id = TITLE_ID;
      modal.overlay.setAttribute('aria-labelledby', TITLE_ID);
    }
    if (closeBtn) {
      closeBtn.innerHTML = CLOSE_ICON;
    }
    if (header) {
      const badge = document.createElement('div');
      badge.className = 'signup-popup-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.innerHTML = BADGE_ICON;
      header.prepend(badge);
    }
  }

  /**
   * Build and show the popup, reusing the shared Modal for its overlay,
   * Esc-to-close, focus trap and click-outside behaviour.
   *
   * @returns {void}
   */
  function showPopup() {
    if (alreadyDismissed() || typeof Modal === 'undefined') {
      return;
    }

    const modal = new Modal({
      title: 'Join to get the full experience',
      content:
        '<p>Save favourites, message suppliers directly and track your event planning — all in one free account.</p>',
      confirmText: 'Log in / create account',
      cancelText: 'Not now',
      showCancel: true,
      onConfirm: () => {
        window.location.href = '/auth';
      },
    });

    // Every dismissal path (X, Esc, click-outside, "Not now", the CTA) routes
    // through Modal#hide, so wrapping it here is the one place that reliably
    // records the dismissal.
    const originalHide = modal.hide.bind(modal);
    modal.hide = () => {
      markDismissed();
      originalHide();
    };

    modal.show();
    modal.overlay.classList.add('signup-popup-overlay');
    modal.modal.classList.add('signup-popup-modal');
    decorate(modal);
  }

  /**
   * Build and show the compact banner variant: the same pitch and CTA as the
   * popup, but as a slim, dismissible bar anchored to the bottom of the
   * viewport instead of a blocking dialog.
   *
   * @returns {void}
   */
  function showBanner() {
    if (alreadyDismissed() || document.getElementById(BANNER_ID)) {
      return;
    }

    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.className = 'signup-banner';
    banner.setAttribute('role', 'complementary');
    banner.setAttribute('aria-labelledby', TITLE_ID);
    banner.innerHTML = `
      <div class="signup-banner-inner">
        <div class="signup-banner-badge" aria-hidden="true">${BADGE_ICON}</div>
        <div class="signup-banner-text">
          <strong id="${TITLE_ID}">Join to get the full experience</strong>
          <span>Save favourites, message suppliers directly and track your planning.</span>
        </div>
        <div class="signup-banner-actions">
          <button type="button" class="cta signup-banner-cta">Log in / create account</button>
          <button type="button" class="signup-banner-close" aria-label="Dismiss">${CLOSE_ICON}</button>
        </div>
      </div>`;

    function dismiss() {
      markDismissed();
      banner.remove();
    }

    banner.querySelector('.signup-banner-cta').addEventListener('click', () => {
      window.location.href = '/auth';
    });
    banner.querySelector('.signup-banner-close').addEventListener('click', dismiss);

    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('signup-banner-visible'));
  }

  /**
   * Read the admin setting and, when the popup/banner applies to this
   * visitor, schedule it for the configured delay. Silent on any failure —
   * this feature is non-critical and must never surface an error on the
   * homepage.
   *
   * @returns {Promise<void>}
   */
  async function init() {
    if (alreadyDismissed()) {
      return;
    }

    try {
      const res = await fetch(SETTINGS_URL, { credentials: 'same-origin' });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      if (!data || (data.mode !== 'popup' && data.mode !== 'banner')) {
        return;
      }
      if (await isSignedIn()) {
        return;
      }

      const render = data.mode === 'banner' ? showBanner : showPopup;
      const delayMs = Math.max(0, Number(data.delaySeconds) || 0) * 1000;
      setTimeout(() => {
        if (!alreadyDismissed()) {
          render();
        }
      }, delayMs);
    } catch (_) {
      /* Non-critical — fail silently rather than surfacing a network error */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
