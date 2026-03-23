/**
 * Unified Database Layer for EventFlow
 * Provides a single interface that works with MongoDB or local storage
 * MongoDB is the primary database; local storage is fallback only
 *
 * Connection error handling: any connect error (error connecting to MongoDB)
 * is caught and falls back to local storage gracefully.
 */

'use strict';

const db = require('./db');
const logger = require('./utils/logger');
const store = require('./store');

let dbType = null;
let mongodb = null;

// Database initialization state tracking for health checks
let initializationState = 'not_started';
let initializationError = null;

// Query performance monitoring
let queryMetrics = {
  totalQueries: 0,
  slowQueries: 0,
  avgQueryTime: 0,
  queryTimes: [],
};

const SLOW_QUERY_THRESHOLD = 1000;

function withTimeout(promise, timeoutMs, operationName) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

async function initializeDatabase() {
  if (dbType) {
    if (initializationState !== 'completed') {
      initializationState = 'completed';
    }
    return dbType;
  }

  initializationState = 'in_progress';

  try {
    if (db.isMongoAvailable()) {
      mongodb = await withTimeout(db.connect(), 10000, 'MongoDB connection');
      dbType = 'mongodb';
      initializationState = 'completed';
      initializationError = null;
      logger.info('✅ Using MongoDB for data storage (PRIMARY)');
      await createIndexes();
      return dbType;
    }
  } catch (error) {
    logger.info('MongoDB not available:', error.message);
    initializationError = error.message;
  }

  dbType = 'local';
  initializationState = 'completed';
  initializationError = null;
  logger.info('⚠️  Using local file storage (not suitable for production)');
  logger.info('   Set MONGODB_URI for cloud database storage');
  return dbType;
}

