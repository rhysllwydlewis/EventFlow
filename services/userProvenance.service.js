'use strict';

function iso(value) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function hasGoogleLink(user) {
  return Boolean(user && (user.googleSub || (user.authProviderIds && user.authProviderIds.google)));
}

function hasAppleLink(user) {
  return Boolean(user && (user.appleSub || (user.authProviderIds && user.authProviderIds.apple)));
}

function hasFacebookLink(user) {
  return Boolean(
    user && (user.facebookSub || (user.authProviderIds && user.authProviderIds.facebook))
  );
}

function safeVerifiedBy(verifiedBy) {
  if (!verifiedBy || typeof verifiedBy !== 'object') {
    return null;
  }
  return {
    type: verifiedBy.type || null,
    provider: verifiedBy.provider || null,
    userId: verifiedBy.userId || null,
    reason: verifiedBy.reason ? String(verifiedBy.reason).slice(0, 180) : null,
  };
}

function verificationEmailStatusFromSendResult(result) {
  const provider = result && result.provider;
  const logStatus = result && result.emailLogStatus;
  if (provider === 'outbox' || result?.status === 'disabled') {
    return 'outbox';
  }
  if (logStatus === 'failed') {
    return 'failed';
  }
  if (logStatus === 'delivered') {
    return 'delivered';
  }
  if (logStatus === 'bounced') {
    return 'bounced';
  }
  if (provider === 'postmark' || result?.MessageID || result?.PostmarkMessageID) {
    return 'sent';
  }
  return 'pending';
}

function metadataFromSendResult(result, at = new Date().toISOString()) {
  return {
    verificationEmailSentAt: (result && result.sentAt) || at,
    lastVerificationEmailLogId: (result && result.emailLogId) || null,
    lastVerificationEmailPostmarkMessageId:
      (result && (result.MessageID || result.PostmarkMessageID || result.postmarkMessageId)) ||
      null,
    emailDeliveryStatus: verificationEmailStatusFromSendResult(result),
  };
}

function emailPasswordPendingProvenance() {
  return {
    signupMethod: 'email_password',
    authProvider: 'local',
    verificationMethod: 'pending',
    verifiedAt: null,
    verifiedBy: null,
    emailDeliveryStatus: 'pending',
    verificationEmailSentAt: null,
    lastVerificationEmailLogId: null,
    lastVerificationEmailPostmarkMessageId: null,
  };
}

function ownerProvenance(nowIso, type = 'owner') {
  return {
    signupMethod: 'owner_seed',
    authProvider: 'local',
    verificationMethod: 'owner_account',
    verifiedAt: nowIso,
    verifiedBy: {
      type,
      reason: 'Owner/system account does not require email verification',
    },
    emailDeliveryStatus: 'not_required',
    verificationEmailSentAt: null,
    lastVerificationEmailLogId: null,
    lastVerificationEmailPostmarkMessageId: null,
  };
}

