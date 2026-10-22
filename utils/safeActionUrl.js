/**
 * Where a notification may send the person who clicks it.
 *
 * Every notification the application writes points at one of its own pages. A notification's
 * address is followed by the browser when it is clicked, so anything but a page on this site (a
 * javascript: or data: address, another site, a protocol-relative address) must never be stored.
 */

'use strict';

/** Longest address stored. */
const MAX_ACTION_URL_LENGTH = 500;

/** A path on this site: one leading slash (not two, not a slash and a backslash), then no whitespace or backslash. */
const SITE_PATH = /^\/(?![/\\])[^\s\\]*$/;

/** Whether the text holds a control character (they have no place in an address). */
function hasControlCharacter(text) {
  return Array.from(text).some(char => {
    const code = char.codePointAt(0);
    return code < 32 || code === 127;
  });
}

/**
 * The address to store for a notification: a path on this site, or null.
 *
 * @param {*} value - The address a caller asked for
 * @returns {string|null} The path, or null when there is none or it is not a page on this site
 */
function safeActionUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  if (
    !text ||
    text.length > MAX_ACTION_URL_LENGTH ||
    !SITE_PATH.test(text) ||
    hasControlCharacter(text)
  ) {
    return null;
  }
  return text;
}

module.exports = { safeActionUrl, MAX_ACTION_URL_LENGTH };
