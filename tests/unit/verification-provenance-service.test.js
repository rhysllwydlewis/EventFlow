'use strict';

const provenance = require('../../services/verificationProvenance.service');

describe('verification provenance service', () => {
  it('marks Google signups as Google verified', () => {
    const result = provenance.summariseUser({
      email: 'person@example.com',
      verified: true,
      authProvider: 'google',
      googleSub: 'sub',
      createdAt: '2026-06-01T00:00:00.000Z',
    }, []);

    expect(result.signupMethod).toBe('google');
    expect(result.verificationMethod).toBe('google_verified_email');
    expect(result.emailDeliveryStatus).toBe('not_required');
  });

  it('marks admin-created accounts as admin created', () => {
    const result = provenance.summariseUser({
      email: 'created@example.com',
      verified: true,
      createdBy: 'admin-user',
      createdAt: '2026-06-01T00:00:00.000Z',
    }, []);

    expect(result.signupMethod).toBe('admin_created');
    expect(result.verificationMethod).toBe('admin_created');
  });
});
