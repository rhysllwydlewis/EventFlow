/**
 * Supplier enquiries
 *
 * Gives a supplier a read (and "mark as read/handled") view of the customer
 * requests that were addressed to them but, until now, were stored where nobody
 * could see them:
 *
 *   - quote requests (`quoteRequests`, POST /api/quote-requests) whose
 *     `suppliers[]` names this supplier
 *   - contact-form enquiries (`enquiries`, POST /api/v1/contact-supplier)
 *
 * Messenger conversations are NOT part of this list: they already have their own
 * inbox. They are included in the CSV export, though.
 *
 * Access rules (enforced by the callers and by every query here):
 *   - every read is keyed by the supplier id taken from the authenticated session
 *   - a record that belongs to another supplier is indistinguishable from a
 *     record that does not exist (callers answer 404)
 *   - list items carry only what a card needs; contact details (email, phone) and
 *     the full message are returned by the detail read only
 *   - nothing in this module logs customer data
 *
 * The customer-submitted text is stored HTML-escaped (validator.escape) by the
 * routes that accept it. It is returned here as plain text; render it with
 * textContent, never as HTML.
 *
 * Handled/read state is per supplier, because one quote request can be sent to
 * several suppliers: it lives in `supplier_enquiry_states`, not on the request.
 */

'use strict';

const validator = require('validator');
const dbUnified = require('../db-unified');
const { getWindowBounds } = require('../utils/analyticsWindow');

const STRICT = Object.freeze({ throwOnError: true });

const STATES_COLLECTION = 'supplier_enquiry_states';
const STATUSES = Object.freeze(['new', 'read', 'handled']);
const SOURCES = Object.freeze({ quote_request: 'quote_request', contact_form: 'contact_form' });

const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 365;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_RECORDS_PER_SOURCE = 1000;
const MAX_EXPORT_CONVERSATIONS = 1000;
const PREVIEW_LENGTH = 140;
const EXPORT_MESSAGE_LENGTH = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Turn stored (HTML-escaped) customer text back into plain text.
 *
 * @param {*} value - Stored value
 * @returns {string|null} Plain text, or null when empty
 */
function plain(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = validator.unescape(String(value)).trim();
  return text === '' ? null : text;
}

/**
 * Shorten text for a list preview.
 *
 * @param {string|null} text - Plain text
 * @returns {string|null} Preview of at most PREVIEW_LENGTH characters
 */
