/**
 * Public Calendar Publisher Helper
 *
 * Centralises the logic for deciding whether a supplier may publish
 * (create/update/delete) events on the shared public calendar.
 *
 * Rule:
 *   1. If supplier.publicCalendarPublisherOverride === true  → can publish
 *   2. If supplier.publicCalendarPublisherOverride === false → cannot publish
 *   3. Otherwise (null / undefined)                          → derive from category:
 *        category in PUBLISHER_CATEGORIES → can publish
 *
 * Admin users can always perform any operation regardless of this check.
 */

'use strict';

const { PUBLISHER_CATEGORIES } = require('../models/Supplier');

/**
 * Returns true if the supplier is allowed to publish to the public calendar.
 *
 * @param {Object} supplier - Supplier document from DB
 * @returns {boolean}
 */
function canPublishPublicCalendar(supplier) {
  if (!supplier) {
    return false;
  }

  const override = supplier.publicCalendarPublisherOverride;

  // Explicit admin override
  if (override === true) {
    return true;
  }
  if (override === false) {
    return false;
  }

  // Default: derive from category
  return PUBLISHER_CATEGORIES.includes(supplier.category);
}

module.exports = { canPublishPublicCalendar };
