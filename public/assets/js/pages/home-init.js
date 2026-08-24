/**
 * Homepage initialization script
 * Handles stats counters, notifications, and interactive elements
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
  // Category grid: homepage-approved-lower.js owns #category-grid-home on
  // the production homepage (it fetches the same /api/v1/categories data
  // and renders it with the approved markup), so CategoryGrid is not
  // instantiated here to avoid a duplicate fetch and a competing render.

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