async function createIndexes() {
  if (dbType !== 'mongodb' || !mongodb) {
    return;
  }

  try {
    logger.info('📊 Creating database indexes...');
    const usersCollection = mongodb.collection('users');
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    await usersCollection.createIndex({ role: 1 });
    await usersCollection.createIndex({ createdAt: -1 });
    const suppliersCollection = mongodb.collection('suppliers');
    await suppliersCollection.createIndex({ category: 1 });
    await suppliersCollection.createIndex({ userId: 1 });
    await suppliersCollection.createIndex({ featured: 1 });
    await suppliersCollection.createIndex({ approved: 1 });
    const packagesCollection = mongodb.collection('packages');
    await packagesCollection.createIndex({ supplierId: 1 });
    await packagesCollection.createIndex({ category: 1 });
    await packagesCollection.createIndex({ price: 1 });
    const messagesCollection = mongodb.collection('messages');
    await messagesCollection.createIndex({ userId: 1, createdAt: -1 });
    await messagesCollection.createIndex({ supplierId: 1, createdAt: -1 });
    await messagesCollection.createIndex({ threadId: 1 });
    const plansCollection = mongodb.collection('plans');
    await plansCollection.createIndex({ userId: 1 });
    await plansCollection.createIndex({ eventDate: 1 });
    const reviewsCollection = mongodb.collection('reviews');
    await reviewsCollection.createIndex({ supplierId: 1 });
    await reviewsCollection.createIndex({ userId: 1 });
    await reviewsCollection.createIndex({ rating: -1 });
    const threadsCollection = mongodb.collection('threads');
    await threadsCollection.createIndex({ participantIds: 1 });
    await threadsCollection.createIndex({ createdAt: -1 });
    await threadsCollection.createIndex({ supplierId: 1 });
    const ticketsCollection = mongodb.collection('tickets');
    await ticketsCollection.createIndex({ userId: 1 });
    await ticketsCollection.createIndex({ status: 1 });
    await ticketsCollection.createIndex({ createdAt: -1 });
    const paymentsCollection = mongodb.collection('payments');
    await paymentsCollection.createIndex({ userId: 1 });
    await paymentsCollection.createIndex({ status: 1 });
    await paymentsCollection.createIndex({ createdAt: -1 });
    const subscriptionsCollection = mongodb.collection('subscriptions');
    await subscriptionsCollection.createIndex({ userId: 1 });
    await subscriptionsCollection.createIndex({ status: 1 });
    const marketplaceCollection = mongodb.collection('marketplace_listings');
    await marketplaceCollection.createIndex({ sellerId: 1 });
    await marketplaceCollection.createIndex({ sellerUserId: 1 });
    await marketplaceCollection.createIndex({ category: 1 });
    await marketplaceCollection.createIndex({ status: 1 });
    await marketplaceCollection.createIndex({ createdAt: -1 });
    const quoteRequestsCollection = mongodb.collection('quoteRequests');
    await quoteRequestsCollection.createIndex({ userId: 1 });
    await quoteRequestsCollection.createIndex({ supplierId: 1 });
    await quoteRequestsCollection.createIndex({ status: 1 });
    const enquiriesCollection = mongodb.collection('enquiries');
    await enquiriesCollection.createIndex({ supplierId: 1 });
    await enquiriesCollection.createIndex({ senderEmail: 1 });
    await enquiriesCollection.createIndex({ createdAt: -1 });
    const contactEnquiriesCollection = mongodb.collection('contact_enquiries');
    await contactEnquiriesCollection.createIndex({ senderEmail: 1 });
    await contactEnquiriesCollection.createIndex({ status: 1 });
    await contactEnquiriesCollection.createIndex({ createdAt: -1 });
    const shortlistsCollection = mongodb.collection('shortlists');
    await shortlistsCollection.createIndex({ userId: 1 }, { unique: true });
    const notificationsCollection = mongodb.collection('notifications');
    await notificationsCollection.createIndex({ userId: 1, createdAt: -1 });
    await notificationsCollection.createIndex({ read: 1 });
    const supplierAnalyticsCollection = mongodb.collection('supplierAnalytics');
    await supplierAnalyticsCollection.createIndex({ supplierId: 1 }, { unique: true });
    const reviewVotesCollection = mongodb.collection('reviewVotes');
    await reviewVotesCollection.createIndex({ reviewId: 1 });
    await reviewVotesCollection.createIndex({ userId: 1, reviewId: 1 });
    const reviewModerationsCollection = mongodb.collection('reviewModerations');
    await reviewModerationsCollection.createIndex({ reviewId: 1 });
    const popularSearchesCollection = mongodb.collection('popularSearches');
    await popularSearchesCollection.createIndex({ query: 1 }, { unique: true });
    const systemChecksCollection = mongodb.collection('system_checks');
    await systemChecksCollection.createIndex({ startedAt: -1 });
    await systemChecksCollection.createIndex({ status: 1 });
    // Partner programme collections
    const partnersCollection = mongodb.collection('partners');
    await partnersCollection.createIndex({ userId: 1 }, { unique: true });
    await partnersCollection.createIndex({ refCode: 1 }, { unique: true });
    await partnersCollection.createIndex({ status: 1 });
    const partnerReferralsCollection = mongodb.collection('partner_referrals');
    await partnerReferralsCollection.createIndex({ partnerId: 1 });
    await partnerReferralsCollection.createIndex({ supplierUserId: 1 }, { unique: true });
    const partnerCreditTxnsCollection = mongodb.collection('partner_credit_transactions');
    await partnerCreditTxnsCollection.createIndex({ partnerId: 1, createdAt: -1 });
    const partnerCodeHistoryCollection = mongodb.collection('partner_code_history');
    await partnerCodeHistoryCollection.createIndex({ partnerId: 1 });
    await partnerCodeHistoryCollection.createIndex({ refCode: 1 });
    logger.info('✅ Database indexes created successfully');
  } catch (error) {
    logger.info('ℹ️  Database indexes:', error.message);
  }
}

async function read(collectionName) {
  await initializeDatabase();
  try {
    if (dbType === 'mongodb') {
      const collection = mongodb.collection(collectionName);
      if (collectionName === 'settings') {
        const doc = await collection.findOne({ id: 'system' });
        if (doc) {
          // Destructure to remove MongoDB _id and custom id, keeping only settings
          // eslint-disable-next-line no-unused-vars
          const { _id, id, ...settings } = doc;
          return settings;
        }
        return {};
      }
      return await collection.find({}).toArray();
    } else {
      return store.read(collectionName);
    }
  } catch (error) {
    logger.error(`Error reading from ${collectionName}:`, error.message);
    if (dbType !== 'local') {
      logger.info(`Falling back to local storage for ${collectionName}`);
      return store.read(collectionName);
    }
    return collectionName === 'settings' ? {} : [];
  }
}

