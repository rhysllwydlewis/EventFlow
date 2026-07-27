/**
 * Database Optimization Utilities
 * Provides index management and query optimization helpers
 */

'use strict';

const logger = require('./logger');

/**
 * Add indexes to MongoDB collections for query optimization
 * Should be called on database connection
 */
async function addDatabaseIndexes() {
  try {
    const mongoDb = require('../config/database').mongoDb;

    if (!mongoDb) {
      logger.warn('MongoDB not available - skipping index creation');
      return;
    }

    logger.info('Creating database indexes...');

    // Get active database instance from runtime connection state
    const db = mongoDb.getDb ? mongoDb.getDb() : null;

    if (!db) {
      logger.debug('Database instance not available yet; skipping index creation');
      return;
    }

    // User indexes
    try {
      await db.collection('users').createIndex({ email: 1 }, { unique: true });
      await db.collection('users').createIndex({ createdAt: -1 });
      logger.debug('User indexes created');
    } catch (error) {
      logger.debug('User indexes may already exist:', error.message);
    }

    // Supplier indexes
    try {
      await db.collection('suppliers').createIndex({ name: 1 });
      await db.collection('suppliers').createIndex({ category: 1 });
      await db.collection('suppliers').createIndex({ location: 1 });
      await db.collection('suppliers').createIndex({ isPro: 1 });
      await db.collection('suppliers').createIndex({ createdAt: -1 });
      logger.debug('Supplier indexes created');
    } catch (error) {
      logger.debug('Supplier indexes may already exist:', error.message);
    }

    // Package indexes
    try {
      await db.collection('packages').createIndex({ name: 1 });
      await db.collection('packages').createIndex({ supplierId: 1 });
      await db.collection('packages').createIndex({ category: 1 });
      await db.collection('packages').createIndex({ price: 1 });
      await db.collection('packages').createIndex({ createdAt: -1 });
      await db.collection('packages').createIndex({ rating: -1 });
      // Text index for search
      await db
        .collection('packages')
        .createIndex({ name: 'text', description: 'text' }, { name: 'text_search_index' });
      logger.debug('Package indexes created');
    } catch (error) {
      logger.debug('Package indexes may already exist:', error.message);
    }

    // Review indexes
    try {
      await db.collection('reviews').createIndex({ packageId: 1 });
      await db.collection('reviews').createIndex({ userId: 1 });
      await db.collection('reviews').createIndex({ supplierId: 1 });
      await db.collection('reviews').createIndex({ rating: -1 });
      await db.collection('reviews').createIndex({ createdAt: -1 });
      logger.debug('Review indexes created');
    } catch (error) {
      logger.debug('Review indexes may already exist:', error.message);
    }

    // Message indexes
    try {
      await db.collection('messages').createIndex({ threadId: 1, createdAt: -1 });
      await db.collection('messages').createIndex({ senderId: 1 });
      await db.collection('messages').createIndex({ recipientId: 1 });
      await db.collection('messages').createIndex({ read: 1 });
      logger.debug('Message indexes created');
    } catch (error) {
      logger.debug('Message indexes may already exist:', error.message);
    }

    // Thread indexes
    try {
      await db.collection('threads').createIndex({ participants: 1 });
      await db.collection('threads').createIndex({ lastMessageAt: -1 });
      logger.debug('Thread indexes created');
    } catch (error) {
      logger.debug('Thread indexes may already exist:', error.message);
    }

    // Notification indexes
    try {
      await db.collection('notifications').createIndex({ userId: 1, read: 1 });
      await db.collection('notifications').createIndex({ createdAt: -1 });
      logger.debug('Notification indexes created');
    } catch (error) {
      logger.debug('Notification indexes may already exist:', error.message);
    }

    // Background job telemetry indexes
    try {
      await db.collection('background_job_runs').createIndex({ jobKey: 1, startedAt: -1 });
      await db.collection('background_job_runs').createIndex({ status: 1, startedAt: -1 });
      logger.debug('Background job telemetry indexes created');
    } catch (error) {
      logger.debug('Background job telemetry indexes may already exist:', error.message);
    }

    // Partner reward integrity and anti-abuse indexes
    try {
      await db.collection('partners').createIndex({ userId: 1 }, { unique: true });
      await db.collection('partners').createIndex({ refCode: 1 }, { unique: true });
      await db.collection('partner_referrals').createIndex({ supplierUserId: 1 }, { unique: true });
      await db.collection('partner_credit_transactions').createIndex(
        { supplierUserId: 1, type: 1, partnerId: 1 },
        {
          unique: true,
          partialFilterExpression: { supplierUserId: { $type: 'string' } },
        }
      );
      await db.collection('partner_cashout_requests').createIndex(
        { partnerId: 1, idempotencyKey: 1 },
        {
          unique: true,
          partialFilterExpression: { idempotencyKey: { $type: 'string' } },
        }
      );
      await db.collection('partner_fraud_assessments').createIndex(
        { requestId: 1 },
        {
          unique: true,
          partialFilterExpression: { requestId: { $type: 'string' } },
        }
      );
      await db
        .collection('partner_fraud_assessments')
        .createIndex({ partnerId: 1, assessedAt: -1 });
      logger.debug('Partner anti-abuse indexes created');
    } catch (error) {
      logger.warn('Partner anti-abuse indexes could not be fully created:', error.message);
    }

    logger.info('Database indexes created successfully');
  } catch (error) {
    logger.error('Error creating database indexes:', error);
  }
}

/**
 * Pagination helper for consistent pagination logic
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @returns {Object} - Object with skip and limit for MongoDB queries
 */
function paginationHelper(page = 1, limit = 20) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  return {
    skip,
    limit: limitNum,
    page: pageNum,
  };
}

/**
 * Build MongoDB sort object from query parameters
 * @param {string} sortBy - Field to sort by
 * @param {string} order - Sort order ('asc' or 'desc')
 * @returns {Object} - MongoDB sort object
 */
function buildSortObject(sortBy = 'createdAt', order = 'desc') {
  const sortOrder = order === 'asc' ? 1 : -1;
  return { [sortBy]: sortOrder };
}

module.exports = {
  addDatabaseIndexes,
  paginationHelper,
  buildSortObject,
};
