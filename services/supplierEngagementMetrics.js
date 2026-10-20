/**
 * Supplier engagement metrics
 *
 * Honest numbers for the supplier dashboard: unread messages, new enquiries and
 * how quickly the supplier replies. Everything here is derived from records that
 * actually exist, not from client beacons:
 *
 *   - messenger v4: `conversations_v4` + `chat_messages_v4` (the legacy `threads`
 *     and `messages` collections have had no writers for a long time)
 *   - quote requests: `quoteRequests` rows whose `suppliers[]` names this supplier
 *   - contact form: `enquiries` rows (POST /api/v1/contact-supplier)
 *
 * A metric that cannot be computed from a meaningful sample is `null`, never a
 * flattering default such as 0 or 100.
 */

'use strict';

const dbUnified = require('../db-unified');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fewer conversations than this is not a sample worth quoting a percentage for. */
const MIN_RESPONSE_SAMPLE = 3;

/** A conversation younger than this is not yet "unanswered": the supplier is still within a day. */
const REPLY_GRACE_MS = DAY_MS;

/**
 * Upper bound on conversations inspected per call. Two windows of up to 90 days
 * for one supplier is far below this; if it is ever reached the counts are lower
 * bounds and `enquiries.truncated` says so.
 */
const MAX_CONVERSATIONS_SCANNED = 1000;

/** Upper bound on unread conversations summed for the unread badge. */
const MAX_UNREAD_CONVERSATIONS = 1000;

/**
 * Convert a Date, ISO string or epoch number to epoch milliseconds.
 *
 * @param {Date|string|number|null|undefined} value - Timestamp-like value
 * @returns {number|null} Milliseconds since the epoch, or null when unparseable
 */
function toMillis(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const millis = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
}

/**
 * Median of a list of numbers.
 *
 * @param {number[]} values - Numbers (not modified)
 * @returns {number|null} Median, or null for an empty list
 */
function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Summarise customer-initiated conversations into the `responses` block.
 *
 * `repliedPct` is the share of conversations that received any supplier message,
 * counting only conversations at least 24 hours old (a fresh enquiry is not
 * "unanswered"). `medianMinutes` is the median gap between the customer's first
 * message and the supplier's first message. Both are null below three
 * conversations, and `repliedPct` is also null while no conversation is old
 * enough to judge.
 *
 * @param {Array<{customerFirstMs: number, supplierFirstMs: number|null}>} samples - One per conversation
 * @param {number} nowMs - Reference time in epoch milliseconds
 * @returns {{sampleSize: number, matureSampleSize: number, repliedPct: number|null, medianMinutes: number|null}}
 */
function summariseResponses(samples, nowMs) {
  const sampleSize = samples.length;
  const mature = samples.filter(sample => nowMs - sample.customerFirstMs >= REPLY_GRACE_MS);
  const replied = mature.filter(sample => sample.supplierFirstMs !== null);
  const gapsInMinutes = samples
    .filter(sample => sample.supplierFirstMs !== null)
    .map(sample => Math.max(0, sample.supplierFirstMs - sample.customerFirstMs) / 60000);

  const enoughData = sampleSize >= MIN_RESPONSE_SAMPLE;
  const medianGap = median(gapsInMinutes);

  return {
    sampleSize,
    matureSampleSize: mature.length,
    repliedPct:
      enoughData && mature.length > 0 ? Math.round((replied.length / mature.length) * 100) : null,
    medianMinutes: enoughData && medianGap !== null ? Math.round(medianGap * 10) / 10 : null,
  };
}

/**
 * Work out which conversations are customer-initiated enquiries and when each
 * side first spoke.
 *
 * A conversation is an enquiry when a customer participant (role `customer`)
 * wrote the first message. Supplier-to-supplier networking, support threads with
 * admins and conversations the supplier started themselves are not enquiries.
 *
 * @param {Object[]} conversations - `conversations_v4` documents
 * @param {Object[]} firstMessageRows - Aggregation rows `{_id: {conversationId, senderId}, firstAt}`
 * @param {string} ownerUserId - The supplier owner's user id
 * @returns {Array<{createdMs: number, customerFirstMs: number, supplierFirstMs: number|null}>}
 */
