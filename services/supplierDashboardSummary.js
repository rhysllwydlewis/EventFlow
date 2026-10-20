/**
 * Supplier dashboard summary
 *
 * Assembles the response of GET /api/supplier/dashboard-summary: one call that
 * gives the supplier dashboard every headline number it shows, computed from
 * real records. See docs/SUPPLIER_DASHBOARD_DATA.md for the contract.
 *
 * Rules this module holds to:
 *   - `null` means "not enough data" (or the source was unavailable); a zero is
 *     only ever a real zero. No flattering defaults such as 0 or 100.
 *   - Only the signed-in supplier's own records are read. Every query is keyed by
 *     the supplier id or the owner's user id taken from the authenticated session.
 *   - Each block is fetched independently. If one source fails the block is
 *     reported as unavailable (and named in `unavailable`) instead of silently
 *     becoming zeros, and the remaining blocks are still returned.
 *   - No external service (Stripe) is called on this path.
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { resolveAnalyticsWindow } = require('../utils/analyticsWindow');
const { hydrateSupplierProfilePhoto } = require('../utils/supplierProfilePhoto');
const { addPublicProfilePath } = require('../utils/publicSupplierProfilePath');
const { isPlaceholderImage } = require('../utils/packageImageUtils');
const { getPlanFeatures } = require('../models/Subscription');
const {
  normaliseState,
  VERIFICATION_STATES,
} = require('../utils/supplierVerificationStateMachine');
const { computeProfileCompleteness } = require('./supplierProfileCompleteness');
const { getEngagementMetrics, getMessagingSummary } = require('./supplierEngagementMetrics');
const { evaluateNextSteps } = require('./supplierNextSteps');
const supplierAnalytics = require('../utils/supplierAnalytics');

const DEFAULT_SUMMARY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_LIMIT = 3;
const REVIEW_APPROVED = 'approved';
const REVIEW_PENDING = 'pending';

/**
 * Map the detailed verification state to the four-value `state` of the contract.
 *
 * `approved` on the supplier document is the flag the server actually enforces
 * (packages, messaging and public visibility all check it), so it wins. States
 * where the supplier has to act or contact support (changes requested, rejected,
 * suspended) are all reported as `rejected`; `status` keeps the detail.
 *
 * @param {boolean} approved - Whether supplier.approved === true
 * @param {string} status - Canonical state from the verification state machine
 * @returns {'unverified'|'pending'|'approved'|'rejected'} Contract state
 */
function toContractState(approved, status) {
  if (approved) {
    return 'approved';
  }
  switch (status) {
    case VERIFICATION_STATES.PENDING_REVIEW:
    case VERIFICATION_STATES.APPROVED:
      // A verified-but-not-approved record is waiting on the listing approval.
      return 'pending';
    case VERIFICATION_STATES.NEEDS_CHANGES:
    case VERIFICATION_STATES.REJECTED:
    case VERIFICATION_STATES.SUSPENDED:
      return 'rejected';
    default:
      return 'unverified';
  }
}

/**
 * Build the `verification` block.
 *
 * `emailVerified` is `users.verified`, the field every server-side gate reads
 * (requireVerifiedUser), not the looser flag /auth/me reports.
 *
 * @param {Object} supplier - Supplier document
 * @param {Object|null} ownerUser - The supplier owner's user document
 * @returns {Object} verification block
 */
function buildVerification(supplier, ownerUser) {
  const approved = supplier.approved === true;
  const status = normaliseState(supplier.verificationStatus, supplier.verified === true);
  const needsExplanation =
    status === VERIFICATION_STATES.NEEDS_CHANGES || status === VERIFICATION_STATES.REJECTED;
  return {
    emailVerified: Boolean(ownerUser && ownerUser.verified === true),
    approved,
    state: toContractState(approved, status),
    status,
    submittedAt: supplier.verificationSubmittedAt || null,
    reviewedAt: supplier.verifiedAt || supplier.rejectedAt || null,
    rejectionCount: Number(supplier.verificationRejectionCount) || 0,
    notes: needsExplanation ? supplier.verificationNotes || null : null,
  };
}

/**
 * Work out the supplier's plan, entitlements and subscription display fields
 * from the database alone (no Stripe call).
 *
 * @param {string} userId - The supplier owner's user id
 * @returns {Promise<Object>} subscription block (plus legacy keys)
 */
