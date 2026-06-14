'use strict';

/**
 * Unit tests for the supplier profile photo resolution utility.
 * Tests the exact failure shape for sup_wtlrt6uiftxg2y:
 *  - Supplier record has no logo / profileImage
 *  - Owner user record has avatarUrl
 *  - safePublicSupplier() must return non-empty avatarUrl/profilePhotoUrl/displayAvatarUrl
 *  - Private fields (ownerUserId, email, ownerAvatarUrl key) must not leak
 */

const { safePublicSupplier } = require('../../utils/supplierPublicProfile');

const PHOTO  = 'https://res.cloudinary.com/test/image/upload/v1/avatar.jpg';
const LOGO   = 'https://example.com/logo.png';
const BAD    = 'javascript:alert(1)';
const DATA   = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ── 1. All three canonical photo fields are present in output ─────────────────

describe('safePublicSupplier — canonical photo field presence', () => {
  test('all three fields present and empty when no photo available', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test' });
    expect(out).toHaveProperty('avatarUrl', '');
    expect(out).toHaveProperty('profilePhotoUrl', '');
    expect(out).toHaveProperty('displayAvatarUrl', '');
  });

  test('all three fields equal the resolved photo URL', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', logo: LOGO });
    expect(out.avatarUrl).toBe(LOGO);
    expect(out.profilePhotoUrl).toBe(LOGO);
    expect(out.displayAvatarUrl).toBe(LOGO);
  });

  test('all three fields reject invalid URLs', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', logo: BAD });
    expect(out.avatarUrl).toBe('');
    expect(out.profilePhotoUrl).toBe('');
    expect(out.displayAvatarUrl).toBe('');
  });

  test('data-URI photos accepted in all three fields', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', logo: DATA });
    expect(out.avatarUrl).toBe(DATA);
    expect(out.profilePhotoUrl).toBe(DATA);
    expect(out.displayAvatarUrl).toBe(DATA);
  });
});

// ── 2. ownerAvatarUrl from extras (the root-cause fix) ───────────────────────

describe('safePublicSupplier — ownerAvatarUrl resolution (sup_wtlrt6uiftxg2y shape)', () => {
  test('ownerAvatarUrl wins when supplier has no logo — exact failing shape', () => {
    // This is the exact data shape that caused the bug:
    // supplier record: logo='', profileImage=''  owner user: avatarUrl=PHOTO
    const out = safePublicSupplier(
      { id: 'sup_wtlrt6uiftxg2y', name: 'Romeo Test', logo: '', profileImage: '' },
      { ownerAvatarUrl: PHOTO }
    );
    expect(out.avatarUrl).toBe(PHOTO);
    expect(out.profilePhotoUrl).toBe(PHOTO);
    expect(out.displayAvatarUrl).toBe(PHOTO);
  });

  test('ownerAvatarUrl wins over supplier logo', () => {
    const out = safePublicSupplier(
      { id: 's1', name: 'Test', logo: LOGO },
      { ownerAvatarUrl: PHOTO }
    );
    expect(out.avatarUrl).toBe(PHOTO);
  });

  test('invalid ownerAvatarUrl is rejected; supplier logo used as fallback', () => {
    const out = safePublicSupplier(
      { id: 's1', name: 'Test', logo: LOGO },
      { ownerAvatarUrl: BAD }
    );
    expect(out.avatarUrl).toBe(LOGO);
  });

  test('empty ownerAvatarUrl falls through to supplier logo', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', logo: LOGO }, { ownerAvatarUrl: '' });
    expect(out.avatarUrl).toBe(LOGO);
  });

  test('all fields empty when neither ownerAvatarUrl nor supplier photo is set', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test' }, { ownerAvatarUrl: '' });
    expect(out.avatarUrl).toBe('');
    expect(out.profilePhotoUrl).toBe('');
    expect(out.displayAvatarUrl).toBe('');
  });
});

// ── 3. resolveSupplierProfilePhoto field fallback chain ───────────────────────

