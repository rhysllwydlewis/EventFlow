'use strict';

const { stripHtml } = require('../../utils/helpers');

describe('utils/helpers stripHtml', () => {
  test.each([
    ['<p>hello <b>world</b></p>', 'hello world'],
    ['plain text', 'plain text'],
    ['a <3 b', 'a 3 b'],
    ['1 > 0', '1  0'],
    ['<a<b>c', 'c'],
    ['x<y', 'xy'],
    ['<script>alert(1)</script>safe', 'alert(1)safe'],
    ['<<>>', ''],
    ['', ''],
  ])('%j becomes %j', (input, expected) => {
    expect(stripHtml(input)).toBe(expected);
  });

  test('turns other values into text first', () => {
    expect(stripHtml(123)).toBe('123');
    expect(stripHtml(null)).toBe('null');
  });

  test('a long run of "<" with no ">" stays fast (a /<[^>]*>/ regex is quadratic here)', () => {
    const started = Date.now();
    expect(stripHtml(`${'<'.repeat(200000)}text`)).toBe('text');
    expect(stripHtml('<a '.repeat(100000))).toBe('a '.repeat(100000));
    // A quadratic implementation needs tens of seconds for this input, so a few seconds of
    // headroom still catches it. The limit is generous because a busy CI runner running the whole
    // suite in parallel took 549 ms for what takes a fraction of that when the machine is idle.
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
