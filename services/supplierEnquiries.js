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

const crypto = require('crypto');
const validator = require('validator');
const dbUnified = require('../db-unified');
const postmark = require('../utils/postmark');
const { calculateLeadScore } = require('../utils/leadScoring');
const { getWindowBounds } = require('../utils/analyticsWindow');

const STRICT = Object.freeze({ throwOnError: true });

const STATES_COLLECTION = 'supplier_enquiry_states';
const REPLIES_COLLECTION = 'supplier_enquiry_replies';
// A reply counts towards the limits from the moment it is reserved until it fails. A reservation
// still 'sending' after this long was lost (the server stopped mid-send) and stops counting.
const RESERVATION_TTL_MS = 5 * 60 * 1000;
const STATUSES = Object.freeze(['new', 'read', 'handled']);
const SOURCES = Object.freeze({ quote_request: 'quote_request', contact_form: 'contact_form' });
const QUALITIES = Object.freeze(['High', 'Medium', 'Low']);

/** What each lead-scoring flag means, in words a supplier can use. */
const QUALITY_REASONS = Object.freeze({
  'last-minute': 'The event is less than a month away',
  'too-far-future': 'The event is more than two years away',
  'no-event-date': 'No event date was given',
  'invalid-date': 'The event date could not be read',
  'invalid-phone': 'The phone number does not look right',
  'invalid-email': 'The email address does not look right',
  'short-message': 'The message is very short',
  'no-message': 'There is no message',
  'spam-keywords': 'The message contains phrases that spam often uses',
  'disposable-email': 'The email address is a throwaway one',
});

const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 365;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_RECORDS_PER_SOURCE = 1000;
const MAX_EXPORT_CONVERSATIONS = 1000;
const PREVIEW_LENGTH = 140;
const EXPORT_MESSAGE_LENGTH = 300;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const STATUS_WARNING =
  'Your reply was sent, but the enquiry could not be marked as handled. Please mark it yourself.';
const MAX_REPLY_LENGTH = 2000;
// A reply is an email from EventFlow to an address the customer typed into a form, so it is capped
// per enquiry, per supplier and by the enquiry's age, to stop it being used to mail strangers.
const MAX_REPLIES_PER_ENQUIRY = 3;
const MAX_REPLIES_PER_HOUR = 10;
const MAX_REPLIES_PER_DAY = 30;
const MAX_ENQUIRY_AGE_DAYS = 30;
const REPLIES_SHOWN = 10;

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
 * How likely an enquiry is to be a genuine, bookable one: an estimate from what the customer filled
 * in (utils/leadScoring.js, docs/LEAD-SCORING.md), worked out when it is read, never stored.
 *
 * @param {Object} enquiry - Full normalised enquiry
 * @returns {{rating: string, score: number, reasons: string[]}} High, Medium or Low, with why
 */
function qualityOf(enquiry) {
  const result = calculateLeadScore({
    email: enquiry.email || undefined,
    phone: enquiry.phone || undefined,
    eventDate: enquiry.eventDate || undefined,
    budget: enquiry.budget || undefined,
    message: enquiry.message || undefined,
  });
  return {
    rating: result.rating,
    score: result.score,
    reasons: result.flags.map(flag => QUALITY_REASONS[flag]).filter(Boolean),
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
    quality: qualityOf(enquiry).rating,
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
  return (await fetchQuoteRequestRows(supplierId, sinceMs, MAX_RECORDS_PER_SOURCE))
    .filter(row => sourceOfId(row.id))
    .map(normaliseQuoteRequest);
}

/**
 * The raw quote-request rows behind loadQuoteRequests, newest first, at most `limit` of them.
 *
 * @param {string} supplierId - Supplier id
 * @param {number} sinceMs - Earliest creation time
 * @param {number} limit - Most rows to read
 * @returns {Promise<Object[]>} Projected rows
 */
async function fetchQuoteRequestRows(supplierId, sinceMs, limit) {
  return (
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
        { $limit: limit },
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
    )) || []
  );
}

