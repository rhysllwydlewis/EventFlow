/**
 * Admin API v2 Routes
 * RESTful endpoints for all admin operations with granular permissions
 * Implements RBAC, batch operations, and complete audit logging
 */

'use strict';

const express = require('express');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { PERMISSIONS, requirePermission, getUserPermissions } = require('../middleware/permissions');
const {
  grantPermission,
  revokePermission,
  clearPermissionCache,
  getPermissionCacheStats,
} = require('../middleware/permissions');
const {
  createAuditLog,
  queryAuditLogs,
  getAuditLogById,
  getUserAuditLogs,
  getAuditStatistics,
} = require('../utils/auditTrail');
const {
  getDashboardOverview,
  getDetailedMetrics,
  batchApprove,
  batchReject,
  batchDelete,
  getSystemHealth,
} = require('../services/adminService');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const {
  VERIFICATION_STATES,
  normaliseState,
  canTransition,
} = require('../utils/supplierVerificationStateMachine');

/**
 * Sanitise free-text input: trim, strip HTML tags, and enforce max length.
 * Iterates until no more tags are found to handle nested/malformed markup.
 * @param {string} input
 * @param {number} [maxLength=2000]
 * @returns {string}
 */
function sanitiseText(input, maxLength = 2000) {
  if (typeof input !== 'string') {
    return '';
  }
  let text = input;
  let prev;
  do {
    prev = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== prev);
  return text.trim().slice(0, maxLength);
}

const router = express.Router();

// ========================================
// Permission Management Endpoints
// ========================================

/**
 * GET /api/v2/admin/permissions
 * Get all available permissions
 */
