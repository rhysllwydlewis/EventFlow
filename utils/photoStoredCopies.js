'use strict';

/**
 * Deleting the stored images behind a photo that was removed from a gallery.
 *
 * One upload stores four separate images (original, thumbnail, optimised and large), and a gallery
 * record points at all four. Removing the record only removes the pointers, so each stored image
 * has to be deleted as well, or it stays in storage and stays publicly readable by its address.
 *
 * Deleting a stored image is not reversible and the address is trusted far less than it looks: a
 * gallery record can hold any address, so removing one that names somebody else's image must not
 * delete theirs. Everything here therefore errs towards keeping a file:
 *
 *  - only an address of exactly the form /api/photos/<id> is ever deleted (`photoUpload.deleteImage`
 *    deletes by the last path segment, so an address with extra segments would delete a different
 *    image from the one it appears to name);
 *  - an image is kept while any other record still refers to it, matched by id, so a reference with
 *    a query string or an absolute address still counts;
 *  - if the lookup for references fails, the image is kept;
 *  - nothing here throws, so a failed cleanup never fails the delete the user asked for.
 *
 * Call it AFTER the gallery reference has been removed, so the record being deleted does not count
 * as a reference to itself.
 */

const logger = require('./logger');

/** /api/photos/<id>, where the id is what `photoUpload.deleteImage` deletes by. */
const STORED_ADDRESS = /^\/api\/photos\/([A-Za-z0-9_][A-Za-z0-9_.-]*)$/;

/**
 * Every field, per collection, that can hold the address of a stored photo. A path ending in an
 * array name covers a list of addresses; `gallery` and `gallery.url` are both listed because a
 * package gallery holds plain strings or objects. Add a field here when something new starts to
 * store photo addresses, or its images can be deleted while still in use.
 */
const REFERENCE_FIELDS = {
  suppliers: [
    'photosGallery.url',
    'photosGallery.thumbnail',
    'photosGallery.large',
    'photosGallery.original',
    'images',
    'images.url',
    'logo',
    'coverImage',
    'bannerUrl',
    'openGraphImage',
  ],
  packages: [
    'gallery',
    'gallery.url',
    'gallery.thumbnail',
    'gallery.large',
    'gallery.original',
    'image',
  ],
  users: ['avatarUrl'],
  marketplace_listings: ['images', 'images.url'],
  categories: ['heroImage'],
  public_calendar_events: ['imageUrl', 'featuredImageUrl', 'galleryImageUrls'],
  // A customer's review photos (/api/reviews/photos/upload stores the same /api/photos/<id>
  // addresses); a supplier must not be able to delete them by naming one in their own gallery
  reviews: ['photos', 'photos.url'],
  // A saved item keeps the image address it was saved with
  shortlists: ['items.imageUrl'],
  // A photo held for moderation is in no gallery yet, so this record is the only thing that uses
  // its images (see REFERENCE_CONDITIONS: only while it is pending)
  photos: ['url', 'thumbnail', 'large', 'original'],
};

/**
 * Extra conditions a document must meet before it counts as a use of an image. A `photos` record
 * is kept after it is approved or rejected, and must not keep its images alive then: an approved
 * photo is used by the gallery it was added to, and a rejected one by nothing.
 */
const REFERENCE_CONDITIONS = {
  photos: { status: 'pending' },
};

/**
 * The id of a stored photo, from its address.
 *
 * @param {*} address - A value that may be a stored photo's address
 * @returns {string|null} The id, or null when this is not an address we would delete
 */
function storedPhotoId(address) {
  if (typeof address !== 'string') {
    return null;
  }
  const match = STORED_ADDRESS.exec(address);
  return match ? match[1] : null;
}

/**
 * The addresses of every stored image behind one gallery record.
 *
 * @param {string|{url?: string, thumbnail?: string, large?: string, original?: string}} record - A
 *   gallery item: a plain address, or the object an upload stores
 * @returns {string[]} Distinct addresses we may delete, in url, thumbnail, large, original order
 */
