/**
 * EventFlow shared hero collage module.
 *
 * Owns the homepage hero collage and its hidden video card: the admin collage
 * widget (`/api/v1/public/homepage-settings`), the legacy Pexels path, media
 * cycling, creator credits, lazy loading and the stall watchdog.
 *
 * Extracted verbatim from `pages/home-init.js` so both homepages can share it.
 * `home-init.js` (V1) and `pages/home-v2-hero.js` (V2) drive it through the
 * `window.EFHeroCollage` facade at the bottom of this file.
 *
 * Load this BEFORE any script that calls into it — the entry points and the
 * `isDebugEnabled` / `isDevelopmentEnvironment` helpers are declared here as
 * globals, matching the non-module script style used across `public/assets/js`.
 */

// Video performance metrics tracker. Declared defensively because this module
// loads ahead of `home-init.js` on V1 and runs without it entirely on V2.
window.__videoMetrics__ = window.__videoMetrics__ || {
  heroVideoAttempts: 0,
  heroVideoSuccesses: 0,
  heroVideoFailures: 0,
  collageVideoAttempts: 0,
  collageVideoSuccesses: 0,
  collageVideoFailures: 0,
  lastError: null,
};

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
function supportsWebP() {
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

/** `sizes` to fall back on when a frame has not been laid out yet. */
const COLLAGE_ESTIMATED_SIZES = '(max-width: 768px) 48vw, 25vw';

/**
 * Rendered CSS width of a collage frame.
 *
 * The frames are not all the same size. Homepage V2 gives its feature card
 * roughly twice the width of the others, so anything choosing an image
 * resolution has to measure rather than assume every frame is 25vw.
 *
 * @param {Element|null} element - Frame or the image inside it
 * @returns {number} Width in CSS pixels, or 0 when it cannot be measured
 */
function measureCollageSlotWidth(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') {
    return 0;
  }

  const { width } = element.getBoundingClientRect();
  return Number.isFinite(width) && width > 0 ? width : 0;
}

/**
 * `sizes` for a collage image, from its own rendered width.
 *
 * Expressed in `vw` rather than `px` so it still holds after a resize — the
 * collage is laid out in percentages, so a frame keeps its share of the
 * viewport.
 *
 * @param {Element|null} element - Frame or the image inside it
 * @returns {string}
 */
function collageSlotSizes(element) {
  const width = measureCollageSlotWidth(element);
  const viewportWidth = window.innerWidth;

  if (width <= 0 || !viewportWidth) {
    return COLLAGE_ESTIMATED_SIZES;
  }

  return `${Math.min(100, Math.ceil((width / viewportWidth) * 100))}vw`;
}

/**
 * Get optimal Pexels image size based on the target frame and device pixel ratio
 * @param {Object} photoSrc - Pexels photo.src object
 * @param {number} [slotWidth] - Measured frame width in CSS pixels. Falls back
 *   to the viewport estimate when the frame has not been laid out.
 * @returns {string} Optimal image URL
 */