async function resolveSubscription(userId) {
  const subscriptionService = require('./subscriptionService');
  const subscription = await subscriptionService.getSubscriptionByUserId(userId);
  const live = subscriptionService.isLiveEntitlement(subscription);
  const plan = subscription
    ? live
      ? subscription.plan
      : 'free'
    : await subscriptionService.getFallbackUserTier(userId);
  const activeUntil = live ? subscription.currentPeriodEnd || subscription.trialEnd || null : null;
  const trialing = Boolean(subscription && subscription.status === 'trialing');
  return {
    plan,
    status: (subscription && subscription.status) || 'free',
    activeUntil,
    cancelAtPeriodEnd: subscription ? subscription.cancelAtPeriodEnd === true : false,
    limits: getPlanFeatures(plan).features,
    // Legacy keys kept for the previous dashboard.
    tier: plan,
    renewsAt: activeUntil,
    trialEndsAt: trialing ? subscription.trialEnd || null : null,
  };
}

/**
 * Classify a supplier's packages.
 *
 * `active` means live for customers (neither paused nor awaiting admin approval).
 * `countedTowardsLimit` is how the plan limit is enforced on create/unpause
 * (every package that is not paused), so "x of N" can be shown honestly.
 *
 * @param {Object[]} packages - Package documents for one supplier
 * @param {number|null} limit - Plan limit (-1 = unlimited, null = unknown)
 * @returns {Object} packages block
 */
function summarisePackages(packages, limit) {
  const counts = packages.reduce(
    (acc, pkg) => {
      if (pkg.paused === true) {
        acc.paused += 1;
      } else if (pkg.approved === false) {
        acc.awaitingApproval += 1;
      } else {
        acc.active += 1;
      }
      return acc;
    },
    { active: 0, awaitingApproval: 0, paused: 0 }
  );
  return {
    total: packages.length,
    active: counts.active,
    paused: counts.paused,
    awaitingApproval: counts.awaitingApproval,
    limit,
    countedTowardsLimit: counts.active + counts.awaitingApproval,
    // Legacy key kept for the previous dashboard.
    draft: counts.awaitingApproval,
  };
}

/**
 * Summarise reviews using the same rule as the public reviews panel: only
 * reviews whose moderation state is `approved` are shown or counted.
 *
 * @param {Object[]} reviews - Review documents for one supplier
 * @returns {{approvedCount: number, averageRating: (number|null), pendingCount: number}}
 */
function summariseReviews(reviews) {
  const approved = reviews.filter(review => review.moderation?.state === REVIEW_APPROVED);
  const pendingCount = reviews.filter(review => review.moderation?.state === REVIEW_PENDING).length;
  const ratings = approved
    .map(review => Number(review.rating))
    .filter(rating => Number.isFinite(rating) && rating >= 1 && rating <= 5);
  const averageRating =
    ratings.length > 0
      ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2))
      : null;
  return { approvedCount: approved.length, averageRating, pendingCount };
}

/**
 * Next three upcoming calendar items for the supplier, plus whether they have
 * any calendar activity at all (past or future).
 *
 * Sources are the supplier's own personal calendar entries and the public
 * calendar events they created. These are calendar entries, not bookings: the
 * platform has no booking records.
 *
 * @param {string} userId - The supplier owner's user id
 * @param {Date} now - Reference time
 * @returns {Promise<{upcoming: Object[], hasActivity: boolean}>}
 */
async function loadCalendar(userId, now) {
  const today = now.toISOString().slice(0, 10);
  const [entries, events] = await Promise.all([
    dbUnified.find('customer_calendar_entries', { userId }),
    dbUnified.find('public_calendar_events', { createdByUserId: userId }),
  ]);

  const personal = (entries || [])
    .filter(entry => typeof entry.date === 'string' && entry.date >= today)
    .map(entry => ({
      id: entry.id,
      title: entry.title,
      date: entry.date,
      time: entry.time || null,
      source: 'personal',
    }));

  const publicEvents = (events || [])
    .filter(event => !event.deleted && !event.isDeleted && !event.deletedAt)
    .filter(event => ['draft', 'pending_review', 'published'].includes(event.status || 'published'))
    .map(event => {
      const start = new Date(event.startDate);
      return Number.isNaN(start.getTime()) ? null : { event, start };
    })
    .filter(item => item !== null && item.start.toISOString().slice(0, 10) >= today)
    .map(({ event, start }) => ({
      id: event.id,
      title: event.title || 'Public event',
      date: start.toISOString().slice(0, 10),
      time: start.toISOString().slice(11, 16),
      source: 'public',
    }));

  const upcoming = [...personal, ...publicEvents]
    .sort((first, second) =>
      `${first.date}T${first.time || '00:00'}`.localeCompare(
        `${second.date}T${second.time || '00:00'}`
      )
    )
    .slice(0, UPCOMING_LIMIT);

  return {
    upcoming,
    hasActivity: (entries || []).length > 0 || (events || []).length > 0,
  };
}

/**
 * Empty `analytics` block used when the events source is unavailable.
 *
 * @returns {Object} Analytics block with null figures
 */
