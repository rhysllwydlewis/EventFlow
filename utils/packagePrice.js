/**
 * The price of a package: one rule for what it is, and one way to store it.
 *
 * A package has carried its price in two fields. Suppliers type `price` on their dashboard; the
 * admin screens edit `price_display`, and every public page shows `price_display` first. With each
 * editor writing a different field, an edit by one was invisible to the other (a supplier changes
 * the price and the site keeps showing the admin's old text).
 *
 * So there is one value and both fields hold it:
 *   - reading: `packagePriceText(pkg)` is the price, wherever it is shown or parsed. The rule lives
 *     in public/assets/js/utils/package-price.js, which the browser loads too, so a page and the
 *     server cannot disagree;
 *   - writing: every path that sets a price stores `priceFields(value)`, which writes the same
 *     text to `price` and to `price_display`. Whoever saves last wins, for everyone.
 *
 * Records written before this keep working: `price_display` is read first (it is what customers
 * already see), then `price`.
 */

'use strict';

const shared = require('../public/assets/js/utils/package-price');

/** Longest price text stored; the same limit the supplier form has always had. */
const MAX_PRICE_LENGTH = shared.MAX_PRICE_LENGTH;

/**
 * A price value as trimmed text of at most MAX_PRICE_LENGTH characters.
 *
 * @param {*} value - A stored or submitted price (text or number)
 * @returns {string} Price text, or '' when there is none
 */
const cleanPrice = shared.clean;

/**
 * The price to show (or parse) for a package.
 *
 * @param {Object} pkg - Package record
 * @returns {string} Price text, or '' when the package has none
 */
const packagePriceText = shared.text;

/**
 * The number in a price text, for filtering and sorting: the first amount written.
 *
 * "£3,500" is 3500, "from £450" is 450, "£25 pp" is 25, "£1,200 - £1,800" is 1200 (the lower end),
 * "£2k" is 2000. A price with no amount ("POA", "Contact for pricing", "Free") has no number: null.
 *
 * @param {*} text - A price text (or number)
 * @returns {number|null} The amount, or null when there is none
 */
const parsePriceAmount = shared.parse;

/**
 * The amount of a package's price, whichever field holds it.
 *
 * @param {Object} pkg - Package record
 * @returns {number|null} The amount, or null when the package has no priced amount
 */
const packagePriceAmount = shared.amount;

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

module.exports = {
  MAX_PRICE_LENGTH,
  cleanPrice,
  packagePriceText,
  priceFields,
  parsePriceAmount,
  packagePriceAmount,
};
