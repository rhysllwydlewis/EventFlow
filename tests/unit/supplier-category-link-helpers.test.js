'use strict';

/**
 * These client-side helpers are plain, dependency-free functions attached to
 * the global object (see the files themselves for why: they need to be
 * usable from both classic <script> tags and ES module pages without a
 * bundler). require()-ing them under Jest's node test environment attaches
 * them to Node's `global`, which is what `globalThis` resolves to in the
 * files themselves, so we can exercise the real shipped functions directly.
 */

require('../../public/assets/js/utils/supplier-link.js');
require('../../public/assets/js/utils/category-link.js');

const { supplierProfileHref } = global.EventFlowSupplierLink;
const { canonicalCategoryValue, categoryHref } = global.EventFlowCategoryLink;

describe('EventFlowSupplierLink.supplierProfileHref', () => {
  it('prefers a server-provided publicProfilePath', () => {
    expect(
      supplierProfileHref({
        id: 'sup_1',
        publicProfilePath: '/supplier/cwm-valley--abcdef0123456789',
      })
    ).toBe('/supplier/cwm-valley--abcdef0123456789');
  });

  it('falls back to the directory when publicProfilePath is absent', () => {
    expect(supplierProfileHref({ id: 'sup_1' })).toBe('/suppliers');
  });

  it('rejects malformed or unsafe server-provided paths', () => {
    expect(supplierProfileHref({ publicProfilePath: '/supplier/too-short--abc123' })).toBe(
      '/suppliers'
    );
    expect(supplierProfileHref({ publicProfilePath: 'https://evil.example/supplier/x' })).toBe(
      '/suppliers'
    );
  });

  it('falls back to /suppliers for a missing id', () => {
    expect(supplierProfileHref({})).toBe('/suppliers');
  });

  it('falls back to /suppliers for a null/undefined supplier', () => {
    expect(supplierProfileHref(null)).toBe('/suppliers');
    expect(supplierProfileHref(undefined)).toBe('/suppliers');
  });

  it('does not expose a bare supplierId field as a public URL', () => {
    expect(supplierProfileHref({ supplierId: 'sup_2' })).toBe('/suppliers');
  });
});

describe('EventFlowCategoryLink', () => {
  describe('canonicalCategoryValue', () => {
    it('prefers the canonical display name over the slug', () => {
      expect(canonicalCategoryValue({ slug: 'venues', name: 'Venues' })).toBe('Venues');
    });

    it('falls back to slug when name is absent', () => {
      expect(canonicalCategoryValue({ slug: 'venues' })).toBe('venues');
    });

    it('returns empty string for a missing category', () => {
      expect(canonicalCategoryValue(null)).toBe('');
      expect(canonicalCategoryValue(undefined)).toBe('');
    });
  });

  describe('categoryHref', () => {
    it('builds a /suppliers?category= link from the canonical name', () => {
      expect(categoryHref({ slug: 'venues', name: 'Venues' })).toBe('/suppliers?category=Venues');
    });

    it('URL-encodes category names with special characters', () => {
      expect(categoryHref({ slug: 'hair-makeup', name: 'Hair & Makeup' })).toBe(
        '/suppliers?category=Hair%20%26%20Makeup'
      );
    });

    it('falls back to the bare /suppliers listing when nothing is resolvable', () => {
      expect(categoryHref(null)).toBe('/suppliers');
      expect(categoryHref({})).toBe('/suppliers');
    });
  });
});
