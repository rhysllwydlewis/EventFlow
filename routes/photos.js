/**
 * Photos Routes
 * Photo upload, management, approval, and editing endpoints
 */

'use strict';

const express = require('express');
const { uploadLimiter, apiLimiter } = require('../middleware/rateLimits');
const { PLACEHOLDER_PACKAGE_IMAGE } = require('../utils/constants');
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
          endpoint: endpoint,
        });

        // Check for file type rejection (not a MulterError)
        if (err.message && err.message.includes('Invalid file type')) {
          return res.status(415).json({
            error: 'Unsupported file type',
            details: err.message,
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
          details: err.message,
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
  async (req, res) => {
    // Add diagnostic logging
    logger.info('Photo upload request received', {
      type: req.query.type,
      id: req.query.id,
      filesCount: req.files?.length || 0,
      fileNames: req.files?.map(f => f.originalname) || [],
      userId: req.user?.id,
      userRole: req.user?.role,
    });

    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { type, id } = req.query;
      const normalizedId = Array.isArray(id) ? id[0] : id;
      if (!type || !normalizedId) {
        return res.status(400).json({ error: 'Missing type or id parameter' });
      }

      // Handle marketplace type with multiple files
      if (type === 'marketplace') {
        const listings = await dbUnified.read('marketplace_listings');
        if (!Array.isArray(listings)) {
          return res.status(500).json({
            error: 'Database unavailable',
            errorType: 'DatabaseError',
            details: 'Marketplace listings database is not accessible',
          });
        }
        const listing = listings.find(l => l.id === normalizedId);

        if (!listing) {
          return res.status(404).json({
            error: 'Listing not found',
            errorType: 'NotFoundError',
            details: `No listing found with ID: ${normalizedId}`,
          });
        }

        // Verify ownership
        if (!isMarketplaceOwner(listing, req.user)) {
          return res.status(403).json({
            error: 'Not authorized',
            errorType: 'AuthorizationError',
            details: 'You do not have permission to upload photos to this listing',
          });
        }

        // Get existing images for order tracking
        const existingImages = normalizeMarketplaceImageUrls(listing.images);

        // Process and append URLs with enhanced error handling
        const uploadedUrls = [];
        const errors = [];
        for (let i = 0; i < req.files.length; i++) {
          const file = req.files[i];
          // Validate file buffer exists
          if (!file.buffer || file.buffer.length === 0) {
            logger.error('Empty file buffer received', {
              filename: file.originalname,
              listingId: normalizedId,
              userId: req.user.id,
            });
            errors.push({
              filename: file.originalname || 'unknown',
              error: 'Empty file - please try re-uploading this image',
            });
            continue;
          }

          // Validate file.originalname to prevent indexOf errors
          if (!file.originalname || typeof file.originalname !== 'string') {
            logger.error('Invalid file.originalname received', {
              originalname: file.originalname,
              type: typeof file.originalname,
              listingId: normalizedId,
              userId: req.user.id,
            });
            errors.push({
              filename: 'unknown',
              error: 'Invalid file name - please try re-uploading this image',
            });
            continue;
          }

          try {
            // Use dedicated marketplace image processing
            // Order is calculated as: existing image count + already uploaded images
            const images = await photoUpload.processAndSaveMarketplaceImage(
              file.buffer,
              file.originalname,
              normalizedId,
              req.user.id,
              existingImages.length + uploadedUrls.length // order
            );
            uploadedUrls.push(images.optimized);
          } catch (error) {
            logger.error('Marketplace photo processing failed', {
              error: error.message,
              errorName: error.name,
              stack: error.stack,
              filename: file.originalname,
              fileSize: file.size,
              mimeType: file.mimetype,
              listingId: normalizedId,
              userId: req.user.id,
            });

            // Provide user-friendly error messages
            let userMessage = error.message;
            if (error.name === 'ValidationError') {
              userMessage = `Invalid image: ${error.message}`;
            } else if (error.message.includes('MongoDB')) {
              userMessage = 'Storage error - image could not be saved';
            }

            errors.push({
              filename: file.originalname,
              error: userMessage,
            });
          }
        }

        // Check if all uploads failed
        if (uploadedUrls.length === 0 && errors.length > 0) {
          logger.error('All marketplace photos failed to upload', {
            listingId: normalizedId,
            userId: req.user.id,
            errorCount: errors.length,
            errors: errors,
          });

          return res.status(500).json({
            success: false,
            error: 'All photo uploads failed',
            errorType: 'UploadError',
            details: errors,
            uploaded: 0,
          });
        }

        // Cap at 5 images total (existingImages already defined earlier)
        listing.images = existingImages.concat(uploadedUrls).slice(0, 5);
        listing.updatedAt = new Date().toISOString();

        await dbUnified.updateOne(
          'marketplace_listings',
          { id: listing.id },
          { $set: { images: listing.images, updatedAt: listing.updatedAt } }
        );

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
          message:
            uploadedUrls.length > 0
              ? `${uploadedUrls.length} image(s) uploaded successfully${errors.length > 0 ? `, ${errors.length} failed` : ''}.`
              : 'No images were uploaded.',
        });
      }

      // Handle single file for supplier/package types
      const file = req.files[0];

      // Process and save image
      const images = await photoUpload.processAndSaveImage(file.buffer, file.originalname, type);

      // Get metadata
      const metadata = await photoUpload.getImageMetadata(file.buffer);

      // Create photo record
      const photoRecord = {
        url: images.optimized,
        thumbnail: images.thumbnail,
        large: images.large,
        original: images.original,
        approved: true,
        uploadedAt: new Date().toISOString(),
        uploadedBy: req.user.id,
        metadata: metadata,
      };

      // Update supplier or package with new photo
      if (type === 'supplier') {
        const suppliers = await dbUnified.read('suppliers');
        const supplier = suppliers.find(s => s.id === id);

        if (!supplier) {
          return res.status(404).json({ error: 'Supplier not found' });
        }

        // Check if user owns this supplier
        if (supplier.ownerUserId !== req.user.id && req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Not authorized' });
        }

        // Add to gallery
        if (!supplier.photosGallery) {
          supplier.photosGallery = [];
        }
        supplier.photosGallery.push(photoRecord);

        await dbUnified.updateOne(
          'suppliers',
          { id: supplier.id },
          { $set: { photosGallery: supplier.photosGallery } }
        );

        return res.json({
          success: true,
          photo: photoRecord,
          message: 'Photo uploaded successfully.',
        });
      } else if (type === 'package') {
        const packages = await dbUnified.read('packages');
        const pkg = packages.find(p => p.id === id);

        if (!pkg) {
          return res.status(404).json({ error: 'Package not found' });
        }

        // Check if user owns this package's supplier
        const suppliers = await dbUnified.read('suppliers');
        const supplier = suppliers.find(s => s.id === pkg.supplierId);

        if (!supplier || (supplier.ownerUserId !== req.user.id && req.user.role !== 'admin')) {
          return res.status(403).json({ error: 'Not authorized' });
        }

        // Add to gallery
        if (!pkg.gallery) {
          pkg.gallery = [];
        }
        pkg.gallery.push(photoRecord);

        const updateFields = { gallery: pkg.gallery };
        if (!pkg.image || pkg.image === PLACEHOLDER_PACKAGE_IMAGE || pkg.image === '') {
          updateFields.image = photoRecord.url;
        }
        await dbUnified.updateOne('packages', { id: pkg.id }, { $set: updateFields });

        return res.json({
          success: true,
          photo: photoRecord,
          message: 'Photo uploaded successfully.',
        });
      } else {
        return res
          .status(400)
          .json({ error: 'Invalid type. Must be supplier, package, or marketplace.' });
      }
    } catch (error) {
      // Enhanced error logging for single uploads
      logger.error('Photo upload error', {
        error: error.message,
        stack: error.stack,
        errorName: error.name,
        type: req.query.type,
        id: req.query.id,
        userId: req.user?.id,
        fileCount: req.files?.length || 0,
      });

      // Use helper function to classify error and get appropriate response
      const { statusCode, userMessage, errorType } = classifyUploadError(error);

      res.status(statusCode).json({
        error: userMessage,
        details: error.message,
        errorType: errorType,
      });
    }
  }
);

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
  async (req, res) => {
    // Add diagnostic logging
    logger.info('Batch photo upload request received', {
      type: req.query.type,
      id: req.query.id,
      filesCount: req.files?.length || 0,
      fileNames: req.files?.map(f => f.originalname) || [],
      userId: req.user?.id,
      userRole: req.user?.role,
    });

    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const { type, id } = req.query;
      const normalizedId = Array.isArray(id) ? id[0] : id;
      if (!type || !normalizedId) {
        return res.status(400).json({ error: 'Missing type or id parameter' });
      }

      // Process all images
      const uploadedPhotos = [];
      const errors = [];

      // Get existing images count for marketplace listings (for order calculation)
      let existingImagesCount = 0;
      if (type === 'marketplace') {
        const listings = await dbUnified.read('marketplace_listings');
        const listing = listings?.find(l => l.id === normalizedId);
        if (listing) {
          existingImagesCount = normalizeMarketplaceImageUrls(listing.images).length;
        }
      }

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];

        // **NEW: Enhanced diagnostic logging BEFORE validation**
        logger.info('Processing file in batch upload', {
          hasFile: !!file,
          hasOriginalname: !!file?.originalname,
          originalnameType: typeof file?.originalname,
          originalnameValue: file?.originalname,
          hasBuffer: !!file?.buffer,
          bufferLength: file?.buffer?.length,
          mimetype: file?.mimetype,
          size: file?.size,
          listingId: normalizedId,
          userId: req.user?.id,
        });

        // Validate buffer
        if (!file.buffer || !Buffer.isBuffer(file.buffer)) {
          logger.error('Invalid file buffer received', {
            filename: file.originalname || 'unknown',
            hasBuffer: !!file.buffer,
            isBuffer: file.buffer ? Buffer.isBuffer(file.buffer) : false,
            listingId: normalizedId,
            userId: req.user.id,
          });
          errors.push({
            filename: file.originalname || 'unknown',
            error: 'Invalid file data - please try re-uploading this image',
          });
          continue;
        }

        if (file.buffer.length === 0) {
          logger.error('Empty file buffer received', {
            filename: file.originalname,
            listingId: normalizedId,
            userId: req.user.id,
          });
          errors.push({
            filename: file.originalname || 'unknown',
            error: 'Empty file - please try re-uploading this image',
          });
          continue;
        }

        // Validate file.originalname to prevent indexOf errors
        if (!file.originalname || typeof file.originalname !== 'string') {
          logger.error('Invalid file.originalname received', {
            originalname: file.originalname,
            type: typeof file.originalname,
            listingId: normalizedId,
            userId: req.user.id,
            // **NEW: Log the entire file object structure for debugging**
            fileKeys: file ? Object.keys(file) : [],
            mimetype: file?.mimetype,
            size: file?.size,
          });
          errors.push({
            filename: 'unknown',
            error: 'Invalid file name - the file may be corrupted. Please try selecting it again.',
          });
          continue;
        }

        try {
          let images;
          // Use marketplace-specific processing for marketplace type
          if (type === 'marketplace') {
            images = await photoUpload.processAndSaveMarketplaceImage(
              file.buffer,
              file.originalname,
              normalizedId,
              req.user.id,
              existingImagesCount + uploadedPhotos.length // order
            );
          } else {
            images = await photoUpload.processAndSaveImage(file.buffer, file.originalname, type);
          }
          const metadata = await photoUpload.getImageMetadata(file.buffer);

          const photoRecord = {
            url: images.optimized,
            thumbnail: images.thumbnail,
            large: images.large,
            original: images.original,
            approved: true,
            uploadedAt: new Date().toISOString(),
            uploadedBy: req.user.id,
            metadata: metadata,
          };

          uploadedPhotos.push(photoRecord);
        } catch (error) {
          logger.error('Batch photo processing failed', {
            error: error.message,
            errorName: error.name,
            stack: error.stack,
            filename: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
            type: type,
            id: normalizedId,
            userId: req.user.id,
          });

          // Provide user-friendly error messages
          let userMessage = error.message;
          if (error.name === 'ValidationError') {
            userMessage = `Invalid image: ${error.message}`;
          } else if (error.message.includes('MongoDB')) {
            userMessage = 'Storage error - image could not be saved';
          }

          errors.push({ filename: file.originalname, error: userMessage });
        }
      }

      // Update supplier, package, or marketplace listing with new photos
      if (type === 'marketplace') {
        const listings = await dbUnified.read('marketplace_listings');
        if (!Array.isArray(listings)) {
          return res.status(500).json({
            error: 'Database unavailable',
            errorType: 'DatabaseError',
            details: 'Marketplace listings database is not accessible',
          });
        }
        const listing = listings.find(l => l.id === normalizedId);

        if (!listing) {
          return res.status(404).json({ error: 'Listing not found' });
        }

        // Verify ownership
        if (!isMarketplaceOwner(listing, req.user)) {
          return res.status(403).json({ error: 'Not authorized' });
        }

        // Process and append URLs (cap at 5 images total)
        const uploadedUrls = uploadedPhotos.map(p => p.url);

        // Check if all uploads failed
        if (uploadedUrls.length === 0 && errors.length > 0) {
          logger.error('All marketplace photos failed to upload (batch)', {
            listingId: normalizedId,
            userId: req.user.id,
            errorCount: errors.length,
            errors: errors,
          });

          return res.status(500).json({
            success: false,
            error: 'All photo uploads failed',
            details: errors,
            uploaded: 0,
          });
        }

        const existingImages = normalizeMarketplaceImageUrls(listing.images);
        listing.images = existingImages.concat(uploadedUrls).slice(0, 5);
        listing.updatedAt = new Date().toISOString();

        await dbUnified.updateOne(
          'marketplace_listings',
          { id: listing.id },
          { $set: { images: listing.images, updatedAt: listing.updatedAt } }
        );

        logger.info('Marketplace images uploaded (batch)', {
          listingId: normalizedId,
          userId: req.user.id,
          count: uploadedUrls.length,
        });

        return res.json({
          success: true,
          uploaded: uploadedUrls.length,
          urls: uploadedUrls,
          errors: errors,
          message: `${uploadedUrls.length} photo(s) uploaded successfully to marketplace listing.`,
        });
      } else if (type === 'supplier') {
        const suppliers = await dbUnified.read('suppliers');
        const supplier = suppliers.find(s => s.id === normalizedId);

        if (!supplier) {
          return res.status(404).json({ error: 'Supplier not found' });
        }

        if (supplier.ownerUserId !== req.user.id && req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Not authorized' });
        }

        if (!supplier.photosGallery) {
          supplier.photosGallery = [];
        }
        supplier.photosGallery.push(...uploadedPhotos);

        await dbUnified.updateOne(
          'suppliers',
          { id: supplier.id },
          { $set: { photosGallery: supplier.photosGallery } }
        );
      } else if (type === 'package') {
        const packages = await dbUnified.read('packages');
        const pkg = packages.find(p => p.id === normalizedId);

        if (!pkg) {
          return res.status(404).json({ error: 'Package not found' });
        }

        const suppliers = await dbUnified.read('suppliers');
        const supplier = suppliers.find(s => s.id === pkg.supplierId);

        if (!supplier || (supplier.ownerUserId !== req.user.id && req.user.role !== 'admin')) {
          return res.status(403).json({ error: 'Not authorized' });
        }

        if (!pkg.gallery) {
          pkg.gallery = [];
        }
        pkg.gallery.push(...uploadedPhotos);

        await dbUnified.updateOne('packages', { id: pkg.id }, { $set: { gallery: pkg.gallery } });
      } else {
        return res.status(400).json({ error: 'Invalid type' });
      }

      res.json({
        success: true,
        uploaded: uploadedPhotos.length,
        photos: uploadedPhotos,
        errors: errors,
        message: `${uploadedPhotos.length} photo(s) uploaded successfully.`,
      });
    } catch (error) {
      // Enhanced error logging for batch uploads
      logger.error('Batch upload error', {
        error: error.message,
        stack: error.stack,
        errorName: error.name,
        type: req.query.type,
        id: req.query.id,
        userId: req.user?.id,
        fileCount: req.files?.length || 0,
      });

      // Use helper function to classify error and get appropriate response
      const { statusCode, userMessage, errorType } = classifyUploadError(error);

      res.status(statusCode).json({
        error: userMessage,
        details: error.message,
        errorType: errorType,
      });
    }
  }
);

