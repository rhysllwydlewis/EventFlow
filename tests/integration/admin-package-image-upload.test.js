/**
 * Integration tests for admin package image upload endpoint
 * Tests error handling and validation for image uploads
 */

const fs = require('fs');

describe('Admin Package Image Upload Error Handling', () => {
  describe('Endpoint Structure Verification', () => {
    it('should have package image upload endpoint in routes/packages.js', () => {
      const packagesContent = fs.readFileSync('routes/packages.js', 'utf8');

      // Verify the package image upload endpoint exists
      expect(packagesContent).toContain('router.post(');
      expect(packagesContent).toContain("'/admin/packages/:id/image'");
      expect(packagesContent).toContain("applyPhotoUploadSingle('image')");
    });

    it('should have ValidationError handling in package image endpoint', () => {
      const packagesContent = fs.readFileSync('routes/packages.js', 'utf8');

      // Find the package image upload endpoint
      const packageImageStart = packagesContent.indexOf("'/admin/packages/:id/image'");
      const packageImageEnd = packagesContent.indexOf('module.exports', packageImageStart);
      const packageImageEndpoint = packagesContent.substring(packageImageStart, packageImageEnd);

      // Verify error handling exists
      expect(packageImageEndpoint).toContain("error.name === 'ValidationError'");
      expect(packageImageEndpoint).toContain('res.status(400).json');
      expect(packageImageEndpoint).toContain('details: error.details');
    });

    it('should have Sharp error handling in package image endpoint', () => {
      const packagesContent = fs.readFileSync('routes/packages.js', 'utf8');

      // Find the package image upload endpoint
      const packageImageStart = packagesContent.indexOf("'/admin/packages/:id/image'");
      const packageImageEnd = packagesContent.indexOf('module.exports', packageImageStart);
      const packageImageEndpoint = packagesContent.substring(packageImageStart, packageImageEnd);

      // Verify Sharp error handling exists
      expect(packageImageEndpoint).toContain("error.name === 'SharpProcessingError'");
      expect(packageImageEndpoint).toContain('Failed to process image');
    });

    it('should have MongoDB/storage error handling in package image endpoint', () => {
      const packagesContent = fs.readFileSync('routes/packages.js', 'utf8');

      // Find the package image upload endpoint
      const packageImageStart = packagesContent.indexOf("'/admin/packages/:id/image'");
      const packageImageEnd = packagesContent.indexOf('module.exports', packageImageStart);
      const packageImageEndpoint = packagesContent.substring(packageImageStart, packageImageEnd);

      // Verify MongoDB/storage error handling exists
      expect(packageImageEndpoint).toContain("error.name === 'MongoDBStorageError'");
      expect(packageImageEndpoint).toContain("error.name === 'FilesystemError'");
      expect(packageImageEndpoint).toContain('Failed to save image');
    });

    it('should have logging in package image endpoint', () => {
      const packagesContent = fs.readFileSync('routes/packages.js', 'utf8');

      // Find the package image upload endpoint
      const packageImageStart = packagesContent.indexOf("'/admin/packages/:id/image'");
      const packageImageEnd = packagesContent.indexOf('module.exports', packageImageStart);
      const packageImageEndpoint = packagesContent.substring(packageImageStart, packageImageEnd);

      // Verify logging exists
      expect(packageImageEndpoint).toContain('logger.info');
      expect(packageImageEndpoint).toContain('logger.error');
      expect(packageImageEndpoint).toContain('Processing package image upload');
    });
  });

  describe('Category Hero Image Upload Error Handling', () => {
    it('should have category hero image upload endpoint with similar error handling', () => {
      const adminConfigContent = fs.readFileSync('routes/admin-config.js', 'utf8');

      // Find the category hero image upload endpoint
      const categoryImageStart = adminConfigContent.indexOf("'/categories/:id/hero-image'");
      const nextEndpointStart = adminConfigContent.indexOf('router.', categoryImageStart + 100);
      const categoryImageEndpoint = adminConfigContent.substring(
        categoryImageStart,
        nextEndpointStart
      );

      // Verify error handling exists
      expect(categoryImageEndpoint).toContain("error.name === 'ValidationError'");
      expect(categoryImageEndpoint).toContain('res.status(400).json');
      expect(categoryImageEndpoint).toContain("error.name === 'SharpProcessingError'");
      expect(categoryImageEndpoint).toContain('logger.info');
      expect(categoryImageEndpoint).toContain('logger.error');
    });
  });

  describe('Photo Upload Module Error Handling', () => {
    it('should have enhanced error handling in processAndSaveImage', () => {
      const photoUploadContent = fs.readFileSync('photo-upload.js', 'utf8');

      // Verify enhanced error handling
      expect(photoUploadContent).toContain('ValidationError');
      expect(photoUploadContent).toContain('logger.info');
      expect(photoUploadContent).toContain('Starting image processing');
      expect(photoUploadContent).toContain('Image validation passed');
    });

    it('should have error context in processImage function', () => {
      const photoUploadContent = fs.readFileSync('photo-upload.js', 'utf8');

      // Find processImage function
      const processImageStart = photoUploadContent.indexOf('async function processImage(');
      const processImageEnd = photoUploadContent.indexOf('}', processImageStart + 500);
      const processImageFunc = photoUploadContent.substring(processImageStart, processImageEnd);

      // Verify error wrapping
      expect(processImageFunc).toContain('SharpProcessingError');
      expect(processImageFunc).toContain('Image processing failed');
    });

    it('saveToLocal has been removed: photo-upload.js is MongoDB-only', () => {
      const photoUploadContent = fs.readFileSync('photo-upload.js', 'utf8');
      // Local filesystem storage has been removed — MongoDB is the only backend
      expect(photoUploadContent).not.toContain('async function saveToLocal(');
      expect(photoUploadContent).not.toContain('STORAGE_TYPE');
      // Confirm MongoDB error type is still present
      expect(photoUploadContent).toContain('MongoDBStorageError');
    });

    it('should have error context in saveToMongoDB function', () => {
      const photoUploadContent = fs.readFileSync('photo-upload.js', 'utf8');

      // Find saveToMongoDB function
      const saveToMongoDBStart = photoUploadContent.indexOf('async function saveToMongoDB(');
      const saveToMongoDBEnd = photoUploadContent.indexOf('}', saveToMongoDBStart + 800);
      const saveToMongoDBFunc = photoUploadContent.substring(saveToMongoDBStart, saveToMongoDBEnd);

      // Verify error wrapping
      expect(saveToMongoDBFunc).toContain('MongoDBStorageError');
      expect(saveToMongoDBFunc).toContain('Failed to save image to MongoDB');
    });
  });

  describe('Upload Validation Error Handling', () => {
    it('should have Sharp error handling in processWithMetadataStripping', () => {
      const uploadValidationContent = fs.readFileSync('utils/uploadValidation.js', 'utf8');

      // Find processWithMetadataStripping function
      const processStart = uploadValidationContent.indexOf(
        'async function processWithMetadataStripping('
      );
      const processEnd = uploadValidationContent.indexOf('}', processStart + 1000);
      const processFunc = uploadValidationContent.substring(processStart, processEnd);

      // Verify error handling
      expect(processFunc).toContain('SharpProcessingError');
      expect(processFunc).toContain('Failed to process image with Sharp');
      expect(processFunc).toContain('logger.error');
    });

    it('should include allowedTypes in validateFileType responses', () => {
      const uploadValidationContent = fs.readFileSync('utils/uploadValidation.js', 'utf8');

      // Find validateFileType function
      const validateStart = uploadValidationContent.indexOf('async function validateFileType(');
      const validateEnd = uploadValidationContent.indexOf('\n}\n', validateStart + 100);
      const validateFunc = uploadValidationContent.substring(validateStart, validateEnd);

      // Verify allowedTypes is included in error responses
      expect(validateFunc).toContain('allowedTypes: ALLOWED_IMAGE_TYPES');
    });

    it('should log magic bytes when file type validation fails', () => {
      const uploadValidationContent = fs.readFileSync('utils/uploadValidation.js', 'utf8');

      // Find validateFileType function
      const validateStart = uploadValidationContent.indexOf('async function validateFileType(');
      const validateEnd = uploadValidationContent.indexOf('\n}\n', validateStart + 100);
      const validateFunc = uploadValidationContent.substring(validateStart, validateEnd);

      // Verify magic bytes logging
      expect(validateFunc).toContain('magicBytes');
      expect(validateFunc).toContain("toString('hex')");
      expect(validateFunc).toContain('logger.warn');
    });

    it('should log detected MIME type when validation fails', () => {
      const uploadValidationContent = fs.readFileSync('utils/uploadValidation.js', 'utf8');

      // Find validateFileType function
      const validateStart = uploadValidationContent.indexOf('async function validateFileType(');
      const validateEnd = uploadValidationContent.indexOf('\n}\n', validateStart + 100);
      const validateFunc = uploadValidationContent.substring(validateStart, validateEnd);

      // Verify MIME type logging
      expect(validateFunc).toContain('detectedType');
      expect(validateFunc).toContain('File type not allowed');
    });
  });

  describe('Error Response Structure', () => {
    it('should return proper error response structure for validation errors', () => {
      const packagesContent = fs.readFileSync('routes/packages.js', 'utf8');

      // Find the package image upload endpoint
      const packageImageStart = packagesContent.indexOf("'/admin/packages/:id/image'");
      const packageImageEnd = packagesContent.indexOf('module.exports', packageImageStart);
      const packageImageEndpoint = packagesContent.substring(packageImageStart, packageImageEnd);

      // Verify error response uses formatValidationErrorResponse helper
      expect(packageImageEndpoint).toContain('uploadValidation.formatValidationErrorResponse');
      expect(packageImageEndpoint).toContain('errorResponse.error');
      expect(packageImageEndpoint).toContain('errorResponse.details');
    });

    it('should include enhanced error details for file type validation', () => {
      const uploadValidationContent = fs.readFileSync('utils/uploadValidation.js', 'utf8');

      // Find the formatValidationErrorResponse function
      const formatStart = uploadValidationContent.indexOf(
        'function formatValidationErrorResponse('
      );
      const formatEnd = uploadValidationContent.indexOf('\n}\n', formatStart + 100);
      const formatFunc = uploadValidationContent.substring(formatStart, formatEnd);

      // Verify enhanced error messages
      expect(formatFunc).toContain('File type validation failed');
      expect(formatFunc).toContain('Could not detect file type');
      expect(formatFunc).toContain('Allowed types:');
      expect(formatFunc).toContain('ALLOWED_FORMAT_NAMES');
    });

    it('should log magic bytes when file type validation fails', () => {
      const packagesContent = fs.readFileSync('routes/packages.js', 'utf8');

      // Find the package image upload endpoint
      const packageImageStart = packagesContent.indexOf("'/admin/packages/:id/image'");
      const packageImageEnd = packagesContent.indexOf('module.exports', packageImageStart);
      const packageImageEndpoint = packagesContent.substring(packageImageStart, packageImageEnd);

      // Verify magic bytes logging
      expect(packageImageEndpoint).toContain('magicBytes');
      expect(packageImageEndpoint).toContain('logger.warn');
      expect(packageImageEndpoint).toContain('File type validation failed - magic bytes');
    });

    it('should use appropriate HTTP status codes', () => {
      const packagesContent = fs.readFileSync('routes/packages.js', 'utf8');

      // Find the package image upload endpoint
      const packageImageStart = packagesContent.indexOf("'/admin/packages/:id/image'");
      const packageImageEnd = packagesContent.indexOf('module.exports', packageImageStart);
      const packageImageEndpoint = packagesContent.substring(packageImageStart, packageImageEnd);

      // Verify status codes
      expect(packageImageEndpoint).toContain('res.status(400)'); // Validation errors
      expect(packageImageEndpoint).toContain('res.status(404)'); // Not found
      expect(packageImageEndpoint).toContain('res.status(500)'); // Server errors
    });
  });

  describe('Category Hero Image Enhanced Error Handling', () => {
    it('should have enhanced error details in category hero image endpoint', () => {
      const adminConfigContent = fs.readFileSync('routes/admin-config.js', 'utf8');

      // Find the category hero image upload endpoint
      const categoryImageStart = adminConfigContent.indexOf("'/categories/:id/hero-image'");
      const nextEndpointStart = adminConfigContent.indexOf('router.', categoryImageStart + 100);
      const categoryImageEndpoint = adminConfigContent.substring(
        categoryImageStart,
        nextEndpointStart
      );

      // Verify enhanced error handling uses helper function
      expect(categoryImageEndpoint).toContain('uploadValidation.formatValidationErrorResponse');
      expect(categoryImageEndpoint).toContain('errorResponse.error');
      expect(categoryImageEndpoint).toContain('errorResponse.details');
      expect(categoryImageEndpoint).toContain('magicBytes');
    });
  });

  describe('Directory Creation', () => {
    it('saveToLocal removed: no directory creation needed (MongoDB-only)', () => {
      const photoUploadContent = fs.readFileSync('photo-upload.js', 'utf8');
      // Local filesystem storage was removed; no directory creation code should exist
      expect(photoUploadContent).not.toContain('async function saveToLocal(');
      expect(photoUploadContent).not.toContain('function ensureDirectoriesExist()');
    });

    it('MongoDB-only storage: no mkdirSync on module load', () => {
      const photoUploadContent = fs.readFileSync('photo-upload.js', 'utf8');
      // MongoDB storage does not require directory creation on module load
      expect(photoUploadContent).not.toContain('ensureDirectoriesExist()');
    });
  });

  describe('Client-Side Error Handling', () => {
    it('should parse and display detailed error messages', () => {
      const clientContent = fs.readFileSync(
        'public/assets/js/pages/admin-packages-init.js',
        'utf8'
      );

      // Verify enhanced error message parsing
      expect(clientContent).toContain('errorData.details');
      expect(clientContent).toContain('details.detectedType');
      expect(clientContent).toContain('details.allowedFormats');
    });

    it('should format error messages with detected and allowed types', () => {
      const clientContent = fs.readFileSync(
        'public/assets/js/pages/admin-packages-init.js',
        'utf8'
      );

      // Verify error message formatting
      expect(clientContent).toContain('Could not detect file type');
      expect(clientContent).toContain('Invalid file type');
      expect(clientContent).toContain('Detected:');
      expect(clientContent).toContain('Allowed:');
    });
  });
});
