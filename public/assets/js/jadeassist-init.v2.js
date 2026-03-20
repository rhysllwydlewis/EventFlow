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
  const MAX_RETRIES = 50; // Maximum retry attempts (5 seconds with 100ms interval)
  const RETRY_INTERVAL = 100; // Retry interval in milliseconds
  const INIT_DELAY = 2000; // Delay before init attempt (ms) — prioritize page content first
  const TEASER_DELAY = 500; // Delay before showing teaser after init (ms)
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
  }

  /** Opens the chat panel and emits an analytics event. */
  function openChat() {
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
        box-shadow: 0 8px 24px rgba(0,0,0,.15);
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
      }

      .jade-teaser-visible {
        opacity: 1;
        transform: translateY(0) translateZ(0);
      }

      .jade-teaser:hover {
        transform: translateY(-2px) scale(1.01) translateZ(0);
        box-shadow: 0 12px 32px rgba(0,0,0,.2);
        transition: all .2s ease;
      }

      /* Visible focus ring for keyboard navigation */
      .jade-teaser:focus-visible {
        outline: 2px solid #00B2A9;
        outline-offset: 3px;
      }

      .jade-teaser-content {
        padding: 16px;
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }

      .jade-teaser-text {
        flex: 1;
        font-size: 14px;
        line-height: 1.4;
        color: #0B1220;
        font-weight: 500;
      }

      .jade-teaser-close {
        flex-shrink: 0;
        background: none;
        border: none;
        font-size: 20px;
        line-height: 1;
        color: #667085;
        cursor: pointer;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background .2s ease, color .2s ease;
      }

      .jade-teaser-close:hover {
        background: #F3F4F6;
        color: #0B1220;
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
        box-shadow: 2px 2px 4px rgba(0,0,0,.1);
      }

      /* Mobile adjustments */
      @media (max-width: ${MOBILE_BREAKPOINT}px) {
        .jade-teaser {
          bottom: 7.5rem; /* widget (4.5rem) + 3rem gap */
          left: 1rem;
          max-width: calc(100vw - 2rem);
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
   * Auto-dismisses after 15 s.
   */
  function showTeaser() {
    if (isTeaserDismissed()) {
      return;
    }

    const debug = shouldEnableDebug();
    const variant = getTeaserVariant();
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
    const message = isMobile ? TEASER_VARIANTS[variant].mobile : TEASER_VARIANTS[variant].desktop;

    teaserElement = document.createElement('div');
    teaserElement.className = 'jade-teaser';
    teaserElement.setAttribute('role', 'button');
    teaserElement.setAttribute('tabindex', '0');
    teaserElement.setAttribute('aria-label', 'Open chat with Jade');
    teaserElement.innerHTML = `
      <div class="jade-teaser-content">
        <span class="jade-teaser-text">${message}</span>
        <button class="jade-teaser-close" aria-label="Dismiss message">×</button>
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

    // Auto-dismiss after 15 s
    const autoDismissTimeoutId = setTimeout(() => {
      if (teaserElement && teaserElement.parentNode) {
        window.dispatchEvent(
          new CustomEvent('jadeassist:teaser-dismissed', {
            detail: { timestamp: Date.now(), method: 'auto-dismiss' },
          })
        );
        dismissTeaser();
        if (debug) {
          console.log('[JadeAssist] Teaser auto-dismissed after 15 s');
        }
      }
    }, 15000);

    teaserElement.dataset.autoDismissTimeout = autoDismissTimeoutId.toString();

    if (debug) {
      console.log('[JadeAssist] Teaser shown — variant:', variant, '| mobile:', isMobile);
    }
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

      if (debug) {
        verifyAvatarLoad(avatarUrl);
        console.log('[JadeAssist] Init config:', {
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
