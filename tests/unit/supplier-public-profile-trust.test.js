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
    expect(publicSupplier.emailVerified).toBe(false);
    expect(publicSupplier.verifications.email.verified).toBe(false);
  });

  test('does not promote supplier-entered insurance or licence text into verified trust claims', () => {
    const publicSupplier = safePublicSupplier({
      id: 'sup_self_declared',
      name: 'Self Declared Supplier',
      insurance: true,
      license: 'LIC-12345',
      trustVerifications: {},
      badges: [],
    });

    expect(publicSupplier.insurance).toBe(true); // legacy compatibility only
    expect(publicSupplier.license).toBe('LIC-12345');
    expect(publicSupplier.trustVerifications).toEqual({
      publicLiability: { verified: false },
      dbs: { verified: false },
      licence: { verified: false },
    });
  });

  test('admin trust badge IDs become safe public boolean trust claims', () => {
    const publicSupplier = safePublicSupplier({
      id: 'sup_trusted',
      name: 'Trusted Supplier',
      badges: ['public-liability-verified', 'dbs-checked', 'licence-verified'],
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

  test('public serializer rejects base64 banner data but accepts stable image routes', () => {
    expect(safeImageUrl('data:image/png;base64,aGVsbG8=')).toBe('');
    expect(safeImageUrl('/api/photos/photo_123')).toBe('/api/photos/photo_123');
  });
});

describe('manual trust badge definitions', () => {
  test.each([
    'PUBLIC_LIABILITY_VERIFIED',
    'DBS_CHECKED',
    'LICENCE_VERIFIED',
  ])('%s cannot be auto-awarded', key => {
    const badge = BADGE_DEFINITIONS[key];
    expect(badge).toBeDefined();
    expect(badge.type).toBe('verified');
    expect(badge.autoAssign).toBe(false);
  });
});
