/**
 * The local (file-backed) database runs a `$regex` filter in the Node process, where a pattern that
 * backtracks catastrophically would block every user's requests, and a filter can be assembled from
 * request data. `sanitizeRegExp` refuses such a pattern before a RegExp is built from it, while
 * leaving every pattern the application itself builds untouched.
 *
 * @jest-environment node
 */
'use strict';

const { MAX_PATTERN_LENGTH, sanitizeRegExp } = require('../../utils/sanitizeRegExp');
const { idsStillReferenced } = require('../../utils/photoStoredCopies');

// The escaping idiom the application uses for text it puts into a pattern
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('patterns that are accepted, unchanged', () => {
  test.each([
    ['a plain word', 'wedding'],
    ['an anchored word', '^abc$'],
    ['a character class with repeats', '[a-z0-9]+@[a-z]+\\.com'],
    ['dot-star', 'foo.*bar'],
    ['an optional group', '(?:v1/)?photos'],
    ['an optional group that repeats inside', '(?:[?#].*)?$'],
    ['an exact-count group', '(ab){3}'],
    ['alternation that is not repeated', '(cat|dog) food'],
    ['a lookahead', 'foo(?=bar)'],
    ['a named group', '(?<year>\\d{4})-\\d\\d'],
    ['an escaped metacharacter repeat', '\\(a\\+\\)\\+'],
    ['a bracketed repeat inside a class', '[(a+)]+'],
    ['escaped parentheses around a repeat are plain text', '\\(a+\\)+'],
    ['a group-like repeat inside a character class is plain text', '[(a+)+]'],
    ['two separate repeated groups, each simple', '(ab)+(cd)*'],
  ])('%s', (_name, pattern) => {
    expect(sanitizeRegExp(pattern)).toBe(pattern);
  });

  test('every $regex the photo cleanup builds to find what still uses an image', async () => {
    const filters = [];
    const dbUnified = {
      find: jest.fn(async (_collection, filter) => {
        filters.push(filter);
        return [];
      }),
    };

    await idsStillReferenced(dbUnified, ['opt_1.2-3', 'thumb_9', 'a(b)+c']);

    const patterns = filters.flatMap(filter =>
      filter.$or.map(clause => Object.values(clause)[0].$regex)
    );
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(sanitizeRegExp(pattern)).toBe(pattern);
    }
  });

  test('user text escaped the way the application escapes it, at its longest', () => {
    const text = '(a+)+$ [x] ^*?{1,}|\\'.repeat(8).slice(0, 160);
    expect(() => sanitizeRegExp(escapeRegExp(text))).not.toThrow();
  });

  test('a RegExp object has its source checked and returned', () => {
    expect(sanitizeRegExp(/abc/i)).toBe('abc');
  });
});

describe('patterns that are refused', () => {
  test.each([
    ['(a+)+$', 'a group that repeats, repeated'],
    ['(a*)*', 'a star inside a star'],
    ['(a|b)*c', 'alternation inside a star'],
    ['(a|a)+', 'overlapping alternation, repeated'],
    ['(.*a){2,}', 'an open count on a group that repeats inside'],
    ['((a+)b)*', 'a repeat two groups down'],
    ['(?:x+)+y', 'a non-capturing group'],
    ['(?<n>a+)+', 'a named group'],
    ['(a?)+', 'an optional inside a plus'],
    ['(?=(a+)+)b', 'inside a lookahead'],
  ])('%s (%s)', pattern => {
    expect(() => sanitizeRegExp(pattern)).toThrow(SyntaxError);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['an object', { $ne: 'x' }],
    ['an array', ['a']],
  ])('%s is not a pattern', (_name, value) => {
    expect(() => sanitizeRegExp(value)).toThrow(TypeError);
  });

  test('a pattern over the length limit', () => {
    expect(() => sanitizeRegExp('a'.repeat(MAX_PATTERN_LENGTH + 1))).toThrow(RangeError);
    expect(sanitizeRegExp('a'.repeat(MAX_PATTERN_LENGTH))).toHaveLength(MAX_PATTERN_LENGTH);
  });

  test('a refused pattern is rejected quickly, not run: the attack string never reaches a RegExp', () => {
    const started = Date.now();
    expect(() => sanitizeRegExp('(a+)+$')).toThrow();
    expect(Date.now() - started).toBeLessThan(50);
  });
});
