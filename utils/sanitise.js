'use strict';

/**
 * Sanitise free-text input: trim, strip HTML tags, and enforce max length.
 * Iterates until no more tags are found to handle nested/malformed markup
 * (e.g. <script<script>> → <script> → empty string on successive passes).
 * Any lone `<` remaining after tag-stripping is removed to prevent unclosed
 * tags (e.g. a bare `<script` with no `>`) from leaking into stored text.
 *
 * Caps the input to `maxLength + 500` characters before running the regex loop
 * to bound worst-case regex work on adversarial long inputs (ReDoS mitigation).
 *
 * NOTE: This provides basic protection for stored text rendered in admin UI.
 * It is not a substitute for context-aware output escaping at render time.
 *
 * @param {string} input
 * @param {number} [maxLength=2000]
 * @returns {string}
 */
function sanitiseText(input, maxLength = 2000) {
  if (typeof input !== 'string') {
    return '';
  }
  // Cap early to bound regex work on adversarial long inputs
  let text = input.slice(0, maxLength + 500);
  let prev;
  let iterations = 0;
  const MAX_ITERATIONS = 20; // guard against adversarial deeply-nested tag input
  do {
    prev = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== prev && ++iterations < MAX_ITERATIONS);
  // Remove any remaining lone `<` (unclosed tags such as `<script` with no `>`)
  text = text.replace(/</g, '');
  return text.trim().slice(0, maxLength);
}

module.exports = { sanitiseText };
