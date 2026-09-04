/**
 * Google Ads tag (gtag.js) for conversion tracking.
 *
 * Loaded on every non-admin page by the server (see
 * injectGlobalAnalyticsScripts in utils/template-renderer.js), but the
 * third-party loader itself only runs once the visitor has granted the
 * `marketing` consent category.
 *
 * Marketing is deliberately a separate category from `analytics`: consenting to
 * measurement of how the site is used is not consent to advertising technology,
 * and the Cookie Policy at /legal#cookies describes them as two choices.
 *
 * Google Consent Mode v2 defaults are declared before anything loads, and are
 * updated in both directions on `cookieConsentChanged`. That matters because
 * gtag.js cannot be unloaded once it is on the page: without a `denied` update,
 * withdrawing consent would leave the tag running for the rest of the session.
 */
'use strict';

(function () {
  const GOOGLE_ADS_ID = 'AW-16705708195';
  const AD_CONSENT_KEYS = ['ad_storage', 'ad_user_data', 'ad_personalization'];
  let loaded = false;
  let granted = false;

  function ensureGtag() {
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') {
      window.gtag = function gtag() {
        // gtag.js reads `arguments` off the pushed object, so the array-like
        // shape has to be preserved rather than spread into a real array.
        window.dataLayer.push(arguments);
      };
    }
    return window.gtag;
  }

  function consentState(value) {
    return AD_CONSENT_KEYS.reduce((state, key) => {
      state[key] = value;
      return state;
    }, {});
  }

  function hasMarketingConsent() {
    if (!window.CookieConsent || typeof window.CookieConsent.getConsent !== 'function') {
      return false;
    }
    try {
      return Boolean(window.CookieConsent.getConsent()?.marketing);
    } catch {
      return false;
    }
  }

  function grant() {
    const gtag = ensureGtag();
    granted = true;
    gtag('consent', 'update', consentState('granted'));

    if (loaded) {
      return;
    }
    loaded = true;

    gtag('js', new Date());
    gtag('config', GOOGLE_ADS_ID);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
    document.head.appendChild(script);
  }

  function deny() {
    if (!granted) {
      return;
    }
    granted = false;
    ensureGtag()('consent', 'update', consentState('denied'));
  }

  function init() {
    // Declare the denied default before any consent update, so a tag that loads
    // later in the page life cycle never starts from an assumed grant.
    ensureGtag()('consent', 'default', consentState('denied'));

    if (hasMarketingConsent()) {
      grant();
    }

    window.addEventListener('cookieConsentChanged', event => {
      if (event?.detail?.marketing === true) {
        grant();
      } else {
        deny();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
