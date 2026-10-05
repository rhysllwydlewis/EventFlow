/**
 * Keeps the sign-up "Step 2" heading honest about which sign-in options are
 * actually available.
 *
 * The static markup names every provider so the common case (all enabled)
 * renders correctly with no flash. The Google and Facebook init scripts
 * announce `eventflow:auth-provider-availability` when a provider turns out to
 * be unavailable (not configured, config or script failed to load), and this
 * script rewrites the heading so it never advertises a button that isn't there.
 *
 * Load this script before auth-google-init.js and auth-facebook-init.js.
 */
(function () {
  'use strict';

  const HEADING_ID = 'auth-signup-step-title';
  const AVAILABILITY_EVENT = 'eventflow:auth-provider-availability';
  const PROVIDER_LABELS = { google: 'Google', facebook: 'Facebook' };
  const availability = { google: true, facebook: true };

  /**
   * @param {{google: boolean, facebook: boolean}} state - Which providers are available
   * @returns {string} e.g. "Continue with Google, Facebook or email"
   */
  function buildSignupHeading(state) {
    const names = Object.keys(PROVIDER_LABELS)
      .filter(provider => state[provider])
      .map(provider => PROVIDER_LABELS[provider]);
    names.push('email');
    const last = names.pop();
    return names.length > 0
      ? `Continue with ${names.join(', ')} or ${last}`
      : `Continue with ${last}`;
  }

  function renderHeading() {
    const heading = document.getElementById(HEADING_ID);
    if (heading) {
      heading.textContent = buildSignupHeading(availability);
    }
  }

  document.addEventListener(AVAILABILITY_EVENT, event => {
    const { provider, available } = event.detail || {};
    if (!Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, provider)) {
      return;
    }
    availability[provider] = available === true;
    renderHeading();
  });
})();