router.get('/permissions', authRequired, roleRequired('admin'), (req, res) => {
  res.json({
    success: true,
    data: Object.values(PERMISSIONS),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/v2/admin/roles
 * Get all roles with their permissions
 */
router.get('/roles', authRequired, roleRequired('admin'), (req, res) => {
  const { ROLES } = require('../middleware/permissions');

  const roles = Object.entries(ROLES).map(([key, role]) => ({
    id: key,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    canBeRevoked: role.canBeRevoked,
  }));

  res.json({
    success: true,
    data: roles,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/v2/admin/roles/:role/permissions
 * Get permissions for a specific role
 */
router.get('/roles/:role/permissions', authRequired, roleRequired('admin'), (req, res) => {
  const { ROLES } = require('../middleware/permissions');
  const { role } = req.params;

  const roleConfig = ROLES[role];
  if (!roleConfig) {
    return res.status(404).json({
      success: false,
      error: 'Role not found',
      code: 'ROLE_NOT_FOUND',
      timestamp: new Date().toISOString(),
    });
  }

  res.json({
    success: true,
    data: {
      role: role,
      name: roleConfig.name,
      permissions: roleConfig.permissions,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/v2/admin/users/:id/permissions
 * Grant specific permission to user
 */
router.post(
  '/users/:id/permissions',
  authRequired,
  requirePermission(PERMISSIONS.USERS_GRANT_ADMIN),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { permission } = req.body;

      if (!permission) {
        return res.status(400).json({
          success: false,
          error: 'Permission is required',
          code: 'MISSING_PERMISSION',
          timestamp: new Date().toISOString(),
        });
      }

      const user = await grantPermission(id, permission);

      // Create audit log
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
        action: 'PERMISSION_GRANTED',
        resource: {
          type: 'user',
          id: user.id,
        },
        changes: {
          permission: permission,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        details: { permission },
      });

      res.json({
        success: true,
        data: {
          userId: user.id,
          email: user.email,
          customPermissions: user.customPermissions,
        },
        message: 'Permission granted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to grant permission', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'GRANT_PERMISSION_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * DELETE /api/v2/admin/users/:id/permissions/:permission
 * Revoke permission from user
 */
router.delete(
  '/users/:id/permissions/:permission',
  authRequired,
  requirePermission(PERMISSIONS.USERS_REVOKE_ADMIN),
  csrfProtection,
  async (req, res) => {
    try {
      const { id, permission } = req.params;

      const user = await revokePermission(id, permission);

      // Create audit log
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
        action: 'PERMISSION_REVOKED',
        resource: {
          type: 'user',
          id: user.id,
        },
        changes: {
          permission: permission,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        details: { permission },
      });

      res.json({
        success: true,
        data: {
          userId: user.id,
          email: user.email,
          customPermissions: user.customPermissions,
        },
        message: 'Permission revoked successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to revoke permission', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'REVOKE_PERMISSION_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ========================================
// User Management Endpoints
// ========================================

/**
 * GET /api/v2/admin/users
 * List users with filters and pagination
 */
router.get('/users', authRequired, requirePermission(PERMISSIONS.USERS_READ), async (req, res) => {
  try {
    const {
      role,
      verified,
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    let users = await dbUnified.read('users');

    // Apply filters
    if (role) {
      users = users.filter(u => u.role === role);
    }
    if (verified !== undefined) {
      const isVerified = verified === 'true';
      users = users.filter(u => u.verified === isVerified);
    }

    // Sort
    users.sort((a, b) => {
      const aValue = a[sortBy] || '';
      const bValue = b[sortBy] || '';
      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    // Pagination
    const total = users.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginatedUsers = users.slice(offset, offset + parseInt(limit));

    // Remove sensitive data
    const safeUsers = paginatedUsers.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      verified: u.verified,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      customPermissions: u.customPermissions || [],
    }));

    res.json({
      success: true,
      data: safeUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to list users', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'LIST_USERS_FAILED',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/v2/admin/users/:id
 * Get user details
 */
router.get(
  '/users/:id',
  authRequired,
  requirePermission(PERMISSIONS.USERS_READ),
  async (req, res) => {
    try {
      const { id } = req.params;
      const users = await dbUnified.read('users');
      const user = users.find(u => u.id === id);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Get user permissions
      const permissions = Array.from(getUserPermissions(user));

      // Remove sensitive data
      const safeUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        verified: user.verified,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        customPermissions: user.customPermissions || [],
        allPermissions: permissions,
      };

      res.json({
        success: true,
        data: safeUser,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to get user', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'GET_USER_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * PUT /api/v2/admin/users/:id
 * Update user
 */
router.put(
  '/users/:id',
  authRequired,
  requirePermission(PERMISSIONS.USERS_UPDATE),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, email, role } = req.body;

      const users = await dbUnified.read('users');
      const userIndex = users.findIndex(u => u.id === id);

      if (userIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const user = users[userIndex];
      const changes = {};
      const adminUpdates = {};

      if (name && name !== user.name) {
        changes.name = { before: user.name, after: name };
        adminUpdates.name = name;
      }
      if (email && email !== user.email) {
        changes.email = { before: user.email, after: email };
        adminUpdates.email = email;
      }
      if (role && role !== user.role) {
        changes.role = { before: user.role, after: role };
        adminUpdates.role = role;
      }

      adminUpdates.updatedAt = new Date().toISOString();
      await dbUnified.updateOne('users', { id }, { $set: adminUpdates });

      // Create audit log
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
        action: 'USER_UPDATED',
        resource: {
          type: 'user',
          id: user.id,
        },
        changes,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        message: 'User updated successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to update user', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'UPDATE_USER_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * DELETE /api/v2/admin/users/:id
 * Delete user
 */
router.delete(
  '/users/:id',
  authRequired,
  requirePermission(PERMISSIONS.USERS_DELETE),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const users = await dbUnified.read('users');
      const user = users.find(u => u.id === id);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Prevent deleting self
      if (user.id === req.user.id) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete your own account',
          code: 'CANNOT_DELETE_SELF',
          timestamp: new Date().toISOString(),
        });
      }

      await dbUnified.deleteOne('users', id);

      // Create audit log
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
        action: 'USER_DELETED',
        resource: {
          type: 'user',
          id: user.id,
        },
        details: {
          email: user.email,
          name: user.name,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        message: 'User deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to delete user', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'DELETE_USER_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * POST /api/v2/admin/users/:id/ban
 * Ban user
 */
router.post(
  '/users/:id/ban',
  authRequired,
  requirePermission(PERMISSIONS.USERS_BAN),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const users = await dbUnified.read('users');
      const user = users.find(u => u.id === id);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      await dbUnified.updateOne(
        'users',
        { id },
        {
          $set: {
            banned: true,
            bannedAt: new Date().toISOString(),
            bannedBy: req.user.id,
            banReason: reason || '',
          },
        }
      );

      // Create audit log
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
        action: 'USER_BANNED',
        resource: {
          type: 'user',
          id: user.id,
        },
        details: {
          email: user.email,
          reason,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        message: 'User banned successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to ban user', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'BAN_USER_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * POST /api/v2/admin/users/:id/unban
 * Unban user
 */
router.post(
  '/users/:id/unban',
  authRequired,
  requirePermission(PERMISSIONS.USERS_BAN),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;

      const users = await dbUnified.read('users');
      const user = users.find(u => u.id === id);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      await dbUnified.updateOne(
        'users',
        { id },
        {
          $set: {
            banned: false,
            unbannedAt: new Date().toISOString(),
            unbannedBy: req.user.id,
          },
        }
      );

      // Create audit log
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
        action: 'USER_UNBANNED',
        resource: {
          type: 'user',
          id: user.id,
        },
        details: {
          email: user.email,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        message: 'User unbanned successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to unban user', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'UNBAN_USER_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ========================================
// Supplier Management Endpoints
// ========================================

/**
 * GET /api/v2/admin/suppliers
 * List suppliers with filters
 */
router.get(
  '/suppliers',
  authRequired,
  requirePermission(PERMISSIONS.SUPPLIERS_READ),
  async (req, res) => {
    try {
      const { approved, category, page = 1, limit = 50 } = req.query;

      let suppliers = await dbUnified.read('suppliers');

      // Apply filters
      if (approved !== undefined) {
        const isApproved = approved === 'true';
        suppliers = suppliers.filter(s => s.approved === isApproved);
      }
      if (category) {
        suppliers = suppliers.filter(s => s.category === category);
      }

      // Pagination
      const total = suppliers.length;
      const totalPages = Math.ceil(total / limit);
      const offset = (page - 1) * limit;
      const paginatedSuppliers = suppliers.slice(offset, offset + parseInt(limit));

      res.json({
        success: true,
        data: paginatedSuppliers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to list suppliers', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'LIST_SUPPLIERS_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * PUT /api/v2/admin/suppliers/:id
 * Edit supplier
 */
router.put(
  '/suppliers/:id',
  authRequired,
  requirePermission(PERMISSIONS.SUPPLIERS_UPDATE),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const suppliers = await dbUnified.read('suppliers');
      const supplierIndex = suppliers.findIndex(s => s.id === id);

      if (supplierIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Supplier not found',
          code: 'SUPPLIER_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const supplier = suppliers[supplierIndex];
      const changes = {};

      // Track changes
      Object.keys(updateData).forEach(key => {
        if (updateData[key] !== supplier[key]) {
          changes[key] = { before: supplier[key], after: updateData[key] };
          supplier[key] = updateData[key];
        }
      });

      supplier.updatedAt = new Date().toISOString();
      await dbUnified.updateOne('suppliers', { id: supplier.id }, { $set: supplier });

      // Create audit log
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
        action: 'SUPPLIER_UPDATED',
        resource: {
          type: 'supplier',
          id: supplier.id,
        },
        changes,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        data: supplier,
        message: 'Supplier updated successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to update supplier', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'UPDATE_SUPPLIER_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * DELETE /api/v2/admin/suppliers/:id
 * Delete supplier
 */
router.delete(
  '/suppliers/:id',
  authRequired,
  requirePermission(PERMISSIONS.SUPPLIERS_DELETE),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const suppliers = await dbUnified.read('suppliers');
      const supplier = suppliers.find(s => s.id === id);

      if (!supplier) {
        return res.status(404).json({
          success: false,
          error: 'Supplier not found',
          code: 'SUPPLIER_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      await dbUnified.deleteOne('suppliers', id);

      // Create audit log
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
        action: 'SUPPLIER_DELETED',
        resource: {
          type: 'supplier',
          id: supplier.id,
        },
        details: {
          name: supplier.name,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        message: 'Supplier deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to delete supplier', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'DELETE_SUPPLIER_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * POST /api/v2/admin/suppliers/:id/verify
 * Manually verify supplier
 */
router.post(
  '/suppliers/:id/verify',
  authRequired,
  requirePermission(PERMISSIONS.SUPPLIERS_VERIFY),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;

      const suppliers = await dbUnified.read('suppliers');
      const supplierIndex = suppliers.findIndex(s => s.id === id);

      if (supplierIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Supplier not found',
          code: 'SUPPLIER_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const supplier = suppliers[supplierIndex];

      const currentState = normaliseState(supplier.verificationStatus, supplier.verified);
      const check = canTransition(currentState, VERIFICATION_STATES.APPROVED, 'admin');
      if (!check.allowed) {
        return res.status(409).json({
          success: false,
          error: check.reason,
          code: 'TRANSITION_NOT_ALLOWED',
          timestamp: new Date().toISOString(),
        });
      }

      const now = new Date().toISOString();
      const verificationNotes = sanitiseText(
        (req.body && req.body.verificationNotes) || supplier.verificationNotes || ''
      );

      await dbUnified.updateOne(
        'suppliers',
        { id: supplier.id },
        {
          $set: {
            verified: true,
            approved: true,
            verificationStatus: VERIFICATION_STATES.APPROVED,
            verifiedAt: now,
            verifiedBy: req.user.id,
            verificationNotes,
            updatedAt: now,
          },
        }
      );

      supplier.verified = true;
      supplier.approved = true;
      supplier.verificationStatus = VERIFICATION_STATES.APPROVED;
      supplier.verifiedAt = now;
      supplier.verifiedBy = req.user.id;
      supplier.verificationNotes = verificationNotes;
      supplier.updatedAt = now;

      // Create audit log
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
        action: 'SUPPLIER_VERIFIED',
        resource: {
          type: 'supplier',
          id: supplier.id,
        },
        details: {
          name: supplier.name,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        data: supplier,
        message: 'Supplier verified successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to verify supplier', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'VERIFY_SUPPLIER_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ========================================
// Package Management Endpoints
// ========================================

/**
 * GET /api/v2/admin/packages
 * List packages with filters
 */
router.get(
  '/packages',
  authRequired,
  requirePermission(PERMISSIONS.PACKAGES_READ),
  async (req, res) => {
    try {
      const { approved, featured, supplierId, page = 1, limit = 50 } = req.query;

      let packages = await dbUnified.read('packages');

      // Apply filters
      if (approved !== undefined) {
        const isApproved = approved === 'true';
        packages = packages.filter(p => p.approved === isApproved);
      }
      if (featured !== undefined) {
        const isFeatured = featured === 'true';
        packages = packages.filter(p => p.featured === isFeatured);
      }
      if (supplierId) {
        packages = packages.filter(p => p.supplierId === supplierId);
      }

      // Pagination
      const total = packages.length;
      const totalPages = Math.ceil(total / limit);
      const offset = (page - 1) * limit;
      const paginatedPackages = packages.slice(offset, offset + parseInt(limit));

      res.json({
        success: true,
        data: paginatedPackages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to list packages', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'LIST_PACKAGES_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * PUT /api/v2/admin/packages/:id
 * Edit package
 */
router.put(
  '/packages/:id',
  authRequired,
  requirePermission(PERMISSIONS.PACKAGES_UPDATE),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const packages = await dbUnified.read('packages');
      const packageIndex = packages.findIndex(p => p.id === id);

      if (packageIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Package not found',
          code: 'PACKAGE_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const pkg = packages[packageIndex];
      const changes = {};

      // Track changes
      Object.keys(updateData).forEach(key => {
        if (updateData[key] !== pkg[key]) {
          changes[key] = { before: pkg[key], after: updateData[key] };
          pkg[key] = updateData[key];
        }
      });

      pkg.updatedAt = new Date().toISOString();
      await dbUnified.updateOne('packages', { id: pkg.id }, { $set: pkg });

      // Create audit log
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
        action: 'PACKAGE_UPDATED',
        resource: {
          type: 'package',
          id: pkg.id,
        },
        changes,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        data: pkg,
        message: 'Package updated successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to update package', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'UPDATE_PACKAGE_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * DELETE /api/v2/admin/packages/:id
 * Delete package
 */
router.delete(
  '/packages/:id',
  authRequired,
  requirePermission(PERMISSIONS.PACKAGES_DELETE),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const packages = await dbUnified.read('packages');
      const pkg = packages.find(p => p.id === id);

      if (!pkg) {
        return res.status(404).json({
          success: false,
          error: 'Package not found',
          code: 'PACKAGE_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      await dbUnified.deleteOne('packages', id);

      // Create audit log
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
        action: 'PACKAGE_DELETED',
        resource: {
          type: 'package',
          id: pkg.id,
        },
        details: {
          title: pkg.title,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        message: 'Package deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to delete package', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'DELETE_PACKAGE_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * POST /api/v2/admin/packages/batch-approve
 * Approve multiple packages
 */
router.post(
  '/packages/batch-approve',
  authRequired,
  requirePermission(PERMISSIONS.PACKAGES_UPDATE),
  csrfProtection,
  async (req, res) => {
    try {
      const { ids } = req.body;

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'IDs array is required',
          code: 'INVALID_INPUT',
          timestamp: new Date().toISOString(),
        });
      }

      // Limit batch size to prevent overload
      const MAX_BATCH_SIZE = 100;
      if (ids.length > MAX_BATCH_SIZE) {
        return res.status(400).json({
          success: false,
          error: `Batch size cannot exceed ${MAX_BATCH_SIZE} items`,
          code: 'BATCH_SIZE_EXCEEDED',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await batchApprove({
        type: 'packages',
        ids,
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
      });

      res.json(result);
    } catch (error) {
      logger.error('Batch approve packages failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'BATCH_APPROVE_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ========================================
// Review Moderation Endpoints
// ========================================

/**
 * GET /api/v2/admin/reviews/pending
 * Get pending reviews
 */
router.get(
  '/reviews/pending',
  authRequired,
  requirePermission(PERMISSIONS.REVIEWS_READ),
  async (req, res) => {
    try {
      const reviews = await dbUnified.read('reviews');
      const pending = reviews.filter(r => r.status === 'pending' || r.flagged);

      res.json({
        success: true,
        data: pending,
        count: pending.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to get pending reviews', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'GET_PENDING_REVIEWS_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * POST /api/v2/admin/reviews/:id/approve
 * Approve review
 */
router.post(
  '/reviews/:id/approve',
  authRequired,
  requirePermission(PERMISSIONS.REVIEWS_APPROVE),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;

      const reviews = await dbUnified.read('reviews');
      const reviewIndex = reviews.findIndex(r => r.id === id);

      if (reviewIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Review not found',
          code: 'REVIEW_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const review = reviews[reviewIndex];
      const oldStatus = review.status;
      review.status = 'approved';
      review.approvedAt = new Date().toISOString();
      review.approvedBy = req.user.id;

      reviews[reviewIndex] = review;
      await dbUnified.updateOne(
        'reviews',
        { id: review.id },
        {
          $set: {
            status: 'approved',
            approvedAt: review.approvedAt,
            approvedBy: review.approvedBy,
          },
        }
      );

      // Create audit log
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
        action: 'REVIEW_APPROVED',
        resource: {
          type: 'review',
          id: review.id,
        },
        changes: {
          status: { before: oldStatus, after: 'approved' },
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        data: review,
        message: 'Review approved successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to approve review', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'APPROVE_REVIEW_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * POST /api/v2/admin/reviews/:id/reject
 * Reject review
 */
router.post(
  '/reviews/:id/reject',
  authRequired,
  requirePermission(PERMISSIONS.REVIEWS_REJECT),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const reviews = await dbUnified.read('reviews');
      const reviewIndex = reviews.findIndex(r => r.id === id);

      if (reviewIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Review not found',
          code: 'REVIEW_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const review = reviews[reviewIndex];
      const oldStatus = review.status;
      review.status = 'rejected';
      review.rejectedAt = new Date().toISOString();
      review.rejectedBy = req.user.id;
      review.rejectionReason = reason || '';

      reviews[reviewIndex] = review;
      await dbUnified.updateOne(
        'reviews',
        { id: review.id },
        {
          $set: {
            status: 'rejected',
            rejectedAt: review.rejectedAt,
            rejectedBy: review.rejectedBy,
            rejectionReason: review.rejectionReason,
          },
        }
      );

      // Create audit log
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
        action: 'REVIEW_REJECTED',
        resource: {
          type: 'review',
          id: review.id,
        },
        changes: {
          status: { before: oldStatus, after: 'rejected' },
        },
        details: { reason },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        data: review,
        message: 'Review rejected successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to reject review', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'REJECT_REVIEW_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ========================================
// Photo Moderation Endpoints (deprecated)
// ========================================

/**
 * GET /api/v2/admin/photos/pending
 * @deprecated Photos are now auto-approved on upload
 */
router.get(
  '/photos/pending',
  authRequired,
  requirePermission(PERMISSIONS.PHOTOS_READ),
  (req, res) => {
    res.json({
      success: true,
      data: [],
      count: 0,
      message: 'Photo approval is no longer required. Photos are auto-approved on upload.',
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/v2/admin/photos/batch-action
 * Validate and process a batch photo action (approve or reject).
 * The action field must be 'approve' or 'reject'; any other value returns 400.
 */
router.post(
  '/photos/batch-action',
  authRequired,
  requirePermission(PERMISSIONS.PHOTOS_APPROVE),
  csrfProtection,
  (req, res) => {
    const { action, photos } = req.body || {};

    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({
        success: false,
        error: 'action must be approve or reject',
        code: 'INVALID_ACTION',
      });
    }

    if (!Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'photos must be a non-empty array',
        code: 'INVALID_PHOTOS',
      });
    }

    // Photos are auto-approved on upload — batch action is a no-op but validates correctly
    res.json({
      success: true,
      data: { processed: photos.length, failed: 0, errors: [] },
      message: 'Batch photo action processed.',
      timestamp: new Date().toISOString(),
    });
  }
);

// ========================================
// Dashboard & Analytics Endpoints
// ========================================

/**
 * GET /api/v2/admin/dashboard/overview
 * Dashboard overview
 */
router.get(
  '/dashboard/overview',
  authRequired,
  requirePermission(PERMISSIONS.SYSTEM_METRICS),
  async (req, res) => {
    try {
      const overview = await getDashboardOverview();
      res.json(overview);
    } catch (error) {
      logger.error('Failed to get dashboard overview', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'DASHBOARD_OVERVIEW_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * GET /api/v2/admin/dashboard/metrics
 * Detailed metrics
 */
router.get(
  '/dashboard/metrics',
  authRequired,
  requirePermission(PERMISSIONS.SYSTEM_METRICS),
  async (req, res) => {
    try {
      const metrics = await getDetailedMetrics();
      res.json(metrics);
    } catch (error) {
      logger.error('Failed to get detailed metrics', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'DETAILED_METRICS_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * GET /api/v2/admin/system-health
 * System health diagnostics
 */
router.get(
  '/system-health',
  authRequired,
  requirePermission(PERMISSIONS.SYSTEM_HEALTH),
  async (req, res) => {
    try {
      const health = await getSystemHealth();
      res.json(health);
    } catch (error) {
      logger.error('Failed to get system health', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'SYSTEM_HEALTH_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ========================================
// Audit & Logging Endpoints
// ========================================

/**
 * GET /api/v2/admin/audit-log
 * Get audit log with filters and pagination
 */
router.get(
  '/audit-log',
  authRequired,
  requirePermission(PERMISSIONS.AUDIT_READ),
  async (req, res) => {
    try {
      const filters = {
        actorId: req.query.actorId,
        actorEmail: req.query.actorEmail,
        action: req.query.action,
        resourceType: req.query.resourceType,
        resourceId: req.query.resourceId,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 50,
        sortBy: req.query.sortBy || 'timestamp',
        sortOrder: req.query.sortOrder || 'desc',
      };

      const result = await queryAuditLogs(filters);
      res.json(result);
    } catch (error) {
      logger.error('Failed to query audit logs', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'QUERY_AUDIT_LOGS_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * GET /api/v2/admin/audit-log/:id
 * Get specific audit log entry
 */
router.get(
  '/audit-log/:id',
  authRequired,
  requirePermission(PERMISSIONS.AUDIT_READ),
  async (req, res) => {
    try {
      const { id } = req.params;
      const result = await getAuditLogById(id);
      res.json(result);
    } catch (error) {
      logger.error('Failed to get audit log', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'GET_AUDIT_LOG_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * GET /api/v2/admin/audit-log/user/:userId
 * Get all actions by a user
 */
router.get(
  '/audit-log/user/:userId',
  authRequired,
  requirePermission(PERMISSIONS.AUDIT_READ),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const options = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 50,
      };

      const result = await getUserAuditLogs(userId, options);
      res.json(result);
    } catch (error) {
      logger.error('Failed to get user audit logs', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'GET_USER_AUDIT_LOGS_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * GET /api/v2/admin/audit-log/statistics
 * Get audit statistics
 */
router.get(
  '/audit-log/statistics',
  authRequired,
  requirePermission(PERMISSIONS.AUDIT_READ),
  async (req, res) => {
    try {
      const filters = {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      };

      const result = await getAuditStatistics(filters);
      res.json(result);
    } catch (error) {
      logger.error('Failed to get audit statistics', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'GET_AUDIT_STATISTICS_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ========================================
// Batch Operations Endpoints
// ========================================

/**
 * POST /api/v2/admin/bulk-actions
 * Perform batch operations
 */
router.post(
  '/bulk-actions',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { action, type, ids, reason } = req.body;

      if (!action || !type || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Action, type, and ids are required',
          code: 'INVALID_INPUT',
          timestamp: new Date().toISOString(),
        });
      }

      // Limit batch size to prevent overload
      const MAX_BATCH_SIZE = 100;
      if (ids.length > MAX_BATCH_SIZE) {
        return res.status(400).json({
          success: false,
          error: `Batch size cannot exceed ${MAX_BATCH_SIZE} items`,
          code: 'BATCH_SIZE_EXCEEDED',
          timestamp: new Date().toISOString(),
        });
      }

      // Validate type
      const validTypes = ['packages', 'suppliers', 'reviews', 'users'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
          code: 'INVALID_TYPE',
          timestamp: new Date().toISOString(),
        });
      }

      const actor = {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
      };

      let result;
      switch (action) {
        case 'approve':
          result = await batchApprove({ type, ids, actor });
          break;
        case 'reject':
          result = await batchReject({ type, ids, actor, reason });
          break;
        case 'delete':
          result = await batchDelete({ type, ids, actor });
          break;
        default:
          return res.status(400).json({
            success: false,
            error: 'Invalid action',
            code: 'INVALID_ACTION',
            timestamp: new Date().toISOString(),
          });
      }

      res.json(result);
    } catch (error) {
      logger.error('Bulk action failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'BULK_ACTION_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * GET /api/v2/admin/permission-cache/stats
 * Get permission cache statistics (for debugging)
 */
router.get('/permission-cache/stats', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const stats = getPermissionCacheStats();
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get cache stats', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'GET_CACHE_STATS_FAILED',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/v2/admin/permission-cache/clear
 * Clear permission cache
 */
router.post(
  '/permission-cache/clear',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { userId } = req.body;
      clearPermissionCache(userId);

      res.json({
        success: true,
        message: userId ? `Cache cleared for user ${userId}` : 'All permission caches cleared',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to clear cache', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
        code: 'CLEAR_CACHE_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

module.exports = router;
