/**
 * JadeAssist Widget Initialization
 * Initializes the JadeAssist chat widget with EventFlow branding
 * Enhanced with UX improvements: avatar, positioning, teaser, larger hit area
 * Updated to use JadeAssist PR #10 native config API which adds support for:
 * - debug mode, offsetBottom/Left positioning, mobile positioning overrides
 */

(function () {
  'use strict';

  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // Global initialization guard - prevent double-init if script loads twice
  if (window.__JADE_WIDGET_INITIALIZED__) {
    console.warn('[JadeAssist] Widget already initialized, skipping duplicate init');
    return;
  }
  window.__JADE_WIDGET_INITIALIZED__ = true;

  // Configuration
  const MAX_RETRIES = 50; // Maximum retry attempts (5 seconds with 100ms interval)
  const RETRY_INTERVAL = 100; // Retry interval in milliseconds
  const INIT_DELAY = 2000; // Delay before initializing widget (2 seconds - prioritize page content first)
  const TEASER_DELAY = 500; // Delay before showing teaser after init (500ms)
  const TEASER_STORAGE_KEY = 'jadeassist-teaser-dismissed';
  const TEASER_EXPIRY_DAYS = 1; // Teaser dismissal persists for 1 day
  const MOBILE_BREAKPOINT = 768; // px - matches CSS media query breakpoint

  // Z-index coordination for stacking order
  const Z_INDEX = {
    WIDGET: 999, // JadeAssist widget
    TEASER: 998, // Teaser bubble (below widget)
    BACK_TO_TOP: 900, // Back-to-top button (below both)
    NOTIFICATION: 100, // Notification panel (far below)
  };

  // A/B test variants (can be toggled via localStorage for testing)
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

  // Positioning constants (now passed to widget config)
  // These values align the widget with the back-to-top button:
  // - Widget is positioned on the left (offsetLeft)
  // - Back-to-top button is positioned on the right (at same bottom offset)
  // - Both share the same baseline: 5rem desktop, 4.5rem mobile
  const DESKTOP_OFFSET_BOTTOM = '5rem';
  const DESKTOP_OFFSET_LEFT = '1.5rem';
  const MOBILE_OFFSET_BOTTOM = '4.5rem';
  const MOBILE_OFFSET_LEFT = '1rem';

  // State tracking
  let initialized = false;
  let retryCount = 0;
  let warningLogged = false;
  let teaserElement = null;

  /**
   * Get A/B test variant (default to A, or override via localStorage)
   */
  function getTeaserVariant() {
    try {
      const override = localStorage.getItem('jadeassist-teaser-variant');
      return override && TEASER_VARIANTS[override] ? override : 'A';
    } catch (e) {
      return 'A';
    }
  }

  /**
   * Check if teaser was recently dismissed
   */
  function isTeaserDismissed() {
    try {
      const dismissed = localStorage.getItem(TEASER_STORAGE_KEY);
      if (!dismissed) {
        return false;
      }

      const dismissedTime = parseInt(dismissed, 10);
      const now = Date.now();
      const expiryTime = TEASER_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

      if (now - dismissedTime > expiryTime) {
        localStorage.removeItem(TEASER_STORAGE_KEY);
        return false;
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Mark teaser as dismissed
   */
  function dismissTeaser() {
    // Clear auto-dismiss timeout if exists
    if (teaserElement && teaserElement.dataset.autoDismissTimeout) {
      clearTimeout(parseInt(teaserElement.dataset.autoDismissTimeout, 10));
    }

    try {
      localStorage.setItem(TEASER_STORAGE_KEY, Date.now().toString());
    } catch (e) {
      console.warn('Could not save teaser dismissal state');
    }

    if (teaserElement) {
      teaserElement.style.opacity = '0';
      teaserElement.style.transform = 'translateY(10px)';
      setTimeout(() => {
        if (teaserElement && teaserElement.parentNode) {
          teaserElement.parentNode.removeChild(teaserElement);
        }
        teaserElement = null;
      }, 300);
    }
  }

  /**
   * Open the chat widget
   */
  function openChat() {
    if (window.JadeWidget && typeof window.JadeWidget.open === 'function') {
      window.JadeWidget.open();

      // Track widget open
      window.dispatchEvent(
        new CustomEvent('jadeassist:widget-opened', {
          detail: { timestamp: Date.now() },
        })
      );
    }
  }

  /**
   * Create and show teaser message bubble
   */
  function showTeaser() {
    if (isTeaserDismissed()) {
      return;
    }

    // DOM singleton guard — never render a second teaser bubble
    if (document.querySelector('.jade-teaser')) {
      return;
    }

    // Get debug mode setting
    const debug = shouldEnableDebug();

    // Responsive teaser message - shorter on mobile
    const variant = getTeaserVariant();
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
    const teaserMessage = isMobile
      ? TEASER_VARIANTS[variant].mobile
      : TEASER_VARIANTS[variant].desktop;

    // Guard against empty/invalid teaser message
    if (!teaserMessage || !teaserMessage.trim()) {
      if (debug) {
        console.warn('[JadeAssist] Teaser message is empty — skipping render');
      }
      return;
    }

    // Create teaser bubble
    teaserElement = document.createElement('div');
    teaserElement.className = 'jade-teaser';
    teaserElement.setAttribute('role', 'button');
    teaserElement.setAttribute('tabindex', '0');
    teaserElement.setAttribute('aria-label', 'Open chat with Jade');
    teaserElement.innerHTML = `
      <div class="jade-teaser-content">
        <span class="jade-teaser-text">${teaserMessage}</span>
        <button class="jade-teaser-close" aria-label="Dismiss message">×</button>
      </div>
    `;

    document.body.appendChild(teaserElement);

    // Add event listeners
    const closeBtn = teaserElement.querySelector('.jade-teaser-close');

    // Click on the bubble body → open chat (close button handled separately)
    teaserElement.addEventListener('click', e => {
      if (e.target === closeBtn || closeBtn.contains(e.target)) {
        return;
      }
      // Emit custom event for analytics tracking
      window.dispatchEvent(
        new CustomEvent('jadeassist:teaser-clicked', {
          detail: { timestamp: Date.now(), source: 'teaser-bubble' },
        })
      );

      dismissTeaser();
      openChat();
    });

    teaserElement.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        dismissTeaser();
        openChat();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        dismissTeaser();
      }
    });

    closeBtn.addEventListener('click', e => {
      e.stopPropagation();

      // Track dismissal
      window.dispatchEvent(
        new CustomEvent('jadeassist:teaser-dismissed', {
          detail: { timestamp: Date.now(), method: 'close-button' },
        })
      );

      dismissTeaser();
    });

    closeBtn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.stopPropagation();
        e.preventDefault();
        dismissTeaser();
      }
    });

    // Animate in
    setTimeout(() => {
      if (teaserElement) {
        teaserElement.classList.add('jade-teaser-visible');
      }
    }, 50);

    // Auto-dismiss teaser after 15 seconds (non-intrusive timing)
    const autoDismissTimeout = setTimeout(() => {
      if (teaserElement && teaserElement.parentNode) {
        dismissTeaser();
        if (debug) {
          if (isDevelopment) {
            console.log('[JadeAssist] Teaser auto-dismissed after 15s');
          }
        }
      }
    }, 15000);

    // Store timeout ID for cleanup
    teaserElement.dataset.autoDismissTimeout = autoDismissTimeout.toString();
  }

  /**
   * Apply custom styles for teaser UX
   * Note: Widget positioning is now handled via config API, not CSS overrides
   */
  function applyCustomStyles() {
    // Check if styles already applied
    if (document.getElementById('jade-custom-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'jade-custom-styles';
    style.textContent = `
      /* Teaser bubble styles */
      .jade-teaser {
        position: fixed;
        bottom: 8rem; /* Above widget (widget at 5rem + 3rem spacing) */
        left: 1.5rem;
        max-width: 280px;
        background: #fff;
        border-radius: 16px;
        border-left: 3px solid #00B2A9;
        box-shadow: 0 8px 24px rgba(0, 178, 169, 0.18);
        padding: 0;
        z-index: ${Z_INDEX.TEASER}; /* Below widget, above back-to-top */
        opacity: 0;
        transform: translateY(10px) translateZ(0); /* GPU acceleration */
        transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                    transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); /* Bounce easing */
        cursor: pointer;
        will-change: opacity, transform; /* Performance hint for browser */
        backface-visibility: hidden;
        -webkit-font-smoothing: antialiased;
        font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      }

      .jade-teaser-visible {
        opacity: 1;
        transform: translateY(0) translateZ(0); /* Keep Z translation for GPU acceleration */
      }

      .jade-teaser:hover {
        transform: translateY(-2px) scale(1.01) translateZ(0);
        box-shadow: 0 12px 32px rgba(0, 178, 169, 0.28);
        transition: all 0.2s ease;
      }

      .jade-teaser:focus-visible {
        outline: 2px solid #00B2A9;
        outline-offset: 3px;
      }

      .jade-teaser-content {
        padding: 14px 14px 14px 12px;
        display: flex;
        align-items: flex-start;
        gap: 10px;
      }

      .jade-teaser-text {
        flex: 1;
        font-size: 13.5px;
        line-height: 1.45;
        color: #1a2332;
        font-weight: 500;
        letter-spacing: -0.01em;
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
        transition: background 0.15s ease, color 0.15s ease;
        align-self: flex-start;
        margin-top: 1px;
      }

      .jade-teaser-close:hover {
        background: rgba(0, 178, 169, 0.1);
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
        box-shadow: 2px 2px 6px rgba(0, 178, 169, 0.15);
      }

      /* Mobile adjustments for teaser */
      @media (max-width: ${MOBILE_BREAKPOINT}px) {
        .jade-teaser {
          bottom: 7.5rem; /* Above widget on mobile (widget at 4.5rem + 3rem spacing) */
          left: 0.75rem;
          max-width: min(200px, calc(100vw - 1.5rem));
          border-radius: 11px;
        }

        .jade-teaser-content {
          padding: 8px;
          gap: 6px;
        }

        .jade-teaser-text {
          font-size: 11px;
          line-height: 1.35;
        }

        /* Close button: visually tiny ✕ (10px icon) inside a 28px touch target.
           The transparent background makes it look like a bare small icon while
           still giving a comfortable tap zone on mobile. */
        .jade-teaser-close {
          width: 28px;
          height: 28px;
          min-width: 28px;
          font-size: 10px;
          padding: 0;
          border-radius: 50%;
          align-self: center;
          margin-top: 0;
          color: rgba(138, 153, 171, 0.75);
        }

        .jade-teaser-close:hover,
        .jade-teaser-close:active {
          background: rgba(0, 178, 169, 0.1);
          color: #00B2A9;
        }
      }

      /* Handle safe area insets for teaser on iOS */
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
   * Get the avatar URL, resolving relative paths for subpath deployments
   */
  function getAvatarUrl() {
    // Get the base path from the current page's base tag or use root
    const baseElement = document.querySelector('base');
    const basePath = baseElement ? baseElement.getAttribute('href') : '/';
    const avatarPath = 'assets/images/jade-avatar.png';

    // Construct the full avatar URL
    let avatarUrl;
    if (basePath === '/' || !basePath) {
      avatarUrl = `/${avatarPath}`;
    } else {
      // Remove trailing slash from basePath if present
      const cleanBasePath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
      avatarUrl = `${cleanBasePath}/${avatarPath}`;
    }

    return avatarUrl;
  }

  /**
   * Verify avatar loads correctly (for debug mode)
   */
  function verifyAvatarLoad(avatarUrl) {
    const img = new Image();
    img.onload = () => {
      if (isDevelopment) {
        console.log('[JadeAssist] Avatar loaded successfully:', avatarUrl);
      }
    };
    img.onerror = () => {
      console.warn('[JadeAssist] Avatar failed to load, widget will use default');
      // Widget has built-in fallback to emoji, this just logs the issue
    };
    img.src = avatarUrl;
  }

  /**
   * Determine if debug mode should be enabled
   * Enable debug on non-production hostnames or via query param
   *
   * Troubleshooting tip: Append ?jade-debug to the URL to enable diagnostic logs
   * in the console, including avatar loading status and widget initialization details.
   */
  function shouldEnableDebug() {
    // Check for debug query parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('jade-debug')) {
      return true;
    }

    // Enable on localhost and common dev domains
    const hostname = window.location.hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.includes('.local') ||
      hostname.includes('dev.') ||
      hostname.includes('staging.')
    );
  }

  /**
   * Initialize the JadeAssist widget with EventFlow brand colors
   */
  function initJadeWidget() {
    // Determine debug mode
    const debug = shouldEnableDebug();

    if (initialized) {
      if (debug) {
        if (isDevelopment) {
          console.log('[JadeAssist] Widget already initialized');
        }
      }
      return;
    }

    if (typeof window.JadeWidget === 'undefined' || typeof window.JadeWidget.init !== 'function') {
      if (debug || !warningLogged) {
        console.warn('[JadeAssist] Widget not yet available, will retry...');
        warningLogged = true;
      }
      return;
    }

    try {
      // Apply custom styles for teaser
      applyCustomStyles();

      // Get avatar URL with subpath support
      const avatarUrl = getAvatarUrl();

      // Verify avatar loads in debug mode
      if (debug) {
        verifyAvatarLoad(avatarUrl);
      }

      // Initialize with configuration using new API
      window.JadeWidget.init({
        // Brand colors
        primaryColor: '#00B2A9',
        accentColor: '#008C85',

        // Assistant configuration
        assistantName: 'Jade',
        greetingText: "Hi! I'm Jade. Ready to plan your event?",
        greetingTooltipText: '', // Disable built-in tooltip - using custom EventFlow teaser instead

        // Avatar (supported by JadeAssist PR #10 API)
        // Points to /assets/images/jade-avatar.png
        avatarUrl: avatarUrl,

        // Desktop positioning (supported by JadeAssist PR #10 API)
        // Aligns with back-to-top button on opposite side (both at bottom: 5rem)
        offsetBottom: DESKTOP_OFFSET_BOTTOM,
        offsetLeft: DESKTOP_OFFSET_LEFT,

        // Mobile positioning (supported by JadeAssist PR #10 API)
        // Aligns with back-to-top button on opposite side (both at bottom: 4.5rem)
        offsetBottomMobile: MOBILE_OFFSET_BOTTOM,
        offsetLeftMobile: MOBILE_OFFSET_LEFT,

        // Size and debug
        scale: 0.85, // 15% smaller for better mobile UX
        debug: debug, // Enable diagnostic logs on dev environments or with ?jade-debug
      });

      initialized = true;
      if (debug) {
        if (isDevelopment) {
          console.log('[JadeAssist] Widget initialized successfully');
        }
      }

      // Ensure chat is closed on initialization (defensive)
      setTimeout(() => {
        if (window.JadeWidget && typeof window.JadeWidget.close === 'function') {
          window.JadeWidget.close();
          if (debug) {
            if (isDevelopment) {
              console.log('[JadeAssist] Chat ensured closed on load');
            }
          }
        }
      }, 100);

      // Show teaser after delay OR on scroll engagement (whichever comes first)
      // eslint-disable-next-line prefer-const
      let teaserDelayTimeout;

      // Show teaser based on user engagement (scroll depth)
      const showTeaserOnEngagement = () => {
        const scrollDepth =
          (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;

        // Show teaser after user scrolls 25% down page (engagement signal)
        if (scrollDepth > 25) {
          clearTimeout(teaserDelayTimeout);
          showTeaser();
          window.removeEventListener('scroll', showTeaserOnEngagement);

          if (debug) {
            if (isDevelopment) {
              console.log('[JadeAssist] Teaser shown after 25% scroll');
            }
          }
        }
      };

      teaserDelayTimeout = setTimeout(() => {
        showTeaser();
        window.removeEventListener('scroll', showTeaserOnEngagement);
        if (debug) {
          if (isDevelopment) {
            console.log('[JadeAssist] Teaser shown after delay');
          }
        }
      }, TEASER_DELAY);

      // Listen for scroll engagement
      window.addEventListener('scroll', showTeaserOnEngagement, { passive: true });
    } catch (error) {
      console.error('[JadeAssist] Failed to initialize widget:', error);
    }
  }

  /**
   * Wait for the widget script to load and then initialize
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
        console.warn('[JadeAssist] Widget failed to load after maximum retries');
      }
    }
  }

  /**
   * Start initialization with delay
   */
  function startInitialization() {
    // Delay initialization by 2 seconds to prioritize page content
    setTimeout(waitForWidget, INIT_DELAY);
  }

  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startInitialization);
  } else {
    startInitialization();
  }
})();