function getOptimalPexelsImageSize(photoSrc, slotWidth = 0) {
  if (!photoSrc) {
    return null;
  }

  const dpr = window.devicePixelRatio || 1;
  const viewportWidth = window.innerWidth;

  // Calculate effective width needed (accounting for DPR)
  // Collage frames are typically 40-50% of viewport width on mobile
  const estimatedWidth = viewportWidth <= 768 ? viewportWidth * 0.48 : viewportWidth * 0.25;
  const frameWidth = slotWidth > 0 ? slotWidth : estimatedWidth;
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
    // Match the host, not a suffix of it: `endsWith('pexels.com')` also accepts
    // `evilpexels.com`, so an attacker-chosen host could become the credit
    // link's href. Compare the apex exactly and require a dot before it for
    // subdomains.
    const { hostname } = urlObj;
    const isPexelsHost = hostname === 'pexels.com' || hostname.endsWith('.pexels.com');
    if (urlObj.protocol === 'https:' && isPexelsHost) {
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

    // Add sizes attribute for optimal image selection, measured from the frame
    // the image actually occupies rather than assumed.
    imgElement.sizes = collageSlotSizes(frame || imgElement);
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
          // Measure the frame this category lands in: the frames are not all
          // the same width, so the viewport estimate would under-resolve the
          // larger ones.
          const slotWidth = measureCollageSlotWidth(collageFrames[categoryMapping[category]]);

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
              url:
                getOptimalPexelsImageSize(photo.src, slotWidth) ||
                photo.src.large ||
                photo.src.original,
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
async function initHeroVideo(
  source,
  mediaTypes,
  uploadGallery = [],
  heroVideoConfig = {},
  selectedHeroMedia = null
) {
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

  // Add loading state and keep autoplay browser-safe.
  const shouldAutoplay = heroVideoConfig.autoplay !== false;
  if (shouldAutoplay) {
    videoElement.muted = true;
    videoElement.setAttribute('muted', '');
  }
  videoElement.setAttribute('playsinline', '');
  if (videoCard) {
    videoCard.classList.add('loading-video');
  }

  try {
    if (selectedHeroMedia?.type === 'video' && selectedHeroMedia.url) {
      const fallbackEnabled =
        source === 'selected_with_fallback' || heroVideoConfig.fallbackToPexels === true;
      const fallbackToAutomaticHero = () => {
        videoElement.removeEventListener('error', fallbackToAutomaticHero);
        videoSource.src = '';
        videoElement.removeAttribute('poster');
        videoElement.load();
        if (fallbackEnabled) {
          if (isDebugEnabled()) {
            console.warn(
              '[Hero Video] Selected hero video failed; falling back to automatic Pexels video'
            );
          }
          initHeroVideo('pexels', mediaTypes, uploadGallery, heroVideoConfig, null);
        } else if (videoCard) {
          videoCard.classList.remove('loading-video');
        }
      };
      videoElement.addEventListener(
        'loadeddata',
        () => {
          if (videoCard) {
            videoCard.classList.remove('loading-video');
          }
          videoElement.classList.add('video-loaded');
        },
        { once: true }
      );
      videoElement.addEventListener('error', fallbackToAutomaticHero, { once: true });
      videoSource.src = selectedHeroMedia.url;
      if (selectedHeroMedia.thumbnailUrl) {
        videoElement.poster = selectedHeroMedia.thumbnailUrl;
      } else {
        videoElement.removeAttribute('poster');
      }
      videoElement.load();
      if (videoCredit) {
        videoCredit.textContent = '';
        videoCredit.style.display = 'none';
      }
      if (shouldAutoplay) {
        videoElement.play().catch(() => {
          if (isDebugEnabled()) {
            console.log('[Hero Video] Autoplay prevented for selected media');
          }
        });
      }
      return;
    }

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

        if (shouldAutoplay) {
          videoElement.play().catch(() => {
            if (isDebugEnabled()) {
              console.log('[Hero Video] Autoplay prevented, video will play on user interaction');
            }
          });
        }
        videoCredit.style.display = 'none'; // No credit for uploaded videos
        return;
      }
    }

    if (
      (source === 'pexels' || source === 'uploads' || source === 'selected_with_fallback') &&
      useVideos
    ) {
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
              console.log('[Hero Video] Video loaded successfully');
            }
            if (shouldAutoplay) {
              videoElement.play().catch(err => {
                if (isDebugEnabled()) {
                  console.log('[Hero Video] Autoplay prevented:', err.message);
                }
              });
            }
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
 * Mobile media guardrail (SEO-006 / SEO-011).
 *
 * A mobile lab run against the homepage measured ~32MB transferred and a
 * 14s LCP. `.hero-video-card` above is `display: none !important` on
 * every viewport ("Video card - HIDDEN (removed from layout)") — yet
 * `initHeroVideo` unconditionally fetched the Pexels API, assigned a real
 * `<source src>` and called `.load()`/`.play()` for it regardless of
 * viewport. A hidden element that still pulls a full video payload is the
 * defect the audit flagged — a confirmed performance/UX bug, not a proven
 * ranking effect.
 *
 * `HERO_VIDEO_MOBILE_BREAKPOINT_PX` matches the breakpoint already used
 * elsewhere for mobile decisions in this codebase (768px — see
 * `COLLAGE_ESTIMATED_SIZES` above and `utils/mobile-enhancements.js`).
 */
const HERO_VIDEO_MOBILE_BREAKPOINT_PX = 768;

/**
 * True when the viewport is at or below the site's mobile breakpoint.
 * @returns {boolean}
 */
function isHeroVideoMobileViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(`(max-width: ${HERO_VIDEO_MOBILE_BREAKPOINT_PX}px)`).matches === true;
}

/**
 * True only when `.hero-video-card` is actually something a visitor could
 * see or tap: not `display: none` (hero-modern.css currently hides it
 * with an unconditional `!important` rule, on every viewport, on both
 * index.html and home-v2.html — "Video card - HIDDEN (removed from
 * layout)") and not nested inside an `inert` ancestor (index.html wraps
 * the whole `.hero-collage` in `inert`, which also blocks the click/
 * touchend listeners `armHeroVideoForInteraction` relies on). Without this
 * check, `resolveHeroVideoLoadMode` would still return `'eager'` on
 * desktop and fetch a full video payload for an element nobody can ever
 * see — the exact defect SEO-006/SEO-011 flagged, just unfixed outside
 * the mobile breakpoint.
 * @param {Element|null} videoCard
 * @returns {boolean}
 */
function isHeroVideoCardReachable(videoCard) {
  if (
    !videoCard ||
    typeof window === 'undefined' ||
    typeof window.getComputedStyle !== 'function'
  ) {
    return false;
  }
  if (typeof videoCard.closest === 'function' && videoCard.closest('[inert]')) {
    return false;
  }
  return window.getComputedStyle(videoCard).display !== 'none';
}

/**
 * Decide whether the hero video's real `<source>` should be attached the
 * moment the collage initialises, only after the visitor interacts with
 * it, or never. A pure function of its inputs so the decision table can be
 * unit tested without a DOM.
 *
 * - `'skip'` — feature disabled, `prefers-reduced-motion`,
 *   `prefers-reduced-data` / Save-Data, or the card isn't actually
 *   reachable (hidden/inert) regardless of viewport.
 * - `'interaction'` — attach the real source only once the visitor
 *   explicitly taps/clicks the card. Unconditional on viewport width: an
 *   older stored homepage-settings record with
 *   `mobileOptimizations.disableVideos: false` (the pre-fix default)
 *   cannot bypass this. That admin flag may only add MORE restriction on
 *   top of the mobile guardrail, never less — this check runs regardless
 *   of what it says.
 * - `'eager'` — load immediately, matching pre-guardrail behaviour.
 *
 * @param {object} [context]
 * @param {boolean} [context.heroVideoEnabled]
 * @param {boolean} [context.prefersReducedMotion]
 * @param {boolean} [context.prefersReducedData]
 * @param {boolean} [context.saveData]
 * @param {boolean} [context.isMobileViewport]
 * @param {boolean} [context.isCardReachable]
 * @returns {'eager'|'interaction'|'skip'}
 */
function resolveHeroVideoLoadMode({
  heroVideoEnabled = true,
  prefersReducedMotion = false,
  prefersReducedData = false,
  saveData = false,
  isMobileViewport = false,
  isCardReachable = true,
} = {}) {
  if (heroVideoEnabled === false) {
    return 'skip';
  }
  if (prefersReducedMotion) {
    return 'skip';
  }
  if (prefersReducedData || saveData) {
    return 'skip';
  }
  if (!isCardReachable) {
    return 'skip';
  }
  if (isMobileViewport) {
    return 'interaction';
  }
  return 'eager';
}

/**
 * Wire the hero video card so its real `<source>` is attached only once a
 * visitor genuinely interacts with it — never on page load. `initHeroVideo`
 * itself is unchanged; this only decides *when* it is allowed to run.
 * Callers only reach this in the `'interaction'` branch, which
 * `resolveHeroVideoLoadMode` only returns when `isCardReachable` is true —
 * i.e. the card is neither `display: none` nor behind an `inert`
 * ancestor, so it can genuinely receive a click/touchend.
 *
 * @param {Array} initHeroVideoArgs - Positional args for `initHeroVideo`.
 */
function armHeroVideoForInteraction(initHeroVideoArgs) {
  const videoCard = document.querySelector('.hero-video-card');
  const videoElement = document.getElementById('hero-pexels-video');
  if (!videoCard || !videoElement) {
    return;
  }

  let triggered = false;
  const startRealLoad = () => {
    if (triggered) {
      return;
    }
    triggered = true;
    videoCard.removeEventListener('click', startRealLoad);
    videoCard.removeEventListener('touchend', startRealLoad);
    initHeroVideo(...initHeroVideoArgs);
  };

  videoCard.addEventListener('click', startRealLoad);
  videoCard.addEventListener('touchend', startRealLoad, { passive: true });
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

  const saveData = navigator.connection?.saveData === true;

  if (prefersReducedMotion && isDevelopmentEnvironment()) {
    console.log('User prefers reduced motion, hero video will not load');
  }
  if ((prefersReducedData || saveData) && isDevelopmentEnvironment()) {
    console.log('User prefers reduced data, skipping external media (Pexels API)');
  }

  const heroVideoLoadMode = resolveHeroVideoLoadMode({
    heroVideoEnabled: (heroVideo || {}).enabled !== false,
    prefersReducedMotion,
    prefersReducedData,
    saveData,
    isMobileViewport: isHeroVideoMobileViewport(),
    isCardReachable: isHeroVideoCardReachable(document.querySelector('.hero-video-card')),
  });
  const heroVideoInitArgs = [
    source,
    effectiveMediaTypes,
    uploadGallery,
    { ...(heroVideo || {}), fallbackToPexels },
    widgetConfig.heroSelectedMedia || null,
  ];

  if (heroVideoLoadMode === 'eager') {
    await initHeroVideo(...heroVideoInitArgs);
  } else if (heroVideoLoadMode === 'interaction') {
    // Mobile guardrail (SEO-006/SEO-011): only attach the real <source>
    // once the visitor interacts with the hero video card, so mobile never
    // requests video bytes for an element that ships hidden by default.
    armHeroVideoForInteraction(heroVideoInitArgs);
    if (isDevelopmentEnvironment()) {
      console.log('[Hero Video] Deferred until interaction (mobile viewport)');
    }
  } else if (isDevelopmentEnvironment()) {
    console.log('[Hero Video] Skipped (disabled, reduced motion, or reduced/save data)');
  }

  try {
    const mediaCache = {};
    const currentMediaIndex = {};

    const selectedMedia = Array.isArray(widgetConfig.selectedMedia)
      ? widgetConfig.selectedMedia
      : [];
    const selectedMediaSource = source === 'selected' || source === 'selected_with_fallback';

    // Load selected media first when configured. Fallback-capable modes can append Pexels below.
    if (selectedMediaSource && selectedMedia.length > 0) {
      const categories = Object.keys(categoryMapping);
      categories.forEach((category, index) => {
        mediaCache[category] = selectedMedia
          .filter(
            item =>
              (item.assignedTargets || ['collage']).includes('collage') ||
              (item.assignedTargets || []).includes('general')
          )
          .filter((_, i) => i % categories.length === index)
          .map(item => ({
            url: item.url,
            type: item.type || 'photo',
            thumbnail: item.thumbnailUrl,
            photographer: item.photographer || 'Pexels',
            photographerUrl: item.pexelsUrl,
            category,
            width: item.width,
            height: item.height,
            duration: item.duration,
          }));
        currentMediaIndex[category] = 0;
      });
    }

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
    }

    const shouldFetchPexelsMedia =
      source === 'pexels' ||
      (fallbackToPexels &&
        source === 'uploads' &&
        (!uploadGallery || uploadGallery.length === 0)) ||
      (fallbackToPexels && source === 'selected_with_fallback');

    if (shouldFetchPexelsMedia && !prefersReducedData && !saveData) {
      // Use Pexels API (fallback or primary) - but skip if user prefers reduced/save data
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
          // Mobile guardrail: never request video media for the visible
          // collage cards on mobile. `mediaTypes` (unlike
          // `effectiveMediaTypes` above) is not adjusted by the admin's
          // `mobileOptimizations.disableVideos` flag, so without this the
          // collage cards would download video on mobile even when that
          // flag is left at its default `false`. See
          // resolveHeroVideoLoadMode's doc comment for why the guardrail
          // itself can't be bypassed by a stale stored setting.
          const requestVideos = mediaTypes?.videos !== false && !isHeroVideoMobileViewport();

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

          // Measure the frame this category lands in: the frames are not all
          // the same width, so the viewport estimate would under-resolve the
          // larger ones.
          const slotWidth = measureCollageSlotWidth(collageFrames[categoryMapping[category]]);

          if (data.photos && Array.isArray(data.photos) && data.photos.length > 0) {
            const photos = data.photos
              .filter(photo => photo && photo.src && photo.photographer)
              .map(photo => ({
                url:
                  getOptimalPexelsImageSize(photo.src, slotWidth) ||
                  photo.src.large ||
                  photo.src.original,
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
            const existingMedia = mediaCache[category] || [];
            const existingUrls = new Set(existingMedia.map(item => item.url));
            mediaCache[category] = [
              ...existingMedia,
              ...allMedia.filter(item => !existingUrls.has(item.url)),
            ];

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
    }

    // Mobile guardrail (SEO-006/SEO-011): strip any video item out of every
    // category's cache before it can become the collage's initial or
    // cycled-to media, regardless of which source produced it (Pexels,
    // admin-selected media, or an uploaded gallery). Filtering here — after
    // every source above has finished populating `mediaCache` — is the one
    // choke point that covers all of them without patching each builder
    // separately, and it cannot be bypassed by an older stored
    // homepage-settings record that still says videos are enabled.
    if (isHeroVideoMobileViewport()) {
      for (const category of Object.keys(mediaCache)) {
        mediaCache[category] = (mediaCache[category] || []).filter(item => item.type !== 'video');
      }
    }

    if (Object.keys(mediaCache).length === 0) {
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
function loadMediaIntoFrame(
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
          mediaElement.sizes = collageSlotSizes(frame || mediaElement);
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
          mediaElement.sizes = collageSlotSizes(frame || mediaElement);
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
      () => {
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
function addCreatorCredit(frame) {
  // Design decision: the hero collage no longer surfaces on-image
  // photographer/videographer credit text. Kept as a no-op (rather than
  // removing all call sites) so existing callers and removeCreatorCredit's
  // cleanup of stray .pexels-credit nodes keep working unchanged.
  if (!frame) {
    return;
  }

  const existingCredit = frame.querySelector('.pexels-credit');
  if (existingCredit) {
    existingCredit.remove();
  }
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
  const collage = document.querySelector('.hero-collage');
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

// Log collage script load in debug mode only
if (isDebugEnabled()) {
  console.log('[Collage Debug] collage script loaded');
}

/**
 * Public facade. Keep these names stable — `home-init.js` and
 * `home-v2-hero.js` are the only callers.
 */
window.EFHeroCollage = {
  load: loadHeroCollageImages,
  cleanup: cleanupPexelsCollage,
  initErrorHandlers: initCollageErrorHandlers,
  initParallax: initParallaxCollage,
  validateUploadUrl,
  validatePexelsUrl,
};
