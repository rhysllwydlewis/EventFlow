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
const { resolveAnalyticsWindow, getWindowBounds } = require('../utils/analyticsWindow');
const { hydrateSupplierProfilePhoto } = require('../utils/supplierProfilePhoto');
const { addPublicProfilePath } = require('../utils/publicSupplierProfilePath');
const { isPlaceholderImage } = require('../utils/packageImageUtils');
const { getPlanFeatures } = require('../models/Subscription');
const {
  normaliseState,
  VERIFICATION_STATES,
} = require('../utils/supplierVerificationStateMachine');
const { STATES, reviewState, reviewRating } = require('../utils/reviewShape');
const { computeProfileCompleteness } = require('./supplierProfileCompleteness');
const { getEngagementMetrics, getMessagingSummary } = require('./supplierEngagementMetrics');
const { evaluateNextSteps } = require('./supplierNextSteps');
const supplierAnalytics = require('../utils/supplierAnalytics');

/** db-unified turns failed queries into empty results unless told to throw; a dashboard must not mistake that for "no data". */
const STRICT = Object.freeze({ throwOnError: true });

const DEFAULT_SUMMARY_DAYS = 30;

/** Most distinct visitors counted in one window (a bound on the query, far above any real profile). */
const MAX_VISITOR_GROUPS = 50000;

/** The exact rule behind `views.total`, safe to show to the supplier as it is. */
const VIEWS_DESCRIPTION =
  'Times your public profile page was loaded, counted once per visitor per hour. Your own visits, admins and automated crawlers are not counted. Views recorded before this rule was introduced may include some of these.';
const UPCOMING_LIMIT = 3;

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
 * @param {Object|null|undefined} ownerUser - The owner's user document; null if there is none, undefined if the lookup failed
 * @returns {Object} verification block
 */
function buildVerification(supplier, ownerUser) {
  const approved = supplier.approved === true;
  const status = normaliseState(supplier.verificationStatus, Boolean(supplier.verified));
  const needsExplanation =
    status === VERIFICATION_STATES.NEEDS_CHANGES || status === VERIFICATION_STATES.REJECTED;
  return {
    // undefined = the user lookup failed (unknown); null/absent row = not verified.
    emailVerified: ownerUser === undefined ? null : Boolean(ownerUser?.verified),
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
  const subscription = await subscriptionService.getSubscriptionByUserId(userId, STRICT);
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
    status: subscription?.status || 'free',
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
 * published reviews are counted, whichever writer created them (see
 * utils/reviewShape.js for the legacy and v2 shapes).
 *
 * @param {Object[]} reviews - Review documents for one supplier
 * @returns {{approvedCount: number, averageRating: (number|null), pendingCount: number}}
 */
function summariseReviews(reviews) {
  const approved = reviews.filter(review => reviewState(review) === STATES.APPROVED);
  const pendingCount = reviews.filter(review => reviewState(review) === STATES.PENDING).length;
  const ratings = approved.map(reviewRating).filter(rating => rating !== null);
  const averageRating =
    ratings.length > 0
      ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2))
      : null;
  return { approvedCount: approved.length, averageRating, pendingCount };
}

/**
 * Whether a public calendar event has not been soft-deleted.
 *
 * @param {Object} event - Public calendar event
 * @returns {boolean} True for events that still exist
 */
