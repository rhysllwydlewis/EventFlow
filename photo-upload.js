/**
 * Photo Upload Middleware and Utilities
 * Handles file uploads, image optimization, and MongoDB storage
 * Photos are stored in MongoDB for persistence across deployments
 *
 * Security features:
 * - Magic-byte detection for true file type validation
 * - Pixel count limits to prevent decompression bombs
 * - Automatic metadata stripping (EXIF/GPS)
 * - Configurable file size limits per context
 */

'use strict';

const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const crypto = require('crypto');

// MongoDB for photo storage
const mongoDb = require('./db');
const { uid } = require('./store');

// Import validation utilities
const uploadValidation = require('./utils/uploadValidation');

// Import logger for consistent logging
const logger = require('./utils/logger');

// Photos are always stored in MongoDB — no local filesystem fallback
logger.info('✓ Photos will be stored in MongoDB (persistent across deployments)');

// Image processing configurations
// Optimized for best quality-to-size ratio
const IMAGE_CONFIGS = {
  thumbnail: { width: 300, height: 300, fit: 'cover', quality: 75 }, // Reduced from 80
  optimized: { width: 1200, height: 1200, fit: 'inside', quality: 82 }, // Reduced from 85
  large: { width: 2000, height: 2000, fit: 'inside', quality: 85 }, // Reduced from 90
  avatar: { width: 400, height: 400, fit: 'cover', quality: 85 }, // Reduced from 90
};

// Allowed file types (now validated via magic bytes, not just MIME type)
const ALLOWED_MIME_TYPES = uploadValidation.ALLOWED_IMAGE_TYPES;

// Maximum file sizes (configurable via environment)
const MAX_FILE_SIZE = uploadValidation.MAX_FILE_SIZE_SUPPLIER;
const MAX_FILE_SIZE_AVATAR = uploadValidation.MAX_FILE_SIZE_AVATAR;
const MAX_FILE_SIZE_MARKETPLACE = uploadValidation.MAX_FILE_SIZE_MARKETPLACE;

/**
 * Generate unique filename
 */
function generateFilename(originalname) {
  // Validate and provide fallback for originalname
  const safeName = !originalname || typeof originalname !== 'string' ? 'image.jpg' : originalname;
  if (safeName !== originalname) {
    logger.warn('Invalid originalname provided to generateFilename', {
      originalname,
      type: typeof originalname,
    });
  }
  const ext = path.extname(safeName).toLowerCase();
  const hash = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  return `${timestamp}-${hash}${ext}`;
}

/**
 * Multer storage configuration (memory storage for processing)
 */
const storage = multer.memoryStorage();

/**
 * File filter for multer
 */
function fileFilter(req, file, cb) {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error('Invalid file type. Only JPEG, PNG, WebP, GIF, AVIF, and HEIC are allowed.'),
      false
    );
  }
}

/**
 * Multer upload middleware
 * Uses Math.max() to accommodate both marketplace (10MB) and supplier (10MB) limits.
 * This ensures the multer limit is never lower than what any endpoint expects.
 */
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: Math.max(MAX_FILE_SIZE, MAX_FILE_SIZE_MARKETPLACE), // Use the larger of the two limits
    files: 10, // Max 10 files per upload
  },
});

/**
 * Extract EXIF metadata from image buffer before stripping
 * @param {Buffer} buffer - Image buffer
 * @returns {Promise<Object>} EXIF metadata
 */
async function extractExifData(buffer) {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    const exifData = {
      camera: metadata.exif
        ? {
            make: metadata.exif.Make || null,
            model: metadata.exif.Model || null,
          }
        : null,
      dateTaken:
        (metadata.exif && (metadata.exif.DateTimeOriginal || metadata.exif.DateTime)) || null,
      location:
        metadata.exif && metadata.exif.GPSLatitude && metadata.exif.GPSLongitude
          ? {
              latitude: metadata.exif.GPSLatitude,
              longitude: metadata.exif.GPSLongitude,
            }
          : null,
      dimensions: {
        width: metadata.width,
        height: metadata.height,
      },
      format: metadata.format,
      space: metadata.space,
      orientation: metadata.orientation,
    };

    return exifData;
  } catch (error) {
    logger.warn('Failed to extract EXIF data', { error: error.message });
    return null;
  }
}

