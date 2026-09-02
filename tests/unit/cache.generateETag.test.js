/**
 * Unit tests for cache.js's generateETag — a pure hashing helper with no
 * prior test coverage, added alongside the MD5→SHA-256 switch (DeepSource
 * JS-D003) so the changed line is actually exercised, not just referenced
 * by string-matching in other tests.
 */

'use strict';

const cache = require('../../cache');

describe('cache.generateETag', () => {
  it('returns a quoted hex digest', () => {
    const etag = cache.generateETag({ id: 1, name: 'test' });
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it('is deterministic for the same input', () => {
    const data = { id: 1, name: 'test' };
    expect(cache.generateETag(data)).toBe(cache.generateETag({ ...data }));
  });

  it('differs for different input', () => {
    expect(cache.generateETag({ id: 1 })).not.toBe(cache.generateETag({ id: 2 }));
  });
});
