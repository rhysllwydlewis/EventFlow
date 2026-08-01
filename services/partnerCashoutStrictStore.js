'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const indexService = require('./partnerCashoutOperationsIndexService');

function storageUnavailableError(message) {
  const error = new Error(message || 'Authoritative partner cashout storage is unavailable.');
  error.code = 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE';
  return error;
}

function isDuplicateKey(error) {
  return error?.code === 11000 || /E11000|duplicate key/i.test(String(error?.message || ''));
}

function throwStorageFailure(operation, collectionName, error) {
  if (isDuplicateKey(error)) throw error;
  logger.error('[PARTNER-CASHOUT-STORE] Authoritative MongoDB operation failed', {
    operation,
    collection: collectionName,
    error: error?.message,
    code: error?.code,
  });
  throw storageUnavailableError(`Authoritative cashout storage ${operation} failed.`);
}

async function ensureAuthoritative() {
  try {
    await dbUnified.initializeDatabase();
    const backend = dbUnified.getDatabaseType();

    if (backend === 'mongodb') {
      await indexService.ensureIndexes();
      const { getDb } = require('../db');
      const db = await getDb();
      return { backend, authoritative: true, db };
    }

    if (process.env.NODE_ENV === 'production') {
      throw storageUnavailableError(
        'Partner cashout safety controls require MongoDB in production; local fallback storage is not authoritative.'
      );
    }

    return { backend, authoritative: false, db: null };
  } catch (error) {
    if (error?.code === 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE') throw error;
    logger.error('[PARTNER-CASHOUT-STORE] Authoritative cashout storage bootstrap failed', {
      error: error?.message,
      code: error?.code,
    });
    throw storageUnavailableError('Authoritative cashout storage could not be initialised.');
  }
}

async function withContext(work) {
  const context = await ensureAuthoritative();
  return work(context);
}

async function findOne(collectionName, query = {}) {
  return withContext(async context => {
    if (context.backend === 'mongodb') {
      try {
        return await context.db.collection(collectionName).findOne(query);
      } catch (error) {
        return throwStorageFailure('read', collectionName, error);
      }
    }
    return dbUnified.findOne(collectionName, query);
  });
}

async function find(collectionName, query = {}) {
  return withContext(async context => {
    if (context.backend === 'mongodb') {
      try {
        return await context.db.collection(collectionName).find(query).toArray();
      } catch (error) {
        return throwStorageFailure('query', collectionName, error);
      }
    }
    return dbUnified.find(collectionName, query);
  });
}

async function read(collectionName) {
  return find(collectionName, {});
}

async function insertOne(collectionName, document) {
  return withContext(async context => {
    if (context.backend === 'mongodb') {
      try {
        const result = await context.db.collection(collectionName).insertOne(document);
        if (!result.acknowledged) {
          throw storageUnavailableError(`Insert into ${collectionName} was not acknowledged.`);
        }
        return document;
      } catch (error) {
        if (error?.code === 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE') throw error;
        return throwStorageFailure('insert', collectionName, error);
      }
    }
    return dbUnified.insertOne(collectionName, document);
  });
}

async function updateOne(collectionName, query, update) {
  return withContext(async context => {
    if (context.backend === 'mongodb') {
      try {
        const result = await context.db.collection(collectionName).updateOne(query, update);
        return result.matchedCount > 0;
      } catch (error) {
        return throwStorageFailure('update', collectionName, error);
      }
    }
    return dbUnified.updateOne(collectionName, query, update);
  });
}

async function deleteOne(collectionName, query) {
  return withContext(async context => {
    if (context.backend === 'mongodb') {
      try {
        const result = await context.db.collection(collectionName).deleteOne(query);
        return result.deletedCount > 0;
      } catch (error) {
        return throwStorageFailure('delete', collectionName, error);
      }
    }
    return dbUnified.deleteOne(collectionName, query);
  });
}

async function findWithOptions(collectionName, query = {}, options = {}) {
  return withContext(async context => {
    if (context.backend === 'mongodb') {
      try {
        let cursor = context.db.collection(collectionName).find(query);
        if (options.sort) cursor = cursor.sort(options.sort);
        if (Number.isInteger(options.skip) && options.skip > 0) cursor = cursor.skip(options.skip);
        if (Number.isInteger(options.limit) && options.limit > 0)
          cursor = cursor.limit(options.limit);
        return await cursor.toArray();
      } catch (error) {
        return throwStorageFailure('paged query', collectionName, error);
      }
    }
    return dbUnified.findWithOptions(collectionName, query, options);
  });
}

async function count(collectionName, query = {}) {
  return withContext(async context => {
    if (context.backend === 'mongodb') {
      try {
        return await context.db.collection(collectionName).countDocuments(query);
      } catch (error) {
        return throwStorageFailure('count', collectionName, error);
      }
    }
    return dbUnified.count(collectionName, query);
  });
}

module.exports = {
  ensureAuthoritative,
  findOne,
  find,
  read,
  insertOne,
  updateOne,
  deleteOne,
  findWithOptions,
  count,
  isDuplicateKey,
  _test: {
    storageUnavailableError,
    isDuplicateKey,
    throwStorageFailure,
  },
};
