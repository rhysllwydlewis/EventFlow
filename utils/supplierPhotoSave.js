'use strict';

/**
 * Saving uploaded photos to a supplier's gallery.
 *
 * Every route that adds photos to `suppliers.photosGallery` uses this, so they all enforce the
 * plan's photo allowance the same way and none of them reports a photo as uploaded when it was not
 * saved.
 *
 * The allowance is checked before a file is processed, which takes seconds, and another upload to
 * the same supplier may have been saved since. So it is checked again here, against the supplier as
 * it is now, and one upload at a time per supplier, so the second of two overlapping uploads sees
 * the first one's photos. (Within one server process; see utils/keyedLock.js.)
 *
 * The database layer answers `false`, rather than throwing, when a write fails or matches nothing,
 * so that answer is treated as a failed save too.
 */

const { checkPhotoAllowance, photoLimitError } = require('./photoGalleryAllowance');
const { galleryAppendIfUrlAbsent, galleryAppendUpdate } = require('./supplierGalleryUpdate');
const { withLock } = require('./keyedLock');

/**
 * Add uploaded photos to a supplier's gallery, if the plan still has room for them.
 *
 * Never throws: a failure of any kind (including a lookup that throws) is answered, so the caller
 * can delete the images it stored and tell the supplier it was not saved.
 *
 * @param {Object} options
 * @param {Object} options.dbUnified - The database layer
 * @param {Object} options.logger - Logger
 * @param {string} options.supplierId - Supplier id
 * @param {Object[]} options.records - The photo records to add (at least one)
 * @param {Object} [options.extraSet] - Further fields to `$set` in the same write
 * @param {boolean} [options.onlyIfAbsent] - Add the one record only if no gallery photo already has
 *   its URL (an approval, which may be repeated): when it is already there that is a success and
 *   nothing is written, and the write itself matches only while the URL is absent
 * @returns {Promise<{failure: {status: number, body: Object}}|null>} Why nothing was saved (404
 *   supplier gone, 403 no room left, 500 the save failed), or null when it was saved
 */
const hasPhotoUrl = (supplier, url) =>
  Array.isArray(supplier?.photosGallery) &&
  supplier.photosGallery.some(photo => photo?.url === url);

function saveSupplierPhotos({ dbUnified, logger, supplierId, records, extraSet, onlyIfAbsent }) {
  return withLock(`supplier-gallery:${supplierId}`, async () => {
    try {
      // throwOnError: a database failure is a failed save (500), not "no such supplier" (404)
      const supplier = await dbUnified.findOne(
        'suppliers',
        { id: supplierId },
        { throwOnError: true }
      );
      if (!supplier) {
        return { failure: { status: 404, body: { error: 'Supplier not found' } } };
      }
      if (onlyIfAbsent && hasPhotoUrl(supplier, records[0].url)) {
        return null;
      }
      const allowance = await checkPhotoAllowance(supplier, records.length);
      if (!allowance.allowed) {
        return {
          failure: { status: 403, body: photoLimitError(allowance.limit, allowance.current) },
        };
      }
      const { filter, update } = onlyIfAbsent
        ? galleryAppendIfUrlAbsent(supplier, records[0], extraSet)
        : { filter: { id: supplier.id }, update: galleryAppendUpdate(supplier, records, extraSet) };
      const written = await dbUnified.updateOne('suppliers', filter, update);
      if (written === false) {
        // Another server process may have added the same photo between the read and the write
        if (onlyIfAbsent) {
          const now = await dbUnified.findOne(
            'suppliers',
            { id: supplierId },
            { throwOnError: true }
          );
          if (hasPhotoUrl(now, records[0].url)) {
            return null;
          }
        }
        throw new Error('the database did not save the photos');
      }
      return null;
    } catch (error) {
      logger.error('[PHOTOS] could not save uploaded photos to the supplier gallery', {
        supplierId,
        count: records.length,
        error: error.message,
      });
      return {
        failure: { status: 500, body: { error: 'Failed to save photos. Please try again.' } },
      };
    }
  });
}

module.exports = { saveSupplierPhotos };
