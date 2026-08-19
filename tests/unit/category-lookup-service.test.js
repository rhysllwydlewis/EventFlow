'use strict';

const { resolveCategoryName, normaliseToken } = require('../../services/categoryLookup.service');

const categories = [
  { id: 'cat-1', slug: 'venues', name: 'Venues' },
  { id: 'cat-2', slug: 'catering', name: 'Catering' },
  { id: 'cat-3', slug: 'hair-makeup', name: 'Hair & Makeup' },
];

describe('categoryLookup.service', () => {
  describe('normaliseToken', () => {
    it('trims and lowercases', () => {
      expect(normaliseToken('  Venues  ')).toBe('venues');
    });

    it('handles missing values', () => {
      expect(normaliseToken(undefined)).toBe('');
      expect(normaliseToken(null)).toBe('');
    });
  });

  describe('resolveCategoryName', () => {
    it('resolves a lowercase slug to its canonical display name', () => {
      expect(resolveCategoryName(categories, 'venues')).toBe('Venues');
    });

    it('is case-insensitive on the slug', () => {
      expect(resolveCategoryName(categories, 'VENUES')).toBe('Venues');
    });

    it('resolves an already-canonical name back to itself', () => {
      expect(resolveCategoryName(categories, 'Catering')).toBe('Catering');
    });

    it('is case-insensitive on the name', () => {
      expect(resolveCategoryName(categories, 'catering')).toBe('Catering');
    });

    it('resolves a slug whose name is not a trivial case transform', () => {
      expect(resolveCategoryName(categories, 'hair-makeup')).toBe('Hair & Makeup');
    });

    it('returns empty string for an unknown value', () => {
      expect(resolveCategoryName(categories, 'not-a-category')).toBe('');
    });

    it('returns empty string for an empty/missing value', () => {
      expect(resolveCategoryName(categories, '')).toBe('');
      expect(resolveCategoryName(categories, undefined)).toBe('');
    });

    it('tolerates a non-array categories argument', () => {
      expect(resolveCategoryName(null, 'venues')).toBe('');
      expect(resolveCategoryName(undefined, 'venues')).toBe('');
    });

    it('tolerates malformed category records', () => {
      const malformed = [null, {}, { slug: 'venues' }, undefined];
      // The entry with a slug but no name should not match (nothing to resolve to)
      expect(resolveCategoryName(malformed, 'venues')).toBe('');
    });
  });
});
