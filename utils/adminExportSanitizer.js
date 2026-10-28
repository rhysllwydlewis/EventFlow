/**
 * Field filtering for admin data exports and admin API responses.
 *
 * Whole collection records carry credentials (password hashes, verification and
 * reset tokens, plan guest tokens, 2FA secrets and backup codes) and private text
 * (message bodies, plan notes). None of that belongs in a downloadable file or a
 * JSON response, so it is removed here.
 */

'use strict';

// Any key whose name contains one of these words is a credential.
const SECRET_KEY_PATTERN = /password|token|secret|apikey|backupcode/i;

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

const MAX_DEPTH = 8;

function isOmittedKey(key) {
  return SECRET_KEY_PATTERN.test(key) || EXTRA_OMITTED_KEYS.has(key);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stripAtDepth(value, depth) {
  if (Array.isArray(value)) {
    return depth >= MAX_DEPTH ? value : value.map(item => stripAtDepth(item, depth + 1));
  }
  if (!isPlainObject(value) || depth >= MAX_DEPTH) {
    return value;
  }
  const clean = {};
  for (const key of Object.keys(value)) {
    if (!isOmittedKey(key)) {
      clean[key] = stripAtDepth(value[key], depth + 1);
    }
  }
  return clean;
}

/**
 * Copy of a record without credential fields, at any depth (nested objects and arrays).
 * Takes exactly one argument so it is safe to pass straight to Array.map, which would
 * otherwise hand the item index in as a second parameter.
 * @param {*} value
 * @returns {*}
 */
function stripSecretFields(value) {
  return stripAtDepth(value, 0);
}

/**
 * Builds a cleaner that removes credentials and then the named private-text fields.
 * @param {string[]} privateKeys - top-level fields whose content stays private
 * @returns {(record: Object) => Object}
 */
function withoutPrivateText(privateKeys) {
  return record => {
    const clean = stripSecretFields(record);
    if (!isPlainObject(clean)) {
      return clean;
    }
    for (const key of privateKeys) {
      delete clean[key];
    }
    return clean;
  };
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

module.exports = { stripSecretFields, stripMessageBody, withoutPrivateText };
