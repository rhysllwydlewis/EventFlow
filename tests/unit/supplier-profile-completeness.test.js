'use strict';

const {
  getSupplierGalleryCount,
  hasSupplierGalleryPhotos,
  hasSupplierPostcode,
} = require('../../services/supplierProfileCompleteness');

describe('services/supplierProfileCompleteness', () => {
  describe('getSupplierGalleryCount / hasSupplierGalleryPhotos', () => {
    it('counts photos from the canonical photosGallery array', () => {
      const supplier = { photosGallery: ['a.jpg', 'b.jpg'] };
      expect(getSupplierGalleryCount(supplier)).toBe(2);
      expect(hasSupplierGalleryPhotos(supplier)).toBe(true);
    });

    it('counts photos from the legacy images array when photosGallery is absent', () => {
      const supplier = { images: ['a.jpg'] };
      expect(getSupplierGalleryCount(supplier)).toBe(1);
      expect(hasSupplierGalleryPhotos(supplier)).toBe(true);
    });

    it('deduplicates identical URLs across both fields', () => {
      const supplier = { photosGallery: ['a.jpg'], images: ['a.jpg', 'b.jpg'] };
      expect(getSupplierGalleryCount(supplier)).toBe(2);
    });

    it('extracts a URL from object-shaped photo entries', () => {
      const supplier = { photosGallery: [{ url: 'https://cdn/a.jpg' }] };
      expect(getSupplierGalleryCount(supplier)).toBe(1);
    });

    it('is false for a supplier with no photos at all', () => {
      expect(hasSupplierGalleryPhotos({})).toBe(false);
    });

    it('does not count a blank-string entry as a photo', () => {
      // The array-length-only check this replaced would have returned true here.
      const supplier = { photosGallery: ['   '] };
      expect(hasSupplierGalleryPhotos(supplier)).toBe(false);
    });
  });

  describe('hasSupplierPostcode', () => {
    it('is true when basePostcode is set', () => {
      expect(hasSupplierPostcode({ basePostcode: 'SW1A 1AA' })).toBe(true);
    });

    it('is true when only the venuePostcode fallback is set', () => {
      expect(hasSupplierPostcode({ venuePostcode: 'EC1A 1BB' })).toBe(true);
    });

    it('is false when neither field is set', () => {
      expect(hasSupplierPostcode({})).toBe(false);
    });

    it('is false for a whitespace-only postcode', () => {
      expect(hasSupplierPostcode({ basePostcode: '   ' })).toBe(false);
    });
  });
});
