/**
 * Supplier Analytics and Event Tracking
 * Tracks supplier-related events for analytics and metrics
 */

'use strict';

const crypto = require('crypto');
const logger = require('./logger');
const dbUnified = require('../db-unified');
const { getWindowBounds } = require('./analyticsWindow');
const { profileViewExpiry } = require('./profileViewRetention');

/**
 * Event types for supplier analytics
 */
const EVENT_TYPES = {
  PROFILE_VIEW: 'profile_view',
  ENQUIRY_STARTED: 'enquiry_started',
  ENQUIRY_SENT: 'enquiry_sent',
  MESSAGE_REPLY: 'message_reply',
  REVIEW_RECEIVED: 'review_received',
};

/**
 * Track a supplier analytics event
 * @param {Object} eventData - Event tracking data
 * @param {string} eventData.type - Event type (from EVENT_TYPES)
 * @param {string} eventData.supplierId - Supplier ID
 * @param {string} [eventData.userId] - User ID (if authenticated)
 * @param {string} [eventData.sessionId] - Session ID for anonymous tracking
 * @param {boolean} [eventData.isPreview] - Whether this is a preview view (won't be counted)
 * @param {string} [eventData.visitorKey] - Anonymous visitor hash used to count a view once per hour
 * @param {string} [eventData.dedupeKey] - Unique key: a second event with the same key is refused by
 *   the database (unique index), so two requests at once cannot both be counted
 * @param {Object} [eventData.metadata] - Additional event-specific metadata
 * @returns {Promise<{recorded: boolean, duplicate: boolean}>} Whether an event was stored, and
 *   whether it was refused because its dedupeKey already exists
 */
async function trackEvent(eventData) {
  try {
    // Don't track preview views
    if (eventData.isPreview) {
      return { recorded: false, duplicate: false };
    }

    const nowMs = Date.now();
    const event = {
      id: `event_${nowMs}_${crypto.randomUUID()}`,
      type: eventData.type,
      supplierId: eventData.supplierId,
      userId: eventData.userId || null,
      sessionId: eventData.sessionId || null,
      // Keyed hash that identifies one browser/account for the one-view-per-hour rule (never a raw
      // IP, and no address-derived value is stored on the event at all).
      visitorKey: eventData.visitorKey || null,
      metadata: eventData.metadata || {},
      timestamp: new Date(nowMs).toISOString(),
      date: new Date(nowMs).toISOString().split('T')[0], // For daily aggregation
    };

    // Profile views hold a visitor key (or a signed-in visitor's id), so they are not kept for
    // ever: a TTL index on events.expiresAt (db-unified.js) removes them after the retention period
    // stated in public/privacy.html. Other event types have no expiry.
    if (eventData.type === EVENT_TYPES.PROFILE_VIEW) {
      event.expiresAt = profileViewExpiry(nowMs);
    }

    if (eventData.dedupeKey) {
      event.dedupeKey = eventData.dedupeKey;
    }

    await dbUnified.insertOne('events', event, { throwOnError: true });
    return { recorded: true, duplicate: false };
  } catch (error) {
    if (error && error.code === 11000) {
      return { recorded: false, duplicate: true };
    }
    logger.error('Failed to track supplier event:', error);
    // Don't throw - tracking should not break the main flow
    return { recorded: false, duplicate: false };
  }
}

/** Longest window `getSupplierAnalytics` will ever build, whatever the caller asks for. */
const MAX_WINDOW_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Coerce a caller-supplied day count to a safe whole number.
 *
 * `getSupplierAnalytics` builds one chart bucket per day, so an unbounded value
 * (for example `period=1000000000` on an authenticated route) would otherwise be
 * a CPU and memory sink.
 *
 * @param {*} days - Requested number of days
 * @returns {number} Whole number between 1 and MAX_WINDOW_DAYS
 */
function normaliseWindowDays(days) {
  const parsed = Math.floor(Number(days));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.min(parsed, MAX_WINDOW_DAYS);
}

