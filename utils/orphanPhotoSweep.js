'use strict';

/**
 * Finding, and deleting, stored photo images that nothing uses any more.
 *
 * An upload stores four images, and many things used to leave them behind: a photo deleted before
 * every copy was deleted with it, a package or supplier deleted with its photos, a rejected
 * moderation photo, a gallery write that failed after the images were stored. They sit in the
 * `photos` collection, publicly readable by address, used by nothing.
 *
 * How "used" is decided is what keeps this safe. A list of the fields that are known to hold photo
 * addresses would be wrong the first time something new stores one, and the cost of being wrong is
 * a live image deleted. So an image counts as used when its address appears ANYWHERE in ANY other
 * collection: any field, however deeply nested, as a plain address, with a query string, absolute,
 * or through the /api/v1 route. The only records skipped are the ones that cannot use an image:
 * the stored images themselves, and the images in `marketplace_images` (which this does not touch).
 * A held photo (a `photos` record with status `pending`) counts as using its images; an approved or
 * rejected one does not, because the gallery it was added to is what uses an approved photo.
 *
 * Beyond that it errs towards keeping:
 *  - an image younger than the grace period is kept (it may be mid-upload, or held for moderation);
 *  - an image with no readable creation date is kept;
 *  - it refuses to run at all if no references are found (the scan must have failed), or if more
 *    than half of the images would go (the scan is probably wrong);
 *  - it deletes only when asked to (`apply`), and a dry run changes nothing.
 */

/** A stored photo address, wherever it appears in a record's text. The id is the capture. */
const PHOTO_ADDRESS = /\/api\/(?:v1\/)?photos\/([A-Za-z0-9_][A-Za-z0-9_.-]*)/g;

/** The `type` of every stored image in the `photos` collection (held-photo records have none). */
const IMAGE_TYPES = ['original', 'thumbnail', 'optimized', 'large', 'avatar'];

/** Not read as references: the images themselves, and the marketplace's separate image store. */
const NOT_SCANNED = new Set(['photos', 'marketplace_images']);

const DAY_MS = 24 * 60 * 60 * 1000;
const DELETE_BATCH = 200;

/** Add every stored photo id named in `text` to `ids`. */
function collectIds(text, ids) {
  for (const match of text.matchAll(PHOTO_ADDRESS)) {
    ids.add(match[1]);
  }
}

/**
 * Every stored photo id that some other record names.
 *
 * @param {Object} db - A MongoDB database (`listCollections`, `collection(name).find`)
 * @returns {Promise<{ids: Set<string>, collections: Object<string, number>}>} The ids, and how many
 *   records were read from each collection
 */
async function referencedPhotoIds(db) {
  const ids = new Set();
  const collections = {};
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(collection => collection.name)
    .filter(name => !name.startsWith('system.') && !NOT_SCANNED.has(name));

  for (const name of names) {
    collections[name] = 0;
    for await (const document of db.collection(name).find({})) {
      collections[name] += 1;
      collectIds(JSON.stringify(document), ids);
    }
  }

  // Held photos use their images; approved and rejected records do not
  collections['photos (held)'] = 0;
  for await (const document of db.collection('photos').find({ status: 'pending' })) {
    collections['photos (held)'] += 1;
    collectIds(JSON.stringify(document), ids);
  }
  return { ids, collections };
}

/**
 * Sweep, or report what a sweep would delete.
 *
 * @param {Object} db - A MongoDB database
 * @param {Object} [options]
 * @param {boolean} [options.apply] - Delete. Without it nothing is changed.
 * @param {number} [options.graceDays] - Keep images younger than this (default 14)
 * @param {number} [options.limit] - Delete at most this many images in one run (default 5000)
 * @param {boolean} [options.allowLarge] - Allow a run that would delete more than half the images
 * @param {number} [options.now] - The time to measure ages from, in ms (for tests)
 * @returns {Promise<Object>} A report. `refused` names why it did nothing when it would not run.
 */
async function sweepOrphanPhotos(db, options = {}) {
  const { apply = false, graceDays = 14, limit = 5000, allowLarge = false } = options;
  const now = options.now ?? Date.now();
  const cutoff = now - graceDays * DAY_MS;
  const images = db.collection('photos');
  const imageFilter = { type: { $in: IMAGE_TYPES } };

  const report = {
    mode: apply ? 'apply' : 'dry run',
    graceDays,
    limit,
    imagesTotal: 0,
    referencedIds: 0,
    kept: { used: 0, tooRecent: 0, undated: 0 },
    candidates: 0,
    candidateBytes: 0,
    byType: {},
    sample: [],
    deleted: 0,
    scanned: {},
    refused: null,
  };

  const referenced = await referencedPhotoIds(db);
  report.referencedIds = referenced.ids.size;
  report.scanned = referenced.collections;

  const candidates = [];
  for await (const image of images.find(imageFilter, {
    projection: { _id: 1, type: 1, size: 1, createdAt: 1 },
  })) {
    report.imagesTotal += 1;
    if (referenced.ids.has(String(image._id))) {
      report.kept.used += 1;
      continue;
    }
    const created = Date.parse(image.createdAt);
    if (!Number.isFinite(created)) {
      report.kept.undated += 1;
      continue;
    }
    if (created > cutoff) {
      report.kept.tooRecent += 1;
      continue;
    }
    candidates.push(image);
  }

  // What a run would delete is reported even when it is refused, so whoever has to decide whether to
  // allow it can see what it found; a refusal only stops the deleting
  const chosen = candidates.slice(0, limit);
  report.candidates = candidates.length;
  report.candidateBytes = chosen.reduce((sum, image) => sum + (Number(image.size) || 0), 0);
  for (const image of chosen) {
    report.byType[image.type] = (report.byType[image.type] || 0) + 1;
  }
  report.sample = chosen.slice(0, 20).map(image => String(image._id));

  if (report.imagesTotal > 0 && referenced.ids.size === 0) {
    report.refused = 'no references were found anywhere, so the scan cannot be trusted';
  } else if (!allowLarge && report.imagesTotal > 0 && candidates.length > report.imagesTotal / 2) {
    report.refused = `${candidates.length} of ${report.imagesTotal} images would be deleted, more than half; check the scan, or pass allowLarge`;
  }

  if (apply && !report.refused) {
    for (let i = 0; i < chosen.length; i += DELETE_BATCH) {
      const batch = chosen.slice(i, i + DELETE_BATCH).map(image => image._id);
      const result = await images.deleteMany({ _id: { $in: batch }, ...imageFilter });
      report.deleted += result.deletedCount || 0;
    }
  }
  return report;
}

module.exports = { IMAGE_TYPES, PHOTO_ADDRESS, referencedPhotoIds, sweepOrphanPhotos };
