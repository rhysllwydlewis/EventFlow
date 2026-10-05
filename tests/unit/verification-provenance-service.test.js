'use strict';

const provenance = require('../../services/verificationProvenance.service');

describe('verification provenance service', () => {
  it('marks Google signups as Google verified', () => {
    const result = provenance.summariseUser(
      {
        email: 'person@example.com',
        verified: true,
        authProvider: 'google',
        googleSub: 'sub',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
      []
    );

    expect(result.signupMethod).toBe('google');
    expect(result.verificationMethod).toBe('google_verified_email');
    expect(result.emailDeliveryStatus).toBe('not_required');
  });

  it('marks Facebook signups as Facebook verified', () => {
    const result = provenance.summariseUser(
      {
        email: 'person@example.com',
        verified: true,
        authProvider: 'facebook',
        facebookSub: 'fb-sub',
        facebookLinkedAt: '2026-06-02T00:00:00.000Z',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
      []
    );

    expect(result.signupMethod).toBe('facebook');
    expect(result.authProvider).toBe('facebook');
    expect(result.verificationMethod).toBe('facebook_verified_email');
    expect(result.verifiedBy).toMatchObject({ type: 'facebook', provider: 'facebook' });
    expect(result.verifiedAt).toBe('2026-06-02T00:00:00.000Z');
    expect(result.emailDeliveryStatus).toBe('not_required');
    expect(result.hasFacebookLink).toBe(true);
    expect(result.hasGoogleLink).toBe(false);
  });

  it('treats a password account with a linked Facebook identity as mixed', () => {
    const result = provenance.summariseUser(
      {
        email: 'person@example.com',
        verified: true,
        passwordHash: 'hash',
        signupMethod: 'email_password',
        authProviderIds: { facebook: 'fb-sub' },
      },
      []
    );

    expect(result.signupMethod).toBe('email_password');
    expect(result.authProvider).toBe('mixed');
    expect(result.hasFacebookLink).toBe(true);
  });

  it('marks admin-created accounts as admin created', () => {
    const result = provenance.summariseUser(
      {
        email: 'created@example.com',
        verified: true,
        createdBy: 'admin-user',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
      []
    );

    expect(result.signupMethod).toBe('admin_created');
    expect(result.verificationMethod).toBe('admin_created');
  });
});
