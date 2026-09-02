/**
 * Role-Based Access Control (RBAC) Permissions Middleware
 * Implements granular permission checking with caching for performance
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

// Owner email (cannot be demoted)
const OWNER_EMAIL = 'admin@event-flow.co.uk';

/**
 * Permission definitions
 * Organized by resource type for clarity
 */
const PERMISSIONS = {
  // User Permissions
  USERS_READ: 'admin:users:read',
  USERS_CREATE: 'admin:users:create',
  USERS_UPDATE: 'admin:users:update',
  USERS_DELETE: 'admin:users:delete',
  USERS_BAN: 'admin:users:ban',
  USERS_GRANT_ADMIN: 'admin:users:grant-admin',
  USERS_REVOKE_ADMIN: 'admin:users:revoke-admin',

  // Supplier Permissions
  SUPPLIERS_READ: 'admin:suppliers:read',
  SUPPLIERS_UPDATE: 'admin:suppliers:update',
  SUPPLIERS_DELETE: 'admin:suppliers:delete',
  SUPPLIERS_VERIFY: 'admin:suppliers:verify',

  // Package Permissions
  PACKAGES_READ: 'admin:packages:read',
  PACKAGES_UPDATE: 'admin:packages:update',
  PACKAGES_DELETE: 'admin:packages:delete',
  PACKAGES_FEATURE: 'admin:packages:feature',

  // Review Permissions
  REVIEWS_READ: 'admin:reviews:read',
  REVIEWS_APPROVE: 'admin:reviews:approve',
  REVIEWS_REJECT: 'admin:reviews:reject',

  // Photo Permissions
  PHOTOS_READ: 'admin:photos:read',
  PHOTOS_APPROVE: 'admin:photos:approve',
  PHOTOS_REJECT: 'admin:photos:reject',

  // System Permissions
  SYSTEM_AUDIT_LOG: 'admin:system:audit-log',
  SYSTEM_HEALTH: 'admin:system:health',
  SYSTEM_METRICS: 'admin:system:metrics',

  // Audit Permissions
  AUDIT_READ: 'admin:audit:read',

  // SEO Insights Permissions
  SEO_DASHBOARD_VIEW: 'admin:seo:view',
  SEO_DASHBOARD_MANAGE: 'admin:seo:manage',
};

/**
 * Role definitions with their associated permissions
 */
const ROLES = {
  owner: {
    name: 'Owner',
    description: 'Platform owner with all permissions',
    permissions: Object.values(PERMISSIONS), // All permissions
    canBeRevoked: false,
  },
  admin: {
    name: 'Administrator',
    description: 'Full operational access to all features',
    permissions: Object.values(PERMISSIONS), // All permissions
    canBeRevoked: true,
  },
  moderator: {
    name: 'Moderator',
    description: 'Content moderation and review management',
    permissions: [
      PERMISSIONS.REVIEWS_READ,
      PERMISSIONS.REVIEWS_APPROVE,
      PERMISSIONS.REVIEWS_REJECT,
      PERMISSIONS.PHOTOS_READ,
      PERMISSIONS.PHOTOS_APPROVE,
      PERMISSIONS.PHOTOS_REJECT,
      PERMISSIONS.SUPPLIERS_READ,
      PERMISSIONS.PACKAGES_READ,
    ],
    canBeRevoked: true,
  },
  support: {
    name: 'Support',
    description: 'User support and read-only access',
    permissions: [PERMISSIONS.USERS_READ, PERMISSIONS.AUDIT_READ],
    canBeRevoked: true,
  },
};

/**
 * Permission cache to improve performance
 * Cache user permissions to avoid repeated database lookups
 */
class PermissionCache {
  constructor(ttlMs = 300000) {
    // 5 minutes default TTL
    this.cache = new Map();
    this.ttl = ttlMs;
  }

  get(userId) {
    const entry = this.cache.get(userId);
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(userId);
      return null;
    }

