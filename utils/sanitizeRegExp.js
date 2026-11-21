'use strict';

/**
 * Checks a regular expression pattern before the local (file-backed) database builds a RegExp from
 * it.
 *
 * The local store supports MongoDB's `$regex` filter operator for development and for the fallback
 * when MongoDB is not connected. A filter can be assembled from request data, so the pattern is not
 * always one of ours. MongoDB itself runs `$regex` inside the database; the local store runs it in
 * the Node process, where a pattern that backtracks catastrophically (`(a+)+$` against a long
 * string) would block the event loop for every user. A pattern is therefore refused when it:
 *
 *  - is not a string (or a RegExp, whose source is checked),
 *  - is longer than MAX_PATTERN_LENGTH, or
 *  - repeats a group that itself repeats or alternates: `(a+)+`, `(a*)*`, `(a|b)*`, `(a|a)+`,
 *    `(.*a){2,}`. A group followed only by `?` or an exact count is fine, which is what the
 *    patterns the application builds use, e.g. `(?:v1/)?` or `(?:[?#].*)?`.
 *
 * This is a conservative structural check, not a proof that a pattern is fast: it does not catch
 * every polynomial case, which the length limit bounds instead.
 */

const MAX_PATTERN_LENGTH = 1000;

/** Marks a group that repeated or alternated inside, so an enclosing repeat can be refused. */
const NESTED = '#';
const INNERMOST_GROUP = /\(([^()]*)\)([*+]|\{\d+,\d*\}|\?|\{\d+\})?/;
const REPEATS_OR_ALTERNATES = new RegExp(`[*+?{|${NESTED}]`);

/**
 * @param {string|RegExp} pattern - The `$regex` pattern
 * @returns {string} The pattern source, unchanged, when it is acceptable
 * @throws {TypeError} When the pattern is not a string or RegExp
 * @throws {RangeError} When the pattern is too long
 * @throws {SyntaxError} When the pattern repeats a group that repeats or alternates
 */
function sanitizeRegExp(pattern) {
  const source = pattern instanceof RegExp ? pattern.source : pattern;
  if (typeof source !== 'string') {
    throw new TypeError('A $regex pattern must be a string');
  }
  if (source.length > MAX_PATTERN_LENGTH) {
    throw new RangeError(`A $regex pattern cannot be longer than ${MAX_PATTERN_LENGTH} characters`);
  }

  // Look at structure only: escaped characters and character classes are plain characters, and a
  // group's prefix (?: (?= (?<name> is not a quantifier
  let structure = source
    .replace(/\\./g, '_')
    .replace(/\[(?:[^\]\\]|\\.)*\]/g, '_')
    .replace(/\(\?(?:<?[=!]|:|<[^>]+>)/g, '(');

  // Resolve groups from the inside out, so a repeat is judged against everything inside it
  for (
    let match = INNERMOST_GROUP.exec(structure);
    match;
    match = INNERMOST_GROUP.exec(structure)
  ) {
    const [whole, body, quantifier] = match;
    const innerVaries = REPEATS_OR_ALTERNATES.test(body);
    const repeats = Boolean(quantifier) && quantifier !== '?' && !/^\{\d+\}$/.test(quantifier);
    if (innerVaries && repeats) {
      throw new SyntaxError(
        'A $regex pattern cannot repeat a group that itself repeats or alternates'
      );
    }
    structure = structure.replace(whole, innerVaries || quantifier ? NESTED : '_');
  }
  return source;
}

module.exports = { MAX_PATTERN_LENGTH, sanitizeRegExp };