function googleSignupProvenance(nowIso) {
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

function googleLinkProvenance(existingUser, nowIso) {
  const alreadyVerified = existingUser && existingUser.verified === true;
  const missingMethod =
    !existingUser.verificationMethod || existingUser.verificationMethod === 'unknown';
  const updates = {
    authProvider: existingUser && existingUser.passwordHash ? 'mixed' : 'google',
  };
  if (!existingUser.signupMethod) {
    updates.signupMethod = existingUser.passwordHash ? 'email_password' : 'google';
  }
  if (!alreadyVerified) {
    Object.assign(updates, {
      verified: true,
      verifiedAt: nowIso,
      verificationMethod: 'google_verified_email',
      verifiedBy: {
        type: 'google',
        provider: 'google',
        reason: 'Existing account linked to authoritative Google email',
      },
      emailDeliveryStatus: 'not_required',
    });
  } else {
    if (!existingUser.verifiedAt) {
      updates.verifiedAt = nowIso;
    }
    if (missingMethod) {
      updates.verificationMethod = 'google_verified_email';
    }
    if (!existingUser.verifiedBy) {
      updates.verifiedBy = {
        type: 'google',
        provider: 'google',
        reason: 'Existing account linked to authoritative Google email',
      };
    }
    if (!existingUser.emailDeliveryStatus || missingMethod) {
      updates.emailDeliveryStatus = 'not_required';
    }
  }
  return updates;
}

function appleSignupProvenance(nowIso) {
  return {
    signupMethod: 'apple',
    authProvider: 'apple',
    verifiedAt: nowIso,
    verificationMethod: 'apple_verified_email',
    verifiedBy: {
      type: 'apple',
      provider: 'apple',
      reason: 'Apple ID token email_verified=true',
    },
    emailDeliveryStatus: 'not_required',
    verificationEmailSentAt: null,
    lastVerificationEmailLogId: null,
    lastVerificationEmailPostmarkMessageId: null,
  };
}

function appleLinkProvenance(existingUser, nowIso) {
  const alreadyVerified = existingUser && existingUser.verified === true;
  const missingMethod =
    !existingUser.verificationMethod || existingUser.verificationMethod === 'unknown';
  const updates = {
    authProvider: existingUser && existingUser.passwordHash ? 'mixed' : 'apple',
  };
  if (!existingUser.signupMethod) {
    updates.signupMethod = existingUser.passwordHash ? 'email_password' : 'apple';
  }
  if (!alreadyVerified) {
    Object.assign(updates, {
      verified: true,
      verifiedAt: nowIso,
      verificationMethod: 'apple_verified_email',
      verifiedBy: {
        type: 'apple',
        provider: 'apple',
        reason: 'Existing account linked to authoritative Apple email',
      },
      emailDeliveryStatus: 'not_required',
    });
  } else {
    if (!existingUser.verifiedAt) {
      updates.verifiedAt = nowIso;
    }
    if (missingMethod) {
      updates.verificationMethod = 'apple_verified_email';
    }
    if (!existingUser.verifiedBy) {
      updates.verifiedBy = {
        type: 'apple',
        provider: 'apple',
        reason: 'Existing account linked to authoritative Apple email',
      };
    }
    if (!existingUser.emailDeliveryStatus || missingMethod) {
      updates.emailDeliveryStatus = 'not_required';
    }
  }
  return updates;
}

function facebookSignupProvenance(nowIso) {
  return {
    signupMethod: 'facebook',
    authProvider: 'facebook',
    verifiedAt: nowIso,
    verificationMethod: 'facebook_verified_email',
    verifiedBy: {
      type: 'facebook',
      provider: 'facebook',
      reason: 'Facebook Graph API confirmed account email',
    },
    emailDeliveryStatus: 'not_required',
    verificationEmailSentAt: null,
    lastVerificationEmailLogId: null,
    lastVerificationEmailPostmarkMessageId: null,
  };
}

function facebookLinkProvenance(existingUser, nowIso) {
  const alreadyVerified = existingUser && existingUser.verified === true;
  const missingMethod =
    !existingUser.verificationMethod || existingUser.verificationMethod === 'unknown';
  const updates = {
    authProvider: existingUser && existingUser.passwordHash ? 'mixed' : 'facebook',
  };
  if (!existingUser.signupMethod) {
    updates.signupMethod = existingUser.passwordHash ? 'email_password' : 'facebook';
  }
  if (!alreadyVerified) {
    Object.assign(updates, {
      verified: true,
      verifiedAt: nowIso,
      verificationMethod: 'facebook_verified_email',
      verifiedBy: {
        type: 'facebook',
        provider: 'facebook',
        reason: 'Existing account linked to authoritative Facebook email',
      },
      emailDeliveryStatus: 'not_required',
    });
  } else {
    if (!existingUser.verifiedAt) {
      updates.verifiedAt = nowIso;
    }
    if (missingMethod) {
      updates.verificationMethod = 'facebook_verified_email';
    }
    if (!existingUser.verifiedBy) {
      updates.verifiedBy = {
        type: 'facebook',
        provider: 'facebook',
        reason: 'Existing account linked to authoritative Facebook email',
      };
    }
    if (!existingUser.emailDeliveryStatus || missingMethod) {
      updates.emailDeliveryStatus = 'not_required';
    }
  }
  return updates;
}

function adminCreatedProvenance(adminId, nowIso) {
  return {
    signupMethod: 'admin_created',
    authProvider: 'admin',
    verifiedAt: nowIso,
    verificationMethod: 'admin_created',
    verifiedBy: { type: 'admin', userId: adminId || null, reason: 'Created by admin' },
    emailDeliveryStatus: 'not_required',
    verificationEmailSentAt: null,
    lastVerificationEmailLogId: null,
    lastVerificationEmailPostmarkMessageId: null,
  };
}

function eventflowEmailVerifiedProvenance(nowIso) {
  return {
    verified: true,
    verifiedAt: nowIso,
    verificationMethod: 'eventflow_email',
    verifiedBy: { type: 'user', reason: 'User completed EventFlow email verification' },
  };
}

function canResendVerification(user) {
  if (!user || user.verified === true || user.emailVerified === true) {
    return false;
  }
  if (
    [
      'google_verified_email',
      'apple_verified_email',
      'facebook_verified_email',
      'admin_created',
      'owner_account',
    ].includes(user.verificationMethod)
  ) {
    return false;
  }
  if (['google', 'apple', 'facebook', 'admin', 'owner_seed'].includes(user.signupMethod)) {
    return false;
  }
  return true;
}

function inferSignupMethod(user) {
  if (!user) {
    return 'unknown';
  }
  if (user.signupMethod) {
    return user.signupMethod;
  }
  if (user.isOwner) {
    return 'owner_seed';
  }
  if (user.createdBy && user.verified === true) {
    return 'admin_created';
  }
  if (hasGoogleLink(user) || user.authProvider === 'google') {
    return 'google';
  }
  if (hasAppleLink(user) || user.authProvider === 'apple') {
    return 'apple';
  }
  if (hasFacebookLink(user) || user.authProvider === 'facebook') {
    return 'facebook';
  }
  if (user.passwordHash) {
    return 'email_password';
  }
  return 'unknown';
}

function inferAuthProvider(user) {
  if (!user) {
    return 'unknown';
  }
  if ((hasGoogleLink(user) || hasAppleLink(user) || hasFacebookLink(user)) && user.passwordHash) {
    return 'mixed';
  }
  if (user.authProvider) {
    return user.authProvider;
  }
  if (hasGoogleLink(user)) {
    return 'google';
  }
  if (hasAppleLink(user)) {
    return 'apple';
  }
  if (hasFacebookLink(user)) {
    return 'facebook';
  }
  if (user.createdBy && user.verified === true && !user.passwordHash) {
    return 'admin';
  }
  if (user.passwordHash) {
    return 'local';
  }
  return 'unknown';
}

function inferVerificationMethod(user) {
  if (!user) {
    return 'unknown';
  }
  if (user.verificationMethod) {
    return user.verificationMethod;
  }
  if (user.verified !== true && user.emailVerified !== true) {
    return 'pending';
  }
  if (user.isOwner) {
    return 'owner_account';
  }
  if (user.createdBy) {
    return 'admin_created';
  }
  if (hasGoogleLink(user) || user.authProvider === 'google') {
    return 'google_verified_email';
  }
  if (hasAppleLink(user) || user.authProvider === 'apple') {
    return 'apple_verified_email';
  }
  if (hasFacebookLink(user) || user.authProvider === 'facebook') {
    return 'facebook_verified_email';
  }
  if (user.verifiedAt && user.verificationEmailSentAt) {
    return 'eventflow_email';
  }
  return 'unknown';
}

function safeUserProvenance(user, verificationSummary = {}) {
  const signupMethod = verificationSummary.signupMethod || inferSignupMethod(user);
  const authProvider = verificationSummary.authProvider || inferAuthProvider(user);
  const verificationMethod =
    verificationSummary.verificationMethod || inferVerificationMethod(user);
  return {
    signupMethod,
    authProvider,
    verificationMethod,
    verifiedAt: iso(user && user.verifiedAt) || verificationSummary.verifiedAt || null,
    verifiedBy: safeVerifiedBy((user && user.verifiedBy) || verificationSummary.verifiedBy),
    emailDeliveryStatus:
      verificationSummary.emailDeliveryStatus || (user && user.emailDeliveryStatus) || 'unknown',
    verificationEmailSentAt:
      iso(user && user.verificationEmailSentAt) ||
      verificationSummary.verificationEmailSentAt ||
      null,
    lastVerificationEmailLogId:
      (user && user.lastVerificationEmailLogId) ||
      verificationSummary.lastVerificationEmailLogId ||
      null,
    lastVerificationEmailPostmarkMessageId:
      (user && user.lastVerificationEmailPostmarkMessageId) ||
      verificationSummary.lastVerificationEmailPostmarkMessageId ||
      null,
    hasGoogleLink: hasGoogleLink(user),
    googleLinkedAt: iso(user && user.googleLinkedAt),
    hasAppleLink: hasAppleLink(user),
    appleLinkedAt: iso(user && user.appleLinkedAt),
    hasFacebookLink: hasFacebookLink(user),
    facebookLinkedAt: iso(user && user.facebookLinkedAt),
  };
}

module.exports = {
  iso,
  hasGoogleLink,
  hasAppleLink,
  hasFacebookLink,
  safeVerifiedBy,
  metadataFromSendResult,
  emailPasswordPendingProvenance,
  ownerProvenance,
  googleSignupProvenance,
  googleLinkProvenance,
  appleSignupProvenance,
  appleLinkProvenance,
  facebookSignupProvenance,
  facebookLinkProvenance,
  adminCreatedProvenance,
  eventflowEmailVerifiedProvenance,
  canResendVerification,
  inferSignupMethod,
  inferAuthProvider,
  inferVerificationMethod,
  safeUserProvenance,
};
