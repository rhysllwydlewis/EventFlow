'use strict';

const {
  safeImageUrl,
  safePublicSupplier,
  safeTrustVerifications,
} = require('../../utils/supplierPublicProfile');
const { BADGE_DEFINITIONS } = require('../../utils/badgeManagement');

describe('supplier public profile trust boundary', () => {
  test('does not treat profile approval as email verification', () => {
    const publicSupplier = safePublicSupplier({
      id: 'sup_approved',
      name: 'Approved Supplier',
      approved: true,
      verified: true,
      verificationStatus: 'approved',
      emailVerified: false,
    });

    expect(publicSupplier.profileApproved).toBe(true);
    expect(publicSupplier.approved).toBe(true);
    expect(publicSupplier.verified).toBe(false);
    expect(publicSupplier.emailVerified).toBe(false);
    expect(publicSupplier.verifications.email.verified).toBe(false);
  });

  test('profile approval fails closed when only stale legacy approval signals are present', () => {
    const publicSupplier = safePublicSupplier({
      id: 'sup_mismatch',
      name: 'Mismatched Supplier',
      approved: false,
      verified: true,
      verificationStatus: 'approved',
    });

    expect(publicSupplier.approved).toBe(false);
    expect(publicSupplier.profileApproved).toBe(false);
    expect(publicSupplier.verified).toBe(false);
    expect(publicSupplier.emailVerified).toBe(false);
  });

  test('top-level verification facts are mirrored into the nested public verification object', () => {
    const publicSupplier = safePublicSupplier({
      id: 'sup_top_level_verification',
      emailVerified: true,
      phoneVerified: true,
      businessVerified: true,
      verifications: {},
    });

    expect(publicSupplier.emailVerified).toBe(true);
    expect(publicSupplier.phoneVerified).toBe(true);
    expect(publicSupplier.businessVerified).toBe(true);
    expect(publicSupplier.verifications).toEqual({
      email: { verified: true },
      phone: { verified: true },
      business: { verified: true },
    });
  });

  test('does not expose supplier-entered insurance or licence text as public trust data', () => {
    const publicSupplier = safePublicSupplier({
      id: 'sup_self_declared',
      name: 'Self Declared Supplier',
      insurance: true,
      license: 'LIC-12345',
      trustVerifications: {},
      badges: [],
    });

    expect(publicSupplier.insurance).toBeUndefined();
    expect(publicSupplier.license).toBeUndefined();
    expect(publicSupplier.trustVerifications).toEqual({
      publicLiability: { verified: false },
      dbs: { verified: false },
      licence: { verified: false },
    });
  });

  test('generic trust badge IDs are internal-only and cannot create public trust claims', () => {
    const publicSupplier = safePublicSupplier({
      id: 'sup_badge_only',
      name: 'Badge Only Supplier',
      badges: ['public-liability-verified', 'dbs-checked', 'licence-verified', 'fast-responder'],
      badgeDetails: [
        { id: 'dbs-checked', type: 'verified', name: 'DBS Check Confirmed' },
        { id: 'fast-responder', type: 'fast-responder', name: 'Fast Responder' },
      ],
      trustVerifications: {},
    });

    expect(publicSupplier.trustVerifications).toEqual({
      publicLiability: { verified: false },
      dbs: { verified: false },
      licence: { verified: false },
    });
    expect(publicSupplier.badges).toEqual(['fast-responder']);
    expect(publicSupplier.badgeDetails).toEqual([
      expect.objectContaining({ id: 'fast-responder', name: 'Fast Responder' }),
    ]);
  });

  test('structured admin trust state becomes safe public boolean trust claims', () => {
    const publicSupplier = safePublicSupplier({
      id: 'sup_trusted',
      name: 'Trusted Supplier',
      trustVerifications: {
        publicLiability: { verified: true, verifiedBy: 'admin_1', policyNumber: 'SECRET' },
        dbs: { verified: true, verifiedBy: 'admin_1', certificateNumber: 'SECRET' },
        licence: { verified: true, verifiedBy: 'admin_1' },
      },
    });

    expect(publicSupplier.trustVerifications).toEqual({
      publicLiability: { verified: true },
      dbs: { verified: true },
      licence: { verified: true },
    });
  });

  test('structured trust details are reduced to booleans and sensitive metadata is not exposed', () => {
    const trust = safeTrustVerifications({
      dbs: {
        verified: true,
        certificateNumber: 'SHOULD-NOT-LEAK',
        notes: 'Sensitive note',
        verifiedBy: 'admin@example.com',
      },
      publicLiability: {
        verified: true,
        policyNumber: 'POLICY-SECRET',
        expiresAt: '2030-01-01',
      },
    });

    expect(trust).toEqual({
      publicLiability: { verified: true },
      dbs: { verified: true },
      licence: { verified: false },
    });
    expect(JSON.stringify(trust)).not.toContain('SHOULD-NOT-LEAK');
    expect(JSON.stringify(trust)).not.toContain('Sensitive note');
    expect(JSON.stringify(trust)).not.toContain('POLICY-SECRET');
    expect(JSON.stringify(trust)).not.toContain('admin@example.com');
  });

  test('mixed-schema profiles retain legacy gallery and social data when canonical containers are empty', () => {
    const publicSupplier = safePublicSupplier({
      id: 'sup_migrated',
      name: 'Migrated Supplier',
      description_long: '',
      blurb: 'A useful legacy business description.',
      photosGallery: [],
      images: ['/api/photos/legacy_1', '/api/photos/legacy_2'],
      socialLinks: {},
      socials: {
        instagram: 'https://instagram.com/example',
        facebook: 'https://facebook.com/example',
      },
    });

    expect(publicSupplier.description).toBe('A useful legacy business description.');
    expect(publicSupplier.photosGallery).toEqual(['/api/photos/legacy_1', '/api/photos/legacy_2']);
    expect(publicSupplier.socialLinks).toMatchObject({
      instagram: 'https://instagram.com/example',
      facebook: 'https://facebook.com/example',
    });
  });

  test('blank canonical social keys do not erase populated legacy links', () => {
    const publicSupplier = safePublicSupplier({
      id: 'sup_social_migration',
      socials: {
        facebook: 'https://facebook.com/example',
        instagram: 'https://instagram.com/example',
      },
      socialLinks: { facebook: '' },
    });

    expect(publicSupplier.socialLinks).toEqual({
      facebook: 'https://facebook.com/example',
      instagram: 'https://instagram.com/example',
    });
  });

  test('public serializer rejects base64 banner data but accepts stable image routes', () => {
    expect(safeImageUrl('data:image/png;base64,aGVsbG8=')).toBe('');
    expect(safeImageUrl('/api/photos/photo_123')).toBe('/api/photos/photo_123');
  });
});

describe('manual trust badge definitions', () => {
  test.each(['PUBLIC_LIABILITY_VERIFIED', 'DBS_CHECKED', 'LICENCE_VERIFIED'])(
    '%s cannot be auto-awarded',
    key => {
      const badge = BADGE_DEFINITIONS[key];
      expect(badge).toBeDefined();
      expect(badge.type).toBe('verified');
      expect(badge.autoAssign).toBe(false);
    }
  );
});