function preview(text) {
  if (!text) {
    return null;
  }
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

/**
 * Which channel an enquiry id belongs to. Quote request ids start `qr_`,
 * contact-form ids start `enq_` (see the routes that create them).
 *
 * @param {string} id - Enquiry id
 * @returns {string|null} Source, or null for an unrecognised id
 */
function sourceOfId(id) {
  if (typeof id !== 'string' || id.length > 120) {
    return null;
  }
  if (id.startsWith('qr_')) {
    return SOURCES.quote_request;
  }
  if (id.startsWith('enq_')) {
    return SOURCES.contact_form;
  }
  return null;
}

/**
 * Normalise a stored quote request into the shared enquiry shape.
 *
 * @param {Object} doc - quoteRequests document
 * @returns {Object} Full normalised enquiry (before status is applied)
 */
function normaliseQuoteRequest(doc) {
  return {
    id: doc.id,
    source: SOURCES.quote_request,
    createdAt: doc.createdAt || null,
    customerName: plain(doc.name),
    email: plain(doc.email),
    phone: plain(doc.phone),
    message: plain(doc.notes),
    eventType: plain(doc.eventType),
    eventDate: doc.eventDate || null,
    location: plain(doc.location),
    budget: plain(doc.budget),
  };
}

/**
 * Normalise a stored contact-form enquiry into the shared enquiry shape.
 *
 * @param {Object} doc - enquiries document
 * @returns {Object} Full normalised enquiry (before status is applied)
 */
function normaliseContactEnquiry(doc) {
  return {
    id: doc.id,
    source: SOURCES.contact_form,
    createdAt: doc.createdAt || null,
    customerName: plain(doc.senderName),
    email: plain(doc.senderEmail),
    phone: null,
    message: plain(doc.message),
    eventType: null,
    eventDate: null,
    location: null,
    budget: null,
  };
}

/**
 * The fields a list card gets: no email, phone or full message.
 *
 * @param {Object} enquiry - Full normalised enquiry
 * @param {string} status - new | read | handled
 * @returns {Object} List item
 */
function toListItem(enquiry, status) {
  return {
    id: enquiry.id,
    source: enquiry.source,
    createdAt: enquiry.createdAt,
    status,
    customerName: enquiry.customerName,
    preview: preview(enquiry.message),
    eventType: enquiry.eventType,
    eventDate: enquiry.eventDate,
  };
}

/**
 * Load this supplier's read/handled states as a map of enquiry id -> status.
 *
 * @param {string} supplierId - Supplier id
 * @returns {Promise<Map<string, string>>} States
 */
async function loadStates(supplierId) {
  const rows = (await dbUnified.find(STATES_COLLECTION, { supplierId }, STRICT)) || [];
  return new Map(
    rows.filter(row => STATUSES.includes(row.status)).map(row => [row.enquiryId, row.status])
  );
}

/**
 * Quote requests addressed to a supplier since a point in time (newest first).
 * The database selects by supplier and projects only the needed fields.
 *
 * @param {string} supplierId - Supplier id
 * @param {number} sinceMs - Earliest creation time
 * @returns {Promise<Object[]>} Normalised enquiries
 */
async function loadQuoteRequests(supplierId, sinceMs) {
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
        { $sort: { createdAt: -1 } },
        { $limit: MAX_RECORDS_PER_SOURCE },
        {
          $project: {
            id: 1,
            createdAt: 1,
            name: 1,
            email: 1,
            phone: 1,
            notes: 1,
            eventType: 1,
            eventDate: 1,
            location: 1,
            budget: 1,
          },
        },
      ],
      STRICT
    )) || [];
  return rows.filter(row => sourceOfId(row.id)).map(normaliseQuoteRequest);
}

/**
 * Contact-form enquiries addressed to a supplier since a point in time (newest first).
 *
 * @param {string} supplierId - Supplier id
 * @param {number} sinceMs - Earliest creation time
 * @returns {Promise<Object[]>} Normalised enquiries
 */
async function loadContactEnquiries(supplierId, sinceMs) {
  const rows =
    (await dbUnified.findWithOptions(
      'enquiries',
      { supplierId, createdAt: { $gte: new Date(sinceMs).toISOString() } },
      { limit: MAX_RECORDS_PER_SOURCE, sort: { createdAt: -1 }, throwOnError: true }
    )) || [];
  return rows.filter(row => sourceOfId(row.id)).map(normaliseContactEnquiry);
}

/**
 * Clamp the list query parameters to safe values.
 *
 * @param {Object} query - Raw query parameters
 * @returns {{days: number, page: number, limit: number, status: (string|null), source: (string|null)}}
 */
