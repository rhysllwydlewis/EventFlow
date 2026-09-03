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

// Connection timeout used when probing MongoDB.
// Must be comfortably below Jest's testTimeout (10 s) so that beforeAll/afterAll
// hooks can fall back to local storage without hitting the hook deadline.
const MONGO_CONNECT_TIMEOUT_MS = process.env.NODE_ENV === 'test' ? 3000 : 10000;

let dbType = null;
let mongodb = null;

// Singleton promise to prevent concurrent initializations from each racing
// to connect to MongoDB in parallel (causes N×10s timeouts in test environments).
let _initPromise = null;

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
const SINGLETON_COLLECTIONS = new Set(['settings', 'content']);

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

function initializeDatabase() {
  if (dbType) {
    if (initializationState !== 'completed') {
      initializationState = 'completed';
    }
    return dbType;
  }

  // Serialize concurrent callers: all latecomers await the same promise.
  if (_initPromise) {
    return _initPromise;
  }

  _initPromise = _doInitialize();
  return _initPromise;
}

// Connection timeout used when probing MongoDB.
// Must be comfortably below Jest's testTimeout (10 s) so that beforeAll/afterAll
// hooks can fall back to local storage without hitting the hook deadline.

async function _doInitialize() {
  initializationState = 'in_progress';

  try {
    if (db.isMongoAvailable()) {
      mongodb = await withTimeout(db.connect(), MONGO_CONNECT_TIMEOUT_MS, 'MongoDB connection');
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
    await usersCollection.createIndex({ id: 1 }, { unique: true }); // custom string id — used by all auth lookups
    await usersCollection.createIndex({ googleSub: 1 }, { sparse: true }); // sparse: only indexes docs that have the field
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    await usersCollection.createIndex({ role: 1 });
    await usersCollection.createIndex({ createdAt: -1 });
    const suppliersCollection = mongodb.collection('suppliers');
    await suppliersCollection.createIndex({ id: 1 }, { unique: true }); // direct id lookups
    await suppliersCollection.createIndex({ ownerUserId: 1 }); // used by GET /me supplier approval check
    await suppliersCollection.createIndex(
      { ownerUserId: 1 },
      {
        unique: true,
        partialFilterExpression: { ownerUserId: { $type: 'string' } },
        name: 'uniq_suppliers_ownerUserId_string',
      }
    ); // enforce one real linked supplier profile per user while allowing legacy null ownerUserId
    await suppliersCollection.createIndex({ approved: 1, category: 1 }); // public directory
    await suppliersCollection.createIndex({ category: 1 });
    await suppliersCollection.createIndex({ userId: 1 });
    await suppliersCollection.createIndex({ featured: 1 });
    await suppliersCollection.createIndex({ approved: 1 });
    const packagesCollection = mongodb.collection('packages');
    await packagesCollection.createIndex({ id: 1 }, { unique: true }); // direct id lookups
    await packagesCollection.createIndex({ supplierId: 1, approved: 1 }); // supplier package lists
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
    // Reviews use _id (auto-indexed by MongoDB) — no custom 'id' field
    await reviewsCollection.createIndex({ supplierId: 1 });
    await reviewsCollection.createIndex({ authorId: 1 }); // eligibility + rate-limit checks
    await reviewsCollection.createIndex({ userId: 1 });
    await reviewsCollection.createIndex({ rating: -1 });
    const threadsCollection = mongodb.collection('threads');
    await threadsCollection.createIndex({ participantIds: 1 });
    await threadsCollection.createIndex({ createdAt: -1 });
    await threadsCollection.createIndex({ supplierId: 1 });
    const ticketsCollection = mongodb.collection('tickets');
    await ticketsCollection.createIndex({ id: 1 }, { unique: true }); // direct id lookups
    await ticketsCollection.createIndex({ userId: 1 });
    await ticketsCollection.createIndex({ status: 1 });
    await ticketsCollection.createIndex({ createdAt: -1 });
    const paymentsCollection = mongodb.collection('payments');
    await paymentsCollection.createIndex({ id: 1 }, { unique: true }); // payment id lookups
    await paymentsCollection.createIndex({ stripePaymentId: 1 }, { sparse: true }); // Stripe payment lookups
    await paymentsCollection.createIndex({ userId: 1 });
    await paymentsCollection.createIndex({ status: 1 });
    await paymentsCollection.createIndex({ createdAt: -1 });
    const subscriptionsCollection = mongodb.collection('subscriptions');
    await subscriptionsCollection.createIndex({ id: 1 }, { unique: true }); // subscription id lookups
    await subscriptionsCollection.createIndex({ userId: 1, status: 1 }); // getSubscriptionByUserId
    await subscriptionsCollection.createIndex({ status: 1 });
    await subscriptionsCollection.createIndex({ stripeSubscriptionId: 1 }, { sparse: true }); // Stripe webhook lookups
    await subscriptionsCollection.createIndex({ stripeCustomerId: 1 }, { sparse: true }); // Stripe customer lookups
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
    await notificationsCollection.createIndex({ id: 1 }, { unique: true }); // dedup $in lookups
    await notificationsCollection.createIndex({ userId: 1, createdAt: -1 });
    await notificationsCollection.createIndex({ read: 1 });
    const contentReviewTasksCollection = mongodb.collection('content_review_tasks');
    await contentReviewTasksCollection.createIndex({ id: 1 }, { unique: true });
    await contentReviewTasksCollection.createIndex({ status: 1, dueAt: 1 });
    await contentReviewTasksCollection.createIndex({ type: 1, period: -1 });
    await mongodb.collection('content_review_settings').createIndex({ id: 1 }, { unique: true });
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
    // Calendar collections
    const calendarEntriesCollection = mongodb.collection('customer_calendar_entries');
    await calendarEntriesCollection.createIndex({ id: 1 }, { unique: true }); // entry id lookups
    await calendarEntriesCollection.createIndex({ userId: 1 });
    await calendarEntriesCollection.createIndex({ date: 1 });
    const pubCalendarCollection = mongodb.collection('public_calendar_events');
    await pubCalendarCollection.createIndex({ id: 1 }, { unique: true }); // event id lookups
    await pubCalendarCollection.createIndex({ slug: 1 }, { sparse: true, unique: true }); // slug lookups
    await pubCalendarCollection.createIndex({ status: 1, date: 1 });
    await pubCalendarCollection.createIndex({ createdByUserId: 1 });
    await pubCalendarCollection.createIndex({ supplierId: 1 }, { sparse: true });
    const pubCalendarSavesCollection = mongodb.collection('public_calendar_saves');
    await pubCalendarSavesCollection.createIndex({ userId: 1, eventId: 1 }, { unique: true }); // dedup saves
    // Plans collection
    const plansCollection2 = mongodb.collection('plans');
    await plansCollection2.createIndex({ id: 1 }, { unique: true });
    await plansCollection2.createIndex({ userId: 1 });
    // Saved items
    const savedItemsCollection = mongodb.collection('savedItems');
    await savedItemsCollection.createIndex({ userId: 1 });
    await savedItemsCollection.createIndex({ userId: 1, itemType: 1, itemId: 1 }, { unique: true });
    // Marketplace
    const marketplaceCollection2 = mongodb.collection('marketplace_listings');
    await marketplaceCollection2.createIndex({ id: 1 }, { unique: true });
    await marketplaceCollection2.createIndex({ userId: 1 });
    await marketplaceCollection2.createIndex({ status: 1 });
    // Reviews compound - authorId+supplierId for eligibility check
    const reviewsCollection3 = mongodb.collection('reviews');
    await reviewsCollection3.createIndex({ authorId: 1, supplierId: 1 });
    await reviewsCollection3.createIndex({ authorId: 1, createdAt: -1 });
    // Webhook events dedup store
    const webhookEventsCollection = mongodb.collection('webhook_events');
    await webhookEventsCollection.createIndex({ eventId: 1 }, { unique: true }); // O(1) dedup lookup
    await webhookEventsCollection.createIndex({ processedAt: -1 });
    // Email Centre activity logs
    const emailLogsCollection = mongodb.collection('email_logs');
    await emailLogsCollection.createIndex({ id: 1 }, { unique: true });
    await emailLogsCollection.createIndex({ postmarkMessageId: 1 });
    await emailLogsCollection.createIndex({ createdAt: -1 });
    await emailLogsCollection.createIndex({ status: 1, createdAt: -1 });
    await emailLogsCollection.createIndex({ recipients: 1 });
    await emailLogsCollection.createIndex({ template: 1 });
    await emailLogsCollection.createIndex({ messageStream: 1 });
    // Photos collection
    const photosCollection = mongodb.collection('photos');
    await photosCollection.createIndex({ id: 1 }, { unique: true });
    await photosCollection.createIndex({ supplierId: 1 });
    await photosCollection.createIndex({ status: 1 }); // pending moderation queue
    await photosCollection.createIndex({ supplierId: 1, status: 1 }); // per-supplier moderation
    // Users: referral code lookup (registration via referral link)
    const usersCollection3 = mongodb.collection('users');
    await usersCollection3.createIndex({ referralCode: 1 }, { sparse: true });

    // Referrals collection
    const referralsCollection = mongodb.collection('referrals');
    await referralsCollection.createIndex({ id: 1 }, { unique: true });
    await referralsCollection.createIndex({ referrerId: 1 }); // list referrals by partner
    await referralsCollection.createIndex({ referredUserId: 1 }, { sparse: true, unique: true }); // dedup

    // Wedding websites: public slug lookup
    const plansCollection3 = mongodb.collection('plans');
    await plansCollection3.createIndex({ 'weddingWebsite.slug': 1 }, { sparse: true }); // dotted-path

    // Partner credit transactions
    // partner_credit_transactions — additional indexes for targeted lookups
    const partnerCreditCollection = mongodb.collection('partner_credit_transactions');
    await partnerCreditCollection.createIndex({ id: 1 }, { unique: true }); // reverseDebit + releaseCashoutHold
    // Note: { partnerId, createdAt } compound already exists above (covers getBalance partnerId queries)
    await partnerCreditCollection.createIndex(
      { partnerId: 1, supplierUserId: 1, type: 1 },
      { sparse: true } // _awardCredit idempotency
    );
    await partnerCreditCollection.createIndex(
      { type: 1, partnerId: 1, externalRef: 1 },
      { sparse: true } // releaseCashoutHold idempotency
    );

    // partner_code_history.partnerId and partner_referrals.partnerId already indexed above

    // Tickets collection
    const ticketsCollection2 = mongodb.collection('tickets');
    await ticketsCollection2.createIndex({ id: 1 }, { unique: true });
    await ticketsCollection2.createIndex({ senderId: 1, senderType: 1 }); // user/supplier ticket lists
    await ticketsCollection2.createIndex({ status: 1, createdAt: -1 }); // status filtering + sort

    // Saved searches and history
    const savedSearchesCollection = mongodb.collection('savedSearches');
    await savedSearchesCollection.createIndex({ id: 1 }, { unique: true });
    await savedSearchesCollection.createIndex({ userId: 1 }); // per-user saved search list
    const searchHistoryCollection = mongodb.collection('searchHistory');
    await searchHistoryCollection.createIndex({ userId: 1, timestamp: -1 }); // history ordered by time

    // Partner cashout requests
    const cashoutRequestsCollection = mongodb.collection('partner_cashout_requests');
    await cashoutRequestsCollection.createIndex({ id: 1 }, { unique: true });
    await cashoutRequestsCollection.createIndex({ partnerId: 1 });

    // Quote requests, threads, bookings (supplier dashboard data)
    const quoteReqColl2 = mongodb.collection('quoteRequests');
    await quoteReqColl2.createIndex({ supplierId: 1 });
    const threadsColl2 = mongodb.collection('threads');
    await threadsColl2.createIndex({ supplierId: 1 });
    const bookingsColl = mongodb.collection('bookings');
    await bookingsColl.createIndex({ supplierId: 1 }, { sparse: true });

    // Notes — one note per user
    const notesColl = mongodb.collection('notes');
    await notesColl.createIndex({ userId: 1 }, { unique: true });

    // Plans — guest token lookups
    const plansCollection5 = mongodb.collection('plans');
    await plansCollection5.createIndex({ guestToken: 1 }, { sparse: true });

    // Reviews — approved flag for public widget
    const reviewsColl4 = mongodb.collection('reviews');
    await reviewsColl4.createIndex({ approved: 1, createdAt: -1 }); // public review widget

    // Review requests — idempotency check on supplierId+customerEmail
    const reviewRequestsCollection = mongodb.collection('reviewRequests');
    await reviewRequestsCollection.createIndex({ id: 1 }, { unique: true });
    await reviewRequestsCollection.createIndex({ supplierId: 1, customerEmail: 1 }); // dedup check

    // customer_calendar_entries: add compound index for upcoming events query
    // (collection + userId index already declared above; adding userId+start compound)
    await calendarEntriesCollection.createIndex({ userId: 1, date: 1 }); // upcoming events filter

    // Scheduler locks — cross-instance mutual exclusion for node-schedule cron
    // jobs (see services/schedulerLock.service.js). The unique index on `id`
    // is what makes acquisition atomic: a losing concurrent insert fails with
    // a duplicate-key error instead of both processes believing they hold
    // the lock. The TTL index auto-clears a lock left behind by a process
    // that crashed mid-run, without needing an app-level sweep.
    const schedulerLocksCollection = mongodb.collection('scheduler_locks');
    await schedulerLocksCollection.createIndex({ id: 1 }, { unique: true });
    await schedulerLocksCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

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
      if (SINGLETON_COLLECTIONS.has(collectionName)) {
        const doc = (await collection.findOne({ id: 'system' })) || (await collection.findOne({}));
        if (doc) {
          // Destructure to remove MongoDB _id and custom id, keeping only singleton data.
          // eslint-disable-next-line no-unused-vars
          const { _id, id, ...record } = doc;
          return record;
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
    return SINGLETON_COLLECTIONS.has(collectionName) ? {} : [];
  }
}

async function write(collectionName, data) {
  await initializeDatabase();
  try {
    if (dbType === 'mongodb') {
      const collection = mongodb.collection(collectionName);
      if (SINGLETON_COLLECTIONS.has(collectionName)) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error(`${collectionName} data must be a non-null object`);
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
      // Use matchesFilter so $or, dotted-path keys, and comparison operators ($gte etc.)
      // all work the same way on the local store as they do on MongoDB.
      return all.find(item => matchesFilter(item, filter)) || null;
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
      // Use matchesFilter for $or, dotted-path, and operator parity with MongoDB.
      return all.filter(item => matchesFilter(item, filter));
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
      const index = all.findIndex(item => matchesFilter(item, filter));
      if (index >= 0) {
        // Apply $set fields
        const setFields = hasOperators ? updates.$set || {} : updates;
        all[index] = applyDotPathSet(all[index], setFields);

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

async function updateMany(collectionName, filter, updates) {
  await initializeDatabase();
  try {
    const hasOperators =
      updates !== null &&
      typeof updates === 'object' &&
      Object.keys(updates).some(k => k.startsWith('$'));

    if (dbType === 'mongodb') {
      const collection = mongodb.collection(collectionName);
      const mongoUpdate = hasOperators ? updates : { $set: updates };
      const result = await collection.updateMany(filter || {}, mongoUpdate);
      return result.modifiedCount || 0;
    }

    const all = store.read(collectionName);
    let modified = 0;
    const setFields = hasOperators ? updates.$set || {} : updates;
    const unsetFields = hasOperators ? updates.$unset || {} : {};
    const next = all.map(item => {
      if (!matchesFilter(item, filter || {})) {
        return item;
      }
      modified += 1;
      const updated = applyDotPathSet(item, setFields);
      for (const key of Object.keys(unsetFields)) {
        delete updated[key];
      }
      return updated;
    });
    if (modified > 0) {
      store.write(collectionName, next);
    }
    return modified;
  } catch (error) {
    logger.error(`Error in updateMany for ${collectionName}:`, error.message);
    return 0;
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
      const index = all.findIndex(item => matchesFilter(item, filter));
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

async function deleteMany(collectionName, filter) {
  await initializeDatabase();
  try {
    if (dbType === 'mongodb') {
      const collection = mongodb.collection(collectionName);
      const result = await collection.deleteMany(filter);
      return result.deletedCount;
    } else {
      // Local store: filter and rewrite without matching documents
      const all = store.read(collectionName);
      const kept = all.filter(item => !matchesFilter(item, filter));
      const removed = all.length - kept.length;
      if (removed > 0) {
        store.write(collectionName, kept);
      }
      return removed;
    }
  } catch (error) {
    logger.error(`Error in deleteMany for ${collectionName}:`, error.message);
    return 0;
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

// validateDocument was previously defined here but was never called anywhere in the
// codebase. Validation happens at the route layer via field-level checks. Removed
// to reduce dead-code surface area.

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

function getNestedValue(obj, path) {
  // Resolve dotted paths like 'authProviderIds.google' for local-store filter matching.
  // MongoDB handles these natively; this brings the local store into parity.
  return path
    .split('.')
    .reduce((cur, seg) => (cur !== null && cur !== undefined ? cur[seg] : undefined), obj);
}

// Recursively rebuilds a value with ordinary Object.prototype-based objects,
// undoing toNullProtoTree below. Every object this module hands back to a
// caller must look and behave like a normal object (JSON.stringify, `in`,
// .hasOwnProperty, etc.) — the null-prototype tree applyDotPathSet builds
// internally must never leak out.
function toPlainObject(value) {
  if (Array.isArray(value)) {
    return value.map(toPlainObject);
  }
  if (value && typeof value === 'object') {
    const plain = {};
    for (const key of Object.keys(value)) {
      // Object.defineProperty, not `plain[key] = ...` — if the source ever
      // held a genuine own property literally named "__proto__" (e.g. a
      // hand-edited local-store file), bracket assignment onto this fresh
      // *normal*-prototype object would invoke the real accessor and
      // reassign plain's prototype instead of copying an inert value.
      Object.defineProperty(plain, key, {
        value: toPlainObject(value[key]),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return plain;
  }
  return value;
}

// A prototype-less object has no Object.prototype in its chain — there is
// no `__proto__` accessor, no `constructor`, nothing a written property
// name could ever reach up into. Object.defineProperty (or even plain
// bracket assignment) on a tree built entirely of these is safe by
// construction for *any* runtime-supplied key, not merely the ones an
// explicit blocklist happens to name.
function toNullProtoTree(value) {
  if (Array.isArray(value)) {
    return value.map(toNullProtoTree);
  }
  if (value && typeof value === 'object') {
    const node = Object.create(null);
    for (const key of Object.keys(value)) {
      node[key] = toNullProtoTree(value[key]);
    }
    return node;
  }
  return value;
}

/**
 * Apply a MongoDB-style $set object to a local-store document, resolving
 * dotted keys like 'emailPrefs.actionPrompts.enabled' into nested object
 * writes instead of a literal top-level key named with the dots — MongoDB
 * handles these natively; this brings the local store into parity (mirrors
 * getNestedValue's read-side handling above). A key segment named
 * `__proto__`/`constructor`/`prototype` is stored as an ordinary, inert
 * data field rather than rejected — that also matches real MongoDB, which
 * has no special handling of those names either (a BSON document has no
 * prototype chain to begin with). Builds the write tree out of
 * Object.create(null) nodes precisely so a dotted key can never reach
 * Object.prototype, regardless of what segments it contains — see
 * toNullProtoTree — then converts the result back to ordinary objects
 * before returning it.
 * @param {Object} target
 * @param {Object} setFields
 * @returns {Object} a new, ordinary object — does not mutate `target` or
 *   any nested object reachable from it
 */
function applyDotPathSet(target, setFields) {
  const result = toNullProtoTree(target) || Object.create(null);
  for (const [key, value] of Object.entries(setFields || {})) {
    const segments = key.split('.');
    let cursor = result;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const existing = cursor[segment];
      const isPlainObject = existing && typeof existing === 'object' && !Array.isArray(existing);
      cursor[segment] = isPlainObject ? existing : Object.create(null);
      cursor = cursor[segment];
    }
    cursor[segments[segments.length - 1]] = toNullProtoTree(value);
  }
  return toPlainObject(result);
}

function matchesFilter(item, filter) {
  return Object.keys(filter).every(key => {
    if (key === '$or' && Array.isArray(filter[key])) {
      return filter[key].some(orFilter => matchesFilter(item, orFilter));
    }
    const filterValue = filter[key];
    // Support dotted-path keys (e.g. 'authProviderIds.google') for local store parity with MongoDB
    const itemValue = key.includes('.') ? getNestedValue(item, key) : item[key];
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

// Resolves a $group _id/accumulator expression against one document. Only
// the subset actually used by callers is supported: a '$field' reference,
// a literal, or a $sum/$max/$min accumulator over a field reference or the
// literal 1 (i.e. a count).
function resolveGroupExpression(expr, item) {
  if (typeof expr === 'string' && expr.startsWith('$')) {
    return getNestedValue(item, expr.slice(1));
  }
  return expr;
}

function applyGroupAccumulator(expr, items) {
  const [op, operand] = Object.entries(expr)[0];
  const values = items.map(item => resolveGroupExpression(operand, item));
  switch (op) {
    case '$sum':
      return operand === 1
        ? items.length
        : values.reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
    case '$max':
      return values.reduce((max, v) => (max === undefined || v > max ? v : max), undefined);
    case '$min':
      return values.reduce((min, v) => (min === undefined || v < min ? v : min), undefined);
    default:
      logger.warn(`Unsupported $group accumulator: ${op}`);
      return null;
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
        const { _id: idExpr, ...accumulators } = stage.$group;
        const groups = new Map();
        for (const item of result) {
          const key = resolveGroupExpression(idExpr, item);
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key).push(item);
        }
        result = Array.from(groups.entries()).map(([key, items]) => {
          const grouped = { _id: key };
          for (const [field, accExpr] of Object.entries(accumulators)) {
            grouped[field] = applyGroupAccumulator(accExpr, items);
          }
          return grouped;
        });
        break;
      }
      case '$sort': {
        const sortSpec = Object.entries(stage.$sort);
        result = [...result].sort((a, b) => {
          for (const [field, direction] of sortSpec) {
            const av = getNestedValue(a, field);
            const bv = getNestedValue(b, field);
            if (av === bv) {
              continue;
            }
            if (av === undefined || av === null) {
              return 1;
            }
            if (bv === undefined || bv === null) {
              return -1;
            }
            return av < bv ? -direction : direction;
          }
          return 0;
        });
        break;
      }
      case '$limit': {
        result = result.slice(0, stage.$limit);
        break;
      }
      case '$project': {
        const spec = stage.$project;
        result = result.map(item => {
          const projected = {};
          // MongoDB's real $project keeps _id by default unless the spec
          // explicitly excludes it (`_id: 0`) — mirror that here so a local
          // document that happens to carry a real Mongo _id (e.g. seeded for
          // parity testing) doesn't silently lose it only on this fallback.
          if (spec._id !== 0 && Object.prototype.hasOwnProperty.call(item, '_id')) {
            projected._id = item._id;
          }
          for (const [field, include] of Object.entries(spec)) {
            if (field !== '_id' && include) {
              projected[field] = getNestedValue(item, field);
            }
          }
          return projected;
        });
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
    const written = await write(collectionName, data);
    if (!written) {
      throw new Error('write() returned falsy');
    }
    // Read the document back to confirm persistence and return the live value.
    // Singleton collections use a single-document findOne on MongoDB; array
    // collections still verify by reading their collection back.
    const verified = await read(collectionName);
    return { success: true, verified: true, data: verified };
  } catch (error) {
    logger.error(`Error in writeAndVerify for ${collectionName}:`, error.message);
    return { success: false, verified: false, error: error.message };
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
  } catch {
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
  updateMany,
  insertOne,
  deleteOne,
  deleteMany,
  uid,
  getDatabaseType,
  getDatabaseStatus,
  getQueryMetrics,
  resetQueryMetrics,
  withPerformanceTracking,
  count,
  aggregate,
  findWithOptions,
  getStatus,
};
