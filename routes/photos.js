/**
 * Photos Routes
 * Photo upload, management, approval, and editing endpoints
 */

'use strict';

const express = require('express');
const crypto = require('crypto');
const { uploadLimiter, apiLimiter } = require('../middleware/rateLimits');
const { PLACEHOLDER_PACKAGE_IMAGE } = require('../utils/constants');
const { getFeatureFlags } = require('../middleware/features');
const { checkPhotoAllowance, photoLimitError } = require('../utils/photoGalleryAllowance');
const { galleryAppendIfUrlAbsent, galleryAppendUpdate } = require('../utils/supplierGalleryUpdate');
const photoVariants = require('../utils/photo-variants');
const suppliersRouter = require('./suppliers');

const router = express.Router();

// These will be injected by server.js during route mounting
let dbUnified;
let authRequired;
let roleRequired;
let featureRequired;
let csrfProtection;
let photoUpload;
let logger;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Photos routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = [
    'dbUnified',
    'authRequired',
    'roleRequired',
    'featureRequired',
    'csrfProtection',
    'photoUpload',
    'logger',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Photos routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  roleRequired = deps.roleRequired;
  featureRequired = deps.featureRequired;
  csrfProtection = deps.csrfProtection;
  photoUpload = deps.photoUpload;
  logger = deps.logger;
}

/**
 * Deferred middleware wrappers
 * These are safe to reference in route definitions at require() time
 * because they defer the actual middleware call to request time,
 * when dependencies are guaranteed to be initialized.
 */
function applyAuthRequired(req, res, next) {
  if (!authRequired) {
    return res.status(503).json({ error: 'Auth service not initialized' });
  }
  return authRequired(req, res, next);
}

function applyRoleRequired(role) {
  return (req, res, next) => {
    if (!roleRequired) {
      return res.status(503).json({ error: 'Role service not initialized' });
    }
    return roleRequired(role)(req, res, next);
  };
}

function applyFeatureRequired(feature) {
  return (req, res, next) => {
    if (!featureRequired) {
      return res.status(503).json({ error: 'Feature service not initialized' });
    }
    return featureRequired(feature)(req, res, next);
  };
}

function applyCsrfProtection(req, res, next) {
  if (!csrfProtection) {
    return res.status(503).json({ error: 'CSRF service not initialized' });
  }
  return csrfProtection(req, res, next);
}

function applyPhotoUploadFields(fields) {
  return (req, res, next) => {
    if (!photoUpload) {
      return res.status(503).json({ error: 'Photo upload service not initialized' });
    }
    return photoUpload.upload.fields(fields)(req, res, err => {
      if (err) {
        // Determine endpoint for logging
        const endpoint = req.path.includes('/batch') ? '/upload/batch' : '/upload';

        // **NEW: Enhanced multer error handling**
        logger.error('Multer upload error', {
          error: err.message,
          code: err.code,
          field: err.field,
          storageErrors: err.storageErrors,
          userId: req.user?.id,
          endpoint,
        });

        // Check for file type rejection (not a MulterError)
        if (err.message?.includes('Invalid file type')) {
          return res.status(415).json({
            error: 'Unsupported file type',
            details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
            errorType: 'UnsupportedMediaType',
            allowedTypes: [
              'image/jpeg',
              'image/png',
              'image/webp',
              'image/gif',
              'image/avif',
              'image/heic',
            ],
          });
        }

        // Provide user-friendly error messages
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            error: 'File too large',
            details: 'Maximum file size is 10MB per image',
            errorType: 'FileSizeError',
          });
        }

        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            error: 'Too many files',
            details: 'Maximum 10 files per upload',
            errorType: 'FileCountError',
          });
        }

        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            error: 'Unexpected file field',
            details: 'Please use the correct upload form',
            errorType: 'UnexpectedFieldError',
          });
        }

        return res.status(400).json({
          error: 'File upload error',
          details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
          errorType: 'MulterError',
        });
      }

      const files = [];
      for (const field of fields) {
        const fieldFiles =
          req.files && Array.isArray(req.files[field.name]) ? req.files[field.name] : [];
        files.push(...fieldFiles);
      }

      // **NEW: Log parsed files**
      logger.info('Multer parsed files', {
        totalFiles: files.length,
        fileNames: files.map(f => f.originalname),
        userId: req.user?.id,
        endpoint: req.path.includes('/batch') ? '/upload/batch' : '/upload',
      });

      req.files = files;
      return next();
    });
  };
}

function applyPhotoUploadSingle(fieldName) {
  return (req, res, next) => {
    if (!photoUpload) {
      return res.status(503).json({ error: 'Photo upload service not initialized' });
    }
    return photoUpload.upload.single(fieldName)(req, res, next);
  };
}

function isMarketplaceOwner(listing, user) {
  if (!listing || !user) {
    return false;
  }
  return (
    listing.userId === user.id ||
    listing.ownerUserId === user.id ||
    listing.createdBy === user.id ||
    user.role === 'admin'
  );
}

