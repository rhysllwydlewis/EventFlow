/**
 * Database Configuration
 * Handles MongoDB connection and initialization
 */

'use strict';

const dbUnified = require('../db-unified');
const mongoDb = require('../db');
const logger = require('../utils/logger');

let reviewRequestMaintenanceInitialised = false;

function initialiseReviewRequestMaintenance({ service, log = logger } = {}) {
  if (reviewRequestMaintenanceInitialised) {
    return null;
  }

  const configured = process.env.REVIEW_REQUEST_MAINTENANCE_ENABLED;
  const enabled =
    configured === undefined
      ? process.env.NODE_ENV === 'production'
      : configured !== 'false' && configured !== '0';
  if (!enabled) {
    return null;
  }

  try {
    const maintenanceService = service || require('../services/reviewRequestMaintenance.service');
    const result = maintenanceService.scheduleMaintenance({
      db: dbUnified,
      log,
    });
    reviewRequestMaintenanceInitialised = Boolean(result && result.scheduled);
    return result;
  } catch (error) {
    log.warn('[review-request-maintenance] Scheduler failed to initialise:', error.message);
    return null;
  }
}

/**
 * Initialize database connection
 * Connects to MongoDB or falls back to local storage
 * @returns {Promise<string>} Database type ('mongodb' or 'local')
 */
async function initializeDatabase() {
  try {
    logger.info('Connecting to database...');
    const dbType = await dbUnified.initializeDatabase();
    logger.info(`Database connection successful: ${dbType}`);
    initialiseReviewRequestMaintenance();
    return dbType;
  } catch (error) {
    logger.error('Database connection failed:', error);
    throw error;
  }
}

/**
 * Check if MongoDB is available
 * @returns {boolean} True if MongoDB is configured
 */
function isMongoAvailable() {
  return mongoDb.isMongoAvailable();
}

/**
 * Check if database is connected
 * @returns {boolean} True if database is connected
 */
function isConnected() {
  return mongoDb.isConnected ? mongoDb.isConnected() : false;
}

/**
 * Get database connection status
 * @returns {Object} Status object with connection state
 */
function getConnectionStatus() {
  const dbStatus = dbUnified.getStatus();
  return {
    type: dbStatus.type,
    initialized: dbStatus.initialized,
    mongoConnected: isConnected(),
  };
}

module.exports = {
  initializeDatabase,
  initialiseReviewRequestMaintenance,
  isMongoAvailable,
  isConnected,
  getConnectionStatus,
  // Re-export for compatibility
  dbUnified,
  mongoDb,
};
