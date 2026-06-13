'use strict';

/**
 * Supplier profile photo consistency — unit tests
 *
 * Covers the root-cause fix for sup_wtlrt6uiftxg2y:
 *   - safePublicSupplier() now returns avatarUrl / profilePhotoUrl / displayAvatarUrl
 *   - safePublicSupplier() picks up ownerAvatarUrl from extras (injected by the route)
 *   - Resolution priority is correct (owner avatar > supplier direct > empty)
 *   - Private fields (ownerUserId, email, adminNotes) are NOT returned
 *   - Frontend contract: the resolved URL maps to where supplier-profile.js reads it
 */

const {
  safePublicSupplier,
  safeImageUrl,
} = require('../../utils/supplierPublicProfile');

// ─── Helper ───────────────────────────────────────────────────────────────────

const PHOTO_URL      = 'https://res.cloudinary.com/test/image/upload/v1/avatar.jpg';
const LOGO_URL       = 'https://example.com/logo.png';
const BAD_URL        = 'javascript:alert(1)';
const DATA_PNG       = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ─── 1. safePublicSupplier exposes avatarUrl / profilePhotoUrl / displayAvatarUrl ─

describe('safePublicSupplier — photo field exposure', () => {
  test('returns empty strings for avatarUrl / profilePhotoUrl / displayAvatarUrl when no photo is present', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test' });
    expect(out).toHaveProperty('avatarUrl');
    expect(out).toHaveProperty('profilePhotoUrl');
    expect(out).toHaveProperty('displayAvatarUrl');
    expect(out.avatarUrl).toBe('');
    expect(out.profilePhotoUrl).toBe('');
    expect(out.displayAvatarUrl).toBe('');
  });

  test('all three canonical photo fields equal the resolved value', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', logo: LOGO_URL });
    expect(out.avatarUrl).toBe(LOGO_URL);
    expect(out.profilePhotoUrl).toBe(LOGO_URL);
    expect(out.displayAvatarUrl).toBe(LOGO_URL);
    expect(out.logo).toBe(LOGO_URL);
  });

  test('rejects invalid photo URLs in all three fields', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', logo: BAD_URL });
    expect(out.avatarUrl).toBe('');
    expect(out.profilePhotoUrl).toBe('');
    expect(out.displayAvatarUrl).toBe('');
    expect(out.logo).toBe('');
  });

  test('accepts data-URI photos in all three fields', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', logo: DATA_PNG });
    expect(out.avatarUrl).toBe(DATA_PNG);
    expect(out.profilePhotoUrl).toBe(DATA_PNG);
    expect(out.displayAvatarUrl).toBe(DATA_PNG);
  });
});

// ─── 2. ownerAvatarUrl from extras wins over supplier's own direct fields ──────

describe('safePublicSupplier — ownerAvatarUrl priority (root-cause fix)', () => {
  test('ownerAvatarUrl in extras takes priority over supplier logo', () => {
    const out = safePublicSupplier(
      { id: 's1', name: 'Romeo Test', logo: LOGO_URL },
      { ownerAvatarUrl: PHOTO_URL }
    );
    expect(out.avatarUrl).toBe(PHOTO_URL);
    expect(out.profilePhotoUrl).toBe(PHOTO_URL);
    expect(out.displayAvatarUrl).toBe(PHOTO_URL);
    // logo also resolves to the owner photo since resolvedPhoto wins
    expect(out.logo).toBe(PHOTO_URL);
  });

  test('ownerAvatarUrl is used when supplier has no logo or profileImage', () => {
    // This is the exact shape for sup_wtlrt6uiftxg2y: supplier record has no
    // logo/profileImage, but the owner user's avatarUrl is fetched by the route.
    const out = safePublicSupplier(
      { id: 'sup_wtlrt6uiftxg2y', name: 'Romeo Test', logo: '', profileImage: '' },
      { ownerAvatarUrl: PHOTO_URL }
    );
    expect(out.avatarUrl).toBe(PHOTO_URL);
    expect(out.profilePhotoUrl).toBe(PHOTO_URL);
    expect(out.displayAvatarUrl).toBe(PHOTO_URL);
  });

  test('falls back to supplier logo when ownerAvatarUrl is empty', () => {
    const out = safePublicSupplier(
      { id: 's1', name: 'Test', logo: LOGO_URL },
      { ownerAvatarUrl: '' }
    );
    expect(out.avatarUrl).toBe(LOGO_URL);
  });

  test('falls back gracefully to empty string when neither owner nor supplier photo is available', () => {
    const out = safePublicSupplier(
      { id: 's1', name: 'Test' },
      { ownerAvatarUrl: '' }
    );
    expect(out.avatarUrl).toBe('');
    expect(out.profilePhotoUrl).toBe('');
    expect(out.displayAvatarUrl).toBe('');
  });

  test('invalid ownerAvatarUrl is rejected and supplier logo is used as fallback', () => {
    const out = safePublicSupplier(
      { id: 's1', name: 'Test', logo: LOGO_URL },
      { ownerAvatarUrl: 'javascript:alert(1)' }
    );
    // Bad URL sanitised to '' → falls through to supplier logo
    expect(out.avatarUrl).toBe(LOGO_URL);
  });
});