async function write(collectionName, data) {
  await initializeDatabase();
  try {
    if (dbType === 'mongodb') {
      const collection = mongodb.collection(collectionName);
      if (collectionName === 'settings') {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('Settings data must be a non-null object');
        }
        await collection.deleteMany({});
        await collection.insertOne({ id: 'system', ...data });
        return true;
      }
      await collection.deleteMany({});
      if (Array.isArray(data) && data.length > 0) {
        await collection.insertMany(data);
      }
      return true;
    } else {
      store.write(collectionName, data);
      return true;
    }
  } catch (error) {
    logger.error(`Error writing to ${collectionName}:`, error.message);
    if (dbType !== 'local') {
      logger.warn(
        `⚠️  MongoDB write failed for ${collectionName}, falling back to local storage. ` +
          `Data is saved locally but may not be replicated. Error: ${error.message}`
      );
      try {
        store.write(collectionName, data);
        return true;
      } catch (fallbackError) {
        logger.error(
          `Critical: Both MongoDB and local storage failed for ${collectionName}. ` +
            `MongoDB error: ${error.message}, Local storage error: ${fallbackError.message}`
        );
        return false;
      }
    }
    return false;
  }
}

async function findOne(collectionName, filter) {
  await initializeDatabase();
  try {
    if (dbType === 'mongodb') {
      if (typeof filter === 'function') {
        const all = await read(collectionName);
        return all.find(filter) || null;
      }
      const collection = mongodb.collection(collectionName);
      return await collection.findOne(filter);
    } else {
      const all = store.read(collectionName);
      if (typeof filter === 'function') {
        return all.find(filter) || null;
      }
      return (
        all.find(item => {
          return Object.keys(filter).every(key => item[key] === filter[key]);
        }) || null
      );
    }
  } catch (error) {
    logger.error(`Error finding in ${collectionName}:`, error.message);
    return null;
  }
}

async function find(collectionName, filter) {
  await initializeDatabase();
  try {
    if (dbType === 'mongodb') {
      if (typeof filter === 'function') {
        const all = await read(collectionName);
        return all.filter(filter);
      }
      const collection = mongodb.collection(collectionName);
      return await collection.find(filter).toArray();
    } else {
      const all = store.read(collectionName);
      if (typeof filter === 'function') {
        return all.filter(filter);
      }
      return all.filter(item => {
        return Object.keys(filter).every(key => item[key] === filter[key]);
      });
    }
  } catch (error) {
    logger.error(`Error finding in ${collectionName}:`, error.message);
    return [];
  }
}

async function updateOne(collectionName, id, updates) {
  await initializeDatabase();
  try {
    // Normalise the filter: accept either a string id or a plain filter object
    const filter = typeof id === 'object' && id !== null ? id : { id };

    // Detect whether the caller already supplied MongoDB update operators
    // (e.g. { $set: {...} }, { $set: {...}, $unset: {...} })
    const hasOperators =
      updates !== null &&
      typeof updates === 'object' &&
      Object.keys(updates).some(k => k.startsWith('$'));

    if (dbType === 'mongodb') {
      const collection = mongodb.collection(collectionName);
      const mongoUpdate = hasOperators ? updates : { $set: updates };
      const result = await collection.updateOne(filter, mongoUpdate);
      return result.modifiedCount > 0;
    } else {
      const all = store.read(collectionName);
      const index = all.findIndex(item => Object.keys(filter).every(k => item[k] === filter[k]));
      if (index >= 0) {
        // Apply $set fields
        const setFields = hasOperators ? updates.$set || {} : updates;
        all[index] = { ...all[index], ...setFields };

        // Apply $unset fields (remove keys)
        if (hasOperators && updates.$unset) {
          for (const key of Object.keys(updates.$unset)) {
            delete all[index][key];
          }
        }

        store.write(collectionName, all);
        return true;
      }
      return false;
    }
  } catch (error) {
    logger.error(`Error updating in ${collectionName}:`, error.message);
    return false;
  }
}

async function insertOne(collectionName, document) {
  await initializeDatabase();
  try {
    if (dbType === 'mongodb') {
      const collection = mongodb.collection(collectionName);
      await collection.insertOne(document);
      return document;
    } else {
      const all = store.read(collectionName);
      all.push(document);
      store.write(collectionName, all);
      return document;
    }
  } catch (error) {
    logger.error(`Error inserting into ${collectionName}:`, error.message);
    return null;
  }
}

async function deleteOne(collectionName, id) {
  await initializeDatabase();
  try {
    // Normalise the filter: accept either a string id or a plain filter object
    const filter = typeof id === 'object' && id !== null ? id : { id };

    if (dbType === 'mongodb') {
      const collection = mongodb.collection(collectionName);
      const result = await collection.deleteOne(filter);
      return result.deletedCount > 0;
    } else {
      const all = store.read(collectionName);
      const index = all.findIndex(item => Object.keys(filter).every(k => item[k] === filter[k]));
      if (index >= 0) {
        all.splice(index, 1);
        store.write(collectionName, all);
        return true;
      }
      return false;
    }
  } catch (error) {
    logger.error(`Error deleting from ${collectionName}:`, error.message);
    return false;
  }
}

