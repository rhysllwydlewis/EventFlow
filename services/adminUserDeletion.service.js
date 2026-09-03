'use strict';

const validator = require('validator');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const domainAdmin = require('../middleware/domain-admin');
const partnerService = require('./partnerService');
const catalogCache = require('./catalogCache');
const cache = require('../cache');

function emptySummary() {
  return {
    deletedUser: false,
    deletedSuppliers: 0,
    deletedPackages: 0,
    deletedPhotos: 0,
    deletedSupplierAnalytics: 0,
    deletedReviewRequests: 0,
    deletedPublicCalendarEvents: 0,
    deletedMarketplaceListings: 0,
    cleanedReferences: 0,
    anonymisedRecords: 0,
    deletedNewsletterSubscriptions: 0,
    deletedNotifications: 0,
    partnerSoftDeleted: false,
    supplierIds: [],
    deletedPackageIds: [],
    anonymisedCustomerRecords: 0,
    deletedCustomerPlans: 0,
    errors: [],
  };
}

function userIdOf(user) {
  return user && (user.id || (user._id ? String(user._id) : null));
}

function userDeleteTarget(user) {
  if (user && user.id) {
    return user.id;
  }
  if (user && user._id) {
    return { _id: user._id };
  }
  return user;
}

function resolveUser(userOrUserId) {
  if (userOrUserId && typeof userOrUserId === 'object') {
    return userOrUserId;
  }
  return dbUnified.findOne('users', { id: userOrUserId });
}

function assertCanDelete(user, actor, options = {}) {
  const targetId = userIdOf(user);
  const actorId = userIdOf(actor);
  if (!user) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (targetId && actorId && String(targetId) === String(actorId)) {
    const err = new Error('Cannot delete your own account');
    err.code = 'CANNOT_DELETE_SELF';
    err.status = 400;
    throw err;
  }
  if (
    user.isOwner === true ||
    user.role === 'owner' ||
    domainAdmin.isOwnerEmail(user.email || '')
  ) {
    const err = new Error('Cannot delete owner account');
    err.code = 'OWNER_ACCOUNT_PROTECTED';
    err.status = 403;
    throw err;
  }
  if (options.protectAdmins && user.role === 'admin') {
    const err = new Error('Cannot delete protected admin account');
    err.code = 'ADMIN_ACCOUNT_PROTECTED';
    err.status = 403;
    throw err;
  }
}

function matchesFilter(row, filter = {}) {
  return Object.keys(filter || {}).every(key => {
    const expected = filter[key];
    const actual = row && row[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if (Array.isArray(expected.$in)) {
        return expected.$in.includes(actual);
      }
      if (Object.prototype.hasOwnProperty.call(expected, '$ne')) {
        return actual !== expected.$ne;
      }
    }
    return actual === expected;
  });
}

async function findMany(collection, filter) {
  if (typeof dbUnified.find === 'function') {
    return dbUnified.find(collection, filter);
  }
  const rows = typeof dbUnified.read === 'function' ? await dbUnified.read(collection) : [];
  return (rows || []).filter(row => matchesFilter(row, filter));
}

async function invalidatePublicSupplierCaches() {
  const invalidated = { catalog: false, packageRoute: false, search: false };
  try {
    await catalogCache.invalidate();
    invalidated.catalog = true;
  } catch (err) {
    logger.warn('[adminUserDeletion] catalog cache invalidation failed:', err.message);
  }
  try {
    await cache.delPattern('search:*');
    invalidated.search = true;
  } catch (err) {
    logger.warn('[adminUserDeletion] search cache invalidation failed:', err.message);
  }
  try {
    // Route-local featured/spotlight caches live in routes/suppliers.js.
    const suppliersRoute = require('../routes/suppliers');
    if (typeof suppliersRoute.invalidatePackageCaches === 'function') {
      suppliersRoute.invalidatePackageCaches();
      invalidated.packageRoute = true;
    }
  } catch (err) {
    logger.warn('[adminUserDeletion] package route cache invalidation failed:', err.message);
  }
  return invalidated;
}

async function deleteManyCount(collection, filter) {
  if (typeof dbUnified.deleteMany === 'function') {
    const count = await dbUnified.deleteMany(collection, filter);
    return Number.isFinite(count) ? count : 0;
  }
  const rows = await findMany(collection, filter);
  let deleted = 0;
  for (const row of rows) {
    if (await dbUnified.deleteOne(collection, row.id || { _id: row._id })) {
      deleted += 1;
    }
  }
  return deleted;
}