/**
 * Process image with metadata stripping
 * Automatically strips metadata (EXIF/GPS) for privacy
 * @param {Buffer} buffer - Image buffer
 * @param {Object} config - Processing configuration
 * @returns {Promise<Buffer>} Processed image buffer
 */
async function processImage(buffer, config) {
  try {
    return await uploadValidation.processWithMetadataStripping(buffer, {
      width: config.width,
      height: config.height,
      fit: config.fit || 'inside',
      quality: config.quality || 85,
    });
  } catch (error) {
    // Add context to Sharp errors
    const enhancedError = new Error(`Image processing failed: ${error.message}`);
    enhancedError.name = 'SharpProcessingError';
    enhancedError.originalError = error;
    throw enhancedError;
  }
}

/**
 * Save image to MongoDB
 * @param {Buffer} buffer - Image buffer
 * @param {string} filename - Filename
 * @param {string} type - Image type (original, thumbnail, optimized, large)
 * @returns {Promise<string>} Database ID
 */
async function saveToMongoDB(buffer, filename, type = 'optimized') {
  try {
    // Check if MongoDB is available before attempting save
    const isAvailable = await mongoDb.isMongoAvailable();
    if (!isAvailable) {
      const error = new Error('MongoDB is not available for photo storage');
      error.name = 'MongoDBUnavailableError';
      throw error;
    }

    const db = await mongoDb.getDb();
    const collection = db.collection('photos');

    const photoDoc = {
      _id: uid('photo'),
      filename,
      type,
      data: buffer.toString('base64'),
      mimeType: 'image/jpeg',
      size: buffer.length,
      createdAt: new Date().toISOString(),
    };

    await collection.insertOne(photoDoc);
    return photoDoc._id;
  } catch (error) {
    // Wraps failure as MongoDBStorageError — Add context to MongoDB errors with connection state
    const enhancedError = new Error(`Failed to save image to MongoDB: ${error.message}`);
    enhancedError.name = error.name || 'MongoDBStorageError';
    enhancedError.originalError = error;
    enhancedError.context = {
      filename,
      type,
      bufferSize: buffer?.length || 0,
    };

    logger.error('MongoDB photo save failed', {
      error: error.message,
      stack: error.stack,
      filename,
      type,
      bufferSize: buffer?.length || 0,
    });

    throw enhancedError;
  }
}

/**
 * Save marketplace image to dedicated MongoDB collection
 * @param {Buffer} buffer - Image buffer
 * @param {string} filename - Filename
 * @param {string} listingId - Marketplace listing ID
 * @param {string} userId - User ID who uploaded the image
 * @param {string} type - Image type (original, thumbnail, optimized, large)
 * @param {number} order - Display order in gallery (0-4)
 * @returns {Promise<string>} Database ID
 */
