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

  describe('SUPPLIER_AVATAR_PALETTE contrast', () => {
    // WCAG 2 relative-luminance contrast ratio, straight from the spec —
    // https://www.w3.org/TR/WCAG21/#contrast-minimum
    function hexToRgb(hex) {
      const value = hex.replace('#', '');
      return [0, 2, 4].map(i => Number.parseInt(value.slice(i, i + 2), 16));
    }
    function relativeLuminance([r, g, b]) {
      const [rl, gl, bl] = [r, g, b].map(c => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
    }
    function contrastRatio(hexA, hexB) {
      const lA = relativeLuminance(hexToRgb(hexA));
      const lB = relativeLuminance(hexToRgb(hexB));
      const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
      return (lighter + 0.05) / (darker + 0.05);
    }

    // Every consumer renders white initials directly on these colors (see
    // e.g. public/assets/js/pricing.js's buildProofItem), so every entry —
    // both gradient stops — must clear the WCAG AA minimum for normal-size
    // text (4.5:1), not just the relaxed large-text threshold.
    test.each(SUPPLIER_AVATAR_PALETTE)('%s -> %s is readable in white text', (from, to) => {
      expect(contrastRatio('#FFFFFF', from)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio('#FFFFFF', to)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