function photoStoredAddresses(record) {
  let candidates = [];
  if (typeof record === 'string') {
    candidates = [record];
  } else if (record && typeof record === 'object') {
    candidates = [record.url, record.thumbnail, record.large, record.original];
  }
  const addresses = [];
  for (const candidate of candidates) {
    if (storedPhotoId(candidate) && !addresses.includes(candidate)) {
      addresses.push(candidate);
    }
  }
  return addresses;
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The pattern a stored value matches when it refers to this photo: /api/photos/<id> (or the same
 * route under /api/v1, which serves the same images) at the end, optionally followed by a query or
 * fragment, with anything (such as a host) in front of it.
 *
 * @param {string} id - Stored photo id
 * @returns {string} A regular expression source
 */
const referenceSource = id => `/api/(?:v1/)?photos/${escapeRegExp(id)}(?:[?#].*)?$`;

/**
 * Every string found at a dotted path, looking inside arrays at each step. Values that are not
 * strings (objects in a list of addresses, missing fields) are skipped.
 *
 * @param {*} value - A document, or part of one
 * @param {string[]} path - The path, split on dots
 * @returns {string[]} The strings at that path
 */
function stringsAt(value, path) {
  if (Array.isArray(value)) {
    return value.flatMap(item => stringsAt(item, path));
  }
  if (path.length === 0) {
    return typeof value === 'string' ? [value] : [];
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  return stringsAt(value[path[0]], path.slice(1));
}

/**
 * The filter that finds documents in a collection that may refer to any of these ids.
 *
 * @param {string[]} fields - The collection's reference fields
 * @param {string[]} ids - Stored photo ids
 * @param {Object} [conditions] - Fields the document must also equal (REFERENCE_CONDITIONS)
 * @returns {Object} A filter for `dbUnified.find`
 */
function referenceFilter(fields, ids, conditions = {}) {
  const sources = ids.map(referenceSource);
  return {
    ...conditions,
    $or: fields.flatMap(field => sources.map(source => ({ [field]: { $regex: source } }))),
  };
}

/** Whether a document meets every condition in `conditions` (plain equality on top-level fields). */
const meetsConditions = (document, conditions = {}) =>
  Object.entries(conditions).every(([field, value]) => document && document[field] === value);

/**
 * Which of these ids some record still refers to.
 *
 * Throws when a lookup fails, so the caller can keep every image rather than delete one that may
 * still be in use. (`dbUnified.find` swallows errors and returns an empty list unless it is told
 * not to, which would otherwise read as "nothing refers to it".)
 *
 * @param {Object} dbUnified - The database layer
 * @param {string[]} ids - Stored photo ids
 * @returns {Promise<Set<string>>} The ids still referred to
 */
async function idsStillReferenced(dbUnified, ids) {
  const referenced = new Set();
  const patterns = ids.map(id => ({ id, pattern: new RegExp(referenceSource(id)) }));

  // The collections are independent, so they are searched together; one failing rejects the lot
  await Promise.all(
    Object.entries(REFERENCE_FIELDS).map(async ([collection, fields]) => {
      const conditions = REFERENCE_CONDITIONS[collection];
      const documents = await dbUnified.find(collection, referenceFilter(fields, ids, conditions), {
        throwOnError: true,
      });
      if (!Array.isArray(documents)) {
        throw new Error(`Could not read ${collection} to check what still uses a photo`);
      }
      for (const document of documents) {
        if (!meetsConditions(document, conditions)) {
          continue;
        }
        for (const field of fields) {
          for (const value of stringsAt(document, field.split('.'))) {
            for (const { id, pattern } of patterns) {
              if (pattern.test(value)) {
                referenced.add(id);
              }
            }
          }
        }
      }
    })
  );
  return referenced;
}

/**
 * `idsStillReferenced`, but a failure is logged and answered with null instead of thrown, so the
 * caller can keep every image.
 *
 * @param {Object} dbUnified - The database layer
 * @param {string[]} ids - Stored photo ids
 * @returns {Promise<Set<string>|null>} The ids still referred to, or null when that is not known
 */
async function referencedIdsOrNull(dbUnified, ids) {
  try {
    return await idsStillReferenced(dbUnified, ids);
  } catch (error) {
    logger.error('Kept stored photo images: could not check what still uses them', {
      error: error.message,
      count: ids.length,
    });
    return null;
  }
}

/**
 * Delete the stored images behind removed gallery records, except any that something still uses.
 *
 * @param {Object} options
 * @param {Object} options.dbUnified - The database layer
 * @param {Object} options.photoUpload - Photo storage (`deleteImage`)
 * @param {Array<string|Object>} options.records - The gallery records that were removed
 * @returns {Promise<{deleted: string[], kept: string[]}>} The addresses storage was asked to
 *   delete (`photoUpload.deleteImage` does not say whether anything was there), and the addresses
 *   kept because something still uses them or because that could not be checked
 */
async function deleteUnusedStoredCopies({ dbUnified, photoUpload, records }) {
  const result = { deleted: [], kept: [] };
  try {
    const addresses = [];
    for (const record of records || []) {
      for (const address of photoStoredAddresses(record)) {
        if (!addresses.includes(address)) {
          addresses.push(address);
        }
      }
    }
    if (addresses.length === 0) {
      return result;
    }

    const referenced = await referencedIdsOrNull(dbUnified, addresses.map(storedPhotoId));
    if (referenced === null) {
      // The check could not be completed, so nothing is known to be unused: keep everything.
      result.kept.push(...addresses);
      return result;
    }

    for (const address of addresses) {
      if (referenced.has(storedPhotoId(address))) {
        result.kept.push(address);
        continue;
      }
      try {
        await photoUpload.deleteImage(address);
        result.deleted.push(address);
      } catch (error) {
        logger.error('Could not delete a stored photo image', { address, error: error.message });
        result.kept.push(address);
      }
    }
  } catch (error) {
    logger.error('Stored photo cleanup failed', { error: error.message });
  }
  return result;
}

module.exports = {
  REFERENCE_CONDITIONS,
  REFERENCE_FIELDS,
  deleteUnusedStoredCopies,
  idsStillReferenced,
  photoStoredAddresses,
  storedPhotoId,
};