function normalizeMarketplaceImageUrls(images) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .map(image => {
      if (typeof image === 'string') {
        return image;
      }
      if (image && typeof image === 'object' && typeof image.url === 'string') {
        return image.url;
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Helper function to classify errors and return appropriate HTTP status codes
 * and user-friendly messages
 * @param {Error} error - The error object to classify
 * @returns {Object} Object with statusCode, userMessage, and errorType
 */
function classifyUploadError(error) {
  // Check for MongoDB-related errors
  if (error.name === 'MongoDBUnavailableError' || error.name === 'MongoDBStorageError') {
    return {
      statusCode: 503,
      userMessage: 'Photo storage service temporarily unavailable. Please try again later.',
      errorType: error.name,
    };
  }

  // Check for validation errors
  if (error.name === 'ValidationError') {
    return {
      statusCode: 400,
      userMessage: 'Invalid file format or size. Please check your file and try again.',
      errorType: error.name,
    };
  }

  // Default to generic server error
  return {
    statusCode: 500,
    userMessage: 'Failed to upload photo',
    errorType: error.name || 'ServerError',
  };
}

// ---------- Photo Upload Routes ----------
//
// POST /photos/upload (one image, or several for a marketplace listing) and POST
// /photos/upload/batch share these small steps. Each step either answers the request itself or
// hands back what the next one needs, so the two route handlers read as the sequence they run.
// tests/integration/photos-upload-characterization.test.js pins every response, database call,
// photo pipeline call and log message with its fields (stack traces aside) of both routes.

/** A response to send instead of carrying on. */
function failure(status, body) {
  return { failure: { status, body } };
}

function sendFailure(res, { status, body }) {
  return res.status(status).json(body);
}

/** Log the arrival of an upload request (the same fields for single and batch). */
function logUploadRequest(message, req) {
  logger.info(message, {
    type: req.query.type,
    id: req.query.id,
    filesCount: req.files?.length || 0,
    fileNames: req.files?.map(f => f.originalname) || [],
    userId: req.user?.id,
    userRole: req.user?.role,
  });
}

/**
 * Check what every upload needs: at least one file, and a type and id in the query.
 * @returns {{failure: Object}|{type: *, id: *, normalizedId: *}}
 */
function readUploadTarget(req, noFilesMessage) {
  if (!req.files || req.files.length === 0) {
    return failure(400, { error: noFilesMessage });
  }

  const { type, id } = req.query;
  const normalizedId = Array.isArray(id) ? id[0] : id;
  if (!type || !normalizedId) {
    return failure(400, { error: 'Missing type or id parameter' });
  }
  return { type, id, normalizedId };
}

function buildPhotoRecord(images, metadata, userId) {
  return {
    url: images.optimized,
    thumbnail: images.thumbnail,
    large: images.large,
    original: images.original,
    approved: true,
    uploadedAt: new Date().toISOString(),
    uploadedBy: userId,
    metadata,
  };
}

/** What to tell the user about one image that could not be processed. */
function describeProcessingError(error) {
  if (error.name === 'ValidationError') {
    return `Invalid image: ${error.message}`;
  }
  if (error.message.includes('MongoDB')) {
    return 'Storage error - image could not be saved';
  }
  return error.message;
}

function logProcessingFailure(message, error, file, context) {
  logger.error(message, {
    error: error.message,
    errorName: error.name,
    stack: error.stack,
    filename: file.originalname,
    fileSize: file.size,
    mimeType: file.mimetype,
    ...context,
  });
}

/** Log, classify and answer an error thrown anywhere in an upload. */
function respondWithUploadError(req, res, message, error) {
  logger.error(message, {
    error: error.message,
    stack: error.stack,
    errorName: error.name,
    type: req.query.type,
    id: req.query.id,
    userId: req.user?.id,
    fileCount: req.files?.length || 0,
  });

  const { statusCode, userMessage, errorType } = classifyUploadError(error);

  res.status(statusCode).json({
    error: userMessage,
    details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    errorType,
  });
}

function canManageSupplier(supplier, user) {
  return supplier.ownerUserId === user.id || user.role === 'admin';
}

/**
 * Find a supplier the user may upload to and check it has room for `count` more photos.
 * @returns {Promise<{failure: Object}|{supplier: Object}>}
 */
async function loadSupplierWithAllowance(supplierId, user, count) {
  const supplier = await dbUnified.findOne('suppliers', { id: supplierId });
  if (!supplier) {
    return failure(404, { error: 'Supplier not found' });
  }
  if (!canManageSupplier(supplier, user)) {
    return failure(403, { error: 'Not authorized' });
  }

  const allowance = await checkPhotoAllowance(supplier, count);
  if (!allowance.allowed) {
    return failure(403, photoLimitError(allowance.limit, allowance.current));
  }
  return { supplier };
}

/**
 * Find a package whose supplier the user may upload to.
 * @returns {Promise<{failure: Object}|{pkg: Object}>}
 */
async function loadPackageForOwner(packageId, user) {
  const pkg = await dbUnified.findOne('packages', { id: packageId });
  if (!pkg) {
    return failure(404, { error: 'Package not found' });
  }

  const supplier = await dbUnified.findOne('suppliers', { id: pkg.supplierId });
  if (!supplier || !canManageSupplier(supplier, user)) {
    return failure(403, { error: 'Not authorized' });
  }
  return { pkg };
}

async function photoAutoApproveEnabled() {
  const flags = await getFeatureFlags();
  return flags.photoAutoApprove !== false;
}

/** A photo waiting for a moderator, as stored in the `photos` collection. */
function toPendingRecord(photoRecord, supplier) {
  return {
    ...photoRecord,
    id: `photo_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`,
    status: 'pending',
    approved: false,
    supplierId: supplier.id,
    supplierName: supplier.name,
  };
}

/** Add photos to a package's gallery, and make the first the cover if it has no real image. */
async function appendToPackageGallery(pkg, photos) {
  if (!pkg.gallery) {
    pkg.gallery = [];
  }
  pkg.gallery.push(...photos);

  const updateFields = { gallery: pkg.gallery };
  if (!pkg.image || pkg.image === PLACEHOLDER_PACKAGE_IMAGE) {
    updateFields.image = photos[0].url;
  }
  await dbUnified.updateOne('packages', { id: pkg.id }, { $set: updateFields });

  suppliersRouter.invalidatePackageCaches();
}

/** Save a listing's images, capped at 5 in total. */
async function saveMarketplaceImages(listing, existingImages, uploadedUrls) {
  listing.images = existingImages.concat(uploadedUrls).slice(0, 5);
  listing.updatedAt = new Date().toISOString();

  await dbUnified.updateOne(
    'marketplace_listings',
    { id: listing.id },
    { $set: { images: listing.images, updatedAt: listing.updatedAt } }
  );
}

// ----- Single upload: POST /photos/upload -----

/** Why one file of a marketplace upload cannot be processed, or null if it can. */
function marketplaceFileProblem(file, listingId, userId) {
  if (!file.buffer || file.buffer.length === 0) {
    logger.error('Empty file buffer received', {
      filename: file.originalname,
      listingId,
      userId,
    });
    return {
      filename: file.originalname || 'unknown',
      error: 'Empty file - please try re-uploading this image',
    };
  }

  // Validate file.originalname to prevent indexOf errors
  if (!file.originalname || typeof file.originalname !== 'string') {
    logger.error('Invalid file.originalname received', {
      originalname: file.originalname,
      type: typeof file.originalname,
      listingId,
      userId,
    });
    return {
      filename: 'unknown',
      error: 'Invalid file name - please try re-uploading this image',
    };
  }
  return null;
}

/** Process every file for a listing; order is the existing image count plus those done so far. */
async function processMarketplaceFiles(req, listingId, existingCount) {
  const uploadedUrls = [];
  const errors = [];

  for (const file of req.files) {
    const problem = marketplaceFileProblem(file, listingId, req.user.id);
    if (problem) {
      errors.push(problem);
      continue;
    }

    try {
      const images = await photoUpload.processAndSaveMarketplaceImage(
        file.buffer,
        file.originalname,
        listingId,
        req.user.id,
        existingCount + uploadedUrls.length
      );
      uploadedUrls.push(images.optimized);
    } catch (error) {
      logProcessingFailure('Marketplace photo processing failed', error, file, {
        listingId,
        userId: req.user.id,
      });
      errors.push({ filename: file.originalname, error: describeProcessingError(error) });
    }
  }
  return { uploadedUrls, errors };
}

function marketplaceUploadMessage(uploaded, failed) {
  if (uploaded === 0) {
    return 'No images were uploaded.';
  }
  return `${uploaded} image(s) uploaded successfully${failed > 0 ? `, ${failed} failed` : ''}.`;
}

/** Several images for a marketplace listing. */
async function uploadMarketplaceImages(req, res, { normalizedId }) {
  const listing = await dbUnified.findOne('marketplace_listings', { id: normalizedId });

  if (!listing) {
    return res.status(404).json({
      error: 'Listing not found',
      errorType: 'NotFoundError',
      details: `No listing found with ID: ${normalizedId}`,
    });
  }

  if (!isMarketplaceOwner(listing, req.user)) {
    return res.status(403).json({
      error: 'Not authorized',
      errorType: 'AuthorizationError',
      details: 'You do not have permission to upload photos to this listing',
    });
  }

  const existingImages = normalizeMarketplaceImageUrls(listing.images);
  const { uploadedUrls, errors } = await processMarketplaceFiles(
    req,
    normalizedId,
    existingImages.length
  );

  if (uploadedUrls.length === 0 && errors.length > 0) {
    logger.error('All marketplace photos failed to upload', {
      listingId: normalizedId,
      userId: req.user.id,
      errorCount: errors.length,
      errors,
    });

    return res.status(500).json({
      success: false,
      error: 'All photo uploads failed',
      errorType: 'UploadError',
      details: errors,
      uploaded: 0,
    });
  }

  await saveMarketplaceImages(listing, existingImages, uploadedUrls);

  logger.info('Marketplace images uploaded', {
    listingId: normalizedId,
    userId: req.user.id,
    count: uploadedUrls.length,
    errors: errors.length,
  });

  return res.json({
    success: true,
    urls: uploadedUrls,
    errors: errors.length > 0 ? errors : undefined,
    message: marketplaceUploadMessage(uploadedUrls.length, errors.length),
  });
}

/** Process the one uploaded file and describe it as a gallery record. */
async function processSingleImage(file, type, userId) {
  const images = await photoUpload.processAndSaveImage(file.buffer, file.originalname, type);
  const metadata = await photoUpload.getImageMetadata(file.buffer);
  return buildPhotoRecord(images, metadata, userId);
}

// For a supplier or a package the target is looked up and authorised before the file is processed,
// so a request for a record that is missing, someone else's or over its allowance stores nothing.

async function uploadSingleSupplierPhoto(req, res, { id, type }) {
  const loaded = await loadSupplierWithAllowance(id, req.user, 1);
  if (loaded.failure) {
    return sendFailure(res, loaded.failure);
  }
  const { supplier } = loaded;
  const photoRecord = await processSingleImage(req.files[0], type, req.user.id);

  if (await photoAutoApproveEnabled()) {
    await dbUnified.updateOne(
      'suppliers',
      { id: supplier.id },
      galleryAppendUpdate(supplier, photoRecord)
    );

    return res.json({
      success: true,
      photo: photoRecord,
      message: 'Photo uploaded successfully.',
    });
  }

  // Auto-approve OFF: store as pending for moderation
  const pendingRecord = toPendingRecord(photoRecord, supplier);
  const photoInserted = await dbUnified.insertOne('photos', pendingRecord);
  if (!photoInserted) {
    logger.error('[PHOTOS] insertOne failed for pending record', {
      photoId: pendingRecord.id,
    });
    return res.status(500).json({ error: 'Failed to save photo record. Please try again.' });
  }

  return res.json({
    success: true,
    photo: pendingRecord,
    pending: true,
    message: 'Photo uploaded and is awaiting moderation approval.',
  });
}

async function uploadSinglePackagePhoto(req, res, { id, type }) {
  const loaded = await loadPackageForOwner(id, req.user);
  if (loaded.failure) {
    return sendFailure(res, loaded.failure);
  }
  const photoRecord = await processSingleImage(req.files[0], type, req.user.id);

  await appendToPackageGallery(loaded.pkg, [photoRecord]);

  return res.json({
    success: true,
    photo: photoRecord,
    message: 'Photo uploaded successfully.',
  });
}

/**
 * One image for a supplier or a package. The type is checked before anything else, so an unknown
 * one stores nothing; the route takes up to five files for marketplace listings, but a supplier or
 * package gets exactly one, so more than one is refused rather than the rest being dropped.
 */
async function uploadSingleImage(req, res, target) {
  if (target.type !== 'supplier' && target.type !== 'package') {
    return res
      .status(400)
      .json({ error: 'Invalid type. Must be supplier, package, or marketplace.' });
  }
  if (req.files.length > 1) {
    return res.status(400).json({
      error: `Only one file can be uploaded at a time for a ${target.type}. Use the batch upload for several.`,
    });
  }
  if (target.type === 'supplier') {
    return uploadSingleSupplierPhoto(req, res, target);
  }
  return uploadSinglePackagePhoto(req, res, target);
}

async function handleSingleUpload(req, res) {
  logUploadRequest('Photo upload request received', req);

  try {
    const target = readUploadTarget(req, 'No file uploaded');
    if (target.failure) {
      return sendFailure(res, target.failure);
    }

    if (target.type === 'marketplace') {
      return await uploadMarketplaceImages(req, res, target);
    }
    return await uploadSingleImage(req, res, target);
  } catch (error) {
    return respondWithUploadError(req, res, 'Photo upload error', error);
  }
}

/**
 * Upload photos for supplier, package, or marketplace listing
 * POST /api/photos/upload
 */
router.post(
  '/photos/upload',
  uploadLimiter,
  applyAuthRequired,
  applyFeatureRequired('photoUploads'),
  applyPhotoUploadFields([
    { name: 'files', maxCount: 5 },
    { name: 'photos', maxCount: 5 },
  ]), // Accept both multipart field names used across clients
  applyCsrfProtection,
  handleSingleUpload
);

// ----- Batch upload: POST /photos/upload/batch -----

function logBatchFile(file, listingId, userId) {
  logger.info('Processing file in batch upload', {
    hasFile: Boolean(file),
    hasOriginalname: Boolean(file?.originalname),
    originalnameType: typeof file?.originalname,
    originalnameValue: file?.originalname,
    hasBuffer: Boolean(file?.buffer),
    bufferLength: file?.buffer?.length,
    mimetype: file?.mimetype,
    size: file?.size,
    listingId,
    userId,
  });
}

function notABufferProblem(file, { listingId, userId }) {
  if (file.buffer && Buffer.isBuffer(file.buffer)) {
    return null;
  }
  logger.error('Invalid file buffer received', {
    filename: file.originalname || 'unknown',
    hasBuffer: Boolean(file.buffer),
    isBuffer: file.buffer ? Buffer.isBuffer(file.buffer) : false,
    listingId,
    userId,
  });
  return {
    filename: file.originalname || 'unknown',
    error: 'Invalid file data - please try re-uploading this image',
  };
}

function emptyBufferProblem(file, { listingId, userId }) {
  if (file.buffer.length !== 0) {
    return null;
  }
  logger.error('Empty file buffer received', {
    filename: file.originalname,
    listingId,
    userId,
  });
  return {
    filename: file.originalname || 'unknown',
    error: 'Empty file - please try re-uploading this image',
  };
}

// Validate file.originalname to prevent indexOf errors
function badFileNameProblem(file, { listingId, userId }) {
  if (file.originalname && typeof file.originalname === 'string') {
    return null;
  }
  logger.error('Invalid file.originalname received', {
    originalname: file.originalname,
    type: typeof file.originalname,
    listingId,
    userId,
    fileKeys: file ? Object.keys(file) : [],
    mimetype: file?.mimetype,
    size: file?.size,
  });
  return {
    filename: 'unknown',
    error: 'Invalid file name - the file may be corrupted. Please try selecting it again.',
  };
}

// Checked in this order; the first problem found is the one reported.
const BATCH_FILE_CHECKS = [notABufferProblem, emptyBufferProblem, badFileNameProblem];

/** Why one file of a batch cannot be processed, or null if it can. */
function batchFileProblem(file, context) {
  for (const check of BATCH_FILE_CHECKS) {
    const problem = check(file, context);
    if (problem) {
      return problem;
    }
  }
  return null;
}

async function processBatchFile(file, { type, normalizedId }, userId, order) {
  // Marketplace images go through their own processing, with a position in the listing
  const images =
    type === 'marketplace'
      ? await photoUpload.processAndSaveMarketplaceImage(
          file.buffer,
          file.originalname,
          normalizedId,
          userId,
          order
        )
      : await photoUpload.processAndSaveImage(file.buffer, file.originalname, type);
  const metadata = await photoUpload.getImageMetadata(file.buffer);

  return buildPhotoRecord(images, metadata, userId);
}

/** Process every file, collecting the photo records that worked and an entry for each that did not. */
async function processBatchFiles(req, target, existingImagesCount) {
  const { type, normalizedId } = target;
  const uploadedPhotos = [];
  const errors = [];

  for (const file of req.files) {
    logBatchFile(file, normalizedId, req.user?.id);

    const problem = batchFileProblem(file, { listingId: normalizedId, userId: req.user.id });
    if (problem) {
      errors.push(problem);
      continue;
    }

    try {
      const order = existingImagesCount + uploadedPhotos.length;
      uploadedPhotos.push(await processBatchFile(file, target, req.user.id, order));
    } catch (error) {
      logProcessingFailure('Batch photo processing failed', error, file, {
        type,
        id: normalizedId,
        userId: req.user.id,
      });
      errors.push({ filename: file.originalname, error: describeProcessingError(error) });
    }
  }
  return { uploadedPhotos, errors };
}

/** The 404 or 403 for a listing the user may not upload to, or null when they may. */
function marketplaceListingFailure(listing, user) {
  if (!listing) {
    return failure(404, { error: 'Listing not found' });
  }
  if (!isMarketplaceOwner(listing, user)) {
    return failure(403, { error: 'Not authorized' });
  }
  return null;
}

/**
 * Look up and authorise what a batch is for, before any file is processed, so a request for a
 * record that is missing, someone else's, over its allowance or of an unknown type stores nothing.
 * @returns {Promise<{failure: Object}|{existingImagesCount: number, supplier?: Object, pkg?: Object}>}
 */
async function prepareBatchTarget(req, { type, normalizedId }) {
  if (type === 'marketplace') {
    const listing = await dbUnified.findOne('marketplace_listings', { id: normalizedId });
    return (
      marketplaceListingFailure(listing, req.user) || {
        existingImagesCount: normalizeMarketplaceImageUrls(listing.images).length,
      }
    );
  }
  if (type === 'supplier') {
    // Every file counts towards the allowance, since which ones will process is not yet known
    const loaded = await loadSupplierWithAllowance(normalizedId, req.user, req.files.length);
    return loaded.failure ? loaded : { existingImagesCount: 0, supplier: loaded.supplier };
  }
  if (type === 'package') {
    const loaded = await loadPackageForOwner(normalizedId, req.user);
    return loaded.failure ? loaded : { existingImagesCount: 0, pkg: loaded.pkg };
  }
  return failure(400, { error: 'Invalid type' });
}

// After processing, one finisher per type saves the photos. Each returns true when it has already
// answered the request, and false when the shared success response should be sent.

/** Save photos to a marketplace listing and answer (always answers). */
async function finishMarketplaceBatch(req, res, { normalizedId }, uploadedPhotos, errors) {
  // Read again, so the save builds on the listing as it is now rather than before processing
  const listing = await dbUnified.findOne('marketplace_listings', { id: normalizedId });
  const problem = marketplaceListingFailure(listing, req.user);
  if (problem) {
    sendFailure(res, problem.failure);
    return true;
  }

  const uploadedUrls = uploadedPhotos.map(p => p.url);

  if (uploadedUrls.length === 0 && errors.length > 0) {
    logger.error('All marketplace photos failed to upload (batch)', {
      listingId: normalizedId,
      userId: req.user.id,
      errorCount: errors.length,
      errors,
    });

    res.status(500).json({
      success: false,
      error: 'All photo uploads failed',
      details: errors,
      uploaded: 0,
    });
    return true;
  }

  await saveMarketplaceImages(listing, normalizeMarketplaceImageUrls(listing.images), uploadedUrls);

  logger.info('Marketplace images uploaded (batch)', {
    listingId: normalizedId,
    userId: req.user.id,
    count: uploadedUrls.length,
  });

  res.json({
    success: true,
    uploaded: uploadedUrls.length,
    urls: uploadedUrls,
    errors,
    message: `${uploadedUrls.length} photo(s) uploaded successfully to marketplace listing.`,
  });
  return true;
}

/** Store every photo as a pending record; answers with those that were saved. */
async function savePendingSupplierPhotos(res, supplier, uploadedPhotos, errors) {
  const pendingRecords = uploadedPhotos.map(p => toPendingRecord(p, supplier));

  const insertResults = await Promise.all(
    pendingRecords.map(r => dbUnified.insertOne('photos', r))
  );
  const failedInserts = insertResults.filter(r => !r).length;
  if (failedInserts > 0) {
    logger.error('[PHOTOS] bulk insertOne: some records failed', {
      total: pendingRecords.length,
      failed: failedInserts,
    });
  }
  const savedPhotos = pendingRecords.filter((_, i) => insertResults[i]);

  res.json({
    success: true,
    uploaded: savedPhotos.length,
    photos: savedPhotos,
    pending: true,
    errors,
    message: `${savedPhotos.length} photo(s) uploaded and awaiting moderation approval.`,
  });
}

async function finishSupplierBatch(res, { supplier }, uploadedPhotos, errors) {
  if (!(await photoAutoApproveEnabled())) {
    await savePendingSupplierPhotos(res, supplier, uploadedPhotos, errors);
    return true;
  }

  // Auto-approve ON: add directly to gallery
  await dbUnified.updateOne(
    'suppliers',
    { id: supplier.id },
    galleryAppendUpdate(supplier, uploadedPhotos)
  );
  return false;
}

async function finishPackageBatch({ pkg }, uploadedPhotos) {
  await appendToPackageGallery(pkg, uploadedPhotos);
  return false;
}

/** @returns {Promise<boolean>} true when the request has been answered */
async function finishBatchUpload(req, res, target, prepared, uploadedPhotos, errors) {
  switch (target.type) {
    case 'marketplace':
      return finishMarketplaceBatch(req, res, target, uploadedPhotos, errors);
    case 'supplier':
      return finishSupplierBatch(res, prepared, uploadedPhotos, errors);
    default:
      return finishPackageBatch(prepared, uploadedPhotos);
  }
}

async function handleBatchUpload(req, res) {
  logUploadRequest('Batch photo upload request received', req);

  try {
    const target = readUploadTarget(req, 'No files uploaded');
    if (target.failure) {
      return sendFailure(res, target.failure);
    }

    // The target is looked up and authorised first, so nothing is processed for one that is refused
    const prepared = await prepareBatchTarget(req, target);
    if (prepared.failure) {
      return sendFailure(res, prepared.failure);
    }

    const { uploadedPhotos, errors } = await processBatchFiles(
      req,
      target,
      prepared.existingImagesCount
    );

    const answered = await finishBatchUpload(req, res, target, prepared, uploadedPhotos, errors);
    if (answered) {
      return undefined;
    }

    return res.json({
      success: true,
      uploaded: uploadedPhotos.length,
      photos: uploadedPhotos,
      errors,
      message: `${uploadedPhotos.length} photo(s) uploaded successfully.`,
    });
  } catch (error) {
    return respondWithUploadError(req, res, 'Batch upload error', error);
  }
}

/**
 * Upload multiple photos (batch upload)
 * POST /api/photos/upload/batch
 * Body: multipart/form-data with 'photos' field (multiple files)
 * Query: ?type=supplier|package|marketplace&id=<supplierId|packageId|listingId>
 * Note: Accepts up to 10 files for supplier/package, marketplace listings capped at 5 images total
 */
router.post(
  '/photos/upload/batch',
  uploadLimiter,
  applyAuthRequired,
  applyFeatureRequired('photoUploads'),
  applyPhotoUploadFields([
    { name: 'photos', maxCount: 10 },
    { name: 'files', maxCount: 10 },
  ]),
  applyCsrfProtection,
  handleBatchUpload
);

// ---------- Photo Management Routes ----------

/**
 * Whether another supplier or package still shows this photo. A gallery can hold any address a
 * user types, so being in your own gallery does not mean the stored file is yours: the file is only
 * deleted when nothing else points at it.
 *
 * @param {string} url - Photo address
 * @param {{supplierId?: string, packageId?: string}} own - The records the photo was just removed from
 * @returns {Promise<boolean>} True when something else still uses it
 */
async function isPhotoUsedElsewhere(url, own) {
  const [suppliers, objectPackages, plainPackages, coverPackages] = await Promise.all([
    dbUnified.find('suppliers', { 'photosGallery.url': url }),
    dbUnified.find('packages', { 'gallery.url': url }),
    dbUnified.find('packages', { gallery: url }),
    dbUnified.find('packages', { image: url }),
  ]);
  const others = (rows, ownId) => (rows || []).some(row => row && row.id !== ownId);
  return (
    others(suppliers, own.supplierId) ||
    others(objectPackages, own.packageId) ||
    others(plainPackages, own.packageId) ||
    others(coverPackages, own.packageId)
  );
}

/** What a delete helper returns when it refuses: the HTTP status and message to answer with. */
const refusal = (status, error) => ({ status, error });

/**
 * Remove a photo from a supplier's own gallery and delete the stored file.
 *
 * @param {Object} user - The signed-in user
 * @param {string} id - Supplier id
 * @param {string} url - Photo address
 * @returns {Promise<{status: number, error: string}|null>} A refusal, or null when it was removed
 */
async function deleteSupplierPhoto(user, id, url) {
  const supplier = await dbUnified.findOne('suppliers', { id });
  if (!supplier) {
    return refusal(404, 'Supplier not found');
  }
  if (supplier.ownerUserId !== user.id && user.role !== 'admin') {
    return refusal(403, 'Not authorized');
  }

  const gallery = Array.isArray(supplier.photosGallery) ? supplier.photosGallery : [];
  const remaining = gallery.filter(p => p.url !== url);
  // Only a photo that is in this supplier's own gallery may be removed. Without this check the
  // file would be deleted by address alone, so any supplier could delete another's photos.
  if (remaining.length === gallery.length) {
    return refusal(404, 'Photo not found');
  }
  // Pull by URL (the same match the filter above used) so an overlapping upload is not overwritten.
  await dbUnified.updateOne(
    'suppliers',
    { id: supplier.id },
    { $pull: { photosGallery: { url } } }
  );

  // Delete the stored file, unless another record still shows it
  if (!(await isPhotoUsedElsewhere(url, { supplierId: supplier.id }))) {
    await photoUpload.deleteImage(url);
  }
  return null;
}

/**
 * The address of a package gallery item, which is stored as a string or as an object with a url.
 *
 * @param {string|{url?: string}} item - Gallery item
 * @returns {string} Address ('' when it has none)
 */
const galleryItemUrl = item => (typeof item === 'string' ? item : item.url || '');

/**
 * Remove a photo from a package's own gallery, keep its cover photo in step, and delete the stored
 * file.
 *
 * @param {Object} user - The signed-in user
 * @param {string} id - Package id
 * @param {string} url - Photo address
 * @returns {Promise<{status: number, error: string}|null>} A refusal, or null when it was removed
 */
async function deletePackagePhoto(user, id, url) {
  const pkg = await dbUnified.findOne('packages', { id });
  if (!pkg) {
    return refusal(404, 'Package not found');
  }
  const supplier = await dbUnified.findOne('suppliers', { id: pkg.supplierId });
  if (!supplier || (supplier.ownerUserId !== user.id && user.role !== 'admin')) {
    return refusal(403, 'Not authorized');
  }

  const originalGallery = Array.isArray(pkg.gallery) ? pkg.gallery : [];
  const gallery = originalGallery.filter(item => galleryItemUrl(item) !== url);
  // Only a photo in this package's own gallery may be removed (see deleteSupplierPhoto).
  if (gallery.length === originalGallery.length) {
    return refusal(404, 'Photo not found');
  }
  const updateFields = { gallery };
  // Sync pkg.image with first remaining gallery photo (or placeholder)
  if (!pkg.image || pkg.image === PLACEHOLDER_PACKAGE_IMAGE || pkg.image === url) {
    updateFields.image = gallery.length
      ? galleryItemUrl(gallery[0]) || PLACEHOLDER_PACKAGE_IMAGE
      : PLACEHOLDER_PACKAGE_IMAGE;
  }
  await dbUnified.updateOne('packages', { id: pkg.id }, { $set: updateFields });
  suppliersRouter.invalidatePackageCaches();

  // Delete the stored file, unless another record still shows it
  if (!(await isPhotoUsedElsewhere(url, { packageId: pkg.id }))) {
    await photoUpload.deleteImage(url);
  }
  return null;
}

/**
 * Delete photo
 * DELETE /api/photos/delete
 * Query: ?type=supplier|package&id=<supplierId|packageId>&photoUrl=<url>
 */
router.delete('/photos/delete', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    const { type, id, photoUrl } = req.query;

    if (!type || !id || !photoUrl) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const url = decodeURIComponent(photoUrl);
    let refused = null;
    if (type === 'supplier') {
      refused = await deleteSupplierPhoto(req.user, id, url);
    } else if (type === 'package') {
      refused = await deletePackagePhoto(req.user, id, url);
    }
    if (refused) {
      return res.status(refused.status).json({ error: refused.error });
    }

    return res.json({ success: true, message: 'Photo deleted successfully' });
  } catch (error) {
    logger.error('Delete photo error:', error);
    return res.status(500).json({
      error: 'Failed to delete photo',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Approve photo (deprecated — photos are now auto-approved on upload)
 * POST /api/photos/approve
 */
router.post(
  '/photos/approve',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  (req, res) => {
    res.json({
      success: true,
      message: 'Photo approval is no longer required. Photos are auto-approved on upload.',
    });
  }
);

/**
 * Crop image
 * POST /api/photos/crop
 * Body: { imageUrl, cropData: { x, y, width, height } }
 */
router.post('/photos/crop', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    const { imageUrl, cropData } = req.body;

    if (!imageUrl || !cropData) {
      return res.status(400).json({ error: 'Missing imageUrl or cropData' });
    }

    // Validate crop data
    if (!cropData.x || !cropData.y || !cropData.width || !cropData.height) {
      return res.status(400).json({ error: 'Invalid crop data' });
    }

    const croppedImages = await photoUpload.cropImage(imageUrl, cropData);

    res.json({
      success: true,
      images: croppedImages,
      message: 'Image cropped successfully',
    });
  } catch (error) {
    logger.error('Crop image error:', error);
    res.status(500).json({
      error: 'Failed to crop image',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Get pending photos for moderation (deprecated — photos are now auto-approved on upload)
 * GET /api/photos/pending
 */
router.get(
  '/photos/pending',
  apiLimiter,
  applyAuthRequired,
  applyRoleRequired('admin'),
  (req, res) => {
    res.json({
      success: true,
      count: 0,
      photos: [],
      message: 'Photo approval is no longer required. Photos are auto-approved on upload.',
    });
  }
);

/**
 * PUT /api/photos/:id
 * Edit photo metadata (caption, alt text, tags)
 */
router.put('/photos/:id', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { caption, altText, tags, isFeatured, watermark } = req.body;

    const metadata = await photoUpload.updatePhotoMetadata(id, {
      caption,
      altText,
      tags,
      isFeatured,
      watermark,
    });

    res.json({
      success: true,
      metadata,
      message: 'Photo metadata updated successfully',
    });
  } catch (error) {
    logger.error('Update photo metadata error:', error);
    res.status(500).json({
      error: 'Failed to update photo metadata',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * POST /api/photos/:id/replace
 * Replace photo while keeping metadata
 */
router.post(
  '/photos/:id/replace',
  applyAuthRequired,
  applyPhotoUploadSingle('photo'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { metadata } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: 'No photo file provided' });
      }

      const result = await photoUpload.replacePhoto(
        id,
        req.file.buffer,
        JSON.parse(metadata || '{}')
      );

      res.json({
        success: true,
        photo: result,
        message: 'Photo replaced successfully',
      });
    } catch (error) {
      logger.error('Replace photo error:', error);
      res.status(500).json({
        error: 'Failed to replace photo',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
    }
  }
);

/**
 * POST /api/photos/bulk-edit
 * Bulk update multiple photos
 */
router.post('/photos/bulk-edit', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    const { photos } = req.body;

    if (!Array.isArray(photos)) {
      return res.status(400).json({ error: 'Photos must be an array' });
    }

    const results = await Promise.all(
      photos.map(photo => photoUpload.updatePhotoMetadata(photo.id, photo.metadata))
    );

    res.json({
      success: true,
      updated: results.length,
      photos: results,
      message: `${results.length} photo(s) updated successfully`,
    });
  } catch (error) {
    logger.error('Bulk edit photos error:', error);
    res.status(500).json({
      error: 'Failed to bulk edit photos',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * POST /api/photos/:id/filters
 * Apply filters to photo (brightness, contrast, saturation)
 */
router.post('/photos/:id/filters', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    // eslint-disable-next-line no-unused-vars
    const { id: _id } = req.params; // Photo ID from URL (not currently used)
    const { imageUrl, brightness, contrast, saturation } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    const result = await photoUpload.applyFilters(imageUrl, {
      brightness: parseFloat(brightness) || 1,
      contrast: parseFloat(contrast) || 1,
      saturation: parseFloat(saturation) || 1,
    });

    res.json({
      success: true,
      image: result,
      message: 'Filters applied successfully',
    });
  } catch (error) {
    logger.error('Apply filters error:', error);
    res.status(500).json({
      error: 'Failed to apply filters',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * POST /api/photos/reorder
 * Update photo order in gallery
 */
router.post('/photos/reorder', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    const { photoOrder } = req.body;

    if (!Array.isArray(photoOrder)) {
      return res.status(400).json({ error: 'Photo order must be an array' });
    }

    const result = await photoUpload.updatePhotoOrder(photoOrder);

    res.json({
      success: true,
      order: result,
      message: 'Photo order updated successfully',
    });
  } catch (error) {
    logger.error('Reorder photos error:', error);
    res.status(500).json({
      error: 'Failed to reorder photos',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

// ---------- Admin Photo Management Routes ----------

router.get(
  '/admin/photos/pending',
  applyAuthRequired,
  applyRoleRequired('admin'),
  async (req, res) => {
    const pendingPhotos = await dbUnified.find('photos', { status: 'pending' });

    // Enrich with supplier information
    // Fetch only the suppliers referenced by these pending photos
    const pendingSupplierIds = [...new Set(pendingPhotos.map(p => p.supplierId).filter(Boolean))];
    const pendingSuppliers = pendingSupplierIds.length
      ? await Promise.all(
          pendingSupplierIds.map(sid => dbUnified.findOne('suppliers', { id: sid }))
        )
      : [];
    const pendingSupplierMap = Object.fromEntries(
      pendingSuppliers.filter(Boolean).map(s => [s.id, s])
    );
    const enrichedPhotos = pendingPhotos.map(photo => {
      const supplier = pendingSupplierMap[photo.supplierId];
      return {
        ...photo,
        supplierName: supplier ? supplier.name : 'Unknown',
        supplierCategory: supplier ? supplier.category : null,
      };
    });

    res.json({ photos: enrichedPhotos });
  }
);

/**
 * GET /api/admin/photos/library
 * Get all approved photos from supplier galleries (for library view when auto-approve is ON).
 */
router.get(
  '/admin/photos/library',
  apiLimiter,
  applyAuthRequired,
  applyRoleRequired('admin'),
  async (req, res) => {
    try {
      // Admin: iterate all suppliers to compile gallery photos — intentional full read
      const suppliers = await dbUnified.read('suppliers');
      const photos = [];

      for (const supplier of suppliers) {
        if (!supplier.photosGallery || supplier.photosGallery.length === 0) {
          continue;
        }
        for (const p of supplier.photosGallery) {
          photos.push({
            ...p,
            id:
              p.id ||
              `${supplier.id}_${Buffer.from(p.url || '')
                .toString('base64')
                .slice(0, 16)}`,
            supplierId: supplier.id,
            supplierName: supplier.name || 'Unknown',
            uploadedAt: p.uploadedAt || null,
          });
        }
      }

      res.json({ success: true, count: photos.length, photos });
    } catch (error) {
      logger.error('Error fetching photo library:', error);
      res.status(500).json({
        error: 'Failed to fetch photo library',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
    }
  }
);

/**
 * GET /api/admin/photos
 * Get photos for a specific supplier (admin view)
 */
router.get('/admin/photos', applyAuthRequired, applyRoleRequired('admin'), async (req, res) => {
  try {
    const { supplierId } = req.query;

    if (!supplierId) {
      return res.status(400).json({ error: 'supplierId query parameter is required' });
    }

    const supplier = await dbUnified.findOne('suppliers', { id: supplierId });

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    // Get photos from photosGallery (includes approved and unapproved)
    const photos = supplier.photosGallery || [];

    res.json({
      success: true,
      photos: photos.map(p => ({
        ...p,
        id: p.id || `${supplierId}_${p.uploadedAt}`,
        supplierId,
      })),
    });
  } catch (error) {
    logger.error('Error fetching supplier photos:', error);
    res.status(500).json({
      error: 'Failed to fetch photos',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * POST /api/admin/photos/:id/approve
 * Approve a photo
 */
router.post(
  '/admin/photos/:id/approve',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    const { id } = req.params;
    const photo = await dbUnified.findOne('photos', { id });

    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    const now = new Date().toISOString();

    // Update photo status
    photo.status = 'approved';
    photo.approvedAt = now;
    photo.approvedBy = req.user.id;

    await dbUnified.updateOne(
      'photos',
      { id: photo.id },
      { $set: { status: photo.status, approvedAt: photo.approvedAt, approvedBy: photo.approvedBy } }
    );

    // Add photo to supplier's photosGallery if not already there
    const approvedSupplier = await dbUnified.findOne('suppliers', { id: photo.supplierId });

    if (approvedSupplier) {
      const currentGallery = approvedSupplier.photosGallery || [];
      const alreadyInGallery = currentGallery.some(p => p.url === photo.url);
      if (!alreadyInGallery) {
        // Conditional on the URL still being absent, so two overlapping approvals of the same
        // photo cannot both insert it.
        const { filter, update } = galleryAppendIfUrlAbsent(approvedSupplier, {
          url: photo.url,
          approved: true,
          uploadedAt: photo.uploadedAt || new Date().toISOString(),
        });
        await dbUnified.updateOne('suppliers', filter, update);
      }
    }

    res.json({ success: true, message: 'Photo approved successfully', photo });
  }
);

/**
 * POST /api/admin/photos/:id/reject
 * Reject a photo
 */
router.post(
  '/admin/photos/:id/reject',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const photo = await dbUnified.findOne('photos', { id });

    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    const now = new Date().toISOString();

    // Update photo status
    photo.status = 'rejected';
    photo.rejectedAt = now;
    photo.rejectedBy = req.user.id;
    photo.rejectionReason = reason || 'No reason provided';

    await dbUnified.updateOne(
      'photos',
      { id: photo.id },
      {
        $set: {
          status: photo.status,
          rejectedAt: photo.rejectedAt,
          rejectedBy: photo.rejectedBy,
          rejectionReason: photo.rejectionReason,
        },
      }
    );

    res.json({ success: true, message: 'Photo rejected successfully', photo });
  }
);

/**
 * GET /api/photos/:id
 * Serve photo from MongoDB
 * This endpoint serves the actual photo binary data
 */
router.get('/photos/:id', apiLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if MongoDB is available
    const databaseConfig = require('../config/database');
    if (!databaseConfig.isMongoAvailable()) {
      return res.status(503).json({ error: 'Photo storage not available' });
    }

    const mongoDb = databaseConfig.mongoDb;
    const db = await mongoDb.getDb();

    // Try marketplace_images collection first, then fall back to photos collection
    let photo = await db.collection('marketplace_images').findOne({ _id: id });

    if (!photo) {
      // Fall back to generic photos collection for backward compatibility
      photo = await db.collection('photos').findOne({ _id: id });
    }

    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    // Convert base64 back to buffer
    // Note: Backward compatibility - 'photos' collection uses 'data' field,
    // while 'marketplace_images' collection uses 'imageData' field
    const imageBuffer = Buffer.from(photo.data || photo.imageData, 'base64');

    // `?w=` asks for a rendition no wider than that (snapped to a short list of
    // widths) so a card that shows the photo at ~300 px does not download the
    // 1200 px original. Anything that cannot or need not be resized falls
    // through to the original below.
    const width = photoVariants.snapWidth(req.query.w);
    if (width) {
      // The body depends on whether the client accepts WebP.
      res.vary('Accept');
      const variant = await photoVariants.getPhotoVariant({
        id,
        buffer: imageBuffer,
        mimeType: photo.mimeType,
        width,
        acceptsWebp: /image\/webp/i.test(req.get('accept') || ''),
        version: String(photo.updatedAt || photo.uploadedAt || photo.createdAt || ''),
      });
      if (variant) {
        res.setHeader('Content-Type', variant.mimeType);
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        res.setHeader('Content-Length', variant.buffer.length);
        return res.send(variant.buffer);
      }
    }

    // Set appropriate headers
    res.setHeader('Content-Type', photo.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.setHeader('Content-Length', imageBuffer.length);

    // Send the image
    res.send(imageBuffer);
  } catch (error) {
    logger.error('Error serving photo from MongoDB:', error);
    res.status(500).json({ error: 'Failed to retrieve photo' });
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
module.exports.checkPhotoAllowance = checkPhotoAllowance;