    return entry.permissions;
  }

  set(userId, permissions) {
    this.cache.set(userId, {
      permissions,
      expiresAt: Date.now() + this.ttl,
    });
  }

  clear(userId) {
    if (userId) {
      this.cache.delete(userId);
    } else {
      this.cache.clear();
    }
  }

  getStats() {
    return {
      size: this.cache.size,
      ttl: this.ttl,
    };
  }
}

// Global cache instance
const permissionCache = new PermissionCache();

/**
 * Get all permissions for a user based on their role and custom grants
 * @param {Object} user - User object with role and customPermissions
 * @returns {Set<string>} Set of permission strings
 */
function getUserPermissions(user) {
  if (!user) {
    return new Set();
  }

  // Check cache first
  const cached = permissionCache.get(user.id);
  if (cached) {
    return new Set(cached);
  }

  const permissions = new Set();

  // Determine if user is owner
  const isOwner = (user.email || '').toLowerCase() === OWNER_EMAIL.toLowerCase() || user.isOwner;

  // Add role-based permissions
  const effectiveRole = isOwner ? 'owner' : user.role;
  const roleConfig = ROLES[effectiveRole];

  if (roleConfig) {
    roleConfig.permissions.forEach(p => permissions.add(p));
  }

  // Add custom user-specific permissions
  if (Array.isArray(user.customPermissions)) {
    user.customPermissions.forEach(p => permissions.add(p));
  }

  // Cache the result
  const permissionsArray = Array.from(permissions);
  permissionCache.set(user.id, permissionsArray);

  return permissions;
}

/**
 * Check if a user has a specific permission
 * @param {Object} user - User object
 * @param {string} permission - Permission to check
 * @returns {boolean} True if user has the permission
 */
function hasPermission(user, permission) {
  if (!user) {
    return false;
  }

  // Owner always has all permissions
  const isOwner = (user.email || '').toLowerCase() === OWNER_EMAIL.toLowerCase() || user.isOwner;
  if (isOwner) {
    return true;
  }

  const userPermissions = getUserPermissions(user);
  return userPermissions.has(permission);
}

/**
 * Check if a user has any of the specified permissions
 * @param {Object} user - User object
 * @param {string[]} permissions - Array of permissions to check
 * @returns {boolean} True if user has at least one permission
 */
function hasAnyPermission(user, permissions) {
  if (!user || !Array.isArray(permissions)) {
    return false;
  }

  // Owner always has all permissions
  const isOwner = (user.email || '').toLowerCase() === OWNER_EMAIL.toLowerCase() || user.isOwner;
  if (isOwner) {
    return true;
  }

  const userPermissions = getUserPermissions(user);
  return permissions.some(p => userPermissions.has(p));
}

/**
 * Check if a user has all of the specified permissions
 * @param {Object} user - User object
 * @param {string[]} permissions - Array of permissions to check
 * @returns {boolean} True if user has all permissions
 */
function hasAllPermissions(user, permissions) {
  if (!user || !Array.isArray(permissions)) {
    return false;
  }

  // Owner always has all permissions
  const isOwner = (user.email || '').toLowerCase() === OWNER_EMAIL.toLowerCase() || user.isOwner;
  if (isOwner) {
    return true;
  }

  const userPermissions = getUserPermissions(user);
  return permissions.every(p => userPermissions.has(p));
}

/**
 * Express middleware to require a specific permission
 * @param {string} permission - Required permission
 * @returns {Function} Express middleware
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
        timestamp: new Date().toISOString(),
      });
    }

    if (!hasPermission(req.user, permission)) {
      logger.warn('Permission denied', {
        userId: req.user.id,
        userEmail: req.user.email,
        requiredPermission: permission,
        path: req.path,
      });

      return res.status(403).json({
        success: false,
        error: 'Permission denied',
        code: 'PERMISSION_DENIED',
        requiredPermission: permission,
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
}

/**
 * Express middleware to require any of the specified permissions
 * @param {string[]} permissions - Array of permissions (user needs at least one)
 * @returns {Function} Express middleware
 */