async function saveMarketplaceImageToMongoDB(
  buffer,
  filename,
  listingId,
  userId,
  type = 'optimized',
  order = 0
) {
  try {
    // Check if MongoDB is available before attempting save
    const isAvailable = await mongoDb.isMongoAvailable();
    if (!isAvailable) {
      const error = new Error('MongoDB is not available for photo storage');
      error.name = 'MongoDBUnavailableError';
      throw error;
    }

    const db = await mongoDb.getDb();
    const collection = db.collection('marketplace_images');

    const photoId = uid('photo');
    const photoDoc = {
      _id: photoId,
      listingId,
      userId,
      filename,
      imageData: buffer.toString('base64'),
      size: type,
      mimeType: 'image/jpeg',
      fileSize: buffer.length,
      url: `/api/photos/${photoId}`,
      order,
      uploadedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await collection.insertOne(photoDoc);

    logger.info('Marketplace image saved to MongoDB', {
      photoId,
      listingId,
      userId,
      type,
      size: buffer.length,
    });

    return photoDoc._id;
  } catch (error) {
    // Add context to MongoDB errors
    const enhancedError = new Error(
      `Failed to save marketplace image to MongoDB: ${error.message}`
    );
    enhancedError.name = error.name || 'MongoDBStorageError';
    enhancedError.originalError = error;
    enhancedError.context = {
      filename,
      listingId,
      userId,
      type,
      bufferSize: buffer?.length || 0,
    };

    logger.error('MongoDB marketplace photo save failed', {
      error: error.message,
      stack: error.stack,
      filename,
      listingId,
      userId,
      type,
      bufferSize: buffer?.length || 0,
    });

    throw enhancedError;
  }
}

/**
 * Process and save image with multiple sizes
 * Performs comprehensive validation before processing
 * @param {Buffer} buffer - Original image buffer
 * @param {string} originalFilename - Original filename
 * @param {string} context - Upload context ('marketplace', 'supplier', 'avatar')
 * @returns {Promise<Object>} URLs/IDs for all image sizes
 */
async function processAndSaveImage(buffer, originalFilename, context = 'supplier') {
  // Validate buffer early
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const error = new Error(`Invalid file buffer - expected Buffer, received ${typeof buffer}`);
    error.name = 'ValidationError';
    throw error;
  }

  if (buffer.length === 0) {
    const error = new Error('Empty file buffer');
    error.name = 'ValidationError';
    throw error;
  }

  // Validate file size (max 5MB)
  const maxSize = 5 * 1024 * 1024;
  if (buffer.length > maxSize) {
    const error = new Error(
      `File too large: ${(buffer.length / 1024 / 1024).toFixed(2)}MB (max 5MB)`
    );
    error.name = 'ValidationError';
    throw error;
  }

  // Log start of processing
  logger.info('Starting image processing', {
    filename: originalFilename,
    context,
    size: buffer.length,
  });

  // Implement retry logic with exponential backoff
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Validate upload (type, size, dimensions) - pass filename for fallback detection
      const validation = await uploadValidation.validateUpload(buffer, context, originalFilename);

      if (!validation.valid) {
        logger.error('Image validation failed', {
          errors: validation.errors,
          details: validation.details,
        });
        const error = new Error(validation.errors.join('; '));
        error.name = 'ValidationError';
        error.details = validation.details;
        throw error;
      }

      logger.debug('Image validation passed');

      const filename = generateFilename(originalFilename);
      const baseFilename = filename.replace(path.extname(filename), '');

      // Extract EXIF data before processing (which strips metadata)
      const exifData = await extractExifData(buffer);

      const results = {
        original: null,
        thumbnail: null,
        optimized: null,
        large: null,
        exif: exifData,
      };

      // For avatars, only generate one optimized square size
      if (context === 'avatar') {
        logger.debug('Processing avatar image');
        const avatarProcessed = await processImage(buffer, IMAGE_CONFIGS.avatar);

        logger.debug('Saving avatar to MongoDB');
        const avatarId = await saveToMongoDB(avatarProcessed, `${baseFilename}.jpg`, 'avatar');
        results.optimized = `/api/photos/${avatarId}`;

        logger.info('Avatar image processed successfully');
        return results;
      }

      // Process each size (with automatic metadata stripping)
      logger.debug('Processing image in multiple sizes');
      const originalSize = buffer.length;

      const [originalProcessed, thumbnail, optimized, large] = await Promise.all([
        buffer, // Keep original as-is for backup
        processImage(buffer, IMAGE_CONFIGS.thumbnail),
        processImage(buffer, IMAGE_CONFIGS.optimized),
        processImage(buffer, IMAGE_CONFIGS.large),
      ]);

      // Log compression statistics
      // Calculate actual storage used vs what it would be without compression
      const actualStorageUsed = originalSize + thumbnail.length + optimized.length + large.length;
      const storageWithoutCompression = originalSize * 4; // If we stored 4 uncompressed copies

      const compressionStats = {
        originalSize,
        thumbnailSize: thumbnail.length,
        optimizedSize: optimized.length,
        largeSize: large.length,
        totalStorageUsed: actualStorageUsed,
        storageWithoutCompression,
        bytesSaved: storageWithoutCompression - actualStorageUsed,
        compressionRatio: `${(((storageWithoutCompression - actualStorageUsed) / storageWithoutCompression) * 100).toFixed(1)}%`,
      };

      logger.info('Image compression statistics', {
        filename: originalFilename,
        ...compressionStats,
      });

      logger.debug('Image processing complete, saving to MongoDB');

      // Save to MongoDB (only storage backend)
      logger.debug('Saving images to MongoDB');
      const [originalId, thumbnailId, optimizedId, largeId] = await Promise.all([
        saveToMongoDB(originalProcessed, `${baseFilename}.jpg`, 'original'),
        saveToMongoDB(thumbnail, `${baseFilename}-thumb.jpg`, 'thumbnail'),
        saveToMongoDB(optimized, `${baseFilename}-opt.jpg`, 'optimized'),
        saveToMongoDB(large, `${baseFilename}-large.jpg`, 'large'),
      ]);

      // Return photo IDs that will be served via API endpoint
      results.original = `/api/photos/${originalId}`;
      results.thumbnail = `/api/photos/${thumbnailId}`;
      results.optimized = `/api/photos/${optimizedId}`;
      results.large = `/api/photos/${largeId}`;

      logger.info('Image saved successfully', { results });
      return results;
    } catch (error) {
      lastError = error;

      // Don't retry validation errors
      if (error.name === 'ValidationError') {
        throw error;
      }

      // Don't retry MongoDB unavailability errors - they won't resolve on retry
      if (error.name === 'MongoDBUnavailableError' || error.name === 'MongoDBStorageError') {
        logger.error('MongoDB storage error - not retrying', {
          error: error.message,
          filename: originalFilename,
          attempt: attempt,
        });
        throw error;
      }

      logger.warn(`Image upload attempt ${attempt} failed`, {
        error: error.message,
        filename: originalFilename,
        attempt: attempt,
      });

      if (attempt < 3) {
        // Wait before retry with exponential backoff
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s...
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All attempts failed
  logger.error('Image processing failed after 3 attempts', {
    message: lastError.message,
    name: lastError.name,
    ...(process.env.NODE_ENV !== 'production' && { stack: lastError.stack }),
  });

  // Throw the last error with additional context
  const finalError = new Error(`Image upload failed after 3 attempts: ${lastError.message}`);
  finalError.name = 'ImageProcessingError';
  finalError.originalError = lastError;
  throw finalError;
}

/**
 * Process and save marketplace image to dedicated collection
 * Uses marketplace_images collection instead of generic photos collection
 * @param {Buffer} buffer - Original image buffer
 * @param {string} originalFilename - Original filename
 * @param {string} listingId - Marketplace listing ID
 * @param {string} userId - User ID who uploaded the image
 * @param {number} order - Display order in gallery (0-4)
 * @returns {Promise<Object>} URLs/IDs for all image sizes
 */
async function processAndSaveMarketplaceImage(
  buffer,
  originalFilename,
  listingId,
  userId,
  order = 0
) {
  // Validate buffer early
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const error = new Error(`Invalid file buffer - expected Buffer, received ${typeof buffer}`);
    error.name = 'ValidationError';
    throw error;
  }

  if (buffer.length === 0) {
    const error = new Error('Empty file buffer');
    error.name = 'ValidationError';
    throw error;
  }

  // Validate originalFilename to prevent indexOf errors
  if (!originalFilename || typeof originalFilename !== 'string') {
    const error = new Error(
      `Invalid filename - expected string, received ${typeof originalFilename}`
    );
    error.name = 'ValidationError';
    throw error;
  }

  // Validate listingId
  if (!listingId || typeof listingId !== 'string') {
    const error = new Error(`Invalid listing ID - expected string, received ${typeof listingId}`);
    error.name = 'ValidationError';
    throw error;
  }

  // Validate userId
  if (!userId || typeof userId !== 'string') {
    const error = new Error(`Invalid user ID - expected string, received ${typeof userId}`);
    error.name = 'ValidationError';
    throw error;
  }

  // Validate file size (max 5MB)
  const maxSize = 5 * 1024 * 1024;
  if (buffer.length > maxSize) {
    const error = new Error(
      `File too large: ${(buffer.length / 1024 / 1024).toFixed(2)}MB (max 5MB)`
    );
    error.name = 'ValidationError';
    throw error;
  }

  // Log start of processing
  logger.info('Starting marketplace image processing', {
    filename: originalFilename,
    listingId,
    userId,
    size: buffer.length,
  });

  // Implement retry logic with exponential backoff
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Validate upload (type, size, dimensions)
      const validation = await uploadValidation.validateUpload(
        buffer,
        'marketplace',
        originalFilename
      );

      if (!validation.valid) {
        logger.error('Marketplace image validation failed', {
          errors: validation.errors,
          details: validation.details,
        });
        const error = new Error(validation.errors.join('; '));
        error.name = 'ValidationError';
        error.details = validation.details;
        throw error;
      }

      logger.debug('Marketplace image validation passed');

      const filename = generateFilename(originalFilename);
      const baseFilename = filename.replace(path.extname(filename), '');

      // Extract EXIF data before processing
      const exifData = await extractExifData(buffer);

      const results = {
        original: null,
        thumbnail: null,
        optimized: null,
        large: null,
        exif: exifData,
      };

      // Process each size
      logger.debug('Processing marketplace image in multiple sizes');
      const originalSize = buffer.length;

      const [originalProcessed, thumbnail, optimized, large] = await Promise.all([
        buffer, // Keep original as-is for backup
        processImage(buffer, IMAGE_CONFIGS.thumbnail),
        processImage(buffer, IMAGE_CONFIGS.optimized),
        processImage(buffer, IMAGE_CONFIGS.large),
      ]);

      // Log compression statistics for marketplace images
      const actualStorageUsed = originalSize + thumbnail.length + optimized.length + large.length;
      const storageWithoutCompression = originalSize * 4;

      const compressionStats = {
        originalSize,
        thumbnailSize: thumbnail.length,
        optimizedSize: optimized.length,
        largeSize: large.length,
        totalStorageUsed: actualStorageUsed,
        storageWithoutCompression,
        bytesSaved: storageWithoutCompression - actualStorageUsed,
        compressionRatio: `${(((storageWithoutCompression - actualStorageUsed) / storageWithoutCompression) * 100).toFixed(1)}%`,
      };

      logger.info('Marketplace image compression statistics', {
        filename: originalFilename,
        listingId,
        ...compressionStats,
      });

      logger.debug('Marketplace image processing complete, saving to MongoDB');

      // Save to dedicated marketplace_images collection (MongoDB-only)
      logger.debug('Saving marketplace images to dedicated MongoDB collection');
      const [originalId, thumbnailId, optimizedId, largeId] = await Promise.all([
        saveMarketplaceImageToMongoDB(
          originalProcessed,
          `${baseFilename}.jpg`,
          listingId,
          userId,
          'original',
          order
        ),
        saveMarketplaceImageToMongoDB(
          thumbnail,
          `${baseFilename}-thumb.jpg`,
          listingId,
          userId,
          'thumbnail',
          order
        ),
        saveMarketplaceImageToMongoDB(
          optimized,
          `${baseFilename}-opt.jpg`,
          listingId,
          userId,
          'optimized',
          order
        ),
        saveMarketplaceImageToMongoDB(
          large,
          `${baseFilename}-large.jpg`,
          listingId,
          userId,
          'large',
          order
        ),
      ]);

      // Return photo IDs that will be served via API endpoint
      results.original = `/api/photos/${originalId}`;
      results.thumbnail = `/api/photos/${thumbnailId}`;
      results.optimized = `/api/photos/${optimizedId}`;
      results.large = `/api/photos/${largeId}`;

      logger.info('Marketplace image saved successfully', {
        listingId,
        userId,
        results,
      });
      return results;
    } catch (error) {
      lastError = error;

      // Don't retry validation errors
      if (error.name === 'ValidationError') {
        throw error;
      }

      // Don't retry MongoDB unavailability errors — they won't resolve on retry
      if (error.name === 'MongoDBUnavailableError' || error.name === 'MongoDBStorageError') {
        logger.error('MongoDB storage error - not retrying', {
          error: error.message,
          filename: originalFilename,
          listingId,
        });
        throw error;
      }

      logger.warn(`Marketplace image upload attempt ${attempt} failed`, {
        error: error.message,
        filename: originalFilename,
        listingId,
        attempt: attempt,
      });

      // Exponential backoff
      if (attempt < 3) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All attempts failed
  logger.error('Marketplace image upload failed after 3 attempts', {
    filename: originalFilename,
    listingId,
    userId,
    error: lastError.message,
    name: lastError.name,
    ...(process.env.NODE_ENV !== 'production' && { stack: lastError.stack }),
  });

  const finalError = new Error(
    `Marketplace image upload failed after 3 attempts: ${lastError.message}`
  );
  finalError.name = 'ImageProcessingError';
  finalError.originalError = lastError;
  throw finalError;
}

