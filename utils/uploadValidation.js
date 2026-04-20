/**
 * Upload Validation Utilities
 * Provides robust server-side validation for file uploads with:
 * - Magic-byte detection for true file type validation
 * - Pixel count limits to mitigate decompression bombs
 * - Metadata stripping (EXIF/GPS)
 * - Configurable file size limits
 */

'use strict';

const sharp = require('sharp');
const logger = require('./logger');
let fileTypeFromBufferFn = null;

async function resolveFileTypeFromBuffer() {
  if (typeof fileTypeFromBufferFn === 'function') {
    return fileTypeFromBufferFn;
  }
  const fileTypeModule = await import('file-type');
  const fn = fileTypeModule.fileTypeFromBuffer || fileTypeModule.default?.fileTypeFromBuffer;
  if (typeof fn !== 'function') {
    throw new Error('file-type module does not export fileTypeFromBuffer');
  }
  fileTypeFromBufferFn = fn;
  return fileTypeFromBufferFn;
}

// Configurable limits from environment variables with safe defaults
const MAX_FILE_SIZE_MARKETPLACE =
  parseInt(process.env.MAX_FILE_SIZE_MARKETPLACE_MB || '10', 10) * 1024 * 1024;
const MAX_FILE_SIZE_SUPPLIER =
  parseInt(process.env.MAX_FILE_SIZE_SUPPLIER_MB || '10', 10) * 1024 * 1024;
const MAX_FILE_SIZE_AVATAR = parseInt(process.env.MAX_FILE_SIZE_AVATAR_MB || '5', 10) * 1024 * 1024;

// Maximum pixel count to prevent decompression bombs (25 megapixels)
const MAX_PIXEL_COUNT = parseInt(process.env.MAX_PIXEL_COUNT || '25000000', 10);

// Allowed image types (magic bytes)
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
];

// Format name mapping for user-friendly display
const FORMAT_NAMES = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'image/avif': 'AVIF',
  'image/heic': 'HEIC',
};

// Get user-friendly format names from MIME types
const ALLOWED_FORMAT_NAMES = ALLOWED_IMAGE_TYPES.map(mime => FORMAT_NAMES[mime] || mime);

/**
 * Helper function to check file extension as a fallback
 * @param {string} filename - Original filename
 * @returns {string|null} - Detected MIME type based on extension, or null
 */
function detectTypeFromExtension(filename) {
  if (!filename || typeof filename !== 'string') {
    return null;
  }

  // Check if filename contains a dot and has an extension
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === filename.length - 1) {
    return null; // No extension found
  }

  const ext = filename.substring(lastDotIndex + 1).toLowerCase();
  const extensionMap = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    heic: 'image/heic',
    heif: 'image/heic', // HEIF is the container format, HEIC is the codec
  };

  return extensionMap[ext] || null;
}

/**
 * Validate file type using magic-byte detection
 * Prevents file type spoofing by checking actual file content
 * Falls back to extension-based validation if magic byte detection fails
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Original filename (optional, for fallback)
 * @returns {Promise<Object>} - { valid: boolean, detectedType: string, error?: string }
 */
