/**
 * The price of a package, read one way everywhere (the browser and Node share this file).
 *
 * A package keeps its price in `price` (typed on the supplier dashboard) and `price_display` (edited
 * by admins), and both hold the same text once saved (utils/packagePrice.js writes them together).
 * Records saved before that may hold only one, or two different ones; the site has always shown
 * `price_display` first, then `price`, so that is the rule.
 *
 *   EFPackagePrice.text(pkg)    "From £450", "£25 pp", "" when there is no price
 *   EFPackagePrice.amount(pkg)  450, 25, null when the text has no number ("POA")
 *   EFPackagePrice.parse(text)  the same number from a bare text
 *   EFPackagePrice.label(pkg)   text for display: a bare amount ("1200") gets a pound sign and grouping
 */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.EFPackagePrice = api;
  }
})(typeof window !== 'undefined' ? window : null, () => {
  /** Longest price text kept; the limit the supplier form has always had. */
  const MAX_PRICE_LENGTH = 60;
  /** A price typed as a bare amount ("1200", "1,200.50"). */
  const PLAIN_AMOUNT = /^\d[\d,]*(\.\d+)?$/;

  /** A price value as trimmed text of at most MAX_PRICE_LENGTH characters ('' when none). */
  function clean(value) {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value).trim().slice(0, MAX_PRICE_LENGTH);
  }

  /** The price to show for a package: `price_display`, else `price`, else ''. */
  function text(pkg) {
    if (!pkg || typeof pkg !== 'object') {
      return '';
    }
    return clean(pkg.price_display) || clean(pkg.price);
  }

  /**
   * The first amount written in a price text: "£3,500" 3500, "from £450" 450, "£1,200 - £1,800"
   * 1200 (the lower end), "£2k" 2000. null when there is no number or it is zero.
   */
  function parse(value) {
    const match = clean(value)
      .replace(/(\d),(?=\d{3}\b)/g, '$1')
      .match(/(\d+(?:\.\d+)?)\s*(k\b)?/i);
    if (!match) {
      return null;
    }
    const parsed = parseFloat(match[1]) * (match[2] ? 1000 : 1);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  /** The amount of a package's price, whichever field holds it (null when it has none). */
  function amount(pkg) {
    return parse(text(pkg));
  }

  /** The price as it should be shown: text as written, a bare amount as "£1,200". */
  function label(pkg) {
    const shown = text(pkg);
    if (!shown || !PLAIN_AMOUNT.test(shown)) {
      return shown;
    }
    return `£${Number(shown.replace(/,/g, '')).toLocaleString('en-GB')}`;
  }

  return { MAX_PRICE_LENGTH, PLAIN_AMOUNT, clean, text, parse, amount, label };
});