/**
 * Delete image from MongoDB storage
 * Checks both generic 'photos' collection and 'marketplace_images' collection
 * Legacy /uploads/ URLs are silently ignored (no local filesystem to clean up)
 * @param {string} url - Image URL/ID to delete
 * @returns {Promise<void>}
 */
async function deleteImage(url) {
  try {
    // Only MongoDB-backed photos (starting with /api/photos/) can be deleted
    if (url && url.startsWith('/api/photos/')) {
      const photoId = url.split('/').pop();
      const db = await mongoDb.getDb();

      // Try to delete from marketplace_images collection first
      const marketplaceResult = await db
        .collection('marketplace_images')
        .deleteOne({ _id: photoId });

      if (marketplaceResult.deletedCount > 0) {
        logger.info('Deleted marketplace image', { photoId });
        return;
      }

      // If not found in marketplace_images, try generic photos collection
      const photosResult = await db.collection('photos').deleteOne({ _id: photoId });

      if (photosResult.deletedCount > 0) {
        logger.info('Deleted photo from generic collection', { photoId });
        return;
      }

      logger.warn('Photo not found in any collection', { photoId });
      return;
    }

    // Legacy /uploads/ URLs: no local filesystem to delete from — skip gracefully
    if (url && url.startsWith('/uploads/')) {
      logger.debug('Skipping delete for legacy /uploads/ URL (no local filesystem storage):', url);
      return;
    }

    logger.warn('deleteImage called with unrecognised URL format:', url);
  } catch (error) {
    logger.error('Error deleting image:', error);
    // Don't throw - deletion failures shouldn't break the app
  }
}

