'use strict';

const {
  getSupplierInitials,
  getSupplierAvatarColors,
  getSupplierAvatarGradient,
  SUPPLIER_AVATAR_PALETTE,
  SUPPLIER_AVATAR_FALLBACK_INITIAL,
} = require('../../public/assets/js/utils/supplier-avatar.js');

describe('supplier-avatar shared utility', () => {
  describe('getSupplierInitials', () => {
    test('uses first+last word initials for multi-word names', () => {
      expect(getSupplierInitials('Luxury Car Hire')).toBe('LH');
      expect(getSupplierInitials('Snapshot Photography')).toBe('SP');
    });

    test('uses a single initial for one-word names', () => {
      expect(getSupplierInitials('Embosseur')).toBe('E');
    });

    test('falls back to the generic marker, never a fabricated letter', () => {
      expect(getSupplierInitials('')).toBe(SUPPLIER_AVATAR_FALLBACK_INITIAL);
      expect(getSupplierInitials(null)).toBe(SUPPLIER_AVATAR_FALLBACK_INITIAL);
      expect(getSupplierInitials(undefined)).toBe(SUPPLIER_AVATAR_FALLBACK_INITIAL);
      expect(getSupplierInitials('   ')).toBe(SUPPLIER_AVATAR_FALLBACK_INITIAL);
    });
  });

  describe('getSupplierAvatarColors', () => {
    test('is stable for the same supplier id across calls', () => {
      const supplier = { id: 'sup_abc123', name: 'Luxury Car Hire' };
      const first = getSupplierAvatarColors(supplier);
      const second = getSupplierAvatarColors(supplier);
      expect(first).toEqual(second);
      expect(SUPPLIER_AVATAR_PALETTE).toContainEqual(first);
    });

    test('does not change when only the display name changes (rename-stable)', () => {
      const before = getSupplierAvatarColors({ id: 'sup_abc123', name: 'Old Business Name' });
      const after = getSupplierAvatarColors({ id: 'sup_abc123', name: 'Luxury Car Hire' });
      expect(after).toEqual(before);
    });

    test('prefers id over supplierId over name when choosing the hash key', () => {
      const byId = getSupplierAvatarColors({ id: 'sup_1', name: 'Same Name' });
      const bySupplierId = getSupplierAvatarColors({ supplierId: 'sup_1', name: 'Same Name' });
      expect(byId).toEqual(bySupplierId);
    });

    test('falls back to a string key directly', () => {
      expect(getSupplierAvatarColors('sup_xyz')).toEqual(
        getSupplierAvatarColors({ id: 'sup_xyz' })
      );
    });

    test('does not throw and returns a deterministic default for no key', () => {
      expect(() => getSupplierAvatarColors(null)).not.toThrow();
      expect(getSupplierAvatarColors(null)).toEqual(SUPPLIER_AVATAR_PALETTE[0]);
      expect(getSupplierAvatarColors(undefined)).toEqual(SUPPLIER_AVATAR_PALETTE[0]);
      expect(getSupplierAvatarColors({})).toEqual(SUPPLIER_AVATAR_PALETTE[0]);
    });
  });

  describe('getSupplierAvatarGradient', () => {
    test('renders a linear-gradient using the resolved colors', () => {
      const supplier = { id: 'sup_abc123' };
      const [from, to] = getSupplierAvatarColors(supplier);
      expect(getSupplierAvatarGradient(supplier)).toBe(
        `linear-gradient(135deg, ${from} 0%, ${to} 100%)`
      );
    });
  });
});
