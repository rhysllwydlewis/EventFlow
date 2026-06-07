/**
 * Admin User Summary Service
 *
 * Single source of truth for user and supplier counting logic.
 * Used by both the /admin dashboard and the /admin-users Users Centre so
 * the numbers are always consistent — no more counting in two different places.
 *
 * Design decisions:
 * - All counts are derived from a single read of the users and suppliers
 *   collections so a request is not penalised by N+1 queries.
 * - Supplier linkage: suppliers are keyed by ownerUserId. A lookup map is
 *   built once per call then O(1) per user.
 * - Provenance classification mirrors the logic in the email centre diagnostics
 *   so counts stay consistent across /admin, /admin-users, and /admin-emails.
 * - No raw secrets (googleSub, resetToken, passwordHash, verificationToken) are
 *   returned. The service produces safe summary fields only.
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const verificationProvenance = require('./verificationProvenance.service');
const userProvenance = require('./userProvenance.service');
const emailLogService = require('./emailLog.service');

// ---------------------------------------------------------------------------
// Provenance classification (mirrors email-centre diagnostics)
// ---------------------------------------------------------------------------

/**
 * Derive a safe signupMethod string from a raw user record.
 * @param {Object} u - Raw user record
 * @returns {'google'|'email_password'|'admin_created'|'owner'|'unknown'}
 */
function classifySignupMethod(u = {}) {
  if (u.authProvider === 'google' || u.googleSub) {
    return 'google';
  }
  if (u.role === 'admin' && !u.passwordHash && !u.authProvider) {
    return 'admin_created';
  }
  if (u.role === 'owner') {
    return 'owner';
  }
  if (u.passwordHash || u.signupMethod === 'email_password') {
    return 'email_password';
  }
  return 'unknown';
}

/**
 * Derive a safe verificationMethod string from a raw user record.
 * @param {Object} u - Raw user record
 * @returns {'google'|'email_link'|'admin'|'legacy'|'pending'|'unknown'}
 */
