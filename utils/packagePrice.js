/**
 * The price of a package: one rule for what it is, and one way to store it.
 *
 * A package has carried its price in two fields. Suppliers type `price` on their dashboard; the
 * admin screens edit `price_display`, and every public page shows `price_display` first. With each
 * editor writing a different field, an edit by one was invisible to the other (a supplier changes
 * the price and the site keeps showing the admin's old text).
 *
 * So there is one value and both fields hold it:
 *   - reading: `packagePriceText(pkg)` is the price, wherever it is shown or parsed;
 *   - writing: every path that sets a price stores `priceFields(value)`, which writes the same
 *     text to `price` and to `price_display`. Whoever saves last wins, for everyone.
 *
 * Records written before this keep working: `price_display` is read first (it is what customers
 * already see), then `price`.
 */

'use strict';

/** Longest price text stored; the same limit the supplier form has always had. */
const MAX_PRICE_LENGTH = 60;

/**
 * A price value as trimmed text of at most MAX_PRICE_LENGTH characters.
 *
 * @param {*} value - A stored or submitted price (text or number)
 * @returns {string} Price text, or '' when there is none
 */
function cleanPrice(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim().slice(0, MAX_PRICE_LENGTH);
}

/**
 * The price to show (or parse) for a package.
 *
 * @param {Object} pkg - Package record
 * @returns {string} Price text, or '' when the package has none
 */
function packagePriceText(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    return '';
  }
  return cleanPrice(pkg.price_display) || cleanPrice(pkg.price);
}

/**
 * The fields to store for a price: the same text in both.
 *
 * @param {*} value - The price being saved
 * @returns {{price: string, price_display: string}} Fields to spread into a package or an update
 */
function priceFields(value) {
  const text = cleanPrice(value);
  return { price: text, price_display: text };
}

module.exports = { MAX_PRICE_LENGTH, cleanPrice, packagePriceText, priceFields };