/**
 * Get analytics for a supplier over a time period
 *
 * Profile views come from tracked `events`. Enquiry and reply figures come from
 * the messenger, quote-request and contact-form records when `options.ownerUserId`
 * (or a precomputed `options.engagement`) is supplied; without it they cannot be
 * derived, so `responseRate` and `avgResponseTime` are null rather than a
 * made-up 100% / 0 hours.
 *
 * @param {string} supplierId - Supplier ID
 * @param {number} [days=7] - Number of days to look back (clamped to 1-365)
 * @param {Object} [options] - Optional inputs
 * @param {string} [options.ownerUserId] - Supplier owner's user id, enables real enquiry/reply figures
 * @param {Object} [options.engagement] - Result of getEngagementMetrics for the same window
 * @param {Date} [options.now] - Reference time (for tests)
 * @returns {Promise<Object>} Analytics data
 */
async function getSupplierAnalytics(supplierId, days = 7, options = {}) {
  const windowDays = normaliseWindowDays(days);
  try {
    const now = options.now instanceof Date ? options.now : new Date();
    const nowMs = now.getTime();
    // Whole UTC days, so these totals equal the sum of the daily buckets built below.
    const { startMs } = getWindowBounds(nowMs, windowDays);
    const cutoffStr = new Date(startMs).toISOString();

    // Only this supplier's events inside the window, not the whole collection. A failed
    // read must surface (caught below as missing data), not look like "no events".
    const supplierEvents =
      (await dbUnified.find(
        'events',
        { supplierId, timestamp: { $gte: cutoffStr } },
        { throwOnError: true }
      )) || [];

    // Count events by type
    const profileViews = supplierEvents.filter(e => e.type === EVENT_TYPES.PROFILE_VIEW).length;
    const enquiriesStarted = supplierEvents.filter(
      e => e.type === EVENT_TYPES.ENQUIRY_STARTED
    ).length;
    const enquiriesSent = supplierEvents.filter(e => e.type === EVENT_TYPES.ENQUIRY_SENT).length;
    const messageReplies = supplierEvents.filter(e => e.type === EVENT_TYPES.MESSAGE_REPLY).length;
    const reviewsReceived = supplierEvents.filter(
      e => e.type === EVENT_TYPES.REVIEW_RECEIVED
    ).length;

    let engagement = options.engagement || null;
    if (!engagement && options.ownerUserId) {
      try {
        engagement = await require('../services/supplierEngagementMetrics').getEngagementMetrics({
          supplierId,
          ownerUserId: options.ownerUserId,
          days: windowDays,
          now: options.now instanceof Date ? options.now : undefined,
        });
      } catch (engagementError) {
        logger.error('Failed to get supplier engagement metrics:', engagementError);
      }
    }

    // Asked for real enquiry figures but could not get them: report unknown, not zero.
    const enquiriesUnknown = Boolean(options.ownerUserId) && !engagement;

    // Per-day enquiry counts (UTC days, matching the event buckets) from real records.
    const enquiriesByDate = new Map();
    if (engagement) {
      engagement.enquiryTimestamps.forEach(millis => {
        const dateStr = new Date(millis).toISOString().split('T')[0];
        enquiriesByDate.set(dateStr, (enquiriesByDate.get(dateStr) || 0) + 1);
      });
    }

    // Generate daily breakdown
    const dailyData = [];
    for (let i = windowDays - 1; i >= 0; i--) {
      const date = new Date(nowMs - i * DAY_MS);
      const dateStr = date.toISOString().split('T')[0];

      const dayEvents = supplierEvents.filter(e => e.date === dateStr);
      const dayViews = dayEvents.filter(e => e.type === EVENT_TYPES.PROFILE_VIEW).length;
      let dayEnquiries = null;
      if (engagement) {
        dayEnquiries = enquiriesByDate.get(dateStr) || 0;
      } else if (!enquiriesUnknown) {
        dayEnquiries = dayEvents.filter(
          e => e.type === EVENT_TYPES.ENQUIRY_STARTED || e.type === EVENT_TYPES.ENQUIRY_SENT
        ).length;
      }

      dailyData.push({
        date: dateStr,
        label: date.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        }),
        views: dayViews,
        enquiries: dayEnquiries,
      });
    }

    // Reply speed is reported in hours (1dp) for older clients; null when there is no sample.
    const medianMinutes = engagement ? engagement.responses.medianMinutes : null;

    let enquiryTotal = null;
    if (engagement) {
      enquiryTotal = engagement.enquiries.newThisPeriod;
    } else if (!enquiriesUnknown) {
      enquiryTotal = enquiriesSent;
    }

    return {
      period: windowDays,
      totalViews: profileViews,
      totalEnquiries: enquiryTotal,
      enquiriesStarted,
      messageReplies,
      reviewsReceived,
      responseRate: engagement ? engagement.responses.repliedPct : null,
      avgResponseTime: medianMinutes === null ? null : Math.round((medianMinutes / 60) * 10) / 10,
      dailyData,
    };
  } catch (error) {
    logger.error('Failed to get supplier analytics:', error);
    // Unknown is not zero: report the failure as missing data.
    return {
      period: windowDays,
      totalViews: null,
      totalEnquiries: null,
      enquiriesStarted: null,
      messageReplies: null,
      reviewsReceived: null,
      responseRate: null,
      avgResponseTime: null,
      dailyData: [],
    };
  }
}

