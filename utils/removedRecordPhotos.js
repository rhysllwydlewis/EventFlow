'use strict';

/**
 * The stored images a supplier or package owned, for deleting them along with the record.
 *
 * Deleting a package or a supplier removed the record and left every image it had uploaded in
 * storage, publicly readable by address, and never used again. These list what the record held, in
 * the shape `deleteUnusedStoredCopies` (utils/photoStoredCopies.js) takes, which then deletes only
 * what no other record uses and, when told whose gallery this was, only what is not somebody
 * else's. Values that are not stored photo addresses (a legacy /uploads/ path, an external URL, a
 * placeholder) are ignored there.
 *
 * Call the delete AFTER the record has been removed, so the record does not count as a use of its
 * own images.
 */

/**
 * Gallery items (plain addresses or the objects an upload stores), and the single image fields.
 * @param {*} items - A list of gallery items, or anything else (ignored)
 * @returns {Array<string|Object>} The items
 */
const listOf = items => (Array.isArray(items) ? items : []);

/**
 * @param {Object} supplier - The supplier record that was deleted
 * @returns {Array<string|Object>} Everything that may be a stored image of it
 */
function supplierPhotoRecords(supplier) {
  if (!supplier || typeof supplier !== 'object') {
    return [];
  }
  return [
    ...listOf(supplier.photosGallery),
    ...listOf(supplier.images),
    supplier.logo,
    supplier.coverImage,
    supplier.bannerUrl,
    supplier.openGraphImage,
  ].filter(Boolean);
}

/**
 * @param {Object} pkg - The package record that was deleted
 * @returns {Array<string|Object>} Everything that may be a stored image of it
 */
function packagePhotoRecords(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    return [];
  }
  return [...listOf(pkg.gallery), pkg.image].filter(Boolean);
}

module.exports = { packagePhotoRecords, supplierPhotoRecords };
