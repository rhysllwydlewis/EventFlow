/**
 * Homepage sign-up popup.
 * Reads the admin-controlled delay/enabled flag, then shows the shared
 * Modal component (components.js) once per browser session.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ef_signup_popup_dismissed';
  const SETTINGS_URL = '/api/v1/public/signup-popup';

  function alreadyDismissed() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function markDismissed() {
    try {
      sessionStorage.setItem(STORAGE_KEY, '1');
    } catch (_) {
      /* sessionStorage unavailable (e.g. private mode) — nothing to persist */
    }
  }

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
    // marks the popup dismissed for the rest of the session.
    const originalHide = modal.hide.bind(modal);
    modal.hide = () => {
      markDismissed();
      originalHide();
    };

    modal.show();
    modal.overlay.classList.add('signup-popup-overlay');
    modal.modal.classList.add('signup-popup-modal');
  }

  function init() {
    if (alreadyDismissed()) {
      return;
    }

    fetch(SETTINGS_URL, { credentials: 'same-origin' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data || data.enabled !== true) {
          return;
        }
        const delayMs = Math.max(0, Number(data.delaySeconds) || 0) * 1000;
        setTimeout(() => {
          if (!alreadyDismissed()) {
            showPopup();
          }
        }, delayMs);
      })
      .catch(() => {
        /* Popup is non-critical — fail silently rather than surfacing a network error */
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
