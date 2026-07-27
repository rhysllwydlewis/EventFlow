/**
 * Database Configuration
 * Handles MongoDB connection and initialization
 */

'use strict';

const dbUnified = require('../db-unified');
const mongoDb = require('../db');
const logger = require('../utils/logger');

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
    return dbType;
  } catch (error) {
    logger.error('Database connection failed:', error);
    throw error;
  }
}

function isMongoAvailable() {
  return mongoDb.isMongoAvailable();
}

function isConnected() {
  return mongoDb.isConnected ? mongoDb.isConnected() : false;
}

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
  isMongoAvailable,
  isConnected,
  getConnectionStatus,
  dbUnified,
  mongoDb,
};