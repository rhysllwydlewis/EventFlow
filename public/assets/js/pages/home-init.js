/**
 * Homepage initialization script
 * Handles featured packages, stats counters, notifications, and interactive elements
 */

// Set page identifier
window.__EF_PAGE__ = 'home';

// Video performance metrics tracker
window.__videoMetrics__ = window.__videoMetrics__ || {
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
      // Debug mode: reveal version container and set placeholder text
      const wrap = document.getElementById('ef-version-wrap') || versionContainer;
      if (wrap) {
        wrap.removeAttribute('hidden');
        wrap.removeAttribute('aria-hidden');
        wrap.style.display = '';
      }
      const versionLabel = document.getElementById('ef-version-label');
      if (versionLabel) {
        versionLabel.textContent = '18.1.0 (debug)';
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
      <div style="margin-top: 8px; font-size: 11px; opacity: 0.7;">
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
          ${m.lastError ? `<div style="color: #ef4444; margin-top: 5px; font-size: 11px;">⚠️ ${m.lastError}</div>` : ''}
        `;
      }
    };

    // Initial update
    setTimeout(updateMetrics, 1000);
    // Update every 2 seconds
    setInterval(updateMetrics, 2000);
  }

  // Load and update hero collage images from admin-uploaded category photos
  window.EFHeroCollage.load();

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
        // Throttle disconnect toasts: a flappy connection should not spam.
        // See Part B5 in the notification-audit checklist.
        let lastDisconnectToastAt = 0;
        const DISCONNECT_TOAST_THROTTLE_MS = 10 * 1000;

        // WebSocket client is initialized here for real-time notification updates
        const _wsClient = new WebSocketClient({
          onConnect: ({ isReconnect } = {}) => {
            // Only show a toast on reconnect; the first-connect case is
            // silent on the homepage (no dedicated "live" UI to announce).
            if (isReconnect && window.NotificationDispatcher) {
              window.NotificationDispatcher.success('Live updates reconnected', 2000);
            }
          },
          onDisconnect: reason => {
            const now = Date.now();
            if (now - lastDisconnectToastAt < DISCONNECT_TOAST_THROTTLE_MS) {
              return;
            }
            lastDisconnectToastAt = now;
            if (window.NotificationDispatcher) {
              window.NotificationDispatcher.warning(
                `Live updates disconnected (${reason || 'unknown'}) — retrying...`,
                3000
              );
            }
          },
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
  window.EFHeroCollage.initErrorHandlers();

  // Cookie preferences button is wired automatically via data-cookie-prefs attribute
  // by cookie-consent.js's bindPrefsButtons() — no manual handler needed here.

  // Add parallax effect to collage
  window.EFHeroCollage.initParallax();

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
    window.EFHeroCollage.cleanup();
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
      window.EFHeroCollage.load();
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
    window.EFHeroCollage.load();
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
      window.EFHeroCollage.load();
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
      const price = rawPrice ? _esc(rawPrice) : '<span class="price-not-set">Price not set</span>';
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
          <a href="/package/${slug}" class="featured-fallback-link">
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
    section.hidden = true;
    section.style.display = 'none';
    section.setAttribute('aria-hidden', 'true');
  }
}

/**
 * Helper to update stats UI with given values
 */
function updateStatsUI(stats) {
  const section = document.getElementById('stats-section');
  const statItems = document.querySelectorAll('.ef-stat');
  if (!section || statItems.length < 4) {
    return;
  }

  const counters = [
    { value: Number(stats.suppliersVerified) || 0, suffix: '+' },
    { value: Number(stats.packagesApproved) || 0, suffix: '+' },
    { value: Number(stats.marketplaceListingsActive) || 0, suffix: '+' },
    { value: Number(stats.reviewsApproved) || 0, suffix: '+' },
  ];
  const hasVisibleStat = counters.some(counter => counter.value > 0);

  if (!hasVisibleStat) {
    hideStatsSection();
    return;
  }

  section.hidden = false;
  section.style.display = '';
  section.removeAttribute('aria-hidden');

  statItems.forEach((item, index) => {
    const counterEl = item.querySelector('.ef-stat__number');
    const stat = counters[index];
    if (!counterEl || !stat) {
      return;
    }

    if (stat.value <= 0) {
      item.hidden = true;
      item.style.display = 'none';
      item.setAttribute('aria-hidden', 'true');
      return;
    }

    item.hidden = false;
    item.style.display = '';
    item.removeAttribute('aria-hidden');
    counterEl.setAttribute('data-counter', String(stat.value));
    counterEl.setAttribute('data-suffix', stat.suffix);

    if (counterEl.dataset.counted) {
      counterEl.textContent = `${stat.value.toLocaleString('en-GB')}${stat.suffix}`;
    }
  });
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
                <h3 style="margin: 0; font-size: 1.125rem;">${escape(listing.title || 'Marketplace listing')}</h3>
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
          <h3 style="margin: 0 0 0.5rem 0; font-size: 1.125rem;">
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
      errorDiv.className = 'home-hero-error-msg';
      errorDiv.textContent = 'Something went wrong. Please try again.';
      form.appendChild(errorDiv);

      setTimeout(() => {
        errorDiv.remove();
      }, 3000);
    }
  });
}