function unavailableAnalytics() {
  return {
    totalViews: null,
    totalEnquiries: null,
    responseRate: null,
    avgResponseTime: null,
    dailyData: [],
    viewsTrend: null,
    enquiriesTrend: null,
    responseTrend: null,
  };
}

/**
 * Percentage change from a previous value, or null when there is no baseline.
 *
 * @param {number} current - Current-period value
 * @param {number} previous - Previous-period value
 * @returns {number|null} Whole-number percentage change
 */
function percentChange(current, previous) {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
}

/**
 * Build the complete dashboard summary for one supplier.
 *
 * @param {Object} params - Inputs
 * @param {string} params.userId - Authenticated user id (the supplier owner)
 * @param {Object} params.supplier - The owner's supplier document
 * @param {number|null} [params.requestedDays] - Whole number of days asked for
 * @param {Date} [params.now] - Reference time (for tests)
 * @returns {Promise<Object>} Summary payload
 */
async function buildDashboardSummary({ userId, supplier, requestedDays = null, now = new Date() }) {
  const supplierId = supplier.id;
  const unavailable = [];

  /**
   * Run one source query; on failure record it and return the fallback.
   *
   * @param {string} label - Block name reported in `unavailable`
   * @param {Function} task - Async query
   * @param {*} fallback - Value to use if the query throws
   * @returns {Promise<*>} Query result or fallback
   */
  const attempt = async (label, task, fallback) => {
    try {
      return await task();
    } catch (error) {
      logger.error(`dashboard-summary: ${label} sub-query failed:`, error);
      unavailable.push(label);
      return fallback;
    }
  };

  // Phase 1: everything that does not depend on the analytics window.
  const [
    ownerUser,
    subscription,
    packageDocs,
    reviewDocs,
    profiles,
    tickets,
    requestCount,
    calendar,
  ] = await Promise.all([
    attempt('user', () => dbUnified.findOne('users', { id: userId }), null),
    attempt('subscription', () => resolveSubscription(userId), null),
    attempt('packages', () => dbUnified.find('packages', { supplierId }), null),
    attempt('reviews', () => dbUnified.find('reviews', { supplierId }), null),
    attempt('profile', () => dbUnified.find('suppliers', { ownerUserId: userId }), null),
    attempt(
      'tickets',
      () => dbUnified.find('tickets', { senderId: userId, senderType: 'supplier' }),
      null
    ),
    attempt(
      'reviewRequests',
      () => dbUnified.count('reviewRequests', { supplierId, status: { $ne: 'failed' } }),
      null
    ),
    attempt('calendar', () => loadCalendar(userId, now), null),
  ]);

  // Window: the plan decides how far back this supplier may look.
  const analyticsWindow = resolveAnalyticsWindow({
    requested: requestedDays,
    defaultDays: DEFAULT_SUMMARY_DAYS,
    planWindowDays: subscription ? subscription.limits.analyticsWindowDays : undefined,
  });
  const windowStart = new Date(now.getTime() - analyticsWindow.days * DAY_MS);
  const previousStart = new Date(windowStart.getTime() - analyticsWindow.days * DAY_MS);

  // Phase 2: window-bound figures.
  const [engagement, previousViews, messaging] = await Promise.all([
    attempt(
      'enquiries',
      () =>
        getEngagementMetrics({
          supplierId,
          ownerUserId: userId,
          days: analyticsWindow.days,
          now,
        }),
      null
    ),
    attempt(
      'viewsTrend',
      () =>
        dbUnified.count('events', {
          supplierId,
          type: supplierAnalytics.EVENT_TYPES.PROFILE_VIEW,
          timestamp: { $gte: previousStart.toISOString(), $lt: windowStart.toISOString() },
        }),
      null
    ),
    attempt('messages', () => getMessagingSummary(userId), null),
  ]);
  const analyticsBase = await attempt(
    'analytics',
    () =>
      supplierAnalytics.getSupplierAnalytics(supplierId, analyticsWindow.days, { now, engagement }),
    null
  );
  if (analyticsBase && analyticsBase.totalViews === null) {
    unavailable.push('views');
  }

  // --- Profile ---
  const hydrated = hydrateSupplierProfilePhoto(supplier, ownerUser);
  const completeness = computeProfileCompleteness(hydrated);
  const flagFor = id => completeness.checks.some(check => check.id === id && check.done);
  const publicProfilePath = addPublicProfilePath(supplier).publicProfilePath || null;
  const verification = buildVerification(supplier, ownerUser);

  const profile = {
    hasProfile: true,
    profileCount: profiles ? profiles.length : null,
    topProfileId: supplier.id || null,
    topProfileName: supplier.name || null,
    name: supplier.name || null,
    publicProfilePath,
    healthScore: completeness.score,
    isApproved: verification.approved,
    completionFlags: {
      hasLogo: flagFor('logo'),
      hasDescription: flagFor('description'),
      hasLocation: flagFor('location'),
      hasCoverImage: flagFor('coverImage'),
      hasGallery: flagFor('gallery'),
      hasSocialLinks: flagFor('socials'),
      hasWebsite: flagFor('website'),
    },
    completeness,
  };

  // --- Packages ---
  const planPackageLimit =
    subscription && Number.isFinite(subscription.limits.maxPackages)
      ? subscription.limits.maxPackages
      : null;
  const packages = packageDocs
    ? summarisePackages(packageDocs, planPackageLimit)
    : {
        total: null,
        active: null,
        paused: null,
        awaitingApproval: null,
        limit: planPackageLimit,
        countedTowardsLimit: null,
        draft: null,
      };

  // --- Reviews ---
  const reviewSummary = reviewDocs
    ? summariseReviews(reviewDocs)
    : { approvedCount: null, averageRating: null, pendingCount: null };
  const reviews = {
    ...reviewSummary,
    // Legacy keys kept for the previous dashboard.
    total: reviewSummary.approvedCount,
    pending: reviewSummary.pendingCount,
  };

  // --- Messages ---
  const messages = messaging
    ? {
        unreadMessages: messaging.unreadMessages,
        conversationsWithUnread: messaging.conversationsWithUnread,
        latestAt: messaging.latestAt,
        // Legacy keys kept for the previous dashboard.
        total: messaging.total,
        unread: messaging.conversationsWithUnread,
      }
    : {
        unreadMessages: null,
        conversationsWithUnread: null,
        latestAt: null,
        total: null,
        unread: null,
      };

  // --- Enquiries & responses ---
  const enquiries = engagement
    ? engagement.enquiries
    : {
        newThisPeriod: null,
        previousPeriod: null,
        sources: { conversations: null, quoteRequests: null, contactForm: null },
        truncated: false,
      };
  const responses = engagement
    ? engagement.responses
    : { sampleSize: null, matureSampleSize: null, repliedPct: null, medianMinutes: null };

  // --- Views & legacy analytics block ---
  const viewsKnown = Boolean(analyticsBase) && analyticsBase.totalViews !== null;
  const totalViews = viewsKnown ? analyticsBase.totalViews : null;
  const views = { total: totalViews, days: analyticsWindow.days, basis: 'page_loads' };
  let analytics = unavailableAnalytics();
  if (viewsKnown) {
    analytics = {
      totalViews,
      totalEnquiries: enquiries.newThisPeriod,
      responseRate: responses.repliedPct,
      avgResponseTime: engagement ? analyticsBase.avgResponseTime : null,
      dailyData: analyticsBase.dailyData.map(day => ({
        ...day,
        enquiries: engagement ? day.enquiries : null,
      })),
      viewsTrend: previousViews === null ? null : percentChange(totalViews, previousViews),
      enquiriesTrend: engagement
        ? percentChange(enquiries.newThisPeriod, enquiries.previousPeriod)
        : null,
      // Reply speed is not tracked per period, so there is no trend to show.
      responseTrend: null,
    };
  }

  // --- Tickets ---
  const ticketsBlock = tickets
    ? {
        total: tickets.length,
        open: tickets.filter(ticket => ticket.status === 'open').length,
        inProgress: tickets.filter(ticket => ticket.status === 'in_progress').length,
      }
    : { total: null, open: null, inProgress: null };

  // --- Next steps ---
  const nextSteps = evaluateNextSteps({
    supplier: hydrated,
    verification,
    completeness,
    packages: {
      total: packageDocs ? packageDocs.length : 0,
      withoutPhoto: packageDocs
        ? packageDocs.filter(pkg => isPlaceholderImage(pkg.image)).length
        : 0,
    },
    reviewRequestsSent: Number(requestCount) || 0,
    approvedReviewCount: reviewSummary.approvedCount || 0,
    hasCalendarActivity: Boolean(calendar && calendar.hasActivity),
  });

  return {
    window: analyticsWindow,
    verification,
    profile,
    packages,
    messages,
    enquiries,
    responses,
    views,
    reviews,
    subscription: subscription || {
      plan: null,
      status: null,
      activeUntil: null,
      cancelAtPeriodEnd: null,
      limits: null,
      tier: null,
      renewsAt: null,
      trialEndsAt: null,
    },
    upcoming: calendar ? calendar.upcoming : [],
    nextSteps,
    analytics,
    tickets: ticketsBlock,
    unavailable,
  };
}

module.exports = {
  DEFAULT_SUMMARY_DAYS,
  buildDashboardSummary,
  buildVerification,
  summarisePackages,
  summariseReviews,
  toContractState,
};