/**
 * Track a profile view
 * @param {string} supplierId - Supplier ID
 * @param {string} [userId] - User ID (if authenticated)
 * @param {string} [sessionId] - Session ID
 * @param {boolean} [isPreview] - Whether this is a preview view
 * @param {string} [visitorKey] - Anonymous visitor hash (one view per visitor per hour)
 * @param {{dedupeKey?: string}} [keys] - Unique key (see trackEvent)
 * @returns {Promise<{recorded: boolean, duplicate: boolean}>} Outcome
 */
function trackProfileView(
  supplierId,
  userId = null,
  sessionId = null,
  isPreview = false,
  visitorKey = null,
  keys = {}
) {
  return trackEvent({
    type: EVENT_TYPES.PROFILE_VIEW,
    supplierId,
    userId,
    sessionId,
    isPreview,
    visitorKey,
    dedupeKey: keys.dedupeKey,
  });
}

/**
 * Track an enquiry started
 * @param {string} supplierId - Supplier ID
 * @param {string} userId - User ID
 * @param {Object} [metadata] - Additional metadata
 * @returns {Promise<void>}
 */
function trackEnquiryStarted(supplierId, userId, metadata = {}) {
  return trackEvent({
    type: EVENT_TYPES.ENQUIRY_STARTED,
    supplierId,
    userId,
    metadata,
  });
}

/**
 * Track an enquiry sent
 * @param {string} supplierId - Supplier ID
 * @param {string} userId - User ID
 * @param {Object} [metadata] - Additional metadata (e.g., threadId)
 * @returns {Promise<void>}
 */
function trackEnquirySent(supplierId, userId, metadata = {}) {
  return trackEvent({
    type: EVENT_TYPES.ENQUIRY_SENT,
    supplierId,
    userId,
    metadata,
  });
}

/**
 * Track a message reply
 * @param {string} supplierId - Supplier ID
 * @param {string} userId - User ID
 * @param {Object} [metadata] - Additional metadata (e.g., messageId, responseTime)
 * @returns {Promise<void>}
 */
function trackMessageReply(supplierId, userId, metadata = {}) {
  return trackEvent({
    type: EVENT_TYPES.MESSAGE_REPLY,
    supplierId,
    userId,
    metadata,
  });
}

/**
 * Track a review received
 * @param {string} supplierId - Supplier ID
 * @param {string} userId - User ID who left the review
 * @param {Object} [metadata] - Additional metadata (e.g., rating, reviewId)
 * @returns {Promise<void>}
 */
function trackReviewReceived(supplierId, userId, metadata = {}) {
  return trackEvent({
    type: EVENT_TYPES.REVIEW_RECEIVED,
    supplierId,
    userId,
    metadata,
  });
}

module.exports = {
  EVENT_TYPES,
  trackEvent,
  getSupplierAnalytics,
  trackProfileView,
  trackEnquiryStarted,
  trackEnquirySent,
  trackMessageReply,
  trackReviewReceived,
};