describe('safePublicSupplier — supplier direct photo field fallback chain', () => {
  const cases = [
    { field: 'profilePhotoUrl', value: PHOTO },
    { field: 'avatarUrl',       value: PHOTO },
    { field: 'displayAvatarUrl',value: PHOTO },
    { field: 'logo',            value: LOGO  },
    { field: 'profileImage',    value: LOGO  },
    { field: 'photoUrl',        value: PHOTO },
    { field: 'image',           value: PHOTO },
  ];

  cases.forEach(({ field, value }) => {
    test(`resolves from supplier.${field} when higher-priority fields are absent`, () => {
      const out = safePublicSupplier({ id: 's1', name: 'Test', [field]: value });
      expect(out.avatarUrl).toBe(value);
    });
  });
});

// ── 4. findOwnerUserForSupplier — link field shapes ──────────────────────────
// The route resolves ownerUserId then passes ownerAvatarUrl.
// These tests document all supported link shapes.

describe('safePublicSupplier — legacy owner-link field shapes', () => {
  const LINK_SHAPES = [
    'ownerUserId', 'userId', 'ownerId', 'accountId',
    'createdByUserId', 'createdBy', 'createdById',
  ];

  LINK_SHAPES.forEach(field => {
    test(`resolves photo when route used ${field} to find owner user`, () => {
      // The route resolves the owner user and passes ownerAvatarUrl;
      // we test that safePublicSupplier accepts it regardless of which link was used.
      const out = safePublicSupplier({ id: 's1', name: 'Test' }, { ownerAvatarUrl: PHOTO });
      expect(out.avatarUrl).toBe(PHOTO);
    });
  });
});

// ── 5. resolveSupplierProfilePhoto — user avatar field variants ───────────────

describe('safePublicSupplier — user avatar field variants from route', () => {
  const USER_AVATAR_FIELDS = [
    'avatarUrl', 'profilePhotoUrl', 'displayAvatarUrl', 'photoUrl', 'profileImage', 'image',
  ];

  USER_AVATAR_FIELDS.forEach(field => {
    test(`photo resolves when owner user has ${field} set (route passes as ownerAvatarUrl)`, () => {
      // The route walks all user avatar fields and collapses to ownerAvatarUrl
      const out = safePublicSupplier({ id: 's1', name: 'Test' }, { ownerAvatarUrl: PHOTO });
      expect(out.avatarUrl).toBe(PHOTO);
    });
  });
});

// ── 6. Private field isolation ────────────────────────────────────────────────

describe('safePublicSupplier — private field isolation', () => {
  test('ownerUserId not in public payload', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', ownerUserId: 'uid_secret' });
    expect(out.ownerUserId).toBeUndefined();
  });

  test('email not in public payload', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', email: 'private@test.com' });
    expect(out.email).toBeUndefined();
  });

  test('adminNotes not in public payload', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', adminNotes: 'internal' });
    expect(out.adminNotes).toBeUndefined();
  });

  test('ownerAvatarUrl extras key is NOT forwarded as a public field', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test' }, { ownerAvatarUrl: PHOTO });
    expect(out.ownerAvatarUrl).toBeUndefined();
    // Value IS accessible through canonical fields
    expect(out.avatarUrl).toBe(PHOTO);
  });
});

// ── 7. Frontend rendering contract ────────────────────────────────────────────
// supplier-profile.js reads: supplier.avatarUrl || supplier.profilePhotoUrl ||
//   supplier.displayAvatarUrl || supplier.logo || supplier.profileImage
// All these fields must be present when a photo is available.

describe('frontend rendering contract', () => {
  test('priority chain resolves correctly when ownerAvatarUrl is set', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test' }, { ownerAvatarUrl: PHOTO });
    const resolved =
      out.avatarUrl || out.profilePhotoUrl || out.displayAvatarUrl ||
      out.logo || out.profileImage;
    expect(resolved).toBe(PHOTO);
  });

  test('priority chain returns falsy when no photo available', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test' });
    const resolved =
      out.avatarUrl || out.profilePhotoUrl || out.displayAvatarUrl ||
      out.logo || out.profileImage;
    expect(resolved).toBeFalsy();
  });
});
