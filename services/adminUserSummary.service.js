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

// ---------------------------------------------------------------------------
// Provenance classification (mirrors email-centre diagnostics)
// ---------------------------------------------------------------------------

/**
 * Derive a safe signupMethod string from a raw user record.
 * @param {Object} u - Raw user record
 * @returns {'google'|'email_password'|'admin_created'|'owner'|'unknown'}
 */
function classifySignupMethod(u) {
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
function classifyVerificationMethod(u) {
  if (!u.verified) {
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
  if (u.verified && !u.verifiedAt) {
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
function projectUser(u, supplier) {
  const signupMethod = classifySignupMethod(u);
  const verificationMethod = classifyVerificationMethod(u);

  const supplierSummary = supplier
    ? {
        id: supplier.id,
        name: supplier.name || null,
        approved: supplier.approved === true,
        approvalStatus: supplier.approvalStatus || (supplier.approved ? 'approved' : 'pending'),
        profileComplete: !!(supplier.name && supplier.description_short),
        packageCount: Array.isArray(supplier.packages) ? supplier.packages.length : 0,
        profileUrl: `/admin-supplier-detail?id=${supplier.id}`,
      }
    : null;

  return {
    id: u.id || (u._id ? String(u._id) : undefined),
    name: u.name || null,
    email: u.email || null,
    role: u.role || 'customer',
    verified: !!u.verified,
    suspended: !!u.suspended,
    marketingOptIn: !!u.marketingOptIn,
    emailUnsubscribed: !!u.emailUnsubscribed,
    createdAt: u.createdAt || null,
    lastLoginAt: u.lastLoginAt || null,
    subscription: u.subscription || { tier: 'free', status: 'active' },
    // Provenance (safe — no raw tokens or googleSub)
    signupMethod,
    verificationMethod,
    verifiedAt: u.verifiedAt || null,
    hasGoogleLink: !!(u.googleSub || (u.authProviderIds && u.authProviderIds.google)),
    // Supplier linkage summary
    supplierProfile: supplierSummary,
    // Account health flags
    accountIssues: buildAccountIssues(u, supplier, signupMethod, verificationMethod),
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
  if (u.role === 'supplier' && !supplier) {
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
  const [allUsers, allSuppliers] = await Promise.all([
    dbUnified.read('users').catch(() => []),
    dbUnified.read('suppliers').catch(() => []),
  ]);

  const users = allUsers || [];
  const suppliers = allSuppliers || [];

  // Build supplier lookup: ownerUserId → supplier doc
  const supplierByOwner = {};
  for (const s of suppliers) {
    if (s.ownerUserId) {
      supplierByOwner[s.ownerUserId] = s;
    }
  }

  // --- Role counts ---
  const byRole = { customer: 0, supplier: 0, admin: 0, owner: 0, other: 0 };
  // --- Signup method counts ---
  const bySignup = { google: 0, email_password: 0, admin_created: 0, owner: 0, unknown: 0 };
  // --- Verification method counts ---
  const byVerification = { google: 0, email_link: 0, admin: 0, legacy: 0, pending: 0, unknown: 0 };
  // --- Account health ---
  let issueCount = 0;
  let suspendedCount = 0;
  let unverifiedCount = 0;

  // --- Recency ---
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  let newLast7 = 0;
  let activeLast7 = 0;
  let latestSignupAt = null;

  for (const u of users) {
    const role = u.role || 'customer';
    if (byRole[role] !== undefined) {
      byRole[role]++;
    } else {
      byRole.other++;
    }

    const signupMethod = classifySignupMethod(u);
    bySignup[signupMethod] = (bySignup[signupMethod] || 0) + 1;

    const verificationMethod = classifyVerificationMethod(u);
    byVerification[verificationMethod] = (byVerification[verificationMethod] || 0) + 1;

    if (!u.verified) {
      unverifiedCount++;
    }
    if (u.suspended) {
      suspendedCount++;
    }

    const supplier = supplierByOwner[u.id] || null;
    const issues = buildAccountIssues(u, supplier, signupMethod, verificationMethod);
    if (issues.length > 0) {
      issueCount++;
    }

    const createdMs = u.createdAt ? new Date(u.createdAt).getTime() : 0;
    if (createdMs > sevenDaysAgo) {
      newLast7++;
    }
    if (
      createdMs > sevenDaysAgo &&
      (!latestSignupAt || createdMs > new Date(latestSignupAt).getTime())
    ) {
      latestSignupAt = u.createdAt;
    }

    const loginMs = u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : 0;
    if (loginMs > sevenDaysAgo) {
      activeLast7++;
    }
  }

  // --- Supplier-specific counts ---
  const pendingSuppliers = suppliers.filter(
    s => !s.approved && s.approvalStatus !== 'rejected'
  ).length;
  const approvedSuppliers = suppliers.filter(s => s.approved === true).length;
  const suppliersWithoutProfile = users.filter(
    u => u.role === 'supplier' && !supplierByOwner[u.id]
  ).length;
  // Build a Set of all user ids for O(1) lookup (avoids O(n×m) Array.find in filter)
  const userIdSet = new Set(users.map(u => u.id).filter(Boolean));
  const orphanedSuppliers = suppliers.filter(
    s => s.ownerUserId && !userIdSet.has(s.ownerUserId)
  ).length;

  return {
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
    },
  };
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

  const [allUsers, allSuppliers] = await Promise.all([
    dbUnified.read('users').catch(() => []),
    dbUnified.read('suppliers').catch(() => []),
  ]);

  const users = allUsers || [];
  const supplierByOwner = {};
  for (const s of allSuppliers || []) {
    if (s.ownerUserId) {
      supplierByOwner[s.ownerUserId] = s;
    }
  }

  const searchLower = search ? search.toLowerCase().trim() : null;

  const filtered = users
    .map(u => projectUser(u, supplierByOwner[u.id] || null))
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
  const [user, allSuppliers] = await Promise.all([
    dbUnified.findOne('users', { id: userId }).catch(() => null),
    dbUnified.find('suppliers', { ownerUserId: userId }).catch(() => []),
  ]);

  if (!user) {
    return null;
  }

  const supplier = allSuppliers && allSuppliers[0] ? allSuppliers[0] : null;
  return projectUser(user, supplier);
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
