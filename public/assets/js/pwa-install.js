/**
 * PWA Install Prompt
 * Shows an install banner when the app is installable and not previously dismissed.
 * Handles both the beforeinstallprompt (Chrome/Android) flow and
 * a static iOS guide fallback.
 */

(function () {
  'use strict';

  const DISMISSED_KEY = 'ef_pwa_install_dismissed';
  const BANNER_ID = 'ef-pwa-install-banner';

  // Bail if already dismissed
  function isDismissed() {
    try {
      return localStorage.getItem(DISMISSED_KEY) === 'true';
    } catch (_) {
      return false;
    }
  }

  function markDismissed() {
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch (_) {
      // ignore storage errors
    }
  }

  function removeBanner() {
    const banner = document.getElementById(BANNER_ID);
    if (banner) {
      banner.remove();
    }
    document.body.classList.remove('ef-pwa-banner-visible');
  }

  function injectStyles() {
    if (document.getElementById('ef-pwa-install-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'ef-pwa-install-styles';
    style.textContent = `
      #ef-pwa-install-banner {
        position: fixed;
        bottom: 1rem;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: #0B8073;
        color: #fff;
        padding: 0.75rem 1.25rem;
        border-radius: 0.75rem;
        box-shadow: 0 4px 20px rgba(0,0,0,0.25);
        font-family: inherit;
        font-size: 0.9rem;
        max-width: calc(100vw - 2rem);
        width: max-content;
        animation: ef-pwa-slide-up 0.3s ease;
      }
      @keyframes ef-pwa-slide-up {
        from { opacity: 0; transform: translateX(-50%) translateY(1rem); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      #ef-pwa-install-banner .ef-pwa-icon {
        font-size: 1.4rem;
        flex-shrink: 0;
      }
      #ef-pwa-install-banner .ef-pwa-text {
        flex: 1;
      }
      #ef-pwa-install-banner .ef-pwa-text strong {
        display: block;
        font-weight: 600;
      }
      #ef-pwa-install-banner .ef-pwa-install-btn {
        background: #fff;
        color: #0B8073;
        border: none;
        border-radius: 0.5rem;
        padding: 0.4rem 0.9rem;
        font-weight: 600;
        cursor: pointer;
        font-size: 0.85rem;
        white-space: nowrap;
        flex-shrink: 0;
      }
      #ef-pwa-install-banner .ef-pwa-install-btn:hover {
        background: #e6f4f2;
      }
      #ef-pwa-install-banner .ef-pwa-dismiss-btn {
        background: transparent;
        color: rgba(255,255,255,0.8);
        border: none;
        cursor: pointer;
        font-size: 1.1rem;
        padding: 0 0.25rem;
        flex-shrink: 0;
        line-height: 1;
      }
      #ef-pwa-install-banner .ef-pwa-dismiss-btn:hover {
        color: #fff;
      }
    `;
    document.head.appendChild(style);
  }

  function createBanner(onInstall, onDismiss) {
    injectStyles();
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.setAttribute('role', 'banner');
    banner.setAttribute('aria-label', 'Install EventFlow app');
    banner.innerHTML = `
      <span class="ef-pwa-icon" aria-hidden="true">📲</span>
      <span class="ef-pwa-text">
        <strong>Install EventFlow</strong>
        Add to your home screen for quick access
      </span>
      <button class="ef-pwa-install-btn" type="button">Install</button>
      <button class="ef-pwa-dismiss-btn" type="button" aria-label="Dismiss install prompt">✕</button>
    `;
    banner.querySelector('.ef-pwa-install-btn').addEventListener('click', onInstall);
    banner.querySelector('.ef-pwa-dismiss-btn').addEventListener('click', onDismiss);
    document.body.appendChild(banner);
    document.body.classList.add('ef-pwa-banner-visible');
    return banner;
  }

  // Standard (Chrome/Android) flow
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', e => {
    if (isDismissed()) {
      return;
    }

    // Prevent the default mini-infobar
    e.preventDefault();
    deferredPrompt = e;

    createBanner(
      // Install button
      () => {
        removeBanner();
        if (deferredPrompt) {
          deferredPrompt.prompt();
          deferredPrompt.userChoice.then(choiceResult => {
            if (choiceResult.outcome === 'accepted') {
              markDismissed();
            }
            deferredPrompt = null;
          });
        }
      },
      // Dismiss button
      () => {
        markDismissed();
        removeBanner();
      }
    );
  });

  // iOS Safari fallback: show a static guide if standalone not active
  (function () {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone =
      window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;

    if (isIOS && !isStandalone && !isDismissed()) {
      // Delay slightly so the page loads first
      setTimeout(() => {
        injectStyles();
        const banner = document.createElement('div');
        banner.id = BANNER_ID;
        banner.setAttribute('role', 'banner');
        banner.setAttribute('aria-label', 'Install EventFlow app on iOS');
        banner.innerHTML = `
          <span class="ef-pwa-icon" aria-hidden="true">📲</span>
          <span class="ef-pwa-text">
            <strong>Install EventFlow</strong>
            Tap <strong>Share</strong> then <strong>Add to Home Screen</strong>
          </span>
          <button class="ef-pwa-dismiss-btn" type="button" aria-label="Dismiss install prompt">✕</button>
        `;
        banner.querySelector('.ef-pwa-dismiss-btn').addEventListener('click', () => {
          markDismissed();
          removeBanner();
        });
        document.body.appendChild(banner);
        document.body.classList.add('ef-pwa-banner-visible');
      }, 2000);
    }
  })();
})();
