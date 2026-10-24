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
 *
 * Every read passes `throwOnError`: db-unified normally turns a failed query into
 * an empty result, which here would look exactly like "no enquiries". Failures
 * must propagate so callers can report the block as unavailable.
 *
 * One supplier profile per owner is enforced by a unique index on
 * `suppliers.ownerUserId`, so "conversations the owner is in" is the same set as
 * "conversations of this supplier profile".
 */

'use strict';

const dbUnified = require('../db-unified');
const { getWindowBounds } = require('../utils/analyticsWindow');
const { sourceOfId, MAX_RECORDS_PER_SOURCE } = require('./supplierEnquiries');

const ENQUIRY_STATES_COLLECTION = 'supplier_enquiry_states';

const STRICT = Object.freeze({ throwOnError: true });

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fewer judged conversations/replies than this is not a sample worth quoting. */
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

/** When one customer reaches out through several channels, the earliest-listed channel keeps the count. */
const SOURCE_PRIORITY = ['conversations', 'quoteRequests', 'contactForm'];

/** How long a computed result is reused. Short enough to feel live, long enough to absorb a page load's repeat calls. */
const CACHE_TTL_MS = 30 * 1000;
const CACHE_MAX_ENTRIES = 500;
const engagementCache = new Map();

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
 * message and the supplier's first message. Each is null unless at least three
 * conversations went into it: three judged (24 h+) conversations for `repliedPct`,
 * three replies for `medianMinutes`. Quoting a percentage of one thread is noise.
 *
 * @param {Array<{customerFirstMs: number, supplierFirstMs: number|null}>} samples - One per conversation
 * @param {number} nowMs - Reference time in epoch milliseconds
 * @returns {{sampleSize: number, matureSampleSize: number, unanswered: number, repliedPct: number|null, medianMinutes: number|null}}
 */
function summariseResponses(samples, nowMs) {
  const mature = samples.filter(sample => nowMs - sample.customerFirstMs >= REPLY_GRACE_MS);
  const replied = mature.filter(sample => sample.supplierFirstMs !== null);
  const gapsInMinutes = samples
    .filter(sample => sample.supplierFirstMs !== null)
    .map(sample => Math.max(0, sample.supplierFirstMs - sample.customerFirstMs) / 60000);
  const medianGap = gapsInMinutes.length >= MIN_RESPONSE_SAMPLE ? median(gapsInMinutes) : null;

  return {
    sampleSize: samples.length,
    matureSampleSize: mature.length,
    // Customer-started conversations at least a day old that the supplier has not answered.
    // A plain count, so it is reported even when the sample is too small for a percentage.
    unanswered: mature.length - replied.length,
    repliedPct:
      mature.length >= MIN_RESPONSE_SAMPLE
        ? Math.round((replied.length / mature.length) * 100)
        : null,
    medianMinutes: medianGap === null ? null : Math.round(medianGap * 10) / 10,
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
 * @returns {Array<{createdMs: number, customerId: string, customerFirstMs: number, supplierFirstMs: number|null}>}
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
    const customerTimes = [...senders.entries()].filter(([senderId]) => customerIds.has(senderId));
    if (!customerTimes.length) {
      return;
    }
    const [customerId, customerFirstMs] = customerTimes.reduce((earliest, entry) =>
      entry[1] < earliest[1] ? entry : earliest
    );
    const supplierFirst = senders.has(ownerUserId) ? senders.get(ownerUserId) : null;
    // The supplier opening the conversation (and the customer answering) is outreach, not an enquiry.
    if (supplierFirst !== null && supplierFirst < customerFirstMs) {
      return;
    }
    enquiries.push({ createdMs, customerId, customerFirstMs, supplierFirstMs: supplierFirst });
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
      { limit: MAX_CONVERSATIONS_SCANNED, sort: { createdAt: -1 }, throwOnError: true }
    )) || [];
  if (!conversations.length) {
    return { enquiries: [], truncated: false };
  }

  // One row per (conversation, sender): bounded by participants, not by message volume.
  const firstMessageRows =
    (await dbUnified.aggregate(
      'chat_messages_v4',
      [
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
      ],
      STRICT
    )) || [];

  return {
    enquiries: classifyEnquiryConversations(conversations, firstMessageRows, ownerUserId),
    truncated: conversations.length >= MAX_CONVERSATIONS_SCANNED,
  };
}

/**
 * Identify who an enquiry came from, so one person reaching out twice (or through
 * two channels) is counted once.
 *
 * @param {string|null|undefined} userId - Account id when the sender was signed in
 * @param {string|null|undefined} email - Email address when known
 * @returns {string|null} Stable key, or null when the sender cannot be identified
 */
