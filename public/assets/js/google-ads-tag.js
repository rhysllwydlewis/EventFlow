/**
 * Google Ads tag (gtag.js) for conversion tracking.
 *
 * Loaded on every non-admin page by the server (see
 * injectGlobalAnalyticsScripts in utils/template-renderer.js), but the
 * third-party loader itself only runs once the visitor has granted
 * analytics consent, matching the gating behaviour-analytics.js and
 * analytics-consent-upgrade.js already use for PostHog.
 */
'use strict';

(function () {
  const GOOGLE_ADS_ID = 'AW-16705708195';
  let loaded = false;

  function hasAnalyticsConsent() {
    if (!window.CookieConsent || typeof window.CookieConsent.getConsent !== 'function') {
      return false;
    }
    try {
      const consent = window.CookieConsent.getConsent();
      return Boolean(consent?.analytics);
    } catch {
      return false;
    }
  }

  function loadGoogleAdsTag() {
    if (loaded || !hasAnalyticsConsent()) {
      return;
    }
    loaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag =
      window.gtag ||
      function gtag(...args) {
        window.dataLayer.push(args);
      };
    window.gtag('js', new Date());
    window.gtag('config', GOOGLE_ADS_ID);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
    document.head.appendChild(script);
  }

  function init() {
    loadGoogleAdsTag();
    window.addEventListener('cookieConsentChanged', event => {
      if (event?.detail?.analytics === true) {
        loadGoogleAdsTag();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