/**
 * Delete all marketplace images for a listing
 * Removes all image variants (original, thumbnail, optimized, large) associated with a listing
 * @param {string} listingId - Marketplace listing ID
 * @returns {Promise<number>} Number of images deleted
 */
async function deleteMarketplaceImages(listingId) {
  try {
    const isAvailable = await mongoDb.isMongoAvailable();
    if (!isAvailable) {
      logger.warn('MongoDB not available - cannot delete marketplace images', { listingId });
      return 0;
    }

    const db = await mongoDb.getDb();
    const collection = db.collection('marketplace_images');

    // Delete all images for this listing
    const result = await collection.deleteMany({ listingId });

    logger.info('Deleted marketplace images for listing', {
      listingId,
      deletedCount: result.deletedCount,
    });

    return result.deletedCount;
  } catch (error) {
    logger.error('Error deleting marketplace images', {
      error: error.message,
      listingId,
    });
    // Don't throw - deletion failures shouldn't break the app
    return 0;
  }
}

/**
 * Get image metadata
 * @param {Buffer} buffer - Image buffer
 * @returns {Promise<Object>} Image metadata
 */
async function getImageMetadata(buffer) {
  const metadata = await sharp(buffer).metadata();
  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    size: buffer.length,
    hasAlpha: metadata.hasAlpha,
  };
}