function requireAnyPermission(permissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
        timestamp: new Date().toISOString(),
      });
    }

    if (!hasAnyPermission(req.user, permissions)) {
      logger.warn('Permission denied (any)', {
        userId: req.user.id,
        userEmail: req.user.email,
        requiredPermissions: permissions,
        path: req.path,
      });

      return res.status(403).json({
        success: false,
        error: 'Permission denied',
        code: 'PERMISSION_DENIED',
        requiredPermissions: permissions,
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
}

/**
 * Express middleware to require all of the specified permissions
 * @param {string[]} permissions - Array of permissions (user needs all)
 * @returns {Function} Express middleware
 */
function requireAllPermissions(permissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
        timestamp: new Date().toISOString(),
      });
    }

    if (!hasAllPermissions(req.user, permissions)) {
      logger.warn('Permission denied (all)', {
        userId: req.user.id,
        userEmail: req.user.email,
        requiredPermissions: permissions,
        path: req.path,
      });

      return res.status(403).json({
        success: false,
        error: 'Permission denied',
        code: 'PERMISSION_DENIED',
        requiredPermissions: permissions,
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
}

/**
 * Grant a custom permission to a user
 * @param {string} userId - User ID
 * @param {string} permission - Permission to grant
 * @returns {Promise<Object>} Updated user object
 */
async function grantPermission(userId, permission) {
  const users = await dbUnified.read('users');
  const userIndex = users.findIndex(u => u.id === userId);

  if (userIndex === -1) {
    throw new Error('User not found');
  }

  const user = users[userIndex];

  // Initialize customPermissions if not present
  if (!Array.isArray(user.customPermissions)) {
    user.customPermissions = [];
  }

  // Add permission if not already present
  if (!user.customPermissions.includes(permission)) {
    user.customPermissions.push(permission);
    const updatedAt = new Date().toISOString();

    await dbUnified.updateOne(
      'users',
      { id: userId },
      {
        $set: { customPermissions: user.customPermissions, updatedAt },
      }
    );

    // Clear cache for this user
    permissionCache.clear(userId);

    logger.info('Permission granted', {
      userId,
      permission,
    });
  }

  return user;
}

/**
 * Revoke a custom permission from a user
 * @param {string} userId - User ID
 * @param {string} permission - Permission to revoke
 * @returns {Promise<Object>} Updated user object
 */
async function revokePermission(userId, permission) {
  const users = await dbUnified.read('users');
  const userIndex = users.findIndex(u => u.id === userId);

  if (userIndex === -1) {
    throw new Error('User not found');
  }

  const user = users[userIndex];

  // Remove permission if present
  if (Array.isArray(user.customPermissions)) {
    const updatedPermissions = user.customPermissions.filter(p => p !== permission);
    const updatedAt = new Date().toISOString();

    await dbUnified.updateOne(
      'users',
      { id: userId },
      {
        $set: { customPermissions: updatedPermissions, updatedAt },
      }
    );

    // Clear cache for this user
    permissionCache.clear(userId);

    logger.info('Permission revoked', {
      userId,
      permission,
    });
  }

  return user;
}

/**
 * Clear permission cache (useful for testing or after bulk updates)
 * @param {string} userId - Optional user ID to clear specific user's cache
 */
function clearPermissionCache(userId) {
  permissionCache.clear(userId);
}

/**
 * Get permission cache statistics
 * @returns {Object} Cache stats
 */
function getPermissionCacheStats() {
  return permissionCache.getStats();
}

module.exports = {
  PERMISSIONS,
  ROLES,
  getUserPermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  grantPermission,
  revokePermission,
  clearPermissionCache,
  getPermissionCacheStats,
};
