/**
 * Map Fallback Handler
 * Detects Google Maps iframe load failures/timeouts and shows a user-friendly fallback.
 */
'use strict';
(function () {
  const MAP_TIMEOUT_MS = 10000; // 10 seconds

  function logMapError(reason) {
    if (window.Sentry && typeof window.Sentry.captureMessage === 'function') {
      window.Sentry.captureMessage('Map load failure', {
        level: 'warning',
        tags: { page: window.location.pathname, errorType: reason },
      });
    } else {
      console.warn('[Map] Map unavailable:', reason);
    }
  }

  function showMapFallback(mapShell, retryFn) {
    mapShell.innerHTML =
      '<div class="map-fallback" role="status" aria-live="polite" style="' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'min-height:200px;padding:2rem;text-align:center;' +
      'background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">' +
      '<div style="font-size:2rem;margin-bottom:0.75rem;">🗺️</div>' +
      '<p style="font-weight:600;margin:0 0 0.5rem;color:#374151;">Map unavailable — showing list view</p>' +
      '<p style="font-size: 0.875rem;color:#6b7280;margin:0 0 1rem;">Google Maps could not be loaded.</p>' +
      '<button id="map-retry-btn" class="cta secondary" type="button">Retry</button>' +
      '</div>';

    const retryBtn = mapShell.querySelector('#map-retry-btn');
    if (retryBtn && typeof retryFn === 'function') {
      retryBtn.addEventListener('click', retryFn);
    }
  }

  function initMap() {
    const mapShell = document.querySelector('.map-shell');
    let iframe = document.getElementById('venue-map');

    if (!mapShell || !iframe) {
      return;
    }

    // Capture original src and attributes for retry
    const originalSrc = iframe.src || '';
    const originalTitle = iframe.title || 'Map';
    let timeoutId = null;
    let loaded = false;

    function onLoaded() {
      if (loaded) {
        return;
      }
      loaded = true;
      clearTimeout(timeoutId);
    }

    function onFailed(reason) {
      if (loaded) {
        return;
      }
      loaded = true;
      clearTimeout(timeoutId);
      logMapError(reason);
      showMapFallback(mapShell, reinitMap);
    }

    function reinitMap() {
      loaded = false;
      const newIframe = document.createElement('iframe');
      newIframe.id = 'venue-map';
      newIframe.title = originalTitle;
      newIframe.loading = 'lazy';
      newIframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      newIframe.src = originalSrc;
      mapShell.innerHTML = '';
      mapShell.appendChild(newIframe);

      iframe = newIframe;
      iframe.addEventListener('load', onLoaded);
      iframe.addEventListener('error', () => {
        onFailed('iframe error event');
      });

      timeoutId = setTimeout(() => {
        onFailed('timeout');
      }, MAP_TIMEOUT_MS);
    }

    iframe.addEventListener('load', onLoaded);
    iframe.addEventListener('error', () => {
      onFailed('iframe error event');
    });

    // Start timeout
    timeoutId = setTimeout(() => {
      onFailed('timeout');
    }, MAP_TIMEOUT_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMap);
  } else {
    initMap();
  }
})();