/**
 * Fetch image buffer from MongoDB by URL
 * @param {string} imageUrl - /api/photos/{id} URL
 * @returns {Promise<Buffer>} Image buffer
 */
async function fetchImageBufferFromMongoDB(imageUrl) {
  const photoId = imageUrl.split('/').pop();
  const db = await mongoDb.getDb();

  let photo = await db.collection('marketplace_images').findOne({ _id: photoId });
  if (!photo) {
    photo = await db.collection('photos').findOne({ _id: photoId });
  }

  if (!photo) {
    throw new Error(`Photo not found in MongoDB: ${photoId}`);
  }

  const data = photo.data || photo.imageData;
  if (!data) {
    throw new Error(`Photo has no image data: ${photoId}`);
  }

  return Buffer.from(data, 'base64');
}

/**
 * Crop image
 * @param {string} imageUrl - /api/photos/{id} URL of image to crop
 * @param {Object} cropData - Crop dimensions {x, y, width, height}
 * @returns {Promise<Object>} New cropped image URLs
 */
async function cropImage(imageUrl, cropData) {
  const buffer = await fetchImageBufferFromMongoDB(imageUrl);

  // Perform crop
  const cropped = await sharp(buffer)
    .extract({
      left: Math.round(cropData.x),
      top: Math.round(cropData.y),
      width: Math.round(cropData.width),
      height: Math.round(cropData.height),
    })
    .toBuffer();

  // Process and save cropped image
  return processAndSaveImage(cropped, 'cropped.jpg');
}

