/**
 * Field filtering for admin data exports and admin API responses.
 *
 * Whole collection records carry credentials (password hashes, verification and
 * reset tokens, plan guest tokens) and private message text. None of that belongs
 * in a downloadable file or a JSON response, so it is removed here.
 */

'use strict';

// Any key whose name contains one of these words is a credential.
const SECRET_KEY_PATTERN = /password|token|secret|apikey/i;

// Edit history snapshots a copy of the record, so it can hold the same credentials.
const EXTRA_OMITTED_KEYS = new Set(['versionHistory', 'googleSub', 'facebookSub']);

// Message records keep only who, when and where; the text itself stays private.
const MESSAGE_METADATA_KEYS = [
  'id',
  '_id',
  'threadId',
  'conversationId',
  'fromUserId',
  'toUserId',
  'senderId',
  'recipientId',
  'createdAt',
  'updatedAt',
  'readAt',
  'status',
];

function isOmittedKey(key) {
  return SECRET_KEY_PATTERN.test(key) || EXTRA_OMITTED_KEYS.has(key);
}

/**
 * Copy of a record without credential fields.
 * @param {Object} record
 * @returns {Object}
 */
function stripSecretFields(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record;
  }
  const clean = {};
  for (const key of Object.keys(record)) {
    if (!isOmittedKey(key)) {
      clean[key] = record[key];
    }
  }
  return clean;
}

/**
 * Copy of a message record that keeps only its metadata.
 * @param {Object} message
 * @returns {Object}
 */
function stripMessageBody(message) {
  if (!message || typeof message !== 'object') {
    return message;
  }
  const clean = {};
  for (const key of MESSAGE_METADATA_KEYS) {
    if (message[key] !== undefined) {
      clean[key] = message[key];
    }
  }
  return clean;
}

module.exports = { stripSecretFields, stripMessageBody };
