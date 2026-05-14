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

  function hasWeddingWidgetRoot() {
    return Boolean(document.getElementById(WEDDING_ROOT_ID));
  }

  function loadScriptOnce(id, src, requireWeddingRoot = true) {
    return new Promise(resolve => {
      if (loadedScripts.has(id) || document.getElementById(id)) {
        loadedScripts.add(id);
        resolve(true);
        return;
      }
      if (requireWeddingRoot && !hasWeddingWidgetRoot()) {
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
      script.onerror = () => finish(false);
      timeoutId = window.setTimeout(() => finish(false), SCRIPT_LOAD_TIMEOUT_MS);
      document.body.appendChild(script);
    });
  }

  function loadCardCtaEnhancer() {
    return loadScriptOnce('ww-nav-card-fixes-script', '/assets/js/pages/customer-wedding-widget-nav-card-fixes.js', false);
  }

  function loadWidgetAppEnhancers() {
    return Promise.allSettled([
      loadScriptOnce('ww-polish-enhancer-script', '/assets/js/pages/customer-wedding-widget-polish.js'),
      loadScriptOnce('ww-advanced-enhancer-script', '/assets/js/pages/customer-wedding-widget-share-builder.js'),
      loadScriptOnce('ww-product-upgrade-script', '/assets/js/pages/customer-wedding-widget-product-upgrade.js'),
      loadScriptOnce('ww-scroll-share-polish-script', '/assets/js/pages/customer-wedding-widget-scroll-share-polish.js'),
      loadScriptOnce('ww-link-theme-upgrade-script', '/assets/js/pages/customer-wedding-widget-link-themes-upgrade.js'),
    ]);
  }

  function loadWeddingWidgetPolish() {
    loadCardCtaEnhancer();
    document.addEventListener(
      'click',
      event => {
        const target = event.target;
        if (target instanceof Element && (target.closest('#ww-open-app') || target.closest('.ww-card-open-app-btn'))) {
          loadWidgetAppEnhancers();
        }
      },
      true
    );
    const dialogObserver = new MutationObserver((_, observer) => {
      if (document.querySelector('.ww-app-dialog')) {
        observer.disconnect();
        onIdle(() => loadWidgetAppEnhancers(), 250);
      }
    });
    dialogObserver.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => dialogObserver.disconnect(), 30000);
  }

  function setupProfileCompletionConfetti() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('profile_completed') === 'true' && typeof triggerSuccessConfetti === 'function') {
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
    loadWeddingWidgetPolish();
    setupProfileCompletionConfetti();
    onIdle(() => addRecommendationsWidget(), 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOptionalEnhancements);
  } else {
    initOptionalEnhancements();
  }
})();