function isLiveEvent(event) {
  return !event.deleted && !event.isDeleted && !event.deletedAt && event.status !== 'deleted';
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
    dbUnified.find('customer_calendar_entries', { userId }, STRICT),
    dbUnified.find('public_calendar_events', { createdByUserId: userId }, STRICT),
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
    .filter(isLiveEvent)
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
    hasActivity: (entries || []).length > 0 || (events || []).filter(isLiveEvent).length > 0,
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
 * Build the `attempt` helper for one summary: it runs a source query, and on failure records the
 * block in `unavailable` and returns the fallback instead of failing the whole summary.
 *
 * @param {string[]} unavailable - Collects the labels of blocks that could not be read
 * @returns {Function} attempt(label, task, fallback) => Promise<*>
 */
function createAttempt(unavailable) {
  return async (label, task, fallback) => {
    try {
      return await task();
    } catch (error) {
      logger.error(`dashboard-summary: ${label} sub-query failed:`, error);
      unavailable.push(label);
      return fallback;
    }
  };
}

/**
 * Phase 1: everything that does not depend on the analytics window.
 *
 * @param {Function} attempt - Failure-tolerant query runner
 * @param {Object} ids - { userId, supplierId, now }
 * @returns {Promise<Object>} The raw source records (null where a read failed)
 */
async function loadSources(attempt, { userId, supplierId, now }) {
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
    // undefined (not null) marks a failed lookup, so a missing row and an error stay distinct.
    attempt('user', () => dbUnified.findOne('users', { id: userId }, STRICT)),
    attempt('subscription', () => resolveSubscription(userId), null),
    attempt('packages', () => dbUnified.find('packages', { supplierId }, STRICT), null),
    attempt('reviews', () => dbUnified.find('reviews', { supplierId }, STRICT), null),
    attempt('profile', () => dbUnified.find('suppliers', { ownerUserId: userId }, STRICT), null),
    attempt(
      'tickets',
      () => dbUnified.find('tickets', { senderId: userId, senderType: 'supplier' }, STRICT),
      null
    ),
    attempt(
      'reviewRequests',
      () => dbUnified.count('reviewRequests', { supplierId, status: { $ne: 'failed' } }, STRICT),
      null
    ),
    attempt('calendar', () => loadCalendar(userId, now), null),
  ]);
  return {
    ownerUser,
    subscription,
    packageDocs,
    reviewDocs,
    profiles,
    tickets,
    requestCount,
    calendar,
  };
}

/**
 * Phase 2: the window-bound figures (enquiries, the previous period's views, messages) and the
 * analytics block built on them.
 *
 * @param {Function} attempt - Failure-tolerant query runner
 * @param {Object} params - { userId, supplierId, now, fixedNow, analyticsWindow }
 * @returns {Promise<Object>} { engagement, previousViews, messaging, analyticsBase, uniqueVisitors }
 */
async function loadWindowFigures(attempt, { userId, supplierId, now, fixedNow, analyticsWindow }) {
  const { startMs: windowStartMs, previousStartMs } = getWindowBounds(
    now.getTime(),
    analyticsWindow.days
  );
  const [engagement, previousViews, messaging, uniqueVisitors] = await Promise.all([
    attempt(
      'enquiries',
      () =>
        getEngagementMetrics({
          supplierId,
          ownerUserId: userId,
          days: analyticsWindow.days,
          now: fixedNow,
        }),
      null
    ),
    attempt(
      'viewsTrend',
      () =>
        dbUnified.count(
          'events',
          {
            supplierId,
            type: supplierAnalytics.EVENT_TYPES.PROFILE_VIEW,
            timestamp: {
              $gte: new Date(previousStartMs).toISOString(),
              $lt: new Date(windowStartMs).toISOString(),
            },
          },
          STRICT
        ),
      null
    ),
    attempt('messages', () => getMessagingSummary(userId), null),
    attempt(
      'uniqueVisitors',
      async () => {
        // One group per anonymous visitor key (a hash, never an address): about how many different
        // browsers or signed-in people loaded the page, not how many times.
        const groups =
          (await dbUnified.aggregate(
            'events',
            [
              {
                $match: {
                  supplierId,
                  type: supplierAnalytics.EVENT_TYPES.PROFILE_VIEW,
                  timestamp: { $gte: new Date(windowStartMs).toISOString() },
                },
              },
              { $group: { _id: { visitor: '$visitorKey' } } },
              { $limit: MAX_VISITOR_GROUPS },
            ],
            STRICT
          )) || [];
        return groups.filter(group => group._id?.visitor).length;
      },
      null
    ),
  ]);
  const analyticsBase = await attempt(
    'analytics',
    () =>
      supplierAnalytics.getSupplierAnalytics(supplierId, analyticsWindow.days, { now, engagement }),
    null
  );
  return { engagement, previousViews, messaging, analyticsBase, uniqueVisitors };
}

/**
 * The profile block of the summary.
 *
 * @param {Object} supplier - The supplier document
 * @param {Object} completeness - Completeness result
 * @param {Object} verification - Verification block
 * @param {Array|null} profiles - The owner's profiles (null when unreadable)
 * @returns {Object} Profile block
 */
