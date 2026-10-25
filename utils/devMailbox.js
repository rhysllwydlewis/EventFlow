/**
 * In-memory copy of the emails the app "sent" while no real mail provider was in use.
 *
 * The local outbox fallback in utils/postmark.js only ever writes metadata to disk (no recipient
 * address, subject or body: those carry verification links, reset links and text that users typed).
 * Where a full copy is wanted, that is, the browser tests that click the link in the verification
 * email, utils/previewSafety.js isFullOutboxAllowed() decides, and the copy is kept here, in this
 * process's memory, instead of in a file. It disappears when the process stops, is capped in size,
 * and is only readable through the test-only `GET /__e2e/mail` route (routes/e2e-test-support.js),
 * which answers 404 unless NODE_ENV is "test".
 */
'use strict';

const { extractAddresses } = require('./previewSafety');

const MAX_MESSAGES = 50;
const MAX_FIELD_LENGTH = 200000;

/** @type {Array<{id: string, receivedAt: number, to: string, from: string, subject: string, html: string, text: string}>} */
let messages = [];
let counter = 0;

/**
 * Cap a field so one huge message cannot fill the process memory.
 * @param {*} value - Field value
 * @returns {string} Text, at most MAX_FIELD_LENGTH characters
 */
function clip(value) {
  return typeof value === 'string' ? value.slice(0, MAX_FIELD_LENGTH) : '';
}

/**
 * Keep a copy of an email (oldest copies are dropped beyond MAX_MESSAGES).
 * @param {Object} email - { to, from, subject, html, text }
 * @returns {string} The id given to the copy
 */
function remember(email) {
  counter += 1;
  const entry = {
    id: `mail-${counter}`,
    receivedAt: Date.now(),
    to: clip(Array.isArray(email.to) ? email.to.join(',') : email.to),
    from: clip(email.from),
    subject: clip(email.subject),
    html: clip(email.html),
    text: clip(email.text),
  };
  messages.push(entry);
  if (messages.length > MAX_MESSAGES) {
    messages = messages.slice(-MAX_MESSAGES);
  }
  return entry.id;
}

/**
 * The newest remembered email addressed to `address` (case-insensitive) at or after `since`.
 * @param {string} address - Recipient address
 * @param {number} [since] - Epoch milliseconds; older messages are ignored
 * @returns {Object|null} The message, or null when there is none yet
 */
function findNewestTo(address, since = 0) {
  const wanted = String(address || '')
    .trim()
    .toLowerCase();
  if (!wanted) {
    return null;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.receivedAt < since) {
      return null;
    }
    if (extractAddresses(message.to).includes(wanted)) {
      return message;
    }
  }
  return null;
}

/** Forget every remembered email. */
function clear() {
  messages = [];
}

module.exports = { remember, findNewestTo, clear, MAX_MESSAGES };