// ---------- Photo Management Routes ----------

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

    const decodedUrl = decodeURIComponent(photoUrl);

    if (type === 'supplier') {
      const suppliers = await dbUnified.read('suppliers');
      const supplier = suppliers.find(s => s.id === id);

      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      if (supplier.ownerUserId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Not authorized' });
      }

      if (supplier.photosGallery) {
        supplier.photosGallery = supplier.photosGallery.filter(p => p.url !== decodedUrl);
        await dbUnified.updateOne(
          'suppliers',
          { id: supplier.id },
          { $set: { photosGallery: supplier.photosGallery } }
        );

        // Delete physical files
        await photoUpload.deleteImage(decodedUrl);
      }
    } else if (type === 'package') {
      const packages = await dbUnified.read('packages');
      const pkg = packages.find(p => p.id === id);

      if (!pkg) {
        return res.status(404).json({ error: 'Package not found' });
      }

      const suppliers = await dbUnified.read('suppliers');
      const supplier = suppliers.find(s => s.id === pkg.supplierId);

      if (!supplier || (supplier.ownerUserId !== req.user.id && req.user.role !== 'admin')) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      if (pkg.gallery) {
        pkg.gallery = pkg.gallery.filter(p => p.url !== decodedUrl);
        await dbUnified.updateOne('packages', { id: pkg.id }, { $set: { gallery: pkg.gallery } });

        // Delete physical files
        await photoUpload.deleteImage(decodedUrl);
      }
    }

    res.json({ success: true, message: 'Photo deleted successfully' });
  } catch (error) {
    logger.error('Delete photo error:', error);
    res.status(500).json({ error: 'Failed to delete photo', details: error.message });
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
    res.status(500).json({ error: 'Failed to crop image', details: error.message });
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
    res.status(500).json({ error: 'Failed to update photo metadata', details: error.message });
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
      res.status(500).json({ error: 'Failed to replace photo', details: error.message });
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
    res.status(500).json({ error: 'Failed to bulk edit photos', details: error.message });
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
    res.status(500).json({ error: 'Failed to apply filters', details: error.message });
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
    res.status(500).json({ error: 'Failed to reorder photos', details: error.message });
  }
});