function uid(prefix = 'id') {
  return store.uid(prefix);
}

function getDatabaseType() {
  return dbType || 'unknown';
}

function getDatabaseStatus() {
  return {
    state: initializationState,
    type: dbType || 'unknown',
    connected: initializationState === 'completed' && dbType !== null,
    error: initializationError,
  };
}

function trackQueryPerformance(operation, duration) {
  queryMetrics.totalQueries++;
  queryMetrics.queryTimes.push(duration);
  if (queryMetrics.queryTimes.length > 1000) {
    queryMetrics.queryTimes.shift();
  }
  const sum = queryMetrics.queryTimes.reduce((a, b) => a + b, 0);
  queryMetrics.avgQueryTime = sum / queryMetrics.queryTimes.length;
  if (duration > SLOW_QUERY_THRESHOLD) {
    queryMetrics.slowQueries++;
    logger.warn(`⚠️  Slow query detected: ${operation} took ${duration}ms`);
  }
}

function getQueryMetrics() {
  return {
    ...queryMetrics,
    slowQueryPercentage:
      queryMetrics.totalQueries > 0
        ? ((queryMetrics.slowQueries / queryMetrics.totalQueries) * 100).toFixed(2)
        : 0,
  };
}

function resetQueryMetrics() {
  queryMetrics = {
    totalQueries: 0,
    slowQueries: 0,
    avgQueryTime: 0,
    queryTimes: [],
  };
}

async function withPerformanceTracking(operation, fn) {
  const startTime = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    trackQueryPerformance(operation, duration);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    trackQueryPerformance(operation, duration);
    throw error;
  }
}

const validationSchemas = {
  users: {
    email: { type: 'string', required: true },
    role: { type: 'string', enum: ['customer', 'supplier', 'admin'], required: true },
    createdAt: { type: 'date', required: true },
  },
  suppliers: {
    userId: { type: 'string', required: true },
    category: { type: 'string', required: true },
    approved: { type: 'boolean', required: true },
  },
  packages: {
    supplierId: { type: 'string', required: true },
    name: { type: 'string', required: true },
    price: { type: 'number', required: true },
  },
  messages: {
    userId: { type: 'string', required: true },
    threadId: { type: 'string', required: true },
    content: { type: 'string', required: true },
    createdAt: { type: 'date', required: true },
  },
};

function validateDocument(collectionName, document) {
  const schema = validationSchemas[collectionName];
  if (!schema) {
    return { isValid: true, errors: [] };
  }
  const errors = [];
  for (const [field, rules] of Object.entries(schema)) {
    const value = document[field];
    if (rules.required && (value === undefined || value === null)) {
      errors.push(`Field '${field}' is required`);
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }
    if (rules.type) {
      const actualType = rules.type === 'date' ? 'object' : typeof value;
      if (rules.type === 'date' && !(value instanceof Date)) {
        errors.push(`Field '${field}' must be a Date`);
      } else if (rules.type !== 'date' && actualType !== rules.type) {
        errors.push(`Field '${field}' must be of type ${rules.type}`);
      }
    }
    if (rules.enum && !rules.enum.includes(value)) {
      errors.push(`Field '${field}' must be one of: ${rules.enum.join(', ')}`);
    }
  }
  return {
    isValid: errors.length === 0,
    errors,
  };
}

async function count(collectionName, filter = {}) {
  await initializeDatabase();
  try {
    if (dbType === 'mongodb') {
      const collection = mongodb.collection(collectionName);
      return await collection.countDocuments(filter);
    } else {
      const all = store.read(collectionName);
      if (Object.keys(filter).length === 0) {
        return all.length;
      }
      return all.filter(item => matchesFilter(item, filter)).length;
    }
  } catch (error) {
    logger.error(`Error counting in ${collectionName}:`, error.message);
    return 0;
  }
}

function matchesFilter(item, filter) {
  return Object.keys(filter).every(key => {
    if (key === '$or' && Array.isArray(filter[key])) {
      return filter[key].some(orFilter => matchesFilter(item, orFilter));
    }
    const filterValue = filter[key];
    const itemValue = item[key];
    if (typeof filterValue === 'object' && filterValue !== null && !Array.isArray(filterValue)) {
      return Object.keys(filterValue).every(operator => {
        const operatorValue = filterValue[operator];
        switch (operator) {
          case '$gte':
            return itemValue >= operatorValue;
          case '$lte':
            return itemValue <= operatorValue;
          case '$gt':
            return itemValue > operatorValue;
          case '$lt':
            return itemValue < operatorValue;
          case '$ne':
            return itemValue !== operatorValue;
          case '$in':
            return Array.isArray(operatorValue) && operatorValue.includes(itemValue);
          case '$regex': {
            const options = filterValue.$options || '';
            const regex = new RegExp(operatorValue, options);
            return regex.test(itemValue);
          }
          default:
            logger.warn(`Unsupported MongoDB operator: ${operator}`);
            return true;
        }
      });
    }
    return itemValue === filterValue;
  });
}

