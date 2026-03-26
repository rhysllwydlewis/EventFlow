/**
 * Homepage initialization script
 * Handles featured packages, stats counters, notifications, and interactive elements
 */

// Set page identifier
window.__EF_PAGE__ = 'home';

// Video performance metrics tracker
window.__videoMetrics__ = {
  heroVideoAttempts: 0,
  heroVideoSuccesses: 0,
  heroVideoFailures: 0,
  collageVideoAttempts: 0,
  collageVideoSuccesses: 0,
  collageVideoFailures: 0,
  lastError: null,
};

// Helper function to calculate success rate
function calculateSuccessRate(successes, attempts) {
  if (attempts === 0) {
    return 0;
  }
  return ((successes / attempts) * 100).toFixed(1);
}

// Helper function to log video metrics (useful for debugging)
window.logVideoMetrics = function () {
  console.group('📊 Video Performance Metrics');
  console.log('Hero Video:');
  console.log(`  Attempts: ${window.__videoMetrics__.heroVideoAttempts}`);
  console.log(`  Successes: ${window.__videoMetrics__.heroVideoSuccesses}`);
  console.log(`  Failures: ${window.__videoMetrics__.heroVideoFailures}`);
  console.log(
    `  Success Rate: ${calculateSuccessRate(window.__videoMetrics__.heroVideoSuccesses, window.__videoMetrics__.heroVideoAttempts)}%`
  );
  console.log('');
  console.log('Collage Videos:');
  console.log(`  Attempts: ${window.__videoMetrics__.collageVideoAttempts}`);
  console.log(`  Successes: ${window.__videoMetrics__.collageVideoSuccesses}`);
  console.log(`  Failures: ${window.__videoMetrics__.collageVideoFailures}`);
  console.log(
    `  Success Rate: ${calculateSuccessRate(window.__videoMetrics__.collageVideoSuccesses, window.__videoMetrics__.collageVideoAttempts)}%`
  );
  if (window.__videoMetrics__.lastError) {
    console.log('');
    console.log(`⚠️  Last Error: ${window.__videoMetrics__.lastError}`);
  }
  console.groupEnd();
};

/**
 * Detect user's connection speed for adaptive video quality
 * @returns {string} 'slow', 'medium', or 'fast'
 */
function detectConnectionSpeed() {
  // Check for Network Information API support
  if ('connection' in navigator && navigator.connection) {
    const connection = navigator.connection;
    const effectiveType = connection.effectiveType;

    // Map connection types to quality levels
    if (effectiveType === '4g') {
      return 'fast';
    } else if (effectiveType === '3g') {
      return 'medium';
    } else {
      return 'slow';
    }
  }

  // Default to medium quality if API not available
  return 'medium';
}

/**
 * Check if debug logging is enabled
 * Checks:
 * 1. Explicit window.DEBUG flag
 * 2. URL param ?debug=1, ?debug=true, ?debug=yes, or ?debug (case-insensitive)
 * 3. Development environment
 * @returns {boolean} True if debug logging should be enabled
 */
function isDebugEnabled() {
  // Check window.DEBUG first
  if (window.DEBUG) {
    return true;
  }

  // Check URL parameters for debug mode
  const urlParams = new URLSearchParams(window.location.search);
  const debugParam = urlParams.get('debug');
  if (debugParam !== null) {
    // Allow: ?debug, ?debug=1, ?debug=true, ?debug=yes (case-insensitive)
    const debugValue = debugParam.toLowerCase();
    if (debugValue === '' || debugValue === '1' || debugValue === 'true' || debugValue === 'yes') {
      return true;
    }
  }

  // Debug mode requires an explicit flag — do NOT auto-enable on localhost
  // to avoid debug panels appearing for all developers by default.
  return false;
}

// Log collage script load in debug mode only
if (isDebugEnabled()) {
  console.log('[Collage Debug] collage script loaded');
}

// Log connection speed in debug mode
if (isDebugEnabled()) {
  const speed = detectConnectionSpeed();
  console.log(`[Video Quality] Detected connection speed: ${speed}`);
  if ('connection' in navigator && navigator.connection) {
    console.log(`[Video Quality] Effective type: ${navigator.connection.effectiveType}`);
  }
}

// Initialize homepage components on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Initialize category grid
  if (typeof CategoryGrid !== 'undefined') {
    const categoryGrid = new CategoryGrid('category-grid-home');
    categoryGrid.loadCategories();
  }

  // Hide version label unless debug mode is enabled
  const versionContainer = document.querySelector('.version');
  if (versionContainer) {
    if (!isDebugEnabled()) {
      versionContainer.style.display = 'none';
    } else {
      // If debug mode, show version
      const versionLabel = document.getElementById('ef-version-label');
      if (versionLabel) {
        versionLabel.textContent = 'v18.0.2';
      }
    }
  }

  // Show video metrics panel in debug mode
  if (isDebugEnabled()) {
    // Create metrics panel
    const metricsPanel = document.createElement('div');
    metricsPanel.id = 'video-metrics-panel';
    metricsPanel.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(15, 23, 42, 0.95);
      color: white;
      padding: 15px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      z-index: 10000;
      max-width: 300px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
    `;
    metricsPanel.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 8px; color: #10b981;">📊 Video Metrics</div>
      <div id="metrics-content">Loading...</div>
      <div style="margin-top: 8px; font-size: 10px; opacity: 0.7;">
        Updates every 2s • <a href="#" id="metrics-log-link" style="color: #10b981;">Log to Console</a>
      </div>
    `;
    document.body.appendChild(metricsPanel);

    // Add event listener for log link (avoid inline onclick)
    const logLink = document.getElementById('metrics-log-link');
    if (logLink) {
      logLink.addEventListener('click', e => {
        e.preventDefault();
        window.logVideoMetrics();
      });
    }

    // Update metrics every 2 seconds
    const updateMetrics = () => {
      const m = window.__videoMetrics__;
      const heroRate = calculateSuccessRate(m.heroVideoSuccesses, m.heroVideoAttempts);
      const collageRate = calculateSuccessRate(m.collageVideoSuccesses, m.collageVideoAttempts);

      const content = document.getElementById('metrics-content');
      if (content) {
        content.innerHTML = `
          <div style="margin-bottom: 5px;">
            <strong>Hero:</strong> ${m.heroVideoSuccesses}/${m.heroVideoAttempts} (${heroRate}%)
          </div>
          <div style="margin-bottom: 5px;">
            <strong>Collage:</strong> ${m.collageVideoSuccesses}/${m.collageVideoAttempts} (${collageRate}%)
          </div>
          ${m.lastError ? `<div style="color: #ef4444; margin-top: 5px; font-size: 10px;">⚠️ ${m.lastError}</div>` : ''}
        `;
      }
    };

    // Initial update
    setTimeout(updateMetrics, 1000);
    // Update every 2 seconds
    setInterval(updateMetrics, 2000);
  }

  // Load and update hero collage images from admin-uploaded category photos
  loadHeroCollageImages();

  // Load featured packages
  loadPackagesCarousel({
    endpoint: '/api/packages/featured',
    containerId: 'featured-packages',
    emptyMessage: 'No featured packages available yet.',
  });

  // Load spotlight packages
  loadPackagesCarousel({
    endpoint: '/api/packages/spotlight',
    containerId: 'spotlight-packages',
    emptyMessage: 'No spotlight packages available yet.',
  });

  // Show notification bell for logged-in users using AuthStateManager
  const authState = window.__authState || window.AuthStateManager;
  if (authState) {
    // Subscribe to auth state changes
    authState.onchange(user => {
      // Support both old and new notification bell IDs
      const notificationBell =
        document.getElementById('ef-notification-btn') ||
        document.getElementById('notification-bell');
      if (notificationBell) {
        notificationBell.style.display = user ? 'block' : 'none';
      }

      // Initialize WebSocket connection for real-time notifications (only when logged in)
      if (user && typeof WebSocketClient !== 'undefined') {
        // WebSocket client is initialized here for real-time notification updates
        const _wsClient = new WebSocketClient({
          onNotification: _notification => {
            // Update notification badge
            const badge = document.querySelector('.notification-badge');
            if (badge) {
              badge.style.display = 'block';
              const current = parseInt(badge.textContent) || 0;
              badge.textContent = current + 1;
            }
          },
        });
        // Store reference if needed for cleanup
        window.__notificationWsClient = _wsClient;
      }
    });
  }

  // Fetch and render public stats
  fetchPublicStats();

  // Fetch and render marketplace preview
  fetchMarketplacePreview();

  // Fetch and render guides
  fetchGuides();

  // Fetch and render testimonials
  fetchTestimonials();

  // Hero search is now handled by ef-search-bar.js
  // initHeroSearch(); // Removed - old search component

  // Initialize newsletter form
  initNewsletterForm();

  // Attach error handlers for hero collage media (CSP-safe replacement for inline onerror)
  initCollageErrorHandlers();

  // Cookie preferences button is wired automatically via data-cookie-prefs attribute
  // by cookie-consent.js's bindPrefsButtons() — no manual handler needed here.

  // Add parallax effect to collage
  initParallaxCollage();

  // Animate stat counters when they come into view (only if Counter and IntersectionObserver are available)
  if (typeof Counter === 'function' && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !entry.target.dataset.counted) {
            const target = parseInt(entry.target.dataset.counter);
            if (target > 0) {
              entry.target.dataset.counted = 'true';
              const counter = new Counter(entry.target, {
                target: target,
                duration: 2000,
                suffix: entry.target.dataset.suffix || '',
              });
              counter.animate();
            }
          }
        });
      },
      { threshold: 0.5 }
    );

    document.querySelectorAll('[data-counter]').forEach(el => {
      observer.observe(el);
    });
  }

  // Add ripple effect to CTA buttons (only if createRipple is available)
  if (typeof createRipple === 'function') {
    document.querySelectorAll('.cta').forEach(button => {
      if (!button.classList.contains('ripple-container')) {
        button.addEventListener('click', createRipple);
      }
    });
  }

  // Cleanup Pexels collage on page unload to prevent memory leaks
  window.addEventListener('beforeunload', () => {
    if (typeof cleanupPexelsCollage === 'function') {
      cleanupPexelsCollage();
    }
  });

  // Defensive fallback: Re-invoke collage initialization if it hasn't started
  // This handles cases where the initial DOMContentLoaded call returned early
  // or was skipped. The loadHeroCollageImages function is idempotent and will
  // guard against double initialization via window.__collageWidgetInitialized
  setTimeout(() => {
    if (!window.__collageWidgetInitialized) {
      if (isDebugEnabled()) {
        console.log('[Collage Debug] Initial load did not initialize, retrying...');
      }
      loadHeroCollageImages();
    }
  }, 1000);
});

// Window load fallback: Retry collage initialization if it hasn't started by window load
// This handles edge cases where DOMContentLoaded fired but collage failed to initialize
// due to timing issues, script loading delays, or API failures
window.addEventListener('load', () => {
  if (!window.__collageWidgetInitialized) {
    if (isDebugEnabled()) {
      console.log('[Collage Debug] load fallback retrying...');
    }
    loadHeroCollageImages();
  }
});

// Network status listener: Retry collage initialization when coming back online
// This handles cases where the initial load happened while offline
window.addEventListener('online', () => {
  if (isDebugEnabled()) {
    console.log('[Collage Debug] Browser came online, checking if collage needs initialization...');
  }
  // Only retry if collage is not initialized yet
  if (!window.__collageWidgetInitialized) {
    if (isDebugEnabled()) {
      console.log('[Collage Debug] Retrying initialization after coming online...');
    }
    setTimeout(() => {
      loadHeroCollageImages();
    }, 500); // Small delay to ensure connection is stable
  }
});

// Network status listener: Log when going offline (for debugging)
window.addEventListener('offline', () => {
  if (isDebugEnabled()) {
    console.log('[Collage Debug] Browser went offline, collage updates will pause');
  }
});

/**
 * Shared helper to load packages carousel with skeleton, timeout, and retry
 * @param {Object} options - Configuration options
 * @param {string} options.endpoint - API endpoint to fetch packages from
 * @param {string} options.containerId - DOM container ID for carousel
 * @param {string} options.emptyMessage - Message to show when no packages found
 */