function customerKey(userId, email) {
  if (userId) {
    return `u:${userId}`;
  }
  const normalised = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return normalised ? `e:${normalised}` : null;
}

/**
 * Quote requests that named this supplier.
 *
 * Only this supplier's requests are selected in the database, and only the
 * fields needed to count them are returned, so no other customer's quote request
 * (or any contact detail) is loaded. (The local development store cannot match
 * inside the `suppliers[]` array, so there the count is simply 0; production
 * runs on MongoDB.)
 *
 * @param {string} supplierId - Supplier id
 * @param {number} sinceMs - Earliest creation time to include
 * @returns {Promise<Array<{ms: number, key: (string|null), source: string}>>} Enquiry entries
 */
async function loadQuoteRequestEntries(supplierId, sinceMs) {
  const rows =
    (await dbUnified.aggregate(
      'quoteRequests',
      [
        {
          $match: {
            'suppliers.supplierId': supplierId,
            createdAt: { $gte: new Date(sinceMs).toISOString() },
          },
        },
        // The same newest-first cap and id filter as the supplier's enquiry list, so the dashboard's
        // "new requests" figure and the list can never disagree about which rows exist.
        { $sort: { createdAt: -1 } },
        { $limit: MAX_RECORDS_PER_SOURCE },
        { $project: { id: 1, createdAt: 1, userId: 1, email: 1 } },
      ],
      STRICT
    )) || [];
  return rows
    .filter(row => sourceOfId(row.id))
    .map(row => ({
      id: row.id,
      ms: toMillis(row.createdAt),
      key: customerKey(row.userId, row.email),
      source: 'quoteRequests',
    }))
    .filter(entry => entry.ms !== null);
}

/**
 * Public contact-form enquiries addressed to this supplier.
 *
 * @param {string} supplierId - Supplier id
 * @param {number} sinceMs - Earliest creation time to include
 * @returns {Promise<Array<{ms: number, key: (string|null), source: string}>>} Enquiry entries
 */
async function loadContactFormEntries(supplierId, sinceMs) {
  const rows =
    (await dbUnified.findWithOptions(
      'enquiries',
      { supplierId, createdAt: { $gte: new Date(sinceMs).toISOString() } },
      { limit: MAX_RECORDS_PER_SOURCE, sort: { createdAt: -1 }, throwOnError: true }
    )) || [];
  return rows
    .filter(row => sourceOfId(row.id))
    .map(row => ({
      id: row.id,
      ms: toMillis(row.createdAt),
      key: customerKey(null, row.senderEmail),
      source: 'contactForm',
    }))
    .filter(entry => entry.ms !== null);
}

/**
 * Count each customer once per window, across all channels.
 *
 * A signed-in customer who sends a quote request and then messages the supplier,
 * or who sends two quote requests, is one enquiry. The channel listed first in
 * SOURCE_PRIORITY keeps the count; anonymous entries that cannot be identified
 * are all kept.
 *
 * @param {Array<{ms: number, key: (string|null), source: string}>} entries - Entries in one window
 * @returns {Array<{ms: number, key: (string|null), source: string}>} De-duplicated entries
 */
function dedupeEnquiries(entries) {
  const ordered = [...entries].sort(
    (first, second) =>
      SOURCE_PRIORITY.indexOf(first.source) - SOURCE_PRIORITY.indexOf(second.source) ||
      first.ms - second.ms
  );
  const seen = new Set();
  return ordered.filter(entry => {
    if (entry.key === null) {
      return true;
    }
    if (seen.has(entry.key)) {
      return false;
    }
    seen.add(entry.key);
    return true;
  });
}

/**
 * Enquiry counts and reply statistics for one supplier over a window.
 *
 * The window is whole UTC days ending today (see getWindowBounds), so these
 * figures line up exactly with the per-day chart series.
 *
 * `enquiries` counts customers, once each, across three real flows:
 * customer-initiated messenger conversations, quote requests naming the
 * supplier, and contact-form enquiries. (The last two are stored against the
 * supplier but are not yet shown to them anywhere in the product, which is why
 * they are reported separately in `sources`.) Quote requests are anonymous
 * public submissions, so anyone can name any supplier; treat the figure as
 * "requests received". `responses` is computed from the messenger conversations
 * only, because that is the only channel in which a reply is recorded.
 *
 * Results are reused for 30 seconds per (supplier, window) when `now` is not
 * supplied, because one dashboard load asks several endpoints for the same figures.
 *
 * @param {Object} params - Inputs
 * @param {string} params.supplierId - Supplier id
 * @param {string} params.ownerUserId - The supplier owner's user id
 * @param {number} params.days - Window length in days
 * @param {Date} [params.now] - Reference time (disables result reuse)
 * @returns {Promise<{enquiries: Object, responses: Object, enquiryTimestamps: number[]}>}
 *   `enquiryTimestamps` (current window, all sources) feeds the per-day chart series.
 */
