/**
 * Homepage V2 hero bootstrap.
 *
 * V2 carries the same hero markup as V1 but not `home-init.js`, which owns
 * everything else on the V1 page. This is the V2-side driver for the shared
 * collage module, mirroring the calls `home-init.js` makes: the initial load,
 * the CSP-safe media error handlers, the parallax enhancement, and the unload
 * cleanup that stops the cycling interval and its watchdog.
 *
 * The retry ladder (`load`/`online` fallbacks) lives here too because the
 * collage silently no-ops when the settings fetch fails on a cold connection,
 * and `EFHeroCollage.load` guards itself with `window.__collageWidgetInitialized`.
 */
(() => {
  'use strict';

  function collage() {
    return window.EFHeroCollage || null;
  }

  function load() {
    const api = collage();
    if (api) {
      api.load();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const api = collage();
    if (!api) {
      return;
    }

    api.load();
    api.initErrorHandlers();
    api.initParallax();

    window.addEventListener('beforeunload', () => api.cleanup());
  });

  window.addEventListener('load', () => {
    if (!window.__collageWidgetInitialized) {
      load();
    }
  });

  window.addEventListener('online', () => {
    if (!window.__collageWidgetInitialized) {
      // Small delay so the connection has settled before the settings fetch.
      window.setTimeout(load, 500);
    }
  });
})();
