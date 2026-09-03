/**
 * Frontend Sentry Error Tracking Initialization
 * Initializes Sentry browser SDK for client-side error tracking.
 *
 * Configuration is read from (in priority order):
 *   1. window.EVENTFLOW_SENTRY_CONFIG (set explicitly by inline script)
 *   2. <meta name="sentry-dsn"> and <meta name="sentry-release"> tags
 *   3. /api/v1/config endpoint (falls back to this for dynamic DSN)
 */
'use strict';
(function () {
  /**
   * Read Sentry configuration from meta tags or window config
   * @returns {{ dsn: string|null, release: string|null, environment: string }}
   */
  function getStaticConfig() {
    // Prefer explicit window config
    if (window.EVENTFLOW_SENTRY_CONFIG) {
      return window.EVENTFLOW_SENTRY_CONFIG;
    }

    // Fall back to meta tags
    const dsnMeta = document.querySelector('meta[name="sentry-dsn"]');
    const releaseMeta = document.querySelector('meta[name="sentry-release"]');
    const envMeta = document.querySelector('meta[name="sentry-environment"]');

    const dsn = dsnMeta ? dsnMeta.getAttribute('content') : null;
    // Treat empty string as no DSN
    return {
      dsn: dsn || null,
      release: releaseMeta ? releaseMeta.getAttribute('content') : null,
      environment: envMeta ? envMeta.getAttribute('content') : 'production',
    };
  }

  /**
   * Initialize Sentry with the provided config
   * @param {{ dsn: string, release: string|null, environment: string }} config
   * @param {number} [attempt=0] Retry counter to cap infinite retries if SDK never loads
   */
  function doInit(config, attempt) {
    if (!config.dsn) {
      return;
    }

    const maxAttempts = 25; // 25 × 200 ms = 5 s max wait
    if (typeof window.Sentry === 'undefined') {
      if ((attempt || 0) < maxAttempts) {
        setTimeout(() => {
          doInit(config, (attempt || 0) + 1);
        }, 200);
      }
      return;
    }

    try {
      window.Sentry.init({
        dsn: config.dsn,
        environment: config.environment || 'production',
        release: config.release || undefined,
        // Sample 10% of sessions in production to limit event volume
        tracesSampleRate: config.environment === 'production' ? 0.1 : 1.0,
        // Filter out known noise before sending
        beforeSend: function (event) {
          // Drop cancelled network requests (e.g. user navigated away)
          if (
            event.exception &&
            event.exception.values &&
            event.exception.values.some(v => {
              return (
                v.type === 'AbortError' ||
                v.type === 'NetworkError' ||
                (v.value && v.value.includes('fetch'))
              );
            })
          ) {
            return null;
          }
          return event;
        },
      });
    } catch (err) {
      // Sentry init failure should never break the page
      console.warn('[EventFlow] Sentry browser init failed:', err);
    }
  }

  /**
   * Bootstrap: try static config first; fall back to /api/v1/config
   */
  function bootstrap() {
    const staticConfig = getStaticConfig();

    if (staticConfig.dsn) {
      doInit(staticConfig);
      return;
    }

    // No DSN in static config — try the public config API
    fetch('/api/v1/config')
      .then(r => {
        return r.json();
      })
      .then(data => {
        if (data && data.sentryDsn) {
          doInit({
            dsn: data.sentryDsn,
            release: data.version ? `eventflow@${data.version}` : null,
            environment: staticConfig.environment,
          });
          // Also populate EVENTFLOW_CONFIG for other consumers
          window.EVENTFLOW_CONFIG = window.EVENTFLOW_CONFIG || {};
          window.EVENTFLOW_CONFIG.hcaptchaSitekey = data.hcaptchaSitekey || '';
        }
      })
      .catch(() => {
        // Config fetch failed — Sentry stays disabled
      });
  }

  // Run after DOM is ready so meta tags are available
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
