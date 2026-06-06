'use strict';

const dbUnified = require('../db-unified');
const emailLogService = require('./emailLog.service');

const LOOKBACK_DAYS = 30;

function iso(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function hasGoogleLink(user) {
  return Boolean(
    user &&
      (user.googleSub ||
        (user.authProviderIds && user.authProviderIds.google) ||
        user.authProvider === 'google')
  );
}

function maskEmail(email) {
  const value = String(email || '');
  const parts = value.split('@');
  if (parts.length !== 2) return value ? '***' : null;
  return parts[0].slice(0, 1) + '***@' + parts[1];
}

function inferSignupMethod(user) {
  if (!user) return 'unknown';
  if (user.signupMethod) return user.signupMethod;
  if (user.isOwner) return 'owner_seed';
  if (user.createdBy && user.verified === true) return 'admin_created';
  if (hasGoogleLink(user)) return 'google';
  if (user.passwordHash) return 'email_password';
  return 'unknown';
}

function inferAuthProvider(user) {
  if (!user) return 'unknown';
  if (hasGoogleLink(user) && user.passwordHash) return 'mixed';
  if (user.authProvider) return user.authProvider;
  if (hasGoogleLink(user)) return 'google';
  if (user.createdBy && user.verified === true && !user.passwordHash) return 'admin';
  if (user.passwordHash) return 'local';
  return 'unknown';
}

function inferVerificationMethod(user) {
  if (!user) return 'unknown';
  if (user.verificationMethod) return user.verificationMethod;
  if (user.verified !== true && user.emailVerified !== true) return 'pending';
  if (user.isOwner) return 'owner_account';
  if (user.createdBy) return 'admin_created';
  if (hasGoogleLink(user)) return 'google_verified_email';
  if (user.verifiedAt && user.verificationEmailSentAt) return 'eventflow_email';
  return 'unknown';
}

function inferVerifiedBy(user, method) {
  if (user && user.verifiedBy && typeof user.verifiedBy === 'object') {
    return {
      type: user.verifiedBy.type || null,
      provider: user.verifiedBy.provider || null,
      userId: user.verifiedBy.userId || null,
      reason: user.verifiedBy.reason ? String(user.verifiedBy.reason).slice(0, 180) : null,
    };
  }
  if (method === 'google_verified_email') {
    return { type: 'google', provider: 'google', reason: 'Google account email was verified by Google' };
  }
  if (method === 'admin_created') {
    return { type: 'admin', userId: user && user.createdBy ? user.createdBy : null, reason: 'Account was created by an admin' };
  }
  if (method === 'owner_account') {
    return { type: 'owner', reason: 'Owner/system account does not require email verification' };
  }
  if (method === 'eventflow_email') {
    return { type: 'user', reason: 'User completed EventFlow email verification' };
  }
  return null;
}

function isVerificationLog(log) {
  if (!log) return false;
  const subject = String(log.subject || '').toLowerCase();
  return (
    log.template === 'verification' ||
    (Array.isArray(log.tags) && log.tags.includes('verification')) ||
    subject.includes('verify your email') ||
    subject.includes('confirm your eventflow account')
  );
}

function findVerificationLogsForUser(user, logs) {
  const email = String((user && user.email) || '').toLowerCase();
  if (!email) return [];
  return (logs || [])
    .filter(log => {
      if (!isVerificationLog(log)) return false;
      const recipients = Array.isArray(log.recipients) ? log.recipients : [log.to];
      return recipients
        .map(value => String(value || '').toLowerCase())
        .some(value => value.includes(email));
    })
    .sort((a, b) => String(b.createdAt || b.attemptedAt || '').localeCompare(String(a.createdAt || a.attemptedAt || '')));
}

function inferEmailDeliveryStatus(user, logs) {
  if (user && user.emailDeliveryStatus) return user.emailDeliveryStatus;
  const method = inferVerificationMethod(user);
  if (['google_verified_email', 'admin_created', 'owner_account', 'not_required'].includes(method)) return 'not_required';
  const matching = findVerificationLogsForUser(user, logs);
  if (matching.some(log => log.status === 'bounced')) return 'bounced';
  if (matching.some(log => log.status === 'failed')) return 'failed';
  if (matching.some(log => log.provider === 'outbox')) return 'outbox';
  if (matching.some(log => ['sent', 'delivered', 'opened', 'clicked'].includes(log.status))) return 'sent';
  return user && user.verified === true ? 'unknown' : 'pending';
}

function summariseUser(user, logs) {
  const signupMethod = inferSignupMethod(user);
  const authProvider = inferAuthProvider(user);
  const verificationMethod = inferVerificationMethod(user);
  const userLogs = findVerificationLogsForUser(user, logs);
  const lastLog = userLogs[0] || null;
  const verifiedAt =
    iso(user && user.verifiedAt) ||
    (verificationMethod === 'google_verified_email' ? iso((user && user.googleLinkedAt) || (user && user.createdAt)) : null) ||
    (verificationMethod === 'admin_created' ? iso(user && user.createdAt) : null) ||
    (verificationMethod === 'owner_account' ? iso(user && user.createdAt) : null);
  return {
    signupMethod,
    authProvider,
    verificationMethod,
    verified: Boolean(user && (user.verified === true || user.emailVerified === true)),
    verifiedAt,
    verifiedBy: inferVerifiedBy(user, verificationMethod),
    verificationEmailSentAt: iso(user && user.verificationEmailSentAt) || iso(lastLog && lastLog.sentAt),
    lastVerificationEmailLogId: (user && user.lastVerificationEmailLogId) || (lastLog && lastLog.id) || null,
    lastVerificationEmailPostmarkMessageId:
      (user && user.lastVerificationEmailPostmarkMessageId) || (lastLog && lastLog.postmarkMessageId) || null,
    emailDeliveryStatus: inferEmailDeliveryStatus(user, logs),
    hasGoogleLink: hasGoogleLink(user),
    googleLinkedAt: iso(user && user.googleLinkedAt),
  };
}

async function readVerificationLogs() {
  const logs = await dbUnified.read(emailLogService.COLLECTION || 'email_logs');
  return (logs || []).filter(isVerificationLog);
}

function addIssue(issues, severity, user, issue, message, details) {
  issues.push({
    severity,
    userId: user && user.id ? user.id : null,
    email: maskEmail(user && user.email),
    issue,
    message,
    details: details || {},
  });
}

async function getVerificationIntegrity(options) {
  const lookbackDays = Number((options && options.lookbackDays) || LOOKBACK_DAYS);
  const users = await dbUnified.read('users');
  const logs = await readVerificationLogs();
  const threshold = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const checkedUsers = (users || []).filter(user => {
    const created = Date.parse(user.createdAt || 0);
    return created && created >= threshold;
  });
  const issues = [];
  const production = process.env.NODE_ENV === 'production';
  const emailEnabled = String(process.env.EMAIL_ENABLED || 'false').toLowerCase() === 'true';
  const postmarkConfigured = Boolean(process.env.POSTMARK_API_KEY);

  if (production && !postmarkConfigured) {
    addIssue(issues, 'critical', null, 'postmark_not_configured_in_production', 'Postmark is not configured in production.');
  }
  if (production && !emailEnabled) {
    addIssue(issues, 'critical', null, 'email_disabled_in_production', 'Email sending is disabled in production.');
  }

  for (const user of checkedUsers) {
    const summary = summariseUser(user, logs);
    const userLogs = findVerificationLogsForUser(user, logs);
    if (summary.signupMethod === 'email_password' && user.verified !== true && userLogs.length === 0) {
      addIssue(issues, 'critical', user, 'email_password_user_missing_verification_email_log', 'Email/password user has no verification email log.');
    }
    if (user.verified === true && !summary.verifiedAt) {
      addIssue(issues, 'warning', user, 'verified_user_missing_verified_at', 'Verified user has no verifiedAt timestamp.', { verificationMethod: summary.verificationMethod });
    }
    if (user.verified === true && summary.verificationMethod === 'unknown') {
      addIssue(issues, 'warning', user, 'verified_user_unknown_verification_method', 'Verified user has unknown verification method.');
    }
    if (user.verified === true && summary.signupMethod === 'unknown') {
      addIssue(issues, 'warning', user, 'verified_user_unknown_signup_method', 'Verified user has unknown signup method.');
    }
    if (summary.authProvider === 'google' && !hasGoogleLink(user)) {
      addIssue(issues, 'critical', user, 'google_provider_missing_google_link', 'Google-authenticated user has no Google link field.');
    }
    if (hasGoogleLink(user) && !['google', 'mixed'].includes(summary.authProvider)) {
      addIssue(issues, 'warning', user, 'google_link_with_non_google_provider', 'User has Google linkage but authProvider is not google or mixed.', { authProvider: summary.authProvider });
    }
    for (const log of userLogs) {
      if (production && log.provider === 'outbox') {
        addIssue(issues, 'critical', user, 'verification_email_logged_as_outbox_in_production', 'Verification email used outbox in production.', { emailLogId: log.id });
      }
      if (log.status === 'failed') {
        addIssue(issues, 'critical', user, 'verification_email_failed', 'Verification email failed.', { emailLogId: log.id, errorMessage: log.errorMessage || null });
      }
      if (log.status === 'bounced') {
        addIssue(issues, 'critical', user, 'verification_email_bounced', 'Verification email bounced.', { emailLogId: log.id });
      }
    }
  }

  if (checkedUsers.length > 0 && logs.length === 0) {
    addIssue(issues, 'warning', null, 'recent_users_but_no_recent_verification_logs', 'Recent users exist but no verification email logs were found.', { checkedUsers: checkedUsers.length });
  }

  const summary = {
    checkedUsers: checkedUsers.length,
    criticalIssues: issues.filter(issue => issue.severity === 'critical').length,
    warnings: issues.filter(issue => issue.severity === 'warning').length,
    emailPasswordUsersMissingVerificationEmailLogs: issues.filter(issue => issue.issue === 'email_password_user_missing_verification_email_log').length,
    googleUsersWithValidProvenance: checkedUsers.filter(user => summariseUser(user, logs).verificationMethod === 'google_verified_email').length,
    verificationEmailLogs: logs.length,
    outboxVerificationEmailLogs: logs.filter(log => log.provider === 'outbox').length,
    failedVerificationEmailLogs: logs.filter(log => log.status === 'failed').length,
    bouncedVerificationEmailLogs: logs.filter(log => log.status === 'bounced').length,
  };

  return { ok: true, lookbackDays, summary, issues };
}

module.exports = {
  hasGoogleLink,
  inferSignupMethod,
  inferAuthProvider,
  inferVerificationMethod,
  inferEmailDeliveryStatus,
  summariseUser,
  getVerificationIntegrity,
  findVerificationLogsForUser,
  readVerificationLogs,
};
