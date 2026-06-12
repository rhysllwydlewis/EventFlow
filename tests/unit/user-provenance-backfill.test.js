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
