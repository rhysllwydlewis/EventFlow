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
  if (
    u.verificationMethod === 'manual_admin' ||
    u.verifiedBy === 'admin' ||
    (u.verifiedBy && typeof u.verifiedBy === 'object' && u.verifiedBy.type === 'admin') ||
    u.verifiedByAdmin ||
    u.adminVerified === true ||
    u.createdByAdmin === true
  ) {
    return 'admin';
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

async function requiredRead(collection, stage) {
  try {
    return asArray(await dbUnified.read(collection));
  } catch (err) {
    err.stage = stage || collection;
    throw err;
  }
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
    subscriptionHistory: Array.isArray(user.subscriptionHistory) ? user.subscriptionHistory : [],
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

function createRoleCounter() {
  return { customer: 0, supplier: 0, admin: 0, owner: 0, other: 0 };
}

function createSignupCounter() {
  return { google: 0, email_password: 0, admin_created: 0, owner: 0, unknown: 0 };
}

function createVerificationCounter() {
  return {
    google: 0,
    email_link: 0,
    admin: 0,
    legacy: 0,
    pending: 0,
    unknown: 0,
  };
}

function createHealthSummary() {
  return {
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
}

function createUserStats() {
  return {
    byRole: createRoleCounter(),
    bySignup: createSignupCounter(),
    byVerification: createVerificationCounter(),
    issueCount: 0,
    suspendedCount: 0,
    unverifiedCount: 0,
    newLast7: 0,
    newPrevious7: 0,
    newLast7ByRole: createRoleCounter(),
    newLast7BySignup: createSignupCounter(),
    activeLast7: 0,
    latestSignupAt: null,
    health: createHealthSummary(),
  };
}

function normaliseSummaryCollections(allUsers, allSuppliers, allPackages, allEmailLogs) {
  return {
    users: asArray(allUsers).filter(user => user && typeof user === 'object'),
    suppliers: asArray(allSuppliers).filter(supplier => supplier && typeof supplier === 'object'),
    packages: asArray(allPackages).filter(pkg => pkg && typeof pkg === 'object'),
    emailLogs: asArray(allEmailLogs),
  };
}

function buildSupplierOwnerIndex(suppliers) {
  const supplierByOwner = {};
  for (const supplier of suppliers) {
    const ownerId = getSupplierOwnerId(supplier);
    if (ownerId) {
      supplierByOwner[String(ownerId)] = supplier;
    }
  }
  return supplierByOwner;
}

function buildPackageCountIndex(packages) {
  const packageCountBySupplier = {};
  for (const pkg of packages) {
    const supplierId = pkg.supplierId || pkg.supplier_id || pkg.supplier || pkg.ownerSupplierId;
    if (supplierId) {
      const key = String(supplierId);
      packageCountBySupplier[key] = (packageCountBySupplier[key] || 0) + 1;
    }
  }
  return packageCountBySupplier;
}

function incrementCounter(counter, key, fallbackKey) {
  const resolvedKey = Object.prototype.hasOwnProperty.call(counter, key) ? key : fallbackKey;
  counter[resolvedKey] += 1;
}

function updateVerificationHealth(health, user, provenance, signupMethod, verificationMethod) {
  if (
    (provenance.signupMethod === 'google' || signupMethod === 'google') &&
    (provenance.verified || user.verified)
  ) {
    health.googleVerified += 1;
  }
  if (provenance.verificationMethod === 'eventflow_email' || verificationMethod === 'email_link') {
    health.eventflowEmailVerified += 1;
  }
  if (provenance.verificationMethod === 'admin_created' || signupMethod === 'admin_created') {
    health.adminCreated += 1;
  }
  if (
    provenance.verificationMethod === 'owner_account' ||
    signupMethod === 'owner' ||
    user.isOwner
  ) {
    health.ownerAccounts += 1;
  }
  if (provenance.verificationMethod === 'unknown' || verificationMethod === 'unknown') {
    health.unknownVerificationSource += 1;
  }
  if (
    (provenance.emailDeliveryStatus === 'pending' || verificationMethod === 'pending') &&
    signupMethod === 'email_password'
  ) {
    health.emailPasswordPending += 1;
  }
}

function updateAccountStatusStats(stats, user, supplier, signupMethod, verificationMethod) {
  if (!(user.verified || user.emailVerified)) {
    stats.unverifiedCount += 1;
  }
  if (user.suspended) {
    stats.suspendedCount += 1;
  }
  if (buildAccountIssues(user, supplier, signupMethod, verificationMethod).length > 0) {
    stats.issueCount += 1;
  }
}

function updateSignupWindowStats(stats, user, role, signupMethod, windows) {
  const createdMs = Date.parse(user.createdAt || 0);
  if (!createdMs || createdMs > windows.now) {
    return;
  }
  if (createdMs > windows.sevenDaysAgo) {
    stats.newLast7 += 1;
    incrementCounter(stats.newLast7ByRole, role, 'other');
    incrementCounter(stats.newLast7BySignup, signupMethod, 'unknown');
    if (!stats.latestSignupAt || createdMs > Date.parse(stats.latestSignupAt || 0)) {
      stats.latestSignupAt = safeDateIso(user.createdAt);
    }
    return;
  }
  if (createdMs > windows.fourteenDaysAgo) {
    stats.newPrevious7 += 1;
  }
}

function updateRecentActivityStats(stats, user, sevenDaysAgo) {
  const loginMs = Date.parse(user.lastLoginAt || 0);
  if (loginMs && loginMs > sevenDaysAgo) {
    stats.activeLast7 += 1;
  }
}

function aggregateUsers(users, emailLogs, supplierByOwner, windows) {
  const stats = createUserStats();
  for (const rawUser of users) {
    const user = rawUser || {};
    const userId = safeUserId(user);
    const role = user.role || 'customer';
    const provenance = verificationProvenance.summariseUser(user, emailLogs) || {};
    const signupMethod = classifySignupMethod(user);
    const verificationMethod = classifyVerificationMethod(user);
    const supplier = userId ? supplierByOwner[String(userId)] || null : null;

    incrementCounter(stats.byRole, role, 'other');
    incrementCounter(stats.bySignup, signupMethod, 'unknown');
    incrementCounter(stats.byVerification, verificationMethod, 'unknown');
    updateVerificationHealth(stats.health, user, provenance, signupMethod, verificationMethod);
    updateAccountStatusStats(stats, user, supplier, signupMethod, verificationMethod);
    updateSignupWindowStats(stats, user, role, signupMethod, windows);
    updateRecentActivityStats(stats, user, windows.sevenDaysAgo);
  }
  stats.health.lastNewSignupAt = stats.latestSignupAt;
  return stats;
}

function isPendingSupplier(supplier) {
  const status = supplier.approvalStatus || supplier.verificationStatus || supplier.status;
  return !(supplier.approved === true || status === 'approved') && status !== 'rejected';
}

function isApprovedSupplier(supplier) {
  return supplier.approved === true || supplier.approvalStatus === 'approved';
}

function supplierHasNoPackages(supplier, packageCountBySupplier) {
  const supplierId = supplier.id || (supplier._id ? String(supplier._id) : undefined);
  const directCount = Array.isArray(supplier.packages)
    ? supplier.packages.length
    : Number(supplier.packageCount || supplier.listingCount || 0);
  const collectionCount = supplierId ? packageCountBySupplier[String(supplierId)] || 0 : 0;
  return directCount + collectionCount === 0;
}

function buildSupplierStats(users, suppliers, supplierByOwner, packageCountBySupplier) {
  const userIds = new Set(users.map(safeUserId).filter(Boolean).map(String));
  const pendingSuppliers = suppliers.filter(isPendingSupplier).length;
  const approvedSuppliers = suppliers.filter(isApprovedSupplier).length;
  const incompleteProfiles = suppliers.filter(isProfileIncomplete).length;
  const suppliersWithoutProfile = users.filter(
    user =>
      (user.role || 'customer') === 'supplier' && !supplierByOwner[String(safeUserId(user) || '')]
  ).length;
  const orphanedSuppliers = suppliers.filter(supplier => {
    const ownerId = getSupplierOwnerId(supplier);
    return ownerId && !userIds.has(String(ownerId));
  }).length;
  const withoutPackages = suppliers.filter(supplier =>
    supplierHasNoPackages(supplier, packageCountBySupplier)
  ).length;

  return {
    pendingSuppliers,
    approvedSuppliers,
    incompleteProfiles,
    suppliersWithoutProfile,
    orphanedSuppliers,
    withoutPackages,
    supplierLinkIssues: suppliersWithoutProfile + orphanedSuppliers,
  };
}

function isVerificationEmailLog(log) {
  const subject = String(log.subject || '').toLowerCase();
  return (
    log.template === 'verification' ||
    (Array.isArray(log.tags) && log.tags.includes('verification')) ||
    subject.includes('verify your email') ||
    subject.includes('confirm your eventflow account')
  );
}

function verificationLogTimestamp(log) {
  return Date.parse(log.sentAt || log.createdAt || log.attemptedAt || 0);
}

function updateVerificationEmailHealth(health, emailLogs) {
  const verificationLogs = emailLogs.filter(isVerificationEmailLog);
  health.verificationEmailFailures = verificationLogs.filter(log => log.status === 'failed').length;
  health.verificationOutboxFallbacks = verificationLogs.filter(
    log => log.provider === 'outbox'
  ).length;
  health.verificationBounces = verificationLogs.filter(log => log.status === 'bounced').length;
  const latestLog = verificationLogs
    .slice()
    .sort((a, b) => verificationLogTimestamp(b) - verificationLogTimestamp(a))[0];
  health.lastVerificationEmailAttemptAt = safeDateIso(
    latestLog && (latestLog.sentAt || latestLog.createdAt || latestLog.attemptedAt)
  );
}

function buildSummaryResult(users, suppliers, userStats, supplierStats) {
  const { health } = userStats;
  const summary = {
    totalUsers: users.length,
    customers: userStats.byRole.customer,
    suppliers: userStats.byRole.supplier,
    admins: userStats.byRole.admin + userStats.byRole.owner,
    newUsersLast7Days: userStats.newLast7,
    newUsersPrevious7Days: userStats.newPrevious7,
    recentlyActiveUsersLast7Days: userStats.activeLast7,
    unverifiedUsers: userStats.unverifiedCount,
    verificationIssues: userStats.issueCount,
    pendingSupplierApprovals: supplierStats.pendingSuppliers,
    supplierProfilesIncomplete: supplierStats.incompleteProfiles,
    supplierLinkIssues: supplierStats.supplierLinkIssues,
  };

  const supplierHealth = {
    totalSupplierUsers: userStats.byRole.supplier,
    totalSupplierProfiles: suppliers.length,
    approvedSuppliers: supplierStats.approvedSuppliers,
    pendingSuppliers: supplierStats.pendingSuppliers,
    incompleteProfiles: supplierStats.incompleteProfiles,
    withoutPackages: supplierStats.withoutPackages,
    linkIssues: supplierStats.supplierLinkIssues,
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
      count: supplierStats.supplierLinkIssues,
      severity: supplierStats.supplierLinkIssues > 0 ? 'critical' : 'info',
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
    total: users.length,
    byRole: userStats.byRole,
    bySignup: userStats.bySignup,
    byVerification: userStats.byVerification,
    unverified: userStats.unverifiedCount,
    suspended: userStats.suspendedCount,
    issueCount: userStats.issueCount,
    newLast7: userStats.newLast7,
    newPrevious7: userStats.newPrevious7,
    newLast7ByRole: userStats.newLast7ByRole,
    newLast7BySignup: userStats.newLast7BySignup,
    activeLast7: userStats.activeLast7,
    latestSignupAt: userStats.latestSignupAt,
    suppliers: {
      total: suppliers.length,
      pending: supplierStats.pendingSuppliers,
      approved: supplierStats.approvedSuppliers,
      suppliersWithoutProfile: supplierStats.suppliersWithoutProfile,
      orphanedSuppliers: supplierStats.orphanedSuppliers,
      incompleteProfiles: supplierStats.incompleteProfiles,
      withoutPackages: supplierStats.withoutPackages,
      linkIssues: supplierStats.supplierLinkIssues,
    },
  };
}

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
      requiredRead('users', 'users'),
      safeRead('suppliers', 'suppliers'),
      safeRead('packages', 'packages'),
      safeRead(emailLogService.COLLECTION || 'email_logs', 'email_logs'),
    ]);

    stage.name = 'normalise';
    const { users, suppliers, packages, emailLogs } = normaliseSummaryCollections(
      allUsers,
      allSuppliers,
      allPackages,
      allEmailLogs
    );
    const supplierByOwner = buildSupplierOwnerIndex(suppliers);
    const packageCountBySupplier = buildPackageCountIndex(packages);
    const now = Date.now();
    const windows = {
      now,
      sevenDaysAgo: now - 7 * 24 * 60 * 60 * 1000,
      fourteenDaysAgo: now - 14 * 24 * 60 * 60 * 1000,
    };

    stage.name = 'users';
    const userStats = aggregateUsers(users, emailLogs, supplierByOwner, windows);

    stage.name = 'suppliers';
    const supplierStats = buildSupplierStats(
      users,
      suppliers,
      supplierByOwner,
      packageCountBySupplier
    );

    stage.name = 'email_logs';
    updateVerificationEmailHealth(userStats.health, emailLogs);

    return buildSummaryResult(users, suppliers, userStats, supplierStats);
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
  const parsedLimit = Number(rawLimit);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1), 200);
  const parsedPage = Number(page);
  const pageNum = Math.max(Number.isFinite(parsedPage) ? parsedPage : 1, 1);

  const [allUsers, allSuppliers, allEmailLogs] = await Promise.all([
    requiredRead('users', 'users'),
    safeRead('suppliers', 'suppliers'),
    safeRead(emailLogService.COLLECTION || 'email_logs', 'email_logs'),
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
  const pages = Math.max(Math.ceil(total / limit), 1);
  const effectivePage = Math.min(pageNum, pages);
  const offset = (effectivePage - 1) * limit;
  const items = filtered.slice(offset, offset + limit);

  return { items, total, page: effectivePage, pages, limit };
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
  const [findSuppliers, readSuppliers, verificationLogs] = await Promise.all([
    Promise.resolve(
      dbUnified.find ? dbUnified.find('suppliers', { ownerUserId: resolvedUserId }) : []
    ).catch(() => []),
    safeRead('suppliers', 'suppliers'),
    safeRead(emailLogService.COLLECTION || 'email_logs', 'email_logs'),
  ]);

  const allSuppliers = [...asArray(findSuppliers), ...asArray(readSuppliers)];
  const supplier =
    (allSuppliers || []).find(
      s => String(getSupplierOwnerId(s) || '') === String(resolvedUserId)
    ) || null;
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
