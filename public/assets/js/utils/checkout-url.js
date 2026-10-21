/**
 * Where a payment or billing page may send the visitor.
 *
 * The server answers a checkout or billing-portal request with the address of Stripe's hosted page,
 * and the browser then navigates there. Whatever the response says, the browser only follows an
 * https address on one of Stripe's own hosts, or a page on this site, so a wrong or tampered
 * response can never turn that navigation into a redirect to somewhere else.
 *
 * window.EFCheckoutUrl.resolve(value) returns the address to navigate to, or null.
 */
(function (root) {
  'use strict';

  const STRIPE_HOSTS = ['checkout.stripe.com', 'billing.stripe.com'];

  function resolve(value, origin) {
    if (typeof value !== 'string' || value.trim() === '') {
      return null;
    }
    const base = origin || (root.location && root.location.origin) || 'https://localhost';
    let parsed = null;
    try {
      parsed = new URL(value.trim(), base);
    } catch {
      return null;
    }
    if (parsed.origin === base) {
      return parsed.href;
    }
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) {
      return STRIPE_HOSTS.includes(parsed.hostname) ? parsed.href : null;
    }
    return null;
  }

  const api = { resolve, STRIPE_HOSTS };
  root.EFCheckoutUrl = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
