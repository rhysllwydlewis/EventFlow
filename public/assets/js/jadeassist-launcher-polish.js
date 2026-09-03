'use strict';
(function () {
  const STYLE_ID = 'eventflow-jadeassist-launcher-polish';
  const DOCUMENT_STYLE_ID = 'eventflow-jadeassist-launcher-host-state';
  const ROOT_SELECTOR = '.jade-widget-root';
  const DEFAULT_DISMISS_DURATION_MS = 0;
  const LEGACY_DISMISS_STORAGE_KEYS = [
    'jadeassist_dismissed_at',
    'jade-widget-launcher-dismissed-at',
  ];
  const POLISHED_ATTRIBUTE = 'data-eventflow-launcher-polished';
  const OBSERVER_PROPERTY = '__eventflowLauncherPolishObserver';
  const INIT_OVERRIDE_FLAG = '__eventflowLauncherPolishInstalled';

  function configuredDismissDuration() {
    const configured = window.JADEASSIST_CONFIG?.launcherDismissDurationMs;
    return Number.isFinite(configured) && configured >= 0
      ? configured
      : DEFAULT_DISMISS_DURATION_MS;
  }

  function clearPersistedDismissals(config = {}) {
    const storageKeys = new Set([
      ...LEGACY_DISMISS_STORAGE_KEYS,
      config.launcherDismissStorageKey,
      window.JADEASSIST_CONFIG?.launcherDismissStorageKey,
    ]);

    try {
      for (const storageKey of storageKeys) {
        if (storageKey) {
          localStorage.removeItem(storageKey);
        }
      }
    } catch (_) {
      // Storage may be unavailable. The zero-duration config still prevents new persistence.
    }
  }

  function ensureDocumentStyles() {
    if (document.getElementById(DOCUMENT_STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = DOCUMENT_STYLE_ID;
    style.textContent = `
      ${ROOT_SELECTOR}[hidden],
      ${ROOT_SELECTOR}[aria-hidden='true'] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;
    const styleTarget = document.head || document.documentElement;
    styleTarget.appendChild(style);
  }

  function installInitOverride() {
    const widget = window.JadeWidget;
    if (!widget || typeof widget.init !== 'function') {
      return false;
    }
    if (widget[INIT_OVERRIDE_FLAG]) {
      return true;
    }

    const originalInit = widget.init.bind(widget);
    widget.init = function eventFlowJadeAssistInit(config = {}) {
      const launcherDismissDurationMs = configuredDismissDuration();
      if (launcherDismissDurationMs <= 0) {
        clearPersistedDismissals(config);
      }

      return originalInit({
        ...config,
        launcherDismissDurationMs,
      });
    };

    Object.defineProperty(widget, INIT_OVERRIDE_FLAG, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    return true;
  }

  function ensurePolishStyles(shadowRoot) {
    if (shadowRoot.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .jade-avatar-button,
      .jade-launcher-dismiss {
        animation: eventflow-jade-launcher-float 3s ease-in-out infinite !important;
      }

      @keyframes eventflow-jade-launcher-float {
        0%, 100% { translate: 0 0; }
        50% { translate: 0 -10px; }
      }

      .jade-launcher-dismiss {
        --eventflow-close-visual-size: 30px;
        top: calc(-10px - ((52px - var(--eventflow-close-visual-size)) / 2)) !important;
        left: calc(-10px - ((52px - var(--eventflow-close-visual-size)) / 2)) !important;
        width: 52px !important;
        min-width: 52px !important;
        height: 52px !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 50% !important;
        background: transparent !important;
        filter: none !important;
        transform: none !important;
      }

      .jade-launcher-dismiss::before {
        display: none !important;
      }

      .jade-launcher-dismiss-asset,
      .jade-launcher-dismiss-fallback {
        width: var(--eventflow-close-visual-size) !important;
        min-width: var(--eventflow-close-visual-size) !important;
        height: var(--eventflow-close-visual-size) !important;
        flex: 0 0 var(--eventflow-close-visual-size) !important;
        transition: transform 160ms ease, filter 160ms ease;
      }

      .jade-launcher-dismiss:hover,
      .jade-launcher-dismiss:active {
        transform: none !important;
        filter: none !important;
      }

      .jade-launcher-dismiss:hover .jade-launcher-dismiss-asset,
      .jade-launcher-dismiss:hover .jade-launcher-dismiss-fallback {
        transform: scale(1.08);
        filter: brightness(0.96);
      }

      .jade-launcher-dismiss:active .jade-launcher-dismiss-asset,
      .jade-launcher-dismiss:active .jade-launcher-dismiss-fallback {
        transform: scale(0.96);
      }

      .jade-avatar-badge--asset-fallback {
        background: #ef4444 !important;
        border: 2px solid #fff !important;
        color: #fff !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        line-height: 1 !important;
      }

      @media (max-width: 480px) {
        .jade-launcher-dismiss {
          --eventflow-close-visual-size: 28px;
          width: 52px !important;
          min-width: 52px !important;
          height: 52px !important;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .jade-avatar-button,
        .jade-launcher-dismiss {
          animation: none !important;
          translate: none !important;
        }
      }
    `;
    shadowRoot.appendChild(style);
  }

  function enhanceNotificationFallback(shadowRoot) {
    const badge = shadowRoot.querySelector('.jade-avatar-badge');
    if (!badge) {
      return;
    }

    const asset = badge.querySelector('.jade-avatar-badge-asset');
    if (asset && asset.dataset.eventflowFallbackBound !== 'true') {
      asset.dataset.eventflowFallbackBound = 'true';
      asset.addEventListener('error', () => {
        badge.classList.add('jade-avatar-badge--asset-fallback');
      });
    }

    if (!asset && badge.textContent.trim()) {
      badge.classList.add('jade-avatar-badge--asset-fallback');
    }
  }

  function enhanceCloseControl(shadowRoot) {
    const closeButton = shadowRoot.querySelector('.jade-launcher-dismiss');
    if (!closeButton) {
      return;
    }

    closeButton.setAttribute('aria-label', 'Close JadeAssist assistant');
    closeButton.title = 'Close JadeAssist';
    closeButton.setAttribute('data-eventflow-hit-target', '52');
  }

  function enhanceShadowRoot(shadowRoot) {
    ensurePolishStyles(shadowRoot);
    enhanceCloseControl(shadowRoot);
    enhanceNotificationFallback(shadowRoot);
  }

  function polishRoot(root) {
    if (!root?.shadowRoot) {
      return;
    }

    root.setAttribute(POLISHED_ATTRIBUTE, 'true');
    enhanceShadowRoot(root.shadowRoot);

    if (!root[OBSERVER_PROPERTY]) {
      const observer = new MutationObserver(() => enhanceShadowRoot(root.shadowRoot));
      observer.observe(root.shadowRoot, { childList: true, subtree: true });
      Object.defineProperty(root, OBSERVER_PROPERTY, {
        value: observer,
        configurable: true,
      });
    }
  }

  function polishMountedLaunchers() {
    for (const root of document.querySelectorAll(ROOT_SELECTOR)) {
      polishRoot(root);
    }
  }

  function start() {
    ensureDocumentStyles();
    if (configuredDismissDuration() <= 0) {
      clearPersistedDismissals();
    }
    installInitOverride();
    polishMountedLaunchers();

    const documentObserver = new MutationObserver(() => {
      ensureDocumentStyles();
      installInitOverride();
      polishMountedLaunchers();
    });
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Deferred scripts execute in document order before DOMContentLoaded. Install the
  // host-state rule and init wrapper immediately so the following EventFlow initializer
  // receives page-only dismissal behaviour on its very first call.
  ensureDocumentStyles();
  if (configuredDismissDuration() <= 0) {
    clearPersistedDismissals();
  }
  installInitOverride();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
