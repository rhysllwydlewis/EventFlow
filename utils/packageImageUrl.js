/**
 * Validation for package image URLs submitted by suppliers and admins.
 *
 * A package `image` is stored verbatim and later rendered by the public site, including inside
 * `<img src="...">` attributes. Anything that is not a plain image address (a `javascript:` or
 * `data:` URL, a value containing quotes or angle brackets that could break out of an attribute,
 * a protocol-relative `//host` address, an object instead of a string) must be rejected when it is
 * written, not only escaped when it is read.
 *
 * Base64 `data:image/...` uploads are not handled here: callers convert those to a stored file URL
 * first and only pass the resulting address (or a plain URL the caller typed) to this validator.
 */

'use strict';

/** Longest image address stored. */
const MAX_PACKAGE_IMAGE_URL_LENGTH = 2048;

/** Characters that never belong in an image address: whitespace, control characters, quotes, angle brackets, backslash, backtick. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\s\u0000-\u001f\u007f"'<>\\`]/u;

/** A path on this site: exactly one leading slash (so not `//host` and not `/\host`). */
const SITE_PATH = /^\/(?![/\\])/u;

/**
 * Parse an absolute URL.
 *
 * @param {string} text - The URL text
 * @returns {URL|null} The parsed URL, or null when it is not a valid absolute URL
 */
function parseUrl(text) {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/**
 * Check a package image URL.
 *
 * Accepts a path on this site (`/api/photos/<id>?w=640`, `/uploads/...`, `/assets/...`) or an
 * absolute `http(s)://` URL without embedded credentials. An empty string is valid and means
 * "no image".
 *
 * @param {*} value - The image value a caller submitted
 * @returns {{ok: true, value: string} | {ok: false, error: string}} The trimmed value to store, or why it was rejected
 */
function validatePackageImageUrl(value) {
  if (typeof value !== 'string') {
    return { ok: false, error: 'Image must be a URL string' };
  }
  const text = value.trim();
  if (!text) {
    return { ok: true, value: '' };
  }
  if (text.length > MAX_PACKAGE_IMAGE_URL_LENGTH) {
    return {
      ok: false,
      error: `Image URL must be at most ${MAX_PACKAGE_IMAGE_URL_LENGTH} characters`,
    };
  }
  if (FORBIDDEN_CHARS.test(text)) {
    return { ok: false, error: 'Image URL contains characters that are not allowed' };
  }
  if (SITE_PATH.test(text)) {
    return { ok: true, value: text };
  }
  const parsed = parseUrl(text);
  if (!parsed) {
    return { ok: false, error: 'Image must be a valid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Image URL must start with https:// or http://, or be a site path' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Image URL must not contain a username or password' };
  }
  return { ok: true, value: text };
}

module.exports = { validatePackageImageUrl, MAX_PACKAGE_IMAGE_URL_LENGTH };
