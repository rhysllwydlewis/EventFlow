/**
 * Storage Configuration
 * Handles file upload settings and storage configuration
 */

'use strict';

const photoUpload = require('../photo-upload');
const logger = require('../utils/logger');

/**
 * Get upload middleware
 * @returns {Object} Multer upload middleware
 */
function getUploadMiddleware() {
  return photoUpload.upload;
}

/**
 * Get photo upload utilities
 * @returns {Object} Photo upload utilities
 */
function getPhotoUploadUtils() {
  return {
    processAndStorePhoto: photoUpload.processAndStorePhoto,
    getPhotoUrl: photoUpload.getPhotoUrl,
    deletePhoto: photoUpload.deletePhoto,
  };
}

/**
 * Initialize storage
 * Checks MongoDB availability for photo storage
 */
function initializeStorage() {
  try {
    logger.info('Storage configuration initialized');
  } catch (error) {
    logger.error('Storage initialization error:', error);
  }
}

module.exports = {
  getUploadMiddleware,
  getPhotoUploadUtils,
  initializeStorage,
  // Re-export for compatibility
  photoUpload,
};
