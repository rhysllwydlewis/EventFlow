/**
 * Unit tests for middleware/searchCache.js's generateCacheKey — a pure
 * hashing helper with no prior test coverage, added alongside the
 * MD5→SHA-256 switch (DeepSource JS-D003) so the changed line is actually
 * exercised, not just referenced by string-matching in other tests.
 */

'use strict';

const { generateCacheKey } = require('../../middleware/searchCache');

describe('searchCache.generateCacheKey', () => {
  it('returns a "search:v2:" prefixed hex digest', () => {
    const key = generateCacheKey({ path: '/api/v2/search', query: { q: 'wedding' }, body: null });
    expect(key).toMatch(/^search:v2:[0-9a-f]{64}$/);
  });

  it('is stable regardless of query key order', () => {
    const a = generateCacheKey({ path: '/api/v2/search', query: { a: 1, b: 2 }, body: null });
    const b = generateCacheKey({ path: '/api/v2/search', query: { b: 2, a: 1 }, body: null });
    expect(a).toBe(b);
  });

  it('differs for different paths', () => {
    const a = generateCacheKey({ path: '/api/v2/search', query: {}, body: null });
    const b = generateCacheKey({ path: '/api/v2/autocomplete', query: {}, body: null });
    expect(a).not.toBe(b);
  });
});
