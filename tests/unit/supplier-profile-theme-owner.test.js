'use strict';

const fs = require('fs');
const path = require('path');
const { safePublicSupplier } = require('../../utils/supplierPublicProfile');

const read = relative => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

describe('supplier profile owner theme editing', () => {
  test('exposes owner identity only to the authenticated owner', () => {
    const supplier = { id: 'sup_1', ownerUserId: 'user_1', name: 'Example' };

    expect(safePublicSupplier(supplier)).toMatchObject({ isOwner: false });
    expect(safePublicSupplier(supplier).ownerUserId).toBeUndefined();

    expect(
      safePublicSupplier(supplier, { isOwner: true, exposeOwnerUserId: true })
    ).toMatchObject({
      isOwner: true,
      ownerUserId: 'user_1',
    });
  });

  test('the safe route enables owner editing without exposing the owner id generally', () => {
    const route = read('routes/supplier-profile-safe.js');
    expect(route).toContain('const isOwner = Boolean');
    expect(route).toContain('exposeOwnerUserId: isOwner');
    expect(route).toContain('isOwner,');
  });

  test('offers explicit automatic, preset and custom modes', () => {
    const editor = read('public/assets/js/supplier-profile-theme-owner.js');
    expect(editor).toContain('Automatic follows the supplier category');
    expect(editor).toContain("themeMode: selectedMode");
    expect(editor).toContain("selectedMode === 'preset'");
    expect(editor).toContain("selectedMode === 'custom'");
  });

  test('merges the canonical server response and reapplies the full profile theme', () => {
    const editor = read('public/assets/js/supplier-profile-theme-owner.js');
    expect(editor).toContain('mergeCanonicalSupplier(data.supplier || patch)');
    expect(editor).toContain('window.SupplierProfileTheme?.applySupplierProfileTheme');

    const theme = read('public/assets/js/supplier-profile-polish.js');
    expect(theme).toContain("import './supplier-profile-theme-owner.js'");
    expect(theme).toContain('applyAvatarTheme(theme.accent)');
  });
});