function classifyVerificationMethod(u = {}) {
  const verified = u.verified === true || u.emailVerified === true;
  if (!verified) {
    return 'pending';
  }
  if (u.verifiedBy === 'google' || u.authProvider === 'google') {
    return 'google';
  }
  if (u.verifiedBy === 'admin' || u.verifiedByAdmin) {
    return 'admin';
  }
  if (u.verifiedAt && u.verificationToken === undefined && u.emailVerificationToken === undefined) {
    return 'email_link';
  }
  if (verified && !u.verifiedAt) {
    return 'legacy';
  }
  if (u.verifiedAt) {
    return 'email_link';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Safe user projection — never returns secrets
// ---------------------------------------------------------------------------

/**
 * Project a raw user record into the safe shape used by admin list endpoints.
 * Strips: passwordHash, password, googleSub, resetToken, resetTokenExpiresAt,
 *   verificationToken, emailVerificationToken, authProviderIds.
 *
 * @param {Object} u - Raw user record
 * @param {Object|null} supplier - Linked supplier record (or null)
 * @returns {Object} Safe user projection
 */
function safeUserId(u) {
  return u && (u.id || (u._id ? String(u._id) : undefined));
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function safeDateIso(value) {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function getSupplierOwnerId(supplier) {
  return (
    supplier && (supplier.ownerUserId || supplier.userId || supplier.ownerId || supplier.user_id)
  );
}

function isProfileIncomplete(supplier) {
  if (!supplier) {
    return true;
  }
  if (supplier.profileComplete === true || supplier.profileCompleted === true) {
    return false;
  }
  return !(
    (supplier.name || supplier.businessName) &&
    (supplier.description_short || supplier.description)
  );
}

async function safeRead(collection, stage) {
  try {
    return asArray(await dbUnified.read(collection));
  } catch (err) {
    logger.warn('[adminUserSummary] Optional collection read failed', {
      collection,
      stage,
      message: err && err.message,
    });
    return [];
  }
}

function projectUser(u, supplier, verificationLogs = []) {
  const user = u || {};
  const verificationSummary = verificationProvenance.summariseUser(user, verificationLogs);
  const provenance = userProvenance.safeUserProvenance(user, verificationSummary);
  const signupMethod = classifySignupMethod(user);
  const verificationMethod = classifyVerificationMethod(user);

  const supplierSummary = supplier
    ? {
        id: supplier.id || (supplier._id ? String(supplier._id) : undefined),
        name: supplier.name || supplier.businessName || null,
        approved: supplier.approved === true || supplier.approvalStatus === 'approved',
        approvalStatus:
          supplier.approvalStatus ||
          supplier.status ||
          (supplier.approved ? 'approved' : 'pending'),
        profileComplete: !isProfileIncomplete(supplier),
        packageCount: Array.isArray(supplier.packages)
          ? supplier.packages.length
          : Number(supplier.packageCount || supplier.listingCount || 0),
        profileUrl: `/admin-supplier-detail?id=${supplier.id || (supplier._id ? String(supplier._id) : '')}`,
      }
    : null;

  return {
    id: safeUserId(user),
    name: user.name || null,
    email: user.email || null,
    role: user.role || 'customer',
    verified: !!(user.verified || user.emailVerified),
    suspended: !!user.suspended,
    marketingOptIn: !!user.marketingOptIn,
    emailUnsubscribed: !!user.emailUnsubscribed,
    createdAt: user.createdAt || null,
    lastLoginAt: user.lastLoginAt || null,
    subscription: user.subscription || { tier: 'free', status: 'active' },
    // Provenance (safe — no raw tokens or googleSub)
    signupMethod,
    verificationMethod,
    verifiedAt: user.verifiedAt || provenance.verifiedAt || null,
    authProvider: provenance.authProvider || null,
    emailDeliveryStatus: provenance.emailDeliveryStatus || 'unknown',
    verificationEmailSentAt: provenance.verificationEmailSentAt || null,
    hasGoogleLink:
      provenance.hasGoogleLink ||
      !!(user.googleSub || (user.authProviderIds && user.authProviderIds.google)),
    // Supplier linkage summary
    supplierProfile: supplierSummary,
    // Account health flags
    accountIssues: buildAccountIssues(user, supplier, signupMethod, verificationMethod),
  };
}

/**
 * Build a list of account health issue codes for a user.
 * @returns {string[]}
 */
function buildAccountIssues(u, supplier, signupMethod, verificationMethod) {
  const issues = [];
  if (verificationMethod === 'unknown') {
    issues.push('unknown_verification_source');
  }
  if (verificationMethod === 'pending' && signupMethod === 'email_password') {
    issues.push('email_unverified');
  }
  if ((u.role || 'customer') === 'supplier' && !supplier) {
    issues.push('supplier_profile_missing');
  }
  if (u.suspended) {
    issues.push('suspended');
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Main service functions
// ---------------------------------------------------------------------------

/**
 * Build a full summary of user and supplier counts.
 * Called by both /admin (dashboard) and /admin-users (Users Centre).
 *
 * @returns {Promise<Object>}
 */
async function buildUserSummary() {
  const stage = { name: 'read' };
  try {
    const [allUsers, allSuppliers, allPackages, allEmailLogs] = await Promise.all([
      safeRead('users', 'users'),
      safeRead('suppliers', 'suppliers'),
      safeRead('packages', 'packages'),
      safeRead(emailLogService.COLLECTION || 'email_logs', 'email_logs'),
    ]);

    stage.name = 'normalise';
    const users = asArray(allUsers).filter(user => user && typeof user === 'object');
    const suppliers = asArray(allSuppliers).filter(
      supplier => supplier && typeof supplier === 'object'
    );
    const packages = asArray(allPackages).filter(pkg => pkg && typeof pkg === 'object');
    const emailLogs = asArray(allEmailLogs);

    const supplierByOwner = {};
    for (const supplier of suppliers) {
      const ownerId = getSupplierOwnerId(supplier);
      if (ownerId) {
        supplierByOwner[String(ownerId)] = supplier;
      }
    }

    const userIds = new Set(users.map(safeUserId).filter(Boolean).map(String));
    const packageCountBySupplier = {};
    for (const pkg of packages) {
      const supplierId = pkg.supplierId || pkg.supplier_id || pkg.supplier || pkg.ownerSupplierId;
      if (supplierId) {
        packageCountBySupplier[String(supplierId)] =
          (packageCountBySupplier[String(supplierId)] || 0) + 1;
      }
    }
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const byRole = { customer: 0, supplier: 0, admin: 0, owner: 0, other: 0 };
    const bySignup = { google: 0, email_password: 0, admin_created: 0, owner: 0, unknown: 0 };
    const byVerification = {
      google: 0,
      email_link: 0,
      admin: 0,
      legacy: 0,
      pending: 0,
      unknown: 0,
    };

    let issueCount = 0;
    let suspendedCount = 0;
    let unverifiedCount = 0;
    let newLast7 = 0;
    let activeLast7 = 0;
    let latestSignupAt = null;

    const health = {
      emailPasswordPending: 0,
      googleVerified: 0,
      eventflowEmailVerified: 0,
      adminCreated: 0,
      ownerAccounts: 0,
      unknownVerificationSource: 0,
      verificationEmailFailures: 0,
      verificationOutboxFallbacks: 0,
      verificationBounces: 0,
      lastNewSignupAt: null,
      lastVerificationEmailAttemptAt: null,
    };

    stage.name = 'users';
    for (const rawUser of users) {
      const user = rawUser || {};
      const userId = safeUserId(user);
      const role = user.role || 'customer';
      if (Object.prototype.hasOwnProperty.call(byRole, role)) {
        byRole[role]++;
      } else {
        byRole.other++;
      }

      const provenance = verificationProvenance.summariseUser(user, emailLogs) || {};
      const signupMethod = classifySignupMethod(user);
      const verificationMethod = classifyVerificationMethod(user);
      bySignup[signupMethod] = (bySignup[signupMethod] || 0) + 1;
      byVerification[verificationMethod] = (byVerification[verificationMethod] || 0) + 1;

      if (provenance.signupMethod === 'google' || signupMethod === 'google') {
        health.googleVerified += provenance.verified || user.verified ? 1 : 0;
      }
      if (
        provenance.verificationMethod === 'eventflow_email' ||
        verificationMethod === 'email_link'
      ) {
        health.eventflowEmailVerified++;
      }
      if (provenance.verificationMethod === 'admin_created' || signupMethod === 'admin_created') {
        health.adminCreated++;
      }
      if (
        provenance.verificationMethod === 'owner_account' ||
        signupMethod === 'owner' ||
        user.isOwner
      ) {
        health.ownerAccounts++;
      }
      if (provenance.verificationMethod === 'unknown' || verificationMethod === 'unknown') {
        health.unknownVerificationSource++;
      }
      if (
        (provenance.emailDeliveryStatus === 'pending' || verificationMethod === 'pending') &&
        signupMethod === 'email_password'
      ) {
        health.emailPasswordPending++;
      }

      if (!(user.verified || user.emailVerified)) {
        unverifiedCount++;
      }
      if (user.suspended) {
        suspendedCount++;
      }

      const supplier = userId ? supplierByOwner[String(userId)] || null : null;
      const issues = buildAccountIssues(user, supplier, signupMethod, verificationMethod);
      if (issues.length > 0) {
        issueCount++;
      }

      const createdMs = Date.parse(user.createdAt || 0);
      if (createdMs && createdMs > sevenDaysAgo) {
        newLast7++;
        if (!latestSignupAt || createdMs > Date.parse(latestSignupAt || 0)) {
          latestSignupAt = safeDateIso(user.createdAt);
        }
      }

      const loginMs = Date.parse(user.lastLoginAt || 0);
      if (loginMs && loginMs > sevenDaysAgo) {
        activeLast7++;
      }
    }

    stage.name = 'suppliers';
    const pendingSuppliers = suppliers.filter(s => {
      const status = s.approvalStatus || s.verificationStatus || s.status;
      return !(s.approved === true || status === 'approved') && status !== 'rejected';
    }).length;
    const approvedSuppliers = suppliers.filter(
      s => s.approved === true || s.approvalStatus === 'approved'
    ).length;
    const incompleteProfiles = suppliers.filter(isProfileIncomplete).length;
    const suppliersWithoutProfile = users.filter(
      u => (u.role || 'customer') === 'supplier' && !supplierByOwner[String(safeUserId(u) || '')]
    ).length;
    const orphanedSuppliers = suppliers.filter(s => {
      const ownerId = getSupplierOwnerId(s);
      return ownerId && !userIds.has(String(ownerId));
    }).length;
    const withoutPackages = suppliers.filter(s => {
      const supplierId = s.id || (s._id ? String(s._id) : undefined);
      const directCount = Array.isArray(s.packages)
        ? s.packages.length
        : Number(s.packageCount || s.listingCount || 0);
      const packageCollectionCount = supplierId
        ? packageCountBySupplier[String(supplierId)] || 0
        : 0;
      return directCount + packageCollectionCount === 0;
    }).length;
    const supplierLinkIssues = suppliersWithoutProfile + orphanedSuppliers;

    stage.name = 'email_logs';
    const verificationLogs = emailLogs.filter(log => {
      const subject = String(log.subject || '').toLowerCase();
      return (
        log.template === 'verification' ||
        (Array.isArray(log.tags) && log.tags.includes('verification')) ||
        subject.includes('verify your email') ||
        subject.includes('confirm your eventflow account')
      );
    });
    health.verificationEmailFailures = verificationLogs.filter(
      log => log.status === 'failed'
    ).length;
    health.verificationOutboxFallbacks = verificationLogs.filter(
      log => log.provider === 'outbox'
    ).length;
    health.verificationBounces = verificationLogs.filter(log => log.status === 'bounced').length;
    const sortedVerificationLogs = verificationLogs
      .slice()
      .sort(
        (a, b) =>
          Date.parse(b.sentAt || b.createdAt || b.attemptedAt || 0) -
          Date.parse(a.sentAt || a.createdAt || a.attemptedAt || 0)
      );
    health.lastVerificationEmailAttemptAt = safeDateIso(
      sortedVerificationLogs[0] &&
        (sortedVerificationLogs[0].sentAt ||
          sortedVerificationLogs[0].createdAt ||
          sortedVerificationLogs[0].attemptedAt)
    );
    health.lastNewSignupAt = latestSignupAt;

    const summary = {
      totalUsers: users.length,
      customers: byRole.customer,
      suppliers: byRole.supplier,
      admins: byRole.admin + byRole.owner,
      newUsersLast7Days: newLast7,
      recentlyActiveUsersLast7Days: activeLast7,
      unverifiedUsers: unverifiedCount,
      verificationIssues: issueCount,
      pendingSupplierApprovals: pendingSuppliers,
      supplierProfilesIncomplete: incompleteProfiles,
      supplierLinkIssues,
    };

    const supplierHealth = {
      totalSupplierUsers: byRole.supplier,
      totalSupplierProfiles: suppliers.length,
      approvedSuppliers,
      pendingSuppliers,
      incompleteProfiles,
      withoutPackages,
      linkIssues: supplierLinkIssues,
    };

    const actions = [
      {
        id: 'email-password-pending',
        label: 'Review pending email/password accounts',
        count: health.emailPasswordPending,
        severity: health.emailPasswordPending > 0 ? 'warning' : 'info',
        href: '/admin-users?verificationMethod=pending',
      },
      {
        id: 'supplier-link-issues',
        label: 'Resolve supplier link issues',
        count: supplierLinkIssues,
        severity: supplierLinkIssues > 0 ? 'critical' : 'info',
        href: '/admin-suppliers',
      },
      {
        id: 'verification-email-failures',
        label: 'Check verification email delivery',
        count: health.verificationEmailFailures + health.verificationBounces,
        severity:
          health.verificationEmailFailures + health.verificationBounces > 0 ? 'warning' : 'info',
        href: '/admin-emails',
      },
    ];

    return {
      summary,
      health,
      supplierHealth,
      actions,
      generatedAt: new Date().toISOString(),
      // Backward-compatible shape used by current dashboard and Users Centre.
      total: users.length,
      byRole,
      bySignup,
      byVerification,
      unverified: unverifiedCount,
      suspended: suspendedCount,
      issueCount,
      newLast7,
      activeLast7,
      latestSignupAt,
      suppliers: {
        total: suppliers.length,
        pending: pendingSuppliers,
        approved: approvedSuppliers,
        suppliersWithoutProfile,
        orphanedSuppliers,
        incompleteProfiles,
        withoutPackages,
        linkIssues: supplierLinkIssues,
      },
    };
  } catch (err) {
    err.stage = err.stage || stage.name;
    logger.error('[adminUserSummary] Failed to build summary', {
      stage: stage.name,
      message: err && err.message,
      stack: err && err.stack,
    });
    throw err;
  }
}

/**
 * Build a paginated, filtered list of users with safe projections.
 *
 * @param {Object} opts
 * @param {string} [opts.role] - Filter by role
 * @param {string} [opts.signupMethod] - Filter by signupMethod
 * @param {string} [opts.verificationMethod] - Filter by verificationMethod
 * @param {string} [opts.issue] - Filter by account issue code
 * @param {string} [opts.search] - Search name/email
 * @param {number} [opts.page=1] - Page number
 * @param {number} [opts.limit=50] - Page size (max 200)
 * @returns {Promise<{items: Object[], total: number, page: number, pages: number}>}
 */
async function listUsers(opts = {}) {
  const {
    role,
    signupMethod,
    verificationMethod,
    issue,
    search,
    page = 1,
    limit: rawLimit = 50,
  } = opts;
  const limit = Math.min(Number(rawLimit) || 50, 200);
  const pageNum = Math.max(Number(page) || 1, 1);

  const [allUsers, allSuppliers, allEmailLogs] = await Promise.all([
    Promise.resolve(dbUnified.read('users')).catch(() => []),
    Promise.resolve(dbUnified.read('suppliers')).catch(() => []),
    Promise.resolve(dbUnified.read(emailLogService.COLLECTION || 'email_logs')).catch(() => []),
  ]);

  const users = allUsers || [];
  const emailLogs = allEmailLogs || [];
  const supplierByOwner = {};
  for (const s of allSuppliers || []) {
    const ownerId = getSupplierOwnerId(s);
    if (ownerId) {
      supplierByOwner[String(ownerId)] = s;
    }
  }

  const searchLower = search ? search.toLowerCase().trim() : null;

  const filtered = users
    .map(u => projectUser(u, supplierByOwner[String(safeUserId(u) || '')] || null, emailLogs))
    .filter(u => {
      if (role && u.role !== role) {
        return false;
      }
      if (signupMethod && u.signupMethod !== signupMethod) {
        return false;
      }
      if (verificationMethod && u.verificationMethod !== verificationMethod) {
        return false;
      }
      if (issue && !u.accountIssues.includes(issue)) {
        return false;
      }
      if (searchLower) {
        const name = (u.name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        if (!name.includes(searchLower) && !email.includes(searchLower)) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

  const total = filtered.length;
  const pages = Math.ceil(total / limit) || 1;
  const offset = (pageNum - 1) * limit;
  const items = filtered.slice(offset, offset + limit);

  return { items, total, page: pageNum, pages, limit };
}

/**
 * Get a single user with full safe detail including supplier linkage.
 * Never returns: passwordHash, password, googleSub, resetToken, verificationToken.
 *
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
async function getUserDetail(userId) {
  let user = await Promise.resolve(dbUnified.findOne('users', { id: userId })).catch(() => null);
  if (!user) {
    const users = await Promise.resolve(dbUnified.read('users')).catch(() => []);
    user = (users || []).find(candidate => safeUserId(candidate) === userId) || null;
  }

  if (!user) {
    return null;
  }

  const resolvedUserId = safeUserId(user);
  const [allSuppliers, verificationLogs] = await Promise.all([
    Promise.resolve(dbUnified.find('suppliers', { ownerUserId: resolvedUserId })).catch(() => []),
    Promise.resolve(dbUnified.read(emailLogService.COLLECTION || 'email_logs')).catch(() => []),
  ]);

  const supplier = allSuppliers && allSuppliers[0] ? allSuppliers[0] : null;
  return projectUser(user, supplier, verificationLogs || []);
}

module.exports = {
  buildUserSummary,
  listUsers,
  getUserDetail,
  projectUser,
  classifySignupMethod,
  classifyVerificationMethod,
  buildAccountIssues,
};