/**
 * Update photo metadata (caption, alt text, tags)
 * @param {string} photoId - Photo identifier
 * @param {Object} metadata - New metadata { caption, altText, tags, isFeatured, watermark }
 * @returns {Promise<Object>} Updated metadata
 */
function updatePhotoMetadata(photoId, metadata) {
  const { caption, altText, tags, isFeatured, watermark } = metadata;

  return {
    photoId,
    caption: caption || '',
    altText: altText || '',
    tags: Array.isArray(tags) ? tags : [],
    isFeatured: !!isFeatured,
    watermark: !!watermark,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Replace photo while keeping metadata
 * @param {string} photoId - Photo identifier
 * @param {Buffer} newImageBuffer - New image data
 * @param {Object} existingMetadata - Existing metadata to preserve
 * @returns {Promise<Object>} New image URLs with preserved metadata
 */
async function replacePhoto(photoId, newImageBuffer, existingMetadata) {
  // Process and save new image
  const newImageData = await processAndSaveImage(newImageBuffer, `replaced_${photoId}.jpg`);

  // Merge with existing metadata
  return {
    ...newImageData,
    metadata: existingMetadata,
  };
}

/**
 * Apply filters to image (brightness, contrast, saturation)
 * @param {string} imageUrl - /api/photos/{id} URL
 * @param {Object} filters - Filter values { brightness, contrast, saturation }
 * @returns {Promise<Object>} Processed image data
 */
async function applyFilters(imageUrl, filters) {
  const { brightness = 1, contrast = 1, saturation = 1 } = filters;

  // Load image from MongoDB
  const buffer = await fetchImageBufferFromMongoDB(imageUrl);

  // Apply filters using Sharp
  let image = sharp(buffer);

  // Brightness adjustment (0.5 = darker, 1.5 = brighter)
  if (brightness !== 1) {
    image = image.modulate({ brightness });
  }

  // Saturation adjustment (0 = grayscale, 2 = very saturated)
  if (saturation !== 1) {
    image = image.modulate({ saturation });
  }

  // Contrast is handled via linear transform
  if (contrast !== 1) {
    const alpha = contrast;
    const beta = 128 * (1 - contrast);
    image = image.linear(alpha, beta);
  }

  const processed = await image.toBuffer();

  // Save processed image
  return processAndSaveImage(processed, 'filtered.jpg');
}

/**
 * Bulk update photo order
 * @param {Array} photoOrder - Array of {photoId, order} objects
 * @returns {Promise<Array>} Updated order
 */
function updatePhotoOrder(photoOrder) {
  return photoOrder.map((item, index) => ({
    photoId: item.photoId,
    order: index,
  }));
}

module.exports = {
  upload,
  processAndSaveImage,
  processAndSaveMarketplaceImage,
  deleteImage,
  deleteMarketplaceImages,
  getImageMetadata,
  cropImage,
  updatePhotoMetadata,
  replacePhoto,
  applyFilters,
  updatePhotoOrder,
  extractExifData,
  IMAGE_CONFIGS,
  // Export file size constants for use in routes
  MAX_FILE_SIZE_SUPPLIER: MAX_FILE_SIZE,
  MAX_FILE_SIZE_AVATAR,
  MAX_FILE_SIZE_MARKETPLACE,
};
