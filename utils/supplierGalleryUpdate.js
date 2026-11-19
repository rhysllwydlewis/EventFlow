'use strict';

/**
 * Update documents for supplier gallery changes (`suppliers.photosGallery`).
 *
 * Gallery routes used to read the whole array, edit it in memory and `$set` it back.
 * Two overlapping requests (two uploads, or an upload and a delete) each started
 * from the same array, so the later write silently discarded the earlier one: a
 * photo reported as uploaded would vanish. `$push` and `$pull` change only the
 * element involved, so overlapping requests no longer overwrite each other.
 *
 * `$push` fails on a field that exists but is not an array, and a few legacy
 * records hold `null` there. For those the helpers fall back to replacing the
 * field, which is what the old code effectively did.
 */

const isAppendable = supplier =>
  !supplier || supplier.photosGallery === undefined || Array.isArray(supplier.photosGallery);

/**
 * @param {Object} supplier The supplier as last read.
 * @param {Object|Object[]} records Photo record(s) to append.
 * @param {Object} [extraSet] Further fields to `$set` in the same write (for example `updatedAt`).
 * @returns {Object} An update document for `dbUnified.updateOne`.
 */
function galleryAppendUpdate(supplier, records, extraSet = {}) {
  const list = Array.isArray(records) ? records : [records];
  const hasExtra = Object.keys(extraSet).length > 0;

  if (isAppendable(supplier)) {
    return {
      $push: { photosGallery: { $each: list } },
      ...(hasExtra ? { $set: extraSet } : {}),
    };
  }
  return { $set: { photosGallery: list, ...extraSet } };
}

/**
 * Remove one photo from the gallery by its own identity rather than by writing back
 * a filtered copy of the array.
 *
 * Returns null when the photo cannot be pulled safely and the caller should keep
 * its read-modify-write fallback: either the identity is ambiguous (several legacy
 * records share a URL and have no id, and `$pull` would remove all of them) or the
 * gallery is not an array.
 *
 * @param {Object} supplier The supplier as last read.
 * @param {Object} photo The gallery record to remove.
 * @param {Object} [extraSet] Further fields to `$set` in the same write.
 * @returns {Object|null} An update document, or null.
 */
function galleryRemoveUpdate(supplier, photo, extraSet = {}) {
  if (!supplier || !Array.isArray(supplier.photosGallery) || !photo) {
    return null;
  }
  const identity = photo.id ? { id: photo.id } : photo.url ? { url: photo.url } : null;
  if (!identity) {
    return null;
  }
  const key = Object.keys(identity)[0];
  const sharing = supplier.photosGallery.filter(item => item && item[key] === identity[key]);
  if (sharing.length !== 1) {
    return null;
  }
  return {
    $pull: { photosGallery: identity },
    ...(Object.keys(extraSet).length > 0 ? { $set: extraSet } : {}),
  };
}

/**
 * Append a record only when no gallery entry already has its URL, with the database deciding
 * that in the same operation as the write.
 *
 * Checking the array that was read earlier is not enough: two requests that overlap (two
 * admins approving the same photo) both read a gallery without the URL, both pass the check,
 * and an unconditional `$push` then inserts it twice. The filter makes the second one match
 * nothing instead. (The local file store cannot evaluate the filter against array elements and
 * treats it as matching, so there the earlier read still decides, as it always did.)
 *
 * @param {Object} supplier The supplier as last read.
 * @param {Object} record The gallery record to add (must have a `url`).
 * @param {Object} [extraSet] Further fields to `$set` in the same write.
 * @returns {{filter: Object, update: Object}} The filter and update for `dbUnified.updateOne`.
 */
function galleryAppendIfUrlAbsent(supplier, record, extraSet = {}) {
  return {
    filter: { id: supplier.id, 'photosGallery.url': { $ne: record.url } },
    update: galleryAppendUpdate(supplier, record, extraSet),
  };
}

module.exports = { galleryAppendIfUrlAbsent, galleryAppendUpdate, galleryRemoveUpdate };
