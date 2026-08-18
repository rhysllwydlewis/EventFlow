/**
 * Shared field-presence checks for "is this supplier profile complete
 * enough" questions.
 *
 * These two checks were previously copy-pasted (with a "mirrors X" comment
 * asking readers to hand-keep them in sync) across services/actionPromptService.js
 * and routes/supplier.js, with actionPromptService's copy using a looser
 * raw-array-length check that could disagree with the deduplicated count
 * used everywhere else. Centralising them here means there's one place to
 * fix a schema change (e.g. a new photo-storage field) instead of several.
 *
 * public/assets/js/components/profile-health-widget.js runs in the browser
 * and has no access to this module — it stays a hand-synced mirror of
 * getSupplierGalleryCount()/hasSupplierPostcode() by design, documented at
 * its own call sites.
 */

'use strict';

/**
 * Count of a supplier's unique gallery photos, merging the canonical
 * photosGallery array with the legacy images array so a photo stored under
 * either schema generation counts once.
 *
 * @param {Object} supplier - Supplier document
 * @returns {number} Unique photo count
 */
function getSupplierGalleryCount(supplier) {
  return new Set(
    [
      ...(Array.isArray(supplier.photosGallery) ? supplier.photosGallery : []),
      ...(Array.isArray(supplier.images) ? supplier.images : []),
    ]
      .map(item =>
        typeof item === 'string'
          ? item.trim()
          : String(
              item?.url ||
                item?.large ||
                item?.optimized ||
                item?.original ||
                item?.thumbnail ||
                item?.src ||
                ''
            ).trim()
      )
      .filter(Boolean)
  ).size;
}

/**
 * Whether a supplier has at least one gallery photo under either schema
 * generation.
 *
 * @param {Object} supplier - Supplier document
 * @returns {boolean}
 */
function hasSupplierGalleryPhotos(supplier) {
  return getSupplierGalleryCount(supplier) > 0;
}

/**
 * Whether a supplier has a postcode on file. basePostcode is what the
 * dashboard's postcode input actually saves to (sup-base-postcode);
 * venuePostcode is the Venues-category alternative. Plain `postcode` isn't
 * written anywhere by any supplier-facing form.
 *
 * @param {Object} supplier - Supplier document
 * @returns {boolean}
 */
function hasSupplierPostcode(supplier) {
  return Boolean(String(supplier.basePostcode || supplier.venuePostcode || '').trim());
}

module.exports = {
  getSupplierGalleryCount,
  hasSupplierGalleryPhotos,
  hasSupplierPostcode,
};
