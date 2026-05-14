/**
 * Customer Dashboard Enhancements
 * Adds recommendations widget and other P3 features
 */

(function () {
  'use strict';

  const WEDDING_ROOT_ID = 'wedding-website-dashboard-root';
  const SCRIPT_LOAD_TIMEOUT_MS = 6000;
  const loadedScripts = new Set();

  function onIdle(callback, timeout) {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(callback, { timeout: timeout || 1500 });
      return;
    }
    window.setTimeout(callback, timeout || 250);
  }

  /**
   * Add recommendations widget to dashboard.
   * Called directly after initCustomerDashboardWidgets completes rather than
   * using a MutationObserver, to avoid the 10-second timeout race condition.
   */
  function addRecommendationsWidget() {
    // Check if widget already exists
    if (document.getElementById('recommendations-widget')) {
      return;
    }

    const statsSection = document.querySelector('#customer-stats-grid');
    if (!statsSection) {
      console.warn('addRecommendationsWidget: #customer-stats-grid not found, skipping.');
      return;
    }

    // Create widget container
    const widgetContainer = document.createElement('div');
    widgetContainer.id = 'recommendations-widget';
    widgetContainer.className = 'recommendations-widget';
    // Start hidden — RecommendationsWidget.init() will toggle visibility via its own
    // internal logic once data is fetched (see recommendations-widget.js)
    widgetContainer.hidden = true;

    // Insert after stats section
    statsSection.insertAdjacentElement('afterend', widgetContainer);

    // Initialize the widget
    if (window.RecommendationsWidget) {
      window.RecommendationsWidget.init();
    }
  }

  function hasWeddingWidgetRoot() {
    return Boolean(document.getElementById(WEDDING_ROOT_ID));
  }

  function loadScriptOnce(id, src) {
    return new Promise(resolve => {
      if (loadedScripts.has(id) || document.getElementById(id)) {
        loadedScripts.add(id);
        resolve(true);
        return;
      }
      if (!hasWeddingWidgetRoot()) {
        resolve(false);
        return;
      }

      const script = document.createElement('script');
      let settled = false;
      let timeoutId = null;
      const finish = loaded => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        if (loaded) {
          loadedScripts.add(id);
        }
        resolve(loaded);
      };

      script.id = id;
      script.src = src;
      script.async = true;
      script.onload = () => finish(true);
      script.onerror = () => {
        console.warn(`Wedding widget enhancement failed to load: ${src}`);
        finish(false);
      };
      timeoutId = window.setTimeout(() => {
        console.warn(`Wedding widget enhancement timed out: ${src}`);
        finish(false);
      }, SCRIPT_LOAD_TIMEOUT_MS);
      document.body.appendChild(script);
    });
  }

  function loadCardCtaEnhancer() {
    return loadScriptOnce(
      'ww-nav-card-fixes-script',
      '/assets/js/pages/customer-wedding-widget-nav-card-fixes.js'
    );
  }

  function loadWidgetAppEnhancers() {
    return Promise.allSettled([
      loadScriptOnce('ww-polish-enhancer-script', '/assets/js/pages/customer-wedding-widget-polish.js'),
      loadScriptOnce('ww-advanced-enhancer-script', '/assets/js/pages/customer-wedding-widget-share-builder.js'),
    ]);
  }

  /**
   * Keep dashboard boot light: load only the small card CTA fix after idle, then
   * load heavier widget-app enhancers only when the Wedding Website app opens.
   */
  function loadWeddingWidgetPolish() {
    if (!hasWeddingWidgetRoot()) {
      return;
    }

    onIdle(() => {
      loadCardCtaEnhancer();
    }, 1200);

    document.addEventListener(
      'click',
      event => {
        const target = event.target;
        if (
          target instanceof Element &&
          (target.closest('#ww-open-app') || target.closest('.ww-card-open-app-btn'))
        ) {
          loadWidgetAppEnhancers();
        }
      },
      true
    );

    const dialogObserver = new MutationObserver((_, observer) => {
      if (document.querySelector('.ww-app-dialog')) {
        observer.disconnect();
        onIdle(() => {
          loadWidgetAppEnhancers();
        }, 250);
      }
    });
    dialogObserver.observe(document.body, { childList: true, subtree: true });

    window.setTimeout(() => dialogObserver.disconnect(), 30000);
  }

  /**
   * Trigger confetti on profile completion
   */
  function setupProfileCompletionConfetti() {
    // Check if profile was just completed
    const params = new URLSearchParams(window.location.search);
    if (
      params.get('profile_completed') === 'true' &&
      typeof triggerSuccessConfetti === 'function'
    ) {
      // Small delay for page to load
      setTimeout(() => {
        try {
          triggerSuccessConfetti();
        } catch (err) {
          console.warn(
            'setupProfileCompletionConfetti: confetti call failed (canvas-confetti may not have loaded):',
            err
          );
        }
        // Remove param from URL
        window.history.replaceState({}, '', window.location.pathname);
      }, 500);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      addRecommendationsWidget();
      loadWeddingWidgetPolish();
      setupProfileCompletionConfetti();
    });
  } else {
    addRecommendationsWidget();
    loadWeddingWidgetPolish();
    setupProfileCompletionConfetti();
  }
})();