async function loadPackagesCarousel({ endpoint, containerId, emptyMessage }) {
  const container = document.getElementById(containerId);
  if (!container) {
    if (isDevelopmentEnvironment()) {
      console.warn(`Container ${containerId} not found`);
    }
    return;
  }

  // Issue 5 & 6 Fix: Use error boundary and loading state
  const errorBoundary = new ErrorBoundary(containerId, {
    title: 'Could not load packages',
    message: 'Please refresh the page to try again.',
    showRetry: true,
    retryCallback: () => loadPackagesCarousel({ endpoint, containerId, emptyMessage }),
  });

  // Show loading skeleton
  LoadingState.show(containerId, 'card', 3);

  try {
    // Issue 7 Fix: Use fetch with retry
    const response = await fetchWithRetry(endpoint, {}, 3, 1000);

    if (!response.ok) {
      // Silently handle 404s (endpoint not available in static/dev mode)
      if (response.status === 404) {
        LoadingState.hide(containerId);
        container.innerHTML = `<p class="small">${emptyMessage}</p>`;
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    LoadingState.hide(containerId);

    if (!data.items || data.items.length === 0) {
      // Enhanced empty state with call-to-action
      container.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 3rem;">
          <h3 style="margin-bottom: 1rem; color: #344054;">Featured packages coming soon!</h3>
          <p style="margin-bottom: 1.5rem; color: #667085;">Check back later for curated event packages.</p>
          <a href="/marketplace" class="cta" style="display: inline-block; text-decoration: none;">Browse All Packages</a>
        </div>
      `;
      return;
    }

    // Check if Carousel class is available
    if (typeof Carousel === 'undefined') {
      if (isDevelopmentEnvironment()) {
        console.error('Carousel class not loaded. Rendering fallback.');
      }
      renderPackageFallback(container, data.items);
      return;
    }

    // Initialize carousel
    try {
      const carousel = new Carousel(containerId, {
        itemsPerView: 3,
        itemsPerViewTablet: 2,
        itemsPerViewMobile: 1,
        autoScroll: true,
        autoScrollInterval: 5000,
      });
      carousel.setItems(data.items);
    } catch (error) {
      if (isDevelopmentEnvironment()) {
        console.error('Failed to initialize carousel:', error);
      }
      renderPackageFallback(container, data.items);
    }
  } catch (error) {
    // Issue 5 Fix: Use error boundary for errors
    if (isDevelopmentEnvironment()) {
      console.error(`Failed to load packages from ${endpoint}:`, error);
    }
    errorBoundary.show(error);
  }
}

/**
 * Render packages in fallback grid format (when Carousel is unavailable)
 * @param {HTMLElement} container - Container element
 * @param {Array} items - Package items to render
 */
function renderPackageFallback(container, items) {
  // Helper to safely escape HTML
  const escape = text => {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  };

  // Validate and sanitize URLs to prevent XSS
  const sanitizeUrl = url => {
    if (!url) {
      return '/assets/images/placeholders/package-event.svg';
    }
    const urlStr = String(url).trim();
    if (!urlStr) {
      return '/assets/images/placeholders/package-event.svg';
    }
    // Block dangerous protocols to prevent XSS.
    // NOTE: do NOT call escape() here — it percent-encodes the colon in "https:"
    // turning "https://cdn.example.com/photo.jpg" into "https%3A//cdn.example.com/photo.jpg"
    // which the browser cannot load, causing every absolute-URL image to fall back to
    // the placeholder (the root cause of the "always shows placeholder" bug).
    if (/^(javascript|data|vbscript|file):/i.test(urlStr)) {
      return '/assets/images/placeholders/package-event.svg';
    }
    // Safe for use in <img src>: protocol validated above, no further encoding needed.
    return urlStr;
  };

  // Validate slug for URL safety
  const validateSlug = (value, fallbackId) => {
    const slugStr = String(value || '');
    // Only allow alphanumeric, hyphens, and underscores
    const cleaned = slugStr.replace(/[^a-zA-Z0-9_-]/g, '');
    // Fall back to provided id if slug becomes empty after cleaning
    return cleaned || String(fallbackId || 'unknown');
  };

  // Format price with £ symbol if it's a number
  const formatPrice = priceDisplay => {
    if (!priceDisplay) {
      return null; // Signal "not set" so the caller can emit a styled placeholder
    }
    const priceStr = String(priceDisplay);
    // If it's a plain number (integer or decimal), format as £X
    if (/^\d+(\.\d+)?$/.test(priceStr)) {
      return `£${priceStr}`;
    }
    // Otherwise return as-is
    return priceStr;
  };

  // Use escapeHtml (defined in app.js) for safe HTML text content.
  // Using the native escape() would URL-encode the strings (e.g. "&" → "%26"),
  // producing garbled visible text and incorrect alt attributes.
  // Define once before the map() to avoid recreating the function per-item.
  const _esc =
    typeof escapeHtml === 'function'
      ? escapeHtml
      : s =>
          String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

  container.innerHTML = items
    .map(item => {
      const title = _esc(item.title || 'Untitled Package');
      const supplierName = _esc(item.supplier_name || '');
      const description = _esc(item.description || '');
      const truncDesc =
        description.length > 100 ? `${description.substring(0, 100)}...` : description;
      const rawPrice = formatPrice(item.price_display || item.price);
      const price = rawPrice
        ? _esc(rawPrice)
        : '<span class="price-not-set">Price not set</span>';
      // Resolve the best available image via the shared utility when loaded,
      // otherwise fall back to the same inline strategy for resilience.
      const resolvedImage =
        typeof resolvePackageImage === 'function'
          ? resolvePackageImage(item)
          : (() => {
              const placeholder = '/assets/images/placeholders/package-event.svg';
              if (item.image && item.image !== placeholder) {
                return item.image;
              }
              if (Array.isArray(item.gallery) && item.gallery.length > 0) {
                for (const img of item.gallery) {
                  const url =
                    typeof img === 'string'
                      ? img
                      : img.url ||
                        img.src ||
                        img.path ||
                        img.image ||
                        img.originalUrl ||
                        img.thumbnail;
                  if (url && url !== placeholder) {
                    return url;
                  }
                }
              }
              return placeholder;
            })();
      const imgSrc = sanitizeUrl(resolvedImage);
      // Emit debug info when debug mode is active (?debugImages=1 or localStorage)
      if (typeof debugPackageImage === 'function') {
        debugPackageImage(item, imgSrc);
      }
      const slug = encodeURIComponent(validateSlug(item.slug, item.id));

      return `
        <div class="card featured-fallback-card">
          <a href="/package?slug=${slug}" class="featured-fallback-link">
            <img src="${imgSrc}" alt="${title}" class="featured-fallback-img"
                 data-fallback-src="/assets/images/placeholders/package-event.svg">
            <div class="featured-fallback-content">
              <h3 class="featured-fallback-title">${title}</h3>
              ${supplierName ? `<p class="featured-fallback-supplier">${supplierName}</p>` : ''}
              <p class="featured-fallback-desc">${truncDesc}</p>
              <div class="featured-fallback-price">${price}</div>
            </div>
          </a>
        </div>
      `;
    })
    .join('');
}

/**
 * Detect if running in a development environment
 * @returns {boolean} true if hostname matches common development patterns, false otherwise
 *
 * Development environments include:
 * - localhost and loopback addresses (127.0.0.1, ::1)
 * - mDNS .local domains
 * - Private IP ranges (10.x, 172.16-31.x, 192.168.x)
 * - Link-local addresses (169.254.x)
 */
function isDevelopmentEnvironment() {
  const hostname = window.location.hostname;

  // Quick checks for common cases
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local')
  ) {
    return true;
  }

  // Private IP ranges
  if (hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
    return true;
  }

  // 172.16.0.0/12 range (172.16.x.x to 172.31.x.x)
  const PRIVATE_172_RANGE_START = 16;
  const PRIVATE_172_RANGE_END = 31;
  if (hostname.startsWith('172.')) {
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      const secondOctet = parseInt(parts[1], 10);
      if (secondOctet >= PRIVATE_172_RANGE_START && secondOctet <= PRIVATE_172_RANGE_END) {
        return true;
      }
    }
  }

  // Link-local address range
  if (hostname.startsWith('169.254.')) {
    return true;
  }

  return false;
}

/* ============================================
   RESPONSIVE IMAGE OPTIMIZATION FUNCTIONS
   ============================================ */

/**
 * Detect WebP support
 * @returns {Promise<boolean>} True if browser supports WebP
 * Note: Currently unused but kept for potential future image optimization
 */
// eslint-disable-next-line no-unused-vars
async function supportsWebP() {
  if (window.__webpSupported !== undefined) {
    return window.__webpSupported;
  }

  return new Promise(resolve => {
    const webp = new Image();
    webp.onload = webp.onerror = () => {
      window.__webpSupported = webp.height === 2;
      resolve(window.__webpSupported);
    };
    webp.src =
      'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA';
  });
}

/**
 * Get network-aware quality setting
 * Reduces image quality on slow connections
 * @returns {string} Quality setting: 'high', 'medium', or 'low'
 */
function getConnectionAwareQuality() {
  // Check for Save-Data header preference
  if (navigator.connection && navigator.connection.saveData === true) {
    return 'low';
  }

  // Check Network Information API
  if (navigator.connection && navigator.connection.effectiveType) {
    const effectiveType = navigator.connection.effectiveType;
    if (effectiveType === '2g' || effectiveType === 'slow-2g') {
      return 'low';
    }
    if (effectiveType === '3g') {
      return 'medium';
    }
  }

  return 'high';
}

/**
 * Get optimal Pexels image size based on viewport and device pixel ratio
 * @param {Object} photoSrc - Pexels photo.src object
 * @returns {string} Optimal image URL
 */
function getOptimalPexelsImageSize(photoSrc) {
  if (!photoSrc) {
    return null;
  }

  const dpr = window.devicePixelRatio || 1;
  const viewportWidth = window.innerWidth;

  // Calculate effective width needed (accounting for DPR)
  // Collage frames are typically 40-50% of viewport width on mobile
  const frameWidth = viewportWidth <= 768 ? viewportWidth * 0.48 : viewportWidth * 0.25;
  const effectiveWidth = frameWidth * dpr;

  // Network-aware quality adjustment
  const quality = getConnectionAwareQuality();

  // Size mapping (Pexels standard sizes)
  // tiny: 280px, small: 340px, medium: 940px, large: 1880px, large2x: 3760px

  if (quality === 'low') {
    // Force small size on slow connections
    return photoSrc.small || photoSrc.tiny || photoSrc.medium;
  }

  if (effectiveWidth <= 280) {
    return photoSrc.tiny || photoSrc.small;
  } else if (effectiveWidth <= 340) {
    return photoSrc.small || photoSrc.medium;
  } else if (effectiveWidth <= 940) {
    return photoSrc.medium || photoSrc.large;
  } else if (effectiveWidth <= 1880) {
    return photoSrc.large || photoSrc.original;
  } else {
    // High-DPI large screens
    return photoSrc.large2x || photoSrc.original || photoSrc.large;
  }
}

/**
 * Generate srcset string for responsive images
 * @param {Object} photoSrc - Pexels photo.src object
 * @returns {string} srcset attribute value
 */
function generateSrcset(photoSrc) {
  if (!photoSrc) {
    return '';
  }

  const sources = [];

  if (photoSrc.tiny) {
    sources.push(`${photoSrc.tiny} 280w`);
  }
  if (photoSrc.small) {
    sources.push(`${photoSrc.small} 340w`);
  }
  if (photoSrc.medium) {
    sources.push(`${photoSrc.medium} 940w`);
  }
  if (photoSrc.large) {
    sources.push(`${photoSrc.large} 1880w`);
  }
  if (photoSrc.large2x) {
    sources.push(`${photoSrc.large2x} 3760w`);
  }

  return sources.join(', ');
}

/**
 * Setup ResizeObserver for collage to update image quality on viewport changes
 * Handles device rotation and window resizing
 */
function setupCollageResizeOptimization() {
  if (!('ResizeObserver' in window)) {
    if (isDebugEnabled()) {
      console.log('[Collage] ResizeObserver not supported');
    }
    return null;
  }

  const collageElement = document.querySelector('.hero-collage');
  if (!collageElement) {
    return null;
  }

  let resizeTimeout;
  const observer = new ResizeObserver(() => {
    // Debounce to avoid excessive updates
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (isDebugEnabled()) {
        console.log('[Collage] Viewport resized, could refresh images for new size');
      }
      // Note: Actual refresh would require re-fetching with new size
      // This is a placeholder for the optimization hook
    }, 500);
  });

  observer.observe(collageElement);
  return observer;
}

/**
 * Setup IntersectionObserver for lazy loading below-fold images
 * Preloads images as they approach the viewport
 */
function setupLazyLoadingForCollage() {
  if (!('IntersectionObserver' in window)) {
    if (isDebugEnabled()) {
      console.log('[Collage] IntersectionObserver not supported');
    }
    return null;
  }

  const collageCards = document.querySelectorAll('.hero-collage-card');
  if (collageCards.length === 0) {
    return null;
  }

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target.querySelector('img');
          if (img && img.dataset.src) {
            // Preload when entering viewport
            img.src = img.dataset.src;
            delete img.dataset.src;
            if (isDebugEnabled()) {
              console.log('[Collage] Lazy loaded image:', img.alt);
            }
          }
          observer.unobserve(entry.target);
        }
      });
    },
    {
      rootMargin: '50px', // Preload 50px before entering viewport
    }
  );

  collageCards.forEach(card => observer.observe(card));
  return observer;
}

async function loadHeroCollageImages() {
  // Check if collage widget is enabled via /api/public/homepage-settings endpoint
  // Guard against double initialization
  if (window.__collageWidgetInitialized) {
    if (isDebugEnabled()) {
      console.log('[Collage Debug] Already initialized, skipping');
    }
    return;
  }

  // Check if online (skip API calls if offline)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (isDebugEnabled()) {
      console.log('[Collage Debug] Browser is offline, using default images');
    }
    // Default images already loaded in HTML will be used
    return;
  }

  // Issue 4 Fix: Add loading state immediately with opacity transition
  const collageFrames = document.querySelectorAll('.hero-collage-card');
  collageFrames.forEach(frame => {
    frame.classList.add('collage-loading');
    frame.style.transition = 'opacity 0.3s ease';
  });

  const clearCollageLoadingState = () => {
    collageFrames.forEach(frame => {
      frame.classList.remove('collage-loading');
      frame.classList.add('collage-loaded');
    });
  };

  try {
    // Add AbortController with 5 second timeout (increased from 2s for slower connections)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    if (isDebugEnabled()) {
      console.log('[Collage Debug] Fetching homepage settings...');
    }

    const settingsResponse = await fetch('/api/v1/public/homepage-settings', {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (settingsResponse?.ok) {
      const settings = await settingsResponse.json();

      // Check new collageWidget format first, fallback to legacy pexelsCollageEnabled
      const collageWidget = settings.collageWidget;
      const legacyEnabled = settings.pexelsCollageEnabled === true;

      // Debug logging to help diagnose issues
      if (isDebugEnabled()) {
        console.log('[Collage Debug] Settings received:', {
          collageWidgetEnabled: collageWidget?.enabled,
          legacyEnabled: legacyEnabled,
          source: collageWidget?.source,
          hasQueries: !!collageWidget?.pexelsQueries,
          hasUploadGallery: !!collageWidget?.uploadGallery?.length,
        });
      }

      // Determine if collage should be enabled (matches backend logic)
      // If collageWidget.enabled is explicitly set, use it; otherwise use legacy flag
      const collageEnabled =
        collageWidget?.enabled !== undefined ? collageWidget.enabled : legacyEnabled;

      // Validate JSON structure - check if collage is enabled
      if (settings && typeof settings === 'object' && collageEnabled === true) {
        if (isDebugEnabled()) {
          console.log('[Collage Debug] Collage widget enabled, initializing dynamic collage');
        }
        window.__collageWidgetInitialized = true;

        // Initialize collage with new widget format or legacy format
        // Use collageWidget if it's explicitly enabled, otherwise use legacy
        if (collageWidget?.enabled === true) {
          if (isDebugEnabled()) {
            console.log('[Collage Debug] Using new collageWidget format');
          }
          await initCollageWidget(collageWidget);
        } else {
          // Legacy Pexels format
          if (isDebugEnabled()) {
            console.log('[Collage Debug] Using legacy Pexels format', {
              hasSettings: !!settings.pexelsCollageSettings,
              queries: settings.pexelsCollageSettings?.queries,
              intervalSeconds: settings.pexelsCollageSettings?.intervalSeconds,
              hasUploadGallery: !!collageWidget?.uploadGallery?.length,
            });
          }
          // Merge legacy settings with uploadGallery from collageWidget
          const legacySettings = {
            ...settings.pexelsCollageSettings,
            uploadGallery: collageWidget?.uploadGallery || [],
          };
          await initPexelsCollage(legacySettings);
        }
        clearCollageLoadingState();
        return; // Skip static image loading
      } else {
        if (isDebugEnabled()) {
          console.log('[Collage Debug] Collage widget disabled in settings, using static images');
        }
      }
    } else {
      if (isDebugEnabled()) {
        console.log(
          `[Collage Debug] Settings API returned ${settingsResponse?.status}, using static images`
        );
      }
    }
  } catch (error) {
    // Fall back to static images on error, timeout, or invalid JSON
    // Enhanced error logging in debug mode
    if (isDebugEnabled()) {
      if (error.name === 'AbortError') {
        console.log('[Collage Debug] Settings API timeout (5s), falling back to static images');
      } else {
        console.log(
          '[Collage Debug] Settings API error, falling back to static images:',
          error.message
        );
      }
    }

    // Issue 4 Fix: Remove loading state on error
    collageFrames.forEach(frame => {
      frame.classList.remove('collage-loading');
    });
  }

  // Issue 4 Fix: Remove loading state and add loaded class on success
  clearCollageLoadingState();

  // If collage widget is not enabled or failed, default images will remain
}

/**
 * Initialize Pexels dynamic collage
 * Fetches images from Pexels API and cycles them with crossfade transitions
 */

// Crossfade transition duration (must match CSS transition in index.html)
const PEXELS_TRANSITION_DURATION_MS = 400;
// Preload timeout to prevent hanging
const PEXELS_PRELOAD_TIMEOUT_MS = 5000;
// Delay before restoring transition after instant hide (allows time for reflow)
const TRANSITION_RESTORE_DELAY_MS = 50;
// Watchdog check interval (2 minutes)
const WATCHDOG_CHECK_INTERVAL_MS = 120000;
// Watchdog tolerance multiplier for detecting stalled intervals
const WATCHDOG_TOLERANCE_MULTIPLIER = 2;
// Number of positions to skip ahead when recovering from image load errors
const ERROR_RECOVERY_SKIP_COUNT = 2;

// Store interval ID for cleanup
let pexelsCollageIntervalId = null;

// Gradient fallback colors for collage frames
const COLLAGE_FALLBACK_GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
];

/**
 * Validate upload URL
 * Only allows HTTP/HTTPS URLs for security
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL
 */
function validateUploadUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return false;
  }
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch (e) {
    // Invalid URL format
    return false;
  }
}

/**
 * Validate Pexels photographer URL
 * Only allows HTTPS URLs from pexels.com domain for security
 * @param {string} url - URL to validate
 * @returns {string} Validated URL or fallback
 */
function validatePexelsUrl(url) {
  if (!url || typeof url !== 'string') {
    return 'https://www.pexels.com';
  }
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol === 'https:' && urlObj.hostname.endsWith('pexels.com')) {
      return url;
    }
  } catch (e) {
    // Invalid URL
  }
  return 'https://www.pexels.com';
}

/**
 * Restore default image for a collage frame
 * Falls back to uploadGallery images if available, then to original src, then to gradient
 * @param {HTMLImageElement} imgElement - Image element to restore
 * @param {HTMLElement} frame - Frame element containing the image
 * @param {Array} uploadGallery - Array of uploaded image URLs from widget config
 * @param {number} frameIndex - Index of the frame (0-3) for selecting upload image
 */
function restoreDefaultImage(imgElement, frame, uploadGallery = [], frameIndex = 0) {
  if (!imgElement || !frame) {
    return;
  }

  // Priority 1: Try uploadGallery images first
  if (uploadGallery && Array.isArray(uploadGallery) && uploadGallery.length > 0) {
    // Use modulo to cycle through upload gallery for different frames
    const imageIndex = frameIndex % uploadGallery.length;
    const uploadUrl = uploadGallery[imageIndex];

    if (uploadUrl && validateUploadUrl(uploadUrl)) {
      if (isDebugEnabled()) {
        console.log(
          `[Collage Fallback] Using uploaded image ${imageIndex + 1}/${uploadGallery.length} for frame ${frameIndex}`
        );
      }
      imgElement.src = uploadUrl;
      imgElement.style.opacity = '1';
      frame.classList.remove('loading-pexels');
      return;
    }
  }

  // Priority 2: Try original src from HTML (static images)
  if (imgElement.dataset.originalSrc) {
    if (isDebugEnabled()) {
      console.log(`[Collage Fallback] Using original static image for frame ${frameIndex}`);
    }
    imgElement.src = imgElement.dataset.originalSrc;
    imgElement.style.opacity = '1';
    frame.classList.remove('loading-pexels');
    return;
  }

  // Priority 3: Show gradient placeholder (graceful degradation)
  if (isDebugEnabled()) {
    console.log(`[Collage Fallback] Using gradient placeholder for frame ${frameIndex}`);
  }
  // Set a gradient background and hide the img element
  const gradient = COLLAGE_FALLBACK_GRADIENTS[frameIndex % COLLAGE_FALLBACK_GRADIENTS.length];
  frame.style.background = gradient;
  imgElement.style.opacity = '0';
  frame.classList.remove('loading-pexels');
}

/**
 * Display a Pexels image in a collage frame
 * Helper function to avoid code duplication in preload success/timeout handlers
 * @param {HTMLImageElement} imgElement - Image element to update
 * @param {HTMLElement} frame - Frame element containing the image
 * @param {Object} imageData - Image data with url, srcset, photographer
 * @param {string} category - Category name for alt text
 */
function displayPexelsImage(imgElement, frame, imageData, category) {
  imgElement.src = imageData.url;

  // Apply srcset if available for responsive images
  if (imageData.srcset) {
    imgElement.srcset = imageData.srcset;

    // Add sizes attribute for optimal image selection
    // Mobile: ~48% of viewport (2-column), Tablet+: ~25% of viewport
    imgElement.sizes = '(max-width: 768px) 48vw, 25vw';
  }

  // Add decoding="async" for better performance
  // Note: Not using loading="lazy" because collage is above-the-fold (hero section)
  // and needs to load immediately for good LCP (Largest Contentful Paint)
  imgElement.decoding = 'async';

  imgElement.alt = `${category.charAt(0).toUpperCase() + category.slice(1)} - Photo by ${imageData.photographer}`;
  imgElement.style.opacity = '1';
  frame.classList.remove('loading-pexels');
  addCreatorCredit(frame, imageData);
}

/**
 * Restore default image for a frame that failed to load Pexels image
 * Helper function to avoid code duplication in error handling paths
 * @param {NodeList} collageFrames - All collage frame elements
 * @param {Object} categoryMapping - Mapping of categories to frame indices
 * @param {string} category - Category name
 * @param {Array} uploadGallery - Array of uploaded image URLs from widget config
 */
function restoreFrameDefault(collageFrames, categoryMapping, category, uploadGallery = []) {
  const frameIndex = categoryMapping[category];
  const frame = collageFrames[frameIndex];
  if (frame) {
    const imgElement = frame.querySelector('img');
    if (imgElement) {
      restoreDefaultImage(imgElement, frame, uploadGallery, frameIndex);
      frame.classList.remove('loading-pexels');
    }
  }
}

async function initPexelsCollage(settings) {
  // Use intervalSeconds from settings, fallback to old 'interval' property for backwards compatibility, default to 2.5 seconds
  const intervalSeconds = settings?.intervalSeconds ?? settings?.interval ?? 2.5;
  const intervalMs = intervalSeconds * 1000;

  // Extract uploadGallery for fallback (if Pexels fails)
  const uploadGallery = settings?.uploadGallery || [];

  if (isDebugEnabled()) {
    console.log('[Pexels Collage] Initializing with upload gallery fallback:', {
      uploadGalleryCount: uploadGallery.length,
    });
  }

  // Map category keys to their collage frame elements
  const categoryMapping = {
    venues: 0,
    catering: 1,
    entertainment: 2,
    photography: 3,
  };

  // Get all collage frames - support both new and old structures
  let collageFrames = document.querySelectorAll('.hero-collage .hero-collage-card');

  // Fallback to old structure for backwards compatibility
  if (!collageFrames || collageFrames.length === 0) {
    collageFrames = document.querySelectorAll('.collage .frame');
  }

  if (!collageFrames || collageFrames.length === 0) {
    if (isDevelopmentEnvironment()) {
      console.warn('No collage frames found for Pexels collage');
    }
    return;
  }

  // Add loading states to frames and clear default images
  collageFrames.forEach(frame => {
    frame.classList.add('loading-pexels');
    // Hide default images immediately when switching to Pexels mode
    const imgElement = frame.querySelector('img');
    if (imgElement) {
      // Store original src for fallback (only if it has a valid src)
      if (!imgElement.dataset.originalSrc && imgElement.src) {
        imgElement.dataset.originalSrc = imgElement.src;
      }
      // Disable transition temporarily for instant hide
      const originalTransition = imgElement.style.transition;
      imgElement.style.transition = 'none';
      // Clear the image to prevent default from showing under loading state
      imgElement.style.opacity = '0';
      // Force reflow to ensure transition:none is applied before opacity changes
      // This prevents the CSS transition from affecting the opacity change
      void imgElement.offsetHeight;
      // Restore transition after a brief delay
      setTimeout(() => {
        imgElement.style.transition = originalTransition;
      }, TRANSITION_RESTORE_DELAY_MS);
    }
  });

  // Cache for storing fetched images per category
  const imageCache = {};
  const currentImageIndex = {};

  // Fetch images for each category
  try {
    const categories = Object.keys(categoryMapping);
    for (const category of categories) {
      try {
        // Use the public Pexels collage endpoint (in admin routes but publicly accessible)
        const response = await fetch(
          `/api/admin/public/pexels-collage?category=${encodeURIComponent(category)}`
        );

        if (!response.ok) {
          // Parse error response for better logging with safer error handling
          let errorInfo = `HTTP ${response.status}`;
          try {
            const errorData = await response.json();
            // Safely extract error info with validation
            if (errorData && typeof errorData === 'object') {
              errorInfo = String(errorData.message || errorData.error || errorInfo);
            }

            // Enhanced error logging in debug mode
            if (isDebugEnabled()) {
              console.warn(`⚠️  Failed to fetch Pexels images for ${category}: ${errorInfo}`);
              if (errorData.errorType) {
                console.warn(`   Error type: ${String(errorData.errorType)}`);
              }
            }
          } catch (e) {
            // Response wasn't valid JSON, use status text
            if (isDebugEnabled()) {
              console.warn(
                `⚠️  Failed to fetch Pexels images for ${category}: ${response.statusText}`
              );
            }
          }
          // Restore default for this category since fetch failed
          restoreFrameDefault(collageFrames, categoryMapping, category, uploadGallery);
          continue;
        }

        const data = await response.json();

        // Validate response structure
        if (!data || typeof data !== 'object') {
          if (isDebugEnabled()) {
            console.warn(`⚠️  Invalid response structure for ${category}`);
          }
          // Restore default for this category since response is invalid
          restoreFrameDefault(collageFrames, categoryMapping, category, uploadGallery);
          continue;
        }

        // Log if using fallback mode (debug mode)
        if (isDebugEnabled() && data.usingFallback) {
          console.log(`📦 Using fallback photos for ${category} (source: ${data.source})`);
        }

        if (data.photos && Array.isArray(data.photos) && data.photos.length > 0) {
          // Validate and map photo data with null safety
          imageCache[category] = data.photos
            .filter(photo => {
              // Validate photo has required fields
              return (
                photo &&
                typeof photo === 'object' &&
                photo.src &&
                (photo.src.large || photo.src.original) &&
                photo.photographer
              );
            })
            .map(photo => ({
              url: getOptimalPexelsImageSize(photo.src) || photo.src.large || photo.src.original,
              srcset: generateSrcset(photo.src),
              photographer: String(photo.photographer),
              photographerUrl: validatePexelsUrl(photo.photographer_url),
            }));

          if (imageCache[category].length === 0) {
            if (isDevelopmentEnvironment()) {
              console.warn(`⚠️  No valid photos after filtering for ${category}`);
            }
            // Restore default for this category since no valid photos
            restoreFrameDefault(collageFrames, categoryMapping, category, uploadGallery);
            continue;
          }

          currentImageIndex[category] = 0;

          // Set initial image
          const frameIndex = categoryMapping[category];
          const frame = collageFrames[frameIndex];
          const imgElement = frame.querySelector('img');

          if (imgElement && imageCache[category][0]) {
            // Preload the first image before displaying it to prevent default image flash
            const firstImage = new Image();
            const imageData = imageCache[category][0];
            firstImage.src = imageData.url;

            // Set timeout for preload to prevent hanging
            const preloadTimeout = setTimeout(() => {
              // If preload takes too long, show the image anyway
              if (isDevelopmentEnvironment()) {
                console.warn(
                  `⚠️  Initial image preload timeout for ${category}, displaying anyway`
                );
              }
              displayPexelsImage(imgElement, frame, imageData, category);
            }, PEXELS_PRELOAD_TIMEOUT_MS);

            firstImage.onload = () => {
              clearTimeout(preloadTimeout);
              // Image is preloaded, now set it and make visible
              displayPexelsImage(imgElement, frame, imageData, category);
            };

            firstImage.onerror = () => {
              clearTimeout(preloadTimeout);
              // Failed to load Pexels image, restore default
              if (isDevelopmentEnvironment()) {
                console.warn(
                  `⚠️  Failed to load initial image for ${category}: ${imageCache[category][0].url}`
                );
              }
              restoreDefaultImage(imgElement, frame, uploadGallery, frameIndex);
              frame.classList.remove('loading-pexels');
            };
          }
        }
      } catch (error) {
        // Only log errors in development mode
        if (isDevelopmentEnvironment()) {
          console.error(`❌ Error fetching Pexels images for ${category}:`, error);
        }
        // Restore default for this category since an error occurred
        restoreFrameDefault(collageFrames, categoryMapping, category, uploadGallery);
      }
    }

    // Note: We don't do a cleanup loop here because the preload operations above are async.
    // Each frame's loading state and opacity will be handled by its respective
    // onload/onerror/timeout handlers in the preload logic above.

    // Start cycling images
    if (Object.keys(imageCache).length > 0) {
      // Clear any existing interval to prevent memory leaks
      if (pexelsCollageIntervalId) {
        clearInterval(pexelsCollageIntervalId);
      }

      pexelsCollageIntervalId = setInterval(() => {
        cyclePexelsImages(imageCache, currentImageIndex, collageFrames, categoryMapping);
      }, intervalMs);

      // Expose interval ID on window for debugging
      window.pexelsCollageIntervalId = pexelsCollageIntervalId;

      // Store cycling state for watchdog
      window.__collageIntervalActive = true;
      window.__collageLastCycleTime = Date.now();

      // Only log in development mode
      if (isDevelopmentEnvironment()) {
        console.log(
          `Pexels collage initialized with ${intervalSeconds}s interval (${Object.keys(imageCache).length} categories)`
        );
      }

      // Watchdog: Check periodically if interval is still running
      // This detects if the interval was unexpectedly cleared
      const watchdogInterval = setInterval(() => {
        if (!window.__collageIntervalActive) {
          return; // Collage was intentionally disabled
        }

        const timeSinceLastCycle = Date.now() - window.__collageLastCycleTime;
        const expectedInterval = intervalMs * WATCHDOG_TOLERANCE_MULTIPLIER;

        // Check if interval appears to have stopped
        if (timeSinceLastCycle > expectedInterval) {
          // Double-check interval ID is actually null before restarting
          if (!pexelsCollageIntervalId && window.__collageIntervalActive) {
            if (isDevelopmentEnvironment()) {
              console.warn('⚠️  Collage interval stopped unexpectedly, restarting...');
            }

            // Restart the interval
            pexelsCollageIntervalId = setInterval(() => {
              cyclePexelsImages(imageCache, currentImageIndex, collageFrames, categoryMapping);
            }, intervalMs);
            window.pexelsCollageIntervalId = pexelsCollageIntervalId;
          }
        }
      }, WATCHDOG_CHECK_INTERVAL_MS);

      // Store watchdog ID for cleanup
      window.__collageWatchdogId = watchdogInterval;

      // Setup responsive image optimization observers
      window.__collageResizeObserver = setupCollageResizeOptimization();
      window.__collageIntersectionObserver = setupLazyLoadingForCollage();
    } else {
      // Only warn in development mode
      if (isDevelopmentEnvironment()) {
        console.warn('No Pexels images loaded, falling back to uploaded gallery or static images');
      }
      // Restore default images for all frames using upload gallery
      collageFrames.forEach((frame, index) => {
        const imgElement = frame.querySelector('img');
        if (imgElement) {
          restoreDefaultImage(imgElement, frame, uploadGallery, index);
        }
      });
      // Note: Default images are now showing. We don't recursively call
      // loadHeroCollageImages() here to avoid the initialization guard issue.
      // The defaults are sufficient fallback.
    }
  } catch (error) {
    // Remove loading states from all frames on error
    collageFrames.forEach((frame, index) => {
      frame.classList.remove('loading-pexels');
      // Restore default images on error using upload gallery
      const imgElement = frame.querySelector('img');
      if (imgElement) {
        restoreDefaultImage(imgElement, frame, uploadGallery, index);
      }
    });

    // Only log errors in development mode
    if (isDevelopmentEnvironment()) {
      console.error('Error initializing Pexels collage:', error);
    }
    // Note: Default images are now showing. We don't recursively call
    // loadHeroCollageImages() here to avoid the initialization guard issue.
    // The defaults are sufficient fallback.
  }
}

/**
 * Video loading with retry logic and exponential backoff
 * @param {string} videoUrl - URL to fetch video data from
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @returns {Promise<Object|null>} Video data or null if all retries failed
 */
async function loadHeroVideoWithRetry(videoUrl, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(videoUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.videos && data.videos.length > 0) {
        if (window.__videoMetrics__) {
          window.__videoMetrics__.heroVideoSuccesses++;
        }
        return data; // Success!
      }
    } catch (error) {
      console.warn(`Hero video load attempt ${attempt}/${maxRetries} failed:`, error);
      if (window.__videoMetrics__) {
        window.__videoMetrics__.heroVideoFailures++;
      }

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
      }
    }
  }

  // All retries failed
  if (window.__videoMetrics__) {
    window.__videoMetrics__.lastError = 'Hero video failed after 3 attempts';
  }
  console.error('Hero video failed to load after all retries');
  return null;
}

/**
 * Initialize hero video element with Pexels video
 * Features:
 * - Supports both Pexels API and uploaded videos
 * - Smooth fade-in transition when video loads
 * - Loading spinner with animated indicator
 * - Respects user preferences (reduced-motion, reduced-data)
 * - Comprehensive error handling with metrics tracking
 * - Automatic retry on failure
 * - Graceful fallback to poster image
 *
 * @param {string} source - Source type ('pexels' or 'uploads')
 * @param {Object} mediaTypes - Media types configuration with {photos: boolean, videos: boolean}
 * @param {Array} uploadGallery - Array of uploaded media URLs
 */
async function initHeroVideo(source, mediaTypes, uploadGallery = [], heroVideoConfig = {}) {
  const videoElement = document.getElementById('hero-pexels-video');
  const videoSource = document.getElementById('hero-video-source');
  const videoCredit = document.getElementById('hero-video-credit');
  const videoCard = document.querySelector('.hero-video-card');

  if (!videoElement || !videoSource) {
    return; // Video elements not present in HTML
  }

  // Check if hero video is enabled
  if (heroVideoConfig.enabled === false) {
    if (isDebugEnabled()) {
      console.log('[Hero Video] Hero video disabled via config');
    }
    return;
  }

  // Apply hero video settings
  if (heroVideoConfig.autoplay !== undefined) {
    videoElement.autoplay = heroVideoConfig.autoplay;
  }
  if (heroVideoConfig.muted !== undefined) {
    videoElement.muted = heroVideoConfig.muted;
  }
  if (heroVideoConfig.loop !== undefined) {
    videoElement.loop = heroVideoConfig.loop;
  }

  // Add loading state
  if (videoCard) {
    videoCard.classList.add('loading-video');
  }

  try {
    // Check if we should use videos - default to true if not explicitly set to false
    const useVideos = mediaTypes?.videos !== false;

    if (isDebugEnabled()) {
      console.log('[Hero Video] Initialization params:', {
        source,
        useVideos,
        mediaTypesVideos: mediaTypes?.videos,
        uploadGalleryLength: uploadGallery?.length || 0,
      });
    }

    if (source === 'uploads' && uploadGallery && uploadGallery.length > 0) {
      // Try to find a video in upload gallery
      const videoUrl = uploadGallery.find(url => {
        const urlWithoutParams = url.split('?')[0];
        return /\.(mp4|webm|mov)$/i.test(urlWithoutParams);
      });

      if (videoUrl) {
        if (isDebugEnabled()) {
          console.log('[Hero Video] Using uploaded video:', videoUrl);
        }
        videoSource.src = videoUrl;
        videoElement.load();

        // Remove loading state when video loads
        videoElement.addEventListener(
          'loadeddata',
          () => {
            if (videoCard) {
              videoCard.classList.remove('loading-video');
            }
            // Add loaded class for smooth fade-in
            videoElement.classList.add('video-loaded');
          },
          { once: true }
        );

        videoElement.play().catch(() => {
          if (isDebugEnabled()) {
            console.log('[Hero Video] Autoplay prevented, video will play on user interaction');
          }
        });
        videoCredit.style.display = 'none'; // No credit for uploaded videos
        return;
      }
    }

    if ((source === 'pexels' || source === 'uploads') && useVideos) {
      // Fetch Pexels video with retry logic
      const eventQueries = ['wedding', 'party', 'corporate event', 'celebration', 'event venue'];
      const randomQuery = eventQueries[Math.floor(Math.random() * eventQueries.length)];

      // Track attempt
      if (window.__videoMetrics__) {
        window.__videoMetrics__.heroVideoAttempts++;
      }

      if (isDebugEnabled()) {
        console.log('[Hero Video] Fetching Pexels video with query:', randomQuery);
      }

      const videoUrl = `/api/admin/public/pexels-video?query=${encodeURIComponent(randomQuery)}`;
      const data = await loadHeroVideoWithRetry(videoUrl);

      if (!data) {
        // All retries failed
        throw new Error('Failed to fetch video after retries');
      }

      if (isDebugEnabled()) {
        console.log('[Hero Video] API response:', {
          hasVideos: !!data.videos,
          videoCount: data.videos?.length || 0,
          firstVideo: data.videos?.[0]
            ? {
                hasVideoFiles: !!data.videos[0].video_files,
                videoFilesCount: data.videos[0].video_files?.length || 0,
              }
            : null,
        });
      }

      if (data.videos && data.videos.length > 0) {
        const video = data.videos[0];
        // Determine quality preference from config
        const qualityPreference = heroVideoConfig.quality || 'hd';

        // Filter and sort video files based on quality preference
        // prettier-ignore
        const videoFiles = (video.video_files || []).filter(f => f.quality === 'hd' || f.quality === 'sd');

        if (qualityPreference === 'sd') {
          // Prefer SD quality first, then HD as fallback
          // prettier-ignore
          videoFiles.sort((a, b) => (a.quality === 'sd') ? -1 : (b.quality === 'sd') ? 1 : 0);
        }
        // For 'hd' and 'auto', HD is preferred first (default order)

        if (isDebugEnabled()) {
          console.log('[Hero Video] Available video files:', {
            count: videoFiles.length,
            files: videoFiles.map(f => ({ quality: f.quality, link: f.link })),
          });
        }

        if (videoFiles.length > 0) {
          // Set up event handlers before loading to catch all events
          let timeoutId = null;
          let loadingComplete = false;
          let currentUrlIndex = 0;

          // Helper function to handle complete failure (all URLs exhausted)
          const handleAllUrlsFailed = () => {
            if (loadingComplete) {
              return;
            }
            loadingComplete = true;

            if (timeoutId) {
              clearTimeout(timeoutId);
            }

            // Remove error listener to prevent further calls
            videoElement.removeEventListener('error', handleVideoError);

            // Remove loading state
            if (videoCard) {
              videoCard.classList.remove('loading-video');
            }

            // Track failure
            if (window.__videoMetrics__) {
              window.__videoMetrics__.heroVideoFailures++;
              window.__videoMetrics__.lastError = 'All video URLs failed';
            }

            if (isDebugEnabled()) {
              console.warn('[Hero Video] All video URLs failed, using poster fallback');
            }
          };

          const tryNextVideo = () => {
            if (currentUrlIndex >= videoFiles.length) {
              // All URLs exhausted
              handleAllUrlsFailed();
              return;
            }

            const videoFile = videoFiles[currentUrlIndex];

            // Validate video file has a valid link
            if (!videoFile?.link) {
              if (isDebugEnabled()) {
                console.warn(
                  `[Hero Video] Video file at index ${currentUrlIndex} has no valid link, skipping...`
                );
              }
              currentUrlIndex++;
              tryNextVideo();
              return;
            }

            if (isDebugEnabled()) {
              console.log(
                `[Hero Video] Trying video URL ${currentUrlIndex + 1}/${videoFiles.length}:`,
                videoFile.link
              );
            }

            // Set source and start loading
            videoSource.src = videoFile.link;
            videoElement.load();
          };

          const handleVideoLoaded = () => {
            // Already handled
            if (loadingComplete) {
              return;
            }
            loadingComplete = true;

            if (timeoutId) {
              clearTimeout(timeoutId);
            }

            // Remove error listener since video loaded successfully
            videoElement.removeEventListener('error', handleVideoError);
            // Remove both event listeners to prevent memory leaks
            videoElement.removeEventListener('loadeddata', handleVideoLoaded);
            videoElement.removeEventListener('canplay', handleVideoLoaded);

            // Remove loading state
            if (videoCard) {
              videoCard.classList.remove('loading-video');
            }

            // Add loaded class for smooth fade-in
            videoElement.classList.add('video-loaded');

            // Track success
            if (window.__videoMetrics__) {
              window.__videoMetrics__.heroVideoSuccesses++;
            }

            if (isDebugEnabled()) {
              console.log('[Hero Video] Video loaded successfully, attempting to play');
            }
            videoElement.play().catch(err => {
              if (isDebugEnabled()) {
                console.log('[Hero Video] Autoplay prevented:', err.message);
              }
            });
          };

          const handleVideoError = () => {
            // Already handled
            if (loadingComplete) {
              return;
            }

            if (isDebugEnabled()) {
              console.warn(`[Hero Video] Video URL ${currentUrlIndex + 1} failed, trying next...`);
            }

            // Try next URL
            currentUrlIndex++;
            if (currentUrlIndex < videoFiles.length) {
              tryNextVideo();
            } else {
              // All URLs failed
              handleAllUrlsFailed();
            }
          };

          // Add listeners before loading - use both loadeddata and canplay for better reliability
          videoElement.addEventListener('loadeddata', handleVideoLoaded, { once: true });
          videoElement.addEventListener('canplay', handleVideoLoaded, { once: true });
          videoElement.addEventListener('error', handleVideoError);

          // Start trying the first video
          tryNextVideo();

          // Timeout as additional safety net (10 seconds)
          // This timeout is a defensive fallback for edge cases where events don't fire.
          timeoutId = setTimeout(() => {
            if (!loadingComplete) {
              loadingComplete = true;
              // Remove error listener since we're timing out
              videoElement.removeEventListener('error', handleVideoError);
              // Remove loading state on timeout
              if (videoCard) {
                videoCard.classList.remove('loading-video');
              }
              if (isDebugEnabled()) {
                console.warn(
                  '[Hero Video] Video loading timeout - poster will be shown as fallback'
                );
              }
            }
          }, 10000);

          // Update credit - hide it as per design requirements
          videoCredit.style.display = 'none';

          if (isDebugEnabled()) {
            console.log('[Hero Video] Video initialized (will load asynchronously)');
          }
          return; // Success - exit function (video will load in background)
        }

        // No suitable video file found
        if (isDebugEnabled()) {
          console.warn('[Hero Video] No suitable video file found');
        }
      } else {
        // No videos in API response
        if (isDebugEnabled()) {
          console.warn('[Hero Video] No videos in API response');
        }
      }

      // Fall through to error handling if video not initialized
      throw new Error('Failed to initialize video');
    }
  } catch (error) {
    // Remove loading state on error
    if (videoCard) {
      videoCard.classList.remove('loading-video');
    }

    if (isDebugEnabled()) {
      console.warn('[Hero Video] Failed to initialize video:', error.message);
    }

    // Try to use fallback: show poster image if available, otherwise hide video
    // The poster attribute in HTML will show as fallback if video fails to load
    const posterSrc = videoElement.getAttribute('poster');
    if (posterSrc) {
      // Keep video element visible to show poster, but ensure video won't play
      videoSource.src = '';
      videoElement.load();

      // Hide credit text as per design requirements
      videoCredit.style.display = 'none';

      if (isDebugEnabled()) {
        console.log('[Hero Video] Using poster image as fallback');
      }
    } else {
      // No poster available, hide video element and show gradient fallback
      videoElement.style.display = 'none';
      videoCredit.style.display = 'none';
    }
  }
}

/**
 * Initialize Collage Widget with configurable source (Pexels or Uploads)
 * Supports both photos and videos with accessibility features
 * @param {Object} widgetConfig - Configuration from backend
 */
async function initCollageWidget(widgetConfig) {
  const {
    source,
    intervalSeconds,
    pexelsQueries,
    uploadGallery,
    fallbackToPexels,
    heroVideo,
    transition,
    preloading,
    mobileOptimizations,
  } = widgetConfig;

  // Default mediaTypes to enable videos if not explicitly configured
  const mediaTypes = widgetConfig.mediaTypes || { photos: true, videos: true };

  // Mobile optimization constants
  const MOBILE_TRANSITION_MULTIPLIER = 1.5;

  // Check for mobile device
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

  // Apply mobile optimizations
  let effectiveIntervalMs = (intervalSeconds || 2.5) * 1000;
  if (isMobile && mobileOptimizations?.slowerTransitions) {
    effectiveIntervalMs *= MOBILE_TRANSITION_MULTIPLIER;
  }

  // Check if videos should be disabled on mobile
  const effectiveMediaTypes = { ...mediaTypes };
  if (isMobile && mobileOptimizations?.disableVideos) {
    effectiveMediaTypes.videos = false;
  }

  // Debug logging
  if (isDebugEnabled()) {
    console.log('[Collage Widget] Initializing with config:', {
      source,
      hasMediaTypes: !!mediaTypes,
      mediaTypes: effectiveMediaTypes,
      intervalSeconds,
      hasQueries: !!pexelsQueries,
      uploadGalleryCount: uploadGallery?.length || 0,
      uploadGalleryUrls: uploadGallery || [],
      fallbackToPexels,
      isMobile,
      transition,
      preloading,
    });
  }

  // Map category keys to their collage card elements
  const categoryMapping = {
    venues: 0,
    catering: 1,
    entertainment: 2,
    photography: 3,
  };

  // Get all collage cards (new structure)
  let collageFrames = document.querySelectorAll('.hero-collage .hero-collage-card');

  // Fallback to old structure for backwards compatibility
  if (!collageFrames || collageFrames.length === 0) {
    collageFrames = document.querySelectorAll('.collage .frame');
  }

  if (!collageFrames || collageFrames.length === 0) {
    if (isDevelopmentEnvironment()) {
      console.warn('No collage frames found for collage widget');
    }
    return;
  }

  // Initialize video if present in new hero-collage structure
  // Check for reduced motion and reduced data preferences
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Feature detection for prefers-reduced-data (not yet widely supported)
  let prefersReducedData = false;
  try {
    if (window.matchMedia) {
      prefersReducedData = window.matchMedia('(prefers-reduced-data: reduce)').matches;
    }
  } catch (e) {
    // Browser doesn't support prefers-reduced-data, default to false
    if (isDevelopmentEnvironment()) {
      console.log('[Collage Widget] prefers-reduced-data not supported in this browser');
    }
  }

  if (prefersReducedMotion && isDevelopmentEnvironment()) {
    console.log('User prefers reduced motion, animations will be minimal');
  }
  if (prefersReducedData && isDevelopmentEnvironment()) {
    console.log('User prefers reduced data, skipping external media (Pexels API)');
  }

  // Skip video initialization if user prefers reduced data
  if (!prefersReducedData) {
    await initHeroVideo(source, effectiveMediaTypes, uploadGallery, heroVideo || {});
  } else if (isDevelopmentEnvironment()) {
    console.log('[Hero Video] Skipped due to prefers-reduced-data');
  }

  try {
    const mediaCache = {};
    const currentMediaIndex = {};

    // Load media based on source
    if (source === 'uploads' && uploadGallery && uploadGallery.length > 0) {
      // Use uploaded media
      if (isDebugEnabled()) {
        console.log(
          `[Collage Widget] ✅ UPLOADS BRANCH EXECUTED: Loading ${uploadGallery.length} uploaded media files`
        );
        console.log('[Collage Widget] Upload gallery URLs:', uploadGallery);
      }

      // Distribute media across categories
      const categories = Object.keys(categoryMapping);
      categories.forEach((category, index) => {
        // Assign media to categories in a round-robin fashion
        mediaCache[category] = uploadGallery
          .filter((_, i) => i % categories.length === index)
          .map(url => {
            // Remove query parameters for extension detection
            const urlWithoutParams = url.split('?')[0];
            const isVideo = /\.(mp4|webm|mov)$/i.test(urlWithoutParams);
            return {
              url,
              type: isVideo ? 'video' : 'photo',
              category,
              // Note: no photographer field, so credits won't be added
            };
          });
        currentMediaIndex[category] = 0;

        if (isDebugEnabled()) {
          console.log(
            `[Collage Widget] Category "${category}" assigned ${mediaCache[category].length} media items`
          );
        }
      });
    } else if (
      (source === 'pexels' || (fallbackToPexels && source === 'uploads')) &&
      !prefersReducedData
    ) {
      // Use Pexels API (fallback or primary) - but skip if user prefers reduced data
      if (source === 'uploads' && fallbackToPexels) {
        if (isDebugEnabled()) {
          console.log('[Collage Widget] Upload gallery empty, falling back to Pexels');
        }
      }

      // Fetch from Pexels (reuse existing Pexels logic)
      const categories = Object.keys(categoryMapping);
      for (const category of categories) {
        try {
          // Build query params with media types
          const requestPhotos = mediaTypes?.photos !== false;
          const requestVideos = mediaTypes?.videos !== false;

          if (isDebugEnabled()) {
            console.log(`[Collage Widget] Media request for ${category}:`, {
              requestPhotos,
              requestVideos,
              mediaTypesConfig: mediaTypes,
            });
          }

          const params = new URLSearchParams({
            category: category,
            photos: String(requestPhotos),
            videos: String(requestVideos),
          });

          const response = await fetch(`/api/v1/admin/public/pexels-collage?${params.toString()}`);

          if (!response.ok) {
            if (isDebugEnabled()) {
              console.warn(
                `[Collage Widget] Failed to fetch Pexels media for ${category}: ${response.status}`
              );
            }
            restoreFrameDefault(collageFrames, categoryMapping, category, uploadGallery);
            continue;
          }

          const data = await response.json();

          if (isDebugEnabled()) {
            console.log(
              `[Collage Widget] Fetched ${data.photos?.length || 0} photos and ${data.videos?.length || 0} videos for ${category} (source: ${data.source || 'unknown'})`
            );
          }

          // Combine photos and videos into media array
          const allMedia = [];

          if (data.photos && Array.isArray(data.photos) && data.photos.length > 0) {
            const photos = data.photos
              .filter(photo => photo && photo.src && photo.photographer)
              .map(photo => ({
                url: getOptimalPexelsImageSize(photo.src) || photo.src.large || photo.src.original,
                srcset: generateSrcset(photo.src),
                type: 'photo',
                photographer: String(photo.photographer),
                photographerUrl: validatePexelsUrl(photo.photographer_url),
              }));
            allMedia.push(...photos);
          }

          if (data.videos && Array.isArray(data.videos) && data.videos.length > 0) {
            const videos = data.videos
              .filter(video => {
                const isValid = video && video.src && (video.src.large || video.src.original);
                if (!isValid && isDebugEnabled()) {
                  console.warn(`[Collage Widget] Filtered out invalid video:`, video?.id);
                }
                return isValid;
              })
              .map(video => ({
                url: video.src.large || video.src.original,
                type: 'video',
                thumbnail: video.thumbnail,
                videographer: String(video.videographer || 'Pexels'),
                videographerUrl: validatePexelsUrl(
                  video.videographer_url || 'https://www.pexels.com'
                ),
                duration: video.duration,
                // Add video metadata for better quality selection
                width: video.width,
                height: video.height,
              }));
            allMedia.push(...videos);

            if (isDebugEnabled()) {
              console.log(
                `[Collage Widget] Added ${videos.length} videos for ${category} (filtered from ${data.videos.length})`
              );
            }
          }

          if (allMedia.length > 0) {
            mediaCache[category] = allMedia;

            if (mediaCache[category].length === 0) {
              if (isDebugEnabled()) {
                console.warn(`[Collage Widget] No valid media after filtering for ${category}`);
              }
              restoreFrameDefault(collageFrames, categoryMapping, category, uploadGallery);
              continue;
            }

            currentMediaIndex[category] = 0;

            if (isDebugEnabled()) {
              console.log(
                `[Collage Widget] Cached ${mediaCache[category].length} valid media items for ${category}`
              );
            }
          }
        } catch (error) {
          if (isDebugEnabled()) {
            console.error(`[Collage Widget] Error fetching Pexels media for ${category}:`, error);
          }
          restoreFrameDefault(collageFrames, categoryMapping, category, uploadGallery);
        }
      }
    } else {
      // No valid source, restore defaults
      if (isDebugEnabled()) {
        console.warn('[Collage Widget] No valid media source configured');
      }
      collageFrames.forEach((frame, index) => {
        const imgElement = frame.querySelector('img');
        if (imgElement) {
          restoreDefaultImage(imgElement, frame, uploadGallery, index);
        }
      });
      return;
    }

    // Initialize collage display
    const categories = Object.keys(mediaCache);
    if (categories.length === 0) {
      if (isDebugEnabled()) {
        console.warn(
          '[Collage Widget] No media loaded, falling back to uploaded gallery or defaults'
        );
      }
      collageFrames.forEach((frame, index) => {
        const imgElement = frame.querySelector('img');
        if (imgElement) {
          restoreDefaultImage(imgElement, frame, uploadGallery, index);
        }
      });
      return;
    }

    // Set initial media for each category
    for (const category of categories) {
      const media = mediaCache[category];
      if (!media || media.length === 0) {
        continue;
      }

      const frameIndex = categoryMapping[category];
      const frame = collageFrames[frameIndex];
      const imgElement = frame.querySelector('img');

      if (imgElement && media[0]) {
        frame.classList.add('loading-pexels');

        // Store original src for fallback (only if it has a valid src)
        if (
          !imgElement.dataset.originalSrc &&
          imgElement.src &&
          imgElement.src.startsWith('http')
        ) {
          imgElement.dataset.originalSrc = imgElement.src;
          if (isDebugEnabled()) {
            console.log(`[Collage Widget] Stored originalSrc for ${category}`);
          }
        }

        // Keep default image visible until replacement media successfully loads
        // to avoid blank collage cards when external media is slow or unavailable.

        if (isDebugEnabled()) {
          console.log(`[Collage Widget] Loading first media for ${category}`, media[0]);
        }

        // Load first media item
        await loadMediaIntoFrame(
          frame,
          imgElement,
          media[0],
          category,
          prefersReducedMotion,
          uploadGallery,
          frameIndex
        );
      }
    }

    // Start cycling media
    if (Object.keys(mediaCache).length > 0) {
      if (pexelsCollageIntervalId) {
        clearInterval(pexelsCollageIntervalId);
      }

      pexelsCollageIntervalId = setInterval(() => {
        cycleWidgetMedia(
          mediaCache,
          currentMediaIndex,
          collageFrames,
          categoryMapping,
          prefersReducedMotion
        );
      }, effectiveIntervalMs);

      // Expose interval ID on window for debugging
      window.pexelsCollageIntervalId = pexelsCollageIntervalId;

      // Store cycling state for watchdog
      window.__collageIntervalActive = true;
      window.__collageLastCycleTime = Date.now();

      if (isDevelopmentEnvironment()) {
        console.log(
          `Collage widget initialized with ${intervalSeconds}s interval (${Object.keys(mediaCache).length} categories)`
        );
      }

      // Watchdog: Check periodically if interval is still running
      const watchdogInterval = setInterval(() => {
        if (!window.__collageIntervalActive) {
          return;
        }

        const timeSinceLastCycle = Date.now() - window.__collageLastCycleTime;
        const expectedInterval = effectiveIntervalMs * WATCHDOG_TOLERANCE_MULTIPLIER;

        // Check if interval appears to have stopped
        if (timeSinceLastCycle > expectedInterval) {
          // Double-check interval ID is actually null before restarting
          if (!pexelsCollageIntervalId && window.__collageIntervalActive) {
            if (isDevelopmentEnvironment()) {
              console.warn('⚠️  Collage interval stopped unexpectedly, restarting...');
            }

            pexelsCollageIntervalId = setInterval(() => {
              cycleWidgetMedia(
                mediaCache,
                currentMediaIndex,
                collageFrames,
                categoryMapping,
                prefersReducedMotion
              );
            }, effectiveIntervalMs);
            window.pexelsCollageIntervalId = pexelsCollageIntervalId;
          }
        }
      }, WATCHDOG_CHECK_INTERVAL_MS);

      window.__collageWatchdogId = watchdogInterval;
    }
  } catch (error) {
    if (isDevelopmentEnvironment()) {
      console.error('Error initializing collage widget:', error);
    }
    // Restore defaults on error using upload gallery
    collageFrames.forEach((frame, index) => {
      frame.classList.remove('loading-pexels');
      const imgElement = frame.querySelector('img');
      if (imgElement) {
        restoreDefaultImage(imgElement, frame, uploadGallery, index);
      }
    });
  }
}

/**
 * Remove <source> elements from parent <picture> element
 * This is necessary to allow dynamic img.src changes to take effect
 * The browser caches the <source> selection and ignores img.src changes
 * @param {HTMLImageElement} imgElement - Image element
 */
function removePictureSourceElements(imgElement) {
  if (!imgElement || !imgElement.parentElement) {
    return;
  }

  const parent = imgElement.parentElement;
  if (parent.tagName === 'PICTURE') {
    // Remove all <source> elements to allow img.src to take precedence
    const sources = parent.querySelectorAll('source');
    sources.forEach(source => source.remove());

    if (isDebugEnabled()) {
      console.log(
        '[Collage Widget] Removed <source> elements from <picture> to enable dynamic image switching'
      );
    }
  }
}

/**
 * Add cache-busting query parameter to URL
 * Prevents browser from using cached static images when switching sources
 * @param {string} url - Image URL
 * @returns {string} URL with cache-busting parameter
 */
function addCacheBuster(url) {
  if (!url) {
    return url;
  }

  // Use 'cb' (cache bust) parameter to avoid conflicts with existing 't' parameters
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}cb=${Date.now()}`;
}

/**
 * Load media (photo or video) into a collage frame
 * @param {HTMLElement} frame - Frame element
 * @param {HTMLElement} mediaElement - Current media element (img)
 * @param {Object} media - Media object with url, type, etc.
 * @param {string} category - Category name
 * @param {boolean} prefersReducedMotion - User motion preference
 * @param {Array} uploadGallery - Array of uploaded image URLs for fallback
 * @param {number} frameIndex - Index of the frame for fallback selection
 */
async function loadMediaIntoFrame(
  frame,
  mediaElement,
  media,
  category,
  prefersReducedMotion,
  uploadGallery = [],
  frameIndex = 0
) {
  return new Promise(resolve => {
    const isVideo = media.type === 'video';

    if (isVideo) {
      // Track attempt
      if (window.__videoMetrics__) {
        window.__videoMetrics__.collageVideoAttempts++;
      }

      // Clean up existing video if present
      const existingVideo = frame.querySelector('video');
      if (existingVideo) {
        existingVideo.pause();
        existingVideo.removeAttribute('src');
        existingVideo.load();
      }

      // Replace img with video element
      const video = document.createElement('video');
      video.src = media.url;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.className = mediaElement.className;
      video.style.cssText = mediaElement.style.cssText;
      video.setAttribute(
        'aria-label',
        `${category.charAt(0).toUpperCase() + category.slice(1)} video`
      );

      if (isDebugEnabled()) {
        console.log(`[Collage Widget] Creating video element for ${category}:`, {
          url: media.url,
          videographer: media.videographer,
        });
      }

      // Accessibility: respect reduced motion
      if (prefersReducedMotion) {
        video.autoplay = false;
        video.loop = false;
      }

      // Declare timeout ID that will be set later
      // eslint-disable-next-line prefer-const
      let timeoutId;

      // Use named functions for easier cleanup
      const handleLoadedData = () => {
        clearTimeout(timeoutId); // Clear timeout since video loaded successfully
        mediaElement.replaceWith(video);
        video.style.opacity = '1';
        video.classList.add('video-loaded');
        frame.classList.remove('loading-pexels');

        // Track success
        if (window.__videoMetrics__) {
          window.__videoMetrics__.collageVideoSuccesses++;
        }

        if (isDebugEnabled()) {
          console.log(`[Collage Widget] Video loaded successfully for ${category}:`, {
            url: media.url,
            duration: video.duration,
          });
        }

        // Only add credit if from Pexels (has videographer field for videos)
        if (media.videographer) {
          addCreatorCredit(frame, media);
        } else {
          // Remove any existing credits when using uploaded videos
          removeCreatorCredit(frame);
        }

        // Explicitly play the video (autoplay may not work after DOM manipulation)
        if (!prefersReducedMotion) {
          video.play().catch(err => {
            if (isDebugEnabled()) {
              console.log(
                `[Collage Widget] Video autoplay prevented for ${category}:`,
                err.message
              );
            }
          });
        }

        resolve();
      };

      const handleError = () => {
        clearTimeout(timeoutId); // Clear timeout since video errored
        // Track failure
        if (window.__videoMetrics__) {
          window.__videoMetrics__.collageVideoFailures++;
          window.__videoMetrics__.lastError = `Collage video failed: ${media.url}`;
        }

        if (isDebugEnabled()) {
          console.warn(`[Collage Widget] Failed to load video: ${media.url}`);
        }
        restoreDefaultImage(mediaElement, frame, uploadGallery, frameIndex);
        frame.classList.remove('loading-pexels');
        resolve();
      };

      video.addEventListener('loadeddata', handleLoadedData, { once: true });
      video.addEventListener('error', handleError, { once: true });

      // Set timeout for video loading
      timeoutId = setTimeout(() => {
        if (frame.classList.contains('loading-pexels')) {
          if (isDebugEnabled()) {
            console.warn(`[Collage Widget] Video load timeout for ${category}`);
          }
          // Remove event listeners to prevent them from firing after timeout
          video.removeEventListener('loadeddata', handleLoadedData);
          video.removeEventListener('error', handleError);
          restoreDefaultImage(mediaElement, frame, uploadGallery, frameIndex);
          frame.classList.remove('loading-pexels');
          resolve();
        }
      }, PEXELS_PRELOAD_TIMEOUT_MS);
    } else {
      // Load photo
      const img = new Image();
      img.src = media.url;

      const preloadTimeout = setTimeout(() => {
        if (isDebugEnabled()) {
          console.warn(`[Collage Widget] Image preload timeout for ${category}, displaying anyway`);
        }

        // Fix picture element issue: Remove <source> elements before changing img.src
        removePictureSourceElements(mediaElement);

        // Add cache busting to prevent browser from using cached static images
        const cacheBustedUrl = addCacheBuster(media.url);
        mediaElement.src = cacheBustedUrl;

        // Apply srcset if available for responsive images
        if (media.srcset) {
          mediaElement.srcset = media.srcset;
          mediaElement.sizes = '(max-width: 768px) 48vw, 25vw';
        }

        // Add decoding="async" for better performance
        // Note: Not using loading="lazy" - collage is above-the-fold (hero section)
        mediaElement.decoding = 'async';

        mediaElement.alt = `${category.charAt(0).toUpperCase() + category.slice(1)} - Photo`;
        mediaElement.style.opacity = '1';
        frame.classList.remove('loading-pexels');

        // Only add creator credit for Pexels images (not uploads)
        if (media.photographer || media.videographer) {
          addCreatorCredit(frame, media);
        } else {
          // Remove any existing credits when using uploaded images
          removeCreatorCredit(frame);
        }

        resolve();
      }, PEXELS_PRELOAD_TIMEOUT_MS);

      img.onload = () => {
        clearTimeout(preloadTimeout);
        if (isDebugEnabled()) {
          console.log(
            `[Collage Widget] Image loaded successfully for ${category}, setting src and opacity=1`
          );
        }

        // Fix picture element issue: Remove <source> elements before changing img.src
        removePictureSourceElements(mediaElement);

        // Add cache busting to prevent browser from using cached static images
        const cacheBustedUrl = addCacheBuster(media.url);
        mediaElement.src = cacheBustedUrl;

        // Apply srcset if available for responsive images
        if (media.srcset) {
          mediaElement.srcset = media.srcset;
          mediaElement.sizes = '(max-width: 768px) 48vw, 25vw';
        }

        // Add decoding="async" for better performance
        // Note: Not using loading="lazy" - collage is above-the-fold (hero section)
        mediaElement.decoding = 'async';

        mediaElement.alt = `${category.charAt(0).toUpperCase() + category.slice(1)} - Photo`;
        mediaElement.style.opacity = '1';
        frame.classList.remove('loading-pexels');

        // Only add creator credit for Pexels images (not uploads)
        if (media.photographer || media.videographer) {
          addCreatorCredit(frame, media);
        } else {
          // Remove any existing credits when using uploaded images
          removeCreatorCredit(frame);
        }

        resolve();
      };

      img.onerror = () => {
        clearTimeout(preloadTimeout);
        if (isDebugEnabled()) {
          console.warn(`[Collage Widget] Failed to load image: ${media.url}`);
        }
        restoreDefaultImage(mediaElement, frame, uploadGallery, frameIndex);
        frame.classList.remove('loading-pexels');
        resolve();
      };
    }
  });
}

/**
 * Cycle through widget media with transitions
 * Supports both photos and videos
 */
function cycleWidgetMedia(
  mediaCache,
  currentMediaIndex,
  collageFrames,
  categoryMapping,
  prefersReducedMotion
) {
  // Update last cycle time for watchdog
  window.__collageLastCycleTime = Date.now();

  Object.keys(mediaCache).forEach(category => {
    const mediaList = mediaCache[category];
    if (!mediaList || !Array.isArray(mediaList) || mediaList.length === 0) {
      return;
    }

    // Move to next media
    currentMediaIndex[category] = (currentMediaIndex[category] + 1) % mediaList.length;
    const nextMedia = mediaList[currentMediaIndex[category]];

    if (!nextMedia || !nextMedia.url) {
      if (isDevelopmentEnvironment()) {
        console.warn(`Invalid next media for ${category}, skipping cycle`);
      }
      return;
    }

    const frameIndex = categoryMapping[category];
    const frame = collageFrames[frameIndex];
    const currentElement = frame.querySelector('img, video');

    if (!currentElement) {
      return;
    }

    // Clean up old video element if switching away from video
    if (currentElement.tagName === 'VIDEO' && nextMedia.type !== 'video') {
      currentElement.pause();
      currentElement.removeAttribute('src');
      currentElement.load();
    }

    // Fade out current element
    if (!prefersReducedMotion) {
      currentElement.classList.add('fading');
    }

    setTimeout(
      async () => {
        // Verify element still exists in DOM (safety check)
        if (!document.body.contains(currentElement)) {
          if (isDevelopmentEnvironment()) {
            console.warn(`Element removed from DOM during transition for ${category}`);
          }
          return;
        }

        // Create new element based on media type
        if (nextMedia.type === 'video') {
          const video = document.createElement('video');
          video.src = nextMedia.url;
          video.muted = true;
          video.loop = true;
          video.playsInline = true;
          video.autoplay = !prefersReducedMotion;
          video.className = currentElement.className.replace('fading', '');
          video.style.cssText = currentElement.style.cssText;
          video.style.opacity = '0';
          video.setAttribute(
            'aria-label',
            `${category.charAt(0).toUpperCase() + category.slice(1)} video`
          );

          const handleLoadedData = () => {
            currentElement.replaceWith(video);
            if (!prefersReducedMotion) {
              setTimeout(() => {
                video.style.opacity = '1';
                video.classList.add('video-loaded');
              }, 50);
            } else {
              video.style.opacity = '1';
              video.classList.add('video-loaded');
            }

            // Only add credit if from Pexels (has photographer or videographer field)
            if (nextMedia.photographer || nextMedia.videographer) {
              addCreatorCredit(frame, nextMedia);
            } else {
              // Remove any existing credits when using uploaded media
              removeCreatorCredit(frame);
            }

            // Explicitly play the video (autoplay may not work after DOM manipulation)
            if (!prefersReducedMotion) {
              video.play().catch(err => {
                if (isDebugEnabled()) {
                  console.log(
                    `[Collage Widget] Video autoplay prevented for ${category}:`,
                    err.message
                  );
                }
              });
            }
          };

          const handleError = () => {
            if (isDevelopmentEnvironment()) {
              console.warn(`Failed to load video: ${nextMedia.url}`);
            }

            // Try to find a working media by skipping ahead
            currentMediaIndex[category] =
              (currentMediaIndex[category] + ERROR_RECOVERY_SKIP_COUNT) % mediaList.length;
            const fallbackMedia = mediaList[currentMediaIndex[category]];

            // If fallback is an image, load it directly
            if (fallbackMedia && fallbackMedia.url && fallbackMedia.type !== 'video') {
              currentElement.src = fallbackMedia.url;
              currentElement.alt = `${category.charAt(0).toUpperCase() + category.slice(1)} - Photo`;
              if (fallbackMedia.photographer) {
                addCreatorCredit(frame, fallbackMedia);
              } else {
                removeCreatorCredit(frame);
              }
            }

            currentElement.classList.remove('fading');
            currentElement.style.opacity = '1';
          };

          video.addEventListener('loadeddata', handleLoadedData, { once: true });
          video.addEventListener('error', handleError, { once: true });
        } else {
          // Preload photo
          const img = new Image();
          img.src = nextMedia.url;

          img.onload = () => {
            if (currentElement.tagName === 'VIDEO') {
              // Clean up video before replacing
              currentElement.pause();
              currentElement.removeAttribute('src');
              currentElement.load();

              // Replace video with img
              const newImg = document.createElement('img');
              newImg.src = nextMedia.url;
              newImg.className = currentElement.className.replace('fading', '');
              newImg.style.cssText = currentElement.style.cssText;
              newImg.style.opacity = '0';
              newImg.alt = `${category.charAt(0).toUpperCase() + category.slice(1)} - Photo`;

              currentElement.replaceWith(newImg);

              if (!prefersReducedMotion) {
                setTimeout(() => {
                  newImg.style.opacity = '1';
                }, 50);
              } else {
                newImg.style.opacity = '1';
              }
            } else {
              // Update existing img
              // Fix picture element issue: Remove <source> elements before changing img.src
              removePictureSourceElements(currentElement);

              // Add cache busting
              const cacheBustedUrl = addCacheBuster(nextMedia.url);
              currentElement.src = cacheBustedUrl;
              currentElement.alt = `${category.charAt(0).toUpperCase() + category.slice(1)} - Photo`;
              currentElement.classList.remove('fading');
              if (!prefersReducedMotion) {
                setTimeout(() => {
                  currentElement.style.opacity = '1';
                }, 50);
              } else {
                currentElement.style.opacity = '1';
              }
            }

            // Only add credit if from Pexels (has photographer or videographer field)
            if (nextMedia.photographer || nextMedia.videographer) {
              addCreatorCredit(frame, nextMedia);
            } else {
              // Remove any existing credits when using uploaded media
              removeCreatorCredit(frame);
            }
          };

          img.onerror = () => {
            if (isDevelopmentEnvironment()) {
              console.warn(`Failed to load image: ${nextMedia.url}`);
            }

            // Try to find a working image by skipping ahead
            currentMediaIndex[category] =
              (currentMediaIndex[category] + ERROR_RECOVERY_SKIP_COUNT) % mediaList.length;
            const fallbackMedia = mediaList[currentMediaIndex[category]];

            // Attempt to load the fallback image directly
            if (fallbackMedia && fallbackMedia.url && fallbackMedia.type !== 'video') {
              currentElement.src = fallbackMedia.url;
              currentElement.alt = `${category.charAt(0).toUpperCase() + category.slice(1)} - Photo`;
              if (fallbackMedia.photographer || fallbackMedia.videographer) {
                addCreatorCredit(frame, fallbackMedia);
              } else {
                removeCreatorCredit(frame);
              }
            }

            currentElement.classList.remove('fading');
            currentElement.style.opacity = '1';
          };
        }
      },
      prefersReducedMotion ? 0 : PEXELS_TRANSITION_DURATION_MS
    );
  });
}

/**
 * Cleanup function for collage widget (call on page unload or widget disable)
 * Clears intervals and removes event listeners to prevent memory leaks
 */
function cleanupPexelsCollage() {
  // Mark collage as inactive for watchdog
  window.__collageIntervalActive = false;

  // Clear watchdog interval
  if (window.__collageWatchdogId) {
    clearInterval(window.__collageWatchdogId);
    window.__collageWatchdogId = null;
  }

  if (pexelsCollageIntervalId) {
    clearInterval(pexelsCollageIntervalId);
    pexelsCollageIntervalId = null;
    if (isDevelopmentEnvironment()) {
      console.log('Collage widget interval cleared');
    }
  }

  // Clean up ResizeObserver
  if (window.__collageResizeObserver) {
    window.__collageResizeObserver.disconnect();
    window.__collageResizeObserver = null;
  }

  // Clean up IntersectionObserver
  if (window.__collageIntersectionObserver) {
    window.__collageIntersectionObserver.disconnect();
    window.__collageIntersectionObserver = null;
  }

  // Clean up video elements to prevent memory leaks
  const collageFrames = document.querySelectorAll('.collage .frame');
  if (collageFrames) {
    collageFrames.forEach(frame => {
      const video = frame.querySelector('video');
      if (video) {
        // Pause video and remove source to free memory
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    });
  }
}

/**
 * Cycle through Pexels images with crossfade transition
 * Handles preload failures gracefully by falling back to direct replacement
 */
function cyclePexelsImages(imageCache, currentImageIndex, collageFrames, categoryMapping) {
  // Update last cycle time for watchdog
  window.__collageLastCycleTime = Date.now();

  Object.keys(imageCache).forEach(category => {
    const images = imageCache[category];
    if (!images || !Array.isArray(images) || images.length === 0) {
      return;
    }

    // Move to next image
    currentImageIndex[category] = (currentImageIndex[category] + 1) % images.length;
    const nextImage = images[currentImageIndex[category]];

    // Validate next image has required data
    if (!nextImage || !nextImage.url) {
      if (isDevelopmentEnvironment()) {
        console.warn(`⚠️  Invalid next image for ${category}, skipping cycle`);
      }
      return;
    }

    const frameIndex = categoryMapping[category];
    const frame = collageFrames[frameIndex];
    const imgElement = frame.querySelector('img');

    if (!imgElement) {
      return;
    }

    // Preload next image for smooth transition
    const nextImg = new Image();
    nextImg.src = nextImage.url;

    // Set timeout for preload to prevent hanging
    const preloadTimeout = setTimeout(() => {
      // If preload takes too long, just swap directly without fade
      if (isDevelopmentEnvironment()) {
        console.warn(`⚠️  Image preload timeout for ${category}, swapping directly`);
      }
      imgElement.src = nextImage.url;
      imgElement.alt = `${category.charAt(0).toUpperCase() + category.slice(1)} - Photo by ${nextImage.photographer}`;
      addCreatorCredit(frame, nextImage);
    }, PEXELS_PRELOAD_TIMEOUT_MS);

    nextImg.onload = () => {
      // Clear timeout since image loaded successfully
      clearTimeout(preloadTimeout);

      // Add fading class for transition
      imgElement.classList.add('fading');

      // After fade out, change image and fade in
      setTimeout(() => {
        imgElement.src = nextImage.url;
        imgElement.alt = `${category.charAt(0).toUpperCase() + category.slice(1)} - Photo by ${nextImage.photographer}`;
        imgElement.classList.remove('fading');

        // Update creator credit
        addCreatorCredit(frame, nextImage);
      }, PEXELS_TRANSITION_DURATION_MS);
    };

    nextImg.onerror = () => {
      // Clear timeout on error
      clearTimeout(preloadTimeout);

      // Skip this image and move to next
      if (isDevelopmentEnvironment()) {
        console.warn(`⚠️  Failed to load image for ${category}: ${nextImage.url}`);
      }

      // Try to find a working image by attempting the next one immediately
      // Skip ahead to avoid retrying the same broken image
      currentImageIndex[category] =
        (currentImageIndex[category] + ERROR_RECOVERY_SKIP_COUNT) % images.length;
      const fallbackImage = images[currentImageIndex[category]];

      // Attempt to load the fallback image directly without transition
      if (fallbackImage && fallbackImage.url) {
        imgElement.src = fallbackImage.url;
        imgElement.alt = `${category.charAt(0).toUpperCase() + category.slice(1)} - Photo by ${fallbackImage.photographer}`;
        addCreatorCredit(frame, fallbackImage);
      }
      // If fallback also fails, the onerror of that load will be ignored
      // and the next cycle will try again
    };
  });
}

/**
 * Remove photographer credit from collage frame
 * Used when switching from Pexels to uploaded images
 * @param {HTMLElement} frame - Frame element
 */
function removeCreatorCredit(frame) {
  if (!frame) {
    return;
  }

  const existingCredit = frame.querySelector('.pexels-credit');
  if (existingCredit) {
    existingCredit.remove();

    if (isDebugEnabled()) {
      console.log('[Collage Widget] Removed creator credit');
    }
  }
}

/**
 * Add photographer credit to collage frame
 * Safely escapes HTML to prevent XSS
 */
/**
 * Add creator credit (photographer or videographer) to collage frame
 * @param {HTMLElement} frame - Frame element
 * @param {Object} media - Media object with photographer/videographer info
 */
function addCreatorCredit(frame, media) {
  // Validate inputs
  if (!frame || !media) {
    return;
  }

  // Skip adding credit text on mobile viewports (640px and below)
  // CSS already hides it, but this prevents DOM creation entirely
  if (window.innerWidth <= 640) {
    return;
  }

  const isVideo = media.type === 'video';
  const creatorName = isVideo ? media.videographer : media.photographer;
  const creatorUrl = isVideo ? media.videographerUrl : media.photographerUrl;

  if (!creatorName) {
    return;
  }

  // Remove existing credit if present
  const existingCredit = frame.querySelector('.pexels-credit');
  if (existingCredit) {
    existingCredit.remove();
  }

  // Create credit element safely
  const credit = document.createElement('div');
  credit.className = 'pexels-credit';

  // Create text node with appropriate prefix
  const prefix = isVideo ? 'Video by ' : 'Photo by ';
  credit.appendChild(document.createTextNode(prefix));

  // Create link element safely with validated URL
  const link = document.createElement('a');
  link.href = validatePexelsUrl(creatorUrl);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = creatorName;

  credit.appendChild(link);
  frame.appendChild(credit);
}

/**
 * Fetch and render public stats with graceful fallback
 */
async function fetchPublicStats() {
  try {
    const response = await fetch('/api/v1/public/stats');
    if (!response.ok) {
      // Silently handle 404s (endpoint not available in static/dev mode)
      if (response.status === 404) {
        hideStatsSection();
        return;
      }
      // Log other errors only in development
      if (isDevelopmentEnvironment()) {
        console.error(`Failed to load public stats (HTTP ${response.status})`);
      }
      hideStatsSection();
      return;
    }

    const stats = await response.json();
    updateStatsUI(stats);
  } catch (error) {
    // Only log network errors and parse errors
    if (isDevelopmentEnvironment() && error.name !== 'AbortError') {
      console.error('Failed to load public stats:', error);
    }
    // Hide stats section on error
    hideStatsSection();
  }
}

/**
 * Hide stats section gracefully when data unavailable
 */
function hideStatsSection() {
  const section = document.getElementById('stats-section');
  if (section) {
    section.style.display = 'none';
  }
}

/**
 * Helper to update stats UI with given values
 */
function updateStatsUI(stats) {
  // Update stat counters with real data
  const statItems = document.querySelectorAll('.ef-stat');
  if (statItems.length >= 4) {
    const counters = [
      { value: stats.suppliersVerified, suffix: '+' },
      { value: stats.packagesApproved, suffix: '+' },
      { value: stats.marketplaceListingsActive, suffix: '+' },
      { value: stats.reviewsApproved, suffix: '+' },
    ];

    statItems.forEach((item, index) => {
      const counterEl = item.querySelector('.ef-stat__number');
      if (counterEl && counters[index]) {
        const newValue = counters[index].value;
        const suffix = counters[index].suffix;

        // Update the data attributes regardless
        counterEl.setAttribute('data-counter', newValue);
        counterEl.setAttribute('data-suffix', suffix);

        if (newValue > 0) {
          if (counterEl.dataset.counted) {
            // The IntersectionObserver already ran an animation with fallback
            // values — update the displayed text directly to show real data
            // without starting a conflicting animation.
            counterEl.textContent = `${newValue.toLocaleString()}${suffix}`;
          } else {
            // Counter hasn't run yet; mark it so the IntersectionObserver
            // picks up the updated data-counter value when the section scrolls
            // into view (already handles this via data-counter attribute).
          }
        }
      }
    });
  }
}

/**
 * Fetch and render marketplace preview items
 */
async function fetchMarketplacePreview() {
  const container = document.getElementById('marketplace-preview');
  if (!container) {
    return;
  }

  const MARKETPLACE_PREVIEW_LIMIT = 4;
  const MARKETPLACE_CANDIDATE_LIMIT = 12;

  // Issue 5 & 6 Fix: Use error boundary and loading state
  const errorBoundary = new ErrorBoundary('marketplace-preview', {
    title: 'Could not load marketplace items',
    message: 'Please refresh the page to try again.',
    showRetry: true,
    retryCallback: fetchMarketplacePreview,
  });

  // Show loading skeleton
  LoadingState.show('marketplace-preview', 'card', MARKETPLACE_PREVIEW_LIMIT);

  try {
    // Pull a broader candidate set and rank it for a better homepage mix
    const response = await fetchWithRetry(
      `/api/v1/marketplace/listings?limit=${MARKETPLACE_CANDIDATE_LIMIT}`,
      {},
      3
    );

    if (!response.ok) {
      // Silently handle 404s (endpoint not available in static/dev mode)
      if (response.status === 404) {
        LoadingState.hide('marketplace-preview');
        container.innerHTML = '<p class="small">Marketplace not available yet.</p>';
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const listings = Array.isArray(data.listings) ? data.listings : [];

    LoadingState.hide('marketplace-preview');

    if (listings.length === 0) {
      container.innerHTML = '<p class="small">No marketplace items available yet.</p>';
      return;
    }

    // Helper to safely escape HTML
    const escape = text => {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    };

    const formatCategoryLabel = category => {
      const labels = {
        attire: 'Attire',
        decor: 'Décor',
        'av-equipment': 'AV Equipment',
        photography: 'Photography',
        'party-supplies': 'Party Supplies',
        florals: 'Florals',
      };
      return labels[category] || category || 'Listing';
    };

    const formatConditionLabel = condition => {
      const labels = {
        new: 'New / Unused',
        'like-new': 'Like New',
        good: 'Good',
        fair: 'Fair',
      };
      return labels[condition] || condition || '';
    };

    const formatPrice = value => {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        return 'Price on request';
      }
      return `£${number.toLocaleString('en-GB', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    };

    const getListingImage = listing => {
      const imageArrays = [listing?.images, listing?.photos];
      for (const imageArray of imageArrays) {
        if (Array.isArray(imageArray)) {
          const validImage = imageArray.find(item => typeof item === 'string' && item.trim());
          if (validImage) {
            return validImage;
          }
        }
      }
      if (typeof listing?.image === 'string' && listing.image.trim()) {
        return listing.image;
      }
      return '/assets/images/collage-venue.jpg';
    };

    // Homepage selection strategy:
    // 1) explicit featured listings first (if field exists)
    // 2) quality signals (images + complete metadata)
    // 3) recency
    const scoreListing = listing => {
      let score = 0;
      if (listing?.featured === true || listing?.isFeatured === true) {
        score += 1000;
      }
      if (getListingImage(listing) !== '/assets/images/collage-venue.jpg') {
        score += 120;
      }
      if (listing?.location) {
        score += 25;
      }
      if (listing?.condition) {
        score += 20;
      }
      if (listing?.category) {
        score += 20;
      }
      const createdAt = Date.parse(listing?.createdAt || '');
      if (!Number.isNaN(createdAt)) {
        const ageMs = Date.now() - createdAt;
        const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
        score += Math.max(0, 180 - Math.min(ageDays, 180));
      }
      return score;
    };

    const selectedListings = listings
      .map(listing => ({ listing, score: scoreListing(listing) }))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return new Date(b.listing.createdAt || 0) - new Date(a.listing.createdAt || 0);
      })
      .slice(0, MARKETPLACE_PREVIEW_LIMIT)
      .map(item => item.listing);

    // Render marketplace items
    container.innerHTML = `
      <div class="cards">
        ${selectedListings
          .map(listing => {
            const listingUrl = listing.id
              ? `/marketplace?listing=${encodeURIComponent(listing.id)}`
              : '/marketplace';
            const listingImage = getListingImage(listing);
            const isFeatured = listing?.featured === true || listing?.isFeatured === true;
            const isNew =
              Date.now() - new Date(listing?.createdAt || 0).getTime() < 1000 * 60 * 60 * 24 * 14;
            return `
          <a href="${listingUrl}" class="card card-hover" style="text-decoration: none; color: inherit; display: block; overflow: hidden;">
            <img src="${escape(listingImage)}" alt="${escape(listing.title)}" style="width: 100%; height: 180px; object-fit: cover; border-radius: 8px 8px 0 0;" loading="lazy" data-fallback-src="/assets/images/collage-venue.jpg" />
            <div style="padding: 1rem;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 0.5rem;">
                <h3 style="margin: 0; font-size: 1.1rem;">${escape(listing.title || 'Marketplace listing')}</h3>
                ${isFeatured ? '<span class="badge badge-info" style="white-space: nowrap;">Featured</span>' : isNew ? '<span class="badge badge-secondary" style="white-space: nowrap;">New</span>' : ''}
              </div>
              <p class="small" style="margin: 0 0 0.5rem 0; font-weight: 600; color: var(--ink, #0b8073);">${escape(formatPrice(listing.price))}</p>
              <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem;">
                <span class="badge badge-secondary">${escape(formatCategoryLabel(listing.category))}</span>
                ${listing.condition ? `<span class="badge badge-info">${escape(formatConditionLabel(listing.condition))}</span>` : ''}
                ${listing.location ? `<span class="badge badge-secondary">${escape(listing.location)}</span>` : ''}
              </div>
            </div>
          </a>
        `;
          })
          .join('')}
      </div>
    `;

    // Attach error handlers for marketplace preview images (CSP-safe, no inline onerror)
    container.querySelectorAll('img[data-fallback-src]').forEach(img => {
      img.addEventListener('error', function handler() {
        img.removeEventListener('error', handler);
        img.src = img.dataset.fallbackSrc;
      });
    });
  } catch (error) {
    // Issue 5 Fix: Use error boundary for errors
    if (isDevelopmentEnvironment()) {
      console.error('Failed to load marketplace preview:', error);
    }
    errorBoundary.show(error);
  }
}

/**
 * Fetch and render guides
 */
async function fetchGuides() {
  const container = document.getElementById('guides-list');
  const section = document.getElementById('guides-section');

  if (!container || !section) {
    return;
  }

  // Show loading placeholder
  container.innerHTML =
    '<p class="small" style="text-align: center; padding: 2rem;">Loading guides...</p>';

  try {
    const response = await fetch('/assets/data/guides.json');
    if (!response.ok) {
      // Silently handle 404s (guides.json not available)
      if (response.status === 404) {
        section.style.display = 'none';
        return;
      }
      // Log other errors only in development
      if (isDevelopmentEnvironment()) {
        console.error(`Failed to load guides (HTTP ${response.status})`);
      }
      section.style.display = 'none';
      return;
    }

    const guides = await response.json();

    if (!Array.isArray(guides) || guides.length === 0) {
      throw new Error('No guides available');
    }

    // Helper to safely escape HTML
    const escape = text => {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    };

    // Render guides (limit to 3 for homepage)
    container.innerHTML = guides
      .slice(0, 3)
      .map(
        guide => `
        <div class="card card-hover">
          <h3 style="margin: 0 0 0.5rem 0; font-size: 1.1rem;">
            <a href="${escape(guide.href)}" style="text-decoration: none; color: inherit;">${escape(guide.title)}</a>
          </h3>
          <p class="small" style="margin: 0 0 0.5rem 0; color: var(--color-text-secondary, #6c757d);">
            ${escape(guide.description || '')}
          </p>
          <div style="display: flex; gap: 0.5rem; align-items: center; margin-top: 0.5rem;">
            <span class="badge badge-info">${escape(guide.category)}</span>
            <span class="small" style="color: var(--color-text-secondary, #6c757d);">
              ${escape(String(guide.readingMins))} min read
            </span>
          </div>
        </div>
      `
      )
      .join('');

    // Show the section
    section.style.display = 'block';
  } catch (error) {
    // Only log parse errors and network errors, not expected 404s
    if (isDevelopmentEnvironment() && error.name !== 'AbortError') {
      console.error('Failed to load guides:', error);
    }
    // Hide the entire section gracefully
    section.style.display = 'none';
  }
}

async function fetchTestimonials() {
  const section = document.getElementById('testimonials-section');
  // Correct container ID matches the HTML element id="ef-testimonials-carousel"
  const container = document.getElementById('ef-testimonials-carousel');

  if (!container || !section) {
    // Static HTML testimonials are already in place — nothing to do
    return;
  }

  try {
    const response = await fetch('/api/v1/reviews?limit=3&sort=rating');

    if (!response.ok) {
      // Keep the static HTML testimonials as fallback instead of hiding the section
      if (isDevelopmentEnvironment()) {
        console.log('[Testimonials] API returned non-ok status, showing static testimonials');
      }
      return;
    }

    const data = await response.json();
    const reviews = data.reviews || [];

    if (reviews.length === 0) {
      // Keep the static HTML testimonials as fallback
      if (isDevelopmentEnvironment()) {
        console.log('[Testimonials] No reviews from API, showing static testimonials');
      }
      return;
    }

    // Helper to safely escape HTML
    const escape = text => {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    };

    // Render real reviews using the ef-testimonial carousel CSS classes so
    // the existing carousel JS in home.js and homepage-enhancements.css styles apply.
    const displayed = reviews.slice(0, 3);
    container.innerHTML = displayed
      .map(
        (review, i) => `
      <div class="ef-testimonial${i === 0 ? ' active' : ''}" aria-hidden="${i === 0 ? 'false' : 'true'}">
        <div class="ef-testimonial-content">
          <div class="ef-testimonial-stars" aria-label="${review.rating || 5} out of 5 stars">${'★'.repeat(review.rating || 5)}${'☆'.repeat(5 - (review.rating || 5))}</div>
          <p class="ef-testimonial-quote">"${escape((review.comment || '').substring(0, 200))}${(review.comment || '').length > 200 ? '...' : ''}"</p>
          <div class="ef-testimonial-author">
            <strong>${escape(review.customerName || 'Anonymous')}</strong>
            <span class="ef-testimonial-event">${escape(review.supplierName || '')}</span>
          </div>
        </div>
      </div>
    `
      )
      .join('');

    // Update dot navigation to match the number of rendered reviews
    const dotsContainer = document.querySelector('.ef-testimonials-dots');
    if (
      dotsContainer &&
      displayed.length !== dotsContainer.querySelectorAll('.ef-testimonial-dot').length
    ) {
      dotsContainer.innerHTML = displayed
        .map(
          (_, i) =>
            `<button type="button" role="tab" aria-selected="${i === 0 ? 'true' : 'false'}" aria-label="View testimonial ${i + 1}" data-testimonial="${i}" class="ef-testimonial-dot${i === 0 ? ' active' : ''}"></button>`
        )
        .join('');
    }

    // Dispatch event so home.js can reinitialise its carousel references
    section.dispatchEvent(new CustomEvent('testimonialsUpdated', { bubbles: true }));
  } catch (error) {
    if (isDevelopmentEnvironment()) {
      console.error('[Testimonials] Failed to load:', error);
    }
    // Keep static HTML testimonials on error — do not hide the section
  }
}

/**
 * OLD: Initialize hero search with autocomplete
 * NOTE: This function is no longer used. The new ef-search-bar component
 * is handled by ef-search-bar.js. Keeping this commented for reference.
 */
/*
function initHeroSearch() {
  const form = document.getElementById('hero-search-form');
  const input = document.getElementById('hero-search-input');
  const resultsContainer = document.getElementById('hero-search-results');

  if (!form || !input || !resultsContainer) {
    return;
  }

  let searchTimeout;

  // Handle input for autocomplete
  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = input.value.trim();

    if (query.length < 2) {
      resultsContainer.style.display = 'none';
      return;
    }

    searchTimeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}&limit=5`);
        if (!response.ok) {
          throw new Error('Search failed');
        }

        const data = await response.json();
        const results = data.results || [];

        if (results.length === 0) {
          resultsContainer.innerHTML =
            '<div style="padding: 16px; text-align: center; color: #6b7280;">No results found</div>';
          resultsContainer.style.display = 'block';
          return;
        }

        // Helper to safely escape HTML
        const escape = text => {
          const div = document.createElement('div');
          div.textContent = text || '';
          return div.innerHTML;
        };

        resultsContainer.innerHTML = results
          .map(
            result => `
          <a 
            href="${escape(result.url || '#')}" 
            style="display: block; padding: 12px 16px; border-bottom: 1px solid #E7EAF0; text-decoration: none; color: inherit; transition: background 0.2s;"
            onmouseover="this.style.background='#f9fafb'"
            onmouseout="this.style.background='white'"
          >
            <div style="font-weight: 600; color: var(--ink, #0b8073);">${escape(result.title)}</div>
            <div class="small" style="color: #6b7280; margin-top: 4px;">${escape(result.type)} ${result.location ? `· ${escape(result.location)}` : ''}</div>
          </a>
        `
          )
          .join('');

        resultsContainer.style.display = 'block';
      } catch (error) {
        if (isDevelopmentEnvironment()) {
          console.error('Search error:', error);
        }
        resultsContainer.style.display = 'none';
      }
    }, 300);
  });

  // Handle form submission
  form.addEventListener('submit', e => {
    e.preventDefault();
    const query = input.value.trim();
    if (query) {
      window.location.href = `/suppliers?q=${encodeURIComponent(query)}`;
    }
  });

  // Close results when clicking outside
  document.addEventListener('click', e => {
    if (!form.contains(e.target)) {
      resultsContainer.style.display = 'none';
    }
  });
}
*/

/**
 * Initialize newsletter signup form
 */
function initNewsletterForm() {
  const form = document.getElementById('newsletter-form');
  const emailInput = document.getElementById('newsletter-email');

  if (!form || !emailInput) {
    return;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const email = emailInput.value.trim();
    if (!email) {
      return;
    }

    try {
      const response = await fetch('/api/v1/newsletter/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        throw new Error('Subscription failed');
      }

      // Show success message
      form.innerHTML = `
        <div style="text-align: center; padding: 20px;">
          <div style="font-size: 48px; margin-bottom: 12px;">✓</div>
          <div style="font-size: 18px; font-weight: 600; color: white;">Thank you for subscribing!</div>
          <p style="margin-top: 8px; color: rgba(255,255,255,0.9);">Check your inbox for a confirmation email.</p>
        </div>
      `;
    } catch (error) {
      if (isDevelopmentEnvironment()) {
        console.error('Newsletter subscription error:', error);
      }

      // Show error message
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText =
        'margin-top: 12px; padding: 12px; background: rgba(255,255,255,0.2); border-radius: 8px; color: white; text-align: center;';
      errorDiv.textContent = 'Something went wrong. Please try again.';
      form.appendChild(errorDiv);

      setTimeout(() => {
        errorDiv.remove();
      }, 3000);
    }
  });
}

/**
 * Attach error event handlers to hero collage media elements.
 * CSP-safe replacement for inline onerror attributes.
 */
function initCollageErrorHandlers() {
  const video = document.getElementById('hero-pexels-video');
  if (video) {
    video.addEventListener('error', () => {
      video.style.display = 'none';
      if (video.nextElementSibling) {
        video.nextElementSibling.style.display = 'block';
      }
    });
  }

  const collageImages = [
    { id: 'collage-venues', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
    { id: 'collage-catering', gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
    { id: 'collage-entertainment', gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
    { id: 'collage-photography', gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
  ];

  collageImages.forEach(({ id, gradient }) => {
    const img = document.getElementById(id);
    if (img) {
      img.addEventListener('error', () => {
        img.style.background = gradient;
        img.style.minHeight = '200px';
        img.src = '';
      });
    }
  });
}

/**
 * Initialize parallax effect on collage
 */
function initParallaxCollage() {
  const collage = document.querySelector('.collage');
  if (!collage) {
    return;
  }

  // Add parallax on scroll
  let ticking = false;

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        const scrolled = window.pageYOffset;
        const rate = scrolled * 0.3;

        if (collage) {
          collage.style.transform = `translateY(${rate}px)`;
        }

        ticking = false;
      });

      ticking = true;
    }
  });
}
