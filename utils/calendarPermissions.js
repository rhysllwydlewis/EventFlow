/**
 * Calendar Permissions Utility
 *
 * Determines whether a supplier has public calendar publishing rights.
 *
 * Publishing rights are derived from the supplier's category:
 *   - 'Event Planner' and 'Wedding Fayre' can create/edit/delete public calendar events.
 *   - All other supplier categories have read-only access.
 *
 * An admin can override this by setting `canPublishPublicCalendar` directly on the
 * supplier document:
 *   - true  → always grant publishing rights (regardless of category)
 *   - false → always deny publishing rights (regardless of category)
 *   - undefined → derive from category (default behaviour)
 */

'use strict';

const { CALENDAR_PUBLISHER_TYPES } = require('../models/Supplier');

/**
 * Determine whether a supplier has public calendar publishing rights.
 *
 * @param {Object} supplier - Supplier document from the database.
 * @param {string} supplier.category - Supplier category.
 * @param {boolean|undefined} [supplier.canPublishPublicCalendar] - Optional admin override.
 * @returns {boolean} True if the supplier may create/update/delete public calendar events.
 */
function canPublishPublicCalendar(supplier) {
  if (!supplier) {
    return false;
  }

  // Admin override: explicit boolean beats category-based derivation.
  if (typeof supplier.canPublishPublicCalendar === 'boolean') {
    return supplier.canPublishPublicCalendar;
  }

  // Derive from category.
  return CALENDAR_PUBLISHER_TYPES.includes(supplier.category);
}

module.exports = {
  CALENDAR_PUBLISHER_TYPES,
  canPublishPublicCalendar,
};
