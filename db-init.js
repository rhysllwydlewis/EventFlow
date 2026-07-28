/**
 * Database Initialization
 * Ensures all required collections exist with proper indexes
 */

'use strict';
const logger = require('./utils/logger');

const { getDb } = require('./db');
const { initializeCollections, createIndexes } = require('./models');

const REWARD_TYPES = [
  'PACKAGE_BONUS',
  'SUBSCRIPTION_BONUS',
  'REFERRAL_SIGNUP_BONUS',
  'FIRST_REVIEW_BONUS',
];

const ADDITIONAL_COLLECTIONS = [
  {
    name: 'reviews',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      { keys: { supplierId: 1 }, options: {} },
      { keys: { userId: 1 }, options: {} },
      { keys: { approved: 1 }, options: {} },
      { keys: { rating: 1 }, options: {} },
      { keys: { createdAt: -1 }, options: {} },
    ],
  },
  {
    name: 'reports',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      { keys: { type: 1 }, options: {} },
      { keys: { targetId: 1 }, options: {} },
      { keys: { reportedBy: 1 }, options: {} },
      { keys: { status: 1 }, options: {} },
      { keys: { createdAt: -1 }, options: {} },
    ],
  },
  {
    name: 'audit_logs',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      { keys: { adminId: 1 }, options: {} },
      { keys: { action: 1 }, options: {} },
      { keys: { targetType: 1 }, options: {} },
      { keys: { targetId: 1 }, options: {} },
      { keys: { timestamp: -1 }, options: {} },
    ],
  },
  {
    name: 'search_history',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      { keys: { userId: 1 }, options: {} },
      { keys: { query: 1 }, options: {} },
      { keys: { createdAt: -1 }, options: {} },
    ],
  },
  {
    name: 'partners',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      { keys: { userId: 1 }, options: { unique: true } },
      { keys: { refCode: 1 }, options: { unique: true } },
      { keys: { status: 1 }, options: {} },
      { keys: { createdAt: -1 }, options: {} },
    ],
  },
  {
    name: 'partner_referrals',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      { keys: { supplierUserId: 1 }, options: { unique: true } },
      { keys: { partnerId: 1 }, options: {} },
      { keys: { attributionExpiresAt: 1 }, options: {} },
      { keys: { createdAt: -1 }, options: {} },
    ],
  },
  {
    name: 'partner_credit_transactions',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      { keys: { partnerId: 1 }, options: {} },
      {
        keys: { partnerId: 1, supplierUserId: 1, type: 1 },
        options: {
          name: 'uniq_partner_reward_milestone',
          unique: true,
          partialFilterExpression: {
            supplierUserId: { $type: 'string' },
            type: { $in: REWARD_TYPES },
          },
        },
      },
      {
        keys: { type: 1, externalRef: 1 },
        options: {
          name: 'uniq_partner_ledger_external_ref',
          unique: true,
          partialFilterExpression: { externalRef: { $type: 'string' } },
        },
      },
      { keys: { type: 1 }, options: {} },
      { keys: { createdAt: -1 }, options: {} },
    ],
  },
  {
    name: 'partner_cashout_requests',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      {
        keys: { idempotencyKey: 1, partnerId: 1 },
        options: {
          name: 'uniq_partner_cashout_idempotency',
          unique: true,
          partialFilterExpression: { idempotencyKey: { $type: 'string' } },
        },
      },
      { keys: { partnerId: 1, status: 1 }, options: {} },
      { keys: { createdAt: -1 }, options: {} },
    ],
  },
  {
    name: 'partner_abuse_events',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      { keys: { createdAt: -1 }, options: {} },
      { keys: { outcome: 1, createdAt: -1 }, options: {} },
      { keys: { expiresAtDate: 1 }, options: { expireAfterSeconds: 0 } },
      { keys: { ipHash: 1, createdAt: -1 }, options: {} },
      { keys: { subnetHash: 1, createdAt: -1 }, options: {} },
      { keys: { browserHash: 1, createdAt: -1 }, options: {} },
      { keys: { deviceNetworkHash: 1, createdAt: -1 }, options: {} },
      { keys: { deviceCookieHash: 1, createdAt: -1 }, options: {} },
      { keys: { canonicalEmailHash: 1, createdAt: -1 }, options: {} },
      { keys: { referralCodeHash: 1, createdAt: -1 }, options: {} },
      { keys: { phoneHash: 1, createdAt: -1 }, options: {} },
      { keys: { websiteHash: 1, createdAt: -1 }, options: {} },
      { keys: { companyNumberHash: 1, createdAt: -1 }, options: {} },
      { keys: { vatNumberHash: 1, createdAt: -1 }, options: {} },
      { keys: { companyPostcodeHash: 1, createdAt: -1 }, options: {} },
      { keys: { companyAddressHash: 1, createdAt: -1 }, options: {} },
    ],
  },
  {
    name: 'partner_abuse_overrides',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      { keys: { subjectHash: 1, scope: 1, createdAt: -1 }, options: {} },
      { keys: { retentionExpiresAtDate: 1 }, options: { expireAfterSeconds: 0 } },
      { keys: { createdAt: -1 }, options: {} },
    ],
  },
  {
    name: 'partner_abuse_appeals',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      { keys: { status: 1, createdAt: -1 }, options: {} },
      { keys: { emailIdentityHash: 1 }, options: {} },
      { keys: { expiresAtDate: 1 }, options: { expireAfterSeconds: 0 } },
    ],
  },
  {
    name: 'partner_fraud_assessments',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      {
        keys: { requestId: 1 },
        options: {
          name: 'uniq_partner_fraud_request',
          unique: true,
          partialFilterExpression: { requestId: { $type: 'string' } },
        },
      },
      { keys: { partnerId: 1, assessedAt: -1 }, options: {} },
      { keys: { riskLevel: 1 }, options: {} },
    ],
  },
];