async function updateManyCount(collection, filter, update) {
  if (typeof dbUnified.updateMany === 'function') {
    const count = await dbUnified.updateMany(collection, filter, update);
    return Number.isFinite(count) ? count : 0;
  }
  const rows = await findMany(collection, filter);
  let changed = 0;
  for (const row of rows) {
    if (await dbUnified.updateOne(collection, { id: row.id }, update)) {
      changed += 1;
    }
  }
  return changed;
}

async function cleanupSupplierOwnedDataForUser(user, options = {}) {
  const summary = emptySummary();
  const userId = userIdOf(user);
  if (!userId) {
    summary.errors.push('Missing target user id');
    return summary;
  }

  logger.info(`[adminUserDeletion] Starting supplier cascade cleanup for user ${userId}`);

  // ── Step 1: Discover all supplier profiles owned by this user ──────────────
  const supplierProfiles = await findMany('suppliers', { ownerUserId: userId });
  const supplierIds = supplierProfiles.map(s => s.id).filter(Boolean);
  summary.supplierIds = supplierIds;

  logger.info(
    `[adminUserDeletion] Found ${supplierProfiles.length} supplier profile(s) for user ${userId}: [${supplierIds.join(', ')}]`
  );

  // ── Step 2: Collect ALL package IDs BEFORE any deletions ───────────────────
  // We need the full set of IDs upfront so that savedItems / shortlists
  // cleanup is complete even after the packages themselves are gone.
  //
  // Two lookup strategies are combined and deduplicated:
  //   a) by supplierId  — the normal case
  //   b) by createdBy   — fallback for data where the supplier record was already
  //                       removed manually but packages were left behind
  const allPackageIdSet = new Set();

  if (supplierIds.length) {
    const supplierPackages = await findMany('packages', { supplierId: { $in: supplierIds } });
    supplierPackages.forEach(p => p.id && allPackageIdSet.add(p.id));
  }

  const orphanedByCreator = await findMany('packages', { createdBy: userId });
  orphanedByCreator.forEach(p => p.id && allPackageIdSet.add(p.id));

  const allPackageIds = [...allPackageIdSet];
  summary.deletedPackageIds = allPackageIds;

  logger.info(
    `[adminUserDeletion] Found ${allPackageIds.length} package(s) total for user ${userId}`
  );

  if (!supplierIds.length && !allPackageIds.length) {
    logger.info(`[adminUserDeletion] No supplier data found for user ${userId} — skipping`);
    await invalidatePublicSupplierCaches();
    return summary;
  }

  // ── Step 3: Delete packages and all supplier-scoped data ───────────────────
  // Delete packages using both filters so nothing is missed regardless of which
  // field is populated on a given document.
  if (allPackageIds.length) {
    summary.deletedPackages += await deleteManyCount('packages', {
      id: { $in: allPackageIds },
    });
  }

  if (!supplierIds.length) {
    // Only orphaned packages existed; caches still need flushing.
    await invalidatePublicSupplierCaches();
    return summary;
  }

  const supplierIdFilter = { $in: supplierIds };

  logger.info(
    `[adminUserDeletion] Deleting supplier-scoped data for suppliers [${supplierIds.join(', ')}]`
  );

  // Photos, analytics, review requests, calendar events, marketplace listings
  summary.deletedPhotos = await deleteManyCount('photos', { supplierId: supplierIdFilter });
  summary.deletedSupplierAnalytics = await deleteManyCount('supplierAnalytics', {
    supplierId: supplierIdFilter,
  });
  summary.deletedReviewRequests = await deleteManyCount('reviewRequests', {
    supplierId: supplierIdFilter,
  });
  summary.deletedPublicCalendarEvents = await deleteManyCount('public_calendar_events', {
    supplierId: supplierIdFilter,
  });
  summary.deletedMarketplaceListings = await deleteManyCount('marketplace_listings', {
    supplierId: supplierIdFilter,
  });

  // Remove customer-facing saved/list/plan references to deleted public packages/suppliers.
  summary.cleanedReferences += await deleteManyCount('savedItems', {
    supplierId: supplierIdFilter,
  });
  summary.cleanedReferences += await deleteManyCount('shortlists', {
    supplierId: supplierIdFilter,
  });
  if (allPackageIds.length) {
    summary.cleanedReferences += await deleteManyCount('savedItems', {
      packageId: { $in: allPackageIds },
    });
    summary.cleanedReferences += await deleteManyCount('shortlists', {
      packageId: { $in: allPackageIds },
    });
  }

  const anonymise = {
    $set: {
      supplierDeleted: true,
      supplierDeletedAt: options.now || new Date().toISOString(),
      supplierId: null,
    },
  };
  for (const collection of [
    'quoteRequests',
    'enquiries',
    'threads',
    'messages',
    'bookings',
    'reviews',
    'plans',
  ]) {
    summary.anonymisedRecords += await updateManyCount(
      collection,
      { supplierId: supplierIdFilter },
      anonymise
    );
  }

  summary.deletedSuppliers = await deleteManyCount('suppliers', { ownerUserId: userId });
  logger.info(
    `[adminUserDeletion] Cascade complete for user ${userId}: ` +
      `${summary.deletedSuppliers} supplier(s), ${summary.deletedPackages} package(s), ` +
      `${summary.deletedPhotos} photo(s), ${summary.cleanedReferences} reference(s) cleaned`
  );
  await invalidatePublicSupplierCaches();
  return summary;
}

