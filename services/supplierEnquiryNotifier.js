/**
 * Tells a supplier that a customer has contacted them.
 *
 * A contact-form enquiry or a quote request is saved against the supplier, and the customer is
 * told the supplier "will be in touch". Until now the supplier only found out by opening their
 * dashboard. This puts a notification in their bell and sends one email to the account owner.
 *
 * - The bell notification is created every time.
 * - The email goes only to the verified owner of the profile, and at most one per supplier every
 *   EMAIL_INTERVAL_MS, so a flood of enquiries (or spam) cannot flood a supplier's inbox.
 * - It never throws: telling the supplier must never make the customer's submission fail.
 */

'use strict';

const validator = require('validator');
const dbUnified = require('../db-unified');
const mongoDb = require('../db');
const logger = require('../utils/logger');
const NotificationService = require('./notification.service');
const postmark = require('../utils/postmark');

const EMAIL_INTERVAL_MS = 15 * 60 * 1000;
const PREVIEW_LENGTH = 200;
const ENQUIRIES_PATH = '/dashboard/supplier#sdh-enquiries';

/**
 * Turns a stored (HTML-escaped) value back into plain text of a safe length.
 *
 * @param {*} value - Stored text
 * @param {number} max - Longest result
 * @returns {string} Plain text, one line
 */
function plainText(value, max) {
  return validator
    .unescape(String(value || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Whether another email may go to this supplier yet.
 *
 * @param {Object} supplier - Supplier record
 * @param {number} nowMs - Current time in milliseconds
 * @returns {boolean} True when the last one was long enough ago
 */
function emailIsDue(supplier, nowMs) {
  const last = Date.parse(supplier.enquiryEmailLastSentAt || '');
  return Number.isNaN(last) || nowMs - last >= EMAIL_INTERVAL_MS;
}

async function createBellNotification(enquiry, supplier, deps) {
  const getDb = deps.getMongoDb || (() => mongoDb.getDb());
  const database = await getDb();
  if (!database) {
    return false;
  }
  const service = new NotificationService(database, deps.websocketServer || null);
  const isQuote = enquiry.kind === 'quote';
  await service.create({
    userId: supplier.ownerUserId,
    type: 'message',
    category: 'enquiry',
    title: isQuote
      ? `New quote request from ${enquiry.senderName}`
      : `New enquiry from ${enquiry.senderName}`,
    message: enquiry.preview,
    actionUrl: ENQUIRIES_PATH,
    actionText: 'View enquiry',
    metadata: { kind: enquiry.kind, supplierId: supplier.id },
  });
  return true;
}

async function sendOwnerEmail(enquiry, supplier, owner, deps) {
  const db = deps.db || dbUnified;
  const send = deps.sendMail || postmark.sendMail;
  const nowMs = (deps.now ? deps.now() : new Date()).getTime();

  if (!owner.email || owner.verified !== true) {
    return 'skipped';
  }
  if (!emailIsDue(supplier, nowMs)) {
    return 'throttled';
  }
  // Claim the slot with one conditional update: only the request that actually changes the record
  // sends. Two enquiries arriving together both read the supplier before either writes, so a
  // read-then-write check would let both through.
  const cutoff = new Date(nowMs - EMAIL_INTERVAL_MS).toISOString();
  const claimed = await db.updateOne(
    'suppliers',
    {
      id: supplier.id,
      $or: [
        { enquiryEmailLastSentAt: { $exists: false } },
        { enquiryEmailLastSentAt: null },
        { enquiryEmailLastSentAt: { $lt: cutoff } },
      ],
    },
    { $set: { enquiryEmailLastSentAt: new Date(nowMs).toISOString() } }
  );
  if (!claimed) {
    return 'throttled';
  }

  const baseUrl = String(process.env.BASE_URL || 'https://event-flow.co.uk').replace(/\/+$/, '');
  const label = enquiry.kind === 'quote' ? 'a quote request' : 'an enquiry';
  await send({
    to: owner.email,
    subject: `New ${enquiry.kind === 'quote' ? 'quote request' : 'enquiry'} from ${enquiry.senderName}`,
    template: 'new-enquiry',
    templateData: {
      senderName: enquiry.senderName,
      enquiryLabel: label,
      previewHtml: validator.escape(enquiry.preview) || '&nbsp;',
      enquiryUrl: `${baseUrl}${ENQUIRIES_PATH}`,
    },
    text: `${enquiry.senderName} sent you ${label} through your EventFlow profile:\n\n"${enquiry.preview}"\n\nView the enquiry: ${baseUrl}${ENQUIRIES_PATH}\n\nReply to them directly using the contact details in the enquiry.`,
    from: postmark.FROM_NOREPLY,
    tags: ['supplier-enquiry', 'transactional'],
    messageStream: 'outbound',
  });
  return 'sent';
}

/**
 * @param {Object} enquiry
 * @param {string} enquiry.supplierId - The supplier contacted
 * @param {'contact'|'quote'} enquiry.kind - Where it came from
 * @param {string} enquiry.senderName - The customer's name (stored, escaped)
 * @param {string} enquiry.message - What they wrote (stored, escaped)
 * @param {Object} [deps] - Test seams: db, sendMail, getMongoDb, websocketServer, now
 * @returns {Promise<{bell: boolean, email: string}>} What was done; email is sent, throttled,
 *   skipped (no verified owner address) or failed
 */
async function notifySupplierOfEnquiry(enquiry, deps = {}) {
  const result = { bell: false, email: 'skipped' };
  try {
    const db = deps.db || dbUnified;
    const supplier = await db.findOne('suppliers', { id: enquiry.supplierId });
    if (!supplier || !supplier.ownerUserId) {
      return result;
    }
    const owner = await db.findOne('users', { id: supplier.ownerUserId });
    if (!owner) {
      return result;
    }
    const prepared = {
      kind: enquiry.kind === 'quote' ? 'quote' : 'contact',
      senderName: plainText(enquiry.senderName, 80) || 'A customer',
      preview: plainText(enquiry.message, PREVIEW_LENGTH),
    };

    try {
      result.bell = await createBellNotification(prepared, supplier, deps);
    } catch (error) {
      logger.warn('[supplier-enquiry] bell notification failed:', error.message);
    }
    try {
      result.email = await sendOwnerEmail(prepared, supplier, owner, deps);
    } catch (error) {
      result.email = 'failed';
      logger.warn('[supplier-enquiry] email failed:', error.message);
    }
  } catch (error) {
    logger.warn('[supplier-enquiry] could not notify the supplier:', error.message);
  }
  return result;
}

module.exports = { notifySupplierOfEnquiry, emailIsDue, plainText, EMAIL_INTERVAL_MS };
