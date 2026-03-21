/**
 * JadeAssist Widget Initialization - v2
 * Initializes the JadeAssist chat widget with EventFlow branding.
 * Features:
 * - Teaser bubble with A/B testing, keyboard accessibility, analytics events
 * - Scroll-engagement detection (shows teaser after 25% page scroll)
 * - Avatar URL resolution for subpath deployments
 * - Debug mode via ?jade-debug query param (works in any environment)
 * - Safe-area inset support for iOS notched devices
 * - Double-init guard
 * - Configurable backend API URL (via window.JADEASSIST_CONFIG or built-in default)
 */

(function () {
  'use strict';

  // Global initialization guard - prevent double-init if script loads twice
  if (window.__JADE_WIDGET_INITIALIZED__) {
    console.warn('[JadeAssist] Widget already initialized, skipping duplicate init');
    return;
  }
  window.__JADE_WIDGET_INITIALIZED__ = true;

  // ─── Configuration ────────────────────────────────────────────────────────

  // Backend API base URL for JadeAssist.
  // Override by setting window.JADEASSIST_CONFIG = { apiBaseUrl: 'https://...' } before this
  // script loads (e.g. from a config snippet), or by changing JADEASSIST_API_BASE_URL in the
  // server environment (served via /api/config and injected into window.JADEASSIST_CONFIG).
  // Default points to the Railway-hosted backend service.
  // Keep this default in sync with the default in routes/system.js (/api/config).
  const API_BASE_URL =
    (window.JADEASSIST_CONFIG && window.JADEASSIST_CONFIG.apiBaseUrl) ||
    'https://jadeassistbackend-production.up.railway.app';

  // EventFlow catalog API base URL — used by JadeAssist backend to fetch supplier/venue data.
  // Injected via window.JADEASSIST_CONFIG.catalogApiBaseUrl (populated from /api/config).
  // Falls back to empty string, meaning JadeAssist will use its own configured value.
  const CATALOG_API_BASE_URL =
    (window.JADEASSIST_CONFIG && window.JADEASSIST_CONFIG.catalogApiBaseUrl) || '';

  const MAX_RETRIES = 50; // Maximum retry attempts (5 seconds with 100ms interval)
  const RETRY_INTERVAL = 100; // Retry interval in milliseconds
  const INIT_DELAY = 2000; // Delay before init attempt (ms) — prioritize page content first
  const TEASER_DELAY = 500; // Delay before showing teaser after init (ms)
  const TEASER_AUTO_DISMISS_MS = 10000; // Auto-dismiss teaser after 10 s of inactivity
  const TEASER_STORAGE_KEY = 'jadeassist-teaser-dismissed';
  const TEASER_EXPIRY_DAYS = 1; // Teaser dismissal persists for 1 day
  const MOBILE_BREAKPOINT = 768; // px — matches CSS media query breakpoint

  // Positioning constants passed directly to widget config API
  // Aligns widget with back-to-top button (mirror sides, same vertical offset)
  const DESKTOP_OFFSET_BOTTOM = '5rem';
  const DESKTOP_OFFSET_LEFT = '1.5rem';
  const MOBILE_OFFSET_BOTTOM = '4.5rem';
  const MOBILE_OFFSET_LEFT = '1rem';

  // Z-index coordination for correct stacking order
  const Z_INDEX = {
    WIDGET: 999, // JadeAssist widget launcher + panel
    TEASER: 998, // Teaser bubble (below widget)
    BACK_TO_TOP: 900, // Back-to-top button (below both)
  };

  // A/B test variants — toggle via localStorage for testing:
  //   localStorage.setItem('jadeassist-teaser-variant', 'B'); location.reload();
  const TEASER_VARIANTS = {
    A: {
      desktop: "Hi, I'm Jade — want help finding venues and trusted suppliers?",
      mobile: 'Need help finding venues? 👋',
    },
    B: {
      desktop: 'Planning an event? Let me help you find the perfect suppliers! 🎉',
      mobile: 'Planning an event? 🎉',
    },
    C: {
      desktop: 'Find trusted event suppliers in minutes ⚡',
      mobile: 'Find suppliers fast ⚡',
    },
  };

  // ─── State ────────────────────────────────────────────────────────────────
  let initialized = false;
  let retryCount = 0;
  let warningLogged = false;
  let teaserElement = null;
  let widgetAvatarUrl = ''; // Set once on init, used by showTeaser() for avatar display

  // ─── Debug helpers ────────────────────────────────────────────────────────

  /**
   * Returns true when debug logging should be enabled.
   * Activated by:
   *   - The ?jade-debug query parameter (works in any environment)
   *   - localhost / 127.0.0.1 / *.local / dev.* / staging.* hostnames
   *
   * Tip: Append ?jade-debug to any URL to enable diagnostic logs in the
   * browser console, including avatar load status and init config summary.
   */
  function shouldEnableDebug() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('jade-debug')) {
      return true;
    }
    const hostname = window.location.hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.includes('.local') ||
      hostname.startsWith('dev.') ||
      hostname.startsWith('staging.')
    );
  }

  // ─── Avatar ───────────────────────────────────────────────────────────────

  /**
   * Resolves the avatar URL relative to the page's <base> tag.
   * Supports both root deployments (/assets/…) and subpath deployments
   * (/app/assets/…).
   */
  function getAvatarUrl() {
    const baseElement = document.querySelector('base');
    const basePath = baseElement ? baseElement.getAttribute('href') : '/';
    const avatarPath = 'assets/images/jade-avatar.png';

    if (!basePath || basePath === '/') {
      return `/${avatarPath}`;
    }
    const cleanBasePath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
    return `${cleanBasePath}/${avatarPath}`;
  }

  /**
   * Probes the avatar URL and logs the result.
   * Called whenever debug mode is active (any environment).
   */
  function verifyAvatarLoad(avatarUrl) {
    const img = new Image();
    img.onload = () => console.log('[JadeAssist] ✅ Avatar loaded successfully:', avatarUrl);
    img.onerror = () =>
      console.warn(
        '[JadeAssist] ⚠️ Avatar failed to load — widget will fall back to default icon.',
        'Check that the file exists at:',
        avatarUrl
      );
    img.src = avatarUrl;
  }

  // ─── Teaser bubble ────────────────────────────────────────────────────────

  /** Returns the A/B variant to use (localStorage override or 'A'). */
  function getTeaserVariant() {
    try {
      const override = localStorage.getItem('jadeassist-teaser-variant');
      return override && TEASER_VARIANTS[override] ? override : 'A';
    } catch (_) {
      return 'A';
    }
  }

  /** Returns true when the teaser was dismissed within the expiry window. */
  function isTeaserDismissed() {
    try {
      const stored = localStorage.getItem(TEASER_STORAGE_KEY);
      if (!stored) {
        return false;
      }
      const dismissedAt = parseInt(stored, 10);
      const expiryMs = TEASER_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      if (Date.now() - dismissedAt > expiryMs) {
        localStorage.removeItem(TEASER_STORAGE_KEY);
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Animates the teaser out, removes it from the DOM, and persists dismissal. */
  function dismissTeaser() {
    if (teaserElement && teaserElement.dataset.autoDismissTimeout) {
      clearTimeout(parseInt(teaserElement.dataset.autoDismissTimeout, 10));
    }
    try {
      localStorage.setItem(TEASER_STORAGE_KEY, Date.now().toString());
    } catch (_) {
      // localStorage unavailable — dismissal won't persist, which is acceptable
    }
    if (teaserElement) {
      teaserElement.style.opacity = '0';
      teaserElement.style.transform = 'translateY(10px)';
      const el = teaserElement;
      setTimeout(() => {
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
      }, 300);
      teaserElement = null;
    }
    // Safety sweep: remove any orphaned teaser nodes not held by teaserElement
    document.querySelectorAll('.jade-teaser').forEach(el => {
      el.style.opacity = '0';
      setTimeout(() => {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      }, 300);
    });
  }

  /** Opens the chat panel and emits an analytics event. Always dismisses the teaser first. */
  function openChat() {
    dismissTeaser();
    if (window.JadeWidget && typeof window.JadeWidget.open === 'function') {
      window.JadeWidget.open();
      window.dispatchEvent(
        new CustomEvent('jadeassist:widget-opened', { detail: { timestamp: Date.now() } })
      );
    }
  }

  /**
   * Injects CSS for the teaser bubble once per page.
   * Includes safe-area-inset support for iOS notched/dynamic-island devices.
   */
  function applyCustomStyles() {
    if (document.getElementById('jade-custom-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'jade-custom-styles';
    style.textContent = `
      /* ── Teaser bubble ── */
      .jade-teaser {
        position: fixed;
        bottom: 8rem; /* widget (5rem) + 3rem gap */
        left: 1.5rem;
        max-width: 280px;
        background: #fff;
        border-radius: 16px;
        border-left: 3px solid #00B2A9;
        box-shadow: 0 8px 24px rgba(0,178,169,.18);
        padding: 0;
        z-index: ${Z_INDEX.TEASER};
        opacity: 0;
        transform: translateY(10px) translateZ(0);
        transition: opacity .4s cubic-bezier(.4,0,.2,1),
                    transform .4s cubic-bezier(.34,1.56,.64,1);
        cursor: pointer;
        will-change: opacity, transform;
        backface-visibility: hidden;
        -webkit-font-smoothing: antialiased;
        font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      }

      .jade-teaser-visible {
        opacity: 1;
        transform: translateY(0) translateZ(0);
      }

      .jade-teaser:hover {
        transform: translateY(-2px) scale(1.01) translateZ(0);
        box-shadow: 0 12px 32px rgba(0,178,169,.28);
        transition: all .2s ease;
      }

      /* Visible focus ring for keyboard navigation */
      .jade-teaser:focus-visible {
        outline: 2px solid #00B2A9;
        outline-offset: 3px;
      }

      .jade-teaser-content {
        padding: 14px 14px 14px 12px;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      /* Jade avatar inside the teaser */
      .jade-teaser-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        flex-shrink: 0;
        object-fit: cover;
        border: 1.5px solid rgba(0,178,169,.35);
        align-self: flex-start;
        margin-top: 1px;
      }

      .jade-teaser-avatar-fallback {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        flex-shrink: 0;
        background: linear-gradient(135deg, #00B2A9 0%, #008C85 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        align-self: flex-start;
        margin-top: 1px;
        border: 1.5px solid rgba(0,178,169,.35);
      }

      .jade-teaser-text {
        flex: 1;
        font-size: 13.5px;
        line-height: 1.45;
        color: #1a2332;
        font-weight: 500;
        letter-spacing: -.01em;
      }

      .jade-teaser-close {
        flex-shrink: 0;
        background: none;
        border: none;
        font-size: 18px;
        line-height: 1;
        color: #8a99ab;
        cursor: pointer;
        padding: 2px;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background .15s ease, color .15s ease;
        align-self: flex-start;
        margin-top: 1px;
      }

      .jade-teaser-close:hover {
        background: rgba(0,178,169,.1);
        color: #00B2A9;
      }

      .jade-teaser-close:focus-visible {
        outline: 2px solid #00B2A9;
        outline-offset: 2px;
      }

      /* Tail arrow pointing down toward the widget launcher */
      .jade-teaser::after {
        content: '';
        position: absolute;
        bottom: -8px;
        left: 24px;
        width: 16px;
        height: 16px;
        background: #fff;
        transform: rotate(45deg);
        box-shadow: 2px 2px 6px rgba(0,178,169,.15);
      }

      /* Mobile adjustments — compact bubble, clear of bottom nav */
      @media (max-width: ${MOBILE_BREAKPOINT}px) {
        .jade-teaser {
          bottom: 7.5rem; /* widget (4.5rem) + 3rem gap */
          left: 0.75rem;
          max-width: min(260px, calc(100vw - 1.5rem));
        }

        .jade-teaser-content {
          padding: 10px 10px 10px 10px;
          gap: 8px;
        }

        .jade-teaser-avatar,
        .jade-teaser-avatar-fallback {
          width: 28px;
          height: 28px;
          font-size: 13px;
        }

        .jade-teaser-text {
          font-size: 12.5px;
          line-height: 1.4;
        }

        .jade-teaser-close {
          width: 20px;
          height: 20px;
          font-size: 15px;
          min-width: 20px;
        }
      }

      /* iOS safe-area insets (notch / Dynamic Island / home indicator) */
      @supports (padding: env(safe-area-inset-bottom)) {
        .jade-teaser {
          bottom: calc(8rem + env(safe-area-inset-bottom));
        }
        @media (max-width: ${MOBILE_BREAKPOINT}px) {
          .jade-teaser {
            bottom: calc(7.5rem + env(safe-area-inset-bottom));
          }
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Creates and shows the teaser bubble.
   * Skipped if the user dismissed it within TEASER_EXPIRY_DAYS days.
   * Fully keyboard-accessible: Enter/Space opens chat, Escape dismisses.
   * Auto-dismisses after TEASER_AUTO_DISMISS_MS (10 s).
   */
  function showTeaser() {
    if (isTeaserDismissed()) {
      return;
    }

    // DOM singleton guard — never render a second teaser bubble
    if (document.querySelector('.jade-teaser')) {
      return;
    }

    const debug = shouldEnableDebug();
    const variant = getTeaserVariant();
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
    const message = isMobile ? TEASER_VARIANTS[variant].mobile : TEASER_VARIANTS[variant].desktop;

    // Guard against empty/invalid teaser message
    if (!message || !message.trim()) {
      if (debug) {
        console.warn('[JadeAssist] Teaser message is empty — skipping render');
      }
      return;
    }

    teaserElement = document.createElement('div');
    teaserElement.className = 'jade-teaser';
    teaserElement.setAttribute('role', 'button');
    teaserElement.setAttribute('tabindex', '0');
    teaserElement.setAttribute('aria-label', 'Open chat with Jade');

    const avatarHtml = widgetAvatarUrl
      ? `<img class="jade-teaser-avatar" src="${widgetAvatarUrl}" alt="" aria-hidden="true" />`
      : `<span class="jade-teaser-avatar-fallback" aria-hidden="true">🪷</span>`;

    teaserElement.innerHTML = `
      <div class="jade-teaser-content">
        ${avatarHtml}
        <span class="jade-teaser-text">${message}</span>
        <button class="jade-teaser-close" aria-label="Dismiss message">&#10005;</button>
      </div>
    `;
    document.body.appendChild(teaserElement);

    const closeBtn = teaserElement.querySelector('.jade-teaser-close');

    // Click on the bubble body → open chat
    teaserElement.addEventListener('click', e => {
      if (e.target === closeBtn || closeBtn.contains(e.target)) {
        return;
      }
      window.dispatchEvent(
        new CustomEvent('jadeassist:teaser-clicked', {
          detail: { timestamp: Date.now(), source: 'teaser-bubble' },
        })
      );
      dismissTeaser();
      openChat();
    });

    // Keyboard: Enter/Space opens chat, Escape dismisses
    teaserElement.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent('jadeassist:teaser-clicked', {
            detail: { timestamp: Date.now(), source: 'teaser-bubble' },
          })
        );
        dismissTeaser();
        openChat();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent('jadeassist:teaser-dismissed', {
            detail: { timestamp: Date.now(), method: 'keyboard-escape' },
          })
        );
        dismissTeaser();
      }
    });

    // Close button click
    closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent('jadeassist:teaser-dismissed', {
          detail: { timestamp: Date.now(), method: 'close-button' },
        })
      );
      dismissTeaser();
    });

    // Keyboard on close button
    closeBtn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.stopPropagation();
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent('jadeassist:teaser-dismissed', {
            detail: { timestamp: Date.now(), method: 'close-button' },
          })
        );
        dismissTeaser();
      }
    });

    // Animate in after next paint
    setTimeout(() => {
      if (teaserElement) {
        teaserElement.classList.add('jade-teaser-visible');
      }
    }, 50);

    // Auto-dismiss after TEASER_AUTO_DISMISS_MS (10 s)
    const autoDismissTimeoutId = setTimeout(() => {
      if (teaserElement && teaserElement.parentNode) {
        window.dispatchEvent(
          new CustomEvent('jadeassist:teaser-dismissed', {
            detail: { timestamp: Date.now(), method: 'auto-dismiss' },
          })
        );
        dismissTeaser();
        if (debug) {
          console.log('[JadeAssist] Teaser auto-dismissed after 10 s');
        }
      }
    }, TEASER_AUTO_DISMISS_MS);

    teaserElement.dataset.autoDismissTimeout = autoDismissTimeoutId.toString();

    if (debug) {
      console.log('[JadeAssist] Teaser shown — variant:', variant, '| mobile:', isMobile);
    }

    // Start watcher to dismiss teaser if chat opens via launcher icon (shadow DOM path)
    startChatOpenWatcher();
  }

  /**
   * Polls for the chat panel becoming open and dismisses the teaser if detected.
   * Serves as a fallback for opens triggered directly via the widget launcher icon
   * (shadow DOM click), which bypass the openChat() function.
   * Must be called after teaserElement is set (from within showTeaser()).
   * Polling stops automatically once the teaser is dismissed.
   */
  function startChatOpenWatcher() {
    const POLL_INTERVAL = 500;

    const checkIsOpen = () => {
      // Prefer the widget API if it exposes isOpen()
      if (window.JadeWidget && typeof window.JadeWidget.isOpen === 'function') {
        return window.JadeWidget.isOpen();
      }
      // Fallback: inspect the widget root's shadow DOM using precise ARIA/state selectors
      try {
        const root = document.querySelector('.jade-widget-root');
        if (root && root.shadowRoot) {
          const panel = root.shadowRoot.querySelector(
            '[aria-expanded="true"], [role="dialog"][aria-hidden="false"], [data-state="open"]'
          );
          return !!panel;
        }
      } catch (_) {
        // shadowRoot access denied — ignore
      }
      return false;
    };

    const pollId = setInterval(() => {
      if (!teaserElement) {
        // Teaser already gone — stop polling
        clearInterval(pollId);
        return;
      }
      if (checkIsOpen()) {
        const debug = shouldEnableDebug();
        if (debug) {
          console.log('[JadeAssist] Chat open detected via watcher — dismissing teaser');
        }
        dismissTeaser();
        clearInterval(pollId);
      }
    }, POLL_INTERVAL);
  }

  // ─── Widget initialization ────────────────────────────────────────────────

  /**
   * Calls JadeWidget.init() with EventFlow brand config.
   * Injects teaser CSS and schedules the teaser bubble on success.
   */
  function initJadeWidget() {
    const debug = shouldEnableDebug();

    if (initialized) {
      if (debug) {
        console.log('[JadeAssist] Already initialized — skipping');
      }
      return;
    }

    if (typeof window.JadeWidget === 'undefined' || typeof window.JadeWidget.init !== 'function') {
      if (debug || !warningLogged) {
        console.warn('[JadeAssist] Widget not yet available, will retry…');
        warningLogged = true;
      }
      return;
    }

    try {
      const avatarUrl = getAvatarUrl();
      widgetAvatarUrl = avatarUrl; // Make available to showTeaser() for avatar display

      if (debug) {
        verifyAvatarLoad(avatarUrl);
        console.log('[JadeAssist] Init config:', {
          apiBaseUrl: API_BASE_URL,
          catalogApiBaseUrl: CATALOG_API_BASE_URL || '(not set)',
          primaryColor: '#00B2A9',
          assistantName: 'Jade',
          avatarUrl,
          offsetBottom: DESKTOP_OFFSET_BOTTOM,
          offsetLeft: DESKTOP_OFFSET_LEFT,
          offsetBottomMobile: MOBILE_OFFSET_BOTTOM,
          offsetLeftMobile: MOBILE_OFFSET_LEFT,
          scale: 0.85,
          debug,
        });
      }

      // Apply teaser CSS before the widget mounts
      applyCustomStyles();

      window.JadeWidget.init({
        // Backend API (Railway-hosted JadeAssist service)
        apiBaseUrl: API_BASE_URL,

        // EventFlow catalog API base URL (for JadeAssist to fetch supplier/venue data)
        ...(CATALOG_API_BASE_URL ? { catalogApiBaseUrl: CATALOG_API_BASE_URL } : {}),

        // Brand colors
        primaryColor: '#00B2A9',
        accentColor: '#008C85',

        // Assistant identity
        assistantName: 'Jade',
        greetingText: "Hi! I'm Jade. Ready to plan your event?",
        // Native tooltip disabled — custom teaser bubble is used instead
        greetingTooltipText: '',

        // Avatar
        avatarUrl,

        // Desktop positioning
        offsetBottom: DESKTOP_OFFSET_BOTTOM,
        offsetLeft: DESKTOP_OFFSET_LEFT,

        // Mobile positioning
        offsetBottomMobile: MOBILE_OFFSET_BOTTOM,
        offsetLeftMobile: MOBILE_OFFSET_LEFT,

        // Size (15% smaller for better mobile UX)
        scale: 0.85,

        // Diagnostic logs — also enabled via ?jade-debug in any environment
        debug,
      });

      initialized = true;
      if (debug) {
        console.log('[JadeAssist] Widget initialized successfully ✅');
      }

      // Ensure chat is closed on page load (defensive guard against auto-open)
      setTimeout(() => {
        if (window.JadeWidget && typeof window.JadeWidget.close === 'function') {
          window.JadeWidget.close();
          if (debug) {
            console.log('[JadeAssist] Chat closed on load (defensive)');
          }
        }
      }, 100);

      // Show teaser after TEASER_DELAY ms OR at 25% page scroll, whichever comes first
      let teaserScheduled = false;

      const showTeaserOnce = source => {
        if (teaserScheduled) {
          return;
        }
        teaserScheduled = true;
        window.removeEventListener('scroll', onScrollEngagement);
        showTeaser();
        if (debug) {
          console.log('[JadeAssist] Teaser triggered by:', source);
        }
      };

      const onScrollEngagement = () => {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        if (scrollable > 0) {
          const pct = (window.scrollY / scrollable) * 100;
          if (pct >= 25) {
            showTeaserOnce('scroll-25%');
          }
        }
      };

      setTimeout(() => showTeaserOnce('delay'), TEASER_DELAY);
      window.addEventListener('scroll', onScrollEngagement, { passive: true });
    } catch (error) {
      console.error('[JadeAssist] Failed to initialize widget:', error);
    }
  }

  /**
   * Polls for window.JadeWidget with exponential back-off (capped at RETRY_INTERVAL).
   */
  function waitForWidget() {
    const debug = shouldEnableDebug();

    if (typeof window.JadeWidget !== 'undefined' && typeof window.JadeWidget.init === 'function') {
      initJadeWidget();
    } else if (retryCount < MAX_RETRIES) {
      retryCount++;
      setTimeout(waitForWidget, RETRY_INTERVAL);
    } else {
      if (debug) {
        console.warn(
          '[JadeAssist] Widget failed to load after',
          MAX_RETRIES,
          'retries. Check that',
          '/assets/js/vendor/jade-widget.js is reachable.'
        );
      }
    }
  }

  /** Delays first init attempt to avoid competing with critical page resources. */
  function startInitialization() {
    setTimeout(waitForWidget, INIT_DELAY);
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startInitialization);
  } else {
    startInitialization();
  }
})();