// ─── 3. Supplier direct photo field fallback chain ────────────────────────────

describe('safePublicSupplier — supplier direct photo field fallback chain', () => {
  test('reads profilePhotoUrl from supplier record when logo is absent', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', profilePhotoUrl: PHOTO_URL });
    expect(out.avatarUrl).toBe(PHOTO_URL);
  });

  test('reads avatarUrl from supplier record when logo and profilePhotoUrl are absent', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', avatarUrl: PHOTO_URL });
    expect(out.avatarUrl).toBe(PHOTO_URL);
  });

  test('reads displayAvatarUrl from supplier record as final fallback before empty', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', displayAvatarUrl: PHOTO_URL });
    expect(out.avatarUrl).toBe(PHOTO_URL);
  });

  test('reads profileImage when logo is absent', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', profileImage: LOGO_URL });
    expect(out.avatarUrl).toBe(LOGO_URL);
  });
});

// ─── 4. Owner-link field shapes (findOwnerUserForSupplier parity) ─────────────
//
// The route walks: ownerUserId → userId → ownerId → accountId → createdByUserId
// These tests document the expected shape so that the route can be tested if
// it is ever extracted into a named helper.

describe('safePublicSupplier — legacy owner-link field shapes', () => {
  // The route resolves the user and passes ownerAvatarUrl — these tests check
  // that the extra is accepted regardless of which link field was used.

  const LINK_SCENARIOS = [
    { desc: 'ownerUserId link',       extra: { ownerAvatarUrl: PHOTO_URL } },
    { desc: 'userId link (legacy)',   extra: { ownerAvatarUrl: PHOTO_URL } },
    { desc: 'ownerId link (legacy)',  extra: { ownerAvatarUrl: PHOTO_URL } },
    { desc: 'accountId link (legacy)',extra: { ownerAvatarUrl: PHOTO_URL } },
  ];

  LINK_SCENARIOS.forEach(({ desc, extra }) => {
    test(`resolves photo when route uses ${desc}`, () => {
      const out = safePublicSupplier({ id: 's1', name: 'Test' }, extra);
      expect(out.avatarUrl).toBe(PHOTO_URL);
      expect(out.profilePhotoUrl).toBe(PHOTO_URL);
    });
  });
});

// ─── 5. Private fields must not leak ─────────────────────────────────────────

describe('safePublicSupplier — private field isolation', () => {
  test('ownerUserId is not in the public payload', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', ownerUserId: 'user_secret' });
    expect(out.ownerUserId).toBeUndefined();
  });

  test('email is not in the public payload', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', email: 'private@test.com' });
    expect(out.email).toBeUndefined();
  });

  test('adminNotes are not in the public payload', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test', adminNotes: 'internal' });
    expect(out.adminNotes).toBeUndefined();
  });

  test('ownerAvatarUrl from extras is not forwarded verbatim as a key in the payload', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test' }, { ownerAvatarUrl: PHOTO_URL });
    // The raw ownerAvatarUrl extras key must not appear in the payload
    expect(out.ownerAvatarUrl).toBeUndefined();
    // The VALUE is exposed only through the canonical public fields
    expect(out.avatarUrl).toBe(PHOTO_URL);
  });
});

// ─── 6. Frontend rendering contract ──────────────────────────────────────────
//
// supplier-profile.js reads: supplier.avatarUrl || supplier.profilePhotoUrl ||
//   supplier.displayAvatarUrl || supplier.logo || supplier.profileImage
// All these fields must be present in the payload when a photo is available.

describe('frontend rendering contract — all avatar fields are populated', () => {
  test('all fields the frontend reads are present and equal for a supplier with a photo', () => {
    const out = safePublicSupplier(
      { id: 's1', name: 'Test' },
      { ownerAvatarUrl: PHOTO_URL }
    );
    // The frontend priority chain: first truthy value wins
    const frontendResolvedUrl =
      out.avatarUrl ||
      out.profilePhotoUrl ||
      out.displayAvatarUrl ||
      out.logo ||
      out.profileImage;

    expect(frontendResolvedUrl).toBe(PHOTO_URL);
  });

  test('frontend falls back to empty string when no photo exists', () => {
    const out = safePublicSupplier({ id: 's1', name: 'Test' });
    const frontendResolvedUrl =
      out.avatarUrl ||
      out.profilePhotoUrl ||
      out.displayAvatarUrl ||
      out.logo ||
      out.profileImage;

    expect(frontendResolvedUrl).toBeFalsy();
  });
});