/**
 * Contact-form enquiries addressed to a supplier since a point in time (newest first).
 *
 * @param {string} supplierId - Supplier id
 * @param {number} sinceMs - Earliest creation time
 * @returns {Promise<Object[]>} Normalised enquiries
 */
async function loadContactEnquiries(supplierId, sinceMs) {
  return (await fetchContactEnquiryRows(supplierId, sinceMs, MAX_RECORDS_PER_SOURCE))
    .filter(row => sourceOfId(row.id))
    .map(normaliseContactEnquiry);
}

/**
 * The raw contact-form rows behind loadContactEnquiries, newest first, at most `limit` of them.
 *
 * @param {string} supplierId - Supplier id
 * @param {number} sinceMs - Earliest creation time
 * @param {number} limit - Most rows to read
 * @returns {Promise<Object[]>} Rows
 */
async function fetchContactEnquiryRows(supplierId, sinceMs, limit) {
  return (
    (await dbUnified.findWithOptions(
      'enquiries',
      { supplierId, createdAt: { $gte: new Date(sinceMs).toISOString() } },
      { limit, sort: { createdAt: -1 }, throwOnError: true }
    )) || []
  );
}

/**
 * Clamp the list query parameters to safe values.
 *
 * @param {Object} query - Raw query parameters
 * @returns {{days: number, page: number, limit: number, status: (string|null), source: (string|null), quality: (string|null)}}
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
    quality: QUALITIES.includes(query.quality) ? query.quality : null,
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

  // Rows dated in the future (or with no usable date) are not counted by the dashboard summary
  // either, so the list and the summary agree.
  const nowMs = now.getTime();
  const all = [...quotes, ...contacts]
    .filter(enquiry => {
      const created = Date.parse(enquiry.createdAt || '');
      return Number.isFinite(created) && created <= nowMs;
    })
    .map(enquiry => ({ enquiry, status: states.get(enquiry.id) || 'new' }))
    .sort((first, second) =>
      String(second.enquiry.createdAt).localeCompare(first.enquiry.createdAt)
    );

  const counts = {
    total: all.length,
    new: all.filter(item => item.status === 'new').length,
    bySource: {
      quoteRequests: all.filter(item => item.enquiry.source === SOURCES.quote_request).length,
      contactForm: all.filter(item => item.enquiry.source === SOURCES.contact_form).length,
    },
    byQuality: Object.fromEntries(
      QUALITIES.map(rating => [
        rating,
        all.filter(item => qualityOf(item.enquiry).rating === rating).length,
      ])
    ),
  };

  const filtered = all.filter(
    item =>
      (!options.status || item.status === options.status) &&
      (!options.source || item.enquiry.source === options.source) &&
      (!options.quality || qualityOf(item.enquiry).rating === options.quality)
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
  const replies = await loadReplies(supplierId, id);
  return { ...enquiry, status: states.get(id) || 'new', replies, quality: qualityOf(enquiry) };
}

/**
 * The replies this supplier has sent to one enquiry, oldest first.
 *
 * @param {string} supplierId - Supplier id (from the session)
 * @param {string} enquiryId - Enquiry id
 * @returns {Promise<Array<{id: string, message: string, sentAt: string}>>} Replies
 */
async function loadReplies(supplierId, enquiryId) {
  const rows = (await dbUnified.find(REPLIES_COLLECTION, { supplierId, enquiryId }, STRICT)) || [];
  return rows
    .filter(row => row.status === 'sent')
    .map(row => ({ id: row.id, message: row.message, sentAt: row.sentAt }))
    .sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)))
    .slice(-REPLIES_SHOWN);
}

/**
 * Plain text to HTML for the email: escaped, blank lines start a paragraph, single newlines
 * become line breaks.
 *
 * @param {string} text - Reply text
 * @returns {string} HTML
 */