function buildProfileBlock(supplier, completeness, verification, profiles) {
  const flagFor = id => completeness.checks.some(check => check.id === id && check.done);
  return {
    hasProfile: true,
    profileCount: profiles ? profiles.length : null,
    topProfileId: supplier.id || null,
    topProfileName: supplier.name || null,
    name: supplier.name || null,
    publicProfilePath: addPublicProfilePath(supplier).publicProfilePath || null,
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
}

/**
 * The packages block of the summary.
 *
 * @param {Array|null} packageDocs - Package records (null when unreadable)
 * @param {Object|null} subscription - Resolved subscription
 * @returns {Object} Packages block
 */
function buildPackagesBlock(packageDocs, subscription) {
  const planPackageLimit =
    subscription && Number.isFinite(subscription.limits.maxPackages)
      ? subscription.limits.maxPackages
      : null;
  if (packageDocs) {
    return summarisePackages(packageDocs, planPackageLimit);
  }
  return {
    total: null,
    active: null,
    paused: null,
    awaitingApproval: null,
    limit: planPackageLimit,
    countedTowardsLimit: null,
    draft: null,
  };
}

/**
 * The messages block of the summary.
 *
 * @param {Object|null} messaging - Messaging summary (null when unreadable)
 * @returns {Object} Messages block
 */
function buildMessagesBlock(messaging) {
  if (!messaging) {
    return {
      unreadMessages: null,
      conversationsWithUnread: null,
      latestAt: null,
      total: null,
      unread: null,
    };
  }
  return {
    unreadMessages: messaging.unreadMessages,
    conversationsWithUnread: messaging.conversationsWithUnread,
    latestAt: messaging.latestAt,
    // Legacy keys kept for the previous dashboard.
    total: messaging.total,
    unread: messaging.conversationsWithUnread,
  };
}

/**
 * The enquiries and responses blocks of the summary.
 *
 * @param {Object|null} engagement - Engagement metrics (null when unreadable)
 * @returns {{enquiries: Object, responses: Object}} Both blocks
 */
function buildEnquiryBlocks(engagement) {
  if (engagement) {
    return { enquiries: engagement.enquiries, responses: engagement.responses };
  }
  return {
    enquiries: {
      newThisPeriod: null,
      previousPeriod: null,
      sources: { conversations: null, quoteRequests: null, contactForm: null },
      truncated: false,
      requests: { received: null, new: null },
    },
    responses: { sampleSize: null, matureSampleSize: null, repliedPct: null, medianMinutes: null },
  };
}

/**
 * The legacy analytics block, or the "unavailable" placeholder when views could not be counted.
 *
 * @param {Object} figures - { analyticsBase, previousViews, engagement, enquiries, responses }
 * @returns {Object} Analytics block
 */
function buildAnalyticsBlock({ analyticsBase, previousViews, engagement, enquiries, responses }) {
  if (!analyticsBase || analyticsBase.totalViews === null) {
    return unavailableAnalytics();
  }
  const totalViews = analyticsBase.totalViews;
  return {
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

/**
 * The tickets block of the summary.
 *
 * @param {Array|null} tickets - Ticket records (null when unreadable)
 * @returns {Object} Tickets block
 */
function buildTicketsBlock(tickets) {
  if (!tickets) {
    return { total: null, open: null, inProgress: null };
  }
  return {
    total: tickets.length,
    open: tickets.filter(ticket => ticket.status === 'open').length,
    inProgress: tickets.filter(ticket => ticket.status === 'in_progress').length,
  };
}

/**
 * Evaluate the next steps from the sources, holding back any step whose source could not be read.
 *
 * @param {Object} inputs - { hydrated, ownerUser, verification, completeness, sources, approvedCount }
 * @returns {Array} Next steps
 */
function buildNextSteps({
  hydrated,
  ownerUser,
  verification,
  completeness,
  sources,
  approvedCount,
}) {
  const { packageDocs, reviewDocs, requestCount, calendar } = sources;
  return evaluateNextSteps({
    // The verification form accepts the owner's account email when the profile has none.
    supplier: { ...hydrated, email: hydrated.email || ownerUser?.email || '' },
    verification,
    completeness,
    // null for any source that could not be read: the steps it feeds are held back, not guessed.
    packages: packageDocs
      ? {
          total: packageDocs.length,
          withoutPhoto: packageDocs.filter(pkg => isPlaceholderImage(pkg.image)).length,
        }
      : null,
    reviewRequestsSent: requestCount === null ? null : Number(requestCount) || 0,
    approvedReviewCount: reviewDocs ? approvedCount : null,
    hasCalendarActivity: calendar ? Boolean(calendar.hasActivity) : null,
  });
}

/** Subscription block used when the plan could not be resolved. */
const UNRESOLVED_SUBSCRIPTION = Object.freeze({
  plan: null,
  status: null,
  activeUntil: null,
  cancelAtPeriodEnd: null,
  limits: null,
  tier: null,
  renewsAt: null,
  trialEndsAt: null,
});

/**
 * Build the complete dashboard summary for one supplier.
 *
 * @param {Object} params - Inputs
 * @param {string} params.userId - Authenticated user id (the supplier owner)
 * @param {Object} params.supplier - The owner's supplier document
 * @param {number|null} [params.requestedDays] - Whole number of days asked for
 * @param {Date} [params.now] - Reference time (for tests; also disables engagement result reuse)
 * @returns {Promise<Object>} Summary payload
 */
async function buildDashboardSummary({ userId, supplier, requestedDays = null, now: fixedNow }) {
  // A caller-supplied clock (tests) bypasses the short-lived engagement result reuse.
  const now = fixedNow || new Date();
  const supplierId = supplier.id;
  const unavailable = [];
  const attempt = createAttempt(unavailable);

  const sources = await loadSources(attempt, { userId, supplierId, now });
  const { ownerUser, subscription, packageDocs, reviewDocs, profiles, tickets, calendar } = sources;

  // Window: the plan decides how far back this supplier may look.
  const analyticsWindow = resolveAnalyticsWindow({
    requested: requestedDays,
    defaultDays: DEFAULT_SUMMARY_DAYS,
    planWindowDays: subscription ? subscription.limits.analyticsWindowDays : undefined,
  });
  const { engagement, previousViews, messaging, analyticsBase, uniqueVisitors } =
    await loadWindowFigures(attempt, {
      userId,
      supplierId,
      now,
      fixedNow,
      analyticsWindow,
    });
  if (analyticsBase && analyticsBase.totalViews === null) {
    unavailable.push('views');
  }

  const hydrated = hydrateSupplierProfilePhoto(supplier, ownerUser || null);
  const completeness = computeProfileCompleteness(hydrated);
  const verification = buildVerification(supplier, ownerUser);
  const reviewSummary = reviewDocs
    ? summariseReviews(reviewDocs)
    : { approvedCount: null, averageRating: null, pendingCount: null };
  const { enquiries, responses } = buildEnquiryBlocks(engagement);
  const totalViews = analyticsBase ? analyticsBase.totalViews : null;

  return {
    window: analyticsWindow,
    verification,
    profile: buildProfileBlock(supplier, completeness, verification, profiles),
    packages: buildPackagesBlock(packageDocs, subscription),
    messages: buildMessagesBlock(messaging),
    enquiries,
    responses,
    views: {
      total: totalViews,
      days: analyticsWindow.days,
      basis: 'page_loads',
      uniqueVisitors,
      description: VIEWS_DESCRIPTION,
    },
    reviews: {
      ...reviewSummary,
      // Legacy keys kept for the previous dashboard.
      total: reviewSummary.approvedCount,
      pending: reviewSummary.pendingCount,
    },
    subscription: subscription || { ...UNRESOLVED_SUBSCRIPTION },
    upcoming: calendar ? calendar.upcoming : [],
    nextSteps: buildNextSteps({
      hydrated,
      ownerUser,
      verification,
      completeness,
      sources,
      approvedCount: reviewSummary.approvedCount,
    }),
    analytics: buildAnalyticsBlock({
      analyticsBase,
      previousViews,
      engagement,
      enquiries,
      responses,
    }),
    tickets: buildTicketsBlock(tickets),
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
