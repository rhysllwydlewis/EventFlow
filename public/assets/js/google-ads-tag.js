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
 * Two things this module must not do:
 *
 *   - Define `window.gtag` before consent. `pages/locations.js` and
 *     `utils/analytics.js` both treat the existence of `window.gtag` as their
 *     consent check, so declaring it early would let their events queue into
 *     `dataLayer` unconsented — and gtag.js replays that queue when it loads.
 *   - Trust `event.detail` from `cookieConsentChanged`. On sensitive pages
 *     (messages, payments, dashboards, settings) analytics-consent-upgrade.js
 *     wraps `CookieConsent.getConsent` to force advertising off; the event
 *     detail comes straight from the consent module and bypasses that guard.
 *     Every decision here is re-read through `getConsent()` for that reason.
 */
'use strict';

(function () {
  const GOOGLE_ADS_ID = 'AW-16705708195';
  const AD_CONSENT_KEYS = ['ad_storage', 'ad_user_data', 'ad_personalization'];
  let loaded = false;
  let granted = false;

  function consentState(value) {
    return AD_CONSENT_KEYS.reduce((state, key) => {
      state[key] = value;
      return state;
    }, {});
  }

  /** Reads consent through the public API, so page-level guards still apply. */
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

  function load() {
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') {
      // gtag.js identifies queued commands by their Arguments shape, so this has
      // to stay the arguments object Google's own snippet pushes rather than a
      // rest-parameter array — see the test asserting the queue shape.
      window.gtag = function gtag() {
        window.dataLayer.push(arguments); // skipcq: JS-0244 -- see above
      };
    }

    // Consent Mode v2: the denied default has to be the first command in the
    // queue, ahead of the grant and the config, so the tag never starts from an
    // assumed grant.
    window.gtag('consent', 'default', consentState('denied'));
    window.gtag('consent', 'update', consentState('granted'));
    window.gtag('js', new Date());
    window.gtag('config', GOOGLE_ADS_ID);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
    document.head.appendChild(script);

    loaded = true;
    granted = true;
  }

  /**
   * gtag.js cannot be unloaded once it is on the page, so withdrawal is
   * expressed as a denied Consent Mode update rather than by removing it.
   */
  function update(nextGranted) {
    if (!loaded || nextGranted === granted) {
      return;
    }
    granted = nextGranted;
    window.gtag('consent', 'update', consentState(nextGranted ? 'granted' : 'denied'));
  }

  function sync() {
    if (!hasMarketingConsent()) {
      update(false);
      return;
    }
    if (loaded) {
      update(true);
    } else {
      load();
    }
  }

  function init() {
    sync();
    window.addEventListener('cookieConsentChanged', sync);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
