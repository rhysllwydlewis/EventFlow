/**
 * EventFlow seasonal navbar — loader.
 *
 * Loaded by navbar.js on every public page. It asks the server one question
 * (GET /api/public/seasonal-theme: which theme, if any?) and does nothing at all
 * unless the answer is a theme, so for most of the year this is the whole cost.
 * When a theme is on it downloads the artwork and stylesheet and dresses the
 * header. Any failure — no header on the page, a network error, an unknown
 * theme — leaves the header exactly as it was.
 *
 * Which theme applies, and when it switches over, is decided on the server from
 * the admin's settings and the UK date (services/seasonalTheme.service.js).
 */
'use strict';
(function () {
  if (window.__efSeasonalTheme) {
    return;
  }
  window.__efSeasonalTheme = true;

  const ENDPOINT = '/api/public/seasonal-theme';
  const ASSET_VERSION = '1.0.0';
  const THEME_KEY = /^[a-z]+(?:-[a-z]+)*$/;
  const HEADER_WAIT_MS = 6000;

  /** Resolves with the public header once it exists, or null if this page has none. */
  function whenHeaderReady() {
    return new Promise(resolve => {
      const find = () => {
        const header = document.querySelector('.ef-header');
        return header?.querySelector('.ef-brand-text') ? header : null;
      };
      const found = find();
      if (found) {
        resolve(found);
        return;
      }
      if (document.readyState === 'complete') {
        resolve(null);
        return;
      }
      const observer = new MutationObserver(() => {
        const header = find();
        if (header) {
          observer.disconnect();
          resolve(header);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.setTimeout(() => {
        observer.disconnect();
        resolve(find());
      }, HEADER_WAIT_MS);
    });
  }

  /** Resolves once the stylesheet has loaded, so the header is never dressed before it is styled. */
  function loadStylesheet() {
    return new Promise((resolve, reject) => {
      let link = document.querySelector('link[data-eventflow-seasonal]');
      if (link?.sheet) {
        resolve();
        return;
      }
      if (!link) {
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `/assets/css/seasonal-theme.css?v=${ASSET_VERSION}`;
        link.dataset.eventflowSeasonal = 'true';
        document.head.appendChild(link);
      }
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', reject, { once: true });
    });
  }

  function loadArt() {
    if (window.EFSeasonalArt) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `/assets/js/seasonal-theme-art.js?v=${ASSET_VERSION}`;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function init() {
    try {
      // Pages without the public header (admin, dashboards) never reach the server.
      const header = await whenHeaderReady();
      if (!header) {
        return;
      }
      const response = await fetch(ENDPOINT, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return;
      }
      const { theme } = await response.json();
      if (typeof theme !== 'string' || !THEME_KEY.test(theme)) {
        return;
      }
      // Both must arrive before anything is added to the header; if either fails
      // the header is left exactly as it was.
      await Promise.all([loadStylesheet(), loadArt()]);
      const reduceMotion =
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.EFSeasonalArt.apply(header, theme, { animate: !reduceMotion });
    } catch {
      // Decorative only: stay plain.
    }
  }

  init();
})();