function classifyEnquiryConversations(conversations, firstMessageRows, ownerUserId) {
  const firstBySender = new Map();
  firstMessageRows.forEach(row => {
    const conversationKey = String(row._id.conversationId);
    const firstAt = toMillis(row.firstAt);
    if (firstAt === null) {
      return;
    }
    if (!firstBySender.has(conversationKey)) {
      firstBySender.set(conversationKey, new Map());
    }
    firstBySender.get(conversationKey).set(row._id.senderId, firstAt);
  });

  const enquiries = [];
  conversations.forEach(conversation => {
    const createdMs = toMillis(conversation.createdAt);
    const senders = firstBySender.get(String(conversation._id));
    if (createdMs === null || !senders) {
      return;
    }
    const customerIds = new Set(
      (conversation.participants || [])
        .filter(
          participant => participant.role === 'customer' && participant.userId !== ownerUserId
        )
        .map(participant => participant.userId)
    );
    const customerTimes = [...senders.entries()]
      .filter(([senderId]) => customerIds.has(senderId))
      .map(([, firstAt]) => firstAt);
    if (!customerTimes.length) {
      return;
    }
    const customerFirstMs = Math.min(...customerTimes);
    const supplierFirst = senders.has(ownerUserId) ? senders.get(ownerUserId) : null;
    // The supplier opening the conversation (and the customer answering) is outreach, not an enquiry.
    if (supplierFirst !== null && supplierFirst < customerFirstMs) {
      return;
    }
    enquiries.push({ createdMs, customerFirstMs, supplierFirstMs: supplierFirst });
  });
  return enquiries;
}

/**
 * Fetch the supplier's conversations created since `sinceMs` and the first time
 * each participant wrote in them.
 *
 * @param {string} ownerUserId - The supplier owner's user id
 * @param {number} sinceMs - Earliest conversation creation time to include
 * @returns {Promise<{enquiries: Array, truncated: boolean}>} Classified enquiries
 */
async function loadConversationEnquiries(ownerUserId, sinceMs) {
  if (!ownerUserId) {
    return { enquiries: [], truncated: false };
  }
  const conversations =
    (await dbUnified.findWithOptions(
      'conversations_v4',
      {
        'participants.userId': ownerUserId,
        createdAt: { $gte: new Date(sinceMs) },
        messageCount: { $gt: 0 },
      },
      { limit: MAX_CONVERSATIONS_SCANNED, sort: { createdAt: -1 } }
    )) || [];
  if (!conversations.length) {
    return { enquiries: [], truncated: false };
  }

  // One row per (conversation, sender): bounded by participants, not by message volume.
  const firstMessageRows =
    (await dbUnified.aggregate('chat_messages_v4', [
      {
        $match: {
          conversationId: { $in: conversations.map(conversation => conversation._id) },
          isDeleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: { conversationId: '$conversationId', senderId: '$senderId' },
          firstAt: { $min: '$createdAt' },
        },
      },
    ])) || [];

  return {
    enquiries: classifyEnquiryConversations(conversations, firstMessageRows, ownerUserId),
    truncated: conversations.length >= MAX_CONVERSATIONS_SCANNED,
  };
}

/**
 * Timestamps of quote requests that named this supplier.
 *
 * Quote requests store their recipients in a `suppliers[]` array. The date range
 * is applied in the query; membership is checked here so it behaves the same on
 * every storage backend.
 *
 * @param {string} supplierId - Supplier id
 * @param {number} sinceMs - Earliest creation time to include
 * @returns {Promise<number[]>} Creation times in epoch milliseconds
 */
async function loadQuoteRequestTimes(supplierId, sinceMs) {
  const requests =
    (await dbUnified.find('quoteRequests', {
      createdAt: { $gte: new Date(sinceMs).toISOString() },
    })) || [];
  return requests
    .filter(
      request =>
        Array.isArray(request.suppliers) &&
        request.suppliers.some(recipient => recipient && recipient.supplierId === supplierId)
    )
    .map(request => toMillis(request.createdAt))
    .filter(millis => millis !== null);
}

/**
 * Timestamps of public contact-form enquiries addressed to this supplier.
 *
 * @param {string} supplierId - Supplier id
 * @param {number} sinceMs - Earliest creation time to include
 * @returns {Promise<number[]>} Creation times in epoch milliseconds
 */
async function loadContactFormTimes(supplierId, sinceMs) {
  const rows =
    (await dbUnified.find('enquiries', {
      supplierId,
      createdAt: { $gte: new Date(sinceMs).toISOString() },
    })) || [];
  return rows.map(row => toMillis(row.createdAt)).filter(millis => millis !== null);
}

/**
 * Count values that fall in the half-open interval [fromMs, toMs).
 *
 * @param {number[]} millisList - Timestamps in epoch milliseconds
 * @param {number} fromMs - Inclusive start
 * @param {number} toMs - Exclusive end
 * @returns {number} How many fall inside
 */
function countBetween(millisList, fromMs, toMs) {
  return millisList.filter(millis => millis >= fromMs && millis < toMs).length;
}

