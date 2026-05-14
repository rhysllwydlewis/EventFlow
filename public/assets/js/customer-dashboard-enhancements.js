/**
 * Customer Dashboard Enhancements
 * Adds recommendations widget and other P3 features
 */

(function () {
  'use strict';

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

  function loadScriptOnce(id, src) {
    if (document.getElementById(id)) {
      return;
    }
    if (!document.getElementById('wedding-website-dashboard-root')) {
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.defer = true;
    document.body.appendChild(script);
  }

  /**
   * Load the wedding widget enhancement modules after the base widget exists.
   * This keeps the dashboard HTML untouched while making the follow-up PR active.
   */
  function loadWeddingWidgetPolish() {
    loadScriptOnce('ww-polish-enhancer-script', '/assets/js/pages/customer-wedding-widget-polish.js');
    loadScriptOnce('ww-advanced-enhancer-script', '/assets/js/pages/customer-wedding-widget-share-builder.js');
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