async function cleanupCustomerOwnedDataForUser(user, options = {}) {
  const summary = emptySummary();
  const userId = userIdOf(user);
  if (!userId) {
    summary.errors.push('Missing target user id');
    return summary;
  }

  logger.info(`[adminUserDeletion] Starting customer cascade cleanup for user ${userId}`);

  const now = options.now || new Date().toISOString();
  const anonymise = {
    $set: {
      customerDeleted: true,
      customerDeletedAt: now,
    },
  };

  // quoteRequests: the requester is recorded as `userId` (see
  // routes/quote-requests.js — set on creation, matched on read/ownership
  // checks). The request still references the suppliers it was sent to, so
  // anonymise the customer's identity in place rather than deleting it.
  summary.anonymisedCustomerRecords += await updateManyCount(
    'quoteRequests',
    { userId },
    { $set: { ...anonymise.$set, userId: null, name: null, email: null, phone: null, notes: null } }
  );

  // enquiries + contact_enquiries: submitted via the two public contact
  // forms (routes/contact.js's /contact-supplier and /contact respectively)
  // and never linked to a logged-in user id — only `senderName`/
  // `senderEmail`(/`subject` for the general one) are stored. Both store
  // `senderEmail` through validator.normalizeEmail() (which rewrites Gmail
  // dots/+subaddresses and similar provider-specific rules), so match
  // against that same normalised form here too — a plain lowercase/trim
  // would miss e.g. "j.smith+wedding@gmail.com" against the stored
  // "jsmith@gmail.com".
  if (user.email) {
    const rawEmail = String(user.email).toLowerCase().trim();
    const normalisedEmail = validator.normalizeEmail(rawEmail) || rawEmail;
    const emailFilter =
      normalisedEmail === rawEmail
        ? { senderEmail: rawEmail }
        : { $or: [{ senderEmail: rawEmail }, { senderEmail: normalisedEmail }] };
    summary.anonymisedCustomerRecords += await updateManyCount('enquiries', emailFilter, {
      $set: { ...anonymise.$set, senderName: null, senderEmail: null, message: null },
    });
    summary.anonymisedCustomerRecords += await updateManyCount('contact_enquiries', emailFilter, {
      $set: {
        ...anonymise.$set,
        senderName: null,
        senderEmail: null,
        subject: null,
        message: null,
      },
    });
  }

  // threads: the customer side of a conversation is `customerId` (see
  // server.js legacy migration and services/reviewService.js). Anonymise
  // rather than delete since the supplier's side of the thread still exists.
  summary.anonymisedCustomerRecords += await updateManyCount(
    'threads',
    { customerId: userId },
    { $set: { ...anonymise.$set, customerId: null } }
  );

  // messages: the sender is `senderId`, with a legacy `fromUserId` alias
  // still present on older documents (see server.js's v1 migration, which
  // normalises `senderId: message.senderId || message.fromUserId`). Match
  // both so nothing is missed regardless of which field is populated.
  summary.anonymisedCustomerRecords += await updateManyCount(
    'messages',
    { $or: [{ senderId: userId }, { fromUserId: userId }] },
    { $set: { ...anonymise.$set, senderId: null, fromUserId: null, content: null, text: null } }
  );

  // bookings: the customer is `customerId` (see services/quoteBooking.service.js).
  // Anonymise rather than delete — the supplier's side of the booking (and
  // any payment/audit history) still needs to exist.
  summary.anonymisedCustomerRecords += await updateManyCount(
    'bookings',
    { customerId: userId },
    { $set: { ...anonymise.$set, customerId: null } }
  );

  // reviews: the author is `authorId` (see services/reviewService.js,
  // models/Review.js). Sever the link to the deleted account but keep the
  // review itself, matching how the supplier-side cascade above only clears
  // `supplierId` rather than deleting the review outright.
  summary.anonymisedCustomerRecords += await updateManyCount(
    'reviews',
    { authorId: userId },
    { $set: { ...anonymise.$set, authorId: null } }
  );

  // plans: solely owned by the customer (see routes/plans.js,
  // routes/plans-legacy.js, routes/wedding-websites.js — all keyed by
  // `userId`, with no supplier or other party referencing the record), so
  // unlike the other collections above these are hard-deleted rather than
  // anonymised.
  summary.deletedCustomerPlans = await deleteManyCount('plans', { userId });

  logger.info(
    `[adminUserDeletion] Customer cascade complete for user ${userId}: ` +
      `${summary.anonymisedCustomerRecords} record(s) anonymised, ` +
      `${summary.deletedCustomerPlans} plan(s) deleted`
  );
  return summary;
}

