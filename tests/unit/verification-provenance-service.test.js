'use strict';

const provenance = require('../../services/verificationProvenance.service');

describe('verification provenance service', () => {
  afterEach(() => {
    jest.dontMock('../../db-unified');
    jest.resetModules();
  });

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

  it('reports mixed auth provider for an account linked to both Google and Facebook', () => {
    const result = provenance.summariseUser(
      { email: 'p@example.com', verified: true, googleSub: 'g', facebookSub: 'f' },
      []
    );
    expect(result.authProvider).toBe('mixed');
    expect(result.hasGoogleLink).toBe(true);
    expect(result.hasFacebookLink).toBe(true);
  });

  it('flags Facebook provider inconsistencies in the integrity report', async () => {
    jest.resetModules();
    const recent = new Date().toISOString();
    jest.doMock('../../db-unified', () => ({
      read: jest.fn(async collection =>
        collection === 'users'
          ? [
              {
                id: 'a',
                email: 'a@x.com',
                verified: true,
                authProvider: 'facebook',
                createdAt: recent,
              },
              {
                id: 'b',
                email: 'b@x.com',
                verified: true,
                facebookSub: 'f',
                authProvider: 'local',
                createdAt: recent,
              },
              {
                id: 'c',
                email: 'c@x.com',
                verified: true,
                facebookSub: 'f2',
                authProvider: 'facebook',
                verificationMethod: 'facebook_verified_email',
                createdAt: recent,
              },
            ]
          : []
      ),
    }));
    const fresh = require('../../services/verificationProvenance.service');
    const report = await fresh.getVerificationIntegrity({});
    const codes = report.issues.map(issue => `${issue.issue}:${issue.userId}`);
    expect(codes).toContain('facebook_provider_missing_facebook_link:a');
    expect(codes).toContain('facebook_link_with_non_facebook_provider:b');
    expect(codes.some(code => code.endsWith(':c') && code.startsWith('facebook_'))).toBe(false);
    // b infers facebook_verified_email from its link; a has no link so stays unknown.
    expect(report.summary.facebookUsersWithValidProvenance).toBe(2);
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
