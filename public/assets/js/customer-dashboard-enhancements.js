'use strict';
(function () {
  const WEDDING_ROOT_ID = 'wedding-website-dashboard-root';
  const SCRIPT_LOAD_TIMEOUT_MS = 6000;
  const WIDGET_TYPOGRAPHY_STYLES_ID = 'ww-typography-polish-styles';
  const WIDGET_TYPOGRAPHY_STYLES_HREF =
    '/assets/css/customer-wedding-widget-typography.css?v=1.1.0';
  const WIDGET_RENDER_POLISH_STYLES_ID = 'ww-render-polish-styles';
  const WIDGET_RENDER_POLISH_STYLES_HREF =
    '/assets/css/customer-wedding-widget-render-polish.css?v=1.0.0';
  const WIDGET_RENDER_REFINEMENTS_STYLES_ID = 'ww-render-refinements-styles';
  const WIDGET_RENDER_REFINEMENTS_STYLES_HREF =
    '/assets/css/customer-wedding-widget-render-refinements.css?v=1.0.0';
  const WIDGET_RENDER_PARITY_STYLES_ID = 'ww-render-parity-styles';
  const WIDGET_RENDER_PARITY_STYLES_HREF =
    '/assets/css/customer-wedding-widget-render-parity.css?v=1.0.0';
  const WIDGET_RENDER_FINAL_STYLES_ID = 'ww-render-final-styles';
  const WIDGET_RENDER_FINAL_STYLES_HREF =
    '/assets/css/customer-wedding-widget-render-final.css?v=1.0.0';
  const WIDGET_HEADER_SCROLL_FIX_STYLES_ID = 'ww-header-scroll-fix-styles';
  const WIDGET_HEADER_SCROLL_FIX_STYLES_HREF =
    '/assets/css/customer-wedding-widget-header-scroll-fix.css?v=1.0.1';
  const WIDGET_HEADER_SCROLL_QA_STYLES_ID = 'ww-header-scroll-qa-styles';
  const WIDGET_HEADER_SCROLL_QA_STYLES_HREF =
    '/assets/css/customer-wedding-widget-header-scroll-qa.css?v=1.0.0';
  const loadedScripts = new Set();
  const loadedStylesheets = new Set();

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

  function loadStylesheetOnce(id, href, requireWeddingRoot = true) {
    if (loadedStylesheets.has(id) || document.getElementById(id)) {
      loadedStylesheets.add(id);
      return true;
    }
    if (requireWeddingRoot && !hasWeddingWidgetRoot()) {
      return false;
    }
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    loadedStylesheets.add(id);
    return true;
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

  function loadWidgetTypographyPolish() {
    return loadStylesheetOnce(WIDGET_TYPOGRAPHY_STYLES_ID, WIDGET_TYPOGRAPHY_STYLES_HREF);
  }

  function loadWidgetRenderPolishStyles() {
    const loadedBase = loadStylesheetOnce(
      WIDGET_RENDER_POLISH_STYLES_ID,
      WIDGET_RENDER_POLISH_STYLES_HREF
    );
    const loadedRefinements = loadStylesheetOnce(
      WIDGET_RENDER_REFINEMENTS_STYLES_ID,
      WIDGET_RENDER_REFINEMENTS_STYLES_HREF
    );
    const loadedParity = loadStylesheetOnce(
      WIDGET_RENDER_PARITY_STYLES_ID,
      WIDGET_RENDER_PARITY_STYLES_HREF
    );
    const loadedFinal = loadStylesheetOnce(
      WIDGET_RENDER_FINAL_STYLES_ID,
      WIDGET_RENDER_FINAL_STYLES_HREF
    );
    const loadedHeaderScrollFix = loadStylesheetOnce(
      WIDGET_HEADER_SCROLL_FIX_STYLES_ID,
      WIDGET_HEADER_SCROLL_FIX_STYLES_HREF
    );
    const loadedHeaderScrollQa = loadStylesheetOnce(
      WIDGET_HEADER_SCROLL_QA_STYLES_ID,
      WIDGET_HEADER_SCROLL_QA_STYLES_HREF
    );
    return (
      loadedBase &&
      loadedRefinements &&
      loadedParity &&
      loadedFinal &&
      loadedHeaderScrollFix &&
      loadedHeaderScrollQa
    );
  }

  function loadWidgetRenderPolish() {
    loadWidgetRenderPolishStyles();
    return loadScriptOnce(
      'ww-render-polish-script',
      '/assets/js/pages/customer-wedding-widget-render-polish.js?v=1.0.1',
      false
    );
  }

  function loadPreviewPublishHardener() {
    return loadScriptOnce(
      'ww-preview-publish-hardener-script',
      '/assets/js/pages/customer-wedding-preview-publish-hardener.js?v=1.0.0',
      false
    );
  }

  function loadCardCtaEnhancer() {
    return loadScriptOnce(
      'ww-nav-card-fixes-script',
      '/assets/js/pages/customer-wedding-widget-nav-card-fixes.js?v=1.0.2',
      false
    );
  }

  function loadWidgetMediaStabiliser() {
    return loadScriptOnce(
      'ww-media-stabiliser-script',
      '/assets/js/pages/customer-wedding-widget-media-stabiliser.js?v=1.0.1',
      false
    );
  }

  function loadWidgetAppEnhancers() {
    loadWidgetTypographyPolish();
    loadWidgetRenderPolishStyles();
    return Promise.allSettled([
      loadWidgetMediaStabiliser(),
      loadWidgetRenderPolish(),
      loadPreviewPublishHardener(),
      loadScriptOnce(
        'ww-polish-enhancer-script',
        '/assets/js/pages/customer-wedding-widget-polish.js'
      ),
      loadScriptOnce(
        'ww-advanced-enhancer-script',
        '/assets/js/pages/customer-wedding-widget-share-builder.js'
      ),
      loadScriptOnce(
        'ww-product-upgrade-script',
        '/assets/js/pages/customer-wedding-widget-product-upgrade.js'
      ),
      loadScriptOnce(
        'ww-ux-polish-script',
        '/assets/js/pages/customer-wedding-widget-ux-polish.js'
      ),
      loadScriptOnce(
        'ww-svg-icons-script',
        '/assets/js/pages/customer-wedding-widget-svg-icons.js'
      ),
      loadScriptOnce(
        'ww-scroll-share-polish-script',
        '/assets/js/pages/customer-wedding-widget-scroll-share-polish.js'
      ),
      loadScriptOnce(
        'ww-link-theme-upgrade-script',
        '/assets/js/pages/customer-wedding-widget-link-themes-upgrade.js'
      ),
    ]).finally(() => {
      loadWidgetTypographyPolish();
      loadWidgetRenderPolishStyles();
    });
  }

  function loadWeddingWidgetPolish() {
    loadCardCtaEnhancer();
    loadWidgetMediaStabiliser();
    loadWidgetTypographyPolish();
    loadWidgetRenderPolish();
    loadPreviewPublishHardener();
    document.addEventListener(
      'click',
      event => {
        const target = event.target;
        const shouldLoad =
          target instanceof Element &&
          (target.closest('#ww-open-app') || target.closest('.ww-card-open-app-btn'));
        if (shouldLoad) {
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