function mergeSummaries(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (typeof value === 'number') {
      target[key] = (target[key] || 0) + value;
    } else if (Array.isArray(value)) {
      target[key] = [...(target[key] || []), ...value];
    } else if (typeof value === 'boolean') {
      target[key] = target[key] || value;
    }
  }
  return target;
}

async function deleteUserAndOwnedData(userOrUserId, actor, options = {}) {
  const user = await resolveUser(userOrUserId);
  assertCanDelete(user, actor, options);
  const summary = emptySummary();
  const targetId = userIdOf(user);

  try {
    // Cancel any live Stripe subscription first. Without this, deleting a
    // paying supplier's account leaves Stripe billing a user record that no
    // longer exists, with nobody left to notice or self-serve a cancellation.
    try {
      const subscriptionService = require('./subscriptionService');
      await subscriptionService.cancelSubscriptionForAccountDeletion(targetId);
    } catch (subErr) {
      summary.errors.push(`subscription:${subErr.message}`);
      logger.warn(`Could not cancel subscription for user ${targetId}:`, subErr);
    }

    mergeSummaries(summary, await cleanupSupplierOwnedDataForUser(user, options));
    mergeSummaries(summary, await cleanupCustomerOwnedDataForUser(user, options));

    try {
      await partnerService.softDeletePartnerByUserId(targetId);
      summary.partnerSoftDeleted = true;
    } catch (partnerErr) {
      summary.errors.push(`partner:${partnerErr.message}`);
      logger.warn(`Could not soft-delete partner record for user ${targetId}:`, partnerErr);
    }

    // These live outside the supplier-owned-data cascade above — they're
    // tied to the account (by email or userId), not to a supplier profile —
    // and were previously never cleaned up by either deletion path, leaving
    // an orphaned newsletter subscription and stale notifications behind.
    if (user.email) {
      try {
        summary.deletedNewsletterSubscriptions = await deleteManyCount('newsletterSubscribers', {
          email: String(user.email).toLowerCase().trim(),
        });
      } catch (newsletterErr) {
        summary.errors.push(`newsletter:${newsletterErr.message}`);
        logger.warn(
          `Could not remove newsletter subscription for user ${targetId}:`,
          newsletterErr
        );
      }
    }
    try {
      summary.deletedNotifications = await deleteManyCount('notifications', { userId: targetId });
    } catch (notifErr) {
      summary.errors.push(`notifications:${notifErr.message}`);
      logger.warn(`Could not remove notifications for user ${targetId}:`, notifErr);
    }

    summary.deletedUser = await dbUnified.deleteOne('users', userDeleteTarget(user));
    if (!summary.deletedUser) {
      throw new Error(`Failed to delete user ${targetId}`);
    }
    return summary;
  } catch (err) {
    summary.errors.push(err.message);
    err.summary = summary;
    throw err;
  }
}

module.exports = {
  deleteUserAndOwnedData,
  cleanupSupplierOwnedDataForUser,
  cleanupCustomerOwnedDataForUser,
  invalidatePublicSupplierCaches,
  emptySummary,
  mergeSummaries,
};