// ---------- Admin Photo Management Routes ----------

router.get(
  '/admin/photos/pending',
  applyAuthRequired,
  applyRoleRequired('admin'),
  async (req, res) => {
    const photos = await dbUnified.read('photos');
    const pendingPhotos = photos.filter(p => p.status === 'pending');

    // Enrich with supplier information
    const suppliers = await dbUnified.read('suppliers');
    const enrichedPhotos = pendingPhotos.map(photo => {
      const supplier = suppliers.find(s => s.id === photo.supplierId);
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
 * GET /api/admin/photos
 * Get photos for a specific supplier (admin view)
 */
router.get('/admin/photos', applyAuthRequired, applyRoleRequired('admin'), async (req, res) => {
  try {
    const { supplierId } = req.query;

    if (!supplierId) {
      return res.status(400).json({ error: 'supplierId query parameter is required' });
    }

    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.id === supplierId);

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
    res.status(500).json({ error: 'Failed to fetch photos', details: error.message });
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
    const photos = await dbUnified.read('photos');
    const photoIndex = photos.findIndex(p => p.id === id);

    if (photoIndex === -1) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const photo = photos[photoIndex];
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
    const suppliers = await dbUnified.read('suppliers');
    const supplierIndex = suppliers.findIndex(s => s.id === photo.supplierId);

    if (supplierIndex !== -1) {
      if (!suppliers[supplierIndex].photosGallery) {
        suppliers[supplierIndex].photosGallery = [];
      }
      const alreadyInGallery = suppliers[supplierIndex].photosGallery.some(
        p => p.url === photo.url
      );
      if (!alreadyInGallery) {
        suppliers[supplierIndex].photosGallery.push({
          url: photo.url,
          approved: true,
          uploadedAt: photo.uploadedAt || new Date().toISOString(),
        });
        await dbUnified.updateOne(
          'suppliers',
          { id: suppliers[supplierIndex].id },
          { $set: { photosGallery: suppliers[supplierIndex].photosGallery } }
        );
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
    const photos = await dbUnified.read('photos');
    const photoIndex = photos.findIndex(p => p.id === id);

    if (photoIndex === -1) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const photo = photos[photoIndex];
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
