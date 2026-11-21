'use strict';

/**
 * The update that adds uploaded photos to a package's gallery.
 *
 * Appends with `$push` rather than writing back the whole gallery as it was read: two uploads to
 * one package at the same time would otherwise each start from the same list, and the later write
 * would discard the earlier upload's photos. The first new photo becomes the cover when the package
 * has no real cover image. A gallery that is not a list (a legacy `null`, which `$push` cannot
 * extend) is replaced, as it always was.
 */

const { PLACEHOLDER_PACKAGE_IMAGE } = require('./constants');

/**
 * @param {Object} pkg - The package as last read
 * @param {Object[]|string[]} photos - The gallery items to add (at least one)
 * @returns {Object} An update document for `dbUnified.updateOne`
 */
function packageGalleryAppendUpdate(pkg, photos) {
  const first = photos[0];
  const needsCover = !pkg.image || pkg.image === PLACEHOLDER_PACKAGE_IMAGE;
  const cover = needsCover ? { image: typeof first === 'string' ? first : first.url } : {};
  const appendable = pkg.gallery === undefined || Array.isArray(pkg.gallery);

  if (appendable) {
    return {
      $push: { gallery: { $each: photos } },
      ...(needsCover ? { $set: cover } : {}),
    };
  }
  return { $set: { gallery: photos, ...cover } };
}

module.exports = { packageGalleryAppendUpdate };