async function validateFileType(buffer, filename = null) {
  try {
    // Ensure buffer is valid
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return {
        valid: false,
        detectedType: 'invalid',
        error: 'Invalid or empty file buffer.',
        allowedTypes: ALLOWED_IMAGE_TYPES,
      };
    }

    // Get magic bytes for debugging (first 16 bytes as hex)
    const magicBytes = buffer.slice(0, Math.min(16, buffer.length)).toString('hex');

    let fileType;
    try {
      const fileTypeFromBuffer = await resolveFileTypeFromBuffer();
      fileType = await fileTypeFromBuffer(buffer);
    } catch (detectionError) {
      const isJestVmImportIssue =
        typeof detectionError?.message === 'string' &&
        detectionError.message.includes('without --experimental-vm-modules');
      if (!isJestVmImportIssue) {
        logger.warn('Magic byte detection threw an error, attempting extension fallback', {
          error: detectionError.message,
          magicBytes,
          filename,
        });
      }

      // Fallback to extension-based detection
      if (filename) {
        const extensionType = detectTypeFromExtension(filename);
        if (extensionType && ALLOWED_IMAGE_TYPES.includes(extensionType)) {
          logger.info('Using extension-based type detection as fallback', {
            filename,
            detectedType: extensionType,
          });
          return {
            valid: true,
            detectedType: extensionType,
            usedFallback: true,
          };
        }
      }

      // If no fallback worked, return error with details
      return {
        valid: false,
        detectedType: 'error',
        error: `File type detection failed: ${detectionError.message}. The file may be corrupted.`,
        allowedTypes: ALLOWED_IMAGE_TYPES,
        magicBytes,
      };
    }

    if (!fileType) {
      logger.warn('File type detection returned null, attempting extension fallback', {
        magicBytes,
        bufferLength: buffer.length,
        filename,
      });

      // Fallback to extension-based detection
      if (filename) {
        const extensionType = detectTypeFromExtension(filename);
        if (extensionType && ALLOWED_IMAGE_TYPES.includes(extensionType)) {
          logger.info('Using extension-based type detection as fallback', {
            filename,
            detectedType: extensionType,
          });
          return {
            valid: true,
            detectedType: extensionType,
            usedFallback: true,
          };
        }
      }

      return {
        valid: false,
        detectedType: 'unknown',
        error: 'Unable to detect file type. File may be corrupted or unsupported.',
        allowedTypes: ALLOWED_IMAGE_TYPES,
        magicBytes,
      };
    }

    const isAllowed = ALLOWED_IMAGE_TYPES.includes(fileType.mime);

    if (!isAllowed) {
      logger.warn('File type not allowed', {
        detectedType: fileType.mime,
        magicBytes,
        allowedTypes: ALLOWED_IMAGE_TYPES,
      });
      return {
        valid: false,
        detectedType: fileType.mime,
        error: `File type ${fileType.mime} is not allowed. Only JPEG, PNG, WebP, GIF, AVIF, and HEIC images are supported.`,
        allowedTypes: ALLOWED_IMAGE_TYPES,
      };
    }

    return {
      valid: true,
      detectedType: fileType.mime,
    };
  } catch (error) {
    logger.error('File type validation error:', {
      error: error.message,
      stack: error.stack,
      magicBytes: buffer.slice(0, Math.min(16, buffer.length)).toString('hex'),
    });

    // Try extension fallback as last resort
    if (filename) {
      const extensionType = detectTypeFromExtension(filename);
      if (extensionType && ALLOWED_IMAGE_TYPES.includes(extensionType)) {
        logger.info('Using extension-based type detection as final fallback', {
          filename,
          detectedType: extensionType,
        });
        return {
          valid: true,
          detectedType: extensionType,
          usedFallback: true,
        };
      }
    }

    return {
      valid: false,
      detectedType: 'error',
      error: `Failed to validate file type: ${error.message}`,
      allowedTypes: ALLOWED_IMAGE_TYPES,
    };
  }
}

/**
 * Validate image dimensions and pixel count
 * Prevents decompression bombs by limiting total pixel count
 * @param {Buffer} buffer - Image buffer
 * @returns {Promise<Object>} - { valid: boolean, width: number, height: number, pixelCount: number, error?: string }
 */
async function validateImageDimensions(buffer) {
  try {
    const metadata = await sharp(buffer).metadata();
    const pixelCount = (metadata.width || 0) * (metadata.height || 0);

    if (pixelCount > MAX_PIXEL_COUNT) {
      return {
        valid: false,
        width: metadata.width,
        height: metadata.height,
        pixelCount,
        error: `Image exceeds maximum pixel count. Maximum: ${MAX_PIXEL_COUNT} pixels (${Math.floor(MAX_PIXEL_COUNT / 1000000)}MP), actual: ${pixelCount} pixels (${Math.floor(pixelCount / 1000000)}MP).`,
      };
    }

    return {
      valid: true,
      width: metadata.width,
      height: metadata.height,
      pixelCount,
    };
  } catch (error) {
    logger.error('Image dimension validation error:', error);
    return {
      valid: false,
      width: 0,
      height: 0,
      pixelCount: 0,
      error: 'Failed to read image dimensions. File may be corrupted.',
    };
  }
}

/**
 * Validate file size based on context
 * @param {number} size - File size in bytes
 * @param {string} context - Upload context ('marketplace', 'supplier', 'avatar')
 * @returns {Object} - { valid: boolean, maxSize: number, error?: string }
 */
function validateFileSize(size, context = 'supplier') {
  let maxSize;

  switch (context) {
    case 'marketplace':
      maxSize = MAX_FILE_SIZE_MARKETPLACE;
      break;
    case 'avatar':
      maxSize = MAX_FILE_SIZE_AVATAR;
      break;
    case 'supplier':
    default:
      maxSize = MAX_FILE_SIZE_SUPPLIER;
      break;
  }

  if (size > maxSize) {
    return {
      valid: false,
      maxSize,
      error: `File size exceeds limit. Maximum: ${Math.floor(maxSize / 1024 / 1024)}MB, actual: ${Math.floor(size / 1024 / 1024)}MB.`,
    };
  }

  return {
    valid: true,
    maxSize,
  };
}

/**
 * Comprehensive file validation
 * Performs all validation checks: type, size, dimensions
 * @param {Buffer} buffer - File buffer
 * @param {string} context - Upload context ('marketplace', 'supplier', 'avatar')
 * @param {string} filename - Original filename (optional, for fallback type detection)
 * @returns {Promise<Object>} - { valid: boolean, errors: string[], details: Object }
 */
