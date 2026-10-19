'use strict';
(function () {
  function onIdle(callback, timeout) {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(callback, { timeout: timeout || 1500 });
      return;
    }
    window.setTimeout(callback, timeout || 250);
  }

  function addRecommendationsWidget() {
    if (document.getElementById('recommendations-widget')) {
      return;
    }
    const statsSection = document.querySelector('#customer-stats-grid');
    if (!statsSection) {
      return;
    }
    const widgetContainer = document.createElement('div');
    widgetContainer.id = 'recommendations-widget';
    widgetContainer.className = 'recommendations-widget';
    widgetContainer.hidden = true;
    statsSection.insertAdjacentElement('afterend', widgetContainer);
    if (window.RecommendationsWidget) {
      try {
        window.RecommendationsWidget.init();
      } catch (err) {
        console.warn('Recommendations widget failed to initialise:', err);
      }
    }
  }

  function setupProfileCompletionConfetti() {
    const params = new URLSearchParams(window.location.search);
    if (
      params.get('profile_completed') === 'true' &&
      typeof triggerSuccessConfetti === 'function'
    ) {
      setTimeout(() => {
        try {
          triggerSuccessConfetti();
        } catch (err) {
          console.warn('Profile completion confetti failed:', err);
        }
        window.history.replaceState({}, '', window.location.pathname);
      }, 500);
    }
  }

  function initOptionalEnhancements() {
    setupProfileCompletionConfetti();
    onIdle(() => addRecommendationsWidget(), 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOptionalEnhancements);
  } else {
    initOptionalEnhancements();
  }
})();