async function initializeDatabase() {
  try {
    const db = await getDb();
    logger.info('Initializing database collections and indexes...');
    await initializeCollections(db);
    await createIndexes(db);
    const existingCollections = await db.listCollections().toArray();
    const existingNames = existingCollections.map(collection => collection.name);

    for (const collectionDef of ADDITIONAL_COLLECTIONS) {
      const { name, indexes } = collectionDef;
      if (!existingNames.includes(name)) {
        logger.info(`Creating collection: ${name}`);
        await db.createCollection(name);
      } else {
        logger.info(`Collection already exists: ${name}`);
      }
      if (indexes && indexes.length > 0) {
        const collection = db.collection(name);
        for (const index of indexes) {
          try {
            await collection.createIndex(index.keys, index.options);
            logger.info(
              `  ✓ Ensured index on ${name}: ${index.options.name || Object.keys(index.keys).join('_')}`
            );
          } catch (error) {
            if (error.code !== 85 && error.code !== 86) {
              logger.warn(`  ⚠ Could not create index on ${name}:`, error.message);
            }
          }
        }
      }
    }

    logger.info('✓ Database initialization complete');
    return true;
  } catch (error) {
    logger.error('✗ Database initialization failed:', error.message);
    throw error;
  }
}

async function getDatabaseStats() {
  try {
    const db = await getDb();
    const stats = await db.stats();
    const allCollections = [
      'users',
      'suppliers',
      'packages',
      'plans',
      'notes',
      'events',
      'threads',
      'messages',
      'reviews',
      'reports',
      'audit_logs',
      'search_history',
      'partners',
      'partner_referrals',
      'partner_credit_transactions',
      'partner_cashout_requests',
      'partner_fraud_assessments',
      'partner_abuse_events',
      'partner_abuse_overrides',
      'partner_abuse_appeals',
    ];
    const collectionStats = {};
    for (const collectionName of allCollections) {
      try {
        collectionStats[collectionName] = await db.collection(collectionName).countDocuments();
      } catch (_error) {
        collectionStats[collectionName] = 0;
      }
    }
    return {
      database: stats.db,
      collections: stats.collections,
      dataSize: stats.dataSize,
      indexSize: stats.indexSize,
      totalSize: stats.dataSize + stats.indexSize,
      collectionCounts: collectionStats,
    };
  } catch (error) {
    logger.error('Error getting database stats:', error.message);
    return null;
  }
}

module.exports = {
  initializeDatabase,
  getDatabaseStats,
  ADDITIONAL_COLLECTIONS,
  REWARD_TYPES,
};