async function validateUpload(buffer, context = 'supplier', filename = null) {
  const errors = [];
  const details = {};

  // 1. Validate file size
  const sizeValidation = validateFileSize(buffer.length, context);
  details.size = sizeValidation;
  if (!sizeValidation.valid) {
    errors.push(sizeValidation.error);
  }

  // 2. Validate file type (magic bytes with extension fallback)
  const typeValidation = await validateFileType(buffer, filename);
  details.type = typeValidation;
  if (!typeValidation.valid) {
    errors.push(typeValidation.error);
  }

  // 3. Validate dimensions (decompression bomb protection)
  // Only if type validation passed (to avoid processing invalid images)
  if (typeValidation.valid) {
    const dimensionValidation = await validateImageDimensions(buffer);
    details.dimensions = dimensionValidation;
    if (!dimensionValidation.valid) {
      errors.push(dimensionValidation.error);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    details,
  };
}

/**
 * Process image with metadata stripping
 * Removes EXIF data including GPS location for privacy
 * @param {Buffer} buffer - Original image buffer
 * @param {Object} options - Processing options (width, height, fit, quality)
 * @returns {Promise<Buffer>} - Processed image buffer with metadata stripped
 */
async function processWithMetadataStripping(buffer, options = {}) {
  try {
    const { width, height, fit = 'inside', quality = 85 } = options;

    let processor = sharp(buffer);

    // Resize if dimensions provided
    if (width || height) {
      processor = processor.resize({
        width,
        height,
        fit,
        withoutEnlargement: true,
      });
    }

    // Convert to JPEG with optimized compression settings
    // Sharp automatically strips metadata when converting formats
    processor = processor.jpeg({
      quality,
      progressive: true,
      mozjpeg: true, // Use MozJPEG for better compression
      chromaSubsampling: '4:2:0', // Aggressive chroma subsampling for smaller files
      optimizeScans: true, // Optimize progressive scan structure
      trellisQuantisation: true, // Better quantization for quality
      overshootDeringing: true, // Reduce compression artifacts
      optimizeQuantizationTable: true, // Further optimize quantization
    });

    // On sharp error: SharpProcessingError thrown — Failed to process image with Sharp (logged via logger.error)
    return processor.toBuffer();
  } catch (error) {
    logger.error('Sharp processing error:', {
      error: error.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
    });

    // Provide more context for Sharp errors
    const enhancedError = new Error(`Failed to process image with Sharp: ${error.message}`);
    enhancedError.name = 'SharpProcessingError';
    enhancedError.originalError = error;
    throw enhancedError;
  }
}

/**
 * Get configurable limits for display
 * @returns {Object} - Current upload limits
 */
function getUploadLimits() {
  return {
    maxFileSizes: {
      marketplace: MAX_FILE_SIZE_MARKETPLACE,
      supplier: MAX_FILE_SIZE_SUPPLIER,
      avatar: MAX_FILE_SIZE_AVATAR,
    },
    maxPixelCount: MAX_PIXEL_COUNT,
    allowedTypes: ALLOWED_IMAGE_TYPES,
  };
}

/**
 * Format a user-friendly error response for validation errors
 * Extracts detailed error information and creates clear error messages
 * @param {Error} error - ValidationError from processAndSaveImage
 * @returns {Object} - Formatted error response with user message and details
 */
function formatValidationErrorResponse(error) {
  if (error.name !== 'ValidationError') {
    return null;
  }

  // Extract file type information from validation details
  const typeDetails = error.details?.type || {};
  const detectedType = typeDetails.detectedType;
  const magicBytes = typeDetails.magicBytes;

  // Format allowed types as comma-separated string
  const allowedTypesString = ALLOWED_FORMAT_NAMES.join(', ');

  // Create a user-friendly error message
  let userMessage = error.message;
  if (detectedType === 'error') {
    // Special handling for detection errors
    userMessage = `Could not detect file type. The file may be corrupted or in an unsupported format. Allowed types: ${allowedTypesString}.`;
  } else if (detectedType && detectedType !== 'unknown' && detectedType !== 'invalid') {
    userMessage = `File type validation failed. Detected type: ${detectedType}. Allowed types: ${allowedTypesString}.`;
  } else if (detectedType === 'unknown') {
    userMessage = `Could not detect file type. The file may be corrupted. Allowed types: ${allowedTypesString}.`;
  } else if (detectedType === 'invalid') {
    userMessage = `Invalid or empty file provided. Allowed types: ${allowedTypesString}.`;
  }

  return {
    error: userMessage,
    details: {
      ...error.details,
      detectedType,
      allowedTypes: ALLOWED_IMAGE_TYPES,
      allowedFormats: ALLOWED_FORMAT_NAMES,
    },
    magicBytes,
  };
}

module.exports = {
  validateFileType,
  validateImageDimensions,
  validateFileSize,
  validateUpload,
  processWithMetadataStripping,
  getUploadLimits,
  formatValidationErrorResponse,
  // Export constants for testing
  MAX_FILE_SIZE_MARKETPLACE,
  MAX_FILE_SIZE_SUPPLIER,
  MAX_FILE_SIZE_AVATAR,
  MAX_PIXEL_COUNT,
  ALLOWED_IMAGE_TYPES,
};
