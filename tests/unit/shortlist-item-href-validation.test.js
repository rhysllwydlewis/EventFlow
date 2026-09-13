/**
 * Shortlist Item Href Validation Tests
 * Tests for isValidItemHref() helper (routes/shortlist.js) gating the
 * canonical link a saved supplier/package/listing renders with in the
 * shortlist drawer.
 */

'use strict';

describe('Shortlist Item Href Validation', () => {
  /**
   * Mock isValidItemHref function (extracted from routes/shortlist.js)
   */
  function isValidItemHref(href) {
    if (!href || typeof href !== 'string') {
      return false;
    }
    if (!href.startsWith('/') || href.startsWith('//')) {
      return false;
    }
    if (href.includes('..')) {
      return false;
    }
    if (href.startsWith('/supplier?id=') || href.startsWith('/category?slug=')) {
      return false;
    }
    return /^\/[a-zA-Z0-9\-._~/%?=&]*$/.test(href);
  }

  describe('valid hrefs', () => {
    it('accepts a canonical supplier profile path', () => {
      expect(isValidItemHref('/supplier/acme-events--0123456789abcdef')).toBe(true);
    });

    it('accepts a marketplace listing query link', () => {
      expect(isValidItemHref('/marketplace?listing=abc123')).toBe(true);
    });

    it('accepts a package detail path', () => {
      expect(isValidItemHref('/package/full-day-capture')).toBe(true);
    });
  });

  describe('legacy query forms are rejected', () => {
    it('rejects the legacy supplier id query form', () => {
      expect(isValidItemHref('/supplier?id=abc123')).toBe(false);
    });

    it('rejects the legacy category slug query form', () => {
      expect(isValidItemHref('/category?slug=venues')).toBe(false);
    });
  });

  describe('security — off-site and traversal attempts', () => {
    it('rejects protocol-relative URLs', () => {
      expect(isValidItemHref('//evil.example.com/phish')).toBe(false);
    });

    it('rejects absolute URLs with a scheme', () => {
      expect(isValidItemHref('https://evil.example.com')).toBe(false);
    });

    it('rejects javascript: pseudo-protocol', () => {
      expect(isValidItemHref('javascript:alert(1)')).toBe(false);
    });

    it('rejects path traversal', () => {
      expect(isValidItemHref('/supplier/../../etc/passwd')).toBe(false);
    });

    it('rejects paths without a leading slash', () => {
      expect(isValidItemHref('supplier/acme')).toBe(false);
    });
  });

  describe('invalid inputs', () => {
    it('rejects null', () => {
      expect(isValidItemHref(null)).toBe(false);
    });

    it('rejects undefined', () => {
      expect(isValidItemHref(undefined)).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidItemHref('')).toBe(false);
    });

    it('rejects non-string values', () => {
      expect(isValidItemHref(42)).toBe(false);
      expect(isValidItemHref({})).toBe(false);
    });
  });
});