function replyToHtml(text) {
  return text
    .split(/\n{2,}/)
    .map(paragraph => `<p>${validator.escape(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Clean reply text: line endings normalised, control characters removed, outer space trimmed.
 *
 * @param {*} value - Submitted text
 * @returns {string} Clean text (empty when nothing usable)
 */
function cleanReply(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return (
    value
      .replace(/\r\n?/gu, '\n')
      // eslint-disable-next-line no-control-regex -- removing control characters is the purpose
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
      .trim()
  );
}

/**
 * Send a supplier's reply to a customer's enquiry.
 *
 * The email is sent from EventFlow with the supplier's account address as Reply-To, so the
 * customer's answer reaches the supplier without the supplier's address being shown on the
 * page. Only a verified account address is used, only to the address the customer submitted
 * with that enquiry, and only for an enquiry addressed to this supplier. A reply is stored
 * only after the email was accepted, and marks the enquiry handled.
 *
 * @param {Object} params - Inputs
 * @param {Object} params.supplier - The supplier record (from the session)
 * @param {Object} params.owner - The signed-in owner's user record (id, email, verified)
 * @param {string} params.id - Enquiry id
 * @param {*} params.message - Reply text
 * @param {Object} [deps] - Test seams: sendMail, now
 * @returns {Promise<{ok: true, enquiry: Object}|{ok: false, code: string, message: string}>}
 *   code is one of NOT_FOUND, EMPTY, TOO_LONG, NO_EMAIL, EMAIL_NOT_VERIFIED, ENQUIRY_LIMIT,
 *   ENQUIRY_TOO_OLD, HOURLY_LIMIT, DAILY_LIMIT, SEND_FAILED
 */
async function replyToEnquiry({ supplier, owner, id, message }, deps = {}) {
  const fail = (code, text) => ({ ok: false, code, message: text });
  const text = cleanReply(message);
  if (!text) {
    return fail('EMPTY', 'Write a reply first.');
  }
  if (text.length > MAX_REPLY_LENGTH) {
    return fail('TOO_LONG', `Replies can be up to ${MAX_REPLY_LENGTH} characters.`);
  }
  const enquiry = await getEnquiry(supplier.id, id);
  if (!enquiry) {
    return fail('NOT_FOUND', 'Enquiry not found.');
  }
  if (!enquiry.email || !validator.isEmail(enquiry.email)) {
    return fail('NO_EMAIL', 'This customer did not leave an email address to reply to.');
  }
  if (!owner || !owner.email || !owner.verified) {
    return fail(
      'EMAIL_NOT_VERIFIED',
      'Verify your account email first, so the customer’s answer can reach you.'
    );
  }
  const nowMs = (deps.now ? deps.now() : new Date()).getTime();
  const created = Date.parse(enquiry.createdAt || '');
  if (Number.isNaN(created) || nowMs - created > MAX_ENQUIRY_AGE_DAYS * DAY_MS) {
    return fail(
      'ENQUIRY_TOO_OLD',
      `This enquiry is more than ${MAX_ENQUIRY_AGE_DAYS} days old. Contact the customer directly.`
    );
  }

  // The limits are checked before sending and again once this reply has reserved its place: two
  // requests that run at the same time both see the other's reservation on the second check, so
  // together they can never send more than the limit allows (at worst both back off).
  const overLimit = async () => {
    const counted = rows =>
      (rows || []).filter(
        row =>
          row.status === 'sent' ||
          (row.status === 'sending' && nowMs - Date.parse(row.sentAt || '') < RESERVATION_TTL_MS)
      ).length;
    const forEnquiry = counted(
      await dbUnified.find(REPLIES_COLLECTION, { supplierId: supplier.id, enquiryId: id }, STRICT)
    );
    if (forEnquiry > MAX_REPLIES_PER_ENQUIRY) {
      return fail(
        'ENQUIRY_LIMIT',
        `You have sent ${MAX_REPLIES_PER_ENQUIRY} replies to this enquiry. Carry on by email.`
      );
    }
    const sentSince = async since =>
      counted(
        await dbUnified.find(
          REPLIES_COLLECTION,
          {
            supplierId: supplier.id,
            sentAt: { $gte: new Date(nowMs - since).toISOString() },
          },
          STRICT
        )
      );
    if ((await sentSince(HOUR_MS)) > MAX_REPLIES_PER_HOUR) {
      return fail('HOURLY_LIMIT', 'You have sent a lot of replies this hour. Try again later.');
    }
    if ((await sentSince(DAY_MS)) > MAX_REPLIES_PER_DAY) {
      return fail('DAILY_LIMIT', 'You have reached today’s limit for replies. Try again tomorrow.');
    }
    return null;
  };

  const replyId = `rep_${crypto.randomUUID()}`;
  const reservation = await dbUnified.insertOne(REPLIES_COLLECTION, {
    id: replyId,
    supplierId: supplier.id,
    enquiryId: id,
    message: text,
    status: 'sending',
    sentAt: new Date(nowMs).toISOString(),
  });
  if (!reservation) {
    return fail('SEND_FAILED', 'The reply could not be saved. Please try again.');
  }
  const release = async () => {
    const removed = await dbUnified.deleteOne(REPLIES_COLLECTION, { id: replyId });
    if (!removed) {
      // Could not remove it: mark it so it no longer counts or shows.
      await dbUnified.updateOne(
        REPLIES_COLLECTION,
        { id: replyId },
        { $set: { status: 'failed' } }
      );
    }
  };

  const limited = await overLimit();
  if (limited) {
    await release();
    return limited;
  }

  const supplierName = String(supplier.name || 'Your supplier')
    .replace(/\s+/g, ' ')
    .trim();
  const send = deps.sendMail || postmark.sendMail;
  try {
    await send({
      to: enquiry.email,
      replyTo: owner.email,
      subject: `${supplierName} replied to your enquiry`,
      template: 'supplier-enquiry-reply',
      // loadEmailTemplate escapes these itself; only the reply, built below, is already HTML.
      templateData: {
        customerName: enquiry.customerName || 'there',
        supplierName,
        replyMessageHtml: replyToHtml(text),
      },
      text: `${supplierName} replied to your enquiry on EventFlow:\n\n${text}\n\nReply to this email to answer them directly.`,
      from: postmark.FROM_NOREPLY,
      tags: ['supplier-enquiry-reply', 'transactional'],
      messageStream: 'outbound',
      // With no mail provider configured in production the message would only be written to a
      // local folder: report that as a failure rather than tell the supplier it was sent.
      criticalDelivery: true,
    });
  } catch {
    await release();
    return fail('SEND_FAILED', 'The reply could not be sent. Please try again.');
  }

  // From here the email has gone. Nothing below may turn that into a "failed to send": a step that
  // throws is reported as a warning on a successful reply, so the supplier does not send it again.
  try {
    await dbUnified.updateOne(
      REPLIES_COLLECTION,
      { id: replyId },
      { $set: { status: 'sent' } },
      { throwOnError: true }
    );
  } catch {
    // The reservation stays 'sending': it still counts towards the limits until it expires.
  }
  let updated = null;
  try {
    updated = await setEnquiryStatus(supplier.id, id, 'handled');
  } catch {
    updated = null;
  }
  // Without a saved status the enquiry keeps the state it had, not a "handled" nobody stored.
  return updated ? { ok: true, enquiry: updated } : { ok: true, enquiry, warning: STATUS_WARNING };
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
  const now = new Date().toISOString();
  // One document per supplier and enquiry, written in one step: two people (or a double click)
  // marking the same new enquiry at once must not create two documents.
  const saved = await dbUnified.upsertOne(
    STATES_COLLECTION,
    { id: `${supplierId}:${id}` },
    { supplierId, enquiryId: id, source: enquiry.source, status, updatedAt: now },
    { createdAt: now }
  );
  if (!saved) {
    throw new Error('Could not save the enquiry status');
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
 * @returns {Promise<Array<Array<*>>>} Rows matching EXPORT_HEADERS (see buildExport for the truncation flag)
 */
async function buildExportRows(params) {
  return (await buildExport(params)).rows;
}

/**
 * The export rows and whether any source was cut off at its cap.
 *
 * Each source (conversations, quote requests, contact enquiries) keeps its newest MAX rows. One
 * extra row is read from each so "exactly the cap" is not mistaken for "more than the cap".
 * Conversations the supplier deleted from their inbox are left out, as the messenger leaves them out.
 *
 * @param {Object} params - Inputs
 * @param {string} params.supplierId - Supplier id (from the session)
 * @param {string} params.ownerUserId - The supplier owner's user id
 * @returns {Promise<{rows: Array<Array<*>>, truncated: boolean}>} Data rows and the truncation flag
 */
async function buildExport({ supplierId, ownerUserId }) {
  const sinceMs = Date.now() - MAX_WINDOW_DAYS * 5 * DAY_MS;
  const [quoteRows, contactRows, states, conversationRows] = await Promise.all([
    fetchQuoteRequestRows(supplierId, sinceMs, MAX_RECORDS_PER_SOURCE + 1),
    fetchContactEnquiryRows(supplierId, sinceMs, MAX_RECORDS_PER_SOURCE + 1),
    loadStates(supplierId),
    dbUnified.findWithOptions(
      'conversations_v4',
      {
        participants: { $elemMatch: { userId: ownerUserId, isDeleted: { $ne: true } } },
        messageCount: { $gt: 0 },
      },
      { limit: MAX_EXPORT_CONVERSATIONS + 1, sort: { updatedAt: -1 }, throwOnError: true }
    ),
  ]);
  const conversations = conversationRows || [];
  const truncated =
    quoteRows.length > MAX_RECORDS_PER_SOURCE ||
    contactRows.length > MAX_RECORDS_PER_SOURCE ||
    conversations.length > MAX_EXPORT_CONVERSATIONS;
  const quotes = quoteRows
    .slice(0, MAX_RECORDS_PER_SOURCE)
    .filter(row => sourceOfId(row.id))
    .map(normaliseQuoteRequest);
  const contacts = contactRows
    .slice(0, MAX_RECORDS_PER_SOURCE)
    .filter(row => sourceOfId(row.id))
    .map(normaliseContactEnquiry);

  const customerConversations = conversations
    .slice(0, MAX_EXPORT_CONVERSATIONS)
    .filter(conversation => {
      const participants = conversation.participants || [];
      // The query already leaves out conversations the supplier deleted; checking again here keeps
      // the rule in one place a reader can see, whatever the store did with the filter.
      const mine = participants.find(participant => participant.userId === ownerUserId);
      return (
        Boolean(mine) &&
        mine.isDeleted !== true &&
        participants.some(
          participant => participant.role === 'customer' && participant.userId !== ownerUserId
        )
      );
    });
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

  const conversationExportRows = customerConversations.map(conversation => {
    const customer = conversation.participants.find(
      participant => participant.role === 'customer' && participant.userId !== ownerUserId
    );
    const mine = conversation.participants.find(participant => participant.userId === ownerUserId);
    const last = conversation.lastMessage?.content;
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

  const rows = [...conversationExportRows, ...enquiryRows]
    .sort((first, second) => new Date(second.at) - new Date(first.at))
    .map(item =>
      item.row.map((cell, index) => (index === 0 || index === 6 ? isoDate(cell) : cell))
    );
  return { rows, truncated };
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

/**
 * The last row of a truncated export, so the limit is visible in the spreadsheet itself.
 *
 * @returns {Array<*>} A row matching EXPORT_HEADERS
 */
function truncationNoticeRow() {
  const row = EXPORT_HEADERS.map(() => '');
  row[1] = 'Notice';
  row[10] = `This export is limited to the newest ${MAX_EXPORT_CONVERSATIONS} conversations, ${MAX_RECORDS_PER_SOURCE} quote requests and ${MAX_RECORDS_PER_SOURCE} contact enquiries. Older entries are not included.`;
  return row;
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

module.exports = {
  STATUSES,
  EXPORT_HEADERS,
  sourceOfId,
  parseListQuery,
  qualityOf,
  listEnquiries,
  getEnquiry,
  setEnquiryStatus,
  replyToEnquiry,
  MAX_REPLY_LENGTH,
  buildExportRows,
  buildExport,
  truncationNoticeRow,
  MAX_EXPORT_CONVERSATIONS,
  MAX_RECORDS_PER_SOURCE,
};
