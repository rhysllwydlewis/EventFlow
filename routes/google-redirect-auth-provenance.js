'use strict';

function buildGoogleVerificationProvenance(nowIso) {
  return {
    signupMethod: 'google',
    authProvider: 'google',
    verifiedAt: nowIso,
    verificationMethod: 'google_verified_email',
    verifiedBy: {
      type: 'google',
      provider: 'google',
      reason: 'Google ID token email_verified=true',
    },
    emailDeliveryStatus: 'not_required',
    verificationEmailSentAt: null,
    lastVerificationEmailLogId: null,
    lastVerificationEmailPostmarkMessageId: null,
  };
}

function buildGoogleLinkVerificationProvenance(existingUser, nowIso) {
  const wasAlreadyVerified = existingUser && existingUser.verified === true;
  return {
    authProvider: existingUser && existingUser.passwordHash ? 'mixed' : 'google',
    verified: true,
    verifiedAt: wasAlreadyVerified ? existingUser.verifiedAt || null : nowIso,
    verificationMethod: wasAlreadyVerified
      ? existingUser.verificationMethod || 'google_verified_email'
      : 'google_verified_email',
    verifiedBy: wasAlreadyVerified
      ? existingUser.verifiedBy || null
      : {
          type: 'google',
          provider: 'google',
          reason: 'Existing account linked to authoritative Google email',
        },
    emailDeliveryStatus: wasAlreadyVerified
      ? existingUser.emailDeliveryStatus || 'not_required'
      : 'not_required',
  };
}

module.exports = {
  buildGoogleVerificationProvenance,
  buildGoogleLinkVerificationProvenance,
};