/**
 * Enquiry counts and reply statistics for one supplier over a window.
 *
 * `enquiries` counts three real flows: customer-initiated messenger
 * conversations, quote requests naming the supplier, and contact-form enquiries.
 * (The last two are stored against the supplier but are not yet shown to them
 * anywhere in the product, which is why they are reported separately in
 * `sources`.) `responses` is computed from the messenger conversations only,
 * because that is the only channel in which a reply is recorded.
 *
 * @param {Object} params - Inputs
 * @param {string} params.supplierId - Supplier id
 * @param {string} params.ownerUserId - The supplier owner's user id
 * @param {number} params.days - Window length in days
 * @param {Date} [params.now] - Reference time
 * @returns {Promise<{enquiries: Object, responses: Object, enquiryTimestamps: number[]}>}
 *   `enquiryTimestamps` (current window, all sources) feeds the per-day chart series.
 */
async function getEngagementMetrics({ supplierId, ownerUserId, days, now = new Date() }) {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - days * DAY_MS;
  const previousStartMs = windowStartMs - days * DAY_MS;

  const [conversationResult, quoteTimes, contactTimes] = await Promise.all([
    loadConversationEnquiries(ownerUserId, previousStartMs),
    loadQuoteRequestTimes(supplierId, previousStartMs),
    loadContactFormTimes(supplierId, previousStartMs),
  ]);

  const conversationTimes = conversationResult.enquiries.map(enquiry => enquiry.createdMs);
  const inWindow = times => countBetween(times, windowStartMs, nowMs + 1);
  const inPrevious = times => countBetween(times, previousStartMs, windowStartMs);

  const sources = {
    conversations: inWindow(conversationTimes),
    quoteRequests: inWindow(quoteTimes),
    contactForm: inWindow(contactTimes),
  };
  const previousSources = [conversationTimes, quoteTimes, contactTimes].reduce(
    (total, times) => total + inPrevious(times),
    0
  );

  const currentConversations = conversationResult.enquiries.filter(
    enquiry => enquiry.createdMs >= windowStartMs && enquiry.createdMs <= nowMs
  );

  return {
    enquiries: {
      newThisPeriod: sources.conversations + sources.quoteRequests + sources.contactForm,
      previousPeriod: previousSources,
      sources,
      truncated: conversationResult.truncated,
    },
    responses: summariseResponses(currentConversations, nowMs),
    enquiryTimestamps: [...conversationTimes, ...quoteTimes, ...contactTimes].filter(
      millis => millis >= windowStartMs && millis <= nowMs
    ),
  };
}

/**
 * Inbox totals for the supplier owner, from `conversations_v4`.
 *
 * `unreadMessages` follows the same rule as GET /api/v4/messenger/unread-count
 * (active conversations, excluding ones the user archived or muted) so the
 * dashboard number and the navbar badge always agree.
 *
 * @param {string} ownerUserId - The supplier owner's user id
 * @returns {Promise<{unreadMessages: number, conversationsWithUnread: number, total: number, latestAt: (string|null)}>}
 */
async function getMessagingSummary(ownerUserId) {
  const activeFilter = { 'participants.userId': ownerUserId, status: 'active' };

  const [unreadConversations, newest, total] = await Promise.all([
    dbUnified.findWithOptions(
      'conversations_v4',
      {
        ...activeFilter,
        participants: {
          $elemMatch: {
            userId: ownerUserId,
            unreadCount: { $gt: 0 },
            isArchived: { $ne: true },
            isMuted: { $ne: true },
          },
        },
      },
      { limit: MAX_UNREAD_CONVERSATIONS }
    ),
    dbUnified.findWithOptions(
      'conversations_v4',
      { ...activeFilter, messageCount: { $gt: 0 } },
      { limit: 1, sort: { updatedAt: -1 } }
    ),
    dbUnified.count('conversations_v4', { ...activeFilter, messageCount: { $gt: 0 } }),
  ]);

  let unreadMessages = 0;
  let conversationsWithUnread = 0;
  (unreadConversations || []).forEach(conversation => {
    const mine = (conversation.participants || []).find(
      participant => participant.userId === ownerUserId
    );
    const unread = mine ? Number(mine.unreadCount) || 0 : 0;
    if (unread > 0) {
      unreadMessages += unread;
      conversationsWithUnread += 1;
    }
  });

  const latest = newest && newest[0];
  const latestMs = latest
    ? toMillis((latest.lastMessage && latest.lastMessage.sentAt) || latest.updatedAt)
    : null;

  return {
    unreadMessages,
    conversationsWithUnread,
    total: Number(total) || 0,
    latestAt: latestMs === null ? null : new Date(latestMs).toISOString(),
  };
}

module.exports = {
  MIN_RESPONSE_SAMPLE,
  REPLY_GRACE_MS,
  median,
  summariseResponses,
  classifyEnquiryConversations,
  getEngagementMetrics,
  getMessagingSummary,
};
