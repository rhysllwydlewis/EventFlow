/**
 * Supplier Analytics and Event Tracking
 * Tracks supplier-related events for analytics and metrics
 */

'use strict';

const crypto = require('crypto');
const logger = require('./logger');
const dbUnified = require('../db-unified');

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
 * @param {Object} [eventData.metadata] - Additional event-specific metadata
 * @returns {Promise<void>}
 */
async function trackEvent(eventData) {
  try {
    // Don't track preview views
    if (eventData.isPreview) {
      return;
    }

    const events = (await dbUnified.read('events')) || [];

    const event = {
      id: `event_${Date.now()}_${crypto.randomUUID()}`,
      type: eventData.type,
      supplierId: eventData.supplierId,
      userId: eventData.userId || null,
      sessionId: eventData.sessionId || null,
      metadata: eventData.metadata || {},
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0], // For daily aggregation
    };

    events.push(event);

    await dbUnified.insertOne('events', event);
  } catch (error) {
    logger.error('Failed to track supplier event:', error);
    // Don't throw - tracking should not break the main flow
  }
}

/**
 * Get analytics for a supplier over a time period
 * @param {string} supplierId - Supplier ID
 * @param {number} [days=7] - Number of days to look back
 * @returns {Promise<Object>} Analytics data
 */
async function getSupplierAnalytics(supplierId, days = 7) {
  try {
    const events = (await dbUnified.read('events')) || [];

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString();

    // Filter events for this supplier within the period
    const supplierEvents = events.filter(
      e => e.supplierId === supplierId && e.timestamp >= cutoffStr
    );

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

    // Get messages for response rate calculation
    const messages = await dbUnified.read('messages');
    const threads = await dbUnified.read('threads');

    // Calculate response rate based on actual message patterns
    // For each thread, check if supplier replied to customer messages
    const supplierThreads = threads.filter(t => t.supplierId === supplierId);
    let totalCustomerMessages = 0;
    let respondedToCustomerMessages = 0;
    let totalResponseTime = 0;
    let responseCount = 0;

    for (const thread of supplierThreads) {
      const threadMessages = messages
        .filter(m => m.threadId === thread.id && !m.isDraft)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      // Track customer messages and supplier responses
      for (let i = 0; i < threadMessages.length; i++) {
        const msg = threadMessages[i];

        // If this is a customer message
        if (msg.fromUserId === thread.customerId) {
          totalCustomerMessages++;

          // Check if supplier responded to this message (look for next non-customer message)
          const supplierResponse = threadMessages
            .slice(i + 1)
            .find(m => m.fromUserId !== thread.customerId);

          if (supplierResponse) {
            respondedToCustomerMessages++;

            // Calculate response time
            const responseTime = new Date(supplierResponse.createdAt) - new Date(msg.createdAt);
            totalResponseTime += responseTime;
            responseCount++;
          }
        }
      }
    }

    // Calculate response rate
    const responseRate =
      totalCustomerMessages > 0
        ? Math.round((respondedToCustomerMessages / totalCustomerMessages) * 100)
        : 100; // Default to 100% if no messages

    // Calculate average response time (in hours)
    let avgResponseTime = 0;
    if (responseCount > 0) {
      avgResponseTime =
        Math.round((totalResponseTime / responseCount / (1000 * 60 * 60)) * 10) / 10;
    }

    // Generate daily breakdown
    const dailyData = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dayEvents = supplierEvents.filter(e => e.date === dateStr);
      const dayViews = dayEvents.filter(e => e.type === EVENT_TYPES.PROFILE_VIEW).length;
      const dayEnquiries = dayEvents.filter(
        e => e.type === EVENT_TYPES.ENQUIRY_STARTED || e.type === EVENT_TYPES.ENQUIRY_SENT
      ).length;

      dailyData.push({
        date: dateStr,
        label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        views: dayViews,
        enquiries: dayEnquiries,
      });
    }

    return {
      period: days,
      totalViews: profileViews,
      totalEnquiries: enquiriesSent,
      enquiriesStarted,
      messageReplies,
      reviewsReceived,
      responseRate,
      avgResponseTime,
      dailyData,
    };
  } catch (error) {
    logger.error('Failed to get supplier analytics:', error);
    // Return empty analytics on error
    return {
      period: days,
      totalViews: 0,
      totalEnquiries: 0,
      enquiriesStarted: 0,
      messageReplies: 0,
      reviewsReceived: 0,
      responseRate: 100,
      avgResponseTime: 0,
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
 * @returns {Promise<void>}
 */
function trackProfileView(supplierId, userId = null, sessionId = null, isPreview = false) {
  return trackEvent({
    type: EVENT_TYPES.PROFILE_VIEW,
    supplierId,
    userId,
    sessionId,
    isPreview,
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