async function getEngagementMetrics({ supplierId, ownerUserId, days, now }) {
  const cacheKey = `${supplierId}|${ownerUserId}|${days}`;
  if (!now) {
    const cached = engagementCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }
  }
  const value = await computeEngagementMetrics({
    supplierId,
    ownerUserId,
    days,
    now: now || new Date(),
  });
  if (!now) {
    if (engagementCache.size >= CACHE_MAX_ENTRIES) {
      engagementCache.delete(engagementCache.keys().next().value);
    }
    engagementCache.set(cacheKey, { at: Date.now(), value });
  }
  return value;
}

/**
 * Forget reused results (used by tests and after writes that must show at once).
 *
 * @returns {void}
 */
function clearEngagementCache() {
  engagementCache.clear();
}

/**
 * Compute engagement metrics without any result reuse.
 *
 * @param {Object} params - Inputs (see getEngagementMetrics)
 * @param {string} params.supplierId - Supplier id
 * @param {string} params.ownerUserId - The supplier owner's user id
 * @param {number} params.days - Window length in days
 * @param {Date} params.now - Reference time
 * @returns {Promise<{enquiries: Object, responses: Object, enquiryTimestamps: number[]}>}
 */
async function computeEngagementMetrics({ supplierId, ownerUserId, days, now }) {
  const nowMs = now.getTime();
  const { startMs: windowStartMs, previousStartMs } = getWindowBounds(nowMs, days);

  const [conversationResult, quoteEntries, contactEntries, handledRows] = await Promise.all([
    loadConversationEnquiries(ownerUserId, previousStartMs),
    loadQuoteRequestEntries(supplierId, previousStartMs),
    loadContactFormEntries(supplierId, previousStartMs),
    dbUnified.find(ENQUIRY_STATES_COLLECTION, { supplierId }, STRICT),
  ]);

  // The supplier's own list of quote requests and contact-form enquiries (GET
  // /api/supplier/enquiries) for the same window: raw records, not de-duplicated.
  const handledIds = new Set(
    (handledRows || []).filter(row => row.status !== 'new').map(row => row.enquiryId)
  );
  const requestsInWindow = [...quoteEntries, ...contactEntries].filter(
    entry => entry.ms >= windowStartMs && entry.ms <= nowMs
  );

  const allEntries = [
    ...conversationResult.enquiries.map(enquiry => ({
      ms: enquiry.createdMs,
      key: customerKey(enquiry.customerId, null),
      source: 'conversations',
    })),
    ...quoteEntries,
    ...contactEntries,
  ];
  const current = dedupeEnquiries(
    allEntries.filter(entry => entry.ms >= windowStartMs && entry.ms <= nowMs)
  );
  const previous = dedupeEnquiries(
    allEntries.filter(entry => entry.ms >= previousStartMs && entry.ms < windowStartMs)
  );
  const countFrom = source => current.filter(entry => entry.source === source).length;

  const currentConversations = conversationResult.enquiries.filter(
    enquiry => enquiry.createdMs >= windowStartMs && enquiry.createdMs <= nowMs
  );

  return {
    enquiries: {
      newThisPeriod: current.length,
      previousPeriod: previous.length,
      sources: {
        conversations: countFrom('conversations'),
        quoteRequests: countFrom('quoteRequests'),
        contactForm: countFrom('contactForm'),
      },
      truncated: conversationResult.truncated,
      requests: {
        received: requestsInWindow.length,
        new: requestsInWindow.filter(entry => !handledIds.has(entry.id)).length,
      },
    },
    responses: summariseResponses(currentConversations, nowMs),
    enquiryTimestamps: current.map(entry => entry.ms),
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
      { limit: MAX_UNREAD_CONVERSATIONS, throwOnError: true }
    ),
    dbUnified.findWithOptions(
      'conversations_v4',
      { ...activeFilter, messageCount: { $gt: 0 } },
      { limit: 1, sort: { updatedAt: -1 }, throwOnError: true }
    ),
    dbUnified.count('conversations_v4', { ...activeFilter, messageCount: { $gt: 0 } }, STRICT),
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

  const latest = newest?.[0];
  const latestMs = latest ? toMillis(latest.lastMessage?.sentAt || latest.updatedAt) : null;

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
  dedupeEnquiries,
  customerKey,
  getEngagementMetrics,
  clearEngagementCache,
  getMessagingSummary,
};
