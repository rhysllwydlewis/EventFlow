'use strict';

const provenance = require('../../services/userProvenance.service');
const backfill = require('../../scripts/backfill-user-verification-provenance');

describe('user provenance helpers and backfill', () => {
  test('Google signup provenance records Google verification without email delivery', () => {
    const now = '2026-06-06T00:00:00.000Z';
    expect(provenance.googleSignupProvenance(now)).toMatchObject({
      signupMethod: 'google',
      authProvider: 'google',
      verificationMethod: 'google_verified_email',
      verifiedBy: { type: 'google' },
      emailDeliveryStatus: 'not_required',
      verificationEmailSentAt: null,
    });
  });

  test('email-password pending provenance starts with pending verification email fields', () => {
    expect(provenance.emailPasswordPendingProvenance()).toMatchObject({
      signupMethod: 'email_password',
      authProvider: 'local',
      verificationMethod: 'pending',
      verifiedAt: null,
      verifiedBy: null,
      emailDeliveryStatus: 'pending',
    });
  });

  test('send metadata captures email log and Postmark message IDs', () => {
    expect(
      provenance.metadataFromSendResult({
        emailLogId: 'log_123',
        MessageID: 'pm_123',
        provider: 'postmark',
        emailLogStatus: 'sent',
        sentAt: '2026-06-06T01:00:00.000Z',
      })
    ).toEqual({
      verificationEmailSentAt: '2026-06-06T01:00:00.000Z',
      lastVerificationEmailLogId: 'log_123',
      lastVerificationEmailPostmarkMessageId: 'pm_123',
      emailDeliveryStatus: 'sent',
    });
  });

  test('Facebook signup provenance records Facebook verification without email delivery', () => {
    expect(provenance.facebookSignupProvenance('2026-06-06T00:00:00.000Z')).toMatchObject({
      signupMethod: 'facebook',
      authProvider: 'facebook',
      verificationMethod: 'facebook_verified_email',
      verifiedBy: { type: 'facebook' },
      emailDeliveryStatus: 'not_required',
    });
  });

  describe('linkedAuthProvider', () => {
    test('stays the linked provider for an account with no other sign-in method', () => {
      expect(provenance.linkedAuthProvider({}, 'facebook')).toBe('facebook');
      expect(provenance.linkedAuthProvider({ facebookSub: 'f1' }, 'facebook')).toBe('facebook');
    });
    test('is mixed when the account has a password', () => {
      expect(provenance.linkedAuthProvider({ passwordHash: 'h' }, 'facebook')).toBe('mixed');
      expect(provenance.linkedAuthProvider({ passwordHash: 'h' }, 'google')).toBe('mixed');
    });
    test('is mixed when a different provider is already linked', () => {
      expect(provenance.linkedAuthProvider({ googleSub: 'g1' }, 'facebook')).toBe('mixed');
      expect(provenance.linkedAuthProvider({ authProviderIds: { facebook: 'f1' } }, 'google')).toBe(
        'mixed'
      );
    });
    test('linking Facebook to a Google-only account no longer overwrites google', () => {
      const updates = provenance.facebookLinkProvenance(
        { verified: true, signupMethod: 'google', googleSub: 'g1', authProvider: 'google' },
        '2026-06-06T00:00:00.000Z'
      );
      expect(updates.authProvider).toBe('mixed');
      expect(updates).not.toHaveProperty('signupMethod');
    });
    test('linking Google to a Facebook-only account no longer overwrites facebook', () => {
      const updates = provenance.googleLinkProvenance(
        { verified: true, signupMethod: 'facebook', facebookSub: 'f1', authProvider: 'facebook' },
        '2026-06-06T00:00:00.000Z'
      );
      expect(updates.authProvider).toBe('mixed');
    });
  });

  test('inferAuthProvider reports mixed for two linked providers or provider + password', () => {
    expect(provenance.inferAuthProvider({ googleSub: 'g', facebookSub: 'f' })).toBe('mixed');
    expect(provenance.inferAuthProvider({ facebookSub: 'f', passwordHash: 'h' })).toBe('mixed');
    expect(provenance.inferAuthProvider({ facebookSub: 'f' })).toBe('facebook');
    expect(provenance.inferAuthProvider({ googleSub: 'g' })).toBe('google');
  });

  describe('backfill for social accounts', () => {
    const now = new Date().toISOString();
    test('Facebook account with no provenance gets Facebook (not email/password) fields', () => {
      const updates = backfill.buildBackfillUpdates({
        id: 'u1',
        verified: true,
        facebookSub: 'f1',
        facebookLinkedAt: '2026-05-01T00:00:00.000Z',
        createdAt: now,
      });
      expect(updates).toMatchObject({
        signupMethod: 'facebook',
        authProvider: 'facebook',
        verificationMethod: 'facebook_verified_email',
        verifiedAt: '2026-05-01T00:00:00.000Z',
        verifiedBy: { type: 'facebook', provider: 'facebook' },
        emailDeliveryStatus: 'not_required',
      });
    });
    test('Facebook backfill is idempotent once applied', () => {
      const user = { id: 'u1', verified: true, facebookSub: 'f1', createdAt: now };
      const applied = { ...user, ...backfill.buildBackfillUpdates(user) };
      expect(backfill.buildBackfillUpdates(applied)).toEqual({});
    });
    test('Facebook account with a password becomes mixed', () => {
      const updates = backfill.buildBackfillUpdates({
        id: 'u1',
        verified: true,
        facebookSub: 'f1',
        passwordHash: 'h',
        createdAt: now,
      });
      expect(updates.authProvider).toBe('mixed');
      expect(updates.signupMethod).toBe('facebook');
    });
    test('account linked to both Google and Facebook keeps Google provenance and is mixed', () => {
      const updates = backfill.buildBackfillUpdates({
        id: 'u1',
        verified: true,
        googleSub: 'g1',
        facebookSub: 'f1',
        createdAt: now,
      });
      expect(updates).toMatchObject({
        signupMethod: 'google',
        authProvider: 'mixed',
        verificationMethod: 'google_verified_email',
      });
    });
  });

  test('owner backfill is idempotent after owner provenance is present', () => {
    const user = {
      id: 'owner',
      email: 'owner@example.com',
      isOwner: true,
      verified: true,
      signupMethod: 'owner_seed',
      authProvider: 'local',
      verificationMethod: 'owner_account',
      emailDeliveryStatus: 'not_required',
      verifiedAt: '2026-06-01T00:00:00.000Z',
      verifiedBy: {
        type: 'owner',
        reason: 'Owner/system account does not require email verification',
      },
    };
    expect(backfill.buildBackfillUpdates(user)).toEqual({});
  });

  test('backfill is idempotent after applying generated updates', () => {
    const user = {
      id: 'u1',
      email: 'g@example.com',
      verified: true,
      authProviderIds: { google: 'sub' },
      createdAt: '2026-06-01T00:00:00.000Z',
    };
    const first = backfill.buildBackfillUpdates(user);
    expect(first).toMatchObject({
      signupMethod: 'google',
      verificationMethod: 'google_verified_email',
      emailDeliveryStatus: 'not_required',
    });
    const second = backfill.buildBackfillUpdates({ ...user, ...first });
    expect(second).toEqual({});
  });
});