async function aggregate(collectionName, pipeline) {
  await initializeDatabase();
  try {
    if (dbType === 'mongodb') {
      const collection = mongodb.collection(collectionName);
      return await collection.aggregate(pipeline).toArray();
    } else {
      logger.warn(`Aggregation on local storage for ${collectionName} - consider using MongoDB`);
      const all = store.read(collectionName);
      return processLocalAggregation(all, pipeline);
    }
  } catch (error) {
    logger.error(`Error aggregating ${collectionName}:`, error.message);
    return [];
  }
}

function processLocalAggregation(data, pipeline) {
  let result = [...data];
  for (const stage of pipeline) {
    const stageType = Object.keys(stage)[0];
    switch (stageType) {
      case '$match': {
        const filter = stage.$match;
        result = result.filter(item => matchesFilter(item, filter));
        break;
      }
      case '$count': {
        const fieldName = stage.$count;
        result = [{ [fieldName]: result.length }];
        break;
      }
      case '$group': {
        logger.warn('$group aggregation on local storage has limited support');
        break;
      }
      default:
        logger.warn(`Unsupported aggregation stage: ${stageType}`);
    }
  }
  return result;
}

async function findWithOptions(collectionName, filter = {}, options = {}) {
  await initializeDatabase();
  const { limit = 50, skip = 0, sort = {} } = options;
  try {
    if (dbType === 'mongodb') {
      const collection = mongodb.collection(collectionName);
      let query = collection.find(filter);
      if (Object.keys(sort).length > 0) {
        query = query.sort(sort);
      }
      return await query.skip(skip).limit(limit).toArray();
    } else {
      let all = store.read(collectionName);
      if (Object.keys(filter).length > 0) {
        all = all.filter(item => matchesFilter(item, filter));
      }
      if (Object.keys(sort).length > 0) {
        all = all.sort((a, b) => {
          for (const [field, direction] of Object.entries(sort)) {
            const aVal = a[field];
            const bVal = b[field];
            let comparison = 0;
            if (aVal < bVal) {
              comparison = -1;
            } else if (aVal > bVal) {
              comparison = 1;
            }
            if (comparison !== 0) {
              return direction === -1 ? -comparison : comparison;
            }
          }
          return 0;
        });
      }
      return all.slice(skip, skip + limit);
    }
  } catch (error) {
    logger.error(`Error finding in ${collectionName}:`, error.message);
    return [];
  }
}

/**
 * Write data and verify it was persisted correctly
 * This ensures data is actually stored in the database, not just in memory
 * @param {string} collectionName - Name of collection
 * @param {Object} data - Data to write
 * @returns {Promise<Object>} The verified data read back from database
 */
async function writeAndVerify(collectionName, data) {
  await initializeDatabase();
  try {
    // Write the data
    await write(collectionName, data);

    // Read it back to verify persistence
    const verified = await read(collectionName);

    // Return structured result with verification status
    return {
      success: true,
      verified: true,
      data: verified,
    };
  } catch (error) {
    logger.error(`Error in writeAndVerify for ${collectionName}:`, error.message);
    return {
      success: false,
      verified: false,
      error: error.message,
    };
  }
}

/**
 * Check if MongoDB connection is healthy
 * @returns {Promise<boolean>} True if connected and responsive
 */
async function checkMongoConnection() {
  try {
    if (!mongodb) {
      return false;
    }
    await mongodb.admin().ping();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get current database backend status
 * @returns {Promise<Object>} Status object with backend type and connection state
 */
async function getStatus() {
  const mongoConfigured = process.env.MONGODB_URI ? 'configured' : 'not configured';

  return {
    backend: dbType || 'not initialized',
    connected: dbType === 'mongodb' ? await checkMongoConnection() : true,
    database: mongoConfigured,
  };
}

module.exports = {
  initializeDatabase,
  read,
  write,
  writeAndVerify,
  find,
  findOne,
  updateOne,
  insertOne,
  deleteOne,
  uid,
  getDatabaseType,
  getDatabaseStatus,
  getQueryMetrics,
  resetQueryMetrics,
  validateDocument,
  withPerformanceTracking,
  count,
  aggregate,
  findWithOptions,
  getStatus,
};