function parseListQuery(query) {
  /**
   * Parse a whole-number query value, falling back and clamping into [min, max].
   *
   * @param {*} value - Raw value
   * @param {number} fallback - Used when the value is missing or not a whole number
   * @param {number} min - Lowest allowed value
   * @param {number} max - Highest allowed value
   * @returns {number} Clamped integer
   */
  const whole = (value, fallback, min, max) => {
    const parsed = /^\d{1,9}$/.test(String(value || '')) ? parseInt(value, 10) : fallback;
    return Math.min(Math.max(parsed, min), max);
  };
  return {
    days: whole(query.days, DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS),
    page: whole(query.page, 1, 1, 100000),
    limit: whole(query.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    status: STATUSES.includes(query.status) ? query.status : null,
    source: Object.values(SOURCES).includes(query.source) ? query.source : null,
  };
}

/**
 * Page of enquiries for one supplier, newest first, with counts for the window.
 *
 * `counts.total` and `counts.new` use the same whole-UTC-day window as the
 * dashboard summary's `enquiries.requests` for the same `days`, so the two always
 * agree. Counts ignore the status/source filters (they describe the whole window).
 *
 * @param {Object} params - Inputs
 * @param {string} params.supplierId - Supplier id (from the session, never from the request)
 * @param {Object} params.query - Raw query parameters (days, page, limit, status, source)
 * @param {Date} [params.now] - Reference time
 * @returns {Promise<Object>} List payload
 */
async function listEnquiries({ supplierId, query, now = new Date() }) {
  const options = parseListQuery(query || {});
  const { startMs } = getWindowBounds(now.getTime(), options.days);

  const [quotes, contacts, states] = await Promise.all([
    loadQuoteRequests(supplierId, startMs),
    loadContactEnquiries(supplierId, startMs),
    loadStates(supplierId),
  ]);

  const all = [...quotes, ...contacts]
    .map(enquiry => ({ enquiry, status: states.get(enquiry.id) || 'new' }))
    .sort((first, second) =>
      String(second.enquiry.createdAt).localeCompare(first.enquiry.createdAt)
    );

  const counts = {
    total: all.length,
    new: all.filter(item => item.status === 'new').length,
    bySource: {
      quoteRequests: quotes.length,
      contactForm: contacts.length,
    },
  };

  const filtered = all.filter(
    item =>
      (!options.status || item.status === options.status) &&
      (!options.source || item.enquiry.source === options.source)
  );
  const offset = (options.page - 1) * options.limit;
  const totalPages = Math.max(1, Math.ceil(filtered.length / options.limit));

  return {
    enquiries: filtered
      .slice(offset, offset + options.limit)
      .map(item => toListItem(item.enquiry, item.status)),
    counts,
    pagination: {
      page: options.page,
      limit: options.limit,
      total: filtered.length,
      totalPages,
    },
    window: { days: options.days },
  };
}

/**
 * One enquiry in full, only if it was addressed to this supplier.
 *
 * @param {string} supplierId - Supplier id (from the session)
 * @param {string} id - Enquiry id
 * @returns {Promise<Object|null>} Full enquiry with status, or null (unknown or not theirs)
 */
async function getEnquiry(supplierId, id) {
  const source = sourceOfId(id);
  if (!source) {
    return null;
  }
  let doc = null;
  if (source === SOURCES.quote_request) {
    doc = await dbUnified.findOne(
      'quoteRequests',
      { id, 'suppliers.supplierId': supplierId },
      STRICT
    );
  } else {
    doc = await dbUnified.findOne('enquiries', { id, supplierId }, STRICT);
  }
  if (!doc) {
    return null;
  }
  const enquiry =
    source === SOURCES.quote_request ? normaliseQuoteRequest(doc) : normaliseContactEnquiry(doc);
  const states = await loadStates(supplierId);
  return { ...enquiry, status: states.get(id) || 'new' };
}

/**
 * Set a supplier's read/handled state for one enquiry.
 *
 * @param {string} supplierId - Supplier id (from the session)
 * @param {string} id - Enquiry id
 * @param {string} status - new | read | handled
 * @returns {Promise<Object|null>} Updated enquiry, or null when it is not theirs
 */
async function setEnquiryStatus(supplierId, id, status) {
  const enquiry = await getEnquiry(supplierId, id);
  if (!enquiry) {
    return null;
  }
  const stateId = `${supplierId}:${id}`;
  const now = new Date().toISOString();
  const existing = await dbUnified.findOne(STATES_COLLECTION, { id: stateId }, STRICT);
  if (existing) {
    await dbUnified.updateOne(
      STATES_COLLECTION,
      { id: stateId },
      { $set: { status, updatedAt: now } }
    );
  } else {
    await dbUnified.insertOne(STATES_COLLECTION, {
      id: stateId,
      supplierId,
      enquiryId: id,
      source: enquiry.source,
      status,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { ...enquiry, status };
}

/**
 * Display name for a user row, matching the messenger's rule (personal name first).
 *
 * @param {Object} user - users document (projected)
 * @returns {string|null} Name
 */
function userDisplayName(user) {
  const full = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return full || user.name || user.displayName || user.businessName || null;
}

/**
 * Rows for the CSV export: this supplier's messenger conversations with customers
 * plus their quote requests and contact-form enquiries, newest first.
 *
 * Conversation rows carry no email or phone (the messenger does not give those to
 * the supplier) and only a short preview of the last message. Supplier-to-supplier
 * and admin conversations are not exported.
 *
 * @param {Object} params - Inputs
 * @param {string} params.supplierId - Supplier id (from the session)
 * @param {string} params.ownerUserId - The supplier owner's user id
 * @returns {Promise<Array<Array<*>>>} Rows matching EXPORT_HEADERS
 */
async function buildExportRows({ supplierId, ownerUserId }) {
  const sinceMs = Date.now() - MAX_WINDOW_DAYS * 5 * DAY_MS;
  const [quotes, contacts, states, conversations] = await Promise.all([
    loadQuoteRequests(supplierId, sinceMs),
    loadContactEnquiries(supplierId, sinceMs),
    loadStates(supplierId),
    dbUnified.findWithOptions(
      'conversations_v4',
      { 'participants.userId': ownerUserId, messageCount: { $gt: 0 } },
      { limit: MAX_EXPORT_CONVERSATIONS, sort: { updatedAt: -1 }, throwOnError: true }
    ),
  ]);

  const customerConversations = (conversations || []).filter(conversation =>
    (conversation.participants || []).some(
      participant => participant.role === 'customer' && participant.userId !== ownerUserId
    )
  );
  const customerIds = [
    ...new Set(
      customerConversations.flatMap(conversation =>
        conversation.participants
          .filter(participant => participant.role === 'customer')
          .map(participant => participant.userId)
      )
    ),
  ];
  const users = customerIds.length
    ? (await dbUnified.aggregate(
        'users',
        [
          { $match: { id: { $in: customerIds } } },
          {
            $project: {
              id: 1,
              firstName: 1,
              lastName: 1,
              name: 1,
              displayName: 1,
              businessName: 1,
            },
          },
        ],
        STRICT
      )) || []
    : [];
  const userNames = new Map(users.map(user => [user.id, userDisplayName(user)]));

  const conversationRows = customerConversations.map(conversation => {
    const customer = conversation.participants.find(
      participant => participant.role === 'customer' && participant.userId !== ownerUserId
    );
    const mine = conversation.participants.find(participant => participant.userId === ownerUserId);
    const last = conversation.lastMessage && conversation.lastMessage.content;
    return {
      at: conversation.createdAt,
      row: [
        conversation.createdAt,
        'Conversation',
        userNames.get(customer.userId) || customer.displayName || '',
        '',
        '',
        '',
        '',
        '',
        '',
        conversation.status === 'closed' ? 'Closed' : 'Open',
        last ? String(last).slice(0, EXPORT_MESSAGE_LENGTH) : '',
        mine ? Number(mine.unreadCount) || 0 : 0,
      ],
    };
  });

  const enquiryRows = [...quotes, ...contacts].map(enquiry => {
    const status = states.get(enquiry.id) || 'new';
    return {
      at: enquiry.createdAt,
      row: [
        enquiry.createdAt,
        enquiry.source === SOURCES.quote_request ? 'Quote request' : 'Contact form',
        enquiry.customerName || '',
        enquiry.email || '',
        enquiry.phone || '',
        enquiry.eventType || '',
        enquiry.eventDate || '',
        enquiry.location || '',
        enquiry.budget || '',
        status === 'handled' ? 'Handled' : status === 'read' ? 'Read' : 'New',
        enquiry.message ? enquiry.message.slice(0, EXPORT_MESSAGE_LENGTH) : '',
        '',
      ],
    };
  });

  return [...conversationRows, ...enquiryRows]
    .sort((first, second) => new Date(second.at) - new Date(first.at))
    .map(item =>
      item.row.map((cell, index) => (index === 0 || index === 6 ? isoDate(cell) : cell))
    );
}

/**
 * Date part (YYYY-MM-DD, UTC) of a timestamp, or an empty string.
 *
 * @param {Date|string|null} value - Timestamp
 * @returns {string} Date text
 */
function isoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/** Column labels of the CSV export, in order. */
const EXPORT_HEADERS = [
  'Date',
  'Type',
  'Customer',
  'Email',
  'Phone',
  'Event type',
  'Event date',
  'Location',
  'Budget',
  'Status',
  'Message (preview)',
  'Unread messages',
];

module.exports = {
  STATUSES,
  EXPORT_HEADERS,
  sourceOfId,
  parseListQuery,
  listEnquiries,
  getEnquiry,
  setEnquiryStatus,
  buildExportRows,
};
