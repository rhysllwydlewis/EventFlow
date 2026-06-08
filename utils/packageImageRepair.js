'use strict';

const crypto = require('crypto');
const {
  classifyPackageImageCandidate,
  extractGalleryItemUrl,
  listPackageImageCandidates,
  normalizeGallery,
  resolvePackageImage,
  PLACEHOLDER_PACKAGE_IMAGE,
} = require('./packageImageUtils');

const DATA_IMAGE_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

function dataUriToUploadFile(dataUri, filenamePrefix) {
  const match = typeof dataUri === 'string' ? dataUri.match(DATA_IMAGE_RE) : null;
  if (!match) {
    const err = new Error('Invalid base64 image format');
    err.name = 'InvalidImageError';
    throw err;
  }
  const mimeType = match[1];
  const subtype = mimeType.split('/')[1] || 'jpeg';
  const ext = subtype === 'jpeg' ? 'jpg' : subtype;
  return {
    buffer: Buffer.from(match[2], 'base64'),
    filename: `${filenamePrefix}.${ext}`,
    mimeType,
  };
}

function findPackageDataUriCandidates(pkg) {
  return listPackageImageCandidates(pkg).filter(candidate => candidate.reason === 'data-uri');
}

function buildStoredGalleryEntry(stored) {
  const url = extractGalleryItemUrl(stored || {});
  if (!url) {
    const err = new Error('Image processing returned no public URL');
    err.name = 'ImageProcessingError';
    throw err;
  }
  return {
    url,
    thumbnail: extractGalleryItemUrl({ url: stored.thumbnail }) || url,
    large: extractGalleryItemUrl({ url: stored.large }) || url,
    original: extractGalleryItemUrl({ url: stored.original }) || url,
    optimized: extractGalleryItemUrl({ url: stored.optimized }) || url,
    approved: true,
    repairedAt: new Date().toISOString(),
  };
}

function prependGalleryEntry(existingGallery, entry) {
  const current = Array.isArray(existingGallery) ? existingGallery : [];
  const entryUrl = extractGalleryItemUrl(entry);
  const withoutDuplicate = current.filter(item => extractGalleryItemUrl(item) !== entryUrl);
  return [entry, ...withoutDuplicate];
}

async function buildPackageImageRepair(pkg, opts = {}) {
  const dataUriCandidates = findPackageDataUriCandidates(pkg);
  const before = {
    image: pkg && pkg.image,
    gallery: Array.isArray(pkg && pkg.gallery) ? pkg.gallery : [],
    resolvedImage: resolvePackageImage(pkg),
    resolverCandidates: listPackageImageCandidates(pkg),
  };

  if (!pkg || typeof pkg !== 'object') {
    return { id: undefined, changed: false, reason: 'invalid-package', before };
  }
  if (dataUriCandidates.length === 0) {
    const hasUsable = before.resolverCandidates.some(candidate => candidate.usable);
    return {
      id: pkg.id,
      changed: false,
      reason: hasUsable ? 'already-has-usable-image' : 'no-data-uri-candidate',
      before,
    };
  }

  const source = dataUriCandidates[0];
  if (opts.dryRun !== false) {
    return {
      id: pkg.id,
      changed: false,
      dryRun: true,
      reason: 'would-convert-data-uri',
      source: source.source,
      before,
    };
  }

  if (!opts.photoUpload || typeof opts.photoUpload.processAndSaveImage !== 'function') {
    throw new Error(
      'photoUpload.processAndSaveImage is required to repair data URI package images'
    );
  }

  const prefix = `package_${pkg.id || crypto.randomBytes(6).toString('hex')}_${Date.now()}`;
  const uploadFile = dataUriToUploadFile(source.value, prefix);
  const stored = await opts.photoUpload.processAndSaveImage(
    uploadFile.buffer,
    uploadFile.filename,
    'package'
  );
  const galleryEntry = buildStoredGalleryEntry(stored || {});
  const chosenUrl = galleryEntry.url;
  const updatedGallery = prependGalleryEntry(pkg.gallery, galleryEntry);
  const update = {
    image: chosenUrl,
    gallery: updatedGallery,
    updatedAt: new Date().toISOString(),
  };
  const afterPkg = { ...pkg, ...update };

  return {
    id: pkg.id,
    changed: true,
    dryRun: false,
    reason: 'converted-data-uri',
    source: source.source,
    update,
    before,
    after: {
      image: update.image,
      gallery: normalizeGallery(update.gallery),
      resolvedImage: resolvePackageImage(afterPkg),
      imageClassification: classifyPackageImageCandidate(update.image),
    },
  };
}

async function repairPackageImages(packages, opts = {}) {
  const results = [];
  for (const pkg of packages || []) {
    const result = await buildPackageImageRepair(pkg, opts);
    results.push(result);
    if (result.changed && opts.dbUnified && typeof opts.dbUnified.updateOne === 'function') {
      await opts.dbUnified.updateOne('packages', { id: pkg.id }, { $set: result.update });
    }
  }
  if (results.some(result => result.changed) && typeof opts.invalidateCaches === 'function') {
    opts.invalidateCaches();
  }
  return {
    dryRun: opts.dryRun !== false,
    scanned: (packages || []).length,
    changed: results.filter(result => result.changed).length,
    placeholderFallback: PLACEHOLDER_PACKAGE_IMAGE,
    results,
  };
}

module.exports = {
  dataUriToUploadFile,
  findPackageDataUriCandidates,
  buildPackageImageRepair,
  repairPackageImages,